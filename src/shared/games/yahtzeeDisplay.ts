/**
 * Yahtzee's constants, state shape and scoring table — see the boundary note
 * in `types.ts`. Nothing here is secret: every score is public and the dice are
 * on the table, so the split buys bundle size and nothing else. Still worth it,
 * since the scoring table is pure arithmetic over five numbers.
 */

// Type-only: erased at compile time, so neither reaches the bundle.
import type { Tray } from './dice.js';
import type { Toss } from './toss.js';

/**
 * The tray, in its own units — not pixels. The throw is simulated against this
 * tray and the faces read off it, so it must be the tray every device draws at
 * whatever size; the stylesheet holds the same shape as an `aspect-ratio`.
 *
 * The die was 7.5 and is now a quarter smaller, which is a bigger change than
 * it sounds: the dice travel further before meeting anything, and a cube's
 * resistance to spin falls with the square of its size, so the same knock
 * spins it half again as hard. Both cost a retune — see `STEP` and `SPIN_MAX`.
 */
export const YAHTZEE_TRAY: Tray = { w: 100, h: 44, die: 5.63 };

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
   * The last throw, or null before anyone rolled. Not cleared at the turn
   * boundary — `n` counts for the life of the game, and "nothing rolled yet"
   * is told from the dice being zero instead.
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
  // What the client's simulation did, reported back — not a request to roll.
  // `readThrow` in `toss.ts` says how far it is believed; nothing usable means
  // the reducer rolls instead, which is what a keyboard roll takes.
  | { type: 'roll'; throw?: unknown }
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
 * Joker rules turn on the Yahtzee box being *filled*, not on it having scored:
 * a player who crossed it off for zero still plays later Yahtzees as jokers,
 * they just collect no bonus. The two conditions stay separate below for that.
 */
export function jokerApplies(sheet: Sheet, dice: readonly number[]): boolean {
  return isYahtzee(dice) && sheet.yahtzee !== null;
}

/**
 * `joker` is the one place the rules bend: a Yahtzee played as one fills full
 * house or either straight at face value, since the hand cannot form them and
 * a forced zero in a box the player was *told* to use is not the intent.
 * Everything else scores as it reads — a Yahtzee of threes is 15 either way.
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
      // Strictly 3+2: five of a kind is a Yahtzee, and only the joker rule
      // above lets it stand in for a full house.
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
 * Usually any open box. A joker is the exception and the order matters: the
 * matching upper box while it is open, then any open lower box, and only once
 * the lower section is full may an upper box be crossed off — which by then
 * can only score zero, the box for the rolled face being the one already taken.
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
