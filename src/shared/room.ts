import { getGame } from './games/index.js';
import type { GameDefinition, Rng } from './types.js';
import type { RoomView } from './protocol.js';

export interface SeatRecord {
  playerId: string;
  name: string;
}

/** Everything needed to rebuild a room — this is what gets persisted. */
export interface RoomSnapshot {
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
  readonly def: GameDefinition<any, any>;
  private state: unknown;
  private seats: Array<SeatRecord | null>;

  private constructor(code: string, def: GameDefinition<any, any>, state: unknown, seats: Array<SeatRecord | null>) {
    this.code = code;
    this.def = def;
    this.state = state;
    this.seats = seats;
  }

  static create(code: string, gameId: string, rng: Rng = Math.random): RoomEngine {
    const def = getGame(gameId);
    if (!def) throw new Error(`unknown game: ${gameId}`);
    return new RoomEngine(
      code,
      def,
      def.setup(def.maxPlayers, rng),
      Array(def.maxPlayers).fill(null),
    );
  }

  static restore(snapshot: RoomSnapshot): RoomEngine {
    const def = getGame(snapshot.gameId);
    if (!def) throw new Error(`unknown game: ${snapshot.gameId}`);
    return new RoomEngine(snapshot.code, def, snapshot.state, snapshot.seats);
  }

  snapshot(): RoomSnapshot {
    return { code: this.code, gameId: this.def.id, state: this.state, seats: this.seats };
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

  move(seat: number, move: unknown, rng: Rng = Math.random): ActionResult {
    if (this.filled() < this.def.minPlayers) {
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
    this.state = this.def.setup(this.def.maxPlayers, rng);
    return { ok: true };
  }

  /** Build the payload for one seat, redacted by the game's `view` if it has one. */
  viewFor(seat: number, connected: ReadonlySet<number>): RoomView {
    const waiting = this.filled() < this.def.minPlayers;
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
      status: waiting ? 'Waiting for another player…' : this.def.status(this.state, names),
      over: this.def.isOver(this.state),
      waiting,
    };
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Room codes skip O/0 and I/1 so they survive being read aloud. */
export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

export function isRoomCode(value: string): boolean {
  return /^[A-Z0-9]{4}$/.test(value);
}
