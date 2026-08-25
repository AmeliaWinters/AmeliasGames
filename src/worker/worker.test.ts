import { describe, it, expect } from 'vitest';
import { GameRoom, type Env } from './index.js';
import type { HarvestPost } from '../shared/players.js';
import { accountIdFor, fromBase64Url, payloadFor, toBase64Url } from '../shared/account.js';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../shared/protocol.js';

/**
 * The Durable Object, exercised without workerd.
 *
 * These fakes stand in for the three things the room actually depends on:
 * storage that survives the instance, per-socket attachments that survive
 * hibernation, and `getWebSockets()`. `fetch()` is the one method not covered
 * here, because it needs WebSocketPair. Everything it sets up is passed in
 * explicitly instead.
 *
 * Hibernation is the thing worth simulating: it destroys the instance while
 * the sockets stay alive, so a player who joined perfectly legitimately comes
 * back to a room object that has never heard of them.
 */

interface Attachment {
  playerId: string;
  seat: number;
  since: number;
}

class FakeSocket {
  readonly sent: ServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;
  private attachment: Attachment | null = null;

  constructor(private readonly room: FakeState, since = Date.now()) {
    this.attachment = { playerId: '', seat: -1, since };
    room.sockets.push(this as unknown as WebSocket);
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.room.sockets = this.room.sockets.filter((s) => s !== (this as unknown as WebSocket));
  }

  serializeAttachment(value: Attachment): void {
    this.attachment = structuredClone(value);
  }

  deserializeAttachment(): Attachment | null {
    return this.attachment ? structuredClone(this.attachment) : null;
  }

  /** Messages of one type, in order. */
  of<T extends ServerMessage['t']>(t: T): Array<Extract<ServerMessage, { t: T }>> {
    return this.sent.filter((m) => m.t === t) as Array<Extract<ServerMessage, { t: T }>>;
  }

  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> {
    const all = this.of(t);
    if (all.length === 0) throw new Error(`no ${t} message was sent`);
    return all[all.length - 1];
  }
}

class FakeState {
  sockets: WebSocket[] = [];
  /** Survives "hibernation", which is the whole point of it being out here. */
  readonly store = new Map<string, unknown>();
  alarm: number | null = null;

  readonly storage = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const value = this.store.get(key);
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    put: async (key: string, value: unknown): Promise<void> => {
      this.store.set(key, structuredClone(value));
    },
    delete: async (key: string): Promise<boolean> => this.store.delete(key),
    deleteAll: async (): Promise<void> => {
      this.store.clear();
    },
    getAlarm: async (): Promise<number | null> => this.alarm,
    setAlarm: async (at: number): Promise<void> => {
      this.alarm = at;
    },
  };

  getWebSockets(): WebSocket[] {
    return this.sockets;
  }

  acceptWebSocket(): void {
    /* sockets are registered by the FakeSocket constructor */
  }
}

/**
 * The player objects, as a room can see them.
 *
 * A room reaches an account through a stub and posts JSON at it, so the double
 * only has to be something with `idFromName` and `get`. What it records is
 * every post that arrived, which is exactly the thing worth asserting about:
 * the room is the authority on results, and these are the results it claimed.
 *
 * `fail` makes the next post throw, which is how the retry path gets tested —
 * a harvest that could not be delivered has to come back on the next message
 * rather than being lost.
 */
class FakePlayers {
  readonly posts: Array<{ id: string; body: HarvestPost }> = [];
  fail = false;

  idFromName(name: string): string {
    return name;
  }

  get(id: string) {
    return {
      fetch: async (url: string, init?: { body?: string }) => {
        if (this.fail) throw new Error('player object unreachable');
        if (init?.body) {
          this.posts.push({ id, body: JSON.parse(init.body) as HarvestPost });
        }
        // A body, because the room reads the profile back out of the write
        // itself rather than fetching it again. A double that answered `ok`
        // with nothing in it would make every post look unreachable.
        return {
          ok: true,
          json: async () => ({ profile: { id, name: '', xp: 0 } }),
        } as unknown as Response;
      },
    };
  }

  /** Every post for one account, in order. */
  for(id: string): HarvestPost[] {
    return this.posts.filter((post) => post.id === id).map((post) => post.body);
  }
}

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** A keypair and the claim it makes, exactly as the client builds one. */
async function testAccount() {
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

function hello(over: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}): string {
  return JSON.stringify({
    t: 'hello',
    v: PROTOCOL_VERSION,
    playerId: 'p1',
    name: 'Player',
    code: 'TEST',
    create: false,
    gameId: 'connect4',
    ...over,
  });
}

/** A room and its storage. `rebuild()` is a hibernation: same storage, new instance. */
function newRoom() {
  const state = new FakeState();
  const players = new FakePlayers();
  const env = { PLAYERS: players } as unknown as Env;
  let room = new GameRoom(state as unknown as DurableObjectState, env);
  // The code normally lands in storage during fetch(), which we cannot call.
  state.store.set('code', 'TEST');
  return {
    state,
    players,
    get room() {
      return room;
    },
    hibernate() {
      room = new GameRoom(state as unknown as DurableObjectState, env);
    },
    socket: (since?: number) => new FakeSocket(state, since),
  };
}

async function seatTwo() {
  const ctx = newRoom();
  const host = ctx.socket();
  await ctx.room.webSocketMessage(host as unknown as WebSocket, hello({ playerId: 'host', name: 'Host', create: true }));
  const guest = ctx.socket();
  await ctx.room.webSocketMessage(guest as unknown as WebSocket, hello({ playerId: 'guest', name: 'Guest' }));
  // A room now gathers first and is dealt second, so nothing can be played
  // until the host says everyone is here.
  await ctx.room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ t: 'start' }));
  return { ctx, host, guest };
}

describe('hibernation', () => {
  it('accepts a move from a player who joined before the instance was destroyed', async () => {
    // The original bug: the engine lived only in memory, so after hibernation a
    // seated player was told to "join a room first".
    const { ctx, host, guest } = await seatTwo();
    ctx.hibernate();

    await ctx.room.webSocketMessage(
      host as unknown as WebSocket,
      JSON.stringify({ t: 'move', move: { type: 'drop', col: 3 } }),
    );

    expect(host.of('error')).toEqual([]);
    expect(guest.last('room').room.turn).toBe(1);
  });

  it('rebuilds the board exactly, not just the seats', async () => {
    const { ctx, host, guest } = await seatTwo();
    await ctx.room.webSocketMessage(
      host as unknown as WebSocket,
      JSON.stringify({ t: 'move', move: { type: 'drop', col: 3 } }),
    );
    ctx.hibernate();
    await ctx.room.webSocketMessage(
      guest as unknown as WebSocket,
      JSON.stringify({ t: 'move', move: { type: 'drop', col: 3 } }),
    );

    const state = guest.last('room').room.state as { board: Array<Array<number | null>> };
    expect(state.board[5][3]).toBe(0);
    expect(state.board[4][3]).toBe(1);
  });
});

describe('seat takeover', () => {
  it('closes the earlier socket with 4000, so that client stops retrying', async () => {
    // 4000 is the contract with net.ts. Without a distinguishable code the two
    // tabs evict each other about once a second, forever, and the room never
    // hibernates.
    const { ctx, host } = await seatTwo();
    const secondTab = ctx.socket();
    await ctx.room.webSocketMessage(secondTab as unknown as WebSocket, hello({ playerId: 'host', name: 'Host' }));

    expect(host.closedWith?.code).toBe(4000);
    expect(secondTab.last('welcome').seat).toBe(0);
  });

  it('keeps the surviving socket playable after the eviction', async () => {
    const { ctx, guest } = await seatTwo();
    const secondTab = ctx.socket();
    await ctx.room.webSocketMessage(secondTab as unknown as WebSocket, hello({ playerId: 'host', name: 'Host' }));
    ctx.hibernate();

    await ctx.room.webSocketMessage(
      secondTab as unknown as WebSocket,
      JSON.stringify({ t: 'move', move: { type: 'drop', col: 0 } }),
    );
    expect(secondTab.of('error')).toEqual([]);
    expect(guest.last('room').room.turn).toBe(1);
  });
});

describe('presence', () => {
  it('reports a departing player as away, not as still connected', async () => {
    // The closing socket is still listed by getWebSockets() while its close
    // handler runs. The broadcast exists only to raise the "away" badge, so
    // counting the leaver made it useless, and then the room hibernates, so
    // nothing corrects it until the next move.
    const { ctx, host, guest } = await seatTwo();
    await ctx.room.webSocketClose(host as unknown as WebSocket);

    const players = guest.last('room').room.players;
    expect(players[0].connected).toBe(false);
    expect(players[1].connected).toBe(true);
  });

  it('starts the empty-room countdown when the last socket errors rather than closes', async () => {
    // These two doors used to lead to different places: close armed the sweep,
    // error did not. A room whose last socket failed instead of closing was
    // therefore never swept, and held its storage -- and its room code -- for
    // good.
    const { ctx, host, guest } = await seatTwo();
    await ctx.room.webSocketError(host as unknown as WebSocket);
    expect(ctx.state.store.get('emptySince')).toBeUndefined();

    // The host's socket is really gone now, the way the runtime would have
    // dropped it -- so the guest is the last one out.
    ctx.state.sockets = ctx.state.sockets.filter((s) => s !== (host as unknown as WebSocket));
    await ctx.room.webSocketError(guest as unknown as WebSocket);
    expect(typeof ctx.state.store.get('emptySince')).toBe('number');
  });
});

describe('hostile and malformed input', () => {
  it('answers a payload that parses to null instead of throwing', async () => {
    const ctx = newRoom();
    const ws = ctx.socket();
    await expect(ctx.room.webSocketMessage(ws as unknown as WebSocket, 'null')).resolves.toBeUndefined();
    expect(ws.last('error').message).toMatch(/malformed/i);
  });

  it('refuses an unknown game rather than aborting the object', async () => {
    const ctx = newRoom();
    const ws = ctx.socket();
    await expect(
      ctx.room.webSocketMessage(ws as unknown as WebSocket, hello({ gameId: 'chess', create: true })),
    ).resolves.toBeUndefined();
    expect(ws.last('error').message).toMatch(/no game called "chess"/i);
  });

  it('turns away a client from an older deploy', async () => {
    const ctx = newRoom();
    const ws = ctx.socket();
    await ctx.room.webSocketMessage(ws as unknown as WebSocket, hello({ v: PROTOCOL_VERSION + 1, create: true }));
    expect(ws.last('error').kind).toBe('protocol');
  });

  it('refuses a hello for a different room than the one that routed it', async () => {
    const ctx = newRoom();
    const ws = ctx.socket();
    await ctx.room.webSocketMessage(ws as unknown as WebSocket, hello({ code: 'ZZZZ', create: true }));
    // Both codes, because the useful fact is *which* room this socket is in
    // as much as which one the hello asked for.
    expect(ws.last('error').message).toMatch(/This is room TEST, and that hello asked for ZZZZ/i);
  });

  it('refuses to create over a room that is already being played', async () => {
    const { ctx } = await seatTwo();
    const collider = ctx.socket();
    await ctx.room.webSocketMessage(collider as unknown as WebSocket, hello({ playerId: 'x', create: true }));
    expect(collider.last('error').message).toMatch(/already someone else's game/i);
  });

  it('lets the host re-send a create-flagged hello for their own room', async () => {
    // A create hello arriving twice is ordinary: a retry, or a remount in
    // development. Treating it as a collision locked the host out of the room
    // they had just made, with "that room is already someone else's game".
    const ctx = newRoom();
    const first = ctx.socket();
    await ctx.room.webSocketMessage(first as unknown as WebSocket, hello({ playerId: 'host', create: true }));
    expect(first.last('welcome').seat).toBe(0);

    const second = ctx.socket();
    await ctx.room.webSocketMessage(second as unknown as WebSocket, hello({ playerId: 'host', create: true }));

    expect(second.of('error')).toEqual([]);
    expect(second.last('welcome').seat).toBe(0);
  });

  it('refuses to join a room playing a different game', async () => {
    const { ctx } = await seatTwo();
    const confused = ctx.socket();
    await ctx.room.webSocketMessage(
      confused as unknown as WebSocket,
      hello({ playerId: 'x', gameId: 'backgammon' }),
    );
    expect(confused.last('error').message).toMatch(/connect four/i);
  });

  it('will not act on a socket that never said hello', async () => {
    const ctx = newRoom();
    const ws = ctx.socket();
    await ctx.room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ t: 'move', move: {} }));
    expect(ws.last('error').message).toMatch(/join a room first/i);
  });
});

describe('stored snapshots', () => {
  it('discards a snapshot it can no longer read, rather than failing forever', async () => {
    const { ctx, host } = await seatTwo();
    ctx.hibernate();
    // A deploy that changed the persisted shape.
    ctx.state.store.set('room', { ...(ctx.state.store.get('room') as object), version: 0 });

    await ctx.room.webSocketMessage(
      host as unknown as WebSocket,
      JSON.stringify({ t: 'move', move: { type: 'drop', col: 0 } }),
    );

    expect(host.last('error').kind).toBe('no-room');
    expect(ctx.state.store.has('room')).toBe(false);
  });
});

describe('housekeeping', () => {
  it('closes a socket that connects and never says hello', async () => {
    const ctx = newRoom();
    const squatter = ctx.socket(Date.now() - 60_000);
    await ctx.room.alarm();
    expect(squatter.closedWith?.code).toBe(4001);
  });

  it('leaves a freshly connected socket alone', async () => {
    const ctx = newRoom();
    const arriving = ctx.socket();
    await ctx.room.alarm();
    expect(arriving.closedWith).toBeNull();
  });

  it('deletes a room that has been empty past its TTL', async () => {
    // Without this every code ever used keeps a snapshot forever, so the
    // collision space grows with all-time rooms rather than live ones.
    const { ctx, host, guest } = await seatTwo();
    host.close(1000, 'bye');
    guest.close(1000, 'bye');
    ctx.state.store.set('emptySince', Date.now() - 31 * 60 * 1000);

    await ctx.room.alarm();
    expect(ctx.state.store.has('room')).toBe(false);
  });

  it('keeps a room that has been empty for only a little while', async () => {
    const { ctx, host, guest } = await seatTwo();
    host.close(1000, 'bye');
    guest.close(1000, 'bye');
    ctx.state.store.set('emptySince', Date.now() - 60_000);

    await ctx.room.alarm();
    expect(ctx.state.store.has('room')).toBe(true);
    expect(ctx.state.alarm).not.toBeNull();
  });

  it('keeps a room that still has someone in it', async () => {
    const { ctx } = await seatTwo();
    await ctx.room.alarm();
    expect(ctx.state.store.has('room')).toBe(true);
  });
});

/**
 * Filing a finished game with the accounts that played it.
 *
 * The room is the authority on results — a client that could post its own
 * could post any — so these assert on what the room *claimed*, and above all
 * on how often it claimed it. Everything here is one bug away from quietly
 * doubling somebody's experience, which is the failure nobody would notice
 * until the numbers were already wrong.
 */
describe('harvesting', () => {
  /**
   * A host and a guest, seated, with connect4 dealt.
   *
   * The host signs a real claim rather than being seated through the engine's
   * back door, so this exercises the path a player actually takes: sign,
   * `readHello`, `verifyClaim`, `join`. It also means the test cannot pass
   * while verification is broken, which a shortcut into `join` would allow.
   */
  async function seatedGame(signIn = true) {
    const ctx = newRoom();
    const who = signIn ? await testAccount() : null;
    const host = ctx.socket();
    await ctx.room.webSocketMessage(
      host as unknown as WebSocket,
      hello({
        playerId: 'host',
        name: 'Host',
        create: true,
        account: who ? await who.claim('TEST') : undefined,
      }),
    );
    const guest = ctx.socket();
    await ctx.room.webSocketMessage(guest as unknown as WebSocket, hello({ playerId: 'guest', name: 'Guest' }));
    await ctx.room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ t: 'start' }));
    return { ctx, host, guest, account: who?.id ?? '' };
  }

  /** Drop four in a column each, alternating, which wins connect4 for seat 0. */
  async function playOut(ctx: ReturnType<typeof newRoom>, host: FakeSocket, guest: FakeSocket) {
    for (let i = 0; i < 4; i++) {
      await ctx.room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ t: 'move', move: { type: 'drop', col: 0 } }));
      if (i < 3) {
        await ctx.room.webSocketMessage(guest as unknown as WebSocket, JSON.stringify({ t: 'move', move: { type: 'drop', col: 1 } }));
      }
    }
  }

  it('files nothing at all for a room where nobody is signed in', async () => {
    const { ctx, host, guest } = await seatedGame(false);
    await playOut(ctx, host, guest);
    expect(host.last('room').room.over).toBe(true);
    // The commonest room in the app, and it should cost no requests.
    expect(ctx.players.posts).toEqual([]);
  });

  it('files a finished game once, for the seat that was signed in', async () => {
    const { ctx, host, guest, account: ACCOUNT } = await seatedGame();
    await playOut(ctx, host, guest);

    const posts = ctx.players.for(ACCOUNT);
    expect(posts).toHaveLength(1);
    expect(posts[0].seat).toBe(0);
    expect(posts[0].record.gameId).toBe('connect4');
    expect(posts[0].name).toBe('Host');
  });

  /**
   * Connect Four implements no `record`, so the room synthesises one. It has
   * to: eleven of the thirteen games are in that case, and a profile that
   * looked completely dead to somebody who mostly plays Backgammon is exactly
   * what the small per-game payment exists to prevent.
   */
  it('files a game that has no opinion about who won, without inventing one', async () => {
    const { ctx, host, guest, account: ACCOUNT } = await seatedGame();
    await playOut(ctx, host, guest);

    const outcome = ctx.players.for(ACCOUNT)[0].record.seats.find((s) => s.seat === 0);
    expect(outcome?.result).toBeNull();
    expect(outcome?.learned).toEqual([]);
  });

  it('does not file the same game twice, however many messages follow', async () => {
    const { ctx, host, guest, account: ACCOUNT } = await seatedGame();
    await playOut(ctx, host, guest);
    // Every one of these reaches the over-transition check with the game
    // already finished. `pending` is what stops the second filing.
    for (let i = 0; i < 5; i++) {
      await ctx.room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ t: 'move', move: { type: 'drop', col: 3 } }));
    }
    expect(ctx.players.for(ACCOUNT)).toHaveLength(1);
  });

  it('does not file it again after hibernation', async () => {
    const { ctx, host, guest, account: ACCOUNT } = await seatedGame();
    await playOut(ctx, host, guest);
    ctx.hibernate();
    await ctx.room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ t: 'move', move: { type: 'drop', col: 3 } }));
    expect(ctx.players.for(ACCOUNT)).toHaveLength(1);
  });

  /**
   * The retry, and the reason `harvest` is gated on `pending` rather than on
   * catching the moment the game ended. Catching the transition gives exactly
   * one attempt, and a room whose player object was briefly unreachable would
   * lose the game silently.
   */
  it('comes back for a game whose player object could not be reached', async () => {
    const { ctx, host, guest, account: ACCOUNT } = await seatedGame();
    ctx.players.fail = true;
    await playOut(ctx, host, guest);
    expect(ctx.players.for(ACCOUNT)).toEqual([]);
    expect(await ctx.state.storage.get('pending')).toBeTruthy();

    ctx.players.fail = false;
    await ctx.room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ t: 'move', move: { type: 'drop', col: 3 } }));
    expect(ctx.players.for(ACCOUNT)).toHaveLength(1);
    expect(await ctx.state.storage.get('pending')).toBeUndefined();
  });

  /**
   * A rematch is a new game at the same table, so it is paid for separately —
   * which means the key has to move. The counter is bumped at the deal rather
   * than at the whistle precisely so a retry cannot land under a fresh one.
   */
  it('files a rematch under a different key', async () => {
    const { ctx, host, guest, account: ACCOUNT } = await seatedGame();
    await playOut(ctx, host, guest);
    await ctx.room.webSocketMessage(host as unknown as WebSocket, JSON.stringify({ t: 'rematch' }));
    await playOut(ctx, host, guest);

    const keys = ctx.players.for(ACCOUNT).map((post) => post.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('sends the player their own profile back when the game is filed', async () => {
    const { ctx, host, guest } = await seatedGame();
    // One on being welcomed, so the lobby has its "words due" before anybody
    // has pressed anything.
    expect(host.of('profile')).toHaveLength(1);

    await playOut(ctx, host, guest);
    // ...and one more when the finished game is filed, because the end of a
    // game is the moment to show somebody what it taught them.
    expect(host.of('profile')).toHaveLength(2);
    // The guest, who has no account, is told nothing either time.
    expect(guest.of('profile')).toEqual([]);
  });
});
