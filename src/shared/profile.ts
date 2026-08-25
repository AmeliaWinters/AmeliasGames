/**
 * What a player carries between games.
 *
 * This module imports **nothing**, and that is load-bearing rather than tidy.
 * The profile screen is drawn on the client, the client has no dictionary and
 * may never have one (`bundle.test.ts` builds the real bundle and greps it),
 * and every word on this object therefore has to arrive carrying its own gloss,
 * script and rank. One convenience import here of anything that reaches
 * `chainWords.ts` would put sixty thousand Polish inflections on the phone of
 * everybody who opens the lobby. See `Known` for the same point said again in
 * the place somebody would be tempted to undo it.
 *
 * The shape here is deliberately dull: arrays and numbers, no Maps, no Sets,
 * nothing that does not survive `JSON.parse`. It is persisted by two adapters
 * that store it very differently, and it is exported to a file the player
 * keeps.
 */

/**
 * Bumped whenever the persisted shape changes. **It is not `SNAPSHOT_VERSION`
 * and must never be treated like it.**
 *
 * A room snapshot from an older version is *discarded*: `RoomEngine.restore`
 * returns null and the adapter deletes it, which is exactly right, because the
 * thing being thrown away is one game of Yahtzee that nobody was playing any
 * more. Copy those four lines onto a profile and the deploy that adds a field
 * silently deletes a year of somebody's Polish.
 *
 * So a profile is **migrated forward, never discarded**. `migrate` below is a
 * ladder of one step per version and it runs on every read. Adding a version
 * means adding a rung and a fixture; `profile.test.ts` walks a stored profile
 * from every historical version to the current one and fails if a rung is
 * missing.
 *
 * 1: the first shape.
 */
export const PROFILE_VERSION = 1;

/**
 * The languages the ledger can hold a word in.
 *
 * The same three Word Chain plays, spelled out here rather than imported from
 * `wordChainDisplay.ts`, because importing it would tie the persisted shape of
 * a profile to a game's display module: dropping a language from the game
 * would then change what a stored profile is allowed to contain, and the words
 * already in it would stop type-checking. A profile outlives the games that
 * filled it. `profile.test.ts` holds the two lists against each other so they
 * cannot quietly diverge either.
 */
export type LearnLang = 'en' | 'pl' | 'ja';

export const LEARN_LANGS: readonly LearnLang[] = ['en', 'pl', 'ja'];

/**
 * One word you have met, in one language.
 *
 * **The row is the lemma, not the word played.** Polish files `jestem` and
 * `być` as separate entries and the game plays them separately, which is right
 * for the game and wrong for this: a learner who has played six inflections of
 * one verb has learned one verb, and a ledger claiming six is lying to the
 * person using it to decide what to study. `key` is the folded lemma, produced
 * by the game's own `record()` where the dictionary is, and `word` is whichever
 * form was actually on the screen most recently.
 *
 * **Everything the screen shows is stored here rather than looked up.** The
 * gloss, the script, the lemma and the rank cost about eighty bytes a row and
 * they are the only reason a profile can be drawn at all — see the note at the
 * top of this file. It reads as redundant storage right up until you try to
 * render it.
 */
export interface Known {
  lang: LearnLang;
  /** Folded lemma: the identity. Two rows may never share one. */
  key: string;
  /** The form last seen on screen: `żółty`, not `zolty`. */
  word: string;
  /** Japanese in its own script. Empty for the other two. */
  script: string;
  /** The dictionary form, when the word played was an inflection of it. */
  lemma: string;
  /** What it means, in English, as the list gives it. */
  gloss: string;
  /** Position in its own language's frequency list, commonest first. */
  rank: number;

  /** How often it has been in front of you, produced by you, and missed. */
  seen: number;
  got: number;
  missed: number;

  /** When it was last graded, and when it comes back. Server clock, both. */
  lastAt: number;
  /**
   * When this word is next worth asking about.
   *
   * Stored as a deadline rather than as an interval, for the same reason
   * `LetterCooldown.until` is: nothing has to remember to decrement it, and a
   * profile restored from storage cannot come back with a tick already spent.
   * It is also the single number the whole feature is for — "18 words due" on
   * the lobby is a count over this field.
   */
  dueAt: number;
  /** Rung on the ladder. See `BOXES` in `review.ts`. */
  box: number;
  /** The quickest you have ever produced it, in ms. Zero until you have. */
  fastestMs: number;
}

/** What one game did, kept per game rather than as one running total. */
export interface GameTally {
  gameId: string;
  played: number;
  won: number;
  /** Games that ended with no single winner. Not every game can produce one. */
  drew: number;
  lastAt: number;
}

/**
 * Days in a row with at least one word reviewed.
 *
 * A day is a UTC day number, `floor(ms / 86_400_000)`, decided on the server.
 * That is wrong by up to half a day for somebody in New Zealand and it is
 * still the right call: the alternative is trusting a client's timezone, and a
 * player who wants a longer streak could then simply claim to be somewhere
 * else. A boundary that is occasionally inconvenient beats one that can be
 * chosen.
 *
 * `rests` is the forgiving part, and it is here from the start rather than
 * added later after somebody loses a hundred-day streak to a bad week. See
 * `bumpStreak`.
 */
export interface Streak {
  /** How many days long, counting today if today is done. */
  days: number;
  /** UTC day number of the last day with a review in it. */
  lastDay: number;
  /** Rest days already spent inside the current streak. See `bumpStreak`. */
  rests: number;
}

export interface Profile {
  version: number;
  /** The account id. See `account.ts`; opaque here on purpose. */
  id: string;
  name: string;
  createdAt: number;

  /**
   * Experience, and the one number on this object that is a scoreboard rather
   * than a measurement.
   *
   * It is paid for words and only incidentally for games. See `xpFor` in
   * `review.ts` for the whole argument, which is not really about arithmetic:
   * Vocab Race already halves a fluent speaker's points so that a learner is
   * not farmed, and an XP curve that paid for wins would reverse that decision
   * from outside the reducer while the reducer's comments still claimed
   * otherwise.
   */
  xp: number;
  streak: Streak;
  games: GameTally[];

  /**
   * Every word met, in no particular order.
   *
   * An array rather than a keyed object because it is persisted, exported and
   * migrated, and an array of records is the shape all three of those are
   * easiest to reason about. Lookups build a Map for the duration of one
   * harvest, which touches thirty rows out of a few thousand and is not worth
   * a different data structure.
   */
  words: Known[];

  /**
   * Harvest keys already applied, newest last. The idempotency record.
   *
   * A room hands its results to the player objects and *then* writes down that
   * it has done so, so a crash between the two re-sends the same harvest. That
   * is deliberate — at-least-once delivery into a receiver that can recognise a
   * repeat is the only exactly-once anybody actually builds — and this is the
   * half that recognises it.
   *
   * Trimmed to `APPLIED_MEMORY`, because a duplicate is a retry and arrives
   * within seconds; keeping every key a player has ever earned would grow the
   * profile forever to defend against a collision that cannot happen. The keys
   * carry a random per-room run id rather than just the room code for exactly
   * that reason — see `harvestKey`.
   */
  applied: string[];
}

/**
 * How many harvest keys a profile remembers.
 *
 * A hundred is roughly a fortnight of heavy play, and duplicates arrive inside
 * a second. The number only has to be larger than the number of games a player
 * can finish between a failed write and its retry, which is one.
 */
export const APPLIED_MEMORY = 100;

/** A fresh profile, for an account that has just been made. */
export function newProfile(id: string, name: string, now: number): Profile {
  return {
    version: PROFILE_VERSION,
    id,
    name,
    createdAt: now,
    xp: 0,
    streak: { days: 0, lastDay: 0, rests: 0 },
    games: [],
    words: [],
    applied: [],
  };
}

/** The UTC day a moment falls in. See `Streak`. */
export function dayOf(now: number): number {
  return Math.floor(now / 86_400_000);
}

/**
 * How many rest days a streak of this length has earned.
 *
 * One per week, available from the first day rather than after the first week:
 * a streak is most fragile at the beginning, when it is worth least and so
 * gets the least care, and a player who loses their third day has no reason to
 * start again. The generosity costs nothing, since a rest is only ever spent
 * on a gap of exactly one day.
 */
export function restsFor(days: number): number {
  return Math.ceil(Math.max(days, 1) / 7);
}

/**
 * Record a day of study, and return the streak that leaves.
 *
 * Four cases, and only the third is interesting:
 *
 * - **the same day again**: nothing changes. A player reviewing twice before
 *   lunch has not done two days.
 * - **yesterday**: the ordinary case, one longer.
 * - **the day before yesterday, with a rest in hand**: the missed day is
 *   absorbed and the streak continues, one longer, one rest poorer. Silently,
 *   with nothing to buy and no notification implying failure — a streak that
 *   punishes a bad week is a streak people quit over, and the person quitting
 *   takes their Polish with them.
 * - **anything longer**: it went. Back to one, with the rests reset, because
 *   the allowance belongs to the streak and not to the account.
 *
 * Pure and given `now`, like everything else here that touches a clock.
 */
export function bumpStreak(streak: Streak, now: number): Streak {
  const today = dayOf(now);
  const gap = today - streak.lastDay;

  if (gap <= 0) return streak;
  if (gap === 1) {
    return { days: streak.days + 1, lastDay: today, rests: streak.rests };
  }
  if (gap === 2 && streak.rests < restsFor(streak.days)) {
    return { days: streak.days + 1, lastDay: today, rests: streak.rests + 1 };
  }
  return { days: 1, lastDay: today, rests: 0 };
}

/** The row for one word, or undefined. Rows are identified by language *and* key. */
export function findWord(profile: Profile, lang: LearnLang, key: string): Known | undefined {
  return profile.words.find((word) => word.lang === lang && word.key === key);
}

/** How many words are worth asking about right now. The number the lobby shows. */
export function dueCount(profile: Profile, now: number): number {
  return profile.words.reduce((n, word) => (word.dueAt <= now ? n + 1 : n), 0);
}

/** How many words are in the ledger at all, per language. */
export function wordCount(profile: Profile, lang?: LearnLang): number {
  return lang === undefined
    ? profile.words.length
    : profile.words.reduce((n, word) => (word.lang === lang ? n + 1 : n), 0);
}

/**
 * The tally for one game, or a fresh zeroed one. Never mutates.
 *
 * A game with no tally and a game played zero times are the same thing, so
 * this hands back a zero rather than undefined and the callers stop having to
 * care which it was.
 */
export function tallyFor(profile: Profile, gameId: string): GameTally {
  return (
    profile.games.find((game) => game.gameId === gameId) ?? {
      gameId,
      played: 0,
      won: 0,
      drew: 0,
      lastAt: 0,
    }
  );
}

/**
 * Bring a stored profile up to the current shape.
 *
 * One rung per version, each doing exactly one step, applied in order from
 * whatever the stored version says. **Never returns null.** A profile that
 * cannot be read is still somebody's vocabulary, so the worst case here is a
 * shape that has been repaired conservatively, not a shape that has been
 * deleted. That is the whole difference between this and `RoomEngine.restore`.
 *
 * Unknown or missing fields are filled from `newProfile`, so a profile written
 * by a *newer* build (a player who used a second device before this one was
 * redeployed) loses nothing it does not have to: the fields this build does not
 * know about ride along untouched.
 */
export function migrate(stored: unknown, now: number): Profile {
  const raw = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Profile>;
  const base = newProfile(String(raw.id ?? ''), String(raw.name ?? ''), Number(raw.createdAt) || now);

  const profile: Profile = {
    ...base,
    ...raw,
    // Spread first, then repair: the fields below are the ones an older or
    // damaged profile can be missing outright, and a `.reduce` over undefined
    // is a crash on the read path of the one object that must never fail to
    // load.
    id: base.id,
    name: base.name,
    createdAt: base.createdAt,
    xp: Number(raw.xp) || 0,
    streak: {
      days: Number(raw.streak?.days) || 0,
      lastDay: Number(raw.streak?.lastDay) || 0,
      rests: Number(raw.streak?.rests) || 0,
    },
    games: Array.isArray(raw.games) ? raw.games : [],
    words: Array.isArray(raw.words) ? raw.words : [],
    applied: Array.isArray(raw.applied) ? raw.applied : [],
    version: PROFILE_VERSION,
  };

  // Rungs go here as the shape changes, keyed off `raw.version`. There are
  // none yet, and the ladder is written out anyway so the first one has an
  // obvious place to go and does not arrive alongside an argument about where
  // migrations should live.
  return profile;
}

/**
 * What a client is told about its own profile.
 *
 * **Not the profile.** Five thousand words is around 600KB and it would go out
 * on every hello, on a phone, over whatever connection the player has. So this
 * is the shape the lobby and the profile screen can be drawn from — counts, a
 * level, a streak, the number due, and enough recent words to fill a panel —
 * and anything deeper is a second request made when somebody actually opens
 * the ledger.
 *
 * `due` is the number the whole feature turns on. It is the one figure that
 * brings a player back, it goes on a screen they already open, and it is worth
 * more than the experience points and the level put together, because it is the
 * only one of the three that is about the words.
 */
export interface ProfileView {
  id: string;
  name: string;
  xp: number;
  level: number;
  /** Total at which the next level begins, so a bar has something to fill. */
  nextLevel: number;
  streak: Streak;
  /** Words in the ledger, and how many have come back round. */
  words: number;
  due: number;
  /** Per language, in the order `LEARN_LANGS` gives, skipping empty ones. */
  byLang: Array<{ lang: LearnLang; words: number; due: number }>;
  games: GameTally[];
  /** The most recently touched words, newest first. See `RECENT`. */
  recent: Known[];
}

/**
 * How many words ride along on the summary.
 *
 * Enough to fill the panel on the profile screen and the one on a game's end
 * screen, and few enough that the message stays small. Twenty rows is about
 * 2KB, against 600KB for the whole ledger.
 */
export const RECENT = 20;

export function profileView(profile: Profile, now: number, level: number, nextLevel: number): ProfileView {
  const byLang = LEARN_LANGS.flatMap((lang) => {
    const words = profile.words.filter((word) => word.lang === lang);
    // A language nobody has played is not a row of zeroes on the screen, it is
    // a language that is not there. Three empty rows would be most of the
    // panel for somebody who has only ever played Polish.
    return words.length === 0
      ? []
      : [{ lang, words: words.length, due: words.reduce((n, w) => (w.dueAt <= now ? n + 1 : n), 0) }];
  });

  return {
    id: profile.id,
    name: profile.name,
    xp: profile.xp,
    level,
    nextLevel,
    streak: profile.streak,
    words: profile.words.length,
    due: dueCount(profile, now),
    byLang,
    games: profile.games,
    recent: [...profile.words].sort((a, b) => b.lastAt - a.lastAt).slice(0, RECENT),
  };
}
