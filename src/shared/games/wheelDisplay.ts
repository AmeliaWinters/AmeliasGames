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
 * Correct letters a player may find before the turn moves on.
 *
 * Without it a good spin was the whole round: find a letter, spin again, find
 * another, and a player who got going never handed the wheel back. A wrong
 * guess ends the turn on the spot, as it does on the show; three right ones
 * end it too, so a hot streak is worth having but not worth the whole round.
 */
export const FINDS_PER_TURN = 3;

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
 * Thirty-six wedges in wheel order: thirty-four cash, one Bankrupt and one
 * Lose a Turn. The order is kept rather than sorted because it is a wheel, and
 * a wheel has an order — one the board draws, so this is the layout of the
 * thing on screen as well as the odds behind it.
 *
 * **Why thirty-six and not the show's twenty-four.** The board shows a crop of
 * the rim rather than the whole disc, so the number of wedges sets how much of
 * the wheel is in view at once and not how big a wedge is drawn: more of them
 * means a longer rim streaming past the pointer, which is the thing that reads
 * as a spin. Twenty-four put nearly half the wheel in the window at the zoom
 * the numbers need to be legible, and you could see your fate coming.
 *
 * **Why one Bankrupt and one Lose a Turn.** The odds on a wedge are not the
 * odds a player feels; what they feel is how often a turn ends badly, and that
 * depends on how often they spin. On the show a turn is usually one spin. Here
 * `FINDS_PER_TURN` is three, so a good turn is three spins — and two bad
 * wedges in twenty-four took better than a fifth of all turns to nothing
 * (1 - (22/24)^3 = 21%). Two in thirty-six takes 16%, which is frightening
 * without being the thing the game is mostly about, and it was the second
 * complaint about this wheel after the size of its numbers.
 */
export const WHEEL: readonly Wedge[] = [
  cash(900),
  cash(500),
  cash(300),
  cash(800),
  cash(400),
  cash(650),
  cash(300),
  cash(550),
  cash(900),
  cash(350),
  cash(600),
  cash(300),
  cash(700),
  cash(450),
  cash(800),
  cash(300),
  cash(500),
  cash(650),
  { kind: 'bankrupt' },
  cash(400),
  cash(750),
  cash(300),
  cash(900),
  cash(500),
  cash(350),
  cash(600),
  cash(300),
  cash(850),
  cash(450),
  cash(700),
  cash(300),
  cash(550),
  cash(800),
  cash(400),
  cash(600),
  { kind: 'lose-turn' },
];

/** Degrees of arc each wedge takes up. */
export const WEDGE_ARC = 360 / WHEEL.length;

// ── The throw ──────────────────────────────────────────────────────────

/**
 * How far a spin carries, in wedges, at the gentlest and the hardest flick.
 *
 * The player grabs the rim and throws it, and the speed they let go at is what
 * decides where it stops — so these two numbers are the whole of the wheel's
 * feel. The floor is a little over a full turn: hard enough that a slow, aimed
 * drag cannot be used to park the wheel on a wedge somebody fancied, which is
 * the one way this control could be cheated. The ceiling is five and a half
 * turns, past which a spin is only a longer wait for the same answer.
 */
export const SPIN_MIN_TRAVEL = 40;
export const SPIN_MAX_TRAVEL = 198;

/**
 * Wedges travelled for a flick of `power`, where power is 0 at the minimum
 * useful speed and 1 at the point where throwing harder stops meaning
 * anything.
 *
 * Shared rather than server-only because the board animates the same journey
 * the reducer just resolved, and a wheel that turned a different distance from
 * the one it landed by would be an animation of a lie. The reducer adds a
 * wedge or two of drift on top — see `spin` in `wheel.ts` — so a player who
 * learned this curve by heart still could not aim.
 *
 * The clamp is not politeness: `power` arrives from a client, which may be
 * lying or broken, and a NaN here would travel the wheel nowhere for ever.
 */
export function spinTravel(power: number): number {
  const p = Number.isFinite(power) ? Math.min(Math.max(power, 0), 1) : 0;
  return Math.round(SPIN_MIN_TRAVEL + p * (SPIN_MAX_TRAVEL - SPIN_MIN_TRAVEL));
}

/**
 * What a wedge says on its face.
 *
 * In practice only the cash wedges reach it: a 10° slice has no room for a
 * word, so the board draws Bankrupt and Lose a Turn as marks instead and says
 * them in full in the readout underneath. The other two labels are kept
 * because this is what a wedge is called, and a function that answers for two
 * thirds of its type is a trap for the next caller.
 */
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
