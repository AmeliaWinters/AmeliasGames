/**
 * The parts of Word Hunt the board may know. See the boundary note in
 * `types.ts`. The board decides whether the letters under a dragging finger
 * form a legal path; taking that from the reducer would put the whole
 * dictionary on the phone of everyone who opens the lobby.
 */

export { clockCall, formatClock } from '../clock.js';

/**
 * What `view()` leaves where somebody else's word used to be: a run of marks
 * as long as the word was. Not letters, so it can never be mistaken for one,
 * and the length survives deliberately, because a word's length *is* its score
 * and watching an opponent's total climb is most of the tension in the game.
 * Which word earned it is the part worth hiding.
 */
export const MASK_CHAR = '?';

export function maskWord(word: string): string {
  return MASK_CHAR.repeat(word.length);
}

export function isMasked(word: string): boolean {
  return word.length > 0 && word.split('').every((mark) => mark === MASK_CHAR);
}

/**
 * The lengths a trace may be. Three is the shortest word worth spotting; eight
 * is longer than a 4x4 grid gives up more than once in a very long while, and
 * the dictionary is cut to the same range: a limit the board could draw past
 * would mean traces the server will never take. `words.test.ts` holds the two
 * ends together.
 */
export const MIN_WORD = 3;
export const MAX_WORD = 8;

/**
 * What a word is worth. Length is the whole of the scoring, and it climbs
 * faster than length does: a seven-letter word is not twice a four, it is the
 * one you will still be pleased about afterwards. These are the values the
 * game everyone has played on a phone uses, and a player who knows them
 * already should not have to learn new ones.
 *
 * Indexed by length; anything outside the range is worth nothing, which can
 * only happen to a word the reducer would have refused anyway.
 */
const SCORES: Record<number, number> = {
  3: 100,
  4: 400,
  5: 800,
  6: 1400,
  7: 1800,
  8: 2200,
};

export function wordScore(word: string): number {
  return SCORES[word.length] ?? 0;
}

/** The board is SIZE x SIZE letters. Four, as every version of this game is. */
export const GRID_SIZE = 4;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

/**
 * How long a hunt lasts. Two minutes is the length this game is played at
 * everywhere, and it is the right length: long enough to work a grid properly,
 * short enough that the last twenty seconds are frantic, which is the part
 * everyone actually plays for.
 *
 * The clock is the server's throughout. A client counts down for the look of
 * the thing; nothing it does can extend the round or end it early.
 */
export const ROUND_MS = 2 * 60 * 1000;

/**
 * Milliseconds left, floored at zero, measured against a clock the caller
 * supplies. A finished game has no time left regardless of what the clock
 * says, so a round settled early by everyone stopping does not sit there
 * counting down at them.
 */
export function msLeft(state: WhState, now: number): number {
  if (state.phase !== 'play') return 0;
  // Not started is the full round, not none of it: the grid is up and the
  // clock is waiting for the last player, and showing 0:00 to someone who has
  // not had a turn yet would be a lie in the least helpful direction.
  if (state.endsAt === null) return ROUND_MS;
  return Math.max(0, state.endsAt - now);
}

/** Whether the whistle has gone. The server's answer is the one that counts. */
export function timeIsUp(state: WhState, now: number): boolean {
  return state.phase === 'play' && state.endsAt !== null && now >= state.endsAt;
}

/** Whether the round is under way. False while the room is still filling. */
export function hasStarted(state: WhState): boolean {
  return state.endsAt !== null;
}

export interface WhState {
  /**
   * `play` until every seat has called it a day, then `over`. There is no
   * setup phase: the grid is dealt by `setup()` and everyone starts at once.
   */
  phase: 'play' | 'over';
  /** `CELL_COUNT` upper-case letters, row-major. Open to everyone. */
  grid: string[];
  /**
   * `found[s]` is what seat `s` has found, in the order they found it.
   *
   * Redacted for everyone but you until the game ends: an opponent's entries
   * arrive masked, which keeps the count and the score (the whole tension being
   * watching them climb) without handing over the words.
   */
  found: string[][];
  /** Seats that have stopped hunting. The game ends when they all have. */
  done: boolean[];
  /**
   * When the hunt ends, in epoch milliseconds on the server's clock, or null
   * while the room is still filling.
   *
   * The clock starts when the last player sits down, not when the grid is
   * dealt: the room turns moves away until it is full, so a round started at
   * setup would tick away while somebody was still opening the link, and could
   * be over before they arrived.
   */
  endsAt: number | null;
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
  /** Out of ideas. Irreversible, because the others are waiting on you. */
  | { type: 'done' };

/** Row and column of a cell, for anything that has to think in two dimensions. */
export function cellAt(index: number): { row: number; col: number } {
  return { row: Math.floor(index / GRID_SIZE), col: index % GRID_SIZE };
}

/**
 * Whether two cells touch, orthogonally or diagonally, which is what makes
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
 * Whether a run of cells is a legal trace: a workable length, on the board,
 * never revisiting a cell, and every step landing on a neighbour.
 *
 * Says nothing about whether the letters spell anything, since only the server
 * holds the dictionary. The board uses this to decide what to let the player
 * draw; the reducer uses it as the first half of validating what arrives.
 */
export function isLegalPath(path: readonly number[]): boolean {
  if (path.length < MIN_WORD || path.length > MAX_WORD) return false;
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
  if (path.length >= MAX_WORD) return false;
  if (path.includes(cell)) return false;
  return path.length === 0 || areAdjacent(path[path.length - 1], cell);
}

/** The letters a path spells, for the word being drawn under the finger. */
export function spell(grid: readonly string[], path: readonly number[]): string {
  return path.map((cell) => grid[cell] ?? '').join('');
}

/** A seat's score: what their words are worth, added up. */
export function scoreOf(state: WhState, seat: number): number {
  return (state.found[seat] ?? []).reduce((total, word) => total + wordScore(word), 0);
}

/** How many words a seat has, which is the other half of what a tally says. */
export function countOf(state: WhState, seat: number): number {
  return state.found[seat]?.length ?? 0;
}

/**
 * Whether `seat` may still hunt: the only question the UI should ask. Play is
 * free-simultaneous, so `room.turn` says nothing about whether you personally
 * may drag.
 */
export function canAct(state: WhState, seat: number, now?: number): boolean {
  if (state.phase !== 'play') return false;
  if (seat < 0 || seat >= state.done.length) return false;
  if (state.done[seat]) return false;
  // `now` is optional so a caller with no clock to hand still gets the rest of
  // the answer. The board passes one, which is what stops the grid accepting
  // traces in the moment between the countdown hitting zero and the server's
  // word for it arriving.
  return now === undefined || !timeIsUp(state, now);
}
