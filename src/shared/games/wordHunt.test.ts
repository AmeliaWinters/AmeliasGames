import { describe, expect, it } from 'vitest';
import {
  CELL_COUNT,
  GRID_SIZE,
  MAX_WORD,
  MIN_WORD,
  areAdjacent,
  canAct,
  canExtend,
  countOf,
  isLegalPath,
  isMasked,
  makeGrid,
  maskWord,
  scoreOf,
  solve,
  spell,
  wordHunt,
  wordScore,
} from './wordHunt.js';
import type { WhState } from './wordHunt.js';
import { isWord } from './words.js';

/** A generator that is exact rather than random, so every grid here is fixed. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    // xorshift32: cheap, and the same sequence on every machine.
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    value >>>= 0;
    return value / 0x100000000;
  };
}

/** The rng is consulted only when dealing, so this proves moves are pure. */
const noRng = () => {
  throw new Error("word hunt must not use randomness after the grid is dealt");
};

function fresh(players = 2): WhState {
  return wordHunt.setup(players, seeded(7));
}

/**
 * A state on a grid we chose, so a test can name the word it is tracing rather
 * than a run of cell indices nobody can read.
 */
function onGrid(grid: string, players = 2): WhState {
  const letters = grid.replace(/\s+/g, '').toUpperCase().split('');
  expect(letters).toHaveLength(CELL_COUNT);
  return { ...fresh(players), grid: letters };
}

/** Trace `word` on the state's grid, or fail — mirrors what the board does. */
function pathFor(state: WhState, word: string): number[] {
  const target = word.toUpperCase();
  const path: number[] = [];

  function walk(cell: number, depth: number): boolean {
    if (state.grid[cell] !== target[depth]) return false;
    path.push(cell);
    if (path.length === target.length) return true;
    for (let next = 0; next < CELL_COUNT; next++) {
      if (!path.includes(next) && areAdjacent(cell, next) && walk(next, depth + 1)) return true;
    }
    path.pop();
    return false;
  }

  for (let cell = 0; cell < CELL_COUNT; cell++) if (walk(cell, 0)) return path;
  throw new Error(`${target} is not traceable on this grid`);
}

function play(state: WhState, move: unknown, seat: number): WhState {
  const result = wordHunt.applyMove(state, move as never, seat, noRng);
  if (!result.ok) throw new Error(`move rejected: ${result.error}`);
  return result.state;
}

function refuse(state: WhState, move: unknown, seat: number): string {
  const result = wordHunt.applyMove(state, move as never, seat, noRng);
  if (result.ok) throw new Error('expected the move to be rejected');
  return result.error;
}

/** CRANE turns the corner at the end of the top row; the bottom row spells
 *  nothing at all, which is the other thing the tests need. */
const GRID = 'CRAN SETE HMPI DOKX';

describe('the grid', () => {
  it('deals sixteen letters', () => {
    const state = fresh();
    expect(state.grid).toHaveLength(GRID_SIZE * GRID_SIZE);
    expect(state.grid.every((letter) => /^[A-Z]$/.test(letter))).toBe(true);
  });

  it('is dealt from the rng, so the same seed deals the same grid', () => {
    expect(makeGrid(seeded(99))).toEqual(makeGrid(seeded(99)));
    expect(makeGrid(seeded(99))).not.toEqual(makeGrid(seeded(100)));
  });

  it('always holds words to find, including long ones', () => {
    // The whole point of planting and then checking the result: a grid with
    // nothing in it is a grid the player cannot tell apart from one they are
    // stuck on, and a grid of nothing but three-letter words is a typing test.
    for (let seed = 1; seed <= 20; seed++) {
      const words = solve(makeGrid(seeded(seed)));
      expect(words.length, `seed ${seed}`).toBeGreaterThanOrEqual(40);
      expect(
        words.filter((word) => word.length >= 6).length,
        `seed ${seed}`,
      ).toBeGreaterThanOrEqual(5);
      expect(words.every(isWord), `seed ${seed}`).toBe(true);
    }
  });

  it('finds every word on a grid and nothing that is not there', () => {
    const found = solve(onGrid(GRID).grid);
    expect(found).toContain('CRANE');
    // A word inside a longer one is still a word: the search takes CRAN on its
    // way to CRANE rather than instead of it.
    expect(found).toContain('CRAN');
    expect(found.every(isWord)).toBe(true);
    expect(new Set(found).size).toBe(found.length);
    expect(found).toEqual([...found].sort());
  });

  it('finds nothing longer than a trace is allowed to be', () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (const word of solve(makeGrid(seeded(seed)))) {
        expect(word.length).toBeGreaterThanOrEqual(MIN_WORD);
        expect(word.length).toBeLessThanOrEqual(MAX_WORD);
      }
    }
  });
});

describe('tracing a path', () => {
  it('accepts touching cells, each used once, at any workable length', () => {
    expect(isLegalPath([0, 1, 2])).toBe(true);
    expect(isLegalPath([0, 1, 2, 3, 7])).toBe(true);
    expect(isLegalPath([0, 1, 2, 3, 7, 6, 5, 4])).toBe(true);
    // Diagonals count — that is what makes this a hunt, not a word search.
    expect(isLegalPath([0, 5, 10, 15, 14])).toBe(true);
  });

  it('rejects a path that jumps, doubles back or runs off the board', () => {
    expect(isLegalPath([0, 2, 3, 7, 11])).toBe(false); // 0 and 2 do not touch
    expect(isLegalPath([0, 1, 0, 1, 2])).toBe(false); // a cell used twice
    expect(isLegalPath([0, 1, 2, 3, 16])).toBe(false); // off the board
    expect(isLegalPath([0, 1])).toBe(false); // too short
    expect(isLegalPath([0, 1, 2, 3, 7, 6, 5, 4, 8])).toBe(false); // too long
  });

  it('knows the ends of two rows do not touch', () => {
    // 3 and 4 are neighbours by index and opposite corners on the board.
    expect(areAdjacent(3, 4)).toBe(false);
    expect(areAdjacent(3, 7)).toBe(true);
    expect(areAdjacent(5, 5)).toBe(false);
  });

  it('extends a part-drawn path by the same rules', () => {
    expect(canExtend([], 9)).toBe(true);
    expect(canExtend([0, 1], 2)).toBe(true);
    expect(canExtend([0, 1], 0)).toBe(false);
    expect(canExtend([0, 1], 3)).toBe(false);
    // Eight is as long as a trace goes, so a ninth cell is refused however
    // legal the step itself would be.
    expect(canExtend([0, 1, 2, 3, 7, 6, 5, 4], 8)).toBe(false);
  });

  it('spells what the cells say', () => {
    expect(spell(onGrid(GRID).grid, [0, 1, 2, 3, 7])).toBe('CRANE');
    expect(spell(onGrid(GRID).grid, [0, 1, 2])).toBe('CRA');
  });
});

describe('what a word is worth', () => {
  it('climbs faster than length does', () => {
    const scores = [3, 4, 5, 6, 7, 8].map((n) => wordScore('A'.repeat(n)));
    expect(scores).toEqual([100, 400, 800, 1400, 1800, 2200]);
    // Two threes must not beat a five, or the game rewards typing over hunting.
    expect(scores[0] * 2).toBeLessThan(scores[2]);
  });

  it('is worth nothing outside the range, which the reducer never allows', () => {
    expect(wordScore('AB')).toBe(0);
    expect(wordScore('A'.repeat(9))).toBe(0);
  });
});

describe('finding a word', () => {
  it('takes a real word and scores it by length', () => {
    let state = onGrid(GRID);
    state = play(state, { type: 'found', path: pathFor(state, 'CRANE') }, 0);
    expect(state.found[0]).toEqual(['CRANE']);
    expect(scoreOf(state, 0)).toBe(800);
    expect(countOf(state, 0)).toBe(1);
    expect(scoreOf(state, 1)).toBe(0);
  });

  it('takes a short word too, for less', () => {
    let state = onGrid(GRID);
    state = play(state, { type: 'found', path: pathFor(state, 'CRAN') }, 0);
    state = play(state, { type: 'found', path: pathFor(state, 'RAN') }, 0);
    expect(state.found[0]).toEqual(['CRAN', 'RAN']);
    expect(scoreOf(state, 0)).toBe(500);
  });

  it('refuses letters that spell nothing', () => {
    const state = onGrid(GRID);
    expect(refuse(state, { type: 'found', path: [12, 13, 14, 15, 11] }, 0)).toMatch(
      /not in the word list/,
    );
    expect(refuse(state, { type: 'found', path: [15, 14, 13] }, 0)).toMatch(
      /not in the word list/,
    );
  });

  it('refuses a word the player already has', () => {
    let state = onGrid(GRID);
    const path = pathFor(state, 'CRANE');
    state = play(state, { type: 'found', path }, 0);
    expect(refuse(state, { type: 'found', path }, 0)).toMatch(/already have CRANE/);
  });

  it('lets the other seat find the same word', () => {
    // Everyone hunts the same grid; racing for a word nobody else can have
    // would be a different, meaner game.
    let state = onGrid(GRID);
    const path = pathFor(state, 'CRANE');
    state = play(state, { type: 'found', path }, 0);
    state = play(state, { type: 'found', path }, 1);
    expect(state.found[1]).toEqual(['CRANE']);
  });

  it('refuses a path that is not a path', () => {
    const state = onGrid(GRID);
    for (const path of [[0, 2, 4, 6, 8], 'CRANE', null, [0, 1], [1.5, 2, 3, 4, 5]]) {
      expect(refuse(state, { type: 'found', path }, 0)).toMatch(/touching letters/);
    }
  });

  it('refuses a mover who is not at the table, and a move it cannot read', () => {
    const state = onGrid(GRID);
    expect(refuse(state, { type: 'done' }, 4)).toBe('You are not playing.');
    expect(refuse(state, { type: 'shout' }, 0)).toBe('Unknown move.');
    expect(refuse(state, null, 0)).toBe('Unknown move.');
  });

  it('never mutates the state it was given', () => {
    const state = onGrid(GRID);
    const before = JSON.stringify(state);
    play(state, { type: 'found', path: pathFor(state, 'CRANE') }, 0);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('finishing', () => {
  it('keeps the game open while anyone is still hunting', () => {
    let state = onGrid(GRID);
    state = play(state, { type: 'done' }, 0);
    expect(state.phase).toBe('play');
    expect(canAct(state, 0)).toBe(false);
    expect(canAct(state, 1)).toBe(true);
    expect(wordHunt.turn(state)).toBe(1);
    expect(wordHunt.isOver(state)).toBe(false);
  });

  it('lets a seat that has finished do nothing else', () => {
    let state = onGrid(GRID);
    const path = pathFor(state, 'CRANE');
    state = play(state, { type: 'done' }, 0);
    expect(refuse(state, { type: 'found', path }, 0)).toMatch(/finished hunting/);
    expect(refuse(state, { type: 'done' }, 0)).toMatch(/already finished/);
  });

  it('ends when the last seat stops, and hands it to the biggest haul', () => {
    let state = onGrid(GRID);
    state = play(state, { type: 'found', path: pathFor(state, 'CRANE') }, 0);
    state = play(state, { type: 'done' }, 0);
    state = play(state, { type: 'done' }, 1);

    expect(state.phase).toBe('over');
    expect(wordHunt.isOver(state)).toBe(true);
    expect(wordHunt.turn(state)).toBeNull();
    expect(state.winner).toBe(0);
    expect(state.draw).toBe(false);
    expect(wordHunt.status(state, ['Amelia', 'Bo'])).toBe('Amelia wins on 800 — 1 word');
  });

  it('hands it to the better words, not to the most of them', () => {
    // Two short words against one longer one: the point of scoring by length.
    let state = onGrid(GRID, 2);
    state = play(state, { type: 'found', path: pathFor(state, 'CRAN') }, 0);
    state = play(state, { type: 'found', path: pathFor(state, 'RAN') }, 0);
    state = play(state, { type: 'found', path: pathFor(state, 'CRANE') }, 1);
    state = play(state, { type: 'done' }, 0);
    state = play(state, { type: 'done' }, 1);
    expect(countOf(state, 0)).toBeGreaterThan(countOf(state, 1));
    expect(state.winner).toBe(1);
  });

  it('calls a level score a draw, however many are level', () => {
    let state = onGrid(GRID, 3);
    state = play(state, { type: 'done' }, 0);
    state = play(state, { type: 'done' }, 1);
    state = play(state, { type: 'done' }, 2);
    expect(state.winner).toBeNull();
    expect(state.draw).toBe(true);
    expect(wordHunt.status(state, [])).toBe('A draw. Nobody found a thing.');
  });

  it('reveals the answer key, and only then', () => {
    let state = onGrid(GRID);
    expect(state.solutions).toEqual([]);
    state = play(state, { type: 'done' }, 0);
    expect(state.solutions).toEqual([]);
    state = play(state, { type: 'done' }, 1);
    expect(state.solutions).toEqual(solve(state.grid));
    expect(state.solutions).toContain('CRANE');
  });

  it('refuses everything once it is over', () => {
    let state = onGrid(GRID);
    const path = pathFor(state, 'CRANE');
    state = play(state, { type: 'done' }, 0);
    state = play(state, { type: 'done' }, 1);
    expect(refuse(state, { type: 'found', path }, 0)).toBe('The game is already over.');
    expect(refuse(state, { type: 'done' }, 0)).toBe('The game is already over.');
  });
});

describe('what each seat is shown', () => {
  it('hides the words other people have found, but not the score', () => {
    let state = onGrid(GRID);
    state = play(state, { type: 'found', path: pathFor(state, 'CRANE') }, 0);

    const seen = wordHunt.view!(state, 1);
    expect(seen.found[0]).toEqual([maskWord('CRANE')]);
    expect(seen.found[0].every(isMasked)).toBe(true);
    // Masked to the same length, so the score survives redaction — which is
    // the point: you watch their total climb without learning their words.
    expect(scoreOf(seen, 0)).toBe(scoreOf(state, 0));
    expect(countOf(seen, 0)).toBe(1);
    // Their own list is untouched, and the grid is everybody's.
    expect(wordHunt.view!(state, 0).found[0]).toEqual(['CRANE']);
    expect(seen.grid).toEqual(state.grid);
    expect(seen.solutions).toEqual([]);
  });

  it('opens every list once the game is over', () => {
    let state = onGrid(GRID);
    state = play(state, { type: 'found', path: pathFor(state, 'CRANE') }, 0);
    state = play(state, { type: 'done' }, 0);
    state = play(state, { type: 'done' }, 1);
    expect(wordHunt.view!(state, 1).found[0]).toEqual(['CRANE']);
  });
});

describe('the status line', () => {
  it('says who the table is waiting on', () => {
    let state = onGrid(GRID, 3);
    expect(wordHunt.status(state, ['Amelia', 'Bo', 'Cy'])).toBe('Everyone is hunting');
    state = play(state, { type: 'done' }, 0);
    expect(wordHunt.status(state, ['Amelia', 'Bo', 'Cy'])).toBe('Waiting on 2 players');
    state = play(state, { type: 'done' }, 1);
    expect(wordHunt.status(state, ['Amelia', 'Bo', 'Cy'])).toBe('Waiting on Cy');
  });

  it('falls back to a seat number when a name is missing', () => {
    let state = onGrid(GRID);
    state = play(state, { type: 'done' }, 0);
    expect(wordHunt.status(state, [])).toBe('Waiting on Player 2');
  });
});
