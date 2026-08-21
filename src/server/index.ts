import { WebSocketServer, WebSocket } from 'ws';
import { RoomEngine, isRoomCode } from '../shared/room.js';
import { getGame } from '../shared/games/index.js';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorKind,
  type ServerMessage,
} from '../shared/protocol.js';

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
}

const rooms = new Map<string, Room>();

/**
 * Sockets that have connected but not yet said hello, with the time they
 * arrived. The worker evicts these on its alarm; without the same sweep here a
 * socket that opens and stays silent is never cleaned up, because `close` never
 * fires for a connection nobody is using.
 */
const pending = new Map<WebSocket, number>();

function connectedSeats(room: Room): Set<number> {
  return new Set(room.sockets.keys());
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function fail(socket: WebSocket, kind: ErrorKind, message: string): void {
  send(socket, { t: 'error', kind, message });
}

function broadcast(room: Room): void {
  const connected = connectedSeats(room);
  for (const [seat, socket] of room.sockets) {
    send(socket, { t: 'room', room: room.engine.viewFor(seat, connected) });
  }
}

function handleConnection(socket: WebSocket): void {
  let joined: { room: Room; seat: number } | null = null;
  pending.set(socket, Date.now());

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return fail(socket, 'protocol', 'Malformed message.');
    }
    // JSON.parse of the four bytes `null` succeeds and yields null, and
    // reading `.t` off that throws — which `ws` does not trap, so it would
    // reach uncaughtException and take every room on this server with it.
    if (typeof msg !== 'object' || msg === null) {
      return fail(socket, 'protocol', 'Malformed message.');
    }

    if (msg.t === 'hello') {
      if (joined) return;

      if (msg.v !== PROTOCOL_VERSION) {
        return fail(socket, 'protocol', 'This page is out of date — please refresh.');
      }

      const name = String(msg.name ?? '').trim().slice(0, 20) || 'Player';
      const playerId = String(msg.playerId ?? '');
      const code = String(msg.code ?? '').toUpperCase();
      const gameId = String(msg.gameId ?? '');
      if (!playerId) return fail(socket, 'protocol', 'Missing player id.');
      if (!isRoomCode(code)) return fail(socket, 'protocol', 'Invalid room code.');

      let room = rooms.get(code);
      if (!room) {
        if (!msg.create) return fail(socket, 'no-room', 'No room with that code.');
        if (!getGame(gameId)) return fail(socket, 'rejected', 'Could not create that game.');
        // Only the creating client's request is honoured; the room's size is
        // settled before anyone else can ask for a different one.
        const engine = RoomEngine.create(code, gameId, undefined, msg.players);
        if (!engine) return fail(socket, 'rejected', 'Could not create that game.');
        room = { engine, sockets: new Map(), emptySince: Date.now() };
        rooms.set(code, room);
      } else {
        // Starting a "new" game on a code that is already someone else's room
        // would silently seat you as player two of their game. A room this
        // player already has a seat in is not someone else's — a create-flagged
        // hello arriving twice is ordinary, and refusing it would lock the host
        // out of the room they just made.
        const mine = room.engine.seatOf(playerId) !== -1;
        if (msg.create && !room.engine.isFresh() && !mine) {
          return fail(socket, 'full', 'That code is already in use. Try starting again.');
        }
        if (gameId && gameId !== room.engine.def.id) {
          return fail(socket, 'rejected', `That room is playing ${room.engine.def.name}.`);
        }
      }

      const result = room.engine.join(playerId, name);
      if (!result.ok) return fail(socket, 'full', result.error);

      // A second tab for the same player takes over the seat rather than
      // leaving a zombie socket receiving updates. 4000 tells that client the
      // close was deliberate so it stops retrying.
      const previous = room.sockets.get(result.seat);
      if (previous && previous !== socket) previous.close(4000, 'Reconnected elsewhere');

      room.sockets.set(result.seat, socket);
      room.emptySince = null;
      joined = { room, seat: result.seat };
      pending.delete(socket);

      send(socket, {
        t: 'welcome',
        seat: result.seat,
        room: room.engine.viewFor(result.seat, connectedSeats(room)),
      });
      broadcast(room);
      return;
    }

    if (!joined) return fail(socket, 'rejected', 'Join a room first.');
    const { room, seat } = joined;

    if (msg.t === 'move' || msg.t === 'rematch' || msg.t === 'switch') {
      // The server runs the same reducer the client does, and its answer wins.
      // A reducer is not supposed to throw, but an exception escaping a `ws`
      // message handler is an uncaught exception, which is fatal to the
      // process and to every other room in it.
      let result;
      try {
        result =
          msg.t === 'move'
            ? room.engine.move(seat, msg.move)
            : msg.t === 'switch'
              ? room.engine.switchGame(String(msg.gameId ?? ''))
              : room.engine.rematch();
      } catch {
        return fail(socket, 'rejected', 'That move could not be played.');
      }
      if (!result.ok) return fail(socket, 'rejected', result.error);
      broadcast(room);
      return;
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
  // stated as an invariant, and an adapter that only enforces it in one place
  // is where the two drift apart.
  wss.on('connection', (socket, request) => {
    const code = (new URL(request.url ?? '/', 'http://localhost').searchParams.get('code') ?? '')
      .toUpperCase();
    if (code && !isRoomCode(code)) {
      socket.close(4003, 'Invalid room code');
      return;
    }
    handleConnection(socket);
  });
  return wss;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) rooms.delete(code);
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
