import type { Rng } from '../types.js';

/**
 * The two ways this project turns an `Rng` into a number, in one place because
 * both of them need the same guard.
 *
 * `Rng` is documented as returning [0, 1), and Math.random does — but a
 * hand-written test rng returning exactly 1 would pick one past the end of the
 * array (and roll a 7), and one returning NaN would poison the state silently.
 * Every game that touches chance needs that clamp, so none of them own it.
 */
function unit(rng: Rng): number {
  const raw = rng();
  return Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
}

/** An index into something `length` long. */
export function pick(rng: Rng, length: number): number {
  return Math.floor(unit(rng) * length);
}

/** One six-sided die, 1 to 6. */
export function die(rng: Rng): number {
  return 1 + pick(rng, 6);
}
