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
/** Solving is always worth something, so an early guess is never a wasted one. */
export const ROUND_MINIMUM = 500;

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
