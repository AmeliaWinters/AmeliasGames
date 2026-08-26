import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomEngine, isRoomCode } from '../shared/room.js';
// The protocol above the engine: reading a frame, validating a hello, which
// room a hello gets, running an action without throwing. Shared with the
// worker, because two copies of those rules can drift.
import {
  admit,
  applyAction,
  isAction,
  peek,
  readFrame,
  readHello,
  type Hello,
} from '../shared/session.js';
import { verifyClaim } from '../shared/account.js';
import { PONG_FRAME, type ServerMessage } from '../shared/protocol.js';
import { harvestKey } from '../shared/harvest.js';
import { applyHarvest, loadProfile, viewOf, type HarvestPost } from '../shared/players.js';
import { dueWords } from '../shared/profile.js';
import type { Profile, ProfileView } from '../shared/profile.js';
import type { Refusal } from '../shared/session.js';

// Deliberately not PORT: dev launchers inject PORT for the web server, and we
// would collide with Vite.
const PORT = Number(process.env.GAME_PORT ?? 8787);
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
/** Matches the worker: a socket that connects and never says hello is evicted. */
const HELLO_TIMEOUT_MS = 30 * 1000;

interface Room {
  engine: RoomEngine;
  /** seat -> live socket. Absent means that player is away but keeps their seat. */
  sockets: Map<number, WebSocket>;
  emptySince: number | null;
  /** Pending wake-up for a timed game. Null when the game is not on a clock. */
  timer: ReturnType<typeof setTimeout> | null;
  /**
   * A random id for this room's lifetime, and how many games have been dealt
   * in it. The worker keeps both in Durable Object storage; here they live on
   * the room, which is the same bargain the sockets and `emptySince` already
   * make. See `dealt` in `src/worker/index.ts` for why the id is not the code.
   */
  run: string;
  games: number;
  /**
   * The key the game currently on the table will be filed under, or null once
   * it has been. Set at the deal, not at the whistle: minting it at the end
   * would mean a failed write retrying under a different key, which is how a
   * player's experience quietly doubles.
   */
  pending: string | null;
}

const rooms = new Map<string, Room>();

/**
 * The player store, which in production is one Durable Object per account.
 *
 * A `Map`, for the same reason `rooms` is one: this process is a development
 * server, it restarts whenever anything under `src/shared/` is touched, and it
 * has no storage of its own. The decisions are shared with the worker in
 * `players.ts`; only the holding is different, which is the split this whole
 * codebase is built on.
 *
 * It does mean a local profile does not survive `tsx watch` noticing an edit.
 * That is worth knowing before wondering where a streak went, and it is not
 * worth a file: the real store is the deployed one.
 */
const profiles = new Map<string, Profile>();

/** Read one, creating it if this account has never finished a game. */
export function profileOf(accountId: string, now: number = Date.now()): Profile {
  return loadProfile(profiles.get(accountId), accountId, now);
}

export function profileViewOf(accountId: string, now: number = Date.now()): ProfileView {
  return viewOf(profileOf(accountId, now), now);
}

/**
 * File a finished game with everybody who was signed in for it.
 *
 * The worker's twin does this over stubs and can fail; here it is a `Map` and
 * cannot, so `pending` is cleared unconditionally. The idempotency key is
 * still honoured, because it is `applyRecord` that honours it and that is
 * shared — a dev server that quietly double-counted would be the worst place
 * to discover the rule was only enforced in production.
 */
function harvest(room: Room): void {
  if (room.pending === null) return;
  const accounts = room.engine.accounts();
  const record = accounts.length === 0 ? null : room.engine.record();
  const now = Date.now();

  if (record !== null) {
    for (const { seat, accountId } of accounts) {
      const post: HarvestPost = {
        record,
        seat,
        key: room.pending,
        now,
        name: room.engine.viewFor(seat, new Set(), now).players[seat]?.name ?? '',
      };
      profiles.set(accountId, applyHarvest(profileOf(accountId, now), post));
      // The end of a game is the moment to show somebody what it taught them,
      // so the number moves while they are still looking at the end screen.
      // Pushed to every signed-in seat in the room rather than to whoever
      // happened to play the last move: a game ends for everybody at once.
      const watching = room.sockets.get(seat);
      if (watching) send(watching, { t: 'profile', profile: profileViewOf(accountId, now) });
    }
  }
  room.pending = null;
}

/**
 * Sockets that connected but never said hello, with the time they arrived. The
 * worker evicts these on its alarm; without the same sweep here a silent socket
 * is never cleaned up, because `close` never fires for a connection nobody is
 * using.
 */
const pending = new Map<WebSocket, number>();

function connectedSeats(room: Room): Set<number> {
  return new Set(room.sockets.keys());
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function fail(socket: WebSocket, refusal: Refusal): void {
  send(socket, { t: 'error', kind: refusal.kind, message: refusal.error });
}

function broadcast(room: Room): void {
  const connected = connectedSeats(room);
  const now = Date.now();
  for (const [seat, socket] of room.sockets) {
    send(socket, { t: 'room', room: room.engine.viewFor(seat, connected, now) });
  }
  armDeadline(room);
}

/**
 * Wake up when a timed game runs out, so the round ends on time whether or not
 * anybody is still looking at it. Re-armed from `broadcast`, which every state
 * change already goes through: an untimed game asks for no timer, and one that
 * just ended clears the one it had.
 *
 * The timer is unref'd, because the listening socket is what keeps this process
 * alive and a pending round should never be the reason it cannot exit.
 */
function armDeadline(room: Room): void {
  if (room.timer !== null) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  const at = room.engine.deadline();
  if (at === null) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    if (room.engine.tick()) {
      // Same order as the worker's alarm: settle, file, then tell anybody who
      // is still watching.
      if (room.engine.isOver()) harvest(room);
      broadcast(room);
    }
  }, Math.max(0, at - Date.now()));
  room.timer.unref?.();
}

function handleConnection(socket: WebSocket, routingCode: string | null): void {
  let joined: { room: Room; seat: number; accountId?: string } | null = null;
  pending.set(socket, Date.now());

  /**
   * Seat a hello whose account claim has already been settled.
   *
   * Split out of the message handler because verification is asynchronous and
   * everything else here is not: the claim goes off to `verifyClaim` and the
   * seating happens when it comes back, whichever way it came back. Keeping it
   * one function means a guest and a signed-in player are seated by the same
   * code, which is the only way to be sure the guest path never rots.
   */
  const seatPlayer = (hello: Hello): void => {
    // The socket may have gone during the verify, and a second hello may have
    // arrived and been seated first. Both are ordinary on a flaky connection.
    if (joined || socket.readyState !== WebSocket.OPEN) return;

    // The engine, or nothing: the only I/O this adapter does to find one. In
    // production the same step is a read from Durable Object storage.
    const found = admit(rooms.get(hello.code)?.engine ?? null, hello);
    if (!found.ok) return fail(socket, found);

    let room = rooms.get(hello.code);
    if (!room) {
      room = {
        engine: found.engine,
        sockets: new Map(),
        emptySince: Date.now(),
        timer: null,
        run: randomUUID().slice(0, 8),
        games: 0,
        pending: null,
      };
      rooms.set(hello.code, room);
    }

    const result = room.engine.join(hello.playerId, hello.name, hello.accountId);
    if (!result.ok) return fail(socket, { kind: result.kind, error: result.error });

    // A second tab for the same player takes over the seat rather than
    // leaving a zombie socket on updates. 4000 tells that client the close
    // was deliberate, so it stops retrying.
    const previous = room.sockets.get(result.seat);
    if (previous && previous !== socket) previous.close(4000, 'Reconnected elsewhere');

    room.sockets.set(result.seat, socket);
    room.emptySince = null;
    joined = { room, seat: result.seat, accountId: hello.accountId };
    pending.delete(socket);

    // The clock may have run out while the room sat empty, so settle it
    // before answering rather than welcoming a player into a game that is
    // over and does not know it.
    room.engine.tick();
    // A game that ended while nobody was here still has to be filed. Gated
    // on `pending`, so this is also the retry for a harvest that failed.
    if (room.engine.isOver()) harvest(room);
    send(socket, {
      t: 'welcome',
      seat: result.seat,
      room: room.engine.viewFor(result.seat, connectedSeats(room)),
    });
    // Sent unasked-for, because the lobby's "18 words due" is the whole reason
    // anybody comes back and it should be on the screen before they have
    // pressed anything.
    if (hello.accountId) send(socket, { t: 'profile', profile: profileViewOf(hello.accountId) });
    broadcast(room);
  };

  socket.on('message', (raw) => {
    const frame = readFrame(String(raw));
    if (!frame.ok) return fail(socket, frame);
    const msg = frame.msg;

    // Before `hello`, and before anything else: a heartbeat is how the client
    // tells a live socket from one that died quietly, and a socket that has
    // joined nothing still has to be able to answer. Production answers this in
    // the runtime (see the worker's auto-response); there is no hibernation to
    // protect here, so a plain reply will do.
    if (msg.t === 'ping') {
      if (socket.readyState === WebSocket.OPEN) socket.send(PONG_FRAME);
      return;
    }

    if (msg.t === 'hello') {
      if (joined) return;

      const greeting = readHello(msg, routingCode);
      if (!greeting.ok) return fail(socket, greeting);
      const { hello } = greeting;

      // The one await on this path, and the reason `Hello` carries an
      // unverified claim rather than a checked account: `session.ts` is
      // synchronous so both adapters can share it, and `crypto.subtle.verify`
      // cannot be. A claim that does not check out is seated as a guest and
      // never refused — somebody whose key has gone wrong should still get
      // their game of Connect Four.
      void verifyClaim(hello.claim, hello.code).then((accountId) => {
        seatPlayer({ ...hello, accountId: accountId ?? undefined });
      });
      return;
    }

    if (msg.t === 'profile') {
      // No id on the message, so this can only ever answer for the account
      // this socket proved on the way in. There is nobody else to ask about.
      if (!joined?.accountId) return;
      send(socket, { t: 'profile', profile: profileViewOf(joined.accountId) });
      return;
    }

    if (!joined) return fail(socket, { kind: 'rejected', error: 'Join a room first.' });
    const { room, seat } = joined;

    // Any message at all is a chance to retry a harvest that has not landed.
    // Cheap, and it matters because the commonest message after a game ends is
    // a *refused* move, which returns long before the dispatch below. The
    // worker does the same, and the two must not drift.
    if (room.engine.isOver()) harvest(room);

    if (isAction(msg)) {
      // Before the deal, because `setup` is what reads the lists and a `move`
      // never deals. The worker does the same over its stubs; here the store
      // is a `Map` and cannot fail, which is the only difference. See
      // `RoomEngine.setStudy`.
      if (msg.t !== 'move') {
        const at = Date.now();
        for (const { seat: s, accountId } of room.engine.accounts()) {
          room.engine.setStudy(s, dueWords(profileOf(accountId, at), at));
        }
      }
      const result = applyAction(room.engine, seat, msg);
      if (!result.ok) return fail(socket, { kind: 'rejected', error: result.error });
      // `start`, `rematch` and `switch` are the only three ways a game is
      // dealt, and the engine refuses all three otherwise.
      if (msg.t !== 'move') {
        room.games += 1;
        room.pending = harvestKey(room.run, room.games);
      }
      // `harvest` pushes each signed-in seat its own updated profile, so
      // nothing more is needed here.
      if (room.engine.isOver()) harvest(room);
      broadcast(room);
    }
  });

  socket.on('close', () => {
    pending.delete(socket);
    if (!joined) return;
    const { room, seat } = joined;
    if (room.sockets.get(seat) === socket) room.sockets.delete(seat);
    if (room.sockets.size === 0) room.emptySince = Date.now();
    broadcast(room);
  });

  socket.on('error', () => {
    /* close handler does the cleanup */
  });
}

/**
 * The one HTTP request this process answers: the lobby's room lookup.
 *
 * In production the same question is a route on the worker, which forwards it
 * to the Durable Object the code names. Here it is a `Map` lookup, which is
 * the same split every other decision in this file makes -- `peek` itself is
 * shared, so the two adapters cannot answer differently.
 *
 * CORS is wide open because in development the lobby is served by Vite on
 * :5173 and this is :8787. Deployed they are one origin and no header is
 * involved, so nothing here is ever shipped.
 */
function serveLookup(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('access-control-allow-origin', '*');
  if (url.pathname !== '/peek') {
    res.writeHead(404).end('Not found');
    return;
  }
  const code = (url.searchParams.get('code') ?? '').toUpperCase();
  if (!isRoomCode(code)) {
    res.writeHead(400).end('Invalid room code.');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(peek(code, rooms.get(code)?.engine ?? null)));
}

export function startServer(port: number = PORT): WebSocketServer {
  // An explicit HTTP server rather than letting `ws` open its own, because the
  // sockets and the lookup have to share one port: the client derives both
  // from a single origin, and a second port would be a second thing to
  // configure and to get wrong.
  const http: Server = createServer(serveLookup);
  const wss = new WebSocketServer({ server: http });
  http.listen(port);
  // `ws` only owns the listener when it opened it, so closing the socket
  // server would otherwise leave this port held -- which in the test suite is
  // a run that never exits.
  wss.on('close', () => http.close());
  // The worker validates the code at the edge before routing and again on
  // hello. Nothing here routes by code, but "a bad code never gets a socket" is
  // an invariant, and an adapter that enforces it in one place only is where
  // the two drift apart.
  wss.on('connection', (socket, request) => {
    const code = (new URL(request.url ?? '/', 'http://localhost').searchParams.get('code') ?? '')
      .toUpperCase();
    if (code && !isRoomCode(code)) {
      socket.close(4003, 'Invalid room code');
      return;
    }
    // Passed on so `readHello` can hold the hello to it. Rooms here are keyed
    // by whatever the hello says, but "the code on the socket is the code in
    // the hello" is an invariant the worker enforces, and one enforced in a
    // single adapter is where the two drift.
    handleConnection(socket, code || null);
  });
  return wss;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
      if (room.timer !== null) clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
  for (const [socket, since] of pending) {
    if (now - since > HELLO_TIMEOUT_MS) {
      socket.close(4001, 'Never said hello');
      pending.delete(socket);
    }
  }
}, 60_000).unref();

if (!process.env.VITEST) {
  startServer(PORT);
  console.log(`[server] listening on ws://localhost:${PORT}`);
}
