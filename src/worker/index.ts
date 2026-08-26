/// <reference types="@cloudflare/workers-types" />
import { RoomEngine, isRoomCode, type RoomSnapshot } from '../shared/room.js';
// The protocol above the engine: reading a frame, validating a hello, which
// room a hello gets, running an action without throwing. Shared with the dev
// server, because two copies of those rules can drift.
import {
  admit,
  applyAction,
  isAction,
  peek,
  readFrame,
  readHello,
  type Hello,
  type Refusal,
} from '../shared/session.js';
import { verifyClaim } from '../shared/account.js';
import { PING_FRAME, PONG_FRAME, type ServerMessage } from '../shared/protocol.js';
import type { ProfileView, StudyLists } from '../shared/profile.js';
import { harvestKey } from '../shared/harvest.js';
import { PLAYER_PATHS, type HarvestPost } from '../shared/players.js';

export interface Env {
  ROOMS: DurableObjectNamespace;
  /**
   * One object per account. Reached only from inside a room, never routed to
   * from `fetch` — see the note on `Player`. A client that could post its own
   * results could post any results.
   */
  PLAYERS: DurableObjectNamespace;
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
 * yet seated", so use `isSeated` rather than testing the attachment itself.
 */
interface SocketMeta {
  playerId: string;
  seat: number;
  since: number;
  /**
   * The account this socket proved on the way in, or absent for a guest.
   *
   * On the attachment rather than looked up from the engine, because it is
   * what answers a `profile` message and hibernation destroys everything else:
   * the seat survives here already for exactly the same reason. It is written
   * only from a verified claim, so a socket cannot come back from hibernation
   * holding an account it never proved.
   */
  accountId?: string;
}

function isSeated(meta: SocketMeta | null): boolean {
  return meta !== null && meta.playerId !== '';
}

/**
 * One Durable Object per room code. Cloudflare guarantees a single instance
 * globally for a given code, which is exactly the "one authoritative process
 * per game" model: no locking, no shared database.
 */
export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private engine: RoomEngine | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    // Answer the client's heartbeat in the runtime, below this object. A
    // hibernating room costs nothing until somebody plays a move; if the ping
    // arrived as an ordinary message it would wake the object every twenty
    // seconds per open tab, and a room left open overnight would bill like one
    // played in all night. The pair is matched byte for byte, which is why both
    // frames come from `protocol.ts`.
    //
    // Guarded because this is a workerd affordance rather than part of the
    // Durable Object contract: the tests drive this class through a hand-built
    // state double with no such global, and without hibernation there is
    // nothing to protect.
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
      // A snapshot we can no longer read: an older shape, or a game that has
      // been removed. Discard it rather than failing to restore it on every
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

  /**
   * Mark that a game has just been dealt, and reserve the key its results will
   * be filed under.
   *
   * Called on `start`, `rematch` and `switch`, which are the only three ways a
   * game is dealt — `move` never deals one, and `RoomEngine` refuses all three
   * otherwise, so a successful one of those is exactly a deal.
   *
   * The key is minted **here**, at the deal, rather than at the end. That is
   * what makes a retry safe: whatever happens between now and the final
   * whistle, the results go out under this string, so a repeat is recognisable
   * as a repeat at the far end (see `applyRecord`). Minting it at the end
   * instead would mean a crashed write retrying under a *different* key, which
   * is the failure that quietly doubles somebody's experience.
   *
   * `run` is a random id for this room's lifetime, not the room code, and the
   * difference matters: codes are four letters and get reused, so a room
   * `ABCD` in March and another `ABCD` in June would both file their first
   * game as `ABCD#1` and the second would be dropped as a duplicate of the
   * first.
   *
   * All of it lives in its own storage keys rather than in `RoomSnapshot`, the
   * way `emptySince` already does: it is adapter bookkeeping, no reducer ever
   * sees it, and putting it in the snapshot would mean a `SNAPSHOT_VERSION`
   * bump that deletes every live room on deploy for the sake of a counter.
   */
  private async dealt(): Promise<void> {
    let run = await this.state.storage.get<string>('run');
    if (!run) {
      run = crypto.randomUUID().slice(0, 8);
      await this.state.storage.put('run', run);
    }
    const games = ((await this.state.storage.get<number>('games')) ?? 0) + 1;
    await this.state.storage.put('games', games);
    await this.state.storage.put('pending', harvestKey(run, games));
  }

  /**
   * File a finished game with everybody who was signed in for it.
   *
   * Gated on `pending` rather than on catching the moment the game ended, and
   * that is the whole design: `pending` is set when the game is dealt and
   * cleared only when every account has taken its results, so this is safe to
   * call as often as anything likes and **retries itself** on the next message
   * or alarm if a player object was unreachable. Catching the transition
   * instead would give exactly one attempt, and a room whose harvest failed
   * would lose the game silently.
   *
   * Cleared only when *all* of them succeeded. A partial write is the one case
   * worth being careful about, and the answer is to try the lot again: the
   * accounts that already took it will recognise the key and do nothing.
   */
  /**
   * Ask one player object something. The only way this class ever reaches one.
   *
   * Returns null rather than throwing on anything at all. A player object that
   * cannot be reached must never take a room down with it: the game is the
   * thing people are here for, and a profile that lands a few seconds late is
   * not worth a dropped socket.
   */
  private async askPlayer(
    accountId: string,
    path: string,
    body?: unknown,
  ): Promise<{ profile: ProfileView; study: StudyLists } | null> {
    try {
      const stub = this.env.PLAYERS.get(this.env.PLAYERS.idFromName(accountId));
      const response = await stub.fetch(
        `https://player${path}?id=${encodeURIComponent(accountId)}`,
        body === undefined
          ? undefined
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            },
      );
      if (!response.ok) return null;
      // Each path fills in one half of this and the callers read the half
      // they asked for. Widening the return type rather than generifying it,
      // because there are two callers and a type parameter would be more
      // machinery than the saving.
      return (await response.json()) as { profile: ProfileView; study: StudyLists };
    } catch {
      return null;
    }
  }

  /**
   * Fill in what every signed-in seat is due to review, before a deal.
   *
   * At the deal rather than at sign-in, because "due" is a comparison against
   * the clock: a list fetched when somebody joined the room is already stale
   * by the time the last player arrives and the host presses start. See
   * `RoomEngine.setStudy`.
   *
   * One fetch per signed-in seat, on the three messages that deal a game and
   * on nothing else, so a room in the middle of a game pays nothing. Every
   * failure is silent and leaves that seat with no list, which is the game as
   * it played before any of this existed: a profile that cannot be reached
   * must never stop a game being dealt.
   */
  private async loadStudy(engine: RoomEngine): Promise<void> {
    for (const { seat, accountId } of engine.accounts()) {
      const answer = await this.askPlayer(accountId, PLAYER_PATHS.study);
      if (answer) engine.setStudy(seat, answer.study);
    }
  }

  private async sendProfile(ws: WebSocket, accountId: string): Promise<void> {
    const answer = await this.askPlayer(accountId, PLAYER_PATHS.profile);
    if (answer) this.post(ws, { t: 'profile', profile: answer.profile });
  }

  /** The live socket for a seat, if anybody is sitting at it right now. */
  private socketAt(seat: number): WebSocket | null {
    for (const ws of this.state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta && meta.playerId !== '' && meta.seat === seat) return ws;
    }
    return null;
  }

  private async harvest(engine: RoomEngine): Promise<void> {
    const pending = await this.state.storage.get<string>('pending');
    if (!pending) return;

    const accounts = engine.accounts();
    // Nobody signed in. The commonest room in the app, and it should cost one
    // storage read and no requests at all.
    if (accounts.length === 0) {
      await this.state.storage.delete('pending');
      return;
    }

    // Never null here: `harvest` is only ever called on a game `isOver` agrees
    // is finished, and a game that implements no `record` still gets a
    // synthesised one so that playing it counts for something. Read
    // defensively anyway, because the cost of being wrong is a lost harvest.
    const record = engine.record();
    if (record === null) return;

    const now = Date.now();
    const results = await Promise.all(
      accounts.map(async ({ seat, accountId }) => {
        const post: HarvestPost = {
          record,
          seat,
          key: pending,
          now,
          name: engine.viewFor(seat, new Set(), now).players[seat]?.name ?? '',
        };
        // A player object that cannot be reached is a retry, not an error to
        // report: nobody in the room did anything wrong, and telling them
        // their game did not count would be worse than quietly filing it a few
        // seconds later. `harvest` is gated on `pending`, so the next message
        // or alarm comes back for it.
        const answer = await this.askPlayer(accountId, PLAYER_PATHS.harvest, post);
        if (answer === null) return false;

        // The profile comes back from the write itself rather than being
        // fetched again, which saves a second round trip to the same object at
        // the one moment it is certainly awake. The end of a game is when
        // somebody should see what it taught them.
        const ws = this.socketAt(seat);
        if (ws) this.post(ws, { t: 'profile', profile: answer.profile });
        return true;
      }),
    );

    if (results.every(Boolean)) await this.state.storage.delete('pending');
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
   * getWebSockets() while its close handler runs, so without this the broadcast
   * that exists to raise the "away" badge would report the departing player as
   * still connected, and then the room hibernates and nothing corrects it until
   * the next move.
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
    const code = (new URL(request.url).searchParams.get('code') ?? '').toUpperCase();

    /*
      The lobby asking what is behind a code, before anybody types a name.

      It reads the room and never opens one: a mistyped code that created a
      room would leave an empty Durable Object behind for every slip of the
      thumb, and the next person to type that code correctly would be told
      their game exists when it does not. `loadEngine` returns null for "no
      room here", which is exactly the answer.

      No socket, so no hibernation and no alarm: this is a GET against storage
      and the object goes straight back to sleep.
    */
    if (new URL(request.url).pathname.endsWith('/peek')) {
      if (!isRoomCode(code)) return new Response('Invalid room code.', { status: 400 });
      const answer = peek(code, await this.loadEngine());
      return new Response(JSON.stringify(answer), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
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
      // The account is settled before the room is, because `join` takes it. A
      // claim that does not check out seats a guest and is never a refusal:
      // somebody whose key has gone wrong should still get their game.
      const accountId = (await verifyClaim(greeting.hello.claim, greeting.hello.code)) ?? undefined;
      const hello: Hello = { ...greeting.hello, accountId };

      // The only I/O in finding a room. In the dev server the same step is a
      // `Map` lookup, which is why `admit` takes the engine rather than going
      // and getting one.
      const found = admit(await this.loadEngine(), hello);
      if (!found.ok) return this.fail(ws, found);
      const engine = found.engine;
      if (found.created) this.engine = engine;

      const result = engine.join(hello.playerId, hello.name, hello.accountId);
      if (!result.ok) return this.fail(ws, { kind: result.kind, error: result.error });

      // Drop any earlier socket for this same player so it stops receiving
      // updates. 4000 tells that client the close was deliberate, so it stops
      // retrying rather than racing this one for the seat forever.
      for (const other of this.state.getWebSockets()) {
        if (other === ws) continue;
        const otherMeta = other.deserializeAttachment() as SocketMeta | null;
        if (otherMeta?.playerId === hello.playerId) other.close(4000, 'Reconnected elsewhere');
      }

      ws.serializeAttachment({
        playerId: hello.playerId,
        seat: result.seat,
        since,
        accountId: hello.accountId,
      } satisfies SocketMeta);
      await this.state.storage.delete('emptySince');
      await this.persist();

      // The clock can run out while an object is hibernating, so settle before
      // answering rather than welcoming someone into a game that is over and
      // does not know it.
      if (engine.tick()) await this.persist();
      // And a game that ended while nobody was here still has to be filed.
      // This is also the retry: `harvest` is gated on `pending`, so a write
      // that failed last time is simply tried again now.
      if (engine.isOver()) await this.harvest(engine);
      this.post(ws, {
        t: 'welcome',
        seat: result.seat,
        room: engine.viewFor(result.seat, this.connectedSeats()),
      });
      // Sent unasked-for, because the lobby's "18 words due" is the whole
      // reason anybody comes back and it should be on the screen before they
      // have pressed anything.
      if (hello.accountId) await this.sendProfile(ws, hello.accountId);
      this.broadcast();
      return;
    }

    if (!meta || meta.playerId === '') {
      return this.fail(ws, { kind: 'rejected', error: 'Join a room first.' });
    }

    const engine = await this.loadEngine();
    if (!engine) {
      // The routing code is the object's identity and outlives the engine, so
      // a player whose room was swept is told *which* room went. They very
      // likely still have the invite link open in another tab.
      const code = await this.state.storage.get<string>('code');
      return this.fail(ws, {
        kind: 'no-room',
        error: code ? `Room ${code} no longer exists.` : 'This room no longer exists.',
      });
    }

    // Any message at all is a chance to retry a harvest that could not be
    // delivered. Gated on an in-memory `isOver`, so it costs nothing while a
    // game is being played, and it matters because the commonest message after
    // a game ends is a *refused* move — somebody tapping the board one more
    // time — which returns long before the dispatch below.
    if (engine.isOver()) await this.harvest(engine);

    if (msg.t === 'profile') {
      // No id on the message, so this can only ever answer for the account
      // this socket proved on the way in. There is nobody else to ask about.
      if (meta.accountId) await this.sendProfile(ws, meta.accountId);
      return;
    }

    if (isAction(msg)) {
      // Before the deal, not after: `setup` is what reads the lists, and a
      // `move` never deals. See `loadStudy`.
      if (msg.t !== 'move') await this.loadStudy(engine);
      const result = applyAction(engine, meta.seat, msg);
      if (!result.ok) return this.fail(ws, { kind: 'rejected', error: result.error });
      // `start`, `rematch` and `switch` are the three ways a game is dealt, and
      // a successful one of them is exactly a deal. `move` never deals.
      if (msg.t !== 'move') await this.dealt();
      await this.persist();
      if (engine.isOver()) await this.harvest(engine);
      this.broadcast();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.departed(ws);
  }

  /**
   * A socket can leave either way, and for a while these two did different
   * things: `close` started the empty-room countdown and `error` did not. A
   * room whose last socket failed rather than closed was never swept, and kept
   * its storage and its room code for good. Both doors now lead to the same
   * place.
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

    // A timed game ends on the clock whether or not anyone is still watching,
    // which is the whole point of putting it on one.
    const engine = await this.loadEngine();
    if (engine?.tick(now)) {
      await this.state.storage.put('room', engine.snapshot());
      this.broadcast();
    }
    // Deliberately outside the `tick` guard. A timed game whose clock ran out
    // in an empty room is settled by the tick above, but a harvest that failed
    // on an earlier pass leaves `pending` set with nothing left to tick, and
    // this alarm is the only thing that will ever come back for it.
    if (engine?.isOver()) await this.harvest(engine);

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
        // in. Close whatever is still attached: this object is blank now, and
        // anything holding it open is holding a room that no longer exists.
        for (const ws of this.state.getWebSockets()) ws.close(4002, 'Room closed');
        return; // nothing left to watch
      }
      await this.state.storage.put('emptySince', emptySince);
    }

    // Only keep ticking if there is something to watch: an unseated socket on
    // its hello timer, or an empty room counting down to deletion. A room with
    // players needs no housekeeping, and rescheduling regardless woke the object
    // every few minutes for as long as anyone held a socket open. `persist()`
    // and `webSocketClose` re-arm the alarm when that changes.
    const deadline = this.engine?.deadline() ?? null;
    if (deadline !== null) await this.state.storage.setAlarm(deadline);
    if (pending || this.connectedSeats().size === 0) {
      await this.ensureAlarm(pending ? PENDING_TICK_MS : IDLE_TICK_MS);
    }
  }
}

// Exported so `wrangler.toml` can name it. It is never routed to: rooms reach
// it through their stub, which is the whole trust story. See `player.ts`.
export { Player } from './player.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    /*
      "Does this code exist, and what is it playing?", asked by the lobby as
      the fourth letter lands. Routed by code exactly as `/ws` is, because the
      only thing that knows is the object that code names.

      A code that is not a code is refused here rather than routed: idFromName
      on arbitrary text would spin up an object per typo.
    */
    if (url.pathname === '/peek') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      if (!isRoomCode(code)) return new Response('Invalid room code.', { status: 400 });
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(new Request(`https://rooms/peek?code=${code}`));
    }

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
