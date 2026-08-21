import { describe, it, expect } from 'vitest';
import {
  DICE_PER_PLAYER,
  FACES,
  HIDDEN_FACE,
  beats,
  countFace,
  describeBid,
  isOut,
  liarsDice,
  livePlayers,
  nextLive,
  smallestRaise,
  totalDice,
  type LdMove,
  type LdState,
} from './liarsDice.js';
import { RoomEngine } from '../room.js';
import type { MoveResult } from '../types.js';

/** A position to hang a specific test on. Seat count follows `dice`. */
function position(overrides: Partial<LdState> = {}): LdState {
  return {
    round: 1,
    dice: [
      [1, 2, 3, 4, 5],
      [2, 2, 3, 6, 6],
    ],
    turn: 0,
    bid: null,
    history: [],
    phase: 'bid',
    starter: 0,
    showdown: null,
    winner: null,
    over: false,
    ...overrides,
  };
}

const never = () => 0;

const apply = (
  state: LdState,
  move: unknown,
  seat: number,
  rng: () => number = never,
): MoveResult<LdState> => liarsDice.applyMove(state, move as LdMove, seat, rng);

/** Asserts the move was accepted and hands back the state it produced. */
function ok(result: MoveResult<LdState>): LdState {
  if (!result.ok) throw new Error(`unexpected rejection: ${result.error}`);
  return result.state;
}

function rejection(result: MoveResult<LdState>): string {
  if (result.ok) throw new Error('expected a rejection');
  return result.error;
}

/** Deals the same face every time, so a hand can be predicted exactly. */
function scripted(values: number[]): () => number {
  let i = 0;
  return () => {
    // The inverse of `pick`: the unit interval that lands on `value`.
    const value = values[i % values.length];
    i++;
    return (value - 1) / FACES + 0.01;
  };
}

describe('setting up', () => {
  it('deals five dice to everyone at the table', () => {
    for (const seats of [2, 3, 4]) {
      const state = liarsDice.setup(seats, Math.random);
      expect(state.dice).toHaveLength(seats);
      for (const hand of state.dice) expect(hand).toHaveLength(DICE_PER_PLAYER);
      expect(totalDice(state)).toBe(seats * DICE_PER_PLAYER);
    }
  });

  it('rolls real faces, and only real faces', () => {
    // Two hundred tables rather than one: a face out of range is the kind of
    // thing that turns up once in a hundred rolls and never in the one you
    // happened to look at.
    for (let i = 0; i < 200; i++) {
      for (const die of liarsDice.setup(4, Math.random).dice.flat()) {
        expect(Number.isInteger(die)).toBe(true);
        expect(die).toBeGreaterThanOrEqual(1);
        expect(die).toBeLessThanOrEqual(FACES);
      }
    }
  });

  it('survives an rng that misbehaves at both ends', () => {
    for (const rng of [() => 1, () => NaN, () => -1]) {
      const state = liarsDice.setup(3, rng);
      expect(state.dice.flat().every((d) => d >= 1 && d <= FACES)).toBe(true);
      expect(state.turn).toBeGreaterThanOrEqual(0);
      expect(state.turn).toBeLessThan(3);
    }
  });

  it('clamps a table it cannot seat', () => {
    expect(liarsDice.setup(0, never).dice).toHaveLength(2);
    expect(liarsDice.setup(99, never).dice).toHaveLength(4);
  });

  it('opens with somebody, and nobody in particular', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(liarsDice.setup(4, Math.random).turn);
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('bidding', () => {
  it('accepts an opening bid and passes the turn on', () => {
    const after = ok(apply(position(), { type: 'bid', quantity: 2, face: 3 }, 0));
    expect(after.bid).toEqual({ seat: 0, quantity: 2, face: 3 });
    expect(after.turn).toBe(1);
  });

  it('takes a raise on quantity or on face, and nothing else', () => {
    const state = position({ bid: { seat: 0, quantity: 3, face: 4 }, turn: 1 });

    expect(ok(apply(state, { type: 'bid', quantity: 3, face: 5 }, 1)).bid?.face).toBe(5);
    expect(ok(apply(state, { type: 'bid', quantity: 4, face: 1 }, 1)).bid?.quantity).toBe(4);

    // The same bid, a lower face, fewer dice: not one of them is a raise.
    for (const move of [
      { type: 'bid', quantity: 3, face: 4 },
      { type: 'bid', quantity: 3, face: 2 },
      { type: 'bid', quantity: 2, face: 6 },
    ]) {
      expect(rejection(apply(state, move, 1))).toMatch(/Raise the bid/);
    }
  });

  it('refuses a bid for more dice than are on the table', () => {
    const state = position();
    expect(rejection(apply(state, { type: 'bid', quantity: 11, face: 2 }, 0))).toBe(
      'There are only 10 dice on the table.',
    );
    expect(ok(apply(state, { type: 'bid', quantity: 10, face: 2 }, 0)).bid?.quantity).toBe(10);
  });

  it('refuses a bid that is not a whole number of a real face', () => {
    const state = position();
    for (const move of [
      { type: 'bid', quantity: 0, face: 3 },
      { type: 'bid', quantity: -2, face: 3 },
      { type: 'bid', quantity: NaN, face: 3 },
      { type: 'bid', quantity: Infinity, face: 3 },
      { type: 'bid', quantity: 'lots', face: 3 },
    ]) {
      expect(rejection(apply(state, move, 0))).toBe('Bid at least one die.');
    }
    for (const face of [0, 7, -1, NaN, 'six']) {
      expect(rejection(apply(state, { type: 'bid', quantity: 2, face }, 0))).toBe(
        'Dice run from 1 to 6.',
      );
    }
  });

  it('lets nobody bid out of turn, or after they are out', () => {
    const state = position();
    expect(rejection(apply(state, { type: 'bid', quantity: 2, face: 3 }, 1))).toBe(
      "It's not your turn.",
    );

    const eliminated = position({ dice: [[], [2, 2, 3]], turn: 0 });
    expect(rejection(apply(eliminated, { type: 'bid', quantity: 1, face: 2 }, 0))).toBe(
      'You are out of dice.',
    );
  });

  it('skips a seat with no dice left when passing the turn', () => {
    const state = position({ dice: [[1, 2], [], [3, 4]], turn: 0 });
    expect(ok(apply(state, { type: 'bid', quantity: 1, face: 3 }, 0)).turn).toBe(2);
  });

  it('shrugs at a move it has never heard of', () => {
    expect(rejection(apply(position(), { type: 'fold' }, 0))).toBe('Unknown move.');
    expect(rejection(apply(position(), null, 0))).toBe('Unknown move.');
  });
});

describe('calling', () => {
  it('has nothing to call before anyone has bid', () => {
    expect(rejection(apply(position(), { type: 'challenge' }, 0))).toBe(
      'There is no bid to call yet.',
    );
  });

  it('costs the challenger a die when the bid was good', () => {
    const state = position({ bid: { seat: 0, quantity: 2, face: 2 }, turn: 1 });
    const after = ok(apply(state, { type: 'challenge' }, 1));

    expect(after.showdown?.actual).toBe(3);
    expect(after.showdown?.loser).toBe(1);
    expect(after.dice[1]).toHaveLength(DICE_PER_PLAYER - 1);
    expect(after.dice[0]).toHaveLength(DICE_PER_PLAYER);
  });

  it('costs the bidder a die when the bid was a lie', () => {
    const state = position({ bid: { seat: 0, quantity: 4, face: 2 }, turn: 1 });
    const after = ok(apply(state, { type: 'challenge' }, 1));

    expect(after.showdown?.actual).toBe(3);
    expect(after.showdown?.loser).toBe(0);
    expect(after.dice[0]).toHaveLength(DICE_PER_PLAYER - 1);
  });

  it('counts a bid met exactly as the bidder being right', () => {
    // "At least three" is what a bid means, so three is not a tie to be split.
    const state = position({ bid: { seat: 0, quantity: 3, face: 2 }, turn: 1 });
    expect(ok(apply(state, { type: 'challenge' }, 1)).showdown?.loser).toBe(1);
  });

  it('keeps the hands as they were, and hands the round to the loser', () => {
    const state = position({ bid: { seat: 0, quantity: 6, face: 6 }, turn: 1 });
    const after = ok(apply(state, { type: 'challenge' }, 1));

    expect(after.showdown?.hands).toEqual([
      [1, 2, 3, 4, 5],
      [2, 2, 3, 6, 6],
    ]);
    expect(after.phase).toBe('reveal');
    expect(after.turn).toBe(0);
    expect(after.starter).toBe(0);
  });

  it('knocks out a player who loses their last die, and passes the round on', () => {
    const state = position({
      dice: [[6], [1, 1], [2, 2]],
      bid: { seat: 0, quantity: 3, face: 6 },
      turn: 1,
    });
    const after = ok(apply(state, { type: 'challenge' }, 1));

    expect(after.showdown?.out).toEqual([0]);
    expect(isOut(after, 0)).toBe(true);
    expect(livePlayers(after)).toEqual([1, 2]);
    // Seat 0 cannot open a round they are no longer in.
    expect(after.turn).toBe(1);
    expect(after.over).toBe(false);
  });

  it('ends the game when only one player still holds dice', () => {
    const state = position({
      dice: [[6], [1, 1]],
      bid: { seat: 0, quantity: 2, face: 6 },
      turn: 1,
    });
    const after = ok(apply(state, { type: 'challenge' }, 1));

    expect(after.over).toBe(true);
    expect(after.phase).toBe('over');
    expect(after.winner).toBe(1);
    expect(liarsDice.isOver(after)).toBe(true);
    expect(liarsDice.turn(after)).toBeNull();
    // The last call stays on the table, so the board can show what settled it.
    expect(after.showdown?.actual).toBe(1);
    expect(rejection(apply(after, { type: 'bid', quantity: 1, face: 1 }, 1))).toBe(
      'The game is already over.',
    );
  });
});

describe('calling it spot on', () => {
  it('has nothing to call before anyone has bid', () => {
    expect(rejection(apply(position(), { type: 'exact' }, 0))).toBe(
      'There is no bid to call yet.',
    );
  });

  it('pays the caller a die back when the count is the bid to the die', () => {
    // Three 2s on the table: one of seat 0's, two of seat 1's. Seat 1 is a die
    // down already, which is the only state a die can be paid back into.
    const state = position({
      dice: [
        [1, 2, 3, 4, 5],
        [2, 2, 3, 6],
      ],
      bid: { seat: 0, quantity: 3, face: 2 },
      turn: 1,
    });
    const after = ok(apply(state, { type: 'exact' }, 1, scripted([4])));

    expect(after.showdown?.call).toBe('exact');
    expect(after.showdown?.actual).toBe(3);
    // The one call in the game that costs nobody anything.
    expect(after.showdown?.loser).toBeNull();
    expect(after.showdown?.gainer).toBe(1);
    expect(after.showdown?.out).toEqual([]);
    expect(after.dice[0]).toHaveLength(DICE_PER_PLAYER);
    expect(after.dice[1]).toHaveLength(DICE_PER_PLAYER);
    // The die it pays is a real die, rolled rather than invented.
    expect(after.dice[1].every((face) => face >= 1 && face <= FACES)).toBe(true);
  });

  it('costs the caller a die when the count is anything else', () => {
    // A bid that is a lie is still not spot on, and neither is one that is
    // comfortably true: only the exact number pays.
    for (const quantity of [2, 4]) {
      const state = position({ bid: { seat: 0, quantity, face: 2 }, turn: 1 });
      const after = ok(apply(state, { type: 'exact' }, 1));

      expect(after.showdown?.loser).toBe(1);
      expect(after.showdown?.gainer).toBeNull();
      expect(after.dice[1]).toHaveLength(DICE_PER_PLAYER - 1);
      // The bidder is untouched either way — a spot-on call is made against the
      // number, not against them.
      expect(after.dice[0]).toHaveLength(DICE_PER_PLAYER);
    }
  });

  it('never pays a hand past the five it started with', () => {
    // Both hands full, and the bid is spot on: the caller is right and there is
    // simply nothing to pay them with.
    const state = position({ bid: { seat: 0, quantity: 3, face: 2 }, turn: 1 });
    const after = ok(apply(state, { type: 'exact' }, 1));

    expect(after.dice[1]).toHaveLength(DICE_PER_PLAYER);
    expect(after.showdown?.gainer).toBeNull();
    // Still worth saying who was right, so the board can explain the shrug.
    expect(after.showdown?.challenger).toBe(1);
    expect(after.showdown?.loser).toBeNull();
  });

  it('hands the next round to the caller when nobody lost a die', () => {
    const state = position({ bid: { seat: 0, quantity: 3, face: 2 }, turn: 1 });
    const after = ok(apply(state, { type: 'exact' }, 1));

    expect(after.phase).toBe('reveal');
    expect(after.turn).toBe(1);
    expect(after.starter).toBe(1);
  });

  it('can knock the caller out, and ends the game if it was the last of them', () => {
    const state = position({
      dice: [[2, 2, 3], [6]],
      bid: { seat: 0, quantity: 1, face: 3 },
      turn: 1,
    });
    const after = ok(apply(state, { type: 'exact' }, 1));

    // Exactly one 3 was on the table, so the bid was spot on — but calling it
    // spot on is a claim about the count, and this one was made by the player
    // who could least afford to be wrong about it. It was right.
    expect(after.showdown?.gainer).toBe(1);
    expect(after.over).toBe(false);

    // The same position, called on a face there is no exact count of.
    const missed = ok(
      apply(position({ dice: [[2, 2, 3], [6]], bid: { seat: 0, quantity: 3, face: 2 }, turn: 1 }), {
        type: 'exact',
      }, 1),
    );
    expect(missed.showdown?.loser).toBe(1);
    expect(missed.showdown?.out).toEqual([1]);
    expect(missed.over).toBe(true);
    expect(missed.winner).toBe(0);
  });
});

describe('the bidding history', () => {
  it('keeps every bid of the round, in the order it was said', () => {
    let state = ok(apply(position(), { type: 'bid', quantity: 2, face: 3 }, 0));
    state = ok(apply(state, { type: 'bid', quantity: 3, face: 1 }, 1));
    state = ok(apply(state, { type: 'bid', quantity: 3, face: 5 }, 0));

    expect(state.history).toEqual([
      { seat: 0, quantity: 2, face: 3 },
      { seat: 1, quantity: 3, face: 1 },
      { seat: 0, quantity: 3, face: 5 },
    ]);
    // The bid on the table is the last thing said, and is the same object's
    // worth of information — the history is the run, not a second source.
    expect(state.history[state.history.length - 1]).toEqual(state.bid);
  });

  it('survives the call, so the reveal can be read against the bidding', () => {
    let state = ok(apply(position(), { type: 'bid', quantity: 9, face: 6 }, 0));
    state = ok(apply(state, { type: 'challenge' }, 1));

    expect(state.bid).toBeNull();
    expect(state.history).toHaveLength(1);
  });

  it('is wiped by the next roll, which is a different round', () => {
    let state = ok(apply(position(), { type: 'bid', quantity: 9, face: 6 }, 0));
    state = ok(apply(state, { type: 'challenge' }, 1));
    state = ok(apply(state, { type: 'next' }, 0, scripted([4])));

    expect(state.history).toEqual([]);
  });

  it('is copied rather than shared with the state it came from', () => {
    const state = position({ history: [{ seat: 0, quantity: 1, face: 1 }] });
    const after = ok(apply(state, { type: 'bid', quantity: 2, face: 1 }, 0));

    after.history[0].quantity = 99;
    expect(state.history[0].quantity).toBe(1);
  });
});

describe('the next round', () => {
  const reveal = () =>
    ok(apply(position({ bid: { seat: 0, quantity: 9, face: 6 }, turn: 1 }), { type: 'challenge' }, 1));

  it('rolls fresh hands of the size everyone is now on', () => {
    const after = ok(apply(reveal(), { type: 'next' }, 0, scripted([4])));

    expect(after.round).toBe(2);
    expect(after.phase).toBe('bid');
    expect(after.bid).toBeNull();
    expect(after.showdown).toBeNull();
    expect(after.dice[0]).toEqual([4, 4, 4, 4]);
    expect(after.dice[1]).toEqual([4, 4, 4, 4, 4]);
  });

  it('leaves an eliminated player with nothing to roll', () => {
    const state = position({ dice: [[], [1, 2], [3]], turn: 1, phase: 'reveal' });
    const after = ok(apply(state, { type: 'next' }, 1, scripted([5])));
    expect(after.dice).toEqual([[], [5, 5], [5]]);
  });

  it('takes no other move while the dice are on the table', () => {
    expect(rejection(apply(reveal(), { type: 'bid', quantity: 1, face: 1 }, 0))).toBe(
      'The dice are on the table.',
    );
    expect(rejection(apply(position(), { type: 'next' }, 0))).toBe('This round is still going.');
  });

  it('lets nobody else roll it', () => {
    expect(rejection(apply(reveal(), { type: 'next' }, 1))).toBe("It's not your turn.");
  });
});

describe('what a player is shown', () => {
  it('hides every hand but their own, and keeps the counts', () => {
    const state = position({
      dice: [
        [1, 2, 3],
        [2, 2, 3, 6, 6],
      ],
    });

    const seen = liarsDice.view!(state, 0);
    expect(seen.dice[0]).toEqual([1, 2, 3]);
    // The count is the public half of a hand, and most of what a bid is
    // reasoned from.
    expect(seen.dice[1]).toEqual([HIDDEN_FACE, HIDDEN_FACE, HIDDEN_FACE, HIDDEN_FACE, HIDDEN_FACE]);
  });

  it('never leaks a face through the redaction, whatever the phase', () => {
    for (const phase of ['bid', 'reveal', 'over'] as const) {
      const state = position({ phase, over: phase === 'over' });
      for (const seat of [0, 1]) {
        const seen = liarsDice.view!(state, seat);
        const others = seen.dice.filter((_, index) => index !== seat).flat();
        expect(others.every((die) => die === HIDDEN_FACE), phase).toBe(true);
      }
    }
  });

  it('shows both hands in the showdown, which is the point of a call', () => {
    const called = ok(
      apply(position({ bid: { seat: 0, quantity: 9, face: 6 }, turn: 1 }), { type: 'challenge' }, 1),
    );
    const seen = liarsDice.view!(called, 0);
    expect(seen.showdown?.hands[1]).toEqual([2, 2, 3, 6, 6]);
  });

  it('hands back a copy rather than the reducer state itself', () => {
    const state = position();
    const seen = liarsDice.view!(state, 0);
    seen.dice[0].push(6);
    expect(state.dice[0]).toHaveLength(DICE_PER_PLAYER);
  });
});

describe('purity', () => {
  it('never writes to the state it was given', () => {
    const state = position({ bid: { seat: 0, quantity: 2, face: 2 }, turn: 1 });
    const before = JSON.stringify(state);

    ok(apply(state, { type: 'challenge' }, 1));
    ok(apply(position(), { type: 'bid', quantity: 3, face: 3 }, 0));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('produces a state that shares nothing with the one it came from', () => {
    const state = position();
    const after = ok(apply(state, { type: 'bid', quantity: 2, face: 2 }, 0));
    after.dice[0].push(6);
    expect(state.dice[0]).toHaveLength(DICE_PER_PLAYER);
  });

  it('is deterministic given the same rng', () => {
    const first = liarsDice.setup(3, scripted([1, 4, 6, 2]));
    const second = liarsDice.setup(3, scripted([1, 4, 6, 2]));
    expect(first).toEqual(second);
  });
});

describe('the helpers the board shares', () => {
  const bid = (quantity: number, face: number) => ({ seat: 0, quantity, face });

  it('orders bids the way the rules do', () => {
    expect(beats(bid(1, 1), null)).toBe(true);
    expect(beats(bid(2, 6), bid(2, 5))).toBe(true);
    expect(beats(bid(3, 1), bid(2, 6))).toBe(true);
    expect(beats(bid(2, 5), bid(2, 5))).toBe(false);
    expect(beats(bid(2, 4), bid(2, 5))).toBe(false);
    expect(beats(bid(1, 6), bid(2, 1))).toBe(false);
  });

  it('counts a face across the table', () => {
    expect(
      countFace(
        [
          [2, 2, 3],
          [2, 6],
        ],
        2,
      ),
    ).toBe(3);
    expect(
      countFace(
        [
          [2, 2, 3],
          [2, 6],
        ],
        5,
      ),
    ).toBe(0);
  });

  it('offers the smallest legal raise, and stops when there is none', () => {
    expect(smallestRaise(position())).toEqual({ seat: 0, quantity: 1, face: 1 });
    expect(smallestRaise(position({ bid: bid(2, 3) }))).toMatchObject({ quantity: 2, face: 4 });
    // The faces are exhausted, so the quantity has to climb.
    expect(smallestRaise(position({ bid: bid(2, 6) }))).toMatchObject({ quantity: 3, face: 1 });
    // Every die on the table is claimed already: there is nothing left to say
    // but "liar".
    expect(smallestRaise(position({ bid: bid(10, 6) }))).toBeNull();
  });

  it('walks round the table past the players who are out', () => {
    const state = position({ dice: [[1], [], [2], []] });
    expect(nextLive(state, 0)).toBe(2);
    expect(nextLive(state, 2)).toBe(0);
    // Nobody left is not a position a round can reach — and is not a hang either.
    expect(nextLive(position({ dice: [[], []] }), 1)).toBe(1);
  });

  it('says a bid the way it is said at a table', () => {
    expect(describeBid(bid(1, 6))).toBe('one 6');
    expect(describeBid(bid(3, 4))).toBe('three 4s');
    expect(describeBid(bid(14, 2))).toBe('14 2s');
  });
});

describe('the status line', () => {
  const names = ['Ann', 'Bo'];

  it('names what the player to move owes', () => {
    expect(liarsDice.status(position(), names)).toBe('Ann to open the round');
    expect(
      liarsDice.status(position({ bid: { seat: 0, quantity: 2, face: 2 }, turn: 1 }), names),
    ).toBe('Bo to raise or call');
    expect(liarsDice.status(position({ phase: 'reveal', turn: 1 }), names)).toBe(
      'Bo to roll the next round',
    );
  });

  it('names the winner and what they had left', () => {
    const won = position({ dice: [[], [3, 4]], over: true, phase: 'over', winner: 1, turn: 1 });
    expect(liarsDice.status(won, names)).toBe('Bo wins with 2 dice left');
    expect(liarsDice.status({ ...won, dice: [[], [3]] }, names)).toBe('Bo wins with 1 die left');
  });

  it('falls back to a seat number for a player who has not arrived', () => {
    expect(liarsDice.status(position(), [])).toBe('Player 1 to open the round');
  });
});

describe('in a room', () => {
  it('plays a bid through the engine, hiding the other hand on the way out', () => {
    const room = RoomEngine.create('LDICE1', 'liarsdice', Math.random, 2)!;
    room.join('p0', 'Ann');
    room.join('p1', 'Bo');

    const connected = new Set([0, 1]);
    const opener = room.viewFor(0, connected).turn!;
    expect(room.move(opener, { type: 'bid', quantity: 1, face: 3 }).ok).toBe(true);

    const state = room.viewFor(opener, connected).state as LdState;
    expect(state.dice[1 - opener].every((die) => die === HIDDEN_FACE)).toBe(true);
    expect(state.dice[opener].every((die) => die >= 1 && die <= FACES)).toBe(true);
  });
});

describe('full games', () => {
  /** Deterministic generator, so a failure here is reproducible. */
  function seeded(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0x100000000;
    };
  }

  /** A legal move for whoever is to play, drawn at random from all of them. */
  function anyMove(state: LdState, rng: () => number): LdMove {
    if (state.phase === 'reveal') return { type: 'next' };

    const floor = smallestRaise(state);
    // Nothing left to raise to means the only moves are the two calls — which
    // is the position the bid ceiling exists to force.
    if (floor === null) return rng() < 0.5 ? { type: 'challenge' } : { type: 'exact' };
    if (state.bid !== null) {
      const roll = rng();
      if (roll < 0.3) return { type: 'challenge' };
      // Spot on is drawn as often as anything else here, which is far more
      // often than anyone would call it: dice are paid back on a correct one,
      // and a game that only terminates while nobody uses the move is not a
      // game that terminates.
      if (roll < 0.45) return { type: 'exact' };
    }

    // A raise somewhere between the smallest legal one and the whole table.
    const room = totalDice(state) - floor.quantity;
    const quantity = floor.quantity + Math.floor(rng() * (room + 1));
    const face =
      quantity === floor.quantity
        ? floor.face + Math.floor(rng() * (FACES - floor.face + 1))
        : 1 + Math.floor(rng() * FACES);
    return { type: 'bid', quantity, face };
  }

  it('plays 200 random games to completion without breaking an invariant', () => {
    for (let game = 0; game < 200; game++) {
      const rng = seeded(game * 7919 + 13);
      const seats = 2 + (game % 3);
      let state = liarsDice.setup(seats, rng);
      let moves = 0;

      while (!liarsDice.isOver(state) && moves < 4000) {
        moves++;
        const seat = state.turn;
        const move = anyMove(state, rng);
        const result = liarsDice.applyMove(state, move, seat, rng);
        expect(result.ok, `game ${game}: ${JSON.stringify(move)} rejected`).toBe(true);
        if (!result.ok) break;
        state = result.state;

        // Nobody is ever holding a die that is not a die, and the player to
        // move is always someone who can actually move.
        expect(state.dice.flat().every((die) => die >= 1 && die <= FACES)).toBe(true);
        expect(isOut(state, state.turn) && !state.over).toBe(false);
        expect(totalDice(state)).toBeGreaterThan(0);
        // A die paid back never puts anyone above the hand they started with,
        // so the table can never grow past the one that was dealt.
        expect(state.dice.every((hand) => hand.length <= DICE_PER_PLAYER)).toBe(true);
      }

      // Every game ends, and ends with one player holding everything that is
      // left. A game that ran out of moves is a game with a cycle in it.
      expect(liarsDice.isOver(state), `game ${game} did not finish`).toBe(true);
      expect(livePlayers(state)).toEqual([state.winner]);
      expect(totalDice(state)).toBeLessThan(seats * DICE_PER_PLAYER);
    }
  });
});
