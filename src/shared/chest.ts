/**
 * Opening one chest. Pure, seeded, and the only place a drop is decided.
 *
 * **It runs on the server**, for the reason every other authority in this
 * system does: a client that rolled its own chest would reroll until it liked
 * the answer, and the reroll is one page refresh. The Durable Object supplies
 * the randomness, this decides what it means, and `chest.test.ts` supplies a
 * seed instead so the decision can be checked without being lucky.
 *
 * Randomness arrives as an argument rather than being reached for, which is
 * the same rule every game reducer in `src/shared/games/` follows and for the
 * same reason.
 *
 * **No rarity, no weights, no pity timer.** A chest picks one item at random
 * from what you do not own, and that is the whole of it. The thing that makes
 * that work is the other half of the design: a chest never gives you something
 * twice, so rarity would only decide what arrives *first*, not what you end up
 * with. A weight table that cannot change the destination is a table nobody
 * can tune against anything, so there isn't one.
 *
 * The consequence worth saying on the screen: **every chest is something new.**
 * Somebody who has met gacha before will assume otherwise and open more
 * cautiously than they need to.
 */
import { WARDROBE } from './wardrobe.js';

/**
 * One set's ids, with no art attached.
 *
 * Written by `scripts/build-wardrobe.ts` off the real manifests. See
 * `wardrobeSplit.ts` for what decides which id lands in which list; the rules
 * are on the client because they read the art, and only their answers come
 * here.
 */
export interface WardrobeSet {
  id: string;
  name: string;
  /** Handed over on this set's first chest. Never rolled. */
  floor: string[];
  /** Everything a chest can give. Disjoint from `floor`. */
  pool: string[];
}

/**
 * What one chest costs, in experience earned on a language that is not
 * English.
 *
 * One constant, deliberately, because it is the whole economy: there is no
 * rarity table underneath it and no per-item price. A chest lands roughly
 * every game at this number.
 *
 * The one thing it is not tuned for is set size. Ink is 34 drops and the two
 * Picrew sets are in the hundreds, so a flat price finishes Ink in a fortnight
 * and Character Maker never. If that turns out to matter, the fix is a price
 * on `WardrobeSet` rather than a rarity table; it is the same one-number
 * change per set.
 */
export const CHEST_COST = 100;

/**
 * A balance, said the way a screen has to say it.
 *
 * Two numbers, because "how much have I got" is not the question anybody is
 * actually asking on these screens. They are asking **can I open one now**,
 * and if not, **how much further**. A raw total answers neither without the
 * reader doing division, and the old header made them do it: it showed a
 * balance, or a count of banked chests, and never the distance to the next.
 *
 * Price is a parameter rather than `CHEST_COST` reached for directly, because
 * the waifu roll costs its own hundred out of the very same purse and both
 * screens have to agree about the arithmetic to the last unit. One function,
 * two callers, no chance of them drifting into saying different things about
 * one balance.
 */
export interface Purse {
  /** Openings affordable right now. */
  ready: number;
  /** Experience still needed for the next one. Zero when one is ready. */
  toNext: number;
}

export function purseOf(spendable: number, price: number): Purse {
  if (!(price > 0)) return { ready: 0, toNext: 0 };
  const have = Math.max(0, Math.floor(spendable));
  const ready = Math.floor(have / price);
  return { ready, toNext: ready > 0 ? 0 : price - (have % price) };
}

export function wardrobeSet(id: string): WardrobeSet | undefined {
  return WARDROBE.find((set) => set.id === id);
}

/**
 * The floor this account has not been given yet.
 *
 * Empty for a set already opened, which is what lets one code path serve both
 * "your first Character Maker chest, here are 39 items and a roll" and every
 * chest after it. No flag records whether a set has been opened because the
 * owned list already answers it.
 */
export function floorOwed(set: WardrobeSet, owned: ReadonlySet<string>): string[] {
  return set.floor.filter((id) => !owned.has(id));
}

/** How many of a set's drops are already owned. For the progress line. */
export function ownedIn(set: WardrobeSet, owned: ReadonlySet<string>): number {
  return set.pool.reduce((n, id) => (owned.has(id) ? n + 1 : n), 0);
}

/**
 * One drop, or null when the set is finished.
 *
 * Null rather than throwing, and **the caller must not charge for it**. Only
 * reachable on Ink for a long while, but it is the cheapest bug to prevent and
 * the most annoying one to be on the wrong end of.
 */
export function openChest(
  set: WardrobeSet,
  owned: ReadonlySet<string>,
  rng: () => number,
): string | null {
  const left = set.pool.filter((id) => !owned.has(id));
  if (left.length === 0) return null;
  // Floored rather than rounded: rounding would give the first and last items
  // half the probability of every other, which is the classic off-by-one in
  // this exact line.
  //
  // Clamped at both ends, and the floor is not decoration: `Math.min` alone
  // guards `rng() === 1`, but a generator handing back NaN or a negative fell
  // through the `?? null` and came out as "you have finished this set" -- the
  // one refusal that tells somebody to stop pressing. A broken generator has
  // to fail as a broken generator, so it lands on the first item instead.
  const at = Math.floor(rng() * left.length);
  const safe = Number.isFinite(at) ? Math.min(Math.max(at, 0), left.length - 1) : 0;
  return left[safe] ?? null;
}
