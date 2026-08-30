/**
 * Every set the app has, and the only place they are listed.
 *
 * Adding a third is meant to cost an entry here and a folder of art. If it
 * ever costs more than that, the interface in `types.ts` has stopped earning
 * its keep and should be fixed rather than worked around.
 */

import { KIT } from './sets/kit/index.js';
import { MAKOWKA } from './sets/makowka/index.js';
import { SNAKE } from './sets/snake/index.js';
import { SUTEMO } from './sutemo.js';
import type { AvatarSet, Loadout, Part, PartId, SetId, Slot, SlotSpec } from './types.js';

/**
 * Ordered as they are shown, cheapest first, which is also the order somebody
 * earns them in. The first entry is the one a new account starts in and it has
 * to be free.
 *
 * The Kit leads because it is the one somebody can actually make *themselves*
 * in: sixteen slots and a colour picker against Sutemo's eleven expressions.
 * Sutemo is the reward, and it is a different offer rather than a better one.
 *
 * The two Picrew sets sit past both, and past each other, because they are the
 * same offer twice: a wardrobe of somebody's painted art. Spacing them on two
 * different measures -- words known, then a month of days -- means the second
 * is still ahead of somebody who has already earned the first.
 */
export const SETS: AvatarSet[] = [
  KIT as AvatarSet,
  SUTEMO as AvatarSet,
  SNAKE as AvatarSet,
  MAKOWKA as AvatarSet,
];

export const STARTER_SET = SETS[0];

export function setById(id: string): AvatarSet | undefined {
  return SETS.find((set) => set.id === id);
}

/** The parts one set offers for one slot, in manifest order. */
export function partsIn<S extends SetId>(set: AvatarSet<S>, slot: Slot): Part<S>[] {
  return set.parts.filter((part) => part.slot === slot);
}

export function partOf<S extends SetId>(
  set: AvatarSet<S>,
  id: PartId<S> | undefined,
): Part<S> | undefined {
  if (!id) return undefined;
  return set.parts.find((part) => part.id === id);
}

/**
 * Whether a loadout is drawable by the set it names.
 *
 * The types already stop a Sutemo part reaching a Kit loadout at compile
 * time, which is where that mistake should be caught. This is the runtime half
 * for the one place the compiler cannot help: a loadout read back out of
 * storage, written by a version of the app that had different art.
 */
export function fits(set: AvatarSet, loadout: Loadout): boolean {
  if (loadout.set !== set.id) return false;
  return Object.values(loadout.parts).every(
    (id) => id === undefined || set.parts.some((part) => part.id === id),
  );
}

/**
 * A copy of the starter loadout, safe to mutate.
 *
 * Generic in the set, so `SUTEMO.draw(starterFor(SUTEMO))` type checks. A
 * plain `AvatarSet` argument would widen the result to any set and hand the
 * mixing problem straight back.
 */
/**
 * Which slot a slot's colour is stored under. Itself, unless it says.
 *
 * The one line of the colour rule, and it lives here because more than one
 * screen has to get it right: the customiser writes a colour, `equipDrop`
 * previews one, and `ownsVariant` is handed the answer already resolved. It is
 * an indirection rather than a convenience -- makowka draws the head, the face
 * and the ears as three tabs sharing one skin palette, so all three write
 * `body`, and a caller that used the tab's own slot shipped a face one shade
 * off the neck under it. See `SlotSpec.colourKey`.
 */
export function colourKeyOf(spec: SlotSpec): Slot {
  return spec.colourKey ?? spec.id;
}

export function starterFor<S extends SetId>(set: AvatarSet<S>): Loadout<S> {
  return {
    set: set.id,
    parts: { ...set.starter.parts },
    variants: { ...set.starter.variants },
  };
}
