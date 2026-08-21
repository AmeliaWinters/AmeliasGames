/// <reference types="@cloudflare/workers-types" />
import { RoomEngine, isRoomCode, type RoomSnapshot } from '../shared/room.js';
import { getGame } from '../shared/games/index.js';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorKind,
  type ServerMessage,
} from '../shared/protocol.js';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

/** A socket that connects and never says hello is closed after this long. */
const HELLO_TIMEOUT_MS = 30 * 1000;
/** A room with nobody in it is deleted after this long. */
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
/** How often the housekeeping alarm runs while there is anything to watch. */
const IDLE_TICK_MS = 5 * 60 * 1000;
const PENDING_TICK_MS = 30 * 1000;

/**
 * Per-socket identity, kept across hibernation via serializeAttachment.
 *
 * Set at accept time rather than at join, so a socket that never says hello is
 * still visible to the sweeper. An empty `playerId` means "connected but not
 * yet seated" — use `isSeated` rather than testing the attachment itself.
 */
interface SocketMeta {
  playerId: string;
  seat: number;
  since: number;
}

function isSeated(meta: SocketMeta | null): boolean {
  return meta !== null && meta.playerId !== '';
}

/**
 * One Durable Object per room code. Cloudflare guarantees a single instance
 * globally for a given code, which is exactly the "one authoritative process
 * per game" model — no locking, no shared database.
 */
export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private engine: RoomEngine | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Rehydrate the room from storage.
   *
   * This must be called on EVERY message, not just on join. Hibernation
   * destroys the object instance while the sockets stay alive, so an in-memory
   * `engine` is routinely null for a player who joined perfectly legitimately.
   */
  private async loadEngine(): Promise<RoomEngine | null> {
    if (this.engine) return this.engine;
    const stored = await this.state.storage.get<RoomSnapshot>('room');
    if (!stored) return null;
    const engine = RoomEngine.restore(stored);
    if (!engine) {
      // A snapshot we can no longer read — an older shape, or a game that has
      // been removed. Discard it, rather than failing to restore it on every
      // message from now until the end of time.
      await this.state.storage.deleteAll();
      return null;
    }
    this.engine = engine;
    return this.engine;
  }

  private async persist(): Promise<void> {
    if (!this.engine) return;
    await this.state.storage.put('room', this.engine.snapshot());
    await this.ensureAlarm(IDLE_TICK_MS);
  }

  /** Arrange for `alarm()` to run within `delay`, without pushing it later. */
  private async ensureAlarm(delay: number): Promise<void> {
    const wanted = Date.now() + delay;
    const current = await this.state.storage.getAlarm();
    if (current === null || current > wanted) await this.state.storage.setAlarm(wanted);
  }

  /** Seats with a live socket right now. */
  private connectedSeats(exclude?: WebSocket): Set<number> {
    const seats = new Set<number>();
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta && meta.playerId !== '') seats.add(meta.seat);
    }
    return seats;
  }

  private post(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket is going away; close handler will clean up */
    }
  }

  private fail(ws: WebSocket, kind: ErrorKind, message: string): void {
    this.post(ws, { t: 'error', kind, message });
  }

  /**
   * `exclude` is the socket that is currently closing. It is still listed by
   * getWebSockets() while its close handler runs, so without this the
   * broadcast that exists to raise the "away" badge would report the departing
   * player as still connected — and then the room hibernates, so nothing
   * corrects it until the next move.
   */
  private broadcast(exclude?: WebSocket): void {
    if (!this.engine) return;
    const connected = this.connectedSeats(exclude);
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta && meta.playerId !== '') {
        this.post(ws, { t: 'room', room: this.engine.viewFor(meta.seat, connected) });
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    const code = (new URL(request.url).searchParams.get('code') ?? '').toUpperCase();
    if (!isRoomCode(code)) return new Response('Invalid room code.', { status: 400 });

    // The code that routed us here is the room's real identity. Remembering it
    // is what lets a `hello` be checked against it.
    if ((await this.state.storage.get<string>('code')) !== code) {
      await this.state.storage.put('code', code);
    }

    const pair = new WebSocketPair();
    // acceptWebSocket (rather than ws.accept) opts into hibernation: an idle
    // room is evicted from memory and costs nothing until the next message.
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ playerId: '', seat: -1, since: Date.now() } satisfies SocketMeta);
    await this.ensureAlarm(PENDING_TICK_MS);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.fail(ws, 'protocol', 'Malformed message.');
    }
    // JSON.parse of the four bytes `null` succeeds and yields null, and
    // reading `.t` off that throws.
    if (typeof msg !== 'object' || msg === null) {
      return this.fail(ws, 'protocol', 'Malformed message.');
    }

    const meta = ws.deserializeAttachment() as SocketMeta | null;
    // Kept from the original attachment so the pending-socket sweep still
    // measures from when the socket actually connected.
    const since = meta?.since ?? Date.now();

    if (msg.t === 'hello') {
      if (isSeated(meta)) return;

      if (msg.v !== PROTOCOL_VERSION) {
        return this.fail(ws, 'protocol', 'This page is out of date — please refresh.');
      }

      const name = String(msg.name ?? '').trim().slice(0, 20) || 'Player';
      const playerId = String(msg.playerId ?? '');
      const code = String(msg.code ?? '').toUpperCase();
      if (!playerId) return this.fail(ws, 'protocol', 'Missing player id.');
      if (!isRoomCode(code)) return this.fail(ws, 'protocol', 'Invalid room code.');

      // The socket was routed to this object by the code in the URL; a `hello`
      // naming a different room would otherwise be welcomed into this one.
      const routingCode = await this.state.storage.get<string>('code');
      if (routingCode && code !== routingCode) {
        return this.fail(ws, 'protocol', 'That code does not match this room.');
      }

      const found = await this.engineFor(
        String(msg.gameId ?? ''),
        code,
        msg.create === true,
        playerId,
        msg.players,
      );
      if (!found.ok) return this.fail(ws, found.kind, found.error);
      const engine = found.engine;

      const result = engine.join(playerId, name);
      if (!result.ok) return this.fail(ws, 'full', result.error);

      // Drop any earlier socket for this same player so it stops receiving
      // updates. 4000 tells that client the close was deliberate, so it stops
      // retrying rather than racing this one for the seat forever.
      for (const other of this.state.getWebSockets()) {
        if (other === ws) continue;
        const otherMeta = other.deserializeAttachment() as SocketMeta | null;
        if (otherMeta?.playerId === playerId) other.close(4000, 'Reconnected elsewhere');
      }

      ws.serializeAttachment({ playerId, seat: result.seat, since } satisfies SocketMeta);
      await this.state.storage.delete('emptySince');
      await this.persist();

      this.post(ws, {
        t: 'welcome',
        seat: result.seat,
        room: engine.viewFor(result.seat, this.connectedSeats()),
      });
      this.broadcast();
      return;
    }

    if (!meta || meta.playerId === '') return this.fail(ws, 'rejected', 'Join a room first.');

    const engine = await this.loadEngine();
    if (!engine) return this.fail(ws, 'no-room', 'This room no longer exists.');

    if (msg.t === 'move' || msg.t === 'rematch' || msg.t === 'switch') {
      // A reducer is not supposed to throw, and the fuzzing says none of them
      // does — but an exception escaping here aborts the Durable Object and
      // takes the other player's game down with it.
      let result;
      try {
        result =
          msg.t === 'move'
            ? engine.move(meta.seat, msg.move)
            : msg.t === 'switch'
              ? engine.switchGame(String(msg.gameId ?? ''))
              : engine.rematch();
      } catch {
        return this.fail(ws, 'rejected', 'That move could not be played.');
      }
      if (!result.ok) return this.fail(ws, 'rejected', result.error);
      await this.persist();
      this.broadcast();
      return;
    }
  }

  /**
   * Find or create the room. Returns a reason rather than throwing, because
   * every caller is holding a socket that deserves an answer.
   */
  private async engineFor(
    gameId: string,
    code: string,
    create: boolean,
    playerId: string,
    players: number | undefined,
  ): Promise<{ ok: true; engine: RoomEngine } | { ok: false; kind: ErrorKind; error: string }> {
    const existing = await this.loadEngine();

    if (existing) {
      // Starting a "new" game on a code that is already someone else's room
      // would silently seat you as player two of their game.
      //
      // Two rooms are not someone else's: one nobody has sat in yet, and one
      // where this player already has a seat. That second case is ordinary —
      // a create-flagged hello arriving twice, from a retry or a remount — and
      // refusing it would lock the host out of the room they just made.
      const mine = existing.seatOf(playerId) !== -1;
      if (create && !existing.isFresh() && !mine) {
        return {
          ok: false,
          kind: 'full',
          error: 'That code is already in use. Try starting again.',
        };
      }
      if (gameId && gameId !== existing.def.id) {
        return { ok: false, kind: 'rejected', error: `That room is playing ${existing.def.name}.` };
      }
      return { ok: true, engine: existing };
    }

    if (!create) return { ok: false, kind: 'no-room', error: 'No room with that code.' };
    if (!getGame(gameId)) return { ok: false, kind: 'rejected', error: 'Could not create that game.' };

    // Only the creating client's request is honoured; the room's size is
    // settled before anyone else can ask for a different one.
    const engine = RoomEngine.create(code, gameId, undefined, players);
    if (!engine) return { ok: false, kind: 'rejected', error: 'Could not create that game.' };
    this.engine = engine;
    await this.persist();
    return { ok: true, engine };
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // The seat itself is kept in storage, so the player can reclaim it later.
    await this.loadEngine();
    if (this.connectedSeats(ws).size === 0) {
      await this.state.storage.put('emptySince', Date.now());
      await this.ensureAlarm(EMPTY_ROOM_TTL_MS);
    }
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.loadEngine();
    this.broadcast(ws);
  }

  /**
   * Housekeeping. Without this a room lives in storage forever, so the
   * collision space grows with every game ever played rather than with the
   * games being played now. An alarm on an idle object does not keep it awake.
   */
  async alarm(): Promise<void> {
    const now = Date.now();

    let pending = false;
    for (const ws of this.state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (!meta || meta.playerId !== '') continue;
      if (now - meta.since > HELLO_TIMEOUT_MS) ws.close(4001, 'Never said hello');
      else pending = true;
    }

    if (this.connectedSeats().size === 0) {
      const emptySince = (await this.state.storage.get<number>('emptySince')) ?? now;
      if (now - emptySince >= EMPTY_ROOM_TTL_MS) {
        await this.state.storage.deleteAll();
        this.engine = null;
        // deleteAll() took the 'code' key with it, so the routing-code check in
        // fetch() would wave through a socket arriving with any valid code and
        // let it create a room whose code does not match the object it lives
        // in. Close whatever is still attached: this object is now a blank one,
        // and anything holding it open is holding a room that no longer exists.
        for (const ws of this.state.getWebSockets()) ws.close(4002, 'Room closed');
        return; // nothing left to watch
      }
      await this.state.storage.put('emptySince', emptySince);
    }

    // Only keep ticking if there is something to watch: an unseated socket on
    // its hello timer, or an empty room counting down to deletion. A room with
    // players in it needs no housekeeping, and rescheduling regardless woke the
    // object every few minutes for as long as anyone held a socket open.
    // `persist()` and `webSocketClose` re-arm the alarm when that changes.
    if (pending || this.connectedSeats().size === 0) {
      await this.state.storage.setAlarm(now + (pending ? PENDING_TICK_MS : IDLE_TICK_MS));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      if (!isRoomCode(code)) return new Response('Invalid room code.', { status: 400 });
      // Routing by code is what pins every player in a room to one instance.
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
