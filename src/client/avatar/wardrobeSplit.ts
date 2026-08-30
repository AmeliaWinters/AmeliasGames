/**
 * What a chest can hand over, and what you are simply given.
 *
 * Lives on the client because it reads an `AvatarSet`, which is the art. The
 * server never calls it: `scripts/build-wardrobe.ts` runs it once at build
 * time and writes the ids into `src/shared/wardrobe.ts`, which is the half the
 * Durable Object imports. `wardrobe.test.ts` runs it again at test time and
 * holds the two against each other, so the generated file cannot drift from
 * the art without failing.
 *
 * **Two rules decide the floor, and both are load bearing.**
 *
 * The first is Amelia's: the first two parts of every *required* slot are
 * free, and an optional slot gets nothing. A figure with no outfit is not a
 * figure this app will draw (see `SlotSpec.optional`), so the required slots
 * are exactly the ones that have to be fillable before anything can be drawn
 * at all.
 *
 * The second is the repair rule, and it exists because the first one breaks
 * three of the four sets on its own. `AvatarSet.starter` documents that every
 * part in it must be free, and the Kit's starter wears `hair/bob`,
 * `bangs/fringe` and `background/solid`, all in optional slots. Snake breaks on
 * three parts and Makowka on two. So whatever a set's starter wears is in the
 * floor as well, required or not. It costs eight items across four sets and it
 * is the difference between a new account looking like a person and looking
 * like a bald head on a blank ground.
 *
 * Colours are the third case. They are drops like anything else -- in the two
 * Picrew sets they are most of the wardrobe -- but **the first colour of every
 * colour-bearing slot is free whether or not the slot is required**, because a
 * part you own in no colour you own is a part that cannot be drawn, and the
 * customiser's repair path would have nothing to fall back to.
 */
import type { AvatarSet, Part, SetId, Slot } from './types.js';

/**
 * An owned id, which is **always stamped with its set**.
 *
 * `PartId` carries its set in the *type* and not in the string: `partId('kit',
 * 'hair/bob')` is the seven characters `hair/bob`, and the brand is phantom.
 * That is right for a `Loadout`, which names one set and cannot mix. It is
 * wrong for `Profile.owned`, which is one flat list across every set a player
 * has touched, where Sutemo's `hair/long` and the Kit's `hair/long` would be
 * the same string and owning one would silently grant the other.
 *
 * So ownership ids are namespaced here and nowhere else. Every id in the pool,
 * the floor and the profile has passed through this function or `colourId`.
 */
export function ownedId(set: SetId, part: string): string {
  return `${set}:${part}`;
}

/**
 * A colour, as an ownable id.
 *
 * Keyed by slot rather than by part, which is the same argument `ownsVariant`
 * makes: a hair colour is one unlock whichever cut it is on, and keying it per
 * part would make one shade five separate drops pretending to be one. The `#`
 * is what tells a colour from a part once the set prefix is off.
 */
export function colourId(set: SetId, slot: Slot, variant: string): string {
  return `${set}:#${slot}:${variant}`;
}

/** Whether an owned id names a colour rather than a part. */
export function isColourId(id: string): boolean {
  return id.slice(id.indexOf(':') + 1).startsWith('#');
}

/** The set an owned id belongs to, or an empty string for a malformed one. */
export function setOfId(id: string): string {
  const at = id.indexOf(':');
  return at < 0 ? '' : id.slice(0, at);
}

/** An owned id with its set stripped: `hair/bob`, or `#hair:dark`. */
export function bareId(id: string): string {
  const at = id.indexOf(':');
  return at < 0 ? id : id.slice(at + 1);
}

/** The distinct colours a slot offers, in manifest order, first one first. */
function coloursIn<S extends SetId>(set: AvatarSet<S>, slot: Slot): string[] {
  const seen: string[] = [];
  for (const part of set.parts) {
    if (part.slot !== slot) continue;
    for (const variant of part.variants) {
      if (!seen.includes(variant.id)) seen.push(variant.id);
    }
  }
  return seen;
}

function partsIn<S extends SetId>(set: AvatarSet<S>, slot: Slot): Part<S>[] {
  return set.parts.filter((part) => part.slot === slot);
}

/** How many of a slot's parts are free. See the two rules at the top. */
const FREE_PER_REQUIRED_SLOT = 2;

/**
 * Everything an account is handed for one set, without paying for it.
 *
 * Granted at signup for the starter set and on a set's *first chest* for every
 * other, which is what makes an unopened set worth opening: one chest turns a
 * locked set into a wearable character. The grant is `floor` minus what is
 * already owned, so it is the whole floor the first time and nothing after,
 * and no special case is needed to tell those apart.
 */
export function floorOf<S extends SetId>(set: AvatarSet<S>): string[] {
  const worn = new Set(Object.values(set.starter.parts).filter(Boolean) as string[]);
  const out: string[] = [];

  for (const spec of set.slots) {
    const parts = partsIn(set, spec.id);
    parts.forEach((part, i) => {
      const free = (!spec.optional && i < FREE_PER_REQUIRED_SLOT) || worn.has(part.id);
      if (free) out.push(ownedId(set.id, part.id));
    });
    // One colour per slot, always. A part with no wearable colour is not a
    // part somebody owns, whatever the ledger says.
    const colours = coloursIn(set, spec.id);
    if (colours.length > 0) out.push(colourId(set.id, spec.id, colours[0]));
  }

  return out;
}

/** Everything a chest can give for one set: the whole set, less the floor. */
export function poolOf<S extends SetId>(set: AvatarSet<S>): string[] {
  const free = new Set(floorOf(set));
  const out: string[] = [];

  for (const spec of set.slots) {
    for (const part of partsIn(set, spec.id)) {
      if (!free.has(ownedId(set.id, part.id))) out.push(ownedId(set.id, part.id));
    }
    for (const variant of coloursIn(set, spec.id)) {
      const id = colourId(set.id, spec.id, variant);
      if (!free.has(id)) out.push(id);
    }
  }

  return out;
}
