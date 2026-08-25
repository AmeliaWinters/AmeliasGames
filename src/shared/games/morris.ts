import type { GameDefinition, MoveResult } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import {
  MEN,
  MIN_MEN,
  POINTS,
  QUIET_LIMIT,
  REPETITION_LIMIT,
  ADJACENCY,
  hasMove,
  canFly,
  isPoint,
  menLeft,
  millsThrough,
  mustPlace,
  positionKey,
  takeable,
  type Cell,
  type MmMove,
  type MmState,
} from './morrisDisplay.js';

/**
 * Nine Men's Morris: mills, and the whole of the rest of it.
 *
 * The board, the mills and every predicate over a position live in
 * `morrisDisplay.ts`, which the client's board imports too; this file is the
 * rules on top of them. The re-exports below let the tests and the server
 * import a game from one module.
 *
 * The game runs in two phases, per player rather than global: while you have
 * men in hand you place one, and once your hand is empty you move one. They do
 * not change over on the same ply, since seat 0 places their ninth man a ply
 * before seat 1 does, so a single `phase` field would be wrong for one of the
 * players for exactly one move. `hand` is the phase, and `mustPlace` asks it.
 *
 * Closing a mill, three of your men on one of the sixteen lines, takes one of
 * the opponent's men off for good. That take is a move of its own, so a mill
 * is two moves by the same seat.
 *
 * A player loses when they are down to two men, or when they cannot move. Both
 * are checked when the turn changes hands, the only moment either can become
 * true.
 *
 * Two draws exist because the game needs them: threefold repetition, and fifty
 * moves each without a man being taken. Without those, two players who both
 * refuse to break a mill are in a room that never ends.
 *
 * No randomness and no clock, so `rng` and `now` go unused.
 */

export {
  ADJACENCY,
  MEN,
  MILLS,
  MILLS_AT,
  MIN_MEN,
  POINTS,
  QUIET_LIMIT,
  REPETITION_LIMIT,
  RINGS,
  SPOTS,
  hasMove,
  canFly,
  destinations,
  inMill,
  isPoint,
  menLeft,
  menOnBoard,
  millsThrough,
  movers,
  mustPlace,
  pointAt,
  pointName,
  pointXY,
  positionKey,
  ring,
  spot,
  takeable,
} from './morrisDisplay.js';
export type { Cell, MmEnding, MmLast, MmMove, MmState } from './morrisDisplay.js';

function other(seat: 0 | 1): 0 | 1 {
  return seat === 0 ? 1 : 0;
}

function isOver(state: MmState): boolean {
  return state.winner !== null || state.draw;
}

/**
 * Hand the turn over, and see whether that is the end of the game.
 *
 * Everything that can finish a game finishes it here, because the turn
 * changing is the only moment any of it can become true. A player is not
 * beaten for being down to two men *during* their opponent's mill; they are
 * beaten when it is their turn, they have two men, and there is nothing to do
 * with them.
 *
 * `irreversible` marks a ply no later position can undo: a placement, or a man
 * taken off. Both reset the draw counters, since nothing before them can come
 * round again.
 */
function handOver(state: MmState, mover: 0 | 1, irreversible: boolean): MmState {
  const next = other(mover);

  // Down to two men, in hand and on the board together. A player with two on
  // the board and a stack still to place is not beaten; a player with two of
  // each is not beaten either, since the ninth man may yet make a mill.
  if (menLeft(state, next) < MIN_MEN) {
    return { ...state, winner: mover, ending: 'starved' };
  }

  const passed: MmState = { ...state, turn: next };

  // Walled in. Only possible once a player has run out of men to place, and
  // never possible for a flying player, who can always reach an empty point.
  if (!hasMove(passed, next)) {
    return { ...passed, winner: mover, ending: 'blocked' };
  }

  // The draw counters only run once both players are moving men about. While
  // anybody still has a man in hand the position cannot repeat, because every
  // placement puts one more man on the board than the last time round.
  const settled = passed.hand[0] === 0 && passed.hand[1] === 0;
  if (!settled || irreversible) {
    const seen = settled ? { [positionKey(passed)]: 1 } : {};
    return { ...passed, quiet: 0, seen };
  }

  const key = positionKey(passed);
  const count = (passed.seen[key] ?? 0) + 1;
  const counted: MmState = {
    ...passed,
    quiet: passed.quiet + 1,
    seen: { ...passed.seen, [key]: count },
  };

  if (count >= REPETITION_LIMIT) {
    return { ...counted, draw: true, ending: 'repetition' };
  }
  if (counted.quiet >= QUIET_LIMIT) {
    return { ...counted, draw: true, ending: 'quiet' };
  }
  return counted;
}

/**
 * Follow a man landing on `to` with whatever it caused: a mill and the take it
 * owes, or the turn passing on.
 *
 * A line through `to` that is complete now was not complete before, whatever
 * the man did to get there, because `to` was empty a moment ago and could not
 * have held the third man of its own mill. That is why closing a mill needs no
 * comparison against the previous position, and why stepping a man out of a
 * mill and straight back in closes it again. The repetition rule is what stops
 * that being an infinite supply of men, and the reason this reducer counts
 * positions at all.
 */
function afterLanding(state: MmState, mover: 0 | 1, to: number, irreversible: boolean): MmState {
  const closed = millsThrough(state.board, to);
  if (closed.length === 0) {
    return handOver({ ...state, closed: null }, mover, irreversible);
  }

  const marked: MmState = { ...state, closed: [...new Set(closed.flat())] };

  // Two mills at once still take one man: it is one mill-closing move, not
  // two. And a mill closed against an opponent with nothing takeable (which
  // needs them to have no men on the board at all) takes nothing rather than
  // stalling the game on a move that cannot be made.
  if (takeable(marked.board, other(mover)).length === 0) {
    return handOver(marked, mover, irreversible);
  }

  return { ...marked, taking: mover };
}

export const morris: GameDefinition<MmState, MmMove> = {
  id: GAME_MANIFEST.morris.id,
  name: GAME_MANIFEST.morris.name,
  minPlayers: 2,
  maxPlayers: 2,

  setup(): MmState {
    return {
      board: Array<Cell>(POINTS).fill(null),
      hand: [MEN, MEN],
      turn: 0,
      taking: null,
      winner: null,
      draw: false,
      ending: null,
      lastMove: null,
      closed: null,
      quiet: 0,
      seen: {},
    };
  },

  applyMove(state, move, seat): MoveResult<MmState> {
    if (isOver(state)) {
      return { ok: false, error: 'The game is already over.' };
    }
    if (seat !== state.turn) {
      return { ok: false, error: "It's not your turn." };
    }
    if (!move || typeof move !== 'object' || typeof (move as MmMove).type !== 'string') {
      return { ok: false, error: 'Unknown move.' };
    }

    const mover = seat as 0 | 1;

    // A mill is owed a man, and nothing else may happen until it has been
    // taken. Checked before the move's own type, so a player who tries to
    // carry on is told what the board is actually waiting for.
    if (state.taking !== null) {
      if (move.type !== 'take') {
        return { ok: false, error: 'You closed a mill, so take one of their men.' };
      }
      if (!isPoint(move.at)) {
        return { ok: false, error: 'That point does not exist.' };
      }
      if (state.board[move.at] !== other(mover)) {
        return { ok: false, error: 'That is not one of their men.' };
      }
      if (!takeable(state.board, other(mover)).includes(move.at)) {
        // The only reason a man of theirs is untakeable.
        return { ok: false, error: 'That man is in a mill. Take one that is not.' };
      }

      const board = state.board.slice();
      board[move.at] = null;
      return {
        ok: true,
        state: handOver(
          {
            ...state,
            board,
            taking: null,
            closed: null,
            lastMove: { type: 'take', at: move.at },
          },
          mover,
          true,
        ),
      };
    }

    if (mustPlace(state, mover)) {
      if (move.type !== 'place') {
        return { ok: false, error: 'You still have men to place.' };
      }
      if (!isPoint(move.to)) {
        return { ok: false, error: 'That point does not exist.' };
      }
      if (state.board[move.to] !== null) {
        return { ok: false, error: 'There is already a man there.' };
      }

      const board = state.board.slice();
      board[move.to] = mover;
      const hand: [number, number] = [...state.hand];
      hand[mover] -= 1;

      return {
        ok: true,
        state: afterLanding(
          { ...state, board, hand, lastMove: { type: 'place', to: move.to } },
          mover,
          move.to,
          true,
        ),
      };
    }

    if (move.type !== 'move') {
      return { ok: false, error: 'You have no men left to place, so move one.' };
    }
    if (!isPoint(move.from) || !isPoint(move.to)) {
      return { ok: false, error: 'That point does not exist.' };
    }
    if (state.board[move.from] !== mover) {
      return { ok: false, error: 'That is not one of your men.' };
    }
    if (state.board[move.to] !== null) {
      return { ok: false, error: 'That point is taken.' };
    }
    if (!canFly(state, mover) && !ADJACENCY[move.from].includes(move.to)) {
      return {
        ok: false,
        error: 'A man moves to a point next to him, along a line.',
      };
    }

    const board = state.board.slice();
    board[move.from] = null;
    board[move.to] = mover;

    return {
      ok: true,
      state: afterLanding(
        { ...state, board, lastMove: { type: 'move', from: move.from, to: move.to } },
        mover,
        move.to,
        false,
      ),
    };
  },

  turn(state) {
    // Deliberately not `this.isOver`: GameDefinition promises nothing about
    // method binding, so a destructured `turn` would throw.
    return isOver(state) ? null : state.turn;
  },

  canAct(state, seat) {
    return !isOver(state) && state.turn === seat;
  },

  isOver,

  status(state, names) {
    const nameFor = (seat: 0 | 1) => names[seat] ?? `Player ${seat + 1}`;

    if (state.winner !== null) {
      const loser = nameFor(other(state.winner));
      const how =
        state.ending === 'blocked' ? `${loser} has no move left` : `${loser} is down to two men`;
      return `${nameFor(state.winner)} wins: ${how}`;
    }
    if (state.draw) {
      return state.ending === 'repetition'
        ? 'A draw. The same position, three times over.'
        : 'A draw. Fifty moves each and nobody has taken a man.';
    }
    if (state.taking !== null) {
      return `${nameFor(state.taking)} has a mill and is taking one of their men`;
    }
    if (mustPlace(state, state.turn)) {
      const left = state.hand[state.turn];
      return `${nameFor(state.turn)} to place, ${left} ${left === 1 ? 'man' : 'men'} in hand`;
    }
    if (canFly(state, state.turn)) {
      return `${nameFor(state.turn)} to fly, three men left`;
    }
    return `${nameFor(state.turn)} to move`;
  },
};
