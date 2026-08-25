// WEDGE_ARC comes from wheelDisplay.js, which imports nothing, the same rule
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
  // `at * WEDGE_ARC`, so its middle has to come back by that much plus half a
  // wedge.
  //
  // `at` is fractional: it is `WofState.rest`, not `WofState.wedgeAt`. Whole
  // values are midpoints and the halves are the seams, the same convention
  // `restAfter` and `wedgeUnder` use, and it only works because this expression
  // was linear in `at` to begin with.
  return -(at * WEDGE_ARC + WEDGE_ARC / 2);
}

/**
 * How big the cap over the hub is drawn, as a radius.
 *
 * Thirty-six wedges meeting at a point is thirty-six slivers a fraction of a
 * unit wide, which turns to mush at any size and shimmers when the wheel
 * turns. A real wheel has a hub for the same reason: something has to hold the
 * middle. Wide enough to swallow the slivers and no wider: the wedges have to
 * read as slices of *this* disc, and a big cap makes them a ring again, which
 * is what the crop used to do and the complaint that started this.
 */
export const HUB_RADIUS = 11;

/** How far the flapper is pushed aside at the moment a peg passes under it. */
export const FLAP_MAX = 14;

/**
 * How far the flapper is deflected, given where the wheel is standing.
 *
 * The pointer used to be a fixed triangle, and a fixed triangle is why the
 * spin never looked like a wheel: on a real one the flapper is a loose strip
 * that each peg lifts and drops, so the wheel *ticks*, and the ticks slowing
 * down are how you feel it coming to rest. Nothing else on screen carries that,
 * since the disc is a blur of the same wedges either way.
 *
 * Zero for the first half of a wedge, then lifted through the second half as
 * the next peg rides up under it, then dropped. So it hangs still when the
 * wheel is at rest, a wheel stopping with the pointer in the *middle* of a
 * wedge rather than on a peg, which is the property the test pins.
 */
export function flapAngle(wheel: number): number {
  const within = (((wheel % WEDGE_ARC) + WEDGE_ARC) % WEDGE_ARC) / WEDGE_ARC;
  return FLAP_MAX * Math.max(0, (within - 0.5) * 2);
}
