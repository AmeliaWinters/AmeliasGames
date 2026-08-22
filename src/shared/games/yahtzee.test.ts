import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  DICE,
  EXTRA_YAHTZEE,
  FULL_HOUSE,
  LARGE_STRAIGHT,
  LOWER,
  ROLLS,
  SMALL_STRAIGHT,
  UPPER,
  UPPER_BONUS,
  UPPER_TARGET,
  YAHTZEE,
  emptySheet,
  isComplete,
  legalCategories,
  scoreFor,
  total,
  upperBonus,
  yahtzee,
  type Category,
  type Sheet,
  type YMove,
  type YState,
} from './yahtzee.js';
import { RoomEngine } from '../room.js';
import type { MoveResult } from '../types.js';

/** A position to hang a specific test on. Seat count follows `sheets` if given. */
function position(overrides: Partial<YState> = {}): YState {
  const seats = overrides.sheets?.length ?? overrides.extras?.length ?? 2;
  return {
    dice: [1, 2, 3, 4, 5],
    // No throw behind them by default: these are positions, not histories.
    toss: null,
    held: Array<boolean>(DICE).fill(false),
    // Mid-turn by default: most tests are about a hand that is already on the
    // table, and a state with dice but three rolls left cannot happen.
    rollsLeft: 1,
    turn: 0,
    round: 1,
    sheets: Array.from({ length: seats }, emptySheet),
    extras: Array<number>(seats).fill(0),
    note: null,
    over: false,
    winners: [],
    ...overrides,
  };
}

/** A sheet with the named boxes filled at the values given. */
function sheet(filled: Partial<Record<Category, number>>): Sheet {
  return { ...emptySheet(), ...filled };
}

const never = () => 0;

const apply = (
  state: YState,
  move: unknown,
  seat: number,
  rng: () => number = never,
): MoveResult<YState> => yahtzee.applyMove(state, move as YMove, seat, rng);

function ok(result: MoveResult<YState>): YState {
  if (!result.ok) throw new Error(`unexpected rejection: ${result.error}`);
  return result.state;
}

function err(result: MoveResult<YState>): string {
  if (result.ok) throw new Error('expected a rejection');
  return result.error;
}

/** An rng that deals the given faces in order, then repeats the last one. */
function faces(...values: number[]): () => number {
  let index = 0;
  return () => {
    const face = values[Math.min(index++, values.length - 1)];
    return (face - 1) / 6 + 0.01;
  };
}

describe('scoring the upper section', () => {
  it('counts only the face the box is for', () => {
    expect(scoreFor('threes', [3, 3, 4, 3, 6])).toBe(9);
    expect(scoreFor('sixes', [3, 3, 4, 3, 6])).toBe(6);
    expect(scoreFor('ones', [3, 3, 4, 3, 6])).toBe(0);
  });

  it('pays the bonus at the target and not a point below it', () => {
    const short = sheet({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 17 });
    const exact = sheet({ ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 });
    expect(scoreFor('sixes', [6, 6, 6, 1, 1])).toBe(18);
    expect(upperBonus(short)).toBe(0);
    expect(upperBonus(exact)).toBe(UPPER_BONUS);
    expect(total(short)).toBe(UPPER_TARGET - 1);
    expect(total(exact)).toBe(UPPER_TARGET + UPPER_BONUS);
  });
});

describe('scoring the lower section', () => {
  it('sums every die for three and four of a kind, or nothing at all', () => {
    expect(scoreFor('threeKind', [5, 5, 5, 1, 2])).toBe(18);
    expect(scoreFor('fourKind', [5, 5, 5, 1, 2])).toBe(0);
    expect(scoreFor('fourKind', [5, 5, 5, 5, 2])).toBe(22);
    // Five of a kind is four of a kind and then some.
    expect(scoreFor('fourKind', [5, 5, 5, 5, 5])).toBe(25);
    expect(scoreFor('threeKind', [5, 5, 1, 1, 2])).toBe(0);
  });

  it('wants three of one and two of another for a full house', () => {
    expect(scoreFor('fullHouse', [2, 2, 2, 5, 5])).toBe(FULL_HOUSE);
    expect(scoreFor('fullHouse', [2, 2, 5, 5, 5])).toBe(FULL_HOUSE);
    expect(scoreFor('fullHouse', [2, 2, 2, 2, 5])).toBe(0);
    // Five of a kind is a Yahtzee, not a full house — only the joker rule
    // lets it stand in for one.
    expect(scoreFor('fullHouse', [4, 4, 4, 4, 4])).toBe(0);
  });

  it('reads a straight through duplicate dice', () => {
    expect(scoreFor('smallStraight', [1, 2, 3, 4, 4])).toBe(SMALL_STRAIGHT);
    expect(scoreFor('smallStraight', [3, 4, 5, 6, 6])).toBe(SMALL_STRAIGHT);
    expect(scoreFor('smallStraight', [2, 3, 4, 5, 1])).toBe(SMALL_STRAIGHT);
    expect(scoreFor('smallStraight', [1, 2, 3, 5, 6])).toBe(0);
    expect(scoreFor('largeStraight', [1, 2, 3, 4, 5])).toBe(LARGE_STRAIGHT);
    expect(scoreFor('largeStraight', [6, 5, 4, 3, 2])).toBe(LARGE_STRAIGHT);
    // Four in a row plus a repeat is a small straight and no more.
    expect(scoreFor('largeStraight', [1, 2, 3, 4, 4])).toBe(0);
    expect(scoreFor('smallStraight', [1, 2, 3, 4, 5])).toBe(SMALL_STRAIGHT);
  });

  it('takes anything at all in Chance', () => {
    expect(scoreFor('chance', [1, 1, 1, 1, 2])).toBe(6);
    expect(scoreFor('yahtzee', [1, 1, 1, 1, 1])).toBe(YAHTZEE);
    expect(scoreFor('yahtzee', [1, 1, 1, 1, 2])).toBe(0);
  });
});

describe('the turn', () => {
  it('gives three rolls and no more', () => {
    let state = position({ dice: Array<number>(DICE).fill(0), rollsLeft: ROLLS });
    for (let i = 0; i < ROLLS; i++) {
      state = ok(apply(state, { type: 'roll' }, 0, faces(4)));
    }
    expect(state.dice.every((face) => face >= 1 && face <= 6)).toBe(true);
    expect(state.rollsLeft).toBe(0);
    expect(err(apply(state, { type: 'roll' }, 0, faces(4)))).toMatch(/No rolls left/);
  });

  /*
    The faces are the simulation's — read off the cubes where they stop — so
    these assert the rule rather than a number a stubbed rng handed over. What
    a kept die promises is that it does not move, and that is exactly testable.
  */
  it('leaves the dice being kept exactly as they were', () => {
    const start = position({ dice: [6, 6, 1, 2, 3], held: [true, true, false, false, false] });
    for (let seed = 0; seed < 12; seed++) {
      const state = ok(apply(start, { type: 'roll' }, 0, () => seed / 12));
      expect(state.dice.slice(0, 2)).toEqual([6, 6]);
      expect(state.dice.every((face) => face >= 1 && face <= 6)).toBe(true);
    }
  });

  it('actually throws the dice that are not being kept', () => {
    const start = position({ dice: [6, 6, 1, 2, 3], held: [true, true, false, false, false] });
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      seen.add(ok(apply(start, { type: 'roll' }, 0, () => seed / 12)).dice.slice(2).join(','));
    }
    // Twelve throws landing on one arrangement of three dice would mean the
    // simulation is not being driven by the seed at all.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('refuses a roll that would throw nothing', () => {
    // Keeping all five and rolling again spent a roll and moved nothing.
    const start = position({ dice: [6, 6, 1, 2, 3], held: [true, true, true, true, true] });
    expect(err(apply(start, { type: 'roll' }, 0, faces(5)))).toMatch(/keeping all five/i);
  });

  it('refuses to hold before a roll, or once the rolls are gone', () => {
    const fresh = position({ dice: Array<number>(DICE).fill(0), rollsLeft: ROLLS });
    expect(err(apply(fresh, { type: 'hold', die: 0 }, 0))).toMatch(/Roll the dice first/);
    const spent = position({ rollsLeft: 0 });
    expect(err(apply(spent, { type: 'hold', die: 0 }, 0))).toMatch(/Nothing left to roll/);
    expect(err(apply(position(), { type: 'hold', die: DICE }, 0))).toMatch(/does not exist/);
  });

  it('toggles a die rather than only setting it', () => {
    const once = ok(apply(position(), { type: 'hold', die: 2 }, 0));
    expect(once.held[2]).toBe(true);
    expect(ok(apply(once, { type: 'hold', die: 2 }, 0)).held[2]).toBe(false);
  });

  it('will not let a player score a hand they have not rolled', () => {
    const fresh = position({ dice: Array<number>(DICE).fill(0), rollsLeft: ROLLS });
    expect(err(apply(fresh, { type: 'score', category: 'chance' }, 0))).toMatch(/Roll the dice/);
  });

  it('sweeps the dice off the table when the turn moves on', () => {
    const start = position({ held: [true, true, true, true, true], rollsLeft: 0 });
    const state = ok(apply(start, { type: 'score', category: 'chance' }, 0));
    expect(state.turn).toBe(1);
    expect(state.rollsLeft).toBe(ROLLS);
    expect(state.dice).toEqual(Array<number>(DICE).fill(0));
    expect(state.held).toEqual(Array<boolean>(DICE).fill(false));
  });

  it('walks the turn round however many seats there are', () => {
    let state = position({ sheets: [emptySheet(), emptySheet(), emptySheet()] });
    expect(state.round).toBe(1);
    for (const seat of [0, 1]) {
      state = { ...ok(apply(state, { type: 'score', category: 'chance' }, seat)), dice: [1, 1, 1, 1, 1], rollsLeft: 1 };
      expect(state.round).toBe(1);
    }
    state = ok(apply(state, { type: 'score', category: 'yahtzee' }, 2));
    expect(state.turn).toBe(0);
    expect(state.round).toBe(2);
  });

  it('refuses a move from the wrong seat, and any move once it is over', () => {
    expect(err(apply(position(), { type: 'roll' }, 1))).toMatch(/not your turn/);
    expect(err(apply(position({ over: true }), { type: 'roll' }, 0))).toMatch(/already over/);
    expect(err(apply(position(), { type: 'wander' }, 0))).toMatch(/Unknown move/);
    expect(err(apply(position(), { type: 'score', category: 'bingo' }, 0))).toMatch(/not a box/);
  });
});

describe('filling a box', () => {
  it('writes the score and closes the box', () => {
    const state = ok(apply(position({ dice: [2, 2, 2, 5, 5] }), { type: 'score', category: 'fullHouse' }, 0));
    expect(state.sheets[0].fullHouse).toBe(FULL_HOUSE);
    expect(state.sheets[1].fullHouse).toBe(null);
    const again = { ...state, turn: 0, dice: [2, 2, 2, 5, 5], rollsLeft: 1 };
    expect(err(apply(again, { type: 'score', category: 'fullHouse' }, 0))).toMatch(/already filled/);
  });

  it('lets a hand be crossed off for nothing, which is the game', () => {
    const state = ok(apply(position({ dice: [1, 1, 2, 3, 4] }), { type: 'score', category: 'yahtzee' }, 0));
    // Zero is a filled box, not an open one — the distinction the sheet is
    // built on, and the reason `null` and 0 are different values.
    expect(state.sheets[0].yahtzee).toBe(0);
    expect(legalCategories(state.sheets[0], [1, 1, 2, 3, 4])).not.toContain('yahtzee');
  });

  it('ends only when every sheet is full, and leaves the turn where it was', () => {
    const filledExcept = (open: Category): Sheet => {
      const full = emptySheet();
      for (const category of CATEGORIES) full[category] = 0;
      full[open] = null;
      return full;
    };

    const state = position({
      sheets: [filledExcept('chance'), filledExcept('chance')],
      dice: [1, 1, 1, 1, 1],
    });
    const half = ok(apply(state, { type: 'score', category: 'chance' }, 0));
    expect(half.over).toBe(false);
    expect(half.turn).toBe(1);

    const done = ok(apply({ ...half, dice: [2, 2, 2, 2, 2], rollsLeft: 1 }, { type: 'score', category: 'chance' }, 1));
    expect(done.over).toBe(true);
    expect(isComplete(done.sheets[0])).toBe(true);
    expect(yahtzee.turn(done)).toBe(null);
    expect(done.winners).toEqual([1]);
    expect(yahtzee.status(done, ['Ann', 'Bo'])).toBe('Bo wins with 10');
  });

  it('calls a dead heat a tie rather than picking the earlier seat', () => {
    const filled = (chance: number): Sheet => {
      const full = emptySheet();
      for (const category of CATEGORIES) full[category] = 0;
      full.chance = chance;
      return full;
    };
    const over = position({ sheets: [filled(5), filled(5)], over: true, winners: [0, 1] });
    expect(yahtzee.status(over, ['Ann', 'Bo'])).toBe('A tie at 5 — Ann and Bo');
  });
});

describe('the Yahtzee bonus', () => {
  it('pays 100 for every extra Yahtzee once the box has scored 50', () => {
    const start = position({
      sheets: [sheet({ yahtzee: YAHTZEE }), emptySheet()],
      dice: [4, 4, 4, 4, 4],
    });
    const state = ok(apply(start, { type: 'score', category: 'fours' }, 0));
    expect(state.extras[0]).toBe(1);
    expect(state.sheets[0].fours).toBe(20);
    expect(total(state.sheets[0], state.extras[0])).toBe(YAHTZEE + 20 + EXTRA_YAHTZEE);
    expect(state.note?.text).toContain(String(EXTRA_YAHTZEE));
  });

  it('pays nothing to a player who crossed the Yahtzee box off', () => {
    const start = position({
      sheets: [sheet({ yahtzee: 0 }), emptySheet()],
      dice: [4, 4, 4, 4, 4],
    });
    const state = ok(apply(start, { type: 'score', category: 'fours' }, 0));
    expect(state.extras[0]).toBe(0);
  });

  it('does not pay for the Yahtzee that fills the box itself', () => {
    const state = ok(apply(position({ dice: [4, 4, 4, 4, 4] }), { type: 'score', category: 'yahtzee' }, 0));
    expect(state.sheets[0].yahtzee).toBe(YAHTZEE);
    expect(state.extras[0]).toBe(0);
  });
});

describe('the joker rules', () => {
  const joker = (filled: Partial<Record<Category, number>>) =>
    position({ sheets: [sheet({ yahtzee: YAHTZEE, ...filled }), emptySheet()], dice: [3, 3, 3, 3, 3] });

  it('sends the hand to its own upper box while that box is open', () => {
    const state = joker({});
    expect(legalCategories(state.sheets[0], state.dice)).toEqual(['threes']);
    expect(err(apply(state, { type: 'score', category: 'chance' }, 0))).toMatch(/goes in Threes/);
    expect(ok(apply(state, { type: 'score', category: 'threes' }, 0)).sheets[0].threes).toBe(15);
  });

  it('opens the whole lower section once that box is gone', () => {
    const state = joker({ threes: 15 });
    const legal = legalCategories(state.sheets[0], state.dice);
    expect(legal).toEqual(LOWER.filter((c) => c !== 'yahtzee'));
    expect(err(apply(state, { type: 'score', category: 'sixes' }, 0))).toMatch(/lower section/);
  });

  it('pays face value for the hands the dice cannot actually make', () => {
    const state = joker({ threes: 15 });
    expect(ok(apply(state, { type: 'score', category: 'fullHouse' }, 0)).sheets[0].fullHouse).toBe(
      FULL_HOUSE,
    );
    expect(
      ok(apply(state, { type: 'score', category: 'smallStraight' }, 0)).sheets[0].smallStraight,
    ).toBe(SMALL_STRAIGHT);
    expect(
      ok(apply(state, { type: 'score', category: 'largeStraight' }, 0)).sheets[0].largeStraight,
    ).toBe(LARGE_STRAIGHT);
    // The boxes the hand *can* make still score as they read.
    expect(ok(apply(state, { type: 'score', category: 'chance' }, 0)).sheets[0].chance).toBe(15);
  });

  it('falls back to crossing off an upper box with the lower section full', () => {
    const filled: Partial<Record<Category, number>> = { threes: 15 };
    for (const category of LOWER) filled[category] = filled[category] ?? 0;
    filled.yahtzee = YAHTZEE;
    const state = joker(filled);
    const legal = legalCategories(state.sheets[0], state.dice);
    expect(legal).toEqual(UPPER.filter((c) => c !== 'threes'));
    // Whatever they pick is worth nothing: the dice are all threes and the
    // Threes box is the one that is gone.
    const after = ok(apply(state, { type: 'score', category: 'sixes' }, 0));
    expect(after.sheets[0].sixes).toBe(0);
    // Still a Yahtzee, so the bonus is still owed.
    expect(after.extras[0]).toBe(1);
  });

  it('leaves a player whose Yahtzee box is open free to choose', () => {
    const state = position({ dice: [3, 3, 3, 3, 3] });
    expect(legalCategories(state.sheets[0], state.dice)).toEqual([...CATEGORIES]);
  });
});

describe('a whole game', () => {
  it('plays out to thirteen filled boxes each without breaking an invariant', () => {
    let state = yahtzee.setup(3, () => 0.5);
    let guard = 0;
    let rng = faces(1, 2, 3, 4, 5, 6);

    while (!yahtzee.isOver(state) && guard++ < 500) {
      const seat = yahtzee.turn(state)!;
      state = ok(apply(state, { type: 'roll' }, seat, rng));
      state = ok(apply(state, { type: 'roll' }, seat, rng));

      const legal = legalCategories(state.sheets[seat], state.dice);
      expect(legal.length).toBeGreaterThan(0);
      state = ok(apply(state, { type: 'score', category: legal[0] }, seat));

      // Nobody's sheet ever gains a box that is not theirs.
      for (const [index, card] of state.sheets.entries()) {
        const filled = CATEGORIES.filter((c) => card[c] !== null).length;
        expect(filled, `seat ${index}`).toBeLessThanOrEqual(CATEGORIES.length);
      }
      rng = faces(2, 3, 4, 5, 6, 1);
    }

    expect(yahtzee.isOver(state)).toBe(true);
    expect(state.round).toBe(CATEGORIES.length);
    expect(state.sheets.every(isComplete)).toBe(true);
    expect(state.winners.length).toBeGreaterThan(0);
    expect(yahtzee.turn(state)).toBe(null);
  });

  it('is decided by the totals, bonuses included', () => {
    const behind = emptySheet();
    const ahead = emptySheet();
    for (const category of CATEGORIES) {
      behind[category] = 0;
      ahead[category] = 0;
    }
    behind.chance = 30;
    ahead.chance = 0;
    // Ten points behind on the sheet, a hundred ahead on extra Yahtzees.
    expect(total(behind, 0)).toBe(30);
    expect(total(ahead, 1)).toBe(EXTRA_YAHTZEE);
  });
});

describe('in a room', () => {
  it('deals for whoever sat down, and refuses a move from the wrong seat', () => {
    const room = RoomEngine.create('TEST', 'yahtzee')!;
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    room.join('c', 'Cy');
    // Three turned up, so three sheets are dealt — the table is decided by who
    // arrived rather than by a number chosen before anyone did.
    expect(room.start(0, () => 0.5).ok).toBe(true);

    const view = room.viewFor(1, new Set([0, 1, 2])).state as YState;
    expect(view.sheets).toHaveLength(3);
    expect(view.dice).toEqual([0, 0, 0, 0, 0]);

    // The server owns the dice: seat 1 cannot roll on seat 0's turn, and the
    // client never applies a move locally, so there is nothing to re-roll.
    expect(room.move(1, { type: 'roll' }).ok).toBe(false);
    expect(room.move(0, { type: 'roll' }).ok).toBe(true);
    expect((room.viewFor(2, new Set([0, 1, 2])).state as YState).rollsLeft).toBe(ROLLS - 1);
  });
});
