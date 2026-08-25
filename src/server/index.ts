import { WebSocketServer, WebSocket } from 'ws';
import { RoomEngine, isRoomCode } from '../shared/room.js';
// The protocol above the engine: reading a frame, validating a hello, which
// room a hello gets, running an action without throwing. Shared with the
// worker, because two copies of those rules can drift.
import { admit, applyAction, isAction, readFrame, readHello } from '../shared/session.js';
import { PONG_FRAME, type ServerMessage } from '../shared/protocol.js';
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
}

const rooms = new Map<string, Room>();

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
    if (room.engine.tick()) broadcast(room);
  }, Math.max(0, at - Date.now()));
  room.timer.unref?.();
}

function handleConnection(socket: WebSocket, routingCode: string | null): void {
  let joined: { room: Room; seat: number } | null = null;
  pending.set(socket, Date.now());

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

      // The engine, or nothing: the only I/O this adapter does to find one. In
      // production the same step is a read from Durable Object storage.
      const found = admit(rooms.get(hello.code)?.engine ?? null, hello);
      if (!found.ok) return fail(socket, found);

      let room = rooms.get(hello.code);
      if (!room) {
        room = { engine: found.engine, sockets: new Map(), emptySince: Date.now(), timer: null };
        rooms.set(hello.code, room);
      }

      const result = room.engine.join(hello.playerId, hello.name);
      if (!result.ok) return fail(socket, { kind: result.kind, error: result.error });

      // A second tab for the same player takes over the seat rather than
      // leaving a zombie socket on updates. 4000 tells that client the close
      // was deliberate, so it stops retrying.
      const previous = room.sockets.get(result.seat);
      if (previous && previous !== socket) previous.close(4000, 'Reconnected elsewhere');

      room.sockets.set(result.seat, socket);
      room.emptySince = null;
      joined = { room, seat: result.seat };
      pending.delete(socket);

      // The clock may have run out while the room sat empty, so settle it
      // before answering rather than welcoming a player into a game that is
      // over and does not know it.
      room.engine.tick();
      send(socket, {
        t: 'welcome',
        seat: result.seat,
        room: room.engine.viewFor(result.seat, connectedSeats(room)),
      });
      broadcast(room);
      return;
    }

    if (!joined) return fail(socket, { kind: 'rejected', error: 'Join a room first.' });
    const { room, seat } = joined;

    if (isAction(msg)) {
      const result = applyAction(room.engine, seat, msg);
      if (!result.ok) return fail(socket, { kind: 'rejected', error: result.error });
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

export function startServer(port: number = PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });
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
