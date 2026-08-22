/**
 * The parts of Wheel of Fortune the board is allowed to know.
 *
 * Like `roomCode.ts`, this module deliberately imports nothing. The board
 * needs a few constants and a money formatter; it must never need `PUZZLES`.
 * Keeping those constants here rather than in `wheel.ts` means the client's
 * runtime import graph stops at this file and never reaches the answer bank —
 * a structural guarantee rather than one the bundler happens to provide.
 *
 * `wheel.ts` re-exports everything here, so the reducer and its tests carry on
 * importing from one place.
 */

export const ROUNDS = 3;
export const VOWEL_COST = 250;

/**
 * What solving the puzzle pays, on top of whatever the round has already won.
 *
 * It is deliberately large enough to be worth chasing: with everyone keeping
 * their round money now, spotting the phrase has to be the thing that decides
 * a game, or the winner is whoever happened to spin the biggest numbers.
 */
export const SOLVE_BONUS = 2000;

/**
 * Wrong guesses a player gets before the turn moves on.
 *
 * One strike and out made a turn a coin toss: call a letter that is not there
 * and you were finished, whatever you had worked out. Three is enough to back
 * a hunch — buy a vowel, miss, and still have a go at the phrase.
 */
export const GUESSES_PER_TURN = 3;

export const VOWELS = 'AEIOU';
/** Y is a consonant here, exactly as it is on the show. */
export const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Stands in for a letter nobody has called yet. Never appears in a puzzle —
 * `wheel.test.ts` holds the bank to that.
 */
export const BLANK = '_';

/**
 * A wedge on the wheel. Public information — this is a wheel in a room with
 * everyone looking at it, and the only secret in this game is the phrase.
 */
export type Wedge =
  | { kind: 'cash'; value: number }
  | { kind: 'bankrupt' }
  | { kind: 'lose-turn' };

const cash = (value: number): Wedge => ({ kind: 'cash', value });

/**
 * Twenty-four wedges in wheel order: twenty-one cash, two Bankrupt and one
 * Lose a Turn. The order is kept rather than sorted because it is a wheel, and
 * a wheel has an order — one the board now draws, so this is the layout of the
 * thing on screen as well as the odds behind it.
 */
export const WHEEL: readonly Wedge[] = [
  cash(900),
  cash(700),
  cash(300),
  cash(800),
  cash(550),
  cash(400),
  cash(300),
  cash(900),
  cash(500),
  cash(300),
  cash(900),
  { kind: 'bankrupt' },
  cash(600),
  cash(400),
  cash(300),
  cash(500),
  cash(800),
  cash(350),
  cash(450),
  cash(700),
  cash(300),
  cash(600),
  { kind: 'bankrupt' },
  { kind: 'lose-turn' },
];

/** Degrees of arc each wedge takes up. */
export const WEDGE_ARC = 360 / WHEEL.length;

/** What a wedge says on its face. Short, because it is written on a 15° slice. */
export function wedgeLabel(wedge: Wedge): string {
  if (wedge.kind === 'cash') return String(wedge.value);
  return wedge.kind === 'bankrupt' ? 'BANKRUPT' : 'LOSE TURN';
}

/** How a wedge reads in a sentence: "Ann spun Bankrupt." */
export function wedgeName(wedge: Wedge): string {
  if (wedge.kind === 'cash') return money(wedge.value);
  return wedge.kind === 'bankrupt' ? 'Bankrupt' : 'Lose a Turn';
}

/**
 * Money, grouped. Hand-rolled rather than `toLocaleString`, which depends on
 * whatever ICU data a given Node build happens to ship — a reducer that
 * formats differently on the server than in a test is not a pure reducer.
 */
export function money(amount: number): string {
  const digits = String(Math.abs(Math.trunc(amount)));
  let grouped = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ',';
    grouped += digits[i];
  }
  return `${amount < 0 ? '-' : ''}$${grouped}`;
}
