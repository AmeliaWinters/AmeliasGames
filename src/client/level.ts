/**
 * The arithmetic behind the level bar.
 *
 * Three functions that sat in the middle of `App.tsx` for want of anywhere
 * better. They are pure functions of a `ProfileView`, and the only reason they
 * were ever in a component file is that the component drawing the bar was.
 */

import type { ProfileView } from "../shared/profile.js";

/**
 * Experience still owed for the next level. Never negative.
 *
 * `nextLevel` is where the level after this one begins, so the difference is
 * the figure somebody is counting down, and it is the one the chip's bar draws
 * and the screen reader says.
 */
export function toNextLevel(profile: ProfileView): number {
  return Math.max(0, profile.rank.nextLevel - profile.rank.levelAt - progressInLevel(profile));
}

/** How far into the current level this account is, in experience. */
export function progressInLevel(profile: ProfileView): number {
  return Math.max(0, profile.xp - profile.rank.levelAt);
}

/**
 * The bar's fill, 0 to 100.
 *
 * Clamped at both ends rather than trusted: this draws a cached profile from
 * `profileCache.ts`, which can be a version older than the curve it is being
 * measured against, and a bar that went negative would render as one that had
 * gone backwards.
 */
export function levelFraction(profile: ProfileView): number {
  const span = profile.rank.nextLevel - profile.rank.levelAt;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, (progressInLevel(profile) * 100) / span));
}
