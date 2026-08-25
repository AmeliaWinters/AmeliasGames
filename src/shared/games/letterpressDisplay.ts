/**
 * The parts of Letterpress the board may know. See the boundary note in
 * `types.ts`. The board draws which tiles are locked, counts what a word would
 * take before it is played, and refuses a word the grid has seen. None of that
 * is worth a megabyte of dictionary on a phone.
 */

/** The board is SIZE x SIZE tiles. Five, as Letterpress has always been. */
export const GRID_SIZE = 5;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

/**
 * The lengths a word may be. The floor is three because two-letter words are
 * mostly noise on a grid this size: twenty-five tiles and no adjacency means
 * every pair of letters on the board is available every turn, and a game where
 * both players open with AX is not a game.
 *
 * The ceiling is the grid itself. It used to be eight, which was where the
 * dictionary stopped rather than anything about the game, and it reached the
 * player as a refusal: PHOTOGRAPH spelt out across the board with the tenth
 * tile refusing to join. The word list now runs to twenty-five, so the only
 * thing left to limit a word is how many tiles there are to spell it with.
 */
export const MIN_WORD = 3;
export const MAX_WORD = CELL_COUNT;

/** Seat holding a tile, or null for one nobody has claimed yet. */
export type Owner = 0 | 1 | null;

export interface LpState {
  /** `CELL_COUNT` upper-case letters, row-major. Open to everyone, always. */
  grid: string[];
  /** Who holds each tile, in the same order as `grid`. */
  owner: Owner[];
  /**
   * Every word played by anybody, in the order they were played.
   *
   * One list rather than one per seat, because the rule it exists for is not
   * about seats: a word is spent once it has been played, by either of you.
   * `words` below is the same information split for display, and `played` is
   * the copy the rules read.
   */
  played: string[];
  /** `words[s]` is what seat `s` has played, for the two lists on the board. */
  words: string[][];
  turn: 0 | 1;
  /** The last word played, and the tiles it used, for the board to mark. */
  lastWord: string | null;
  lastPlay: number[] | null;
  /**
   * Consecutive passes. Two in a row ends the game. See `pass()` in the
   * reducer for why a pass exists at all.
   */
  passes: number;
  winner: 0 | 1 | null;
  draw: boolean;
  moveCount: number;
}

export type LpMove =
  /**
   * The tiles used, in the order they spell the word. Any tiles anywhere:
   * there is no adjacency in this game, which is the whole difference between
   * it and Word Hunt.
   */
  | { type: 'play'; path: number[] }
  /** No word to be had. Two in a row ends the game on the count. */
  | { type: 'pass' };

/** Row and column of a tile, for anything that has to think in two dimensions. */
export function cellAt(index: number): { row: number; col: number } {
  return { row: Math.floor(index / GRID_SIZE), col: index % GRID_SIZE };
}

/**
 * The tiles orthogonally touching this one: two at a corner, three along an
 * edge, four in the middle.
 *
 * Diagonals are deliberately not neighbours. Defence is what this feeds, and a
 * rule that counted eight neighbours would mean a tile in the middle of the
 * board could effectively never be locked.
 */
export function neighbours(cell: number): number[] {
  const { row, col } = cellAt(cell);
  const out: number[] = [];
  if (row > 0) out.push(cell - GRID_SIZE);
  if (row < GRID_SIZE - 1) out.push(cell + GRID_SIZE);
  if (col > 0) out.push(cell - 1);
  if (col < GRID_SIZE - 1) out.push(cell + 1);
  return out;
}

/** Worked out once, since the grid never changes shape. */
const NEIGHBOURS: readonly (readonly number[])[] = Array.from({ length: CELL_COUNT }, (_, cell) =>
  neighbours(cell),
);

/**
 * Whether a tile is locked: held by somebody, with every tile touching it held
 * by the same somebody.
 *
 * "All four sides" means all the sides it has. A corner tile has two
 * neighbours and a locked corner is therefore cheap, which is the reason
 * corners are worth taking early and the reason a wall of your own colour
 * along an edge is a real structure rather than a decoration.
 *
 * Read against a board rather than a state, because the reducer has to ask it
 * of the board *before* a word lands. See `claim` below.
 */
export function isLocked(owner: readonly Owner[], cell: number): boolean {
  const holder = owner[cell];
  if (holder === null || holder === undefined) return false;
  return NEIGHBOURS[cell].every((side) => owner[side] === holder);
}

/**
 * Whether playing this tile would turn it, for `mover`.
 *
 * Two ways to answer no: it is already theirs, or it is locked. Everything
 * else turns, including a tile nobody holds, since an unheld tile cannot be
 * locked when there is nobody for it to be surrounded by.
 */
export function flips(owner: readonly Owner[], cell: number, mover: 0 | 1): boolean {
  if (owner[cell] === mover) return false;
  return !isLocked(owner, cell);
}

/**
 * The board after `mover` plays these tiles.
 *
 * Every tile is judged against the board as it stood at the start of the turn,
 * and only then is anything written. Turning them one at a time would make the
 * *order of the letters in the word* change what the word takes: claim a tile
 * beside a locked one and the lock breaks, so the sixth letter of a word could
 * unlock the seventh. The rule players are taught is "a surrounded tile is
 * safe", and this is what makes that true for the whole of a turn.
 *
 * Pure: the array handed in is never written to.
 */
export function claim(owner: readonly Owner[], path: readonly number[], mover: 0 | 1): Owner[] {
  const next = owner.slice();
  for (const cell of path) {
    if (flips(owner, cell, mover)) next[cell] = mover;
  }
  return next;
}

/**
 * Whether a run of tiles could be a word: a workable length, on the board, and
 * never the same tile twice.
 *
 * Says nothing about whether the letters spell anything, since only the server
 * holds the dictionary. Note what is *not* here: adjacency. A word may be
 * built from any tiles anywhere, which is why a locked tile in the far corner
 * is still worth its letter to you.
 */
export function isLegalPath(path: readonly number[]): boolean {
  if (path.length < MIN_WORD || path.length > MAX_WORD) return false;
  if (!path.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT)) {
    return false;
  }
  return new Set(path).size === path.length;
}

/** Whether one more tile could join a word still being built. */
export function canExtend(path: readonly number[], cell: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return false;
  if (path.length >= MAX_WORD) return false;
  return !path.includes(cell);
}

/** The letters a run of tiles spells. */
export function spell(grid: readonly string[], path: readonly number[]): string {
  return path.map((cell) => grid[cell] ?? '').join('');
}

/**
 * The already-played word that blocks this one, or null if it is free.
 *
 * A word is spent once anybody has played it, and so is every word that starts
 * with it: CAT played means CATS, CATTLE and CATAMARAN are all gone. That
 * second half is not fussiness, it is the rule that stops the endgame becoming
 * PIN, PINS, PINE, PINES, where a player who found one useful stem could farm
 * it for a dozen turns while the board barely moves.
 *
 * It does not run the other way: CAT is still there after CATS, because CAT
 * takes different tiles and finding the short word inside a long one you have
 * already seen is not the same trick twice.
 */
export function blockedBy(played: readonly string[], word: string): string | null {
  return played.find((old) => word.startsWith(old)) ?? null;
}

/** Tiles held by each seat: the score, and the whole of it. */
export function tally(state: LpState): [number, number] {
  return [
    state.owner.filter((holder) => holder === 0).length,
    state.owner.filter((holder) => holder === 1).length,
  ];
}

/** Tiles nobody holds. The game ends when this reaches zero. */
export function unclaimed(state: LpState): number {
  return state.owner.filter((holder) => holder === null).length;
}

export function isFull(state: LpState): boolean {
  return unclaimed(state) === 0;
}

/**
 * Whether `seat` may move right now. Strictly alternating, so this is exactly
 * `turn(state) === seat`, written out because the contract says which kind of
 * game this is and a reader should not have to go and find out.
 */
export function canAct(state: LpState, seat: number): boolean {
  if (state.winner !== null || state.draw) return false;
  return state.turn === seat;
}
