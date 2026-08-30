/**
 * One roll of the waifu gacha. Pure, seeded, and the only place a pull is
 * decided.
 *
 * Sibling to `chest.ts`, deliberately: same price, same balance, same rule
 * that **the server holds the randomness**, because a client that rolled its
 * own would reroll until it liked the answer and the reroll is one page
 * refresh. Read that file first; this one is written against it and only the
 * differences are argued here.
 *
 * **The difference that matters is that a roll repeats.** A chest never gives
 * you something twice, and that one rule is what lets it have no rarity table:
 * the destination is "own everything", so weights could only decide what
 * arrived first. Here the destination is the opposite. The roster is thousands
 * deep, nobody is ever going to finish it, and the point is the three you keep,
 * so a duplicate is a real outcome rather than a bug to design away. It pays
 * `DUPLICATE_REFUND` instead of nothing, which is the whole anti-frustration
 * valve and is one constant rather than a pity timer.
 *
 * **No rarity here either, and for a reason that survives the above.** Every
 * character is equally likely. A weight table would be the app deciding whose
 * favourite is worth more, which is a judgement it has no business making
 * about somebody else's taste, and the roster is popularity-ordered already,
 * so a weight on top of it would only compound the ordering it was built from.
 */
import { ROSTER } from './waifuRoster.js';

/**
 * One character, as everything but the art sees her.
 *
 * **Metadata only.** No image bytes reach `src/shared/`, for exactly the
 * reason `chest.ts` keeps ids and leaves the wardrobe art on the client: a
 * Durable Object cannot import a folder of pictures, and this one additionally
 * must not hold copies of art it did not draw. `image` is a URL on the source's
 * own CDN, so the roster is a list of references rather than a mirror. See
 * `scripts/build-waifu.ts`, which writes this file, and `waifuArt.ts` on the
 * client, which is the one function to change if the art is ever mirrored
 * locally.
 */
export interface Waifu {
  /** `anilist:40`. Namespaced so a second source can never collide with the first. */
  id: string;
  name: string;
  /** Whatever she is from, already picked down to one title. */
  series: string;
  /** Absolute URL, or empty when the source had no picture. */
  image: string;
  /** Free text from the source, lowercased. For filtering the collection. */
  tags: string[];
}

/**
 * What one roll costs, in experience earned on a language that is not English.
 *
 * The same hundred a chest costs, and **the same pooled balance**, which is the
 * decision worth defending. Two separate purses would mean neither spend had
 * any weight; one purse means a roll is a hoodie you did not buy, and that
 * choice is the only thing making either of them feel like it cost something.
 *
 * A hundred is roughly one game of Vocab Race or a good round of Word Chain.
 * That is the join the whole feature exists for: the person who wants Rem in
 * their showcase has to decline some Polish nouns first.
 */
export const ROLL_COST = 100;

/**
 * How many can be on show at once.
 *
 * Three, and it is small on purpose. A showcase that fitted everything would
 * be a collection with a different name, and the pressure to keep rolling
 * comes entirely from the slots being fewer than the people you like. Nothing
 * is ever lost to it: see `Profile.claimed`, which is append-only, so the
 * choice being made here is about display and never about deletion.
 */
export const SHOWCASE_MAX = 3;

/**
 * What a duplicate pays back.
 *
 * A quarter, so a repeat is a bad roll rather than a wasted one, and low
 * enough that rolling is never a way to farm the balance back up. It is
 * credited by *reducing the charge*, not by adding experience: `xp` is a
 * lifetime record of words and must never be paid for anything that is not a
 * word. See `Profile.spent`, which makes the same argument at more length.
 */
export const DUPLICATE_REFUND = 25;

/** The whole roster, in the order the source ranked it. */
export function roster(): readonly Waifu[] {
  return ROSTER;
}

/** One character by id, or undefined for an id the roster no longer has. */
export function waifuById(id: string): Waifu | undefined {
  return ROSTER.find((one) => one.id === id);
}

/**
 * One pull, or null when there is nobody to pull.
 *
 * Null rather than throwing, and **the caller must not charge for it**. Only
 * reachable with an empty roster, which is a build that shipped without
 * running the ingest script, but it is the cheapest bug to prevent and the
 * most annoying one to be on the wrong end of. Same contract as `openChest`.
 */
export function roll(pool: readonly Waifu[], rng: () => number): Waifu | null {
  if (pool.length === 0) return null;
  // Floored rather than rounded, which would give the first and last entries
  // half the probability of every other. The classic off-by-one in this exact
  // line, and it is called out in `openChest` for the same reason.
  const at = Math.floor(rng() * pool.length);
  return pool[Math.min(at, pool.length - 1)] ?? null;
}

/**
 * The showcase somebody asked for, made legal.
 *
 * Three rules, applied here rather than trusted from the client: nothing you
 * have not claimed, nothing twice, and no more than `SHOWCASE_MAX`. Order is
 * kept, because the order is the player's arrangement and the first slot is
 * the one that rides along beside their name in a room.
 *
 * Silently repaired rather than refused. The only ways to send an illegal list
 * are a stale tab and a tampered request, and neither is worth an error
 * message: the first deserves the nearest legal answer and the second is not
 * owed one.
 */
export function legalShowcase(asked: readonly string[], claimed: readonly string[]): string[] {
  const owned = new Set(claimed);
  const out: string[] = [];
  for (const id of asked) {
    if (out.length >= SHOWCASE_MAX) break;
    if (typeof id !== 'string' || !owned.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
