import { canSeat, clampSeats, getGame } from './games/index.js';
// Re-exported so the adapters still import room helpers from one place, while
// the client can import roomCode.js directly and never pull in a reducer.
export { CODE_LENGTH, makeRoomCode, isRoomCode, normalizeRoomCode } from './roomCode.js';
import type { GameDefinition, Rng } from './types.js';
import type { RoomView } from './protocol.js';

export interface SeatRecord {
  playerId: string;
  name: string;
}

/**
 * Bumped whenever a persisted shape changes — a game's state, or the snapshot
 * itself. A stored room from an older shape is discarded rather than fed to a
 * reducer that would misread it.
 */
export const SNAPSHOT_VERSION = 1;

/** Everything needed to rebuild a room — this is what gets persisted. */
export interface RoomSnapshot {
  version: number;
  code: string;
  gameId: string;
  state: unknown;
  seats: Array<SeatRecord | null>;
}

export type JoinResult =
  | { ok: true; seat: number; reclaimed: boolean }
  | { ok: false; error: string };

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Transport-agnostic room logic. It knows about seats, turns and rules but
 * nothing about sockets — which is what lets the Node dev server and the
 * Cloudflare Durable Object share it verbatim.
 */
export class RoomEngine {
  readonly code: string;
  /**
   * Not readonly: a room outlives the game it was opened with. `switchGame`
   * swaps the reducer under the same code and the same seats, which is the
   * whole point of being able to play something else without regrouping.
   */
  def: GameDefinition<any, any>;
  private state: unknown;
  private seats: Array<SeatRecord | null>;

  private constructor(code: string, def: GameDefinition<any, any>, state: unknown, seats: Array<SeatRecord | null>) {
    this.code = code;
    this.def = def;
    this.state = state;
    this.seats = seats;
  }

  /**
   * Build a fresh room, or null if there is no such game. Callers are on a
   * socket and must answer the client rather than throw, so an unknown game id
   * is a return value here, not an exception.
   *
   * `playerCount` is how big a table the room was opened for, clamped to what
   * the game supports. It is fixed for the life of the room: seats are sized
   * to it and `setup` is told about it, so a game that plays two to four
   * knows which it is dealing with. Omitting it takes the smallest table the
   * game allows, which is the friendliest failure — a room asking for more
   * players than turn up is a room nobody can play in.
   */
  static create(
    code: string,
    gameId: string,
    rng: Rng = Math.random,
    playerCount?: number,
  ): RoomEngine | null {
    const def = getGame(gameId);
    if (!def) return null;
    const seats = clampSeats(def, playerCount);
    return new RoomEngine(code, def, def.setup(seats, rng), Array(seats).fill(null));
  }

  /**
   * Rebuild a persisted room, or null if it can no longer be trusted — a
   * snapshot from an older shape, or for a game that no longer exists. Callers
   * should treat null as "this room is gone" and delete it, rather than
   * throwing on every subsequent message forever.
   */
  static restore(snapshot: RoomSnapshot): RoomEngine | null {
    if (snapshot?.version !== SNAPSHOT_VERSION) return null;
    const def = getGame(snapshot.gameId);
    if (!def) return null;
    return new RoomEngine(snapshot.code, def, snapshot.state, snapshot.seats);
  }

  snapshot(): RoomSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      code: this.code,
      gameId: this.def.id,
      state: this.state,
      seats: this.seats,
    };
  }

  /** True before anyone has ever taken a seat — used to detect code collisions. */
  isFresh(): boolean {
    return this.seats.every((s) => s === null);
  }

  seatOf(playerId: string): number {
    return this.seats.findIndex((s) => s?.playerId === playerId);
  }

  join(playerId: string, name: string): JoinResult {
    // An existing player always gets their own seat back, so a dropped
    // connection is recoverable rather than fatal.
    const existing = this.seatOf(playerId);
    if (existing !== -1) {
      this.seats[existing] = { playerId, name };
      return { ok: true, seat: existing, reclaimed: true };
    }
    const free = this.seats.findIndex((s) => s === null);
    if (free === -1) return { ok: false, error: 'That game is full.' };
    this.seats[free] = { playerId, name };
    return { ok: true, seat: free, reclaimed: false };
  }

  private filled(): number {
    return this.seats.filter((s) => s !== null).length;
  }

  /** How many seats this room was opened for — not the game's ceiling. */
  get size(): number {
    return this.seats.length;
  }

  /**
   * Play starts when every seat this room laid out is taken, rather than at
   * the game's minimum. A four-handed room that started as soon as two arrived
   * would deal the other two out of a game they were invited to.
   */
  private short(): number {
    return this.seats.length - this.filled();
  }

  move(seat: number, move: unknown, rng: Rng = Math.random): ActionResult {
    if (this.short() > 0) {
      return { ok: false, error: 'Waiting for another player.' };
    }
    const result = this.def.applyMove(this.state, move, seat, rng);
    if (!result.ok) return { ok: false, error: result.error };
    this.state = result.state;
    return { ok: true };
  }

  rematch(rng: Rng = Math.random): ActionResult {
    if (!this.def.isOver(this.state)) {
      return { ok: false, error: 'That game is still in progress.' };
    }
    // The same table, not the game's ceiling: a rematch in a three-handed room
    // is another three-handed game.
    this.state = this.def.setup(this.seats.length, rng);
    return { ok: true };
  }

  /**
   * Play a different game with the same people, at the same table.
   *
   * Gated on the current game being over for the same reason a rematch is:
   * otherwise any seat could wipe a game in progress that the others were
   * still playing. The table size is fixed — these players are already
   * sitting down — so a game that cannot seat exactly this many is refused
   * rather than silently dropping somebody or leaving a room short.
   */
  switchGame(gameId: string, rng: Rng = Math.random): ActionResult {
    if (!this.def.isOver(this.state)) {
      return { ok: false, error: 'That game is still in progress.' };
    }
    const next = getGame(gameId);
    if (!next) return { ok: false, error: 'No such game.' };
    if (next.id === this.def.id) return this.rematch(rng);
    if (!canSeat(next, this.seats.length)) {
      return {
        ok: false,
        error: `${next.name} doesn't play with ${this.seats.length}.`,
      };
    }
    this.def = next;
    this.state = next.setup(this.seats.length, rng);
    return { ok: true };
  }

  /** Build the payload for one seat, redacted by the game's `view` if it has one. */
  viewFor(seat: number, connected: ReadonlySet<number>): RoomView {
    const short = this.short();
    const waiting = short > 0;
    const names = this.seats.map((s, i) => s?.name ?? `Player ${i + 1}`);
    return {
      code: this.code,
      gameId: this.def.id,
      gameName: this.def.name,
      players: this.seats.map((s, i) => ({
        seat: i,
        name: s?.name ?? '',
        connected: connected.has(i),
      })),
      state: this.def.view ? this.def.view(this.state, seat) : this.state,
      turn: this.def.turn(this.state),
      // How many are still missing, because "waiting for another player" in a
      // four-handed room does not tell you whether to go and find one or two.
      status: waiting
        ? `Waiting for ${short} more player${short === 1 ? '' : 's'}…`
        : this.def.status(this.state, names),
      over: this.def.isOver(this.state),
      waiting,
    };
  }
}
