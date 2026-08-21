import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { WORDS, isWord } from './words.js';
import {
  CELL_COUNT,
  HIDDEN,
  WORD_LENGTH,
  areAdjacent,
  canAct,
  isLegalPath,
  scoreOf,
  spell,
} from './wordHuntDisplay.js';

import type { WhMove, WhState } from './wordHuntDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word list.
export {
  CELL_COUNT,
  GRID_SIZE,
  HIDDEN,
  WORD_LENGTH,
  areAdjacent,
  canAct,
  canExtend,
  cellAt,
  isLegalPath,
  scoreOf,
  spell,
} from './wordHuntDisplay.js';
export type { WhMove, WhState } from './wordHuntDisplay.js';

/**
 * Word Hunt. One 4x4 grid, everybody hunting it at once, tracing words through
 * touching letters. Most words wins.
 *
 * Three things are worth knowing before reading on:
 *
 * 1. **Nobody waits.** Play is free-simultaneous, like Word Duel: any seat may
 *    submit a word at any time. `turn` reports whoever is still hunting purely
 *    as a hint for the status line — `applyMove` never consults it, and
 *    anything deciding whether a player may act must ask `canAct`.
 *
 * 2. **Every word is five letters**, because the dictionary this repo carries
 *    is the five-letter one Word Duel validates against. That is why a word is
 *    worth one point rather than a length-scaled score: with one length there
 *    is nothing for length to reward, and counting words is a score a player
 *    can keep in their head mid-hunt.
 *
 * 3. **The grid is built to be beatable.** A random bag of letters is usually
 *    a grid with nothing in it, so `setup` plants real words along real paths
 *    first and only then fills the gaps — and throws the grid away and starts
 *    again until it holds enough words to be worth playing.
 */

/** The list as an array, so a word can be drawn by index while planting. */
const WORD_LIST: readonly string[] = [...WORDS];

/**
 * Every proper prefix of every word, so the solver can abandon a path the
 * moment it spells something no word starts with. Without it the search walks
 * every path on the grid; with it, a small fraction of them.
 *
 * Built on first use rather than at import: it is only ever needed by a grid
 * being dealt or a game ending, and paying for it at module load would tax
 * every server start for a game nobody may play.
 */
let prefixCache: Set<string> | null = null;
function prefixes(): Set<string> {
  if (prefixCache === null) {
    prefixCache = new Set<string>();
    for (const word of WORD_LIST) {
      for (let i = 1; i < word.length; i++) prefixCache.add(word.slice(0, i));
    }
  }
  return prefixCache;
}

/** Neighbours of every cell, worked out once — the grid never changes shape. */
const NEIGHBOURS: readonly number[][] = Array.from({ length: CELL_COUNT }, (_, cell) =>
  Array.from({ length: CELL_COUNT }, (_, other) => other).filter((other) =>
    areAdjacent(cell, other),
  ),
);

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/**
 * The letters that fill the gaps between planted words. Weighted roughly by
 * how often English uses them, with the vowels leaned on a little harder than
 * that: a grid short of vowels has nothing findable in it, and from where the
 * player is sitting that is indistinguishable from being stuck.
 *
 * Q is absent on purpose. It is the one letter that arrives needing a U beside
 * it, and a dead corner is worse than a slightly untrue alphabet.
 */
const BAG = 'AAAAEEEEIIIOOOUURRSSTTLLNNDDCCMMPPHHGGBFYKVWXJZ'.split('');

/**
 * Lay `word` along some path of touching cells, writing into `grid` only where
 * a cell is empty or already holds the letter that belongs there — so words
 * cross and share letters the way they do in a real grid.
 *
 * Best-effort by design: it tries a bounded number of random walks and gives
 * up. Callers plant into a grid that is mostly empty and check the result
 * afterwards, so a failure here costs a word rather than the grid.
 */
function plant(grid: Array<string | null>, word: string, rng: Rng): boolean {
  const ATTEMPTS = 40;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const starts = Array.from({ length: CELL_COUNT }, (_, i) => i).filter(
      (cell) => grid[cell] === null || grid[cell] === word[0],
    );
    if (starts.length === 0) return false;

    const path = [pick(starts, rng)];
    while (path.length < word.length) {
      const letter = word[path.length];
      const open = NEIGHBOURS[path[path.length - 1]].filter(
        (cell) => !path.includes(cell) && (grid[cell] === null || grid[cell] === letter),
      );
      if (open.length === 0) break;
      path.push(pick(open, rng));
    }

    if (path.length === word.length) {
      path.forEach((cell, i) => {
        grid[cell] = word[i];
      });
      return true;
    }
  }

  return false;
}

/**
 * Every word the grid holds. Depth-first from each cell, pruned against the
 * prefix set, deduplicated because the same word is often traceable more than
 * one way — and a word found twice is still one word.
 */
export function solve(grid: readonly string[]): string[] {
  const stems = prefixes();
  const found = new Set<string>();
  const path: number[] = [];

  function walk(cell: number, sofar: string): void {
    const spelt = sofar + grid[cell];
    if (spelt.length === WORD_LENGTH) {
      if (WORDS.has(spelt)) found.add(spelt);
      return;
    }
    if (!stems.has(spelt)) return;

    path.push(cell);
    for (const neighbour of NEIGHBOURS[cell]) {
      if (!path.includes(neighbour)) walk(neighbour, spelt);
    }
    path.pop();
  }

  for (let cell = 0; cell < CELL_COUNT; cell++) walk(cell, '');
  return [...found].sort();
}

/**
 * A grid worth playing. Words are planted first — five of them, which is more
 * than will usually fit — and the gaps filled afterwards, which tends to throw
 * up a good few words nobody planted.
 *
 * The result is then checked and thrown away if it is thin. That check is the
 * point of the whole function: "nothing left to find" and "nothing left that I
 * can see" feel identical from the player's side, and only one of them is fair.
 */
export function makeGrid(rng: Rng): string[] {
  const PLANTS = 5;
  const ENOUGH = 12;
  const TRIES = 30;

  let best: string[] = [];
  let bestCount = -1;

  for (let attempt = 0; attempt < TRIES; attempt++) {
    const grid: Array<string | null> = Array(CELL_COUNT).fill(null);
    for (let i = 0; i < PLANTS; i++) plant(grid, pick(WORD_LIST, rng), rng);

    const filled = grid.map((letter) => letter ?? pick(BAG, rng));
    const count = solve(filled).length;
    if (count > bestCount) {
      best = filled;
      bestCount = count;
    }
    if (count >= ENOUGH) return filled;
  }

  // Thirty grids and none of them rich: play the best of them rather than
  // looping forever. Every one of them still holds the words that were planted.
  return best;
}

function isOver(state: WhState): boolean {
  return state.phase === 'over';
}

/**
 * Most words wins; a tie at the top is a draw, however many are in it. Nothing
 * breaks a tie by who finished first — under free-simultaneous play that would
 * hand the game to the faster typist rather than the better hunter.
 */
function decide(state: WhState): { winner: number | null; draw: boolean } {
  const scores = state.found.map((_, seat) => scoreOf(state, seat));
  const top = Math.max(...scores);
  const leaders = scores.flatMap((score, seat) => (score === top ? [seat] : []));
  return leaders.length === 1 ? { winner: leaders[0], draw: false } : { winner: null, draw: true };
}

/**
 * Close the game: settle the result, and fill in the answer key. The key is
 * computed here rather than at setup so it is never sitting in the state
 * waiting for a `view()` bug to hand it to somebody mid-hunt.
 */
function finish(state: WhState): WhState {
  const { winner, draw } = decide(state);
  return { ...state, phase: 'over', winner, draw, solutions: solve(state.grid) };
}

function found(state: WhState, path: unknown, seat: number): MoveResult<WhState> {
  if (!canAct(state, seat)) {
    return {
      ok: false,
      error: isOver(state) ? 'The game is already over.' : 'You have finished hunting.',
    };
  }
  if (!Array.isArray(path) || !isLegalPath(path)) {
    return { ok: false, error: `Trace ${WORD_LENGTH} touching letters, using each one once.` };
  }

  const word = spell(state.grid, path);
  if (!isWord(word)) return { ok: false, error: `${word} is not in the word list.` };
  if (state.found[seat].includes(word)) {
    return { ok: false, error: `You already have ${word}.` };
  }

  const all = state.found.map((words, index) => (index === seat ? words.concat(word) : words));
  return { ok: true, state: { ...state, found: all } };
}

function stop(state: WhState, seat: number): MoveResult<WhState> {
  if (!canAct(state, seat)) {
    return {
      ok: false,
      error: isOver(state) ? 'The game is already over.' : 'You are already finished.',
    };
  }

  const done = state.done.map((flag, index) => (index === seat ? true : flag));
  const next: WhState = { ...state, done };
  return { ok: true, state: done.every(Boolean) ? finish(next) : next };
}

export const wordHunt: GameDefinition<WhState, WhMove> = {
  id: GAME_MANIFEST.wordhunt.id,
  name: GAME_MANIFEST.wordhunt.name,
  minPlayers: GAME_MANIFEST.wordhunt.minPlayers,
  maxPlayers: GAME_MANIFEST.wordhunt.maxPlayers,

  setup(playerCount, rng): WhState {
    return {
      phase: 'play',
      grid: makeGrid(rng),
      found: Array.from({ length: playerCount }, () => []),
      done: Array(playerCount).fill(false),
      solutions: [],
      winner: null,
      draw: false,
    };
  },

  applyMove(state, move, seat): MoveResult<WhState> {
    if (seat < 0 || seat >= state.done.length) return { ok: false, error: 'You are not playing.' };
    if (!move) return { ok: false, error: 'Unknown move.' };
    if (move.type === 'found') return found(state, move.path, seat);
    if (move.type === 'done') return stop(state, seat);
    return { ok: false, error: 'Unknown move.' };
  },

  /**
   * A hint for the status line only — see the note at the top of this file.
   * The lowest seat still hunting, so this stays a pure function of the state.
   */
  turn(state) {
    if (isOver(state)) return null;
    const waiting = state.done.findIndex((flag) => !flag);
    return waiting === -1 ? null : waiting;
  },

  isOver,

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    if (state.phase === 'over') {
      if (state.winner !== null) {
        const count = scoreOf(state, state.winner);
        return `${nameFor(state.winner)} wins with ${count} ${count === 1 ? 'word' : 'words'}`;
      }
      const count = scoreOf(state, 0);
      return count === 0
        ? 'A draw. Nobody found a thing.'
        : `A draw — ${count} ${count === 1 ? 'word' : 'words'} each`;
    }

    const hunting = state.done.flatMap((flag, seat) => (flag ? [] : [seat]));
    if (hunting.length === state.done.length) return 'Everyone is hunting';
    if (hunting.length === 1) return `Waiting on ${nameFor(hunting[0])}`;
    return `Waiting on ${hunting.length} players`;
  },

  /**
   * The grid is open — it is the same sixteen letters for everyone, and that
   * is the game. What is hidden is the one thing worth hiding: which words
   * somebody else has already found, since a list of their words is a list of
   * yours for the copying.
   *
   * They arrive as `HIDDEN` rather than being dropped, so the count survives.
   * Watching an opponent's tally climb while you are stuck is most of the
   * tension in this game, and it gives away nothing.
   *
   * The answer key is empty until the game is over, by construction — nothing
   * computes it before then.
   */
  view(state, seat) {
    if (state.phase === 'over') return state;
    return {
      ...state,
      found: state.found.map((words, index) =>
        index === seat ? words : words.map(() => HIDDEN),
      ),
    };
  },
};
