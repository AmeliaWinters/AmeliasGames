import type { GameDefinition, MoveResult } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { named } from '../refusal.js';
import {
  CELLS,
  SPOTS,
  boardName,
  boardOf,
  cellAt,
  isCell,
  isFull,
  isOpen,
  lineThrough,
  spotOf,
  tally,
  type Cell,
  type Line,
  type Result,
  type UtEnding,
  type UtMove,
  type UtState,
} from './ultimateDisplay.js';

/**
 * Ultimate Tic-Tac-Toe — nine small boards, and your move picks the one your
 * opponent has to play in next.
 *
 * The geometry, the eight lines and every predicate over a position live in
 * `ultimateDisplay.ts`, which the client's board imports too; this file is the
 * rules on top of them. Everything it re-exports below is so the tests and the
 * server carry on importing a game from one module.
 *
 * The whole game is three sentences. Play a square in the board you were sent
 * to. The square you choose — top-left, centre, whichever — is the board your
 * opponent must play in next. Win three small boards in a row and you win.
 *
 * Two of the three variants people argue about are settled here, and they are
 * settled the way the tournament rule settles them:
 *
 *   - Sent to a board that is already settled? Play anywhere. The alternative
 *     is a rule that needs a second sentence to explain, and the second
 *     sentence is what this game is trying not to have.
 *   - A small board that fills with no line in it counts for nobody. It is
 *     dead ground, and the big board's line cannot run through it.
 *
 * The third — what happens when every board is settled and nobody has three in
 * a row — is settled by counting boards, so a game that goes the distance
 * still ends with a result. Level on boards is the only draw.
 *
 * A stalemate cannot arise: a settled board frees the mover to go anywhere,
 * and while any board is unsettled it has an empty square in it. So the only
 * way play stops is one of the endings above.
 *
 * No randomness and no clock, so `rng` and `now` go unused.
 */

export {
  CELLS,
  LINES,
  SPOTS,
  boardName,
  boardOf,
  cellAt,
  cellName,
  isBoard,
  isCell,
  isFull,
  isOpen,
  legal,
  lineThrough,
  openBoards,
  spotOf,
  tally,
} from './ultimateDisplay.js';
export type { Cell, Line, Result, UtEnding, UtMove, UtState } from './ultimateDisplay.js';

function emptyBoard(): Cell[] {
  return Array<Cell>(CELLS).fill(null);
}

function isOver(state: UtState): boolean {
  return state.winner !== null || state.draw;
}

function other(seat: 0 | 1): 0 | 1 {
  return seat === 0 ? 1 : 0;
}

export const ultimate: GameDefinition<UtState, UtMove> = {
  id: GAME_MANIFEST.ultimate.id,
  name: GAME_MANIFEST.ultimate.name,
  minPlayers: 2,
  maxPlayers: 2,

  // Nothing hidden and nothing random, so the rng goes unused.
  setup(): UtState {
    return {
      board: emptyBoard(),
      results: Array<Result>(SPOTS).fill(null),
      lines: Array<Line | null>(SPOTS).fill(null),
      // The opening move is a free choice, which is the one time `sent` is
      // null without a board having been spent to make it so.
      sent: null,
      turn: 0,
      winner: null,
      draw: false,
      ending: null,
      lastMove: null,
      winningLine: null,
      moveCount: 0,
    };
  },

  applyMove(state, move, seat): MoveResult<UtState> {
    if (isOver(state)) {
      return { ok: false, error: 'The game is already over.' };
    }
    if (seat !== state.turn) {
      return { ok: false, error: "It's not your turn." };
    }
    if (!move || move.type !== 'play') {
      return { ok: false, error: 'Unknown move.' };
    }
    if (!isCell(move.cell)) {
      return { ok: false, error: `There is no square ${named(move.cell)}.` };
    }

    const small = boardOf(move.cell);
    if (state.sent !== null && small !== state.sent) {
      // Naming the board is the whole of the error: a player who has missed
      // where they were sent has missed the only rule this game has.
      return { ok: false, error: `You were sent to the ${boardName(state.sent)}.` };
    }
    // Named for the same reason the "sent" refusal above is: on a board of
    // boards, "that board" and "that square" are ambiguous in a way they are
    // not in any other game here -- there are nine of each.
    if (!isOpen(state, small)) {
      return { ok: false, error: `The ${boardName(small)} is already settled.` };
    }
    if (state.board[move.cell] !== null) {
      return { ok: false, error: `That square in the ${boardName(small)} is taken.` };
    }

    const mover = seat as 0 | 1;
    const board = state.board.slice();
    board[move.cell] = mover;

    const results = state.results.slice();
    const lines = state.lines.slice();
    const spot = spotOf(move.cell);

    const smallLine = lineThrough((position) => board[cellAt(small, position)], mover, spot);
    if (smallLine) {
      results[small] = mover;
      lines[small] = smallLine;
    } else if (isFull(board, small)) {
      // Full and unwon: dead ground. Nobody's line runs through it, and
      // nobody may play in it again.
      results[small] = 'drawn';
    }

    // Only a board that has just been won can complete a line on the big one,
    // and `small` is the only board that changed hands.
    const winningLine =
      results[small] === mover ? lineThrough((position) => results[position], mover, small) : null;

    let winner: 0 | 1 | null = winningLine ? mover : null;
    let draw = false;
    let ending: UtEnding | null = winningLine ? 'line' : null;

    if (winner === null && results.every((result) => result !== null)) {
      // Every board settled and no line: the boards themselves are the count.
      const [zero, one] = tally({ ...state, results });
      if (zero === one) {
        draw = true;
        ending = 'level';
      } else {
        winner = zero > one ? 0 : 1;
        ending = 'count';
      }
    }

    return {
      ok: true,
      state: {
        board,
        results,
        lines,
        // A move points at the board of the same name as the square played.
        // If that board is spent, the opponent goes anywhere — which is the
        // one place that rule is written down.
        sent: results[spot] === null ? spot : null,
        turn: other(mover),
        winner,
        draw,
        ending,
        lastMove: move.cell,
        winningLine,
        moveCount: state.moveCount + 1,
      },
    };
  },

  turn(state) {
    // Deliberately not `this.isOver` — GameDefinition promises nothing about
    // method binding, so a destructured `turn` would throw.
    return isOver(state) ? null : state.turn;
  },

  canAct(state, seat) {
    return !isOver(state) && state.turn === seat;
  },

  isOver,

  status(state, names) {
    const nameFor = (seat: 0 | 1) => names[seat] ?? `Player ${seat + 1}`;
    const [zero, one] = tally(state);

    if (state.winner !== null) {
      if (state.ending === 'line') {
        return `${nameFor(state.winner)} wins — three boards in a row`;
      }
      const mine = state.winner === 0 ? zero : one;
      const theirs = state.winner === 0 ? one : zero;
      return `${nameFor(state.winner)} wins — ${mine} boards to ${theirs}`;
    }
    if (state.draw) {
      return `A draw. ${zero} boards each.`;
    }
    if (state.sent === null) {
      // Two different ways to be free — the opening move, and a board that has
      // been spent — and from the mover's side they are the same instruction.
      return `${nameFor(state.turn)} to play — any open board`;
    }
    return `${nameFor(state.turn)} to play — the ${boardName(state.sent)}`;
  },
};
