/**
 * Putting a chest's drop on.
 *
 * Its own file because two screens open chests: the shop behind the account
 * chip, and the one that opens over a room at the end of a game. It sat inside
 * the setup screen while that was the only caller.
 */

import { colourKeyOf, setById, starterFor } from "./manifest.js";
import { bareId, isColourId } from "./wardrobeSplit.js";
import type { Loadout } from "./types.js";

/**
 * Put a chest's drop on, switching sets if it belongs to another one.
 *
 * Returns null for a drop the current art cannot place, which is not a
 * theoretical case: a set can be re-extracted with fewer items while a profile
 * still lists one that went. The caller opens the customiser either way, so
 * the worst outcome is a screen that opens without the new thing on, rather
 * than a crash on the screen somebody pressed to see a present.
 *
 * A colour is equipped against the slot it is keyed to rather than the one it
 * names, which is the `colourKey` indirection: three hair depths are one head
 * of hair and one colour, so a fringe colour writes `hair`. Without this the
 * drop would land on a key nothing reads and the avatar would not change,
 * which looks exactly like the button being broken.
 */
export function equipDrop(current: Loadout, setId: string, drop: string): Loadout | null {
  const set = setById(setId);
  if (!set) return null;

  // Switching sets starts from that set's starter rather than from what is on
  // now: parts from two sets can never be combined, and `Loadout` is typed to
  // say so. See `types.ts`.
  const base: Loadout = current.set === set.id ? current : starterFor(set);
  const bare = bareId(drop);

  if (isColourId(drop)) {
    const [slot, variant] = bare.slice(1).split(":");
    const spec = set.slots.find((candidate) => candidate.id === slot);
    if (!spec) return null;
    const key = colourKeyOf(spec);
    return { ...base, variants: { ...base.variants, [key]: variant } };
  }

  const part = set.parts.find((candidate) => candidate.id === bare);
  if (!part) return null;
  return { ...base, parts: { ...base.parts, [part.slot]: part.id } };
}

