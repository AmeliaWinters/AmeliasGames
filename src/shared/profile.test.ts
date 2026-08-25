import { describe, expect, it } from 'vitest';
import {
  APPLIED_MEMORY,
  LEARN_LANGS,
  PROFILE_VERSION,
  bumpStreak,
  dayOf,
  dueCount,
  dueWords,
  findWord,
  migrate,
  newProfile,
  restsFor,
  tallyFor,
  wordCount,
  type Known,
  type Profile,
  type Streak,
} from './profile.js';
import { LANGS } from './games/wordChainDisplay.js';

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
    stored.xp = 412;
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
    expect(profile.xp).toBe(0);
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
      drew: 0,
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
