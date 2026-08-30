/**
 * The claim the Vocabulary screen makes, pinned.
 *
 * Everything here is about one sentence -- "you have learned this word" -- and
 * the ways it could quietly become untrue. The run, the latch, what breaks a
 * run and what does not, and the migration that refuses to guess one.
 *
 * `harvest.test.ts` covers the ledger's arithmetic; this covers the promise.
 */
import { describe, expect, it } from 'vitest';
import { applyRecord, type GameRecord, type Learned } from './harvest.js';
import {
  LEARNED_RUN,
  isLearned,
  learnedCount,
  migrate,
  newProfile,
  splitXp,
  zeroXp,
  type Known,
  type Profile,
} from './profile.js';
import type { Grade } from './review.js';
import { isCorrect } from './review.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function learned(over: Partial<Learned> = {}): Learned {
  return {
    lang: 'pl',
    key: 'byc',
    word: 'jestem',
    script: '',
    lemma: 'być',
    gloss: 'to be',
    rank: 4,
    grade: 'produced',
    ms: 0,
    ...over,
  };
}

function record(words: Learned[]): GameRecord {
  return { gameId: 'vocab', seats: [{ seat: 0, result: 'won', learned: words }] };
}

/**
 * Answer the same word `n` times, one game each, a day apart.
 *
 * The keys carry `from` because `applyRecord` is idempotent on them: calling
 * this twice on the same profile with keys that repeat files the second batch
 * as a retry of the first and changes nothing, which is correct behaviour and
 * a silently passing test.
 */
function answer(profile: Profile, n: number, grade: Grade = 'produced', from = 0): Profile {
  let out = profile;
  for (let i = 0; i < n; i++) {
    out = applyRecord(out, record([learned({ grade })]), 0, `run#${from + i}`, NOW + (from + i) * DAY);
  }
  return out;
}

const blank = (): Profile => newProfile('acct', 'Amelia', NOW);

describe('the run', () => {
  it('needs ten correct answers in a row before it will say a word is learned', () => {
    // Nine is not enough, and the off-by-one is the whole test: a screen that
    // graduates a word one answer early is making a claim nobody agreed to.
    const nearly = answer(blank(), LEARNED_RUN - 1);
    expect(nearly.words[0].run).toBe(LEARNED_RUN - 1);
    expect(isLearned(nearly.words[0])).toBe(false);
    expect(learnedCount(nearly)).toBe(0);

    const there = answer(nearly, 1, 'produced', LEARNED_RUN);
    expect(isLearned(there.words[0])).toBe(true);
    expect(learnedCount(there, 'pl')).toBe(1);
  });

  it('is broken by a miss, all the way back to nothing', () => {
    const nine = answer(blank(), LEARNED_RUN - 1);
    const missed = applyRecord(nine, record([learned({ grade: 'wrong' })]), 0, 'run#miss', NOW);
    expect(missed.words[0].run).toBe(0);
    expect(isLearned(missed.words[0])).toBe(false);
  });

  it('counts a hinted answer and a recognised one, and says so in one place', () => {
    // The two edges of `isCorrect`, checked against the thing that draws them
    // rather than restated here. A hint is a first letter and the player still
    // did the retrieval; a recognition is one pick in four and does not survive
    // ten of them in a row by luck.
    expect(isCorrect('hinted')).toBe(true);
    expect(isCorrect('recognised')).toBe(true);
    expect(isCorrect('gave-up')).toBe(false);
    expect(isCorrect('seen')).toBe(false);

    expect(answer(blank(), LEARNED_RUN, 'recognised').words[0].run).toBe(LEARNED_RUN);
    expect(isLearned(answer(blank(), LEARNED_RUN, 'hinted').words[0])).toBe(true);
  });

  it('is left exactly where it was by a word only watched go past', () => {
    // A sighting is neither an answer nor a failure, and it must not be able
    // to break a run somebody spent two months on by an opponent happening to
    // play their word.
    const five = answer(blank(), 5);
    const watched = applyRecord(five, record([learned({ grade: 'seen' })]), 0, 'run#seen', NOW);
    expect(watched.words[0].run).toBe(5);
  });

  it('latches, so one bad answer does not delete a word from the list', () => {
    const there = answer(blank(), LEARNED_RUN);
    const slipped = applyRecord(there, record([learned({ grade: 'wrong' })]), 0, 'run#slip', NOW);

    // The ladder punishes the miss -- that is its job, and it does it.
    expect(slipped.words[0].box).toBe(0);
    expect(slipped.words[0].run).toBe(0);
    // The list does not. See `Known.learnedAt`.
    expect(isLearned(slipped.words[0])).toBe(true);
    expect(learnedCount(slipped)).toBe(1);
  });
});

describe('experience, per language', () => {
  it('pays into the language the game taught and nowhere else', () => {
    const after = applyRecord(blank(), record([learned({ lang: 'ja' })]), 0, 'run#1', NOW);
    expect(after.xp.ja).toBeGreaterThan(0);
    expect(after.xp.pl).toBe(0);
    expect(after.xp.en).toBe(0);
  });

  it('pays nothing at all for a game with no words in it', () => {
    // The consequence of the split, stated as a test so nobody has to rediscover
    // it from a support message. A game that taught no language cannot pay a
    // language, and the games panel is where it shows up instead.
    const after = applyRecord(
      blank(),
      { gameId: 'connect4', seats: [{ seat: 0, result: 'won', learned: [] }] },
      0,
      'run#1',
      NOW,
    );
    expect(after.xp).toEqual(zeroXp());
    expect(after.games[0].played).toBe(1);
  });
});

describe('migrating a profile that predates any of this', () => {
  it('refuses to invent a run out of lifetime totals', () => {
    // The dishonest migration, spelled out: this row got ten right and ten
    // wrong, in no recorded order, and filling `run` from `got` would hand it
    // a badge it never earned.
    const stored = {
      version: 2,
      id: 'acct',
      name: 'Amelia',
      createdAt: NOW,
      xp: 0,
      words: [{ lang: 'pl', key: 'byc', word: 'być', gloss: 'to be', seen: 20, got: 10, missed: 10 }],
    };
    const back = migrate(stored, NOW);
    expect(back.words[0].run).toBe(0);
    expect(back.words[0].learnedAt).toBe(0);
    expect(isLearned(back.words[0])).toBe(false);
  });

  it('splits a pooled total by word count, and loses none of it', () => {
    const words = [
      { lang: 'pl', key: 'a' },
      { lang: 'pl', key: 'b' },
      { lang: 'pl', key: 'c' },
      { lang: 'ja', key: 'd' },
    ] as Known[];
    const split = splitXp(101, words);
    expect(split.pl + split.ja + split.en).toBe(101);
    expect(split.pl).toBeGreaterThan(split.ja);
    // The remainder goes to the biggest rather than being dropped: this is
    // somebody's total and it has to come out the other side intact.
    expect(split.en).toBe(0);
  });

  it('keeps a pooled total under one language when there are no words to split by', () => {
    expect(splitXp(240, [])).toEqual({ en: 240, pl: 0, ja: 0 });
  });
});
