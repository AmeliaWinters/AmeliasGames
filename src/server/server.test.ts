import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { startServer } from './index.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';
import { makeRoomCode } from '../shared/room.js';

const PORT = 8899;
let wss: WebSocketServer;

beforeAll(() => {
  wss = startServer(PORT);
});
afterAll(async () => {
  for (const client of wss.clients) client.terminate();
  await new Promise<void>((r) => wss.close(() => r()));
});

/** A raw protocol client — deliberately bypasses the UI, like a cheater would. */
class TestClient {
  private socket: WebSocket;
  private inbox: ServerMessage[] = [];
  private waiters: Array<(m: ServerMessage) => void> = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(msg);
      else this.inbox.push(msg);
    });
  }

  static async connect(): Promise<TestClient> {
    const socket = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((res, rej) => {
      socket.once('open', res);
      socket.once('error', rej);
    });
    return new TestClient(socket);
  }

  send(msg: ClientMessage): void {
    this.socket.send(JSON.stringify(msg));
  }

  next(timeoutMs = 1500): Promise<ServerMessage> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('timed out waiting for a message')), timeoutMs);
      this.waiters.push((m) => {
        clearTimeout(timer);
        res(m);
      });
    });
  }

  /** Skip ahead to the next message of a given type. */
  async nextOf<T extends ServerMessage['t']>(t: T): Promise<Extract<ServerMessage, { t: T }>> {
    for (let i = 0; i < 12; i++) {
      const msg = await this.next();
      if (msg.t === t) return msg as Extract<ServerMessage, { t: T }>;
    }
    throw new Error(`never received a ${t} message`);
  }

  /** Discard queued messages so the next assertion sees only what follows. */
  drain(): void {
    this.inbox.length = 0;
  }

  close(): void {
    this.socket.close();
  }
}

async function seatTwoPlayers() {
  const code = makeRoomCode();
  const host = await TestClient.connect();
  host.send({ t: 'hello', playerId: `host-${Math.random()}`, name: 'Host', code, create: true, gameId: 'connect4' });
  const welcome = await host.nextOf('welcome');
  expect(welcome.room.code).toBe(code);
  // Drop the solo-host broadcast so the next 'room' a test sees is the join.
  host.drain();

  const guest = await TestClient.connect();
  guest.send({ t: 'hello', playerId: `guest-${Math.random()}`, name: 'Guest', code, create: false, gameId: 'connect4' });
  await guest.nextOf('welcome');

  return { host, guest, code, hostSeat: welcome.seat };
}

describe('room lifecycle', () => {
  it('seats the creator at 0 and the joiner at 1', async () => {
    const { host, guest, code } = await seatTwoPlayers();
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    const room = (await host.nextOf('room')).room;
    expect(room.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
    expect(room.waiting).toBe(false);
    host.close();
    guest.close();
  });

  it('rejects an unknown room code', async () => {
    const client = await TestClient.connect();
    client.send({ t: 'hello', playerId: 'x', name: 'X', code: 'ZZZZ', create: false, gameId: 'connect4' });
    const msg = await client.next();
    expect(msg.t).toBe('error');
    expect(msg.t === 'error' && msg.message).toMatch(/no room/i);
    client.close();
  });

  it('refuses a third player', async () => {
    const { host, guest, code } = await seatTwoPlayers();
    const third = await TestClient.connect();
    third.send({ t: 'hello', playerId: 'third', name: 'Third', code, create: false, gameId: 'connect4' });
    const msg = await third.nextOf('error');
    expect(msg.message).toMatch(/full/i);
    host.close();
    guest.close();
    third.close();
  });

  it('gives a reconnecting player their original seat back', async () => {
    const code = makeRoomCode();
    const host = await TestClient.connect();
    host.send({ t: 'hello', playerId: 'stable-id', name: 'Host', code, create: true, gameId: 'connect4' });
    const first = await host.nextOf('welcome');
    host.close();

    const again = await TestClient.connect();
    again.send({ t: 'hello', playerId: 'stable-id', name: 'Host', code, create: false, gameId: 'connect4' });
    const second = await again.nextOf('welcome');
    expect(second.seat).toBe(first.seat);
    expect(second.room.code).toBe(first.room.code);
    again.close();
  });

  it('refuses to join a code that was never created', async () => {
    const client = await TestClient.connect();
    client.send({ t: 'hello', playerId: 'y', name: 'Y', code: makeRoomCode(), create: false, gameId: 'connect4' });
    expect((await client.nextOf('error')).message).toMatch(/no room/i);
    client.close();
  });

  it('rejects a malformed room code', async () => {
    const client = await TestClient.connect();
    client.send({ t: 'hello', playerId: 'z', name: 'Z', code: 'nope!', create: true, gameId: 'connect4' });
    expect((await client.nextOf('error')).message).toMatch(/invalid room code/i);
    client.close();
  });
});

describe('server authority', () => {
  it('rejects a move sent out of turn by a hand-rolled client', async () => {
    const { host, guest } = await seatTwoPlayers();
    // Guest is seat 1; seat 0 is to play. The UI would disable this — the
    // server must refuse it anyway.
    guest.send({ t: 'move', move: { type: 'drop', col: 0 } });
    const msg = await guest.nextOf('error');
    expect(msg.message).toMatch(/not your turn/i);
    host.close();
    guest.close();
  });

  it('rejects an out-of-range column', async () => {
    const { host, guest } = await seatTwoPlayers();
    host.send({ t: 'move', move: { type: 'drop', col: 99 } });
    const msg = await host.nextOf('error');
    expect(msg.message).toMatch(/does not exist/i);
    host.close();
    guest.close();
  });

  it('rejects a malformed move without crashing the room', async () => {
    const { host, guest } = await seatTwoPlayers();
    host.send({ t: 'move', move: { type: 'teleport' } });
    expect((await host.nextOf('error')).message).toMatch(/unknown move/i);

    // The room still works afterwards.
    host.drain();
    host.send({ t: 'move', move: { type: 'drop', col: 3 } });
    const room = (await host.nextOf('room')).room;
    expect(room.turn).toBe(1);
    host.close();
    guest.close();
  });

  it('broadcasts an accepted move to the other player', async () => {
    const { host, guest } = await seatTwoPlayers();
    guest.drain(); // discard the "player joined" broadcast
    host.send({ t: 'move', move: { type: 'drop', col: 3 } });
    const room = (await guest.nextOf('room')).room;
    const state = room.state as { board: Array<Array<number | null>>; moveCount: number };
    expect(state.moveCount).toBe(1);
    expect(state.board[5][3]).toBe(0);
    expect(room.turn).toBe(1);
    host.close();
    guest.close();
  });

  it('refuses a rematch while the game is still running', async () => {
    const { host, guest } = await seatTwoPlayers();
    host.send({ t: 'rematch' });
    expect((await host.nextOf('error')).message).toMatch(/in progress/i);
    host.close();
    guest.close();
  });

  it('ignores moves from a socket that never joined', async () => {
    const stranger = await TestClient.connect();
    stranger.send({ t: 'move', move: { type: 'drop', col: 0 } });
    expect((await stranger.nextOf('error')).message).toMatch(/join a room first/i);
    stranger.close();
  });
});
