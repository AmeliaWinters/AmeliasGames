// @vitest-environment jsdom
/**
 * What one game paid, subtracted out of two summaries.
 *
 * The purse is the part worth pinning. Every game pays into it -- the eleven
 * that teach no vocabulary included -- and for most of a year the end screen
 * drew nothing at all for those games, because the panel appeared only when a
 * word had been learned. A test that only ever asked about words would have
 * agreed with that forever.
 */
import { describe, it, expect } from 'vitest';
import { earnedBetween } from './profileCache.js';
import type { ProfileView } from '../shared/profile.js';
import { POINTS_FIRST_GAME_OF_DAY } from '../shared/review.js';

function view(over: Partial<ProfileView> = {}): ProfileView {
  return {
    id: 'acct',
    name: 'Amelia',
    streak: { days: 0, lastDay: 0, rests: 0 },
    playedToday: false,
    words: 0,
    learned: 0,
    due: 0,
    byLang: [],
    games: [],
    recent: [],
    spendable: 0,
    showcase: [],
    claimed: 0,
    rank: { level: 1, levelAt: 0, nextLevel: 60 },
    xp: 0,
    ...over,
  };
}

describe('what a game paid', () => {
  it('reports the purse for a game that taught nothing', () => {
    // Backgammon: no words, no experience, twenty points. This is the case
    // that used to draw no panel at all.
    const earned = earnedBetween(view(), view({ spendable: 20 }));
    expect(earned?.points).toBe(20);
    expect(earned?.daily).toBe(0);
  });

  it('names the once-a-day bonus rather than inferring it from the size', () => {
    const before = view({ playedToday: false });
    const after = view({ playedToday: true, spendable: POINTS_FIRST_GAME_OF_DAY + 20 });
    expect(earnedBetween(before, after)?.daily).toBe(POINTS_FIRST_GAME_OF_DAY);
  });

  it('claims no bonus for the second game of the day, however well it paid', () => {
    // A good Vocab Race clears 300 on its own, which is exactly why this is
    // read off `playedToday` and not off the number.
    const before = view({ playedToday: true, spendable: 400 });
    const after = view({ playedToday: true, spendable: 900 });
    const earned = earnedBetween(before, after);
    expect(earned?.points).toBe(500);
    expect(earned?.daily).toBe(0);
  });

  it('never reports a negative purse for a chest opened in between', () => {
    // Spending is a thing somebody chose, on a screen that named the price.
    // "-100 GP" over the end of a game would be the app billing them twice.
    const earned = earnedBetween(view({ spendable: 400, words: 0 }), view({ spendable: 300, words: 1 }));
    expect(earned?.points).toBe(0);
  });

  it('still draws nothing for a game that changed nothing', () => {
    expect(earnedBetween(view({ spendable: 40 }), view({ spendable: 40 }))).toBeNull();
  });
});
