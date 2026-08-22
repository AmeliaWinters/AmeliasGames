import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { throwNext } from './dice.js';
import {
  CATEGORIES,
  CATEGORY_NAME,
  DICE,
  YAHTZEE_TRAY,
  EXTRA_YAHTZEE,
  ROLLS,
  YAHTZEE,
  emptySheet,
  hasRolled,
  isComplete,
  isYahtzee,
  jokerApplies,
  legalCategories,
  scoreFor,
  total,
  upperFor,
} from './yahtzeeDisplay.js';

import type { Category, Sheet, YMove, YState } from './yahtzeeDisplay.js';
import type { Toss } from './toss.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while the board still takes them from the display module.
export {
  CATEGORIES,
  CATEGORY_NAME,
  DICE,
  EXTRA_YAHTZEE,
  FACES,
  FULL_HOUSE,
  LARGE_STRAIGHT,
  LOWER,
  ROLLS,
  SMALL_STRAIGHT,
  UPPER,
  UPPER_BONUS,
  UPPER_TARGET,
  YAHTZEE,
  YAHTZEE_TRAY,
  counts,
  emptySheet,
  hasRolled,
  isComplete,
  isUpper,
  isYahtzee,
  jokerApplies,
  legalCategories,
  scoreFor,
  total,
  upperBonus,
  upperFor,
  upperSubtotal,
} from './yahtzeeDisplay.js';
export type { Category, Note, Sheet, UpperCategory, YMove, YState } from './yahtzeeDisplay.js';

/**
 * Yahtzee, for two to four.
 *
 * Thirteen rounds. On your turn you roll five dice, keep what you like and
 * roll the rest up to twice more, then write the hand into one of your
 * thirteen boxes — which is the whole game, because every box can be used once
 * and a hand that fits nowhere useful has to be crossed off somewhere.
 *
 * The scoring itself lives in `yahtzeeDisplay.ts`, which is arithmetic over
 * five numbers and nothing else. What is left here is the turn: whose it is,
 * how many rolls they have left, which boxes they may legally use, and the
 * bookkeeping at the end of it.
 *
 * ── The parts casual implementations drop ──────────────────────────────
 *
 * **The Yahtzee bonus.** A second Yahtzee is worth 100 on top of whatever box
 * it fills — but only to a player whose Yahtzee box actually scored 50. Cross
 * Yahtzee off for zero and later Yahtzees earn you nothing.
 *
 * **The joker rules.** They are what makes that second Yahtzee playable at
 * all, and they constrain the *choice*, not just the score: the matching upper
 * box first if it is open, otherwise any open lower box (where full house and
 * the straights pay face value, since the hand cannot form them), and only
 * with the lower section full may an upper box be crossed off. They apply
 * whenever the Yahtzee box is filled, including when it was filled with a
 * zero — the bonus and the placement rule are separate things.
 *
 * `legalCategories` is therefore part of the rules rather than a convenience:
 * the board greys out boxes with it, and `applyMove` refuses them with it, so
 * a hand-rolled client gains nothing by ignoring the grey.
 */

const SEATS = {
  min: GAME_MANIFEST.yahtzee.minPlayers,
  max: GAME_MANIFEST.yahtzee.maxPlayers,
};

/**
 * Throw the dice that are not being kept, and see what they say.
 *
 * The faces are read off the cubes where they stop — see `dice.ts`. A die
 * being kept stays where it is, so the simulation hands its own face straight
 * back and there is nothing to merge.
 */
function throwDice(
  state: YState,
  flick: unknown,
  rng: Rng,
): { toss: Toss; dice: number[] } {
  const keeping = hasRolled(state) ? state.held : Array<boolean>(DICE).fill(false);
  const thrown = throwNext({
    previous: state.toss,
    flick,
    rng,
    tray: YAHTZEE_TRAY,
    count: DICE,
    held: keeping,
  });
  // A kept die's face comes from the record rather than from the cube the
  // simulation left standing there. They agree in play — the cube is where
  // the throw that produced that face left it — and this is what keeps them
  // agreeing if they ever come apart, since `dice` is the thing the score is
  // computed from.
  return {
    toss: thrown.toss,
    dice: thrown.faces.map((face, i) => (keeping[i] ? state.dice[i] : face)),
  };
}

/**
 * A turn ends with the dice swept off the table. Leaving them would show the
 * next player a hand that is not theirs, and leaving `held` set would silently
 * keep dice they never chose.
 */
function endTurn(state: YState, seats: number): { turn: number; round: number } {
  const turn = (state.turn + 1) % seats;
  // Seat 0 opens every round, so the round ticks over as the turn wraps.
  return { turn, round: turn === 0 ? state.round + 1 : state.round };
}

function winnersOf(sheets: readonly Sheet[], extras: readonly number[]): number[] {
  const totals = sheets.map((sheet, seat) => total(sheet, extras[seat]));
  const best = Math.max(...totals);
  return totals.flatMap((score, seat) => (score === best ? [seat] : []));
}

function isOver(state: YState): boolean {
  return state.over;
}

function roll(state: YState, flick: unknown, rng: Rng): MoveResult<YState> {
  if (state.rollsLeft <= 0) {
    return { ok: false, error: 'No rolls left — the hand has to go somewhere.' };
  }
  // Keeping all five and rolling again spent a roll and changed nothing: the
  // dice were identical, the board did not move, and the only evidence was
  // the button counting down. That is not a roll, so it is not allowed to
  // cost one.
  if (hasRolled(state) && state.held.every(Boolean)) {
    return { ok: false, error: 'You are keeping all five — there is nothing to throw.' };
  }
  const thrown = throwDice(state, flick, rng);
  return {
    ok: true,
    state: {
      ...state,
      dice: thrown.dice,
      toss: thrown.toss,
      rollsLeft: state.rollsLeft - 1,
      note: null,
    },
  };
}

function hold(state: YState, index: unknown): MoveResult<YState> {
  if (!hasRolled(state)) return { ok: false, error: 'Roll the dice first.' };
  if (state.rollsLeft <= 0) {
    return { ok: false, error: 'Nothing left to roll, so nothing left to keep.' };
  }
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= DICE) {
    return { ok: false, error: 'That die does not exist.' };
  }
  const held = state.held.slice();
  held[index as number] = !held[index as number];
  return { ok: true, state: { ...state, held } };
}

/**
 * Why a box is refused, in words that say what to do instead. "Illegal move"
 * would leave a player who has just rolled their second Yahtzee staring at a
 * sheet of greyed-out boxes with no idea which rule is holding them.
 */
function refusal(state: YState, seat: number, category: Category): string {
  const sheet = state.sheets[seat];
  if (sheet[category] !== null) return 'You have already filled that box.';

  const box = upperFor(state.dice[0]);
  if (sheet[box] === null) {
    return `A Yahtzee goes in ${CATEGORY_NAME[box]} while that box is open.`;
  }
  return 'With that box gone, a Yahtzee has to go in the lower section.';
}

function score(state: YState, seat: number, category: unknown): MoveResult<YState> {
  if (!hasRolled(state)) return { ok: false, error: 'Roll the dice first.' };
  if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: 'That is not a box on the sheet.' };
  }

  const box = category as Category;
  if (!legalCategories(state.sheets[seat], state.dice).includes(box)) {
    return { ok: false, error: refusal(state, seat, box) };
  }

  const joker = jokerApplies(state.sheets[seat], state.dice);
  const value = scoreFor(box, state.dice, joker);

  const sheets = state.sheets.map((sheet, index) =>
    index === seat ? { ...sheet, [box]: value } : sheet,
  );

  // The bonus rides on the box having *scored*, which is why this reads the
  // sheet as it was before the write: a Yahtzee crossed off for zero pays
  // nothing later, and the box being filled this very turn is not "already".
  const bonus = isYahtzee(state.dice) && state.sheets[seat].yahtzee === YAHTZEE;
  const extras = state.extras.map((count, index) => (index === seat ? count + 1 : count));

  const seats = state.sheets.length;
  const { turn, round } = endTurn(state, seats);
  const over = sheets.every(isComplete);

  return {
    ok: true,
    state: {
      ...state,
      dice: Array<number>(DICE).fill(0),
      held: Array<boolean>(DICE).fill(false),
      rollsLeft: ROLLS,
      turn: over ? state.turn : turn,
      round: over ? state.round : round,
      sheets,
      extras: bonus ? extras : state.extras,
      note: {
        seat,
        text: bonus
          ? `took ${value} for ${CATEGORY_NAME[box]}, and ${EXTRA_YAHTZEE} for another Yahtzee.`
          : value === 0
            ? `crossed off ${CATEGORY_NAME[box]}.`
            : `took ${value} for ${CATEGORY_NAME[box]}.`,
      },
      over,
      winners: over ? winnersOf(sheets, bonus ? extras : state.extras) : [],
    },
  };
}

export const yahtzee: GameDefinition<YState, YMove> = {
  id: GAME_MANIFEST.yahtzee.id,
  name: GAME_MANIFEST.yahtzee.name,
  minPlayers: GAME_MANIFEST.yahtzee.minPlayers,
  maxPlayers: GAME_MANIFEST.yahtzee.maxPlayers,

  /**
   * Seat 0 opens. Unlike the Wheel there is nothing to gain from it: everyone
   * takes the same thirteen turns with their own dice, so who goes first
   * decides nothing and a random starter would only be noise.
   */
  setup(playerCount): YState {
    // Clamped rather than trusted: `% seats` is the turn, and a zero here
    // would divide by nothing.
    const seats = Math.min(Math.max(Math.trunc(playerCount) || SEATS.min, SEATS.min), SEATS.max);
    return {
      dice: Array<number>(DICE).fill(0),
      held: Array<boolean>(DICE).fill(false),
      toss: null,
      rollsLeft: ROLLS,
      turn: 0,
      round: 1,
      sheets: Array.from({ length: seats }, emptySheet),
      extras: Array<number>(seats).fill(0),
      note: null,
      over: false,
      winners: [],
    };
  },

  applyMove(state, move, seat, rng): MoveResult<YState> {
    if (state.over) return { ok: false, error: 'The game is already over.' };
    if (seat !== state.turn) return { ok: false, error: "It's not your turn." };
    if (!move || typeof move !== 'object') return { ok: false, error: 'Unknown move.' };

    switch (move.type) {
      case 'roll':
        return roll(state, move.flick, rng);
      case 'hold':
        return hold(state, move.die);
      case 'score':
        return score(state, seat, move.category);
      default:
        return { ok: false, error: 'Unknown move.' };
    }
  },

  turn(state) {
    return isOver(state) ? null : state.turn;
  },

  isOver,

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    if (state.over) {
      const best = total(state.sheets[state.winners[0]], state.extras[state.winners[0]]);
      if (state.winners.length === 1) return `${nameFor(state.winners[0])} wins with ${best}`;
      const who = state.winners.map(nameFor);
      return `A tie at ${best} — ${who.slice(0, -1).join(', ')} and ${who[who.length - 1]}`;
    }

    if (!hasRolled(state)) return `${nameFor(state.turn)} to roll`;
    if (state.rollsLeft > 0) {
      return `${nameFor(state.turn)} has ${state.rollsLeft} ${
        state.rollsLeft === 1 ? 'roll' : 'rolls'
      } left`;
    }
    return `${nameFor(state.turn)} must fill a box`;
  },

  // Nothing is hidden: the dice are on the table and every sheet is public.
  // No `view`, deliberately — see the note at the top of `yahtzeeDisplay.ts`.
};
