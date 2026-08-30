import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';
import { startServer } from './index.js';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../shared/protocol.js';
import { isRoomCode, makeRoomCode } from '../shared/room.js';
import { ALPHABET, BLANK, PUZZLES } from '../shared/games/wheel.js';
import { accountIdFor, fromBase64Url, payloadFor, toBase64Url } from '../shared/account.js';

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

/** A raw protocol client, deliberately bypassing the UI like a cheater would. */
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

  /** Bypasses the type system entirely: the point is what a hostile client sends. */
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

  /** Everything received so far, queued or not, for tests that inspect frames. */
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

    // The process, and everyone else's game, is still here.
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
    // Guest is seat 1; seat 0 is to play. The UI would disable this, and the
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
    // turn. Every frame is read from the host, who is sent every broadcast;
    // reading each mover's own copy would shift whichever stale frame was
    // still queued on that socket instead.
    let room = started; // the room as dealt
    for (const col of [0, 1, 0, 1, 0, 1, 0]) {
      (col === 0 ? host : guest).send({ t: 'move', move: { type: 'drop', col } });
      room = (await host.nextOf('room')).room;
    }
    expect(room.over).toBe(true);

    host.send({ t: 'switch', gameId: 'yahtzee' });

    // Both sides are told, not just the one who asked. The other player's
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

/**
 * Accounts, end to end over a real socket.
 *
 * The whole path in one place: a real keypair signs a real claim, the server
 * verifies it, a real game is played out, and the profile that comes back is
 * the one the room filed. The unit tests cover each half; this is the only
 * thing that proves they are wired to each other.
 */
describe('signing in', () => {
  const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
  const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

  /** A keypair, and the claim it makes for a room. What the client does. */
  async function account() {
    const generated = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  // Narrowed structurally rather than named. `@cloudflare/workers-types` types
  // `generateKey` as `CryptoKey | CryptoKeyPair` (for an asymmetric algorithm
  // it is always the pair, and the union is the type not knowing that), while
  // the shared config's lib has no `CryptoKeyPair` to name at all. This
  // compiles under both.
  const pair = generated as Extract<typeof generated, { privateKey: unknown }>;
    const key = toBase64Url(new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer));
    const id = await accountIdFor(fromBase64Url(key));
    return {
      id,
      async claim(code: string) {
        const sig = await crypto.subtle.sign(SIGNING, pair.privateKey, payloadFor(id, code));
        return { id, key, sig: toBase64Url(sig) };
      },
    };
  }

  /** Seat a signed-in host and a guest, deal connect4, and play it out. */
  async function playAGame(who: { claim(code: string): Promise<unknown> }, code = makeRoomCode()) {
    const host = await TestClient.connect();
    host.send(hello({ name: 'Host', code, create: true, account: await who.claim(code) }));
    await host.nextOf('welcome');

    const guest = await TestClient.connect();
    guest.send(hello({ name: 'Guest', code }));
    await guest.nextOf('welcome');

    host.send({ t: 'start' });
    await host.nextOf('room');
    host.drain();

    // Four in the first column against three in the second: seat 0 wins.
    for (let i = 0; i < 4; i++) {
      host.send({ t: 'move', move: { type: 'drop', col: 0 } });
      if (i < 3) guest.send({ t: 'move', move: { type: 'drop', col: 1 } });
      await new Promise((r) => setTimeout(r, 20));
    }
    return { host, guest, code };
  }

  it('takes a signed claim and files the game against it', async () => {
    const who = await account();
    const { host, guest } = await playAGame(who);

    const profile = await host.nextOf('profile');
    expect(profile.profile.id).toBe(who.id);
    // Connect Four teaches no vocabulary, so it earns **no experience at
    // all**, and the game is still recorded. That is the per-language split
    // showing its consequence rather than a regression: experience is a claim
    // about one language now, the flat per-game payment goes to the language a
    // game taught in, and this game taught in none. A night of Connect Four
    // shows up in the games panel, which is where a night of Connect Four is
    // supposed to show up. See `Profile.xp`.
    expect(profile.profile.byLang).toEqual([]);
    expect(profile.profile.words).toBe(0);
    expect(profile.profile.games.find((g) => g.gameId === 'connect4')?.played).toBe(1);

    host.close();
    guest.close();
  });

  /**
   * The `vocab` message, from the outside.
   *
   * The reducer that fills the ledger is well covered; this is the plumbing
   * around it, which is where the two adapters can drift apart. What is being
   * pinned is that a message with no account id on it can only ever answer for
   * the socket that proved one, and that nothing a hostile client can put in
   * `lang` reaches the store.
   */
  describe('asking for the words', () => {
    it('says nothing at all to a socket that never proved an account', async () => {
      const code = makeRoomCode();
      const guest = await TestClient.connect();
      guest.send(hello({ name: 'Guest', code, create: true }));
      await guest.nextOf('welcome');
      guest.drain();

      // Silence rather than an error, exactly like `profile`: there is no id
      // on the wire to refuse, so there is nothing to say.
      guest.send({ t: 'vocab', lang: 'pl' });
      await expect(guest.nextOf('vocab')).rejects.toThrow();
      guest.close();
    });

    it('says nothing before a room, rather than falling through to the join error', async () => {
      const alone = await TestClient.connect();
      // Answered above the `joined` guard on purpose, so this must not come
      // back as 'Join a room first.' -- the worker answers it without a room
      // at all, and the two adapters have to agree.
      alone.send({ t: 'vocab', lang: 'pl' });
      await expect(alone.nextOf('vocab')).rejects.toThrow();
      alone.close();
    });

    it('refuses a language that is not one, whatever shape it arrives in', async () => {
      const who = await account();
      const { host, guest } = await playAGame(who);
      await host.nextOf('profile');
      host.drain();

      // The values a hostile client would actually try: a path, a number, an
      // object, and a language this app does not teach. None may reach
      // `vocabOf`, and none may throw and take the socket down with it.
      for (const lang of ['../', 'EN', 7, null, {}, ['pl'], 'de']) {
        host.send({ t: 'vocab', lang } as unknown as ClientMessage);
      }
      // A `profile` behind them, and the assertion is that it is the *very
      // next* frame back. That says both halves at once: none of the seven
      // produced a `vocab`, and the socket is still alive and still answering,
      // which a throw on the way to `vocabOf` would have taken out.
      host.send({ t: 'profile' });
      const next = await host.next();
      expect(next.t).toBe('profile');
      expect((next as Extract<ServerMessage, { t: 'profile' }>).profile.id).toBe(who.id);

      host.close();
      guest.close();
    });

    it('answers the account that asked, and echoes the language back', async () => {
      const who = await account();
      const { host, guest } = await playAGame(who);
      await host.nextOf('profile');
      host.drain();

      host.send({ t: 'vocab', lang: 'pl' });
      const answer = await host.nextOf('vocab');
      // Echoed rather than assumed: two requests in flight must not be drawn
      // under each other's heading. Connect Four teaches nothing, so the list
      // is empty and that is the point -- the shape is what is being pinned.
      expect(answer.lang).toBe('pl');
      expect(Array.isArray(answer.words)).toBe(true);

      host.close();
      guest.close();
    });
  });

  /**
   * The failure mode that matters most, because it is the one nobody would
   * notice: an account that is not proved must not stop somebody playing.
   */
  it('seats a forged claim as a guest, and lets them play anyway', async () => {
    const mine = await account();
    const theirs = await account();
    const code = makeRoomCode();
    // A real signature from a real key, claiming somebody else's id.
    const forged = { ...(await mine.claim(code)), id: theirs.id };

    const host = await TestClient.connect();
    host.send(hello({ name: 'Host', code, create: true, account: forged }));
    const welcome = await host.nextOf('welcome');
    expect(welcome.seat).toBe(0);

    // Seated, playing, and simply not signed in: asking for a profile is
    // answered with silence rather than with somebody else's.
    host.drain();
    host.send({ t: 'profile' });
    await expect(host.nextOf('profile')).rejects.toThrow();
    host.close();
  });

  it('remembers a profile across two separate rooms', async () => {
    const who = await account();
    const first = await playAGame(who);
    const one = await first.host.nextOf('profile');
    first.host.close();
    first.guest.close();

    const second = await playAGame(who);
    const two = await second.host.nextOf('profile');
    // The tally is what carries across two rooms for a game with no words in
    // it. It was the experience total before the split, and the assertion had
    // to move rather than be dropped: the point of the test is that the *same
    // account* was found again, and a second game recorded against it proves
    // that as well as a rising number did.
    expect(two.profile.games.find((g) => g.gameId === 'connect4')?.played).toBe(2);
    expect(one.profile.games.find((g) => g.gameId === 'connect4')?.played).toBe(1);
    second.host.close();
    second.guest.close();
  });

  it('answers a profile request from a signed-in socket', async () => {
    const who = await account();
    const code = makeRoomCode();
    const host = await TestClient.connect();
    host.send(hello({ name: 'Host', code, create: true, account: await who.claim(code) }));
    await host.nextOf('welcome');

    // Sent unasked-for on being welcomed, so the lobby has its "words due"
    // before anybody presses anything.
    const pushed = await host.nextOf('profile');
    expect(pushed.profile.id).toBe(who.id);

    host.drain();
    host.send({ t: 'profile' });
    expect((await host.nextOf('profile')).profile.id).toBe(who.id);
    host.close();
  });

  it('lets a room of guests play exactly as it always has', async () => {
    // The promise on the tin: "no accounts". A room where nobody has one must
    // behave identically, and must never be sent a profile message.
    const code = makeRoomCode();
    const host = await TestClient.connect();
    host.send(hello({ name: 'Host', code, create: true }));
    await host.nextOf('welcome');
    host.drain();
    host.send({ t: 'profile' });
    await expect(host.nextOf('profile')).rejects.toThrow();
    host.close();
  });
});
