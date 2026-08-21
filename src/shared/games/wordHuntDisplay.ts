/**
 * The parts of Word Hunt the board is allowed to know.
 *
 * Same boundary as `wordleDisplay.ts`, and for the same reason: the board has
 * to know whether the letters under a dragging finger form a legal path, and
 * that is real logic — but routing it through `wordHunt.ts` would pull the
 * reducer and the whole dictionary onto the phone of everyone who opens the
 * lobby. `bundle.test.ts` holds that line.
 *
 * The one import is `wordleDisplay.js`, which itself imports nothing: the two
 * word games agree on a word length and on the sentinel for "this is here but
 * not for your eyes", and restating either would let them drift apart.
 *
 * `wordHunt.ts` re-exports everything here, so the reducer and its tests carry
 * on importing from one place.
 */
import { HIDDEN, WORD_LENGTH } from './wordleDisplay.js';

export { HIDDEN, WORD_LENGTH };

/** The board is SIZE × SIZE letters. Four, as every version of this game is. */
export const GRID_SIZE = 4;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

export interface WhState {
  /**
   * `play` until every seat has called it a day, then `over`. There is no
   * setup phase — the grid is dealt by `setup()` and everyone starts at once.
   */
  phase: 'play' | 'over';
  /** `CELL_COUNT` upper-case letters, row-major. Open to everyone. */
  grid: string[];
  /**
   * `found[s]` is what seat `s` has found, in the order they found it.
   *
   * Redacted for everyone but you until the game ends: an opponent's entries
   * arrive as `HIDDEN`, which keeps the count — the whole tension of the game
   * is watching it climb — without handing over the words themselves.
   */
  found: string[][];
  /** Seats that have stopped hunting. The game ends when they all have. */
  done: boolean[];
  /**
   * Every word the grid held, filled in once the game is over. Empty until
   * then, because it is a complete answer key and the game is still running.
   */
  solutions: string[];
  winner: number | null;
  draw: boolean;
}

export type WhMove =
  /** The cells traced, in order. The word is whatever they spell. */
  | { type: 'found'; path: number[] }
  /** Out of ideas. Irreversible — the others are waiting on you. */
  | { type: 'done' };

/** Row and column of a cell, for anything that has to think in two dimensions. */
export function cellAt(index: number): { row: number; col: number } {
  return { row: Math.floor(index / GRID_SIZE), col: index % GRID_SIZE };
}

/**
 * Whether two cells touch — orthogonally or diagonally, which is what makes
 * this a hunt rather than a word search. A cell is not adjacent to itself, so
 * this doubles as the check that a path never sits still.
 */
export function areAdjacent(a: number, b: number): boolean {
  if (a === b) return false;
  const one = cellAt(a);
  const two = cellAt(b);
  return Math.abs(one.row - two.row) <= 1 && Math.abs(one.col - two.col) <= 1;
}

/**
 * Whether a run of cells is a legal trace: the right length, on the board,
 * never revisiting a cell, and every step landing on a neighbour.
 *
 * Says nothing about whether the letters spell anything — only the server
 * holds the dictionary. The board uses this to decide what to let the player
 * draw; the reducer uses it as the first half of validating what arrives.
 */
export function isLegalPath(path: readonly number[]): boolean {
  if (path.length !== WORD_LENGTH) return false;
  if (!path.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT)) {
    return false;
  }
  if (new Set(path).size !== path.length) return false;
  return path.every((cell, i) => i === 0 || areAdjacent(path[i - 1], cell));
}

/**
 * The same rules, applied to a trace still being drawn. The board needs this
 * on every pointer move: a partial path must already be distinct and adjacent
 * or the player is drawing something that can never be submitted.
 */
export function canExtend(path: readonly number[], cell: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return false;
  if (path.length >= WORD_LENGTH) return false;
  if (path.includes(cell)) return false;
  return path.length === 0 || areAdjacent(path[path.length - 1], cell);
}

/** The letters a path spells, for the word being drawn under the finger. */
export function spell(grid: readonly string[], path: readonly number[]): string {
  return path.map((cell) => grid[cell] ?? '').join('');
}

/**
 * A seat's score. One point a word — every word here is the same length, so
 * length cannot be worth anything, and counting is a score a player can keep
 * in their head while they hunt.
 */
export function scoreOf(state: WhState, seat: number): number {
  return state.found[seat]?.length ?? 0;
}

/**
 * Whether `seat` may still hunt — the only question the UI should ask. Play is
 * free-simultaneous, so `room.turn` says nothing about whether you personally
 * may drag.
 */
export function canAct(state: WhState, seat: number): boolean {
  if (state.phase !== 'play') return false;
  if (seat < 0 || seat >= state.done.length) return false;
  return !state.done[seat];
}
