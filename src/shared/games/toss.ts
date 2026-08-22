import type { Rest } from './dice.js';

/**
 * A throw of the dice: how it was thrown, and where it went.
 *
 * Three games roll dice and two of them throw them into a tray, so this is one
 * type rather than two fields invented separately.
 *
 * **Why the throw is on the wire.** The dice are simulated, and the number a
 * die shows is read off the cube when it stops — so the simulation is what
 * decides, and every client has to run the same one. This is what makes that
 * possible: the seed, the flick that threw them and where they were standing
 * when it happened are between them the whole input. See `dice.ts` for why it
 * is still the server that decides, and why the odds are still even.
 *
 * **Why `n` exists.** Two throws running can produce the same faces from the
 * same places, and dice that sat still on the second one would read as broken.
 * It is the same lesson `spins` taught the Wheel.
 */
export interface Toss extends Flick {
  /** Counts up for the life of the game. Never reset, never reused. */
  n: number;
  /** The server's. Drives the tumble, and nothing a client can guess. */
  seed: number;
  /**
   * Which of the cube's 24 orientations each die started in, drawn uniformly
   * from the server's rng. This is the draw that makes the odds even — see the
   * fairness note in `dice.ts`. Separate from `seed` on purpose: it has to be
   * independent of the rotation the tumble applies.
   */
  spin: number[];
  /** Where the dice were standing when it was thrown. */
  from: Rest[];
  /** And where they came to rest, which is where the next throw starts. */
  rest: Rest[];
}

/**
 * How the dice were thrown, as measured by the hand that threw them.
 *
 * This is the one number in the app that comes from a client and is *kept*. It
 * is safe because it is not enough to decide anything: the seed is the
 * server's and is drawn after the flick arrives, so no amount of aiming lets a
 * player pick their roll. It is still clamped, because "cannot be aimed" is
 * not the same as "can be anything" — a velocity of 1e308 would put the dice
 * through the wall on the first step, on every device in the room.
 */
export interface Flick {
  /**
   * The throw, in tray widths a second. Zero for a tap, which is a plain
   * throw with no direction of its own.
   *
   * Widths rather than pixels: a tray is about 320px on a phone and twice that
   * on a laptop, and a simulation fed pixels would land the dice on different
   * faces on the two of them. Both axes scale by the width, since a tray's
   * shape is fixed.
   */
  x: number;
  y: number;
}

/**
 * As hard as a die can be thrown: eight tray widths a second, which is faster
 * than a thumb can move and well short of a number that would need the solver
 * to start worrying about tunnelling.
 */
export const MAX_FLICK = 8;

function real(value: unknown, low: number, high: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, low), high)
    : 0;
}

/** A flick as it arrived from a client, which is to say: anything at all. */
export function readFlick(value: unknown): Flick {
  if (!value || typeof value !== 'object') return { x: 0, y: 0 };
  const sent = value as Partial<Flick>;
  return { x: real(sent.x, -MAX_FLICK, MAX_FLICK), y: real(sent.y, -MAX_FLICK, MAX_FLICK) };
}
