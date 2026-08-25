/**
 * The player store, as both adapters agree to see it.
 *
 * Same split as `session.ts`, one layer over: the decisions live here and the
 * I/O lives in the adapters. A profile is held in a Durable Object in
 * production and in a `Map` in the dev server, and neither of those differences
 * should be able to produce a different profile out of the same game.
 *
 * The pure part is small and it is the part worth sharing: read whatever was
 * stored, migrate it forward, apply one game, hand back what to store and what
 * to send. Everything either adapter adds to that is fetching and writing.
 */
import { applyRecord, type GameRecord } from './harvest.js';
import { levelFor, xpForLevel } from './review.js';
import { migrate, newProfile, profileView, type Profile, type ProfileView } from './profile.js';

/**
 * What a room posts to a player object when a game ends.
 *
 * `now` rides along rather than being read at the far end, because the room's
 * clock is the one the game was decided on and a review scheduled against a
 * different one would drift from the game that earned it. It is a server clock
 * either way — a client's never reaches here.
 */
export interface HarvestPost {
  record: GameRecord;
  /** Which seat of the record this account was sitting in. */
  seat: number;
  /** The idempotency key. See `harvestKey`. */
  key: string;
  now: number;
  /**
   * The name the player was using at the table.
   *
   * Sent so a profile picks up a name without a separate call: the commonest
   * way an account gets one is somebody typing it into the lobby, and the
   * lobby is not going to make a second request to say so. Only ever used to
   * fill a name that is empty, so it cannot be used by a room to rename
   * somebody who has already chosen.
   */
  name: string;
}

/** The paths a player object answers on. Named so the two adapters cannot drift. */
export const PLAYER_PATHS = {
  harvest: '/harvest',
  profile: '/profile',
  /** The whole ledger, for the export button. See `profile.ts`. */
  export: '/export',
  /**
   * The folded keys this account is due to review. See `StudyLists`.
   *
   * Read at every deal rather than at sign-in, because "due" is a comparison
   * against the clock and an answer cached at hello is stale by the time
   * anybody presses start. It is the one player path a *room* asks on its own
   * behalf rather than on a socket's, which is why it returns keys and not a
   * profile: a room has no business holding anybody's ledger.
   */
  study: '/study',
  rename: '/rename',
} as const;

/**
 * Read a stored profile, whatever state it is in.
 *
 * `migrate` never refuses, so this never refuses either: an account whose
 * storage is empty gets a fresh profile rather than an error, which is also how
 * an account is created. There is no sign-up step anywhere in this system, and
 * that is deliberate — the first game somebody plays signed in is the thing
 * that makes the profile exist.
 */
export function loadProfile(stored: unknown, id: string, now: number): Profile {
  if (stored === undefined || stored === null) return newProfile(id, '', now);
  const profile = migrate(stored, now);
  // The id is the address the object was reached at, not something the stored
  // blob gets to claim. A profile whose stored id disagreed with the object
  // holding it would be a profile that had been moved, and the address wins.
  return profile.id === id ? profile : { ...profile, id };
}

/**
 * Apply one finished game. Pure; the adapter stores what comes back.
 *
 * Returns the same object it was given when the key has already been applied,
 * so an adapter can skip the write with `next === profile` rather than
 * comparing anything. That matters more than it looks: the retry path exists
 * precisely because a write failed, and writing again for no reason is how a
 * retry storm starts.
 */
export function applyHarvest(profile: Profile, post: HarvestPost): Profile {
  const named = profile.name ? profile : { ...profile, name: post.name.slice(0, 20) };
  const next = applyRecord(named, post.record, post.seat, post.key, post.now);
  // `applyRecord` hands back its argument untouched when there was nothing to
  // do, and `named` is a different object from `profile` only when a name was
  // filled in — which is itself worth storing.
  return next === named && named === profile ? profile : next;
}

/** The summary a client is sent. See `ProfileView` for why it is not the profile. */
export function viewOf(profile: Profile, now: number): ProfileView {
  const level = levelFor(profile.xp);
  return profileView(profile, now, level, xpForLevel(level + 1));
}
