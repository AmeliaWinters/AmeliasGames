import type { GameDefinition, MoveResult } from '../types.js';

export const ROWS = 6;
export const COLS = 7;
export const CONNECT = 4;

/** Seat index of the player who owns the disc, or null for an empty slot. */
export type Cell = 0 | 1 | null;

export interface C4State {
  /** board[row][col]; row 0 is the TOP of the grid, discs fall toward row 5. */
  board: Cell[][];
  turn: 0 | 1;
  winner: 0 | 1 | null;
  draw: boolean;
  lastMove: { row: number; col: number } | null;
  winningLine: Array<[number, number]> | null;
  moveCount: number;
}

export type C4Move = { type: 'drop'; col: number };

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
];

function emptyBoard(): Cell[][] {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

/** Lowest empty row in a column, or -1 if the column is full. */
export function landingRow(board: Cell[][], col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === null) return row;
  }
  return -1;
}

/**
 * Only the just-placed disc can create a new line, so we scan outward from it
 * in each of the four axes rather than sweeping the whole board.
 */
export function findWinningLine(
  board: Cell[][],
  row: number,
  col: number,
): Array<[number, number]> | null {
  const player = board[row][col];
  if (player === null) return null;

  for (const [dr, dc] of DIRECTIONS) {
    const line: Array<[number, number]> = [[row, col]];
    for (const sign of [1, -1] as const) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        line.push([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= CONNECT) return line;
  }
  return null;
}

export const connect4: GameDefinition<C4State, C4Move> = {
  id: 'connect4',
  name: 'Connect Four',
  minPlayers: 2,
  maxPlayers: 2,

  // Connect Four has no hidden or random element, so it ignores the rng.
  setup(): C4State {
    return {
      board: emptyBoard(),
      turn: 0,
      winner: null,
      draw: false,
      lastMove: null,
      winningLine: null,
      moveCount: 0,
    };
  },

  applyMove(state, move, seat): MoveResult<C4State> {
    if (state.winner !== null || state.draw) {
      return { ok: false, error: 'The game is already over.' };
    }
    if (seat !== state.turn) {
      return { ok: false, error: "It's not your turn." };
    }
    if (!move || move.type !== 'drop') {
      return { ok: false, error: 'Unknown move.' };
    }
    if (!Number.isInteger(move.col) || move.col < 0 || move.col >= COLS) {
      return { ok: false, error: 'That column does not exist.' };
    }

    const row = landingRow(state.board, move.col);
    if (row === -1) {
      return { ok: false, error: 'That column is full.' };
    }

    const board = state.board.map((r) => r.slice());
    board[row][move.col] = seat as 0 | 1;

    const winningLine = findWinningLine(board, row, move.col);
    const moveCount = state.moveCount + 1;

    return {
      ok: true,
      state: {
        board,
        turn: (seat === 0 ? 1 : 0) as 0 | 1,
        winner: winningLine ? (seat as 0 | 1) : null,
        draw: !winningLine && moveCount === ROWS * COLS,
        lastMove: { row, col: move.col },
        winningLine,
        moveCount,
      },
    };
  },

  turn(state) {
    return this.isOver(state) ? null : state.turn;
  },

  isOver(state) {
    return state.winner !== null || state.draw;
  },

  status(state, names) {
    const nameFor = (seat: 0 | 1) => names[seat] ?? `Player ${seat + 1}`;
    if (state.winner !== null) return `${nameFor(state.winner)} wins`;
    if (state.draw) return 'A draw. The board is full.';
    return `${nameFor(state.turn)}'s turn`;
  },
};
