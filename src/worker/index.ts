/// <reference types="@cloudflare/workers-types" />
import { RoomEngine, isRoomCode, type RoomSnapshot } from '../shared/room.js';
// The protocol above the engine — reading a frame, validating a hello, which
// room a hello gets, running an action without throwing. Shared with the dev
// server, because two copies of those rules is two copies that can drift.
import {
  admit,
  applyAction,
  isAction,
  readFrame,
  readHello,
  type Refusal,
} from '../shared/session.js';
import { PING_FRAME, PONG_FRAME, type ServerMessage } from '../shared/protocol.js';

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
    // Answer the client's heartbeat in the runtime, below this object. A
    // hibernating room is one that costs nothing until somebody plays a move;
    // if the ping arrived as an ordinary message it would wake the object
    // every twenty seconds per open tab, and a room left open overnight would
    // bill like a room being played in all night. The pair is matched byte for
    // byte, which is why both frames come from `protocol.ts` rather than being
    // written out here.
    // Guarded because this is a workerd affordance rather than part of the
    // Durable Object contract: the tests drive this class through a hand-built
    // state double, which has no such global. Skipping it there costs nothing
    // — without hibernation there is nothing to protect.
    if (
      typeof WebSocketRequestResponsePair === 'function' &&
      typeof state.setWebSocketAutoResponse === 'function'
    ) {
      state.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME));
    }
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
    // A timed game needs waking when its clock runs out, which is sooner than
    // housekeeping would ever look. `ensureAlarm` only ever brings an alarm
    // forward, so asking for both is asking for the earlier of the two.
    const deadline = this.engine.deadline();
    if (deadline !== null) await this.ensureAlarm(Math.max(0, deadline - Date.now()));
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

  private fail(ws: WebSocket, refusal: Refusal): void {
    this.post(ws, { t: 'error', kind: refusal.kind, message: refusal.error });
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
    const now = Date.now();
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta && meta.playerId !== '') {
        this.post(ws, { t: 'room', room: this.engine.viewFor(meta.seat, connected, now) });
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
    const frame = readFrame(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    if (!frame.ok) return this.fail(ws, frame);
    const msg = frame.msg;

    const meta = ws.deserializeAttachment() as SocketMeta | null;
    // Kept from the original attachment so the pending-socket sweep still
    // measures from when the socket actually connected.
    const since = meta?.since ?? Date.now();

    if (msg.t === 'hello') {
      if (isSeated(meta)) return;

      // The socket was routed to this object by the code in the URL, so a
      // `hello` naming a different room must not be welcomed into this one.
      // `readHello` holds it to that.
      const routingCode = (await this.state.storage.get<string>('code')) ?? null;
      const greeting = readHello(msg, routingCode);
      if (!greeting.ok) return this.fail(ws, greeting);
      const { hello } = greeting;

      // The only I/O in finding a room: in the dev server this same step is a
      // lookup in a `Map`, which is why `admit` takes the engine rather than
      // going and getting one.
      const found = admit(await this.loadEngine(), hello);
      if (!found.ok) return this.fail(ws, found);
      const engine = found.engine;
      if (found.created) this.engine = engine;

      const result = engine.join(hello.playerId, hello.name);
      if (!result.ok) return this.fail(ws, { kind: result.kind, error: result.error });

      // Drop any earlier socket for this same player so it stops receiving
      // updates. 4000 tells that client the close was deliberate, so it stops
      // retrying rather than racing this one for the seat forever.
      for (const other of this.state.getWebSockets()) {
        if (other === ws) continue;
        const otherMeta = other.deserializeAttachment() as SocketMeta | null;
        if (otherMeta?.playerId === hello.playerId) other.close(4000, 'Reconnected elsewhere');
      }

      ws.serializeAttachment({ playerId: hello.playerId, seat: result.seat, since } satisfies SocketMeta);
      await this.state.storage.delete('emptySince');
      await this.persist();

      // The clock can run out while an object is hibernating, so settle before
      // answering rather than welcoming someone into a game that is over and
      // does not know it yet.
      if (engine.tick()) await this.persist();
      this.post(ws, {
        t: 'welcome',
        seat: result.seat,
        room: engine.viewFor(result.seat, this.connectedSeats()),
      });
      this.broadcast();
      return;
    }

    if (!meta || meta.playerId === '') {
      return this.fail(ws, { kind: 'rejected', error: 'Join a room first.' });
    }

    const engine = await this.loadEngine();
    if (!engine) return this.fail(ws, { kind: 'no-room', error: 'This room no longer exists.' });

    if (isAction(msg)) {
      const result = applyAction(engine, meta.seat, msg);
      if (!result.ok) return this.fail(ws, { kind: 'rejected', error: result.error });
      await this.persist();
      this.broadcast();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.departed(ws);
  }

  /**
   * A socket can leave either way, and for a while these two did different
   * things: `close` started the empty-room countdown and `error` did not. A
   * room whose last socket failed rather than closed was therefore never swept
   * — it kept its storage and, worse, its room code, for good. Both doors now
   * lead to the same place.
   */
  async webSocketError(ws: WebSocket): Promise<void> {
    await this.departed(ws);
  }

  private async departed(ws: WebSocket): Promise<void> {
    // The seat itself is kept in storage, so the player can reclaim it later.
    await this.loadEngine();
    if (this.connectedSeats(ws).size === 0) {
      await this.state.storage.put('emptySince', Date.now());
      await this.ensureAlarm(EMPTY_ROOM_TTL_MS);
    }
    this.broadcast(ws);
  }

  /**
   * Housekeeping. Without this a room lives in storage forever, so the
   * collision space grows with every game ever played rather than with the
   * games being played now. An alarm on an idle object does not keep it awake.
   */
  async alarm(): Promise<void> {
    const now = Date.now();

    // A timed game ends on the clock, whether or not anyone is still watching
    // — which is the whole point of putting it on one.
    const engine = await this.loadEngine();
    if (engine?.tick(now)) {
      await this.state.storage.put('room', engine.snapshot());
      this.broadcast();
    }

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
    const deadline = this.engine?.deadline() ?? null;
    if (deadline !== null) await this.state.storage.setAlarm(deadline);
    if (pending || this.connectedSeats().size === 0) {
      await this.ensureAlarm(pending ? PENDING_TICK_MS : IDLE_TICK_MS);
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
