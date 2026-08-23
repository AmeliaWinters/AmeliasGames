/**
 * The parts of Ultimate Tic-Tac-Toe the board is allowed to know.
 *
 * Like `morrisDisplay.ts`, this module deliberately imports nothing. Ultimate
 * hides nothing from anybody, so secrecy is not the reason here — it is that
 * one number does three jobs on this board, and both halves of the app have to
 * read it the same way. A square's index within its small board is *also* the
 * small board the opponent is sent to, and it is *also* a position in the same
 * eight lines the big board is won on. Two copies of that arithmetic would be
 * a board pointing at the wrong square.
 *
 * `ultimate.ts` re-exports the lot, so the rules and their tests carry on
 * importing a game from one place.
 */

/**
 * Nine squares to a board, nine boards to the game — the same nine, which is
 * the whole trick. `SPOTS` is therefore both counts, and a `spot` is both a
 * square within a board and the index of a board within the big one.
 */
export const SPOTS = 9;
export const CELLS = SPOTS * SPOTS;

/** Seat index of the mark on the square, or null for an empty one. */
export type Cell = 0 | 1 | null;

/**
 * What has become of a small board: a seat that won it, `'drawn'` for one
 * that filled up with no line in it, or null while it is still in play.
 *
 * A drawn board counts for nobody — the big board's line cannot run through
 * it — which is why this is not `Cell`. Two states mean "no seat owns this"
 * and only one of them is still worth playing in.
 */
export type Result = 0 | 1 | 'drawn' | null;

/** Three positions, in the order they are read. */
export type Line = readonly [number, number, number];

/**
 * Squares are numbered row by row, left to right, within a board; boards are
 * numbered the same way within the big one. So square 4 of board 0 is the
 * centre of the top-left board, and playing it sends the opponent to board 4,
 * the centre board.
 *
 * ```
 *   0 │ 1 │ 2
 *  ───┼───┼───
 *   3 │ 4 │ 5
 *  ───┼───┼───
 *   6 │ 7 │ 8
 * ```
 */
export const LINES: readonly Line[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Which small board a square belongs to. */
export function boardOf(cell: number): number {
  return Math.floor(cell / SPOTS);
}

/**
 * Where a square sits within its board — and, because they are the same nine
 * positions, the board whoever plays it sends the opponent to.
 */
export function spotOf(cell: number): number {
  return cell % SPOTS;
}

export function cellAt(board: number, spot: number): number {
  return board * SPOTS + spot;
}

export function isCell(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < CELLS;
}

export function isBoard(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < SPOTS;
}

const SPOT_NAMES = [
  'top left',
  'top centre',
  'top right',
  'middle left',
  'centre',
  'middle right',
  'bottom left',
  'bottom centre',
  'bottom right',
] as const;

/** "the centre board", "the top-left board" — for the status line. */
export function boardName(board: number): string {
  return `${SPOT_NAMES[board].replace(' ', '-')} board`;
}

/**
 * A square, said the way a player would say it: which board, then where in it.
 * Both halves are needed — "centre" alone names nine different squares, and a
 * screen reader announcing nine of them is announcing none.
 */
export function cellName(cell: number): string {
  return `${SPOT_NAMES[spotOf(cell)]} of the ${boardName(boardOf(cell))}`;
}

/** What the ninth mark on the big board would say. */
export type UtEnding = 'line' | 'count' | 'level';

export type UtMove = { type: 'play'; cell: number };

export interface UtState {
  /** 81 squares, board-major: `cellAt(board, spot)` addresses one. */
  board: Cell[];
  /** One per small board, in board order. */
  results: Result[];
  /**
   * The three squares that won each small board, for the board to draw. Null
   * for a board nobody won — the rules never read this, but a player looking
   * at a settled board wants to know which line settled it.
   */
  lines: Array<Line | null>;
  /**
   * The board the mover must play in, or null for a free choice.
   *
   * Normalised on the way in: a move that points at a board which is already
   * settled leaves this null rather than naming a board nobody may play in.
   * The rule that a spent target frees the opponent lives in exactly one
   * place, and this is it — so the client's question is only ever "am I sent
   * somewhere, or anywhere?"
   */
  sent: number | null;
  turn: 0 | 1;
  winner: 0 | 1 | null;
  draw: boolean;
  ending: UtEnding | null;
  /** The square last played, for the board to mark. */
  lastMove: number | null;
  /** The three *boards* that won the game, if it was won that way. */
  winningLine: Line | null;
  moveCount: number;
}

/**
 * The line through `spot` that `owner` has just completed, or null.
 *
 * `read` is how a position is looked up, which is what lets the small boards
 * and the big one share this: one reads squares of `board`, the other reads
 * `results`. Only the position just filled can complete a new line, so the
 * search starts from it rather than sweeping all eight.
 */
export function lineThrough(
  read: (position: number) => Cell | Result,
  owner: 0 | 1,
  spot: number,
): Line | null {
  for (const line of LINES) {
    if (!line.includes(spot)) continue;
    if (line.every((position) => read(position) === owner)) return line;
  }
  return null;
}

/** Whether a small board is still in play. A settled one is closed for good. */
export function isOpen(state: UtState, board: number): boolean {
  return state.results[board] === null;
}

/** Every board the mover may legally land in this turn. */
export function openBoards(state: UtState): number[] {
  if (state.winner !== null || state.draw) return [];
  if (state.sent !== null) return isOpen(state, state.sent) ? [state.sent] : [];
  return Array.from({ length: SPOTS }, (_, board) => board).filter((board) =>
    isOpen(state, board),
  );
}

/**
 * Whether this square could be played right now, by whoever's turn it is.
 * Seat is not part of the question: the board asks it only about the mover.
 */
export function legal(state: UtState, cell: number): boolean {
  if (state.winner !== null || state.draw) return false;
  if (!isCell(cell)) return false;
  if (state.board[cell] !== null) return false;
  const board = boardOf(cell);
  if (!isOpen(state, board)) return false;
  return state.sent === null || state.sent === board;
}

/** Small boards won, per seat — the tiebreak, and worth showing all game. */
export function tally(state: UtState): [number, number] {
  return [
    state.results.filter((result) => result === 0).length,
    state.results.filter((result) => result === 1).length,
  ];
}

/** Whether a small board is full, which is the only way it can draw. */
export function isFull(board: readonly Cell[], small: number): boolean {
  for (let spot = 0; spot < SPOTS; spot++) {
    if (board[cellAt(small, spot)] === null) return false;
  }
  return true;
}
