/**
 * What this browser has somebody wearing.
 *
 * **Prototype storage, and it is meant to move.** The right home for an
 * equipped loadout is the profile, next to the streak and the ledger, so that
 * it follows an account onto another device and so the server can put it on
 * the wire when other players get to see each other's avatars. That needs a
 * `PROFILE_VERSION` bump and a migration rung, which is deliberately not part
 * of this prototype: see the note on `PROFILE_VERSION` about what a careless
 * rung costs. Until then it lives here, per browser, and is lost on a new
 * device. Nothing else reads it.
 *
 * **Ownership is not stored, and that is not an oversight.** Prices here are
 * thresholds rather than a balance (see `unlock.ts`), so what you own is a
 * pure function of your profile and can be recomputed at any moment. There is
 * no ledger of purchases to keep, nothing to reconcile after a sync, and
 * nothing that can be edited in a console to give somebody a hat they have not
 * earned, because the profile it is derived from is the server's.
 *
 * Carries the `?as=` suffix like `profileCache.ts` and for the same reason:
 * two tabs driving both seats of a game are two players.
 */

import { fits, setById, STARTER_SET, starterFor } from './manifest.js';
import type { Loadout } from './types.js';

function storageKey(): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return `ag.avatar${suffix ? `.${suffix}` : ''}`;
}

/**
 * The stored loadout, or null for somebody who has never opened the
 * customiser.
 *
 * Null rather than the starter, because the two are not the same thing to the
 * screens above: a player who has chosen nothing keeps their initial in the
 * account chip, which is the fallback the brief asks for. `starter()` is what
 * the customiser opens on.
 */
export function loadAvatar(): Loadout | null {
  try {
    return parseLoadout(localStorage.getItem(storageKey()));
  } catch {
    return null;
  }
}

/**
 * A loadout out of JSON, or null for anything this build cannot draw.
 *
 * Split out of `loadAvatar` because the same string now arrives from two
 * places, and the second one is the reason the guard has to be this strict:
 * since PROTOCOL_VERSION 11 a seat's avatar comes off the wire, written by
 * somebody else's browser, possibly a build ahead of or behind this one. A
 * loadout naming art this build has never heard of is dropped rather than half
 * drawn -- a figure with a missing head reads as the app being broken -- and
 * that is the whole reason the server is allowed to relay a string it cannot
 * check.
 */
export function parseLoadout(raw: string | null | undefined): Loadout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Loadout;
    const set = setById(parsed?.set);
    return set && fits(set, parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveAvatar(loadout: Loadout): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(loadout));
  } catch {
    /* a full or disabled store is not a reason to interrupt anything */
  }
}

/** What the customiser opens on when nothing has been chosen yet. */
export function starter(): Loadout {
  return starterFor(STARTER_SET);
}
