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
    const s = play([0, 3, 1, 4, 2]); // seat 0 has 0,1,2 and seat 1 sits at 3
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

describe('seat 1', () => {
  // Every other win test here has seat 0 winning, so `winner: seat` hardcoded
  // to 0 would pass the whole file.
  it('wins on its own four in a row', () => {
    // Seat 0 stacks column 0; seat 1 builds a row along the bottom.
    const state = play([0, 1, 0, 2, 0, 3, 6, 4]);
    expect(state.winner).toBe(1);
    expect(connect4.isOver(state)).toBe(true);
    expect(connect4.turn(state)).toBeNull();
    expect(state.winningLine).not.toBeNull();
    for (const [row, col] of state.winningLine!) {
      expect(state.board[row][col]).toBe(1);
    }
  });
});

describe('turn', () => {
  it('returns null once the board is a draw', () => {
    const drawn: C4State = { ...setup(), draw: true, moveCount: ROWS * COLS };
    expect(connect4.isOver(drawn)).toBe(true);
    expect(connect4.turn(drawn)).toBeNull();
  });

  it('survives being pulled off the definition', () => {
    // GameDefinition promises nothing about method binding; a `this` in here
    // would throw the moment anyone destructured it.
    const { turn } = connect4;
    expect(() => turn(setup())).not.toThrow();
    expect(turn(setup())).toBe(0);
  });
});

describe('full games', () => {
  /** Small deterministic rng, so a failure is reproducible from its seed. */
  function seeded(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 2 ** 32;
    };
  }

  it('plays 200 random games to completion without breaking an invariant', () => {
    for (let game = 0; game < 200; game++) {
      const rng = seeded(game * 2654435761 + 7);
      let state = setup();
      let moves = 0;

      while (!connect4.isOver(state) && moves < ROWS * COLS) {
        const open = Array.from({ length: COLS }, (_, col) => col).filter(
          (col) => landingRow(state.board, col) !== -1,
        );
        expect(open.length, `game ${game}: no legal column but not over`).toBeGreaterThan(0);
        const col = open[Math.floor(rng() * open.length)];

        const result = apply(state, { type: 'drop', col }, state.turn);
        expect(result.ok, `game ${game}: legal column ${col} was rejected`).toBe(true);
        if (!result.ok) return;
        state = result.state;
        moves++;

        const discs = state.board.flat().filter((cell) => cell !== null).length;
        expect(discs, `game ${game}: moveCount and discs disagree`).toBe(state.moveCount);
        expect(state.moveCount).toBe(moves);

        // No column ever holds more than ROWS, and no disc ever floats.
        for (let c = 0; c < COLS; c++) {
          const column = Array.from({ length: ROWS }, (_, r) => state.board[r][c]);
          const filled = column.filter((cell) => cell !== null).length;
          expect(filled).toBeLessThanOrEqual(ROWS);
          // Everything below the topmost disc must also be occupied.
          for (let r = ROWS - filled; r < ROWS; r++) expect(column[r]).not.toBeNull();
        }
      }

      expect(connect4.isOver(state), `game ${game} never finished`).toBe(true);
      // Exactly one ending, never both.
      expect(state.winner !== null).not.toBe(state.draw);
      expect(connect4.turn(state)).toBeNull();

      if (state.winner !== null) {
        expect(state.winningLine).not.toBeNull();
        // Five in a row is a win too, and the line reports the whole run.
        expect(state.winningLine!.length).toBeGreaterThanOrEqual(4);
        for (const [row, col] of state.winningLine!) {
          expect(state.board[row][col], `game ${game}: winning line is not the winner's`).toBe(
            state.winner,
          );
        }
      } else {
        expect(state.moveCount).toBe(ROWS * COLS);
        expect(state.winningLine).toBeNull();
      }
    }
  });
});
