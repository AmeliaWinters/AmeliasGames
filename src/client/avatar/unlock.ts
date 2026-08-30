/**
 * What you own, and how the screens ask.
 *
 * **This file used to be an economy and is now a lookup**, and the argument it
 * used to make is worth keeping because it is the reason the schema looks the
 * way it does.
 *
 * It said: nothing in the wardrobe is bought and nothing is spent, because
 * experience in this app is a cumulative record of learning rather than a
 * currency. Subtract a hoodie from it and somebody's headline figure falls
 * after a good week, which is the one thing a progress number may never do. So
 * you passed a mark, you owned the item, and owning three hats cost nothing.
 * It also named the cost of that decision out loud -- there was no choice in
 * the economy, nothing to save up for -- and nominated the overrule: give the
 * wardrobe a currency earned alongside experience rather than out of it.
 *
 * It has been overruled, and the nomination was half taken. Chests replaced
 * the thresholds and the currency *is* experience, which is exactly the thing
 * the old argument said it must not be. What saves it is `Profile.spent`: the
 * spend is stored beside the lifetime total instead of being taken out of it,
 * so `xp` never falls, `rankOf` never sees a chest, and no level moves
 * backwards. The argument survived by changing which number it is about.
 *
 * The consequence for this file is that **ownership is no longer derived**. It
 * used to be a pure function of a `ProfileView`, recomputable at any moment,
 * with no ledger to reconcile and nothing a console could edit to award a hat.
 * A roll is not a comparison, so the answer is now a list on the profile and
 * this file only asks whether an id is in it. The server owns that list; see
 * `wardrobeCache.ts` for what the copy in the browser is and is not.
 */
import { colourId, ownedId } from './wardrobeSplit.js';
import type { Part, SetId, Slot, Variant } from './types.js';

/**
 * The owned ids, as something to ask questions of.
 *
 * A `Set` rather than the array it arrives as, built once per render by the
 * screens that draw a grid: the customiser asks this up to a hundred and forty
 * times for one tab, and `Array.includes` over a thousand-id wardrobe would be
 * doing real work to answer a question about a button.
 */
export type Wardrobe = ReadonlySet<string>;

/** Nothing owned. What a screen draws before an answer has arrived. */
export const NOTHING: Wardrobe = new Set<string>();

export function wardrobeOf(owned: readonly string[] | null | undefined): Wardrobe {
  return owned ? new Set(owned) : NOTHING;
}

export function ownsPart(set: SetId, part: Part, owned: Wardrobe): boolean {
  return owned.has(ownedId(set, part.id));
}

/**
 * Whether a colour is owned.
 *
 * Keyed by **slot** rather than by the part wearing it, which is the one piece
 * of the old pricing model worth carrying over verbatim: a hair colour is one
 * unlock whichever cut it is on, and keying it per part would turn a single
 * colour into five separate drops pretending to be one. `wardrobeSplit.ts`
 * mints the same id when it builds the pool, so the two cannot disagree.
 */
export function ownsVariant(set: SetId, slot: Slot, variant: Variant, owned: Wardrobe): boolean {
  return owned.has(colourId(set, slot, variant.id));
}

/**
 * Whether a set can be worn at all.
 *
 * True once anything in it is owned, which in practice means once its first
 * chest has been opened: that chest hands over the set's whole floor, so the
 * answer flips from nothing to a wearable character in one press. There is no
 * separate unlock flag because there is nothing a flag would know that the
 * owned list does not.
 */
export function ownsSet(setId: string, owned: Wardrobe): boolean {
  const prefix = `${setId}:`;
  for (const id of owned) if (id.startsWith(prefix)) return true;
  return false;
}
