/**
 * Questions asked of a stored profile: experience, what is spendable, the
 * streak, what is due, and how a game has gone.
 *
 * Reads a `Profile` and never writes one. Split off `profile.ts` for size;
 * re-exported from there, which is the name everything else imports.
 */
import { FORM, LEARN_LANGS, PROFILE_VERSION, isLearned } from './profileShapes.js';
import type {
  GameTally,
  Known,
  LearnLang,
  Profile,
  Streak,
  TallyResult,
} from './profileShapes.js';

/**
 * How many harvest keys a profile remembers.
 *
 * A hundred is roughly a fortnight of heavy play, and duplicates arrive inside
 * a second. The number only has to be larger than the number of games a player
 * can finish between a failed write and its retry, which is one.
 */
export const APPLIED_MEMORY = 100;

/** A zeroed experience total for every language. */
export function zeroXp(): Record<LearnLang, number> {
  return { en: 0, pl: 0, ja: 0 };
}

/**
 * Repair a stored experience total, whatever shape it turns up in.
 *
 * Three cases, and the middle one is the migration: a version 3 object is
 * cleaned key by key, a version 1 or 2 *number* is split by `splitXp`, and
 * anything else zeroes. Missing languages fill with zero rather than failing,
 * because this is on the read path of the one object that must never fail to
 * load.
 */
export function xpShape(raw: unknown, words: Known[]): Record<LearnLang, number> {
  if (typeof raw === 'number') return splitXp(raw, words);
  const out = zeroXp();
  if (typeof raw === 'object' && raw !== null) {
    for (const lang of LEARN_LANGS) {
      out[lang] = Math.max(0, Number((raw as Record<string, unknown>)[lang]) || 0);
    }
  }
  return out;
}

/**
 * Split one pooled experience total across languages, by word count.
 *
 * The pool genuinely does not record where it came from, so any split is a
 * guess and the job is to pick the guess that is least likely to insult
 * somebody. By word count, because that is the closest surviving proxy for
 * where the studying went, and the remainder goes to the language with the
 * most words so the arithmetic still adds up to what the player had.
 *
 * A profile with no words at all keeps the whole pool under `en`. It was
 * earned playing games rather than learning anything, splitting it three ways
 * would invent two levels nobody worked for, and one is the least wrong.
 */
export function splitXp(total: number, words: Known[]): Record<LearnLang, number> {
  const out = zeroXp();
  const pool = Math.max(0, Math.floor(total));
  if (pool === 0) return out;

  const counts = zeroXp();
  for (const word of words) {
    if (LEARN_LANGS.includes(word.lang)) counts[word.lang] += 1;
  }
  const all = LEARN_LANGS.reduce((n, lang) => n + counts[lang], 0);
  if (all === 0) {
    out.en = pool;
    return out;
  }

  let given = 0;
  for (const lang of LEARN_LANGS) {
    out[lang] = Math.floor((pool * counts[lang]) / all);
    given += out[lang];
  }
  // The remainder, to whichever language has the most words. Never dropped:
  // this is somebody's total and it has to come out the other side intact.
  const biggest = LEARN_LANGS.reduce((best, lang) => (counts[lang] > counts[best] ? lang : best), LEARN_LANGS[0]);
  out[biggest] += pool - given;
  return out;
}

/**
 * Every language's experience added up. For an export, and for the one level
 * that is about the account rather than about a language.
 *
 * The comment here used to say "never for a level", and the account level
 * below is the deliberate exception rather than a drift: a per-language level
 * answers "how far into Polish am I", and the lobby chip is asking the other
 * question, which is "how far in am I". Both are drawn, in the two places that
 * ask them. See `rank` on `ProfileView`.
 */
export function totalXp(profile: Profile): number {
  return LEARN_LANGS.reduce((n, lang) => n + (profile.xp[lang] || 0), 0);
}

/** A fresh profile, for an account that has just been made. */
export function newProfile(id: string, name: string, now: number): Profile {
  return {
    version: PROFILE_VERSION,
    id,
    name,
    createdAt: now,
    xp: zeroXp(),
    streak: { days: 0, lastDay: 0, rests: 0 },
    games: [],
    words: [],
    applied: [],
    owned: [],
    points: 0,
    playedDay: 0,
    spent: 0,
    opens: [],
    claimed: [],
    showcase: [],
  };
}

/**
 * How many chest nonces a profile remembers. Same bargain as `APPLIED_MEMORY`.
 *
 * Smaller, because a chest is opened by hand one at a time and a duplicate
 * arrives inside a second. It only has to outlast the retry of the request in
 * front of it.
 */
export const CHEST_MEMORY = 20;

/**
 * Goth points in hand: everything earned, less everything spent.
 *
 * This used to be the non-English experience total, and the change is version
 * 7. The old rule made the purse a function of a measurement, so the eleven
 * games that teach nothing bought nothing -- which read as the app not having
 * noticed them at all. Learning still pays far better, because a language game
 * pays five times what an ordinary one does; it is just no longer the only
 * thing that pays.
 *
 * Clamped at zero. A profile edited by hand, or one whose `spent` outlived the
 * points it was earned against, must not report a negative balance to a screen
 * that is about to render it.
 */
export function spendable(profile: Profile): number {
  return Math.max(0, spendableEarned(profile) - profile.spent);
}

/**
 * Everything this account has ever earned that counts towards a chest, before
 * anything is taken off for what it has spent.
 *
 * Its own function because the answer is wanted at two points relative to
 * `spent`: `spendable` above takes the spend off, the screens showing progress
 * towards the next open do not. It is a field read now rather than a sum, and
 * it stays a function anyway: every caller already asks the question by name,
 * and the last time this rule moved it moved in one place because of that.
 */
export function spendableEarned(profile: Profile): number {
  return Math.max(0, profile.points);
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

/**
 * The words a player is due to review, folded keys only, by language.
 *
 * What a game is handed so it can put a word somebody already half-knows in
 * front of them instead of a word off the top of a frequency list. See
 * `revealFor` in `wordChain.ts`, which is the first thing to read one.
 *
 * Keys and nothing else, which is the whole reason this is cheap enough to
 * send at every deal: the row is eighty bytes and the key is eight, and a game
 * asking "should I show them this one" needs no more than the identity. The
 * gloss, the script and the rank all come back out of the game's own
 * dictionary, which is where they came from in the first place.
 *
 * By language because a key is only unique within one: `fold` is a lossy map
 * onto twenty-six letters, and a Polish word and an English word colliding on
 * one is ordinary rather than rare. A flat set would let a Polish learner be
 * shown a word on the strength of an English row.
 *
 * Soonest due first, then commonest, and capped: a ledger that has been left
 * alone for a month has every row in it due, and the point of the cap is that
 * the top of a list ordered this way is the part worth sending.
 */
export type StudyLists = Partial<Record<LearnLang, string[]>>;

/**
 * How many keys one language may contribute.
 *
 * Two hundred is far past what a game reads (Word Chain looks at one word per
 * lost minute, so at most two a game) and it is chosen against the other end:
 * a set this size makes a due word likely to actually *be* answerable on the
 * letter the chain happens to be asking for. A cap of twenty would mostly miss.
 */
export const STUDY_CAP = 200;

/** The due keys for every language, ready to hand to a game. See `StudyLists`. */
export function dueWords(profile: Profile, now: number, cap: number = STUDY_CAP): StudyLists {
  const out: StudyLists = {};
  for (const lang of LEARN_LANGS) {
    const keys = profile.words
      .filter((word) => word.lang === lang && word.dueAt <= now)
      // Soonest first, and the commoner word ahead of the rarer one on a tie,
      // which is the order the cap should cut from the bottom of.
      .sort((a, b) => a.dueAt - b.dueAt || a.rank - b.rank)
      .slice(0, cap)
      .map((word) => word.key);
    if (keys.length > 0) out[lang] = keys;
  }
  return out;
}

/**
 * How many words the ledger is willing to say are known, per language.
 *
 * The headline figure on the Vocabulary screen, and the one deliberately not
 * called "words". `wordCount` is words *met*, which is a much larger number
 * and a much weaker claim; showing the two side by side is the whole point of
 * the screen, so they have to be two functions with two names.
 */
export function learnedCount(profile: Profile, lang?: LearnLang): number {
  return profile.words.reduce(
    (n, word) => (isLearned(word) && (lang === undefined || word.lang === lang) ? n + 1 : n),
    0,
  );
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
      lost: 0,
      drew: 0,
      last: [],
      lastAt: 0,
    }
  );
}

/**
 * One stored tally, brought up to the current shape. See `PROFILE_VERSION`.
 *
 * A version 1 tally has no `lost` and no `last`, and neither can be recovered:
 * losses were never counted and the individual games are not kept anywhere.
 * So they start empty and the totals that *were* written down carry on, which
 * is the only honest option -- deriving `lost` from `played - won - drew`
 * would credit every undecided game of Connect Four as a loss.
 */
// Exported for `profileMigrate.ts`, which is the only other caller.
export function tallyShape(raw: Partial<GameTally> | null | undefined): GameTally {
  return {
    gameId: String(raw?.gameId ?? ''),
    played: Number(raw?.played) || 0,
    won: Number(raw?.won) || 0,
    lost: Number(raw?.lost) || 0,
    drew: Number(raw?.drew) || 0,
    last: Array.isArray(raw?.last)
      ? raw.last.filter((r): r is TallyResult => r === 'won' || r === 'lost' || r === 'drew').slice(-FORM)
      : [],
    lastAt: Number(raw?.lastAt) || 0,
  };
}

/**
 * How many of a game's plays were decided one way or the other.
 *
 * The denominator for anything expressed as a rate, and never `played`: a game
 * that does not name a winner still counts as played, so dividing by `played`
 * would give somebody who plays Connect Four a win rate that falls the more
 * they win. See `GameTally`.
 */
export function decided(tally: GameTally): number {
  return tally.won + tally.lost + tally.drew;
}
