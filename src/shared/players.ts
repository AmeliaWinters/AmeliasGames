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
import { CHEST_COST, floorOwed, openChest, wardrobeSet } from './chest.js';
import { DUPLICATE_REFUND, ROLL_COST, legalShowcase, roll, roster, type Waifu } from './waifu.js';
import { applyRecord, type GameRecord } from './harvest.js';
import { rankOf } from './review.js';
import {
  CHEST_MEMORY,
  isLearned,
  migrate,
  newProfile,
  profileView,
  spendable,
  type Known,
  type LearnLang,
  type Profile,
  type ProfileView,
} from './profile.js';

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
  /**
   * The word rows for one language, for the Vocabulary screen.
   *
   * Not `export`, which returns everything including the harvest keys and is
   * an insurance policy rather than a screen, and not `profile`, which is a
   * summary with twenty recent words on it. This is the middle size nothing
   * else needed until there was a list to draw: one language's rows, ordered,
   * and nothing else off the profile.
   */
  vocab: '/vocab',
  rename: '/rename',
  /**
   * Open one chest. The only player path a **browser** can cause.
   *
   * Every other path here is reached because a room decided something. This
   * one is reached because somebody pressed a button in the lobby, which has
   * no socket (see `net.ts`), so the worker verifies the account's claim and
   * forwards. That is a real widening of the trust boundary and it is safe for
   * one reason: the request carries no facts. It says "spend a hundred and
   * give me something", and the object decides both halves. Compare `/harvest`,
   * where a client that could post its own results could claim to know any
   * word it liked.
   */
  chest: '/chest',
  /**
   * Everything this account owns, for the customiser and the chest screen.
   *
   * Its own read rather than a field on `/profile`, because a finished
   * wardrobe is around 1,100 ids and 25KB and `/profile` is pushed after every
   * game. Same reasoning as `/vocab`: the summary carries what a menu needs
   * and the list is fetched by the screen that draws it.
   */
  wardrobe: '/wardrobe',
  /**
   * Roll the gacha. The second player path a **browser** can cause, and it
   * passes the same test `chest` does: the request carries no facts. It says
   * "spend a hundred and give me somebody", and the object decides the balance,
   * the pull and the result.
   */
  waifu: '/waifu',
  /**
   * Set the three on show. The one browser-reachable path here that *does*
   * carry a fact, and the narrowest possible kind: three ids the account has
   * already claimed. `legalShowcase` re-derives that from stored state rather
   * than trusting the list, so the worst a hostile request achieves is
   * rearranging its own showcase, which is what the button does anyway.
   */
  showcase: '/showcase',
  /**
   * Everything this account has rolled. Same bargain as `wardrobe`: a
   * collection grows without limit and `/profile` is pushed after every game,
   * so the list is fetched by the screen that draws it.
   */
  collection: '/collection',
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
  // `CHEST_COST` is handed to `migrate` rather than imported by it: version
  // 4's rung pays existing accounts in chests and needs the price, and
  // `profile.ts` imports nothing. This is the one call site that owes them.
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

/**
 * One language's rows, in the order the Vocabulary screen wants them.
 *
 * Sorted here rather than on the client because it is the same sort every
 * time and the server is already walking the array: learned words first,
 * then by how far along they are, then commonest first. A learner opening the
 * screen sees what they have earned at the top, which is the reason the screen
 * exists, and the words closest to joining them immediately under it.
 */
export function vocabOf(profile: Profile, lang: LearnLang): Known[] {
  return profile.words
    .filter((word) => word.lang === lang)
    .sort(
      (a, b) =>
        Number(isLearned(b)) - Number(isLearned(a)) ||
        b.run - a.run ||
        b.box - a.box ||
        (a.rank || Infinity) - (b.rank || Infinity),
    );
}

/** The summary a client is sent. See `ProfileView` for why it is not the profile. */
export function viewOf(profile: Profile, now: number): ProfileView {
  // `rankOf` rather than a level worked out here, because there is no longer
  // one level to work out: the curve is applied per language inside
  // `profileView`, which cannot import it. See `Rank` in `profile.ts`.
  return profileView(profile, now, rankOf);
}

/**
 * What a browser asks for when it opens a chest.
 *
 * Two fields, and neither is a fact about the player. The set is a choice and
 * the nonce is a receipt number; everything that decides the outcome is read
 * off the stored profile at the far end. See `PLAYER_PATHS.chest`.
 */
export interface ChestPost {
  /** Which set's chest. An unknown one is refused rather than defaulted. */
  set: string;
  /**
   * A one-off id the client mints per press. See `Profile.opens`.
   *
   * The client owns this rather than the server because the whole problem is
   * a *response* that went missing: the request succeeded, the profile was
   * written, and the browser never heard. Only the sender can recognise its
   * own retry.
   */
  nonce: string;
}

/** Why a chest could not be opened. Null when one was. */
export type ChestRefusal = 'no-such-set' | 'too-poor' | 'complete';

export interface ChestResult {
  /** The profile to store. Identical to the input when nothing was spent. */
  profile: Profile;
  /** What the chest gave, or null when it refused. */
  drop: string | null;
  /**
   * The floor handed over alongside the drop.
   *
   * The whole floor on a set's first chest and empty on every one after, which
   * is what turns "open your first Character Maker chest" into 39 items and a
   * wearable character rather than one hair clip for a set you own nothing
   * else in.
   */
  granted: string[];
  refusal: ChestRefusal | null;
  /** True when this was a retry and the drop is the original one. */
  repeat: boolean;
}

/** The separator inside an `opens` entry. Neither half can contain a space. */
const OPEN_SEP = ' ';



/**
 * Open one chest. Pure; the adapter stores what comes back.
 *
 * Follows `applyHarvest`'s contract: when nothing was spent, `profile` is the
 * very object passed in, so an adapter skips the write with `result.profile
 * !== profile` rather than comparing fields. A refusal must never cost
 * anything, and a completed set must never cost anything either -- that one is
 * checked *before* the charge rather than after, because the alternative is
 * taking a hundred experience for nothing on the last chest of a set.
 */
export function applyChest(profile: Profile, post: ChestPost, rng: () => number): ChestResult {
  // `post?.` rather than `post.`: a reducer that throws on the shape it was
  // handed is one the adapters have to keep honest for it, and both of them
  // build this object from `String(...)` a few lines before the call.
  //
  // The separator is refused here rather than assumed away. Both adapters bound
  // the nonce to `[A-Z0-9]` so this cannot arrive today, but the receipt format
  // below splits on a space: a nonce carrying one splits into the wrong halves,
  // and a later *legitimate* open of the same prefix is then answered as a
  // repeat and handed a fragment of another item's id. The invariant is stated
  // one line from the code that depends on it, rather than two layers away.
  const asked = post?.nonce ?? '';
  const set = asked && !asked.includes(OPEN_SEP) ? wardrobeSet(post.set) : undefined;
  if (!set) return { profile, drop: null, granted: [], refusal: 'no-such-set', repeat: false };

  // The retry path, and it comes first so a repeat can never be charged. The
  // original drop is stored beside the nonce precisely so this can answer with
  // it: a retry that said "opened, but I forget what you got" is a lost item.
  //
  // Matched on the set as well as the nonce. The nonce is chosen by the
  // client, so the same one arriving for a *different* set is a thing that can
  // happen, and answering it from the first set's receipt hands back an item
  // the caller did not ask about and cannot use.
  // Matched on the set as well as the nonce. The nonce is chosen by the
  // client, so the same one arriving for a *different* set is a thing that can
  // happen, and answering it from the first set's receipt hands back an item
  // the caller did not ask about and cannot wear in the set it named. An id
  // carries its set (`kit:mouth/surprised`), so the receipt says for itself
  // which chest it came out of.
  const seen = profile.opens.find((entry) => {
    if (entry.split(OPEN_SEP)[0] !== post.nonce) return false;
    return entry.slice(post.nonce.length + 1).startsWith(`${set.id}:`);
  });
  if (seen) {
    const drop = seen.slice(post.nonce.length + 1);
    return { profile, drop: drop || null, granted: [], refusal: null, repeat: true };
  }

  const owned = new Set(profile.owned);
  const granted = floorOwed(set, owned);
  for (const id of granted) owned.add(id);

  const drop = openChest(set, owned, rng);
  if (drop === null) {
    return { profile, drop: null, granted: [], refusal: 'complete', repeat: false };
  }

  // One purse and one price. There used to be a `credits` path here, spent
  // ahead of experience; it was a version 4 migration artefact denominated in
  // whole chests, and it went with version 6 because a second currency meant
  // the screen could never say what an open costs in one sentence.
  if (spendable(profile) < CHEST_COST) {
    return { profile, drop: null, granted: [], refusal: 'too-poor', repeat: false };
  }

  return {
    profile: {
      ...profile,
      owned: [...profile.owned, ...granted, drop],
      spent: profile.spent + CHEST_COST,
      opens: [...profile.opens, `${post.nonce}${OPEN_SEP}${drop}`].slice(-CHEST_MEMORY),
    },
    drop,
    granted,
    refusal: null,
    repeat: false,
  };
}

/** Everything this account owns. See `PLAYER_PATHS.wardrobe`. */
export function wardrobeOf(profile: Profile): string[] {
  return profile.owned;
}

/**
 * What a browser asks for when it rolls. One field, and it is a receipt number.
 *
 * No set to name, unlike `ChestPost`, because there is one pool. See
 * `waifu.ts` for why there is no rarity to choose either.
 */
export interface WaifuPost {
  /** A one-off id the client mints per press. See `Profile.opens`. */
  nonce: string;
}

/** Why a roll could not happen. Null when one did. */
export type RollRefusal = 'too-poor' | 'empty';

export interface RollResult {
  /** The profile to store. Identical to the input when nothing was spent. */
  profile: Profile;
  /** Who came out, or null when it refused. */
  pulled: Waifu | null;
  /** True when this was already in the collection. See `DUPLICATE_REFUND`. */
  duplicate: boolean;
  /** What the roll actually cost after any duplicate refund. */
  paid: number;
  refusal: RollRefusal | null;
  /** True when this was a retry and `pulled` is the original. */
  repeat: boolean;
}

/**
 * The prefix that marks an `opens` entry as a roll rather than a chest.
 *
 * The two share one ring, which is the decision worth stating. A separate list
 * would be a second thing to trim, a second field to migrate and a second
 * place to get the retry rule wrong, to buy nothing: the entries are matched
 * on the nonce the client minted, and one client mints both. What the prefix
 * buys is that a nonce reused across the two features cannot be answered from
 * the wrong receipt, which is the same bug `applyChest` guards by matching on
 * the set as well.
 */
const ROLL_TAG = 'w:';

/** The separator inside an `opens` entry. Neither half can contain a space. */
const ROLL_SEP = ' ';

/**
 * Roll once. Pure; the adapter stores what comes back.
 *
 * Follows `applyChest`'s contract exactly, including the part that matters
 * most: when nothing was spent, `profile` is the very object passed in, so an
 * adapter skips the write with `result.profile !== profile`. A refusal never
 * costs anything, and the empty-roster case is checked before the charge
 * rather than after.
 */
export function applyRoll(profile: Profile, post: WaifuPost, rng: () => number): RollResult {
  const nothing = (refusal: RollRefusal): RollResult => ({
    profile,
    pulled: null,
    duplicate: false,
    paid: 0,
    refusal,
    repeat: false,
  });

  // The separator is refused here rather than assumed away, for the reason
  // `applyChest` spells out: the receipt format splits on a space, so a nonce
  // carrying one splits into the wrong halves and a later legitimate roll of
  // the same prefix is answered as a repeat.
  const nonce = post?.nonce ?? '';
  if (!nonce || nonce.includes(ROLL_SEP)) return nothing('empty');

  // The retry path comes first so a repeat can never be charged. The pulled id
  // is stored beside the nonce precisely so this can answer with it: a retry
  // that said "rolled, but I forget who" is a lost character.
  const seen = profile.opens.find(
    (entry) => entry.startsWith(`${nonce}${ROLL_SEP}${ROLL_TAG}`),
  );
  if (seen) {
    const id = seen.slice(nonce.length + 1 + ROLL_TAG.length);
    const pulled = roster().find((one) => one.id === id) ?? null;
    return { profile, pulled, duplicate: false, paid: 0, refusal: null, repeat: true };
  }

  const pool = roster();
  if (pool.length === 0) return nothing('empty');

  // The pull is decided before the price, because the price depends on it: a
  // duplicate is cheaper, and working that out after charging would mean
  // refunding, which is one more state for a failed write to be caught in.
  const pulled = roll(pool, rng);
  if (!pulled) return nothing('empty');
  const duplicate = profile.claimed.includes(pulled.id);
  const price = duplicate ? Math.max(0, ROLL_COST - DUPLICATE_REFUND) : ROLL_COST;

  // The same purse a chest comes out of, which is the whole of `ROLL_COST`'s
  // argument: two balances would mean neither spend weighed anything.
  if (spendable(profile) < price) return nothing('too-poor');

  return {
    profile: {
      ...profile,
      claimed: [...profile.claimed, pulled.id],
      spent: profile.spent + price,
      opens: [...profile.opens, `${nonce}${ROLL_SEP}${ROLL_TAG}${pulled.id}`].slice(-CHEST_MEMORY),
    },
    pulled,
    duplicate,
    paid: price,
    refusal: null,
    repeat: false,
  };
}

/**
 * Rearrange the showcase. Pure, free, and never refuses.
 *
 * Free because nothing is being created: the characters are already claimed
 * and this only decides which three are on display. Charging to rearrange
 * would make the three slots a thing to be careful about rather than a thing
 * to fiddle with, which is the opposite of the point.
 *
 * Hands back the same object when the answer is unchanged, so the adapter can
 * skip the write on the ordinary case of somebody tapping a slot they already
 * had.
 */
export function applyShowcase(profile: Profile, asked: readonly string[]): Profile {
  const next = legalShowcase(asked, profile.claimed);
  const same =
    next.length === profile.showcase.length &&
    next.every((id, at) => profile.showcase[at] === id);
  return same ? profile : { ...profile, showcase: next };
}

/** Everything this account has rolled. See `PLAYER_PATHS.collection`. */
export function collectionOf(profile: Profile): string[] {
  return profile.claimed;
}
