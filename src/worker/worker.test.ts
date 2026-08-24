import { describe, it, expect } from 'vitest';
import { GameRoom } from './index.js';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../shared/protocol.js';

/**
 * The Durable Object, exercised without workerd.
 *
 * These fakes stand in for the three things the room actually depends on:
 * storage that survives the instance, per-socket attachments that survive
 * hibernation, and `getWebSockets()`. `fetch()` is the one method not covered
 * here, because it needs WebSocketPair — everything it sets up is passed in
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
  /** Survives "hibernation" — that is the whole point of it being out here. */
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
  let room = new GameRoom(state as unknown as DurableObjectState);
  // The code normally lands in storage during fetch(), which we cannot call.
  state.store.set('code', 'TEST');
  return {
    state,
    get room() {
      return room;
    },
    hibernate() {
      room = new GameRoom(state as unknown as DurableObjectState);
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
    // counting the leaver made it useless — and then the room hibernates, so
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
    // A create hello arriving twice is ordinary — a retry, or a remount in
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
