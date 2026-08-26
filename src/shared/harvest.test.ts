import { describe, expect, it } from 'vitest';
import { applyRecord, harvestKey, type GameRecord, type Learned } from './harvest.js';
import { APPLIED_MEMORY, FORM, dayOf, findWord, newProfile, type Profile } from './profile.js';
import { BOXES, TOP_BOX, XP_PER_GAME, XP_PER_WIN, xpFor } from './review.js';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

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
    ms: 3_000,
    ...over,
  };
}

function record(learnedFor0: Learned[], result: 'won' | 'lost' | 'drew' = 'won'): GameRecord {
  return {
    gameId: 'wordchain',
    seats: [
      { seat: 0, result, learned: learnedFor0 },
      { seat: 1, result: result === 'won' ? 'lost' : 'won', learned: [] },
    ],
  };
}

const blank = (): Profile => newProfile('acct', 'Amelia', NOW - 30 * DAY);

/** Apply one record and hand back the profile it produced. */
function apply(profile: Profile, rec: GameRecord, key = 'run#1', now = NOW, seat = 0): Profile {
  return applyRecord(profile, rec, seat, key, now);
}

describe('applying a game', () => {
  it('never mutates the profile it was given', () => {
    const before = blank();
    const snapshot = JSON.parse(JSON.stringify(before));
    apply(before, record([learned()]));
    expect(before).toEqual(snapshot);
  });

  it('files a new word under its folded lemma, not the form played', () => {
    const after = apply(blank(), record([learned()]));
    expect(after.words).toHaveLength(1);
    const row = after.words[0];
    expect(row.key).toBe('byc');
    // The row is a verb; `word` is "last seen as", which is what a learner
    // reading their own ledger wants to know.
    expect(row.word).toBe('jestem');
    expect(row.lemma).toBe('być');
    expect(row.got).toBe(1);
    expect(row.box).toBe(1);
    expect(row.dueAt).toBe(NOW + BOXES[1] * DAY);
  });

  it('counts six inflections of one verb as one verb', () => {
    const forms = ['jestem', 'jesteś', 'jest', 'jesteśmy', 'byłem', 'będzie'];
    const after = apply(blank(), record(forms.map((word) => learned({ word }))));
    expect(after.words).toHaveLength(1);
    expect(after.words[0].seen).toBe(6);
    expect(after.words[0].word).toBe('będzie');
  });

  it('takes the last event of a game as the one whose schedule stands', () => {
    // A chain can come back to the same lemma, and the ledger should end up
    // reflecting how it went the last time, not the first.
    const after = apply(
      blank(),
      record([learned({ grade: 'produced' }), learned({ grade: 'wrong', ms: 0 })]),
    );
    expect(after.words[0].box).toBe(0);
    expect(after.words[0].got).toBe(1);
    expect(after.words[0].missed).toBe(1);
  });

  it('records the fastest production and keeps it', () => {
    let profile = apply(blank(), record([learned({ ms: 9_000 })]));
    profile = apply(profile, record([learned({ ms: 2_500 })]), 'run#2');
    profile = apply(profile, record([learned({ ms: 7_000 })]), 'run#3');
    expect(profile.words[0].fastestMs).toBe(2_500);
  });

  it('does not take a miss as a personal best, however quick it was', () => {
    const after = apply(blank(), record([learned({ grade: 'wrong', ms: 200 })]));
    expect(after.words[0].fastestMs).toBe(0);
  });
});

describe('a word only watched go past', () => {
  /**
   * Counting every word an opponent said as a word you have met would inflate
   * every number on the profile, and the profile's only job is to be worth
   * trusting.
   */
  it('never creates a row', () => {
    const after = apply(blank(), record([learned({ grade: 'seen' })]));
    expect(after.words).toEqual([]);
  });

  it('bumps a row that already exists, and nothing else about it', () => {
    const first = apply(blank(), record([learned()]));
    const row = first.words[0];
    const after = apply(first, record([learned({ grade: 'seen' })]), 'run#2', NOW + 1000);

    expect(after.words[0].seen).toBe(row.seen + 1);
    expect(after.words[0].got).toBe(row.got);
    // The schedule is untouched. An evening of reading an opponent's words
    // must not postpone every review the player had actually earned.
    expect(after.words[0].dueAt).toBe(row.dueAt);
    expect(after.words[0].box).toBe(row.box);
    expect(after.words[0].lastAt).toBe(row.lastAt);
  });

  it('earns nothing and does not hold up a streak on its own', () => {
    const after = apply(blank(), record([learned({ grade: 'seen' })]));
    expect(after.xp).toBe(XP_PER_GAME + XP_PER_WIN);
    expect(after.streak.days).toBe(0);
  });
});

describe('merging what arrives unevenly', () => {
  /**
   * `ChainLink.lemma` is empty when the word played *is* its own lemma, and
   * Japanese carries a script where Polish does not. A blind overwrite would
   * let a later, plainer sighting erase the dictionary form the row was named
   * after.
   */
  it('keeps the first lemma, script and gloss rather than blanking them', () => {
    let profile = apply(blank(), record([learned({ lang: 'ja', key: 'neko', word: 'neko', script: '猫', lemma: '', gloss: 'cat' })]));
    profile = apply(
      profile,
      record([learned({ lang: 'ja', key: 'neko', word: 'neko', script: '', lemma: '', gloss: '' })]),
      'run#2',
    );
    expect(profile.words[0].script).toBe('猫');
    expect(profile.words[0].gloss).toBe('cat');
  });

  it('keeps the commonest rank any form of the word arrived with', () => {
    let profile = apply(blank(), record([learned({ rank: 900 })]));
    profile = apply(profile, record([learned({ rank: 4 })]), 'run#2');
    profile = apply(profile, record([learned({ rank: 600 })]), 'run#3');
    // The row is a lemma; of the ranks its inflections carry, the commonest is
    // the closest thing to the lemma's own frequency.
    expect(profile.words[0].rank).toBe(4);
  });

  it('takes a rank at all when the first sighting had none', () => {
    let profile = apply(blank(), record([learned({ rank: 0 })]));
    profile = apply(profile, record([learned({ rank: 42 })]), 'run#2');
    expect(profile.words[0].rank).toBe(42);
  });

  it('files the same key in two languages as two rows', () => {
    let profile = apply(blank(), record([learned({ lang: 'pl', key: 'ma', gloss: 'has' })]));
    profile = apply(profile, record([learned({ lang: 'ja', key: 'ma', gloss: 'interval' })]), 'run#2');
    expect(profile.words).toHaveLength(2);
    expect(findWord(profile, 'pl', 'ma')?.gloss).toBe('has');
  });

  it('ignores an event with no key rather than filing a nameless row', () => {
    const after = apply(blank(), record([learned({ key: '' })]));
    expect(after.words).toEqual([]);
  });
});

describe('being applied exactly once', () => {
  /**
   * The room hands its results to the player objects and only then writes down
   * that it has, so a crash between the two re-sends the same harvest. Without
   * this the commonest failure in the whole system is somebody's XP quietly
   * doubling.
   */
  it('drops a repeat of a key it has already seen', () => {
    const once = apply(blank(), record([learned()]), 'run#1');
    const twice = apply(once, record([learned()]), 'run#1');
    expect(twice).toBe(once);
  });

  it('does not drop a rematch, which is a new game at the same table', () => {
    const key1 = harvestKey('a1b2c3', 1);
    const key2 = harvestKey('a1b2c3', 2);
    expect(key1).not.toBe(key2);

    let profile = apply(blank(), record([learned()]), key1);
    profile = apply(profile, record([learned()]), key2);
    expect(profile.games[0].played).toBe(2);
  });

  /**
   * The reason the key carries a run id rather than the room code. Codes are
   * four letters and get reused: two different rooms that both happened to be
   * `ABCD` would both start counting at one, and the second game's results
   * would be silently dropped as a duplicate of the first's.
   */
  it('keeps two different rooms apart even when they share a code', () => {
    let profile = apply(blank(), record([learned()]), harvestKey('march7', 1));
    profile = apply(profile, record([learned()]), harvestKey('june22', 1));
    expect(profile.games[0].played).toBe(2);
  });

  it('forgets old keys rather than growing forever', () => {
    let profile = blank();
    for (let n = 1; n <= APPLIED_MEMORY + 20; n++) {
      profile = apply(profile, record([]), harvestKey('run', n));
    }
    expect(profile.applied).toHaveLength(APPLIED_MEMORY);
    expect(profile.applied.at(-1)).toBe(harvestKey('run', APPLIED_MEMORY + 20));
  });
});

describe('what a seat gets out of it', () => {
  it('gives a seat with no outcome in the record nothing at all', () => {
    // The ordinary case for a guest with no account, and for a room where only
    // one player is signed in.
    const after = applyRecord(blank(), record([learned()]), 7, 'run#1', NOW);
    expect(after.words).toEqual([]);
    expect(after.xp).toBe(0);
    expect(after.applied).toEqual([]);
  });

  it('tallies the game, win or lose', () => {
    let profile = apply(blank(), record([], 'won'), 'run#1');
    profile = apply(profile, record([], 'lost'), 'run#2');
    profile = apply(profile, record([], 'drew'), 'run#3');
    expect(profile.games).toHaveLength(1);
    expect(profile.games[0]).toMatchObject({ gameId: 'wordchain', played: 3, won: 1, lost: 1, drew: 1 });
  });

  /** The history the totals cannot hold. Oldest first, so it reads as a run. */
  it('keeps the last few results in the order they happened', () => {
    let profile = apply(blank(), record([], 'lost'), 'run#1');
    profile = apply(profile, record([], 'drew'), 'run#2');
    profile = apply(profile, record([], 'won'), 'run#3');
    expect(profile.games[0].last).toEqual(['lost', 'drew', 'won']);
  });

  it('caps the form guide and drops the oldest result off it', () => {
    let profile = blank();
    for (let n = 0; n <= FORM; n++) {
      profile = apply(profile, record([], n === 0 ? 'lost' : 'won'), `run#${n}`);
    }
    expect(profile.games[0].played).toBe(FORM + 1);
    expect(profile.games[0].last).toEqual(Array(FORM).fill('won'));
  });

  /**
   * Eleven of the thirteen games cannot say who won, so the room reports them
   * as played and declines to guess. That must reach the tally as nothing at
   * all: a loss it never saw, and a blank in the form guide, are both claims.
   */
  it('counts an undecided game as played and nothing else', () => {
    const undecided = { gameId: 'connect4', seats: [{ seat: 0, result: null, learned: [] }] };
    const after = apply(blank(), undecided, 'run#1');
    expect(after.games[0]).toMatchObject({ played: 1, won: 0, lost: 0, drew: 0, last: [] });
  });

  it('keeps a separate tally per game', () => {
    let profile = apply(blank(), record([]), 'run#1');
    profile = apply(profile, { ...record([]), gameId: 'vocab' }, 'run#2');
    expect(profile.games.map((game) => game.gameId)).toEqual(['wordchain', 'vocab']);
  });

  it('pays for the words and, a little, for the game', () => {
    const after = apply(blank(), record([learned({ grade: 'produced' })]));
    // Paid on the rung reached, which is 1 for a word met and produced.
    expect(after.xp).toBe(xpFor('produced', 1) + XP_PER_GAME + XP_PER_WIN);
  });

  it('makes a deep review outpay a whole game', () => {
    const deep: Profile = { ...blank(), words: [], xp: 0 };
    let profile = deep;
    // Walk one word up to the top rung, then review it there.
    for (let n = 1; n <= TOP_BOX; n++) {
      profile = apply(profile, record([learned()]), `run#${n}`, NOW + n * 100 * DAY);
    }
    expect(profile.words[0].box).toBe(TOP_BOX);
    expect(xpFor('produced', TOP_BOX)).toBeGreaterThan(XP_PER_GAME + XP_PER_WIN);
  });
});

describe('the streak', () => {
  it('counts a day where a word was actually graded', () => {
    const after = apply(blank(), record([learned()]));
    expect(after.streak).toEqual({ days: 1, lastDay: dayOf(NOW), rests: 0 });
  });

  /**
   * A streak is a claim about learning something. Finishing a game of Connect
   * Four is not a day of study, and letting it hold the streak up would make
   * the number mean nothing at all.
   */
  it('is not held up by a game with no words in it', () => {
    const after = apply(blank(), { gameId: 'connect4', seats: [{ seat: 0, result: 'won', learned: [] }] });
    expect(after.streak.days).toBe(0);
    expect(after.games[0].played).toBe(1);
  });

  it('counts a day where every word was missed', () => {
    // Sitting down and getting them all wrong is still studying, and is very
    // often the most useful session somebody has.
    const after = apply(blank(), record([learned({ grade: 'wrong' })]));
    expect(after.streak.days).toBe(1);
  });
});
