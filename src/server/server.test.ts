import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { startServer } from './index.js';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../shared/protocol.js';
import { isRoomCode, makeRoomCode } from '../shared/room.js';
import { ALPHABET, BLANK, PUZZLES } from '../shared/games/wheel.js';

/** A well-formed hello, so a test only has to say what it is varying. */
function hello(over: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}): ClientMessage {
  return {
    t: 'hello',
    v: PROTOCOL_VERSION,
    playerId: `p-${Math.random()}`,
    name: 'Player',
    code: makeRoomCode(),
    create: false,
    gameId: 'connect4',
    ...over,
  };
}

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

  /** Bypasses the type system entirely — the point is what a hostile client sends. */
  sendRaw(text: string): void {
    this.socket.send(text);
  }

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
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

  /** Everything received so far, queued or not — for tests that inspect frames. */
  received(): ServerMessage[] {
    return this.inbox.slice();
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
  host.send(hello({ name: 'Host', code, create: true }));
  const welcome = await host.nextOf('welcome');
  expect(welcome.room.code).toBe(code);
  // Drop the solo-host broadcast so the next 'room' a test sees is the join.
  host.drain();

  const guest = await TestClient.connect();
  guest.send(hello({ name: 'Guest', code }));
  await guest.nextOf('welcome');

  return { host, guest, code, hostSeat: welcome.seat };
}

describe('room lifecycle', () => {
  it('seats the creator at 0 and the joiner at 1', async () => {
    const { host, guest, code } = await seatTwoPlayers();
    expect(isRoomCode(code)).toBe(true);
    const room = (await host.nextOf('room')).room;
    expect(room.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
    expect(room.waiting).toBe(false);
    host.close();
    guest.close();
  });

  it('rejects an unknown room code', async () => {
    const client = await TestClient.connect();
    client.send(hello({ playerId: 'x', name: 'X', code: 'ZZZZ' }));
    const msg = await client.next();
    expect(msg.t).toBe('error');
    expect(msg.t === 'error' && msg.message).toMatch(/no room/i);
    client.close();
  });

  it('refuses a third player', async () => {
    const { host, guest, code } = await seatTwoPlayers();
    const third = await TestClient.connect();
    third.send(hello({ playerId: 'third', name: 'Third', code }));
    const msg = await third.nextOf('error');
    expect(msg.message).toMatch(/full/i);
    host.close();
    guest.close();
    third.close();
  });

  it('gives a reconnecting player their original seat back', async () => {
    const code = makeRoomCode();
    const host = await TestClient.connect();
    host.send(hello({ playerId: 'stable-id', name: 'Host', code, create: true }));
    const first = await host.nextOf('welcome');
    host.close();

    const again = await TestClient.connect();
    again.send(hello({ playerId: 'stable-id', name: 'Host', code }));
    const second = await again.nextOf('welcome');
    expect(second.seat).toBe(first.seat);
    expect(second.room.code).toBe(first.room.code);
    again.close();
  });

  it('refuses to join a code that was never created', async () => {
    const client = await TestClient.connect();
    client.send(hello({ playerId: 'y', name: 'Y' }));
    expect((await client.nextOf('error')).message).toMatch(/no room/i);
    client.close();
  });

  it('rejects a malformed room code', async () => {
    const client = await TestClient.connect();
    client.send(hello({ playerId: 'z', name: 'Z', code: 'nope!', create: true }));
    expect((await client.nextOf('error')).message).toMatch(/invalid room code/i);
    client.close();
  });
});

describe('hostile input', () => {
  it('survives a payload that parses to null', async () => {
    // JSON.parse('null') succeeds, and reading .t off the result throws. `ws`
    // does not trap listener exceptions, so this used to reach
    // uncaughtException and take every room on the server down with it.
    const client = await TestClient.connect();
    client.sendRaw('null');
    expect((await client.nextOf('error')).message).toMatch(/malformed/i);

    // The process — and everyone else's game — is still here.
    const { host, guest } = await seatTwoPlayers();
    expect(host.open).toBe(true);
    client.close();
    host.close();
    guest.close();
  });

  it('survives payloads that parse to other non-objects', async () => {
    const client = await TestClient.connect();
    for (const raw of ['42', '"hello"', 'true', '[]']) {
      client.sendRaw(raw);
      expect((await client.nextOf('error')).message).toMatch(/malformed|join a room/i);
    }
    client.close();
  });

  it('turns away a client built against a different protocol version', async () => {
    const client = await TestClient.connect();
    client.send(hello({ v: PROTOCOL_VERSION + 1, create: true }));
    const msg = await client.nextOf('error');
    expect(msg.kind).toBe('protocol');
    expect(msg.message).toMatch(/refresh/i);
    client.close();
  });

  it('refuses to create over a room that is already being played', async () => {
    // Codes are picked by the client. A collision used to seat the "creator"
    // silently as player two of a stranger's game.
    const { host, guest, code } = await seatTwoPlayers();
    const collider = await TestClient.connect();
    collider.send(hello({ playerId: 'collider', code, create: true }));
    const msg = await collider.nextOf('error');
    expect(msg.message).toMatch(/already in use/i);
    collider.close();
    host.close();
    guest.close();
  });

  it('lets the host re-send a create-flagged hello for their own room', async () => {
    // A retry, or a remount in development, sends create twice. Treating that
    // as a collision locked the host out of the room they had just made.
    const code = makeRoomCode();
    const first = await TestClient.connect();
    first.send(hello({ playerId: 'owner', code, create: true }));
    await first.nextOf('welcome');
    first.close();

    const again = await TestClient.connect();
    again.send(hello({ playerId: 'owner', code, create: true }));
    const welcome = await again.nextOf('welcome');
    expect(welcome.seat).toBe(0);
    again.close();
  });

  it('refuses to join a room that is playing a different game', async () => {
    const { host, guest, code } = await seatTwoPlayers();
    const confused = await TestClient.connect();
    confused.send(hello({ playerId: 'confused', code, gameId: 'backgammon' }));
    expect((await confused.nextOf('error')).message).toMatch(/connect four/i);
    confused.close();
    host.close();
    guest.close();
  });

  it('refuses to create a game that does not exist', async () => {
    const client = await TestClient.connect();
    client.send(hello({ gameId: 'chess', create: true }));
    expect((await client.nextOf('error')).message).toMatch(/could not create/i);
    client.close();
  });

  it('tells a rejected client why, not just that', async () => {
    const client = await TestClient.connect();
    client.send(hello({ playerId: 'kinds' }));
    expect((await client.nextOf('error')).kind).toBe('no-room');
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

describe('hidden state over the wire', () => {
  /**
   * The reducer's `view()` is unit-tested, but the property that actually
   * matters is end-to-end: nothing a real socket receives ever carries an
   * unmasked answer. A refactor that broadcast `engine.snapshot()` or hoisted
   * one shared payload out of the per-seat loop would pass every `view()` test
   * and still deal both players the answer. So this reads the frames.
   */
  it('never sends an unmasked puzzle answer to either player', async () => {
    const code = makeRoomCode();
    const host = await TestClient.connect();
    host.send(hello({ name: 'Host', code, create: true, gameId: 'wheel' }));
    await host.nextOf('welcome');
    const guest = await TestClient.connect();
    guest.send(hello({ name: 'Guest', code, gameId: 'wheel' }));
    await guest.nextOf('welcome');

    // Drive the board hard from both seats: spin, call every letter, and try
    // to buy vowels. Whatever the rng drew, the round gets played out.
    for (const letter of ALPHABET) {
      host.send({ t: 'move', move: { type: 'spin' } });
      host.send({ t: 'move', move: { type: 'letter', letter } });
      guest.send({ t: 'move', move: { type: 'spin' } });
      guest.send({ t: 'move', move: { type: 'letter', letter } });
    }
    await new Promise((r) => setTimeout(r, 150));

    // Everything either socket received, including frames still queued.
    const wire = [host.received(), guest.received()].flat().map((m) => JSON.stringify(m));
    expect(wire.length).toBeGreaterThan(0);
    const joined = wire.join('\n');

    // Checked against the whole bank rather than the drawn puzzle, so the test
    // needs no knowledge of which one the rng picked. An answer may legitimately
    // appear once its round is over, so only frames whose room is mid-round
    // count -- which is exactly the leak worth catching.
    const live = wire.filter((f) => !f.includes('"roundOver":true'));
    const leaked = PUZZLES.filter((p) => live.some((f) => f.includes(p.answer))).map(
      (p) => p.answer,
    );
    expect(leaked).toEqual([]);
    // Sanity: the masked board really did reach the players, so an empty
    // `leaked` means "no answer sent", not "no frames inspected".
    expect(joined).toContain(BLANK);

    host.close();
    guest.close();
  });
});
