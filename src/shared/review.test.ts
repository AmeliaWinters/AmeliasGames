import { describe, expect, it } from 'vitest';
import {
  BOXES,
  FAST_FRACTION,
  HINTED_CEILING,
  LEVEL_STEP,
  TOP_BOX,
  XP_PER_GAME,
  XP_PER_WIN,
  isMiss,
  isProduction,
  levelFor,
  schedule,
  wasFast,
  xpFor,
  xpForLevel,
  type Grade,
} from './review.js';
import { LEVEL_WINDOW_MS } from './games/vocabDisplay.js';
import { MIN_TURN_MS, TURN_MS } from './games/wordChainDisplay.js';

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

/** Where a grade puts a word that is currently on `box`. */
const boxAfter = (box: number, grade: Grade): number => schedule(box, grade, NOW)?.box ?? box;

describe('the ladder', () => {
  it('climbs one rung for a word produced', () => {
    expect(boxAfter(0, 'produced')).toBe(1);
    expect(boxAfter(3, 'produced')).toBe(4);
    expect(boxAfter(0, 'produced-fast')).toBe(1);
  });

  it('stops at the top rather than running off the end of the intervals', () => {
    expect(boxAfter(TOP_BOX, 'produced')).toBe(TOP_BOX);
    expect(schedule(TOP_BOX, 'produced', NOW)?.dueAt).toBe(NOW + BOXES[TOP_BOX] * DAY);
  });

  /**
   * The row this file exists to defend. `PICK_SCALE` in the game already
   * argues that choosing one meaning out of four is a one-in-four guess at
   * worst; letting it climb would let the easy third of Vocab Race carry a
   * word onto a ninety-day interval, and the word would not come back until
   * it had been forgotten.
   */
  it('lets recognition hold a rung but never climb one', () => {
    for (let box = 0; box <= TOP_BOX; box++) {
      expect(boxAfter(box, 'recognised')).toBe(box);
    }
    // It is still a review: the word goes back to the end of its own interval
    // rather than staying due.
    expect(schedule(2, 'recognised', NOW)?.dueAt).toBe(NOW + BOXES[2] * DAY);
  });

  /**
   * A hint is not a reveal. `HINT_ALLOWANCE` makes the claim outright: first
   * letter plus length resolves a word already on the tip of the tongue, so
   * the player did the retrieval and arrived. It climbs — it just does not
   * climb onto the long intervals.
   */
  it('lets a hinted answer climb, up to the ceiling', () => {
    expect(boxAfter(0, 'hinted')).toBe(1);
    expect(boxAfter(HINTED_CEILING - 1, 'hinted')).toBe(HINTED_CEILING);
    expect(boxAfter(HINTED_CEILING, 'hinted')).toBe(HINTED_CEILING);
  });

  it('never demotes a deep word for having been hinted', () => {
    // Buying a hint must not be a punishment, or the allowance stops being a
    // decision and becomes a trap.
    expect(boxAfter(TOP_BOX, 'hinted')).toBe(TOP_BOX);
    expect(boxAfter(HINTED_CEILING + 1, 'hinted')).toBe(HINTED_CEILING + 1);
  });

  it('sends a wrong answer back to the first rung, due tomorrow', () => {
    expect(boxAfter(TOP_BOX, 'wrong')).toBe(0);
    expect(schedule(TOP_BOX, 'wrong', NOW)?.dueAt).toBe(NOW + BOXES[0] * DAY);
  });

  /**
   * `VocabHow` keeps `wrong` and `gave-up` apart deliberately, and the ledger
   * honours it: a player who guessed had the wrong word in their head, and a
   * player who passed had none but also did not confabulate one.
   */
  it('treats giving up as one rung better than being wrong', () => {
    expect(boxAfter(TOP_BOX, 'gave-up')).toBe(1);
    expect(boxAfter(0, 'gave-up')).toBe(0);
    expect(boxAfter(1, 'gave-up')).toBe(1);
  });

  it('puts a revealed word at the bottom, back tomorrow', () => {
    // Word Chain's whole argument is that the minute you failed to find a word
    // is when you are most likely to remember it. Tomorrow is when to ask.
    expect(schedule(4, 'shown', NOW)).toEqual({ box: 0, dueAt: NOW + DAY });
  });

  /**
   * `null` rather than "stays where it is", and the distinction is
   * load-bearing: a word merely watched must not have its due date pushed out,
   * or an evening of reading an opponent's words silently postpones every
   * review the player had earned.
   */
  it('says nothing at all about a word only watched go past', () => {
    expect(schedule(3, 'seen', NOW)).toBeNull();
  });

  it('clamps a box that arrives out of range rather than indexing past the end', () => {
    expect(schedule(-4, 'produced', NOW)?.box).toBe(1);
    expect(schedule(99, 'produced', NOW)?.box).toBe(TOP_BOX);
    expect(Number.isFinite(schedule(99, 'produced', NOW)?.dueAt)).toBe(true);
  });

  it('has intervals that only ever grow', () => {
    for (let i = 1; i < BOXES.length; i++) expect(BOXES[i]).toBeGreaterThan(BOXES[i - 1]);
    expect(BOXES[0]).toBe(1);
  });
});

describe('what counts as production', () => {
  it('counts the three ways of producing a word and nothing else', () => {
    const produced: Grade[] = ['produced', 'produced-fast', 'hinted'];
    const missed: Grade[] = ['wrong', 'gave-up', 'shown'];
    for (const grade of produced) {
      expect(isProduction(grade)).toBe(true);
      expect(isMiss(grade)).toBe(false);
    }
    for (const grade of missed) {
      expect(isMiss(grade)).toBe(true);
      expect(isProduction(grade)).toBe(false);
    }
    // Recognition is neither: it is not evidence you could produce the word,
    // and it is plainly not a failure to.
    expect(isProduction('recognised')).toBe(false);
    expect(isMiss('recognised')).toBe(false);
    expect(isProduction('seen')).toBe(false);
    expect(isMiss('seen')).toBe(false);
  });
});

describe('speed, measured against your own window', () => {
  /**
   * The reason `wasFast` takes an allowance instead of a number of seconds.
   * The two games hand out wildly different ones, and a fixed threshold would
   * report which game you were playing and how you had declared yourself
   * rather than whether the word was there.
   */
  it('reads the same for an expert and a beginner answering early', () => {
    expect(wasFast(4_000, LEVEL_WINDOW_MS.fluent)).toBe(true); // 4s of 15
    expect(wasFast(9_000, LEVEL_WINDOW_MS.new)).toBe(true); // 9s of 30
    expect(wasFast(9_000, LEVEL_WINDOW_MS.fluent)).toBe(false);
  });

  it('reads the same at both ends of a shrinking chain clock', () => {
    expect(wasFast(20_000, TURN_MS)).toBe(true);
    expect(wasFast(20_000, MIN_TURN_MS)).toBe(false);
    expect(wasFast(1_500, MIN_TURN_MS)).toBe(true);
  });

  it('is exactly the fraction it says it is, inclusive', () => {
    expect(wasFast(FAST_FRACTION * 10_000, 10_000)).toBe(true);
    expect(wasFast(FAST_FRACTION * 10_000 + 1, 10_000)).toBe(false);
  });

  it('refuses to call a missing measurement fast', () => {
    // A reveal has `ms: 0` because nobody played it, and an allowance of zero
    // means the caller has nothing to measure against. Neither is a fast
    // answer, and both would be one under a naive `ms <= allowance * f`.
    expect(wasFast(0, 10_000)).toBe(false);
    expect(wasFast(500, 0)).toBe(false);
  });
});

describe('experience', () => {
  /**
   * The shape of the curve is the argument. Deeper reviews pay more, so the
   * efficient way to earn is to keep coming back to words over weeks — not to
   * meet as many new words as possible and never see them again, which is the
   * classic way a language app makes its numbers go up while teaching nobody
   * anything.
   */
  it('pays more for a review that came back later', () => {
    for (let box = 1; box <= TOP_BOX; box++) {
      expect(xpFor('produced', box)).toBeGreaterThan(xpFor('produced', box - 1));
    }
  });

  it('pays a little more for producing it fast', () => {
    expect(xpFor('produced-fast', 2)).toBeGreaterThan(xpFor('produced', 2));
  });

  it('prices a hint at half, the way the game does', () => {
    // `HINT_SCALE` halves a hinted answer inside the round; the same trade
    // should read the same way outside it.
    expect(xpFor('hinted', 3)).toBe(Math.ceil(xpFor('produced', 3) / 2));
    expect(xpFor('hinted', 0)).toBeGreaterThan(0);
  });

  it('pays recognition, but barely', () => {
    expect(xpFor('recognised', TOP_BOX)).toBeGreaterThan(0);
    expect(xpFor('recognised', TOP_BOX)).toBeLessThan(xpFor('produced', 0));
  });

  /**
   * Not a punishment — the ladder has already done everything a miss deserves.
   * Paying for one would make the fastest way to earn a game of typing rubbish
   * into Vocab Race, and a number that rewards that is a number nobody can
   * respect.
   */
  it('pays nothing for a miss, however deep the word was', () => {
    for (const grade of ['wrong', 'gave-up', 'shown', 'seen'] as Grade[]) {
      expect(xpFor(grade, TOP_BOX)).toBe(0);
    }
  });

  it('keeps a game worth less than a study session', () => {
    const game = XP_PER_GAME + XP_PER_WIN;
    expect(game).toBeLessThan(3 * xpFor('produced', 2));
    // ...and still worth something, or the app reads as not having noticed.
    expect(XP_PER_GAME).toBeGreaterThan(0);
  });
});

describe('levels', () => {
  it('starts at one, for somebody who has done nothing', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(-100)).toBe(1);
  });

  it('agrees with the total each level begins at', () => {
    for (let level = 1; level <= 40; level++) {
      expect(levelFor(xpForLevel(level))).toBe(level);
      expect(levelFor(xpForLevel(level) - 1)).toBe(level - 1 || 1);
    }
  });

  it('never goes down as experience goes up', () => {
    let last = 1;
    for (let xp = 0; xp < 20_000; xp += 37) {
      const level = levelFor(xp);
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });

  it('puts the first level inside one good game', () => {
    expect(xpForLevel(2)).toBe(LEVEL_STEP);
    expect(LEVEL_STEP).toBeLessThan(10 * xpFor('produced', 1));
  });
});
