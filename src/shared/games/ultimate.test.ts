import { describe, expect, it } from 'vitest';
import {
  cellAt,
  cellName,
  legal,
  openBoards,
  tally,
  ultimate,
  type UtMove,
  type UtState,
} from './ultimate.js';

const rng = () => 0.5;

function start(): UtState {
  return ultimate.setup(2, rng);
}

/** Play a run of squares, alternating seats, and insist every one is legal. */
function play(state: UtState, ...cells: number[]): UtState {
  let next = state;
  for (const cell of cells) {
    const seat = next.turn;
    const result = ultimate.applyMove(next, { type: 'play', cell }, seat, rng);
    if (!result.ok) throw new Error(`${cellName(cell)} was refused: ${result.error}`);
    next = result.state;
  }
  return next;
}

function refuse(state: UtState, move: UtMove, seat = state.turn): string {
  const result = ultimate.applyMove(state, move, seat, rng);
  if (result.ok) throw new Error('that move was allowed');
  return result.error;
}

/** Hand a small board to a seat on its top row, leaving the turn as it was. */
function winTopRow(state: UtState, small: number, seat: 0 | 1): UtState {
  const board = state.board.slice();
  const results = state.results.slice();
  const lines = state.lines.slice();
  for (const spot of [0, 1, 2]) board[cellAt(small, spot)] = seat;
  results[small] = seat;
  lines[small] = [0, 1, 2];
  return { ...state, board, results, lines };
}

describe('the opening', () => {
  it('starts empty, with seat 0 free to play anywhere', () => {
    const state = start();
    expect(state.board.filter((cell) => cell !== null)).toEqual([]);
    expect(state.results).toEqual(Array(9).fill(null));
    expect(state.sent).toBeNull();
    expect(state.turn).toBe(0);
    expect(openBoards(state)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('refuses a move from the seat whose turn it is not', () => {
    expect(refuse(start(), { type: 'play', cell: 0 }, 1)).toMatch(/not your turn/i);
  });
});

describe('the one rule', () => {
  it('sends the opponent to the board named by the square played', () => {
    // The centre of the top-left board. Its square index is 4, so the reply
    // has to be played in board 4 — the centre board.
    const state = play(start(), cellAt(0, 4));
    expect(state.sent).toBe(4);
    expect(openBoards(state)).toEqual([4]);
  });

  it('turns a move in the wrong board away, and says which board', () => {
    const state = play(start(), cellAt(0, 4));
    expect(refuse(state, { type: 'play', cell: cellAt(7, 0) })).toBe(
      'You were sent to the centre board.',
    );
  });

  it('sends a player back into the board they were just sent to', () => {
    // Square 4 of board 4 is the centre of the centre board: it sends the
    // opponent straight back to where they already are.
    const state = play(start(), cellAt(0, 4), cellAt(4, 4));
    expect(state.sent).toBe(4);
    expect(legal(state, cellAt(4, 0))).toBe(true);
    expect(legal(state, cellAt(4, 4))).toBe(false);
  });

  it('refuses a square that is already taken', () => {
    const state = play(start(), cellAt(0, 4), cellAt(4, 0));
    expect(refuse(state, { type: 'play', cell: cellAt(0, 4) })).toMatch(/taken/i);
  });
});

describe('a settled board', () => {
  it('frees the opponent to play anywhere when they are sent to it', () => {
    // Board 3 has already gone to seat 1, and seat 0 now plays square 3 —
    // which points at it. The tournament rule: play anywhere instead.
    const state = winTopRow(start(), 3, 1);
    const next = play(state, cellAt(0, 3));
    expect(next.sent).toBeNull();
    expect(openBoards(next)).toEqual([0, 1, 2, 4, 5, 6, 7, 8]);
  });

  it('is closed to further play even when it still has empty squares', () => {
    // The top row won it; the other six squares are unplayable all the same.
    const state = winTopRow(start(), 0, 1);
    expect(legal(state, cellAt(0, 8))).toBe(false);
    expect(refuse(state, { type: 'play', cell: cellAt(0, 8) })).toMatch(/already settled/i);
  });
});

describe('winning a small board', () => {
  it('records the seat and the three squares that did it', () => {
    // Seat 0 takes the top row of board 0; every reply is played where the
    // last move sent it, so this is a run of nine legal moves and not a
    // position dropped onto the board.
    const state = play(
      start(),
      cellAt(0, 0), // sends seat 1 to board 0
      cellAt(0, 3), // sends seat 0 to board 3
      cellAt(3, 1), // sends seat 1 to board 1
      cellAt(1, 0), // sends seat 0 to board 0
      cellAt(0, 1), // sends seat 1 to board 1
      cellAt(1, 3), // sends seat 0 to board 3
      cellAt(3, 2), // sends seat 1 to board 2
      cellAt(2, 0), // sends seat 0 to board 0
      cellAt(0, 2), // the top row of board 0
    );
    expect(state.results[0]).toBe(0);
    expect(state.lines[0]).toEqual([0, 1, 2]);
    expect(tally(state)).toEqual([1, 0]);
    expect(state.winner).toBeNull();
  });

  it('counts a board that fills with no line in it for nobody', () => {
    // A full board, drawn: X O X / X O O / O X X has no three in a row.
    const marks: Array<0 | 1> = [0, 1, 0, 0, 1, 1, 1, 0, 0];
    const board = start().board.slice();
    marks.forEach((seat, spot) => {
      if (spot !== 8) board[cellAt(0, spot)] = seat;
    });
    // Seat 0 fills the last square of board 0, having been sent there.
    const state: UtState = { ...start(), board, sent: 0, turn: 0 };
    const next = play(state, cellAt(0, 8));
    expect(next.results[0]).toBe('drawn');
    expect(tally(next)).toEqual([0, 0]);
    // Dead ground: it is neither playable nor available to a line.
    expect(openBoards(next)).not.toContain(0);
  });
});

describe('winning the game', () => {
  it('is three boards in a row', () => {
    // Seat 0 already holds boards 0 and 1; taking board 2 completes the top
    // row of the big board.
    let state = winTopRow(start(), 0, 0);
    state = winTopRow(state, 1, 0);
    state = { ...state, sent: 2, turn: 0 };
    const board = state.board.slice();
    board[cellAt(2, 0)] = 0;
    board[cellAt(2, 1)] = 0;
    const next = play({ ...state, board }, cellAt(2, 2));
    expect(next.winner).toBe(0);
    expect(next.ending).toBe('line');
    expect(next.winningLine).toEqual([0, 1, 2]);
    expect(ultimate.isOver(next)).toBe(true);
    expect(ultimate.turn(next)).toBeNull();
    expect(ultimate.status(next, ['Amelia', 'Bo'])).toBe('Amelia wins — three boards in a row');
  });

  it('refuses any further move once it is over', () => {
    let state = winTopRow(start(), 0, 0);
    state = winTopRow(state, 1, 0);
    state = winTopRow(state, 2, 0);
    state = { ...state, winner: 0, ending: 'line', winningLine: [0, 1, 2] };
    expect(refuse(state, { type: 'play', cell: cellAt(4, 4) })).toMatch(/already over/i);
    expect(legal(state, cellAt(4, 4))).toBe(false);
  });

  it('goes to whoever holds more boards when every board is settled', () => {
    // Boards 0-7 shared out four each with no line in either hand, and seat 0
    // takes the ninth. Seat 0 ends 5-4 up with nothing three in a row — and
    // neither hand holds a line at any point on the way, so this is a
    // position the game could actually have reached.
    let state = start();
    const owners: Array<0 | 1> = [1, 0, 1, 0, 0, 1, 0, 1];
    owners.forEach((seat, small) => {
      state = winTopRow(state, small, seat);
    });
    state = { ...state, sent: 8, turn: 0 };
    const board = state.board.slice();
    board[cellAt(8, 0)] = 0;
    board[cellAt(8, 1)] = 0;
    const next = play({ ...state, board }, cellAt(8, 2));
    expect(next.winningLine).toBeNull();
    expect(next.winner).toBe(0);
    expect(next.ending).toBe('count');
    expect(tally(next)).toEqual([5, 4]);
    expect(ultimate.status(next, ['Amelia', 'Bo'])).toBe('Amelia wins — 5 boards to 4');
  });

  it('is a draw only when the two are level on boards', () => {
    // Four each and one board dead: nobody has a line, and nobody is ahead.
    let state = start();
    const owners: Array<0 | 1> = [1, 0, 1, 0, 0, 1, 0, 1];
    owners.forEach((seat, small) => {
      state = winTopRow(state, small, seat);
    });
    // Board 8 fills without a line: X O X / X O O / O X X.
    const marks: Array<0 | 1> = [0, 1, 0, 0, 1, 1, 1, 0, 0];
    const board = state.board.slice();
    marks.forEach((seat, spot) => {
      if (spot !== 8) board[cellAt(8, spot)] = seat;
    });
    const next = play({ ...state, board, sent: 8, turn: 0 }, cellAt(8, 8));
    expect(next.results[8]).toBe('drawn');
    expect(next.draw).toBe(true);
    expect(next.ending).toBe('level');
    expect(next.winner).toBeNull();
    expect(ultimate.status(next, ['Amelia', 'Bo'])).toBe('A draw. 4 boards each.');
  });
});

describe('the reducer itself', () => {
  it('never mutates the state it is given', () => {
    const state = start();
    const before = JSON.stringify(state);
    play(state, cellAt(4, 4), cellAt(4, 0));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('turns away nonsense without throwing', () => {
    const state = start();
    for (const move of [undefined, null, {}, { type: 'drop' }, { type: 'play' }] as unknown[]) {
      expect(ultimate.applyMove(state, move as UtMove, 0, rng).ok).toBe(false);
    }
    for (const cell of [-1, 81, 4.5, NaN, '4', Infinity] as unknown[]) {
      expect(
        ultimate.applyMove(state, { type: 'play', cell } as UtMove, 0, rng).ok,
        String(cell),
      ).toBe(false);
    }
  });

  it('says where the mover has to play, in words', () => {
    const names = ['Amelia', 'Bo'];
    expect(ultimate.status(start(), names)).toBe('Amelia to play — any open board');
    expect(ultimate.status(play(start(), cellAt(0, 6)), names)).toBe(
      'Bo to play — the bottom-left board',
    );
  });

  it('names a square by its board and its place in it', () => {
    // "centre" alone names nine different squares, which is nine too many.
    expect(cellName(cellAt(0, 4))).toBe('centre of the top-left board');
    expect(cellName(cellAt(8, 0))).toBe('top left of the bottom-right board');
  });

  it('plays two hundred games out without ever offering an illegal square', () => {
    // A walk that stops only when the game says it has. It would trip on any
    // position where `legal` and `applyMove` disagreed, on a stalemate the
    // rules cannot express, and on any ending that leaves the game open —
    // which is the set of bugs a fixed position cannot reach.
    for (let game = 0; game < 200; game++) {
      let state = start();
      let seed = (game * 2654435761) >>> 0;
      let plies = 0;
      while (!ultimate.isOver(state)) {
        const choices: number[] = [];
        for (let cell = 0; cell < 81; cell++) if (legal(state, cell)) choices.push(cell);
        expect(choices.length, `ply ${plies} of game ${game}`).toBeGreaterThan(0);
        seed = (seed * 1103515245 + 12345) >>> 0;
        const result = ultimate.applyMove(
          state,
          { type: 'play', cell: choices[seed % choices.length] },
          state.turn,
          rng,
        );
        expect(result.ok, `ply ${plies} of game ${game}`).toBe(true);
        if (!result.ok) break;
        state = result.state;
        plies++;
        expect(plies).toBeLessThanOrEqual(81);
      }
      expect(['line', 'count', 'level']).toContain(state.ending);
    }
  });
});
