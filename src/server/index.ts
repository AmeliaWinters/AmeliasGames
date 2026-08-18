import { WebSocketServer, WebSocket } from 'ws';
import { RoomEngine, isRoomCode } from '../shared/room.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

// Deliberately not PORT: dev launchers inject PORT for the web server, and we
// would collide with Vite.
const PORT = Number(process.env.GAME_PORT ?? 8787);
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;

interface Room {
  engine: RoomEngine;
  /** seat -> live socket. Absent means that player is away but keeps their seat. */
  sockets: Map<number, WebSocket>;
  emptySince: number | null;
}

const rooms = new Map<string, Room>();

function connectedSeats(room: Room): Set<number> {
  return new Set(room.sockets.keys());
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function broadcast(room: Room): void {
  const connected = connectedSeats(room);
  for (const [seat, socket] of room.sockets) {
    send(socket, { t: 'room', room: room.engine.viewFor(seat, connected) });
  }
}

function handleConnection(socket: WebSocket): void {
  let joined: { room: Room; seat: number } | null = null;

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return send(socket, { t: 'error', message: 'Malformed message.' });
    }

    if (msg.t === 'hello') {
      if (joined) return;

      const name = String(msg.name ?? '').trim().slice(0, 20) || 'Player';
      const playerId = String(msg.playerId ?? '');
      const code = String(msg.code ?? '').toUpperCase();
      if (!playerId) return send(socket, { t: 'error', message: 'Missing player id.' });
      if (!isRoomCode(code)) return send(socket, { t: 'error', message: 'Invalid room code.' });

      let room = rooms.get(code);
      if (!room) {
        if (!msg.create) return send(socket, { t: 'error', message: 'No room with that code.' });
        try {
          room = { engine: RoomEngine.create(code, msg.gameId), sockets: new Map(), emptySince: Date.now() };
        } catch {
          return send(socket, { t: 'error', message: 'Could not create that game.' });
        }
        rooms.set(code, room);
      }

      const result = room.engine.join(playerId, name);
      if (!result.ok) return send(socket, { t: 'error', message: result.error });

      // A second tab for the same player takes over the seat rather than
      // leaving a zombie socket receiving updates.
      const previous = room.sockets.get(result.seat);
      if (previous && previous !== socket) previous.close(4000, 'Reconnected elsewhere');

      room.sockets.set(result.seat, socket);
      room.emptySince = null;
      joined = { room, seat: result.seat };

      send(socket, { t: 'welcome', seat: result.seat, room: room.engine.viewFor(result.seat, connectedSeats(room)) });
      broadcast(room);
      return;
    }

    if (!joined) return send(socket, { t: 'error', message: 'Join a room first.' });
    const { room, seat } = joined;

    if (msg.t === 'move') {
      // The server runs the same reducer the client does, and its answer wins.
      const result = room.engine.move(seat, msg.move);
      if (!result.ok) return send(socket, { t: 'error', message: result.error });
      broadcast(room);
      return;
    }

    if (msg.t === 'rematch') {
      const result = room.engine.rematch();
      if (!result.ok) return send(socket, { t: 'error', message: result.error });
      broadcast(room);
      return;
    }
  });

  socket.on('close', () => {
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
  wss.on('connection', handleConnection);
  return wss;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) rooms.delete(code);
  }
}, 60_000).unref();

if (!process.env.VITEST) {
  startServer(PORT);
  console.log(`[server] listening on ws://localhost:${PORT}`);
}
