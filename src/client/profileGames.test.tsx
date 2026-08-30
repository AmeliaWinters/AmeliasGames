// @vitest-environment jsdom
/**
 * The games panel: one account's history, as it is actually drawn.
 *
 * The counts are covered where they are computed, in `harvest.test.ts`, so
 * nothing here re-checks the arithmetic. What this file is for is the three
 * decisions the panel makes that no reducer test can see: that a game which
 * never names a winner is not drawn as a losing record, that the list is
 * ordered by when things happened rather than by how often, and that the run
 * of coloured pips has words behind it for somebody who cannot see them.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Stats } from './Stats.js';
import type { GameTally, ProfileView } from '../shared/profile.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const DAY = 86_400_000;
const NOW = Date.now();

function tally(over: Partial<GameTally> = {}): GameTally {
  return {
    gameId: 'wordchain',
    played: 6,
    won: 3,
    lost: 2,
    drew: 1,
    last: ['lost', 'won', 'drew'],
    lastAt: NOW,
    ...over,
  };
}

function view(games: GameTally[]): ProfileView {
  return {
    id: 'acct',
    name: 'Amelia',
    streak: { days: 0, lastDay: 0, rests: 0 },
    playedToday: false,
    rank: { level: 1, levelAt: 0, nextLevel: 60 },
    xp: 0,
    words: 0,
    learned: 0,
    due: 0,
    byLang: [],
    games,
    recent: [],
    spendable: 0,
    showcase: [],
    claimed: 0,
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * Draw the games list, on the screen it actually lives on.
 *
 * It used to be reached by rendering the account menu and pressing its Stats
 * row. Stats is a screen of its own now -- see `Stats.tsx` for why a section
 * that grows without limit is the wrong thing to hang in a menu -- so this
 * renders it directly, and there is no key to satisfy: the screen draws the
 * `ProfileView` it is handed and asks storage nothing.
 */
function draw(profile: ProfileView): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(createElement(Stats, { profile, onBack: () => {} }));
  });
  const panel = host.querySelector('.prof-games');
  if (!panel) throw new Error('the games panel was not drawn');
  return panel as HTMLElement;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('the games panel', () => {
  it('leads with the game played most recently, not the one played most', () => {
    const panel = draw(
      view([
        tally({ gameId: 'connect4', played: 90, won: 0, lost: 0, drew: 0, last: [], lastAt: NOW - 30 * DAY }),
        tally({ gameId: 'wordchain', played: 4, lastAt: NOW - DAY }),
      ]),
    );
    const names = [...panel.querySelectorAll('.prof-game')].map((node) => node.textContent);
    expect(names[0]).toMatch(/word/i);
  });

  /**
   * Eleven of the thirteen games name no winner. Drawing "0W 0L" for those
   * would read as ninety losses rather than as ninety games nobody scored.
   */
  it('says only how many were played for a game that names no winner', () => {
    const panel = draw(view([tally({ gameId: 'connect4', played: 90, won: 0, lost: 0, drew: 0, last: [] })]));
    const row = panel.querySelector('.prof-game-n')!;
    expect(row.textContent).toContain('90 played');
    expect(row.textContent).not.toMatch(/[WL]\b/);
    expect(panel.querySelector('.prof-pip')).toBeNull();
  });

  it('draws the record and a pip per decided game where there is one', () => {
    const panel = draw(view([tally()]));
    expect(panel.querySelector('.prof-game-n')!.textContent).toContain('3W');
    expect(panel.querySelectorAll('.prof-pip')).toHaveLength(3);
    // Oldest on the left, which is the direction a run is read in.
    expect(panel.querySelector('.prof-pip')!.className).toContain('prof-pip-lost');
  });

  /** Ten coloured dots say nothing out loud. The label is the whole run. */
  it('spells the run out for a screen reader', () => {
    const panel = draw(view([tally({ lastAt: NOW - DAY })]));
    const label = panel.querySelector('.prof-game-n')!.getAttribute('aria-label')!;
    expect(label).toContain('lost, won, drew');
    expect(label).toContain('yesterday');
    expect(panel.querySelector('.prof-form')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('adds every game up in the heading', () => {
    const panel = draw(view([tally({ played: 6 }), tally({ gameId: 'connect4', played: 9 })]));
    expect(panel.querySelector('.prof-games-total')!.textContent).toBe('15 played');
  });
});
