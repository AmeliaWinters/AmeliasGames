/**
 * Yahtzee's constants, state shape and scoring table.
 *
 * Split out of the reducer for the reason `wheelDisplay.ts` and
 * `wordleDisplay.ts` were: the board needs these values at runtime, and this
 * module imports nothing, so taking them cannot drag `applyMove` and the
 * registry behind it into the client bundle. `bundle.test.ts` holds the whole
 * client to that line, not only the games with something to hide.
 *
 * There is no secret here — every score on the sheet is public and the dice
 * are on the table — so the split buys bundle size and nothing else. That is
 * still worth it: the scoring table is exactly what the board needs, and it is
 * the one part of these rules that is pure arithmetic over five numbers.
 */

// Both are leaves like this one — no reducer, no registry — so the board can
// take them without dragging `applyMove` into the browser behind them.
import type { Tray } from './dice.js';
import type { Flick, Toss } from './toss.js';

/**
 * The tray the dice are thrown into, in its own units.
 *
 * Not pixels: the server simulates the throw and reads the faces off it, so
 * the tray it simulates has to be the tray every device draws, whatever size
 * that device draws it at. The stylesheet holds the same shape as an
 * `aspect-ratio`, and the board scales one to the other.
 */
export const YAHTZEE_TRAY: Tray = { w: 100, h: 44, die: 7.5 };

export const DICE = 5;
export const FACES = 6;
/** Rolls per turn: the first, then two more of whatever you did not keep. */
export const ROLLS = 3;

export const UPPER_TARGET = 63;
export const UPPER_BONUS = 35;
export const FULL_HOUSE = 25;
export const SMALL_STRAIGHT = 30;
export const LARGE_STRAIGHT = 40;
export const YAHTZEE = 50;
/** Every Yahtzee after the first scoring one, on top of the box it fills. */
export const EXTRA_YAHTZEE = 100;

export const UPPER = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;
export const LOWER = [
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yahtzee',
  'chance',
] as const;
export const CATEGORIES = [...UPPER, ...LOWER] as const;

export type UpperCategory = (typeof UPPER)[number];
export type LowerCategory = (typeof LOWER)[number];
export type Category = (typeof CATEGORIES)[number];

/** Written the way a player would say them, since the board prints them. */
export const CATEGORY_NAME: Record<Category, string> = {
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  threeKind: 'Three of a kind',
  fourKind: 'Four of a kind',
  fullHouse: 'Full house',
  smallStraight: 'Small straight',
  largeStraight: 'Large straight',
  yahtzee: 'Yahtzee',
  chance: 'Chance',
};

/** What each upper box counts. */
export const FACE_OF: Record<UpperCategory, number> = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6,
};

/** The box that counts a given face. */
export function upperFor(face: number): UpperCategory {
  return UPPER[face - 1];
}

export function isUpper(category: Category): category is UpperCategory {
  return (UPPER as readonly string[]).includes(category);
}

/** One player's card. `null` is an open box; 0 is a box crossed off. */
export type Sheet = Record<Category, number | null>;

/** What just happened, for the board to narrate. Reads after a name. */
export interface Note {
  seat: number;
  text: string;
}

export interface YState {
  /** Five faces. 0 means "not rolled yet this turn" — see `hasRolled`. */
  dice: number[];
  /**
   * The last throw, or null before anyone has rolled. Not cleared at the turn
   * boundary: `n` has to keep counting for the life of the game, and a board
   * tells "nothing rolled yet" from the dice being zero rather than from this.
   */
  toss: Toss | null;
  /** Which dice the player to move is keeping. Cleared at the turn boundary. */
  held: boolean[];
  /** Rolls the player to move still has. ROLLS at the start of a turn. */
  rollsLeft: number;
  turn: number;
  /** 1-based, up to CATEGORIES.length: everyone fills one box per round. */
  round: number;
  sheets: Sheet[];
  /** Extra Yahtzees banked, worth EXTRA_YAHTZEE each. One entry per seat. */
  extras: number[];
  note: Note | null;
  over: boolean;
  /** Empty until the game ends; more than one seat on a tie. */
  winners: number[];
}

export type YMove =
  // The flick is how the dice were thrown, not what they landed on. Optional
  // because a keyboard has no flick in it, and a tap is a throw too.
  | { type: 'roll'; flick?: Flick }
  | { type: 'hold'; die: number }
  | { type: 'score'; category: Category };

export function emptySheet(): Sheet {
  return Object.fromEntries(CATEGORIES.map((category) => [category, null])) as Sheet;
}

/** Whether the player to move has dice on the table worth looking at. */
export function hasRolled(state: YState): boolean {
  return state.rollsLeft < ROLLS;
}

/** How many of each face, indexed by face — `counts(dice)[6]` is the sixes. */
export function counts(dice: readonly number[]): number[] {
  const tally = Array<number>(FACES + 1).fill(0);
  for (const die of dice) {
    if (die >= 1 && die <= FACES) tally[die]++;
  }
  return tally;
}

export function sumDice(dice: readonly number[]): number {
  return dice.reduce((sum, die) => sum + die, 0);
}

export function isYahtzee(dice: readonly number[]): boolean {
  return dice.length === DICE && dice.every((die) => die >= 1 && die === dice[0]);
}

/** The longest run of consecutive faces present, however often each appears. */
function longestRun(dice: readonly number[]): number {
  const tally = counts(dice);
  let best = 0;
  let run = 0;
  for (let face = 1; face <= FACES; face++) {
    run = tally[face] > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Whether a rolled Yahtzee is being played as a joker.
 *
 * Joker rules turn on the Yahtzee box being *filled*, not on it having scored:
 * a player who crossed Yahtzee off for zero still plays later Yahtzees as
 * jokers, they just collect no bonus for them. The two conditions stay
 * separate everywhere below for exactly that reason.
 */
export function jokerApplies(sheet: Sheet, dice: readonly number[]): boolean {
  return isYahtzee(dice) && sheet.yahtzee !== null;
}

/**
 * What `dice` are worth in `category`.
 *
 * `joker` is the one place the rules bend: a Yahtzee played as a joker fills
 * full house or either straight at face value, because the hand cannot form
 * them and the alternative — a forced zero in a box the player was *told* to
 * use — is not what the rules intend. Everything else scores as it reads, so
 * a Yahtzee of threes is 15 in Threes, 15 in either of-a-kind and 15 in
 * Chance, joker or not.
 */
export function scoreFor(category: Category, dice: readonly number[], joker = false): number {
  if (joker) {
    if (category === 'fullHouse') return FULL_HOUSE;
    if (category === 'smallStraight') return SMALL_STRAIGHT;
    if (category === 'largeStraight') return LARGE_STRAIGHT;
  }

  const tally = counts(dice);
  if (isUpper(category)) {
    const face = FACE_OF[category];
    return tally[face] * face;
  }

  switch (category) {
    case 'threeKind':
      return tally.some((n) => n >= 3) ? sumDice(dice) : 0;
    case 'fourKind':
      return tally.some((n) => n >= 4) ? sumDice(dice) : 0;
    case 'fullHouse':
      // Strictly three of one and two of another: five of a kind is a Yahtzee,
      // and only the joker rule above lets it stand in for a full house.
      return tally.some((n) => n === 3) && tally.some((n) => n === 2) ? FULL_HOUSE : 0;
    case 'smallStraight':
      return longestRun(dice) >= 4 ? SMALL_STRAIGHT : 0;
    case 'largeStraight':
      return longestRun(dice) >= 5 ? LARGE_STRAIGHT : 0;
    case 'yahtzee':
      return isYahtzee(dice) ? YAHTZEE : 0;
    case 'chance':
      return sumDice(dice);
  }
}

/**
 * The boxes this hand may be written into, which is usually "any open one".
 *
 * A joker is the exception, and the order matters: the matching upper box
 * first while it is open, then any open lower box, and only once the whole
 * lower section is full does the player get to cross off an upper box — which
 * by then can only score zero, since the box for the face they rolled is the
 * one that was already taken.
 */
export function legalCategories(sheet: Sheet, dice: readonly number[]): Category[] {
  const open = CATEGORIES.filter((category) => sheet[category] === null);
  if (!jokerApplies(sheet, dice)) return open;

  const box = upperFor(dice[0]);
  if (sheet[box] === null) return [box];

  const lower = open.filter((category) => !isUpper(category));
  return lower.length > 0 ? lower : open;
}

export function upperSubtotal(sheet: Sheet): number {
  return UPPER.reduce((sum, category) => sum + (sheet[category] ?? 0), 0);
}

export function upperBonus(sheet: Sheet): number {
  return upperSubtotal(sheet) >= UPPER_TARGET ? UPPER_BONUS : 0;
}

export function lowerSubtotal(sheet: Sheet): number {
  return LOWER.reduce((sum, category) => sum + (sheet[category] ?? 0), 0);
}

export function total(sheet: Sheet, extras = 0): number {
  return (
    upperSubtotal(sheet) + upperBonus(sheet) + lowerSubtotal(sheet) + extras * EXTRA_YAHTZEE
  );
}

export function isComplete(sheet: Sheet): boolean {
  return CATEGORIES.every((category) => sheet[category] !== null);
}
