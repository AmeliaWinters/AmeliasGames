/**
 * The parts of Ultimate Tic-Tac-Toe the board may know. See the boundary note
 * in `types.ts`. Not secrecy: one number does three jobs here, and both halves
 * of the app must read it the same way. A square's index within its small
 * board is *also* the board the opponent is sent to, and *also* a position in
 * the eight lines the big board is won on. Two copies of that arithmetic would
 * be a board pointing at the wrong square.
 */

/**
 * Nine squares to a board, nine boards to the game, and the same nine is the
 * trick. A `spot` is both a square within a board and a board within the big
 * one.
 */
export const SPOTS = 9;
export const CELLS = SPOTS * SPOTS;

/** Seat index of the mark on the square, or null for an empty one. */
export type Cell = 0 | 1 | null;

/**
 * A seat that won the small board, `'drawn'` for full-with-no-line, or null
 * while in play. Not `Cell`: two states mean "no seat owns this" and only one
 * is still worth playing in, and the big board's line cannot cross a drawn one.
 */
export type Result = 0 | 1 | 'drawn' | null;

/** Three positions, in the order they are read. */
export type Line = readonly [number, number, number];

/**
 * Row by row, left to right, within a board, and boards the same way within
 * the big one. Square 4 of board 0 is the centre of the top-left board, and
 * playing it sends the opponent to board 4.
 *
 * ```
 *   0 | 1 | 2
 *  ---+---+---
 *   3 | 4 | 5
 *  ---+---+---
 *   6 | 7 | 8
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

/** Where a square sits in its board, and so the board it sends the opponent to. */
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

/** "the centre board", "the top-left board", for the status line. */
export function boardName(board: number): string {
  return `${SPOT_NAMES[board].replace(' ', '-')} board`;
}

/**
 * Which board, then where in it. Both halves are needed: "centre" alone names
 * nine squares, and a screen reader announcing nine of them announces none.
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
   * The three squares that won each small board, for drawing only. The rules
   * never read it, but a player wants to see which line settled it.
   */
  lines: Array<Line | null>;
  /**
   * The board the mover must play in, or null for free choice. Normalised on
   * the way in: pointing at a settled board leaves this null. The rule that a
   * spent target frees the opponent lives here and nowhere else, so the client
   * only ever asks "am I sent somewhere, or anywhere?"
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
 * The line through `spot` that `owner` just completed, or null. `read` is the
 * lookup, which is what lets the small boards and the big one share this. Only
 * the position just filled can complete a line, so the search starts there.
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

/** Playable right now by whoever is on turn. Seat is not part of the question. */
export function legal(state: UtState, cell: number): boolean {
  if (state.winner !== null || state.draw) return false;
  if (!isCell(cell)) return false;
  if (state.board[cell] !== null) return false;
  const board = boardOf(cell);
  if (!isOpen(state, board)) return false;
  return state.sent === null || state.sent === board;
}

/** Small boards won, per seat: the tiebreak, and worth showing all game. */
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
