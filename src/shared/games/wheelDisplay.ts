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

export const VOWELS = "AEIOU";
/** Y is a consonant here, exactly as it is on the show. */
export const CONSONANTS = "BCDFGHJKLMNPQRSTVWXYZ";
export const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Stands in for a letter nobody has called yet. Never appears in a puzzle —
 * `wheel.test.ts` holds the bank to that.
 */
export const BLANK = "_";

/**
 * A wedge on the wheel. Public information — this is a wheel in a room with
 * everyone looking at it, and the only secret in this game is the phrase.
 */
export type Wedge =
  | { kind: "cash"; value: number }
  | { kind: "bankrupt" }
  | { kind: "lose-turn" };

const cash = (value: number): Wedge => ({ kind: "cash", value });

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
  { kind: "bankrupt" },
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
  { kind: "lose-turn" },
];

/** Degrees of arc each wedge takes up. */
export const WEDGE_ARC = 360 / WHEEL.length;

// ── The throw ──────────────────────────────────────────────────────────

/**
 * The wheel's friction, in degrees of rotation per millisecond squared.
 *
 * A wheel on a spindle is slowed by a roughly constant frictional torque, so
 * it sheds speed at a constant rate: `v(t) = v0 - SPIN_DRAG * t`, and it stops
 * when that reaches zero. Everything else here — how far a throw carries, how
 * long it takes, and the curve the board eases along — falls out of that one
 * number, which is why it is the only one tuned by feel.
 *
 * Constant deceleration also gives the animation its shape exactly: distance
 * is `2t - t²` in normalised time, which is a quadratic ease-out, which is the
 * cubic-bezier the stylesheet carries. The wheel on screen is not *like* the
 * throw the reducer resolved; it is the same equation drawn.
 */
export const SPIN_DRAG = 0.000167;

/**
 * How far a spin carries, in wedges, at the gentlest and the hardest flick.
 *
 * The floor is nearly three turns, and it is a floor on the *speed* the wheel
 * leaves at rather than on the distance: let go slower than that — or
 * backwards-then-forwards, or without moving at all — and the wheel still goes
 * this far. A wheel that crept a wedge and stopped would let a player line up
 * the one they fancied and release, which is the one way a grabbable wheel can
 * be cheated. The ceiling is ten turns, past which a spin is only a longer
 * wait for the same answer.
 *
 * These were 40 and 198 against a drag of 0.00045, which put the whole range
 * between 1.3 and 3.0 seconds. That is the reported bug: constant deceleration
 * is *correct* over that window and still unreadable, because a wheel that is
 * done in a second and a third never gets to the crawl where the slowing shows.
 * A real wheel is heavy and it is watched, so the floor here is long enough to
 * watch: 3.5 seconds at the gentlest, 6.6 at the hardest.
 */
export const SPIN_MIN_TRAVEL = 102;
export const SPIN_MAX_TRAVEL = 360;

/** The release speed, in degrees of rotation per millisecond, that carries the
    wheel exactly `wedges` wedges: `v = sqrt(2 * a * s)`. */
const speedFor = (wedges: number) =>
  Math.sqrt(2 * SPIN_DRAG * wedges * WEDGE_ARC);

/**
 * The two ends of a flick, in degrees per millisecond.
 *
 * Derived rather than chosen, so that the clamps on speed and the clamps on
 * distance are the same two facts and cannot drift apart. `MAX` is about a
 * twentieth of a turn in the length of a frame — a hard thumb across a phone.
 */
export const SPIN_MIN_SPEED = speedFor(SPIN_MIN_TRAVEL);
export const SPIN_MAX_SPEED = speedFor(SPIN_MAX_TRAVEL);

/** A throw, as the reducer stores it and the board draws it. */
export interface Throw {
  /**
   * Signed wedges of *rotation*, positive clockwise — the direction a finger
   * dragging the top of the rim to the right sends it.
   *
   * The sign is the whole reason this is a number and not a distance: the
   * wheel is thrown either way, and a flick left has to end up left of where
   * it started.
   */
  travel: number;
  /** How long it is still moving, in milliseconds. */
  ms: number;
}

/**
 * How long a throw of `travel` wedges lasts.
 *
 * Not a constant and not proportional: `t = sqrt(2s/a)` is what constant
 * friction gives, so a throw four times as long lasts twice as long. Guessing
 * at this was what made every spin feel the same length as every other.
 */
export function spinMs(travel: number): number {
  const wedges = Math.min(
    Math.max(Number.isFinite(travel) ? Math.abs(travel) : 0, SPIN_MIN_TRAVEL),
    SPIN_MAX_TRAVEL,
  );
  return Math.round(Math.sqrt((2 * wedges * WEDGE_ARC) / SPIN_DRAG));
}

/**
 * The throw a release at `velocity` makes, where velocity is signed degrees of
 * rotation per millisecond at the moment the finger left the rim.
 *
 * Pure, and shared rather than server-only, because both ends need the same
 * answer for different reasons: the reducer to know which wedge came up, the
 * board to draw the journey that got there. A wheel that turned a different
 * distance from the one it landed by would be an animation of a lie.
 *
 * There is no randomness here at all, which is the point — the throw decides.
 * What stops a steady hand from aiming is not scatter but the anchor: `spin`
 * in `wheel.ts` measures this from where the wheel *stopped last time*, never
 * from wherever a slow drag left it, so lining the rim up buys nothing.
 *
 * The clamps are not politeness: `velocity` arrives from a client, which may
 * be lying or broken, and a NaN here would travel the wheel nowhere for ever.
 */
export function spinThrow(velocity: number): Throw {
  const v = Number.isFinite(velocity) ? velocity : 0;
  const speed = Math.min(Math.max(Math.abs(v), SPIN_MIN_SPEED), SPIN_MAX_SPEED);
  // s = v² / 2a, in degrees, then in wedges. Deliberately *not* rounded: a
  // whole number of wedges is a wheel that can only ever stop dead on a
  // midpoint, which is what made every landing look staged. The throw carries
  // however far it carries, and whichever wedge that leaves under the flapper
  // is the one that came up.
  const wedges = (speed * speed) / (2 * SPIN_DRAG * WEDGE_ARC);
  const travel = Math.min(Math.max(wedges, SPIN_MIN_TRAVEL), SPIN_MAX_TRAVEL);
  return { travel: v < 0 ? -travel : travel, ms: spinMs(travel) };
}

/**
 * Where the pointer ends up: `from`, carried `travel` wedges of rotation.
 *
 * The unit here is *wedges of pointer position*, and it is fractional. Whole
 * numbers are wedge midpoints, not wedge edges — `restAngle` puts position `p`
 * at `-(p * WEDGE_ARC + WEDGE_ARC / 2)`, so `p = 3` is the middle of wedge 3
 * and `p = 3.5` is the seam between 3 and 4. Everything downstream that wants
 * an index rounds; everything that wants an angle does not.
 *
 * The minus sign is the one piece of this geometry worth reading twice. The
 * wedges are numbered clockwise from twelve o'clock — see `sectorPath` — so
 * turning the disc clockwise brings the wedge *before* the current one under
 * the pointer. Rotation and index run opposite ways, and every place that
 * converts between them goes through here.
 */
export function restAfter(from: number, travel: number): number {
  const count = WHEEL.length;
  const at = (((from - travel) % count) + count) % count;
  // `from - travel` can land a hair under `count` and round up to it, which is
  // wedge `count` — an index that does not exist. Fold it back to zero.
  return at === count ? 0 : at;
}

/**
 * Which wedge the flapper is over, given a resting position from `restAfter`.
 *
 * Rounds rather than floors, because whole positions are midpoints: the wedge
 * runs from `at - 0.5` to `at + 0.5`. A rest of exactly `at + 0.5` is the seam,
 * and it goes to the higher wedge — arbitrary, but it has to go somewhere, and
 * the flapper is standing on the peg between them either way.
 */
export function wedgeUnder(rest: number): number {
  const count = WHEEL.length;
  return Math.round(rest) % count;
}

/** `restAfter` and `wedgeUnder` in one, for callers that only want the index. */
export function wedgeAfter(from: number, travel: number): number {
  return wedgeUnder(restAfter(from, travel));
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
  if (wedge.kind === "cash") return String(wedge.value);
  return wedge.kind === "bankrupt" ? "BANKRUPT" : "LOSE TURN";
}

/** How a wedge reads in a sentence: "Ann spun Bankrupt." */
export function wedgeName(wedge: Wedge): string {
  if (wedge.kind === "cash") return money(wedge.value);
  return wedge.kind === "bankrupt" ? "Bankrupt" : "Lose a Turn";
}

/**
 * Money, grouped. Hand-rolled rather than `toLocaleString`, which depends on
 * whatever ICU data a given Node build happens to ship — a reducer that
 * formats differently on the server than in a test is not a pure reducer.
 */
export function money(amount: number): string {
  const digits = String(Math.abs(Math.trunc(amount)));
  let grouped = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += ",";
    grouped += digits[i];
  }
  return `${amount < 0 ? "-" : ""}$${grouped}`;
}
