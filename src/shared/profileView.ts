/**
 * What a client is told about its own profile.
 *
 * **Not the profile.** Its own file because that distinction is the whole
 * point of it: five thousand words is around 600KB and it would go out on
 * every hello, on a phone, over whatever connection the player has. Anything
 * added here is paid for on every connect, which is a question worth being
 * asked by a file boundary.
 */
import { LEARN_LANGS, isLearned } from './profileShapes.js';
import type { GameTally, LearnLang, Known, Profile, Streak } from './profileShapes.js';
import {
  dayOf,
  dueCount,
  learnedCount,
  spendable,
  totalXp,
} from './profileQueries.js';

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
/**
 * One language, as the profile screen draws it.
 *
 * The level lives here rather than on the summary because that is what going
 * per-language means: there is no account level any more, and there is
 * deliberately no field for one. Somebody who wants a single number can add up
 * `xp`, and `totalXp` is the function for it, but it must not be given a
 * level — a level over three languages is the number the split was made to
 * stop showing.
 */
export interface LangView {
  lang: LearnLang;
  /** Words met. The weak claim. */
  words: number;
  /** Words the ledger will say are known. See `LEARNED_RUN`. */
  learned: number;
  due: number;
  xp: number;
  level: number;
  /** Total at which the next level begins, so a bar has something to fill. */
  nextLevel: number;
  /** Total at which this level began. The bar's other end. */
  levelAt: number;
}

export interface ProfileView {
  id: string;
  name: string;
  streak: Streak;
  /** Words in the ledger, how many are known, and how many have come round. */
  words: number;
  learned: number;
  due: number;
  /**
   * Per language, in the order `LEARN_LANGS` gives.
   *
   * A language with no words *and* no experience is left out entirely: three
   * rows of zeroes would be most of the panel for somebody who has only ever
   * played Polish. A language with experience but no words left in the ledger
   * stays, because deleting somebody's level is worse than an odd-looking row.
   */
  byLang: LangView[];
  games: GameTally[];
  /** The most recently touched words, newest first. See `RECENT`. */
  recent: Known[];

  /**
   * Experience left to spend on chests, and chests already paid for.
   *
   * Two small numbers rather than the wardrobe itself, and that is the whole
   * point. A finished `owned` list is around 1,100 ids and 25KB, which would
   * ride every profile push against the 2KB `RECENT` was sized to; the list
   * has its own read on `PLAYER_PATHS.wardrobe`, asked for by the two screens
   * that draw it. These two are here because the account menu wants to say
   * "3 ready" on a row without fetching anything.
   */
  spendable: number;

  /**
   * The showcase, as ids, and how many characters have been claimed in total.
   *
   * **Ids and a count, never the characters.** The roster is 44KB of names and
   * URLs and the client already has it compiled in (see `waifuRoster.ts`), so
   * sending three names over the wire would be paying twice for something the
   * receiver can look up. Exactly the argument `spendable` makes against
   * shipping `owned`, one size down.
   *
   * The count is here rather than the list for the same reason `owned` is not:
   * a collection is unbounded and this is pushed after every game. The list
   * has its own read on `PLAYER_PATHS.collection`.
   */
  showcase: string[];
  claimed: number;

  /**
   * The account's own level, over **every** language's experience pooled,
   * English included.
   *
   * Separate from the per-language ranks on `byLang` and not derivable from
   * them -- levels are quadratic, so two languages at level 3 are not level 6
   * and are not level 3 either. This is the number the lobby chip wears, and
   * the reason it counts English is that the chip is the one place the app
   * says "you have been playing": a level that stalled while somebody played
   * English all week would be reporting on a language rather than on them.
   *
   * The chest balance beside it deliberately does *not* count English. Two
   * numbers with two rules, which is honest because they answer two questions:
   * this one is what you have done, `spendable` is what you can spend.
   */
  rank: Rank;

  /**
   * Whether the once-a-day bonus has already been paid today.
   *
   * `playedDay === dayOf(now)`, and it is here so the end screen can *name*
   * the 300 rather than infer it. Inferring it was the first version: a jump
   * of 300 or more in `spendable` was read as the bonus, which a good Vocab
   * Race clears on its own, so the panel congratulated people on coming back
   * twice in an evening.
   *
   * Two summaries subtract to the truth -- false before the day's first game,
   * true after -- which is the same trick `earnedBetween` plays on every other
   * number it reports. See `profileCache.ts`.
   */
  playedToday: boolean;

  /**
   * The pooled total `rank` was worked out from. On the view because the chip
   * draws a progress bar, and the fraction cannot be rebuilt from `byLang`:
   * that list drops a language with nothing in it, so the sum is a lower bound
   * rather than the total.
   */
  xp: number;
}

/**
 * Where one experience total sits on the curve.
 *
 * Passed in rather than computed, because this module imports **nothing** and
 * the curve lives in `review.ts`. See the note at the top of the file: the one
 * convenience import here is the one that puts a dictionary on a phone.
 */
export interface Rank {
  level: number;
  levelAt: number;
  nextLevel: number;
}

/**
 * How many words ride along on the summary.
 *
 * Enough to fill the panel on the profile screen and the one on a game's end
 * screen, and few enough that the message stays small. Twenty rows is about
 * 2KB, against 600KB for the whole ledger.
 */
export const RECENT = 20;

export function profileView(profile: Profile, now: number, rank: (xp: number) => Rank): ProfileView {
  const byLang = LEARN_LANGS.flatMap<LangView>((lang) => {
    const words = profile.words.filter((word) => word.lang === lang);
    const xp = profile.xp[lang] || 0;
    if (words.length === 0 && xp === 0) return [];
    const { level, levelAt, nextLevel } = rank(xp);
    return [
      {
        lang,
        words: words.length,
        learned: words.reduce((n, w) => (isLearned(w) ? n + 1 : n), 0),
        due: words.reduce((n, w) => (w.dueAt <= now ? n + 1 : n), 0),
        xp,
        level,
        levelAt,
        nextLevel,
      },
    ];
  });

  return {
    id: profile.id,
    name: profile.name,
    streak: profile.streak,
    words: profile.words.length,
    learned: learnedCount(profile),
    due: dueCount(profile, now),
    byLang,
    games: profile.games,
    recent: [...profile.words].sort((a, b) => b.lastAt - a.lastAt).slice(0, RECENT),
    spendable: spendable(profile),
    showcase: profile.showcase,
    claimed: profile.claimed.length,
    playedToday: profile.playedDay === dayOf(now),
    rank: rank(totalXp(profile)),
    xp: totalXp(profile),
  };
}
