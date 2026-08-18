import { describe, it, expect } from 'vitest';
import { connect4, landingRow, ROWS, COLS, type C4State } from './connect4.js';
import type { MoveResult } from '../types.js';

// Connect Four ignores the rng the contract now passes; these keep the calls short.
const setup = () => connect4.setup(2, () => 0);
const apply = (state: C4State, move: unknown, seat: number): MoveResult<C4State> =>
  connect4.applyMove(state, move as never, seat, () => 0);

/** Play a sequence of columns, alternating seats, asserting each move is legal. */
function play(cols: number[]): C4State {
  let state = setup();
  for (const col of cols) {
    const result = apply(state, { type: 'drop', col }, state.turn);
    if (!result.ok) throw new Error(`unexpected rejection on col ${col}: ${result.error}`);
    state = result.state;
  }
  return state;
}

describe('setup', () => {
  it('starts with an empty board and seat 0 to move', () => {
    const s = setup();
    expect(s.board.length).toBe(ROWS);
    expect(s.board[0].length).toBe(COLS);
    expect(s.board.flat().every((c) => c === null)).toBe(true);
    expect(s.turn).toBe(0);
    expect(connect4.isOver(s)).toBe(false);
    expect(connect4.turn(s)).toBe(0);
  });
});

describe('gravity', () => {
  it('drops the first disc to the bottom row', () => {
    const s = play([3]);
    expect(s.board[ROWS - 1][3]).toBe(0);
    expect(s.board[ROWS - 2][3]).toBe(null);
    expect(s.lastMove).toEqual({ row: ROWS - 1, col: 3 });
  });

  it('stacks discs upward in the same column', () => {
    const s = play([3, 3, 3]);
    expect(s.board[ROWS - 1][3]).toBe(0);
    expect(s.board[ROWS - 2][3]).toBe(1);
    expect(s.board[ROWS - 3][3]).toBe(0);
  });

  it('reports a full column as unplayable', () => {
    const s = play([0, 0, 0, 0, 0, 0]);
    expect(landingRow(s.board, 0)).toBe(-1);
    const result = apply(s, { type: 'drop', col: 0 }, s.turn);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/full/i);
  });
});

describe('move validation', () => {
  it('rejects a move from the seat that is not to play', () => {
    const s = setup();
    const result = apply(s, { type: 'drop', col: 0 }, 1);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/not your turn/i);
  });

  it.each([-1, COLS, 1.5, NaN])('rejects out-of-range column %p', (col) => {
    const s = setup();
    expect(apply(s, { type: 'drop', col: col as number }, 0).ok).toBe(false);
  });

  it('rejects an unknown move type', () => {
    const s = setup();
    expect(apply(s, { type: 'nope' } as never, 0).ok).toBe(false);
  });

  it('never mutates the state it is given', () => {
    const s = setup();
    const snapshot = JSON.stringify(s);
    apply(s, { type: 'drop', col: 3 }, 0);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe('win detection', () => {
  it('detects a horizontal four', () => {
    // seat 0 fills cols 0-3 on the bottom row; seat 1 stacks harmlessly in col 6
    const s = play([0, 6, 1, 6, 2, 6, 3]);
    expect(s.winner).toBe(0);
    expect(connect4.isOver(s)).toBe(true);
    expect(s.winningLine).toHaveLength(4);
  });

  it('detects a vertical four', () => {
    const s = play([2, 3, 2, 3, 2, 3, 2]);
    expect(s.winner).toBe(0);
  });

  it('detects a rising diagonal', () => {
    // Seat 0 climbs (5,1) (4,2) (3,3) (2,4) while seat 1 supplies the discs
    // underneath and both players park spare discs in safe columns.
    const s = play([0, 2, 1, 3, 2, 3, 0, 4, 3, 4, 0, 4, 4]);
    expect(s.winner).toBe(0);
    expect(s.winningLine).toHaveLength(4);
    expect(new Set(s.winningLine!.map(String))).toEqual(
      new Set([[5, 1], [4, 2], [3, 3], [2, 4]].map(String)),
    );
  });

  it('detects a falling diagonal', () => {
    // The mirror image of the rising case: (5,5) (4,4) (3,3) (2,2).
    const s = play([6, 4, 5, 3, 4, 3, 6, 2, 3, 2, 6, 2, 2]);
    expect(s.winner).toBe(0);
    expect(s.winningLine).toHaveLength(4);
  });

  it('counts a run of five as a win', () => {
    const s = play([0, 6, 1, 6, 2, 6, 4, 5, 3]);
    expect(s.winner).toBe(0);
    expect(s.winningLine!.length).toBeGreaterThanOrEqual(4);
  });

  it('does not fire on three in a row', () => {
    const s = play([0, 6, 1, 6, 2]);
    expect(s.winner).toBe(null);
    expect(s.winningLine).toBe(null);
  });

  it('does not join two players discs into a line', () => {
    const s = play([0, 3, 1, 4, 2]); // seat 0 has 0,1,2 — seat 1 sits at 3
    expect(s.winner).toBe(null);
  });

  it('refuses further moves once won', () => {
    const s = play([0, 6, 1, 6, 2, 6, 3]);
    const result = apply(s, { type: 'drop', col: 5 }, s.turn);
    expect(result.ok).toBe(false);
    expect(connect4.turn(s)).toBe(null);
  });
});

describe('draw', () => {
  it('declares a draw when the board fills with no line', () => {
    // Column-pair pattern that fills all 42 squares without a connect-four.
    const order = [0, 1, 2, 0, 1, 2, 3, 3, 4, 5, 6, 4, 5, 6];
    const cols: number[] = [];
    for (let i = 0; i < 3; i++) cols.push(...order);
    const s = play(cols);
    expect(s.moveCount).toBe(ROWS * COLS);
    expect(s.winner).toBe(null);
    expect(s.draw).toBe(true);
    expect(connect4.isOver(s)).toBe(true);
    expect(connect4.status(s, ['A', 'B'])).toMatch(/draw/i);
  });
});

describe('status line', () => {
  it('names the player to move, then the winner', () => {
    expect(connect4.status(setup(), ['Amelia', 'Sam'])).toBe("Amelia's turn");
    const won = play([0, 6, 1, 6, 2, 6, 3]);
    expect(connect4.status(won, ['Amelia', 'Sam'])).toBe('Amelia wins');
  });
});
