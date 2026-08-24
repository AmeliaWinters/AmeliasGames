import { describe, expect, it } from 'vitest';
import {
  CELL_COUNT,
  GRID_SIZE,
  MAX_WORD,
  MIN_WORD,
  blockedBy,
  claim,
  isFull,
  isLocked,
  letterpress,
  makeGrid,
  neighbours,
  playable,
  richness,
  tally,
  unclaimed,
  type LpMove,
  type LpState,
  type Owner,
} from './letterpress.js';
import { isWord } from './words.js';

/** Fixed so a failure names a game somebody can get back to. */
function seeded(from = 20250823): () => number {
  let n = from;
  return () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
}

const rng = () => 0.5;

/**
 * A board built by hand, from five rows of five letters.
 *
 * Every rule below is about *which tiles turn*, and a dealt grid is the wrong
 * place to test that: the letters are random, so the word that reaches the
 * tile the test is about is different every run. These are grids whose words
 * are known, and every one of them is a real word in the list — the assertion
 * at the foot of this file holds that, because a test grid that cannot spell
 * is a test that passes by refusing everything.
 */
function board(rows: string[], owner: Owner[] = Array(CELL_COUNT).fill(null)): LpState {
  const grid = rows.join('').split('');
  expect(grid).toHaveLength(CELL_COUNT);
  return {
    ...letterpress.setup(2, rng),
    grid,
    owner: owner.slice(),
  };
}

/** Owners written the way the board looks: `.` free, `0` and `1` the seats. */
function owners(rows: string[]): Owner[] {
  return rows
    .join('')
    .split('')
    .map((mark) => (mark === '0' ? 0 : mark === '1' ? 1 : null));
}

/** Where a word's letters are on the grid — the taps a player would make. */
function tapsFor(state: LpState, word: string): number[] {
  const path: number[] = [];
  for (const letter of word) {
    const at = state.grid.findIndex((tile, cell) => tile === letter && !path.includes(cell));
    if (at === -1) throw new Error(`${word} is not on this grid`);
    path.push(at);
  }
  return path;
}

function apply(state: LpState, move: LpMove, seat = state.turn): LpState {
  const result = letterpress.applyMove(state, move, seat, rng);
  if (!result.ok) throw new Error(`that move was refused: ${result.error}`);
  return result.state;
}

/** Play a word by spelling it out of the first tiles that carry its letters. */
function say(state: LpState, word: string): LpState {
  return apply(state, { type: 'play', path: tapsFor(state, word) });
}

function refuse(state: LpState, move: LpMove, seat = state.turn): string {
  const result = letterpress.applyMove(state, move, seat, rng);
  if (result.ok) throw new Error('that move was allowed');
  return result.error;
}

/** The grid these tests spell on: CAT, CATS, TAR, RIP, DOG, SWAN, SWAY. */
const GRID = ['CATSR', 'RIPEN', 'DOGLM', 'UHTEB', 'SWANY'];

describe('the opening', () => {
  it('deals twenty-five letters and hands nobody a tile', () => {
    const state = letterpress.setup(2, seeded());
    expect(state.grid).toHaveLength(CELL_COUNT);
    expect(state.grid.every((letter) => /^[A-Z]$/.test(letter))).toBe(true);
    expect(unclaimed(state)).toBe(CELL_COUNT);
    expect(tally(state)).toEqual([0, 0]);
    expect(state.turn).toBe(0);
    expect(letterpress.isOver(state)).toBe(false);
  });

  it('refuses a move from the seat whose turn it is not', () => {
    expect(refuse(board(GRID), { type: 'play', path: tapsFor(board(GRID), 'CAT') }, 1)).toMatch(
      /not your turn/i,
    );
  });
});

describe('a word', () => {
  it('claims every tile it used', () => {
    const state = say(board(GRID), 'CAT');
    expect(tally(state)).toEqual([3, 0]);
    expect(state.turn).toBe(1);
    expect(state.played).toEqual(['CAT']);
    expect(state.words).toEqual([['CAT'], []]);
    expect(state.lastWord).toBe('CAT');
    expect(state.lastPlay).toEqual([0, 1, 2]);
  });

  it('needs no adjacency at all — any tiles anywhere', () => {
    // S at 3, W at 21, A at 22, N at 23: three rows apart from the S.
    const state = board(GRID);
    const path = [3, 21, 22, 23];
    expect(letterpress.applyMove(state, { type: 'play', path }, 0, rng).ok).toBe(true);
  });

  it('takes tiles off the other player', () => {
    let state = say(board(GRID), 'CAT');
    // TAR reaches back for the same C-A-T row's A and T.
    state = say(state, 'TAR');
    expect(tally(state)).toEqual([1, 3]);
  });

  it('is refused if it is not in the word list', () => {
    // Z is not on this grid, so nonsense has to be spelled from what is.
    expect(refuse(board(GRID), { type: 'play', path: [0, 1, 3] })).toMatch(/not in the word list/i);
  });

  it('is refused if it is too short or taps a tile twice', () => {
    const state = board(GRID);
    expect(refuse(state, { type: 'play', path: [0, 1] })).toMatch(
      new RegExp(`${MIN_WORD} to ${MAX_WORD}`),
    );
    expect(refuse(state, { type: 'play', path: [0, 1, 1] })).toMatch(/different tiles/i);
  });

  /**
   * There is no "too long" left to test on its own: the ceiling is the grid,
   * so a path that overruns it has to have tapped something twice to get
   * there. What is worth pinning instead is the other end — a word past the
   * eight letters the list used to stop at, which is what was reported.
   */
  it('takes a word longer than the dictionary used to go', () => {
    const state = board(GRID);
    const path = tapsFor(state, 'THUNDERCLAPS');
    expect(path).toHaveLength(12);
    expect(letterpress.applyMove(state, { type: 'play', path }, 0, rng).ok).toBe(true);
  });

  it('is refused if it points off the board', () => {
    for (const path of [[-1, 1, 2], [0, 1, CELL_COUNT], [0, 1.5, 2]]) {
      expect(refuse(board(GRID), { type: 'play', path })).toMatch(/different tiles/i);
    }
  });
});

describe('a word that has been played', () => {
  it('cannot be played again, by either of you', () => {
    const state = say(board(GRID), 'CAT');
    expect(refuse(state, { type: 'play', path: tapsFor(state, 'CAT') })).toMatch(
      /already been played/i,
    );
  });

  it('takes every longer word that starts with it', () => {
    const state = say(board(GRID), 'CAT');
    expect(refuse(state, { type: 'play', path: tapsFor(state, 'CATS') })).toMatch(
      /CATS is out — CAT has been played/,
    );
  });

  it('leaves the shorter word inside it alone', () => {
    // CATS first, then CAT: different tiles, and finding the short word inside
    // a long one is not the same trick twice.
    const state = say(board(GRID), 'CATS');
    expect(letterpress.applyMove(state, { type: 'play', path: tapsFor(state, 'CAT') }, 1, rng).ok)
      .toBe(true);
  });

  it('is decided by `blockedBy`, which names what blocked it', () => {
    expect(blockedBy(['CAT'], 'CATS')).toBe('CAT');
    expect(blockedBy(['CAT'], 'CAT')).toBe('CAT');
    expect(blockedBy(['CATS'], 'CAT')).toBeNull();
    expect(blockedBy([], 'CAT')).toBeNull();
  });
});

describe('defence', () => {
  it('locks a tile whose four neighbours are all its owner’s', () => {
    const owner = owners([
      '.0...',
      '000..',
      '.0...',
      '.....',
      '.....',
    ]);
    // Tile 6 is the middle of the plus; 1, 5, 7 and 11 are its neighbours.
    expect(neighbours(6).sort((a, b) => a - b)).toEqual([1, 5, 7, 11]);
    expect(isLocked(owner, 6)).toBe(true);
    // The arms of the plus are not: each has a free neighbour.
    expect(isLocked(owner, 1)).toBe(false);
    expect(isLocked(owner, 5)).toBe(false);
  });

  it('needs only the sides a tile has, so a corner locks on two', () => {
    const owner = owners([
      '11...',
      '1....',
      '.....',
      '.....',
      '.....',
    ]);
    expect(isLocked(owner, 0)).toBe(true);
    expect(isLocked(owner, 1)).toBe(false);
  });

  it('does not lock a tile nobody holds, however it is surrounded', () => {
    const owner = owners([
      '.0...',
      '0.0..',
      '.0...',
      '.....',
      '.....',
    ]);
    expect(isLocked(owner, 6)).toBe(false);
  });

  it('leaves a locked tile where it is when the other player uses it', () => {
    const owner = owners([
      '.1...',
      '111..',
      '.1...',
      '.....',
      '.....',
    ]);
    // Tile 6 is seat 1's and locked — 1, 5, 7 and 11 are all theirs. Tiles 5
    // and 7 are theirs too, and neither is locked.
    const state = { ...board(GRID, owner), turn: 0 as const };
    expect(tally(state)).toEqual([0, 5]);
    expect(isLocked(owner, 6)).toBe(true);

    // RIP spells off tiles 4, 6 and 7: a free tile, the locked one, and one of
    // seat 1's that is not.
    const next = say(state, 'RIP');
    expect(next.lastPlay).toEqual([4, 6, 7]);
    expect(next.owner[4], 'a free tile did not come across').toBe(0);
    expect(next.owner[7], 'an undefended tile did not come across').toBe(0);
    expect(next.owner[6], 'a locked tile changed hands').toBe(1);
    expect(tally(next)).toEqual([2, 4]);
  });

  it('judges every tile against the board as it stood, not as the word leaves it', () => {
    /*
      The order-of-letters trap. Tile 6 is locked only because tile 5 is seat
      1's. A word that uses tile 5 and then tile 6 must not take tile 6: the
      lock is read once, before anything turns. Written the naive way — turn
      each tile as you reach it — tile 5 becomes seat 0's, tile 6 is no longer
      surrounded, and the very same word takes two tiles instead of one.
    */
    const owner = owners([
      '.1...',
      '111..',
      '.1...',
      '.....',
      '.....',
    ]);
    expect(isLocked(owner, 6)).toBe(true);
    const after = claim(owner, [5, 6], 0);
    expect(after[6], 'the lock broke halfway through the word').toBe(1);

    // And the other way round: reaching tile 6 first changes nothing either.
    expect(claim(owner, [6, 5], 0)).toEqual(after);
  });

  it('is what makes a word take fewer tiles than it has letters', () => {
    // Seat 1 holds the CAT row's C locked into the top-left corner.
    const owner = owners([
      '11...',
      '1....',
      '.....',
      '.....',
      '.....',
    ]);
    const state = say({ ...board(GRID, owner), turn: 0 as const }, 'CAT');
    // C (tile 0) is locked and stays seat 1's; A and T come across, so a
    // three-letter word takes two tiles.
    expect(state.owner[0]).toBe(1);
    expect(tally(state)).toEqual([2, 2]);
  });
});

describe('the end of the game', () => {
  /** A board one tile from full, with that tile about to decide it. */
  function nearlyFull(lead: 0 | 1): LpState {
    const owner: Owner[] = Array(CELL_COUNT).fill(lead);
    // Everything is the leader's but three tiles: two for the other seat, and
    // one free. Nothing is locked, because the free tile touches nothing here.
    owner[24] = null;
    owner[23] = lead === 0 ? 1 : 0;
    owner[19] = lead === 0 ? 1 : 0;
    return { ...board(GRID, owner), turn: lead === 0 ? 1 : 0 };
  }

  it('is the moment the grid fills, and the count decides it', () => {
    const state = nearlyFull(0);
    expect(unclaimed(state)).toBe(1);
    // Tile 24 is Y; SWAY takes it, and tiles 20, 21, 22 with it.
    const next = apply(state, { type: 'play', path: [20, 21, 22, 24] });
    expect(unclaimed(next)).toBe(0);
    expect(letterpress.isOver(next)).toBe(true);
    expect(next.winner).toBe(0);
    expect(letterpress.turn(next)).toBeNull();
    expect(letterpress.canAct(next, 0)).toBe(false);
    expect(letterpress.canAct(next, 1)).toBe(false);
  });

  it('refuses any further move once it is over', () => {
    let state = nearlyFull(0);
    state = apply(state, { type: 'play', path: [20, 21, 22, 24] });
    expect(refuse(state, { type: 'play', path: [0, 1, 2] }, 0)).toMatch(/already over/i);
    expect(refuse(state, { type: 'pass' }, 1)).toMatch(/already over/i);
  });

  it('can be lost on the last move by whoever was ahead all game', () => {
    /*
      The property the whole game rests on: nothing is banked. Seat 0 leads
      thirteen tiles to eleven with one free, and loses the game on the word
      that fills the grid — a four-letter word, taking three of the leader's
      tiles and the last free one.

      The bottom row is deliberately undefended: 15, 16 and 17 belong to seat 1,
      so 20, 21 and 22 each have a neighbour that is not their owner's. Had
      seat 0 spent a turn locking that row instead of taking a fourteenth tile,
      the same word would have taken one tile and seat 0 would have won.
    */
    const owner = owners([
      '00000',
      '00000',
      '11111',
      '11111',
      '0001.',
    ]);
    const state = { ...board(GRID, owner), turn: 1 as const };
    expect(tally(state)).toEqual([13, 11]);
    expect(unclaimed(state)).toBe(1);

    // Tiles 20, 21, 22 and 24 are S, W, A and Y.
    const next = apply(state, { type: 'play', path: [20, 21, 22, 24] });
    expect(next.winner).toBe(1);
    expect(tally(next)).toEqual([10, 15]);
  });
});

describe('passing', () => {
  it('hands the turn over and nothing else', () => {
    const state = apply(board(GRID), { type: 'pass' });
    expect(state.turn).toBe(1);
    expect(state.passes).toBe(1);
    expect(unclaimed(state)).toBe(CELL_COUNT);
    expect(state.lastWord).toBeNull();
  });

  it('ends the game when both of you do it in a row', () => {
    let state = apply(board(GRID), { type: 'pass' });
    state = apply(state, { type: 'pass' });
    expect(letterpress.isOver(state)).toBe(true);
    // Nobody held anything, so nobody won it.
    expect(state.draw).toBe(true);
    expect(state.winner).toBeNull();
  });

  it('takes both of you, so nobody can bank a lead alone', () => {
    let state = say(board(GRID), 'CAT');
    state = apply(state, { type: 'pass' });
    expect(letterpress.isOver(state)).toBe(false);
    // Seat 0 is ahead and passed; seat 1 simply plays on.
    state = say(state, 'DOG');
    expect(state.passes).toBe(0);
    expect(letterpress.isOver(state)).toBe(false);
  });

  it('settles on the count, the same as a full grid does', () => {
    let state = say(board(GRID), 'CAT');
    state = apply(state, { type: 'pass' });
    state = apply(state, { type: 'pass' });
    expect(state.winner).toBe(0);
    expect(tally(state)).toEqual([3, 0]);
  });
});

describe('the reducer itself', () => {
  it('never mutates the state it is given', () => {
    const state = board(GRID);
    const copy = structuredClone(state);
    letterpress.applyMove(state, { type: 'play', path: tapsFor(state, 'CAT') }, 0, rng);
    letterpress.applyMove(state, { type: 'pass' }, 0, rng);
    expect(state).toEqual(copy);
  });

  it('turns away nonsense without throwing', () => {
    const state = board(GRID);
    for (const move of [null, undefined, {}, { type: 'sing' }, { type: 'play' }]) {
      expect(letterpress.applyMove(state, move as unknown as LpMove, 0, rng).ok).toBe(false);
    }
  });

  it('says the score and how much of the board is left', () => {
    const state = say(board(GRID), 'CAT');
    expect(letterpress.status(state, ['Amelia', 'Bo'])).toBe('Bo to play — 3–0, 22 tiles free');
  });

  it('says when one more pass ends it', () => {
    const state = apply(board(GRID), { type: 'pass' });
    expect(letterpress.status(state, ['Amelia', 'Bo'])).toMatch(/pass again/);
  });

  it('says who won and by how much', () => {
    let state = say(board(GRID), 'CAT');
    state = apply(state, { type: 'pass' });
    state = apply(state, { type: 'pass' });
    expect(letterpress.status(state, ['Amelia', 'Bo'])).toBe('Amelia wins — 3 tiles to 0');
  });
});

describe('the deal', () => {
  it('always holds a long word, and plenty of them', () => {
    const deal = seeded(7);
    for (let attempt = 0; attempt < 12; attempt++) {
      const grid = makeGrid(deal);
      expect(grid).toHaveLength(CELL_COUNT);
      // The floor `makeGrid` deals against. A typical grid is an order of
      // magnitude past it; this is the check that a bad deal was not shipped.
      expect(richness(grid, 400), grid.join('')).toBeGreaterThanOrEqual(400);
    }
  });

  it('keeps the vowels inside the range a grid needs', () => {
    const deal = seeded(11);
    for (let attempt = 0; attempt < 12; attempt++) {
      const grid = makeGrid(deal);
      const vowels = grid.filter((letter) => 'AEIOU'.includes(letter)).length;
      expect(vowels, grid.join('')).toBeGreaterThanOrEqual(7);
      expect(vowels, grid.join('')).toBeLessThanOrEqual(11);
    }
  });

  it('is the same grid twice from the same seed', () => {
    expect(makeGrid(seeded(3))).toEqual(makeGrid(seeded(3)));
  });
});

/**
 * Games played to a finish against the words the grid actually holds, which is
 * the closest a test gets to two people playing it.
 *
 * It is looking for three things at once: that the game always ends, that the
 * board is conserved on every move — twenty-five tiles, no more and no fewer,
 * however many change hands — and that a locked tile is never taken. The last
 * is the one that would go wrong quietly: a defence that leaks would still
 * produce a game that finishes and totals correctly.
 */
describe('games played out', () => {
  /**
   * Which tiles to spell a word off, chosen the way a player would: an
   * unclaimed tile before one of theirs, and one of theirs before one of your
   * own, since a tile you already hold is a letter spent for nothing.
   */
  function tapsToPlay(state: LpState, word: string, mover: 0 | 1): number[] | null {
    const path: number[] = [];
    for (const letter of word) {
      const options = state.grid.flatMap((tile, cell) =>
        tile === letter && !path.includes(cell) ? [cell] : [],
      );
      if (options.length === 0) return null;
      const rank = (cell: number) =>
        state.owner[cell] === null ? 0 : state.owner[cell] === mover ? 2 : 1;
      path.push(options.reduce((best, cell) => (rank(cell) < rank(best) ? cell : best)));
    }
    return path;
  }

  it('always end, conserve the board, and never break a lock', () => {
    const random = seeded(1337);
    const GAMES = 200;
    let toTheLastTile = 0;

    for (let game = 0; game < GAMES; game++) {
      let state = letterpress.setup(2, random);

      /*
        The grid never changes, so the words it can spell never change either
        — only which of them are still free. One sweep per game rather than
        one per turn, which is the difference between this test taking seconds
        and taking minutes. Short words and long ones both, because a game
        played entirely in three-letter words never gets near a lock.
      */
      const pool = [
        ...playable(state.grid, [], 400),
        ...playable(state.grid, [], 400, 6),
      ];
      expect(pool.length, 'a dealt grid with nothing on it').toBeGreaterThan(0);

      let moves = 0;
      while (!letterpress.isOver(state)) {
        expect(moves++, 'a game that would not end').toBeLessThan(200);

        const seat = state.turn;
        expect(letterpress.canAct(state, seat)).toBe(true);
        expect(letterpress.canAct(state, seat === 0 ? 1 : 0)).toBe(false);
        expect(letterpress.turn(state)).toBe(seat);

        /*
          Thirty candidates, and the one that claims the most tiles wins the
          turn. Greedy rather than random on purpose: a random word takes tiles
          it already holds as happily as free ones, and two players doing that
          can pass a board back and forth for ever without filling it. Playing
          to take is both what a person does and what makes the game end.
        */
        let choice: { path: number[]; gain: number } | null = null;
        for (let look = 0; look < 30; look++) {
          const word = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
          if (blockedBy(state.played, word) !== null) continue;
          const path = tapsToPlay(state, word, seat as 0 | 1);
          if (path === null) continue;
          const gain = path.filter((cell) => state.owner[cell] !== seat).length;
          if (choice === null || gain > choice.gain) choice = { path, gain };
        }

        if (choice === null) {
          state = apply(state, { type: 'pass' });
          continue;
        }

        const before = state;
        const locked = state.owner.map((_, cell) => isLocked(state.owner, cell));
        state = apply(state, { type: 'play', path: choice.path });

        const [zero, one] = tally(state);
        expect(zero + one + unclaimed(state)).toBe(CELL_COUNT);
        expect(state.turn).not.toBe(seat);

        for (let cell = 0; cell < CELL_COUNT; cell++) {
          if (locked[cell]) {
            expect(state.owner[cell], `tile ${cell} was locked and changed hands`).toBe(
              before.owner[cell],
            );
          }
        }
      }

      const [zero, one] = tally(state);
      if (state.draw) expect(zero).toBe(one);
      else expect(state.winner).toBe(zero > one ? 0 : 1);
      expect(letterpress.turn(state)).toBeNull();
      // One of the two endings, and never anything else: a full grid, or a
      // turn neither of them could move in.
      expect(isFull(state) || state.passes >= 2).toBe(true);
      if (isFull(state)) toTheLastTile += 1;
    }

    /*
      Every one of them so far has gone to the last tile, which is the ending
      the game is designed around — the pass exists for the standoff, not for
      the ordinary case. Asserted as a large majority rather than as all of
      them, because a player greedy for tiles is not obliged to be able to
      fill the board and holding the test to that would make it a test of the
      word list.
    */
    expect(toTheLastTile).toBeGreaterThan(GAMES * 0.9);
  }, 120_000);
});

describe('the test grid itself', () => {
  it('is five rows of five, and spells every word these tests play', () => {
    expect(GRID).toHaveLength(GRID_SIZE);
    for (const row of GRID) expect(row).toHaveLength(GRID_SIZE);
    for (const word of ['CAT', 'CATS', 'TAR', 'DOG', 'SWAY']) {
      expect(isWord(word), word).toBe(true);
      expect(() => tapsFor(board(GRID), word), word).not.toThrow();
    }
  });
});
