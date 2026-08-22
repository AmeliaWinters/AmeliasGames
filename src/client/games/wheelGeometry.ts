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
