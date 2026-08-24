/**
 * The parts of Liar's Dice the board may know — see the boundary note in
 * `types.ts`. The board decides whose dice it may draw, whether a bid is legal
 * before the player commits, and how a bid reads as English: real logic, and
 * needed on both sides.
 */

// Type-only, so it is erased at compile time and never reaches the bundle.
import type { Tray } from './dice.js';

/** What everyone starts with. Lose one per call you get wrong. */
export const DICE_PER_PLAYER = 5;

/** An ordinary die. Ones are not wild here — see the note in `liarsDice.ts`. */
export const FACES = 6;

/**
 * What `view()` leaves where somebody else's die is. Not a face, so a hand that
 * reaches the wrong client cannot be counted even by accident, and any counting
 * bug shows up as a zero rather than as a plausible wrong answer.
 */
export const HIDDEN_FACE = 0;

export interface Bid {
  /** Who said it, so the board can name them without a second lookup. */
  seat: number;
  quantity: number;
  face: number;
}

/**
 * Which of the two calls was made.
 *
 * `liar` says the bid is too high and is settled by "at least": the bidder is
 * right the moment the count reaches what they claimed. `exact` says it is
 * neither too high nor too low, and is settled by the count landing on the
 * quantity to the die — a much narrower claim, and paid accordingly.
 */
export type CallKind = 'liar' | 'exact';

/** A call, and everything it turned up. Public the moment it happens. */
export interface Showdown {
  /** The bid that was called. */
  bid: Bid;
  /** What was claimed about it. */
  call: CallKind;
  challenger: number;
  /** How many of `bid.face` were actually on the table. */
  actual: number;
  /**
   * Who gave up a die, or null — which only ever happens on a spot-on call
   * that was right, the one call in the game that costs nobody anything.
   */
  loser: number | null;
  /**
   * Who took a die back: a spot-on caller who was right and was not already
   * holding a full hand. Null otherwise.
   */
  gainer: number | null;
  /**
   * Every hand as it stood when the call was made, revealed. This is the only
   * place hands are ever public, and it is the whole point of the game — a call
   * you cannot see the result of teaches nobody anything.
   */
  hands: number[][];
  /** Seats that ran out of dice on this call. */
  out: number[];
}

/**
 * The tray a player throws their own five into.
 *
 * Shorter than Yahtzee's, because it appears above a table of hands rather
 * than being the board: it has to be big enough to throw across and small
 * enough not to push everyone else's dice off a phone screen.
 */
export const LIARSDICE_TRAY: Tray = { w: 100, h: 40, die: 6.2 };

export interface LdState {
  /** 1-based, counting up for as long as the game lasts. */
  round: number;
  /**
   * `dice[s]` is seat `s`'s hand, empty once they are out. Redacted by `view()`
   * for every seat but the one being sent it — the lengths survive, because how
   * many dice a player holds is public and half the arithmetic in the game.
   */
  dice: number[][];
  turn: number;
  /** The bid on the table, or null at the top of a round. */
  bid: Bid | null;
  /**
   * Every bid made this round, oldest first, ending with `bid` while one is on
   * the table. The sequence is public — it was all said out loud — and it is
   * most of what a call is reasoned from: who climbed eagerly and who was
   * dragged. Cleared when the next round is rolled, and deliberately kept
   * through the reveal so the showdown can be read against the bidding that
   * led to it.
   */
  history: Bid[];
  /** `reveal` means the dice are face up and the next round is owed a roll. */
  phase: 'bid' | 'reveal' | 'over';
  /**
   * Which seats have thrown their own dice this round.
   *
   * The hands are dealt by the reducer as they always were, so a round is
   * always playable — but a client with a physics engine may throw its own and
   * report what it got, once, before it bids. `rolled[s]` is what stops that
   * being twice: a player who could re-roll until they liked their hand would
   * be playing a different game.
   */
  rolled: boolean[];
  /** Who opened the current round. */
  starter: number;
  /** The last call and what it found, or null before anyone has called. */
  showdown: Showdown | null;
  winner: number | null;
  over: boolean;
}

export type LdMove =
  /**
   * "I threw my dice, and this is what they say."
   *
   * Sent by a seat about its **own** hand, out of turn, at the top of a round.
   * See `owesRoll` and the note on `rolled` above for why it is allowed at all
   * and why it is allowed once.
   */
  | { type: 'roll'; faces?: unknown }
  | { type: 'bid'; quantity: number; face: number }
  | { type: 'challenge' }
  | { type: 'exact' }
  | { type: 'next' };

/**
 * Whether this seat still has its own throw to make.
 *
 * Rolling is the one thing in this game that happens out of turn — everyone's
 * dice hit the table at once — so it is a second predicate beside `turn`, and
 * `canAct` is the union of the two. Bidding controls must gate on `turn`, not
 * on `canAct`, or every player gets a bid box at the top of a round.
 */
export function owesRoll(state: LdState, seat: number): boolean {
  return (
    !state.over &&
    state.phase === 'bid' &&
    !isOut(state, seat) &&
    !state.rolled[seat] &&
    state.history.length === 0
  );
}

export function seatCount(state: LdState): number {
  return state.dice.length;
}

/** Out of dice is out of the game — but still sitting at the table. */
export function isOut(state: LdState, seat: number): boolean {
  return (state.dice[seat]?.length ?? 0) === 0;
}

export function livePlayers(state: LdState): number[] {
  return state.dice.flatMap((hand, seat) => (hand.length > 0 ? [seat] : []));
}

/**
 * The next seat round the table with dice left. Falls back to `from` rather
 * than looping forever if nobody has any, which cannot happen while a round is
 * running and is not worth a hang if it ever does.
 */
export function nextLive(state: LdState, from: number): number {
  const seats = seatCount(state);
  for (let step = 1; step <= seats; step++) {
    const seat = (from + step) % seats;
    if (!isOut(state, seat)) return seat;
  }
  return from;
}

/** Every die still in play. The ceiling on any honest bid. */
export function totalDice(state: LdState): number {
  return state.dice.reduce((sum, hand) => sum + hand.length, 0);
}

/**
 * How many of `face` are on the table. Only ever handed real hands — a redacted
 * hand is all `HIDDEN_FACE`, which is not a face and so counts as nothing.
 */
export function countFace(hands: readonly (readonly number[])[], face: number): number {
  let found = 0;
  for (const hand of hands) for (const die of hand) if (die === face) found++;
  return found;
}

/**
 * How many of `face` one seat is holding. Safe on a redacted state and honest
 * about it: every other hand is `HIDDEN_FACE`, so asking after somebody else's
 * dice on the client answers zero rather than answering wrongly.
 */
export function countInHand(state: LdState, seat: number, face: number): number {
  return countFace([state.dice[seat] ?? []], face);
}

/**
 * Every bid must be strictly larger than the one before: more dice, or the same
 * number of a higher face. That total order is what makes the round finite —
 * the bids can only climb, so somebody eventually has to call.
 */
export function beats(bid: Bid, previous: Bid | null): boolean {
  if (previous === null) return true;
  if (bid.quantity !== previous.quantity) return bid.quantity > previous.quantity;
  return bid.face > previous.face;
}

const NUMBERS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
];

/** "three 4s" — the way it is said out loud at a table. */
export function describeBid(bid: Bid): string {
  const count = NUMBERS[bid.quantity] ?? String(bid.quantity);
  return `${count} ${bid.face}${bid.quantity === 1 ? '' : 's'}`;
}

/** The same words for a count that is not a bid: "there were three 4s". */
export function describeCount(quantity: number, face: number): string {
  return describeBid({ seat: -1, quantity, face });
}

/**
 * The smallest bid that would beat what is on the table, which is where the
 * board's two spinners start. Rolls up to the next quantity once the faces run
 * out, and stops climbing at the number of dice in play — past that the bidding
 * is finished and the only moves left are the two calls.
 */
export function smallestRaise(state: LdState): Bid | null {
  const total = totalDice(state);
  const current = state.bid;
  if (current === null) return { seat: state.turn, quantity: 1, face: 1 };
  if (current.face < FACES) {
    return { seat: state.turn, quantity: current.quantity, face: current.face + 1 };
  }
  if (current.quantity >= total) return null;
  return { seat: state.turn, quantity: current.quantity + 1, face: 1 };
}
