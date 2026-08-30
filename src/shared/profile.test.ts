import { describe, expect, it } from 'vitest';
import {
  APPLIED_MEMORY,
  FORM,
  LEARN_LANGS,
  PROFILE_VERSION,
  bumpStreak,
  dayOf,
  dueCount,
  dueWords,
  findWord,
  migrate,
  spendable,
  newProfile,
  profileView,
  totalXp,
  restsFor,
  decided,
  tallyFor,
  wordCount,
  type GameTally,
  type Known,
  type Profile,
  type Streak,
} from './profile.js';
import { LANGS } from './games/wordChainDisplay.js';
import { rankOf } from './review.js';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

function word(over: Partial<Known> = {}): Known {
  return {
    lang: 'pl',
    key: 'byc',
    word: 'być',
    script: '',
    lemma: '',
    gloss: 'to be',
    rank: 4,
    seen: 1,
    got: 1,
    missed: 0,
    run: 1,
    learnedAt: 0,
    lastAt: NOW,
    dueAt: NOW + DAY,
    box: 1,
    fastestMs: 2_000,
    ...over,
  };
}

describe('migration', () => {
  /**
   * The one property that separates this from `RoomEngine.restore`, and the
   * reason it is the first test in the file. A room that cannot be read is
   * deleted, correctly. A profile that cannot be read is still somebody's
   * vocabulary, so there is no input at all for which the right answer is
   * "throw it away".
   */
  it('never refuses to load, whatever it is handed', () => {
    for (const junk of [null, undefined, 0, '', 'a string', [], { version: 999 }]) {
      const profile = migrate(junk, NOW);
      expect(profile.version).toBe(PROFILE_VERSION);
      expect(profile.words).toEqual([]);
      expect(profile.applied).toEqual([]);
    }
  });

  it('keeps everything a stored profile actually had', () => {
    const stored = newProfile('acct', 'Amelia', NOW - DAY);
    stored.xp = { en: 0, pl: 412, ja: 0 };
    stored.words = [word()];
    stored.applied = ['run#1'];
    stored.streak = { days: 9, lastDay: dayOf(NOW), rests: 1 };

    const back = migrate(JSON.parse(JSON.stringify(stored)), NOW);
    expect(back).toEqual({ ...stored, version: PROFILE_VERSION });
  });

  /**
   * A profile whose arrays are missing is the shape a hand-edited export or a
   * half-written storage record has, and every reader here does a `.reduce`
   * or a `.find` over them. Repairing rather than crashing is the whole point:
   * this runs on the read path of the one object that must never fail to load.
   */
  it('repairs missing collections rather than crashing on the first read', () => {
    const profile = migrate({ version: 1, id: 'x', name: 'y', xp: 'nonsense' }, NOW);
    expect(profile.xp).toEqual({ en: 0, pl: 0, ja: 0 });
    expect(dueCount(profile, NOW)).toBe(0);
    expect(tallyFor(profile, 'wordchain').played).toBe(0);
    expect(profile.streak).toEqual({ days: 0, lastDay: 0, rests: 0 });
  });

  /**
   * `LearnLang` is spelled out in `profile.ts` rather than imported from the
   * game, so that dropping a language from Word Chain cannot change what a
   * stored profile is allowed to contain. Spelling it twice is only safe while
   * something holds the two copies together.
   */
  it('holds its language list against the game it came from', () => {
    expect([...LEARN_LANGS].sort()).toEqual([...LANGS].sort());
  });
});

describe('the games panel', () => {
  const tally = (over: Partial<GameTally> = {}): GameTally => ({
    gameId: 'wordchain',
    played: 4,
    won: 2,
    lost: 1,
    drew: 1,
    last: ['won', 'lost', 'drew', 'won'],
    lastAt: NOW,
    ...over,
  });

  /**
   * The rate the panel shows is over decided games, not over played ones. A
   * game that never names a winner still counts as played, so `played` as a
   * denominator would make somebody's Connect Four record fall as they won.
   */
  it('counts decided games rather than played ones', () => {
    expect(decided(tally())).toBe(4);
    expect(decided(tally({ played: 100, won: 0, lost: 0, drew: 0, last: [] }))).toBe(0);
  });

  /**
   * A version 1 tally has neither field, and neither is recoverable. Filling
   * `lost` from `played - won - drew` was the tempting version and it is a lie
   * about every game that does not name a winner.
   */
  it('carries an old tally forward without inventing losses', () => {
    const old = { version: 1, id: 'a', name: 'b', games: [{ gameId: 'connect4', played: 30, won: 0, drew: 0, lastAt: NOW }] };
    expect(migrate(old, NOW).games[0]).toEqual({
      gameId: 'connect4',
      played: 30,
      won: 0,
      lost: 0,
      drew: 0,
      last: [],
      lastAt: NOW,
    });
  });

  it('drops junk out of a stored form guide and keeps it capped', () => {
    const stored = {
      version: PROFILE_VERSION,
      games: [{ gameId: 'wordchain', played: 3, won: 1, lost: 1, drew: 1, last: ['won', 'nonsense', null, 'lost'], lastAt: NOW }],
    };
    expect(migrate(stored, NOW).games[0].last).toEqual(['won', 'lost']);

    const long = { version: PROFILE_VERSION, games: [tally({ last: Array(40).fill('won') })] };
    expect(migrate(long, NOW).games[0].last).toHaveLength(FORM);
  });
});

describe('the streak', () => {
  const on = (day: number, streak: Streak): Streak => bumpStreak(streak, day * DAY);
  const fresh: Streak = { days: 0, lastDay: 0, rests: 0 };

  it('counts a second review on the same day as the same day', () => {
    const once = on(100, fresh);
    expect(on(100, once)).toEqual(once);
    expect(once.days).toBe(1);
  });

  it('grows by one on consecutive days', () => {
    let streak = on(100, fresh);
    for (let day = 101; day <= 105; day++) streak = on(day, streak);
    expect(streak.days).toBe(6);
    expect(streak.rests).toBe(0);
  });

  /**
   * The forgiving case, and the reason it is here from the start rather than
   * added after somebody loses a hundred days to a bad week. Nothing is bought
   * and nothing is announced: the day is simply absorbed.
   */
  it('absorbs a single missed day and carries on', () => {
    let streak = on(100, fresh);
    streak = on(101, streak);
    streak = on(103, streak); // 102 missed
    expect(streak.days).toBe(3);
    expect(streak.rests).toBe(1);
  });

  it('gives one rest per week, so a second gap in the same week ends it', () => {
    let streak = on(100, fresh);
    streak = on(102, streak); // first rest spent, days = 2
    expect(streak.rests).toBe(1);
    expect(restsFor(streak.days)).toBe(1);
    streak = on(104, streak); // no rest left at this length
    expect(streak).toEqual({ days: 1, lastDay: 104, rests: 0 });
  });

  it('earns another rest as the streak passes a week', () => {
    let streak: Streak = { days: 8, lastDay: 100, rests: 1 };
    streak = on(102, streak);
    expect(streak).toEqual({ days: 9, lastDay: 102, rests: 2 });
  });

  it('resets after two clear days, however long it was', () => {
    expect(on(200, { days: 300, lastDay: 100, rests: 0 })).toEqual({
      days: 1,
      lastDay: 200,
      rests: 0,
    });
  });

  it('is available from the first day, when a streak is worth least and cared for least', () => {
    expect(restsFor(1)).toBe(1);
    expect(restsFor(7)).toBe(1);
    expect(restsFor(8)).toBe(2);
  });
});

describe('reading a profile', () => {
  const profile: Profile = {
    ...newProfile('acct', 'Amelia', NOW),
    words: [
      word({ key: 'byc', dueAt: NOW - 1 }),
      word({ key: 'miec', dueAt: NOW + DAY }),
      word({ key: 'neko', lang: 'ja', dueAt: NOW }),
    ],
  };

  it('counts what is due now, which is the number the lobby shows', () => {
    // Due *at* now counts: a word whose deadline is this millisecond has come
    // back, and rounding it the other way would leave it permanently one tick
    // away on a clock that only moves forwards.
    expect(dueCount(profile, NOW)).toBe(2);
    // A day earlier nothing had come back yet, and a day later everything has.
    expect(dueCount(profile, NOW - DAY)).toBe(0);
    expect(dueCount(profile, NOW + DAY)).toBe(3);
  });

  /**
   * The keys a game is handed so it can put a word somebody half-knows in
   * front of them. See `StudyLists`, and `revealFor` in `wordChain.ts`.
   */
  it('hands out the due keys by language, and leaves the empty ones out', () => {
    expect(dueWords(profile, NOW)).toEqual({ pl: ['byc'], ja: ['neko'] });
    // A language with nothing due is absent rather than present and empty, so
    // a game reading one cannot tell "nothing due" from "no such language".
    expect(dueWords(profile, NOW - DAY)).toEqual({});
    expect(dueWords(profile, NOW + DAY).pl).toEqual(['byc', 'miec']);
  });

  it('cuts the cap off the bottom, keeping what is most overdue', () => {
    const many: Profile = {
      ...profile,
      words: [
        word({ key: 'third', dueAt: NOW - 1 }),
        word({ key: 'first', dueAt: NOW - 3 }),
        word({ key: 'second', dueAt: NOW - 2 }),
      ],
    };
    expect(dueWords(many, NOW, 2)).toEqual({ pl: ['first', 'second'] });
  });

  it('counts words by language, and all of them together', () => {
    expect(wordCount(profile)).toBe(3);
    expect(wordCount(profile, 'pl')).toBe(2);
    expect(wordCount(profile, 'ja')).toBe(1);
    expect(wordCount(profile, 'en')).toBe(0);
  });

  /** Rows are identified by language *and* key: `neko` is not a Polish word. */
  it('does not confuse two languages that spell a key the same', () => {
    const shared: Profile = {
      ...profile,
      words: [word({ key: 'ma', lang: 'pl', gloss: 'has' }), word({ key: 'ma', lang: 'ja', gloss: 'interval' })],
    };
    expect(findWord(shared, 'pl', 'ma')?.gloss).toBe('has');
    expect(findWord(shared, 'ja', 'ma')?.gloss).toBe('interval');
  });

  it('reports a game never played as zero rather than as nothing', () => {
    expect(tallyFor(profile, 'yahtzee')).toEqual({
      gameId: 'yahtzee',
      played: 0,
      won: 0,
      lost: 0,
      drew: 0,
      last: [],
      lastAt: 0,
    });
  });
});

describe('bookkeeping', () => {
  it('remembers enough harvest keys to catch a retry', () => {
    // The number only has to exceed the number of games finishable between a
    // failed write and its retry, which is one. Anything above a handful is
    // margin, and the cap is what stops the profile growing forever.
    expect(APPLIED_MEMORY).toBeGreaterThan(10);
  });

  it('puts a day boundary at UTC midnight', () => {
    expect(dayOf(0)).toBe(0);
    expect(dayOf(DAY - 1)).toBe(0);
    expect(dayOf(DAY)).toBe(1);
  });
});

/*
  The lobby chip wears one level for the whole account, and the thing worth
  pinning is that it is not any of the per-language ones: levels are quadratic,
  so pooling is a different answer from taking the best row or adding the rows
  up, and a future refactor that "simplifies" this into `byLang` would be a
  silent demotion for everybody studying two languages.
*/
describe('the account level', () => {
  it('is the pooled total, not one language and not the sum of levels', () => {
    const profile = newProfile('acct', 'Amelia', NOW);
    // 100 apiece: each language alone is level 2, the pool of 200 is level 3.
    profile.xp = { en: 100, pl: 100, ja: 0 };
    const view = profileView(profile, NOW, rankOf);

    expect(totalXp(profile)).toBe(200);
    expect(view.xp).toBe(200);
    expect(view.rank.level).toBe(3);
    expect(view.byLang.every((row) => row.level === 2)).toBe(true);
  });

  it('counts English, unlike the chest balance beside it', () => {
    const profile = newProfile('acct', 'Amelia', NOW);
    profile.xp = { en: 300, pl: 0, ja: 0 };
    const view = profileView(profile, NOW, rankOf);

    // The one place the two rules are visible together, and the pair is the
    // point: English levels you and does not buy you anything.
    expect(view.rank.level).toBeGreaterThan(1);
    expect(view.spendable).toBe(0);
  });

  it('leaves the bar somewhere to go at every level', () => {
    const profile = newProfile('acct', 'Amelia', NOW);
    for (const xp of [0, 1, 59, 60, 179, 180, 5000]) {
      profile.xp = { en: xp, pl: 0, ja: 0 };
      const { rank, xp: total } = profileView(profile, NOW, rankOf);
      expect(rank.levelAt).toBeLessThanOrEqual(total);
      expect(rank.nextLevel).toBeGreaterThan(total);
    }
  });
});

/**
 * Migrating an account from before chests, now that there is one currency.
 *
 * This used to be the version 4 rung's tests, and the rung is gone. What
 * replaces them is the same question asked the other way round: an old profile
 * must come forward with its experience intact and **no second pot beside it**.
 *
 * The version 4 rung granted `floor(spendableEarned / cost)` chests without
 * charging the balance it read, and the test that pinned it said out loud that
 * it was deliberate generosity and that this was where a change of mind would
 * have to show up. This is that change of mind. It is written as a property of
 * the migrated profile rather than as the absence of a field, so it keeps
 * meaning something if a future rung ever wants to pay somebody in experience.
 */
describe('migrating an account from before chests', () => {
  /** A version 2 profile with experience in two languages, one of them English. */
  const old = () => ({
    version: 2,
    id: 'acc',
    name: 'Amelia',
    createdAt: 1_000,
    xp: { en: 500, pl: 1_000, ja: 0 },
    words: [],
  });

  it('brings the balance forward whole and spends none of it', () => {
    const migrated = migrate(old(), NOW);
    // The 500 English is ignored for the same reason `spendable` ignores it:
    // English earns, it does not buy.
    expect(spendable(migrated)).toBe(1_000);
    expect(migrated.spent).toBe(0);
    expect(migrated.version).toBe(PROFILE_VERSION);
  });

  it('is worth exactly what the rule says, and not twice that', () => {
    // The bug the sixth version exists to remove. Under version 4 this account
    // was worth twenty openings: ten banked as `credits` and ten more still
    // sitting in the balance those credits were computed from. Anybody earning
    // the same thousand a week later got ten. One number now, and it is ten.
    const migrated = migrate(old(), NOW);
    expect(Math.floor(spendable(migrated) / 100)).toBe(10);
  });

  it('does not grow on the way through storage and back', () => {
    // The round trip a real profile makes. A rung that reads a running total
    // rather than something it consumes is the kind that pays twice when it
    // runs twice, so the property is worth keeping asserted even now that the
    // rung it was aimed at has gone.
    const once = migrate(old(), NOW);
    const twice = migrate(JSON.parse(JSON.stringify(once)), NOW);
    expect(spendable(twice)).toBe(spendable(once));
    expect(twice.spent).toBe(once.spent);
  });

  it('carries nothing across that used to be a second currency', () => {
    // A stored profile from version 4 still has `credits` on it. It must come
    // through as a balance and nothing else: no field, and no experience
    // conjured out of one either.
    const banked = { ...old(), version: 4, credits: 7, spent: 0 };
    const migrated = migrate(banked, NOW);
    expect((migrated as unknown as Record<string, unknown>).credits).toBeUndefined();
    // The half that would still matter if the key were ever left on: seven
    // banked chests must not become seven openings by any route.
    expect(spendable(migrated)).toBe(1_000);
    expect(Math.floor(spendable(migrated) / 100)).toBe(10);
  });
});
