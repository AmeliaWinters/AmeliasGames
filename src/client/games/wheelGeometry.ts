// WEDGE_ARC comes from wheelDisplay.js, which imports nothing — the same rule
// the board follows. Nothing in this file may reach for `wheel.ts`, which is
// where the puzzle bank lives.
import { WEDGE_ARC } from "../../shared/games/wheelDisplay.js";

/**
 * The wheel's geometry, drawn once for the two places that draw a wheel.
 *
 * The board spins a whole one; the game card shows the top of a much larger one
 * rising past the crop. They are the same wedges at different scales, and a
 * wedge that disagreed with itself between the lobby and the table would be a
 * small lie told twice.
 */

/** The rim, in the units both callers scale from. */
export const RADIUS = 100;

/**
 * One wedge, as a pie slice from the centre.
 *
 * Drawn about the origin rather than about a box centre, so a caller can put
 * the hub wherever its own crop needs it with a single translate.
 */
export function sectorPath(index: number): string {
  const point = (degrees: number) => {
    const rad = (degrees * Math.PI) / 180;
    // Twelve o'clock is zero and the angle runs clockwise, which is how the
    // wedges are numbered.
    return `${(RADIUS * Math.sin(rad)).toFixed(2)} ${(-RADIUS * Math.cos(rad)).toFixed(2)}`;
  };
  const from = index * WEDGE_ARC;
  return `M 0 0 L ${point(from)} A ${RADIUS} ${RADIUS} 0 0 1 ${point(from + WEDGE_ARC)} Z`;
}

/** How many wedges go round, which is the arc each one takes into a circle. */
export const WEDGE_COUNT = Math.round(360 / WEDGE_ARC);

/**
 * Where the wheel has to stand for wedge `at` to be under the pointer.
 *
 * Geometry rather than board code, because the flapper needs it too: "the
 * wheel is at rest" and "the flapper is hanging straight down" are the same
 * fact, and `wheelGeometry.test.ts` holds them to it.
 */
export function restAngle(at: number | null): number {
  if (at === null) return 0;
  // The pointer is at twelve o'clock, and wedge `at` runs clockwise from
  // `at * WEDGE_ARC` — so its middle has to come back by that much plus half
  // a wedge.
  return -(at * WEDGE_ARC + WEDGE_ARC / 2);
}

/**
 * The visible band of rim, as a path to clip the wheel with.
 *
 * A window that is a plain rectangle cuts the wedges off along a straight line
 * at the sides and the bottom, and what is left reads as a fan of stripes
 * rather than as part of a wheel — which is exactly what the first crop looked
 * like. Bounded by two circles instead, the same shape is unmistakable: the
 * rim curves away at the top, the band sweeps down as it goes out, and it runs
 * off both sides the way the rim of something much larger does.
 *
 * Even-odd, so the inner circle is a hole and not a second disc. Drawn about
 * the origin, like `sectorPath`, so one translate places both.
 */
export function bandPath(inner: number): string {
  const ring = (r: number) =>
    `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  return `${ring(RADIUS)} ${ring(inner)}`;
}

/** How far the flapper is pushed aside at the moment a peg passes under it. */
export const FLAP_MAX = 14;

/**
 * How far the flapper is deflected, given where the wheel is standing.
 *
 * The pointer used to be a fixed triangle, and a fixed triangle is why the
 * spin never looked like a wheel: on a real one the flapper is a loose strip
 * that each peg lifts and drops, so the wheel *ticks*, and the ticks slowing
 * down are how you feel it coming to rest. Nothing else on screen carries
 * that — the disc is a blur of the same wedges either way.
 *
 * Zero for the first half of a wedge, then lifted through the second half as
 * the next peg rides up under it, then dropped. So it hangs still when the
 * wheel is at rest — a wheel stops with the pointer in the *middle* of a
 * wedge, not on a peg — which is the property the test pins.
 */
export function flapAngle(wheel: number): number {
  const within = ((((wheel % WEDGE_ARC) + WEDGE_ARC) % WEDGE_ARC) / WEDGE_ARC);
  return FLAP_MAX * Math.max(0, (within - 0.5) * 2);
}
