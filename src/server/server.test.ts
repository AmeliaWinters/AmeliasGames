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

  // A room now gathers first and is dealt second, so nothing can be played
  // until the host says everyone is here. Everything from the gathering phase
  // is dropped, so a test sees only what follows the deal.
  host.drain();
  guest.drain();
  host.send({ t: 'start' });
  // Loop rather than take the next one: a broadcast from the guest sitting
  // down can still be in flight, and it is the dealt room we are waiting for.
  const startedRoom = async (client: TestClient) => {
    for (let i = 0; i < 12; i++) {
      const room = (await client.nextOf('room')).room;
      if (!room.waiting) return room;
    }
    throw new Error('the room never started');
  };
  const started = await startedRoom(host);
  await startedRoom(guest);

  return { host, guest, code, hostSeat: welcome.seat, started };
}

describe('room lifecycle', () => {
  it('seats the creator at 0 and the joiner at 1', async () => {
    const { host, guest, code, started } = await seatTwoPlayers();
    expect(isRoomCode(code)).toBe(true);
    expect(started.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
    expect(started.waiting).toBe(false);
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

  it('refuses a third player once the game has been dealt', async () => {
    const { host, guest, code } = await seatTwoPlayers();
    const third = await TestClient.connect();
    third.send(hello({ playerId: 'third', name: 'Third', code }));
    const msg = await third.nextOf('error');
    // Seating them anyway would hand the reducer a seat its arrays were never
    // sized for, and every move in the room would fail from then on.
    expect(msg.message).toMatch(/already started/i);
    host.close();
    guest.close();
    third.close();
  });

  it('refuses a third player at a game that only seats two', async () => {
    // Before the deal the answer is different, and so is the reason: Connect
    // Four seats two, and no amount of waiting changes that.
    const code = makeRoomCode();
    const host = await TestClient.connect();
    host.send(hello({ name: 'Host', code, create: true }));
    await host.nextOf('welcome');
    const guest = await TestClient.connect();
    guest.send(hello({ name: 'Guest', code }));
    await guest.nextOf('welcome');

    const third = await TestClient.connect();
    third.send(hello({ playerId: 'third', name: 'Third', code }));
    expect((await third.nextOf('error')).message).toMatch(/full/i);
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
    // Quoted back, so a code mangled by a chat app is recognisable as the
    // player's own -- see `named` in `refusal.ts` for what that quoting is
    // allowed to include.
    expect((await client.nextOf('error')).message).toMatch(/"nope!" is not a room code/i);
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
    expect(msg.message).toMatch(new RegExp(`Room ${code} is already someone else's game`, 'i'));
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
    expect((await client.nextOf('error')).message).toMatch(/no game called "chess"/i);
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
    // The number comes back unquoted: a refusal that names what it refused is
    // the point, and quoting a number implies it might not have been one.
    expect(msg.message).toMatch(/There is no column 99/i);
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

  it('changes the game for both players once one is over', async () => {
    const { host, guest, started } = await seatTwoPlayers();
    // Seat 0 takes column 0 four times over; seat 1 answers in column 1. One
    // move at a time: two sockets sending at once arrive in whichever order
    // the loopback feels like, and half of them would be rejected as out of
    // turn. Every frame is read from the host, who is sent every broadcast —
    // reading each mover's own copy would shift whichever stale frame was
    // still queued on that socket instead.
    let room = started; // the room as dealt
    for (const col of [0, 1, 0, 1, 0, 1, 0]) {
      (col === 0 ? host : guest).send({ t: 'move', move: { type: 'drop', col } });
      room = (await host.nextOf('room')).room;
    }
    expect(room.over).toBe(true);

    host.send({ t: 'switch', gameId: 'yahtzee' });

    // Both sides are told, not just the one who asked — the other player's
    // board has to change at the same moment, or they are left looking at a
    // game nobody is playing.
    for (const client of [host, guest]) {
      let next = (await client.nextOf('room')).room;
      // The guest's queue still holds every Connect Four frame it was sent.
      for (let i = 0; i < 12 && next.gameId !== 'yahtzee'; i++) {
        next = (await client.nextOf('room')).room;
      }
      expect(next.gameId).toBe('yahtzee');
      expect(next.gameName).toBe('Yahtzee');
      expect(next.over).toBe(false);
      expect(next.waiting).toBe(false);
      expect(next.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
    }
    host.close();
    guest.close();
  });

  it('refuses to change game while the current one is still running', async () => {
    const { host, guest } = await seatTwoPlayers();
    host.send({ t: 'switch', gameId: 'yahtzee' });
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
    // Nothing to redact until there is a game: the room has to be dealt first.
    host.send({ t: 'start' });
    await guest.nextOf('room');

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

describe('the heartbeat', () => {
  it('answers a ping from a socket that has not joined anything', async () => {
    // Deliberately before hello: the whole point of the heartbeat is to tell a
    // live socket from a dead one, and a socket is worth that question from the
    // moment it opens -- including while it sits waiting to be seated.
    const client = await TestClient.connect();
    client.send({ t: 'ping' });
    expect((await client.next()).t).toBe('pong');
    client.close();
  });

  it('answers a ping without disturbing the game in progress', async () => {
    const { host, guest } = await seatTwoPlayers();
    host.drain();
    host.send({ t: 'ping' });
    // nextOf rather than next: a broadcast from the guest sitting down may
    // still be in flight, and the heartbeat does not promise to jump the queue.
    expect((await host.nextOf('pong')).t).toBe('pong');

    // The pong must not have cost the pinger their seat or their game: a move
    // still lands, and the opponent still hears about it.
    guest.drain();
    host.send({ t: 'move', move: { type: 'drop', col: 0 } });
    const room = (await guest.nextOf('room')).room;
    expect(room.players.map((p) => p.name)).toEqual(['Host', 'Guest']);
    host.close();
    guest.close();
  });

  it('does not mistake a ping for a move', async () => {
    // A ping arrives on the same socket as everything else, so a handler that
    // fell through to the move path would hand the reducer `undefined`.
    const { host, guest } = await seatTwoPlayers();
    host.drain();
    host.send({ t: 'ping' });
    const first = await host.nextOf('pong');
    expect(first.t).toBe('pong');
    expect(host.received().every((m) => m.t !== 'error')).toBe(true);
    host.close();
    guest.close();
  });
});
