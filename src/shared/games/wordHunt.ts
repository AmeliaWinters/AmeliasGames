import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { WORDS, isWord } from './words.js';
import {
  CELL_COUNT,
  MAX_WORD,
  MIN_WORD,
  ROUND_MS,
  areAdjacent,
  canAct,
  countOf,
  isLegalPath,
  maskWord,
  scoreOf,
  spell,
  timeIsUp,
} from './wordHuntDisplay.js';

import type { WhMove, WhState } from './wordHuntDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word list.
export {
  CELL_COUNT,
  GRID_SIZE,
  MASK_CHAR,
  MAX_WORD,
  MIN_WORD,
  ROUND_MS,
  areAdjacent,
  canAct,
  canExtend,
  cellAt,
  countOf,
  formatClock,
  hasStarted,
  isLegalPath,
  isMasked,
  maskWord,
  msLeft,
  scoreOf,
  spell,
  timeIsUp,
  wordScore,
} from './wordHuntDisplay.js';
export type { WhMove, WhState } from './wordHuntDisplay.js';

/**
 * Word Hunt. One 4x4 grid, everybody hunting it at once, tracing words through
 * touching letters. Biggest score wins.
 *
 * Four things are worth knowing before reading on:
 *
 * 1. **Nobody waits.** Play is free-simultaneous, like Word Duel: any seat may
 *    submit a word at any time. `turn` reports whoever is still hunting purely
 *    as a hint for the status line — `applyMove` never consults it, and
 *    anything deciding whether a player may act must ask `canAct`.
 *
 * 2. **Length is the whole of the scoring**, and it climbs faster than length
 *    does — see `wordScore`. Words run from three letters to eight, which is
 *    also exactly what the dictionary holds, so there is no trace a player can
 *    draw that the list was never going to take.
 *
 * 3. **The grid is built to be beatable.** A random bag of letters is usually
 *    a grid with nothing in it, so `setup` plants real words along real paths
 *    first and only then fills the gaps — and throws the grid away and starts
 *    again until it holds enough words to be worth playing.
 *
 * 4. **The round is two minutes long**, and the server's clock is the only one
 *    that counts. `start` stamps `endsAt` on the room's first tick after the
 *    deal, not inside `setup` — the two happen a moment apart, and the clock
 *    belongs to the one the room controls. `found` refuses anything arriving
 *    after it, and `expire`
 *    settles the game when it passes, which the room calls off a timer so the
 *    hunt ends on time even with nobody watching. A client counting down is
 *    showing the player a number, not deciding anything.
 */

/** The list as an array, so a word can be drawn by index while planting. */
const WORD_LIST: readonly string[] = [...WORDS];

/**
 * Every proper prefix of every word, so the solver can abandon a path the
 * moment it spells something no word starts with. This is what makes the
 * search affordable at all: a 4x4 grid has millions of paths eight cells long,
 * and almost none of them survive three letters.
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
    if (spelt.length >= MIN_WORD && WORDS.has(spelt)) found.add(spelt);
    // A word can carry on into a longer one — CAT into CATS — so this checks
    // the prefix set after taking the word, not instead of taking it.
    if (spelt.length === MAX_WORD || !stems.has(spelt)) return;

    path.push(cell);
    for (const neighbour of NEIGHBOURS[cell]) {
      if (!path.includes(neighbour)) walk(neighbour, spelt);
    }
    path.pop();
  }

  for (let cell = 0; cell < CELL_COUNT; cell++) walk(cell, '');
  return [...found].sort();
}

/** A long word is six letters or more: the ones worth hunting *for*. */
const LONG_WORD = 6;

/**
 * How good a grid is, in one number. Not the word count: three-letter words
 * are dense enough on any grid that counting them measures very little, and a
 * grid with three hundred of them and nothing longer is a grid that plays like
 * a typing exercise. What a hunt needs is long words to be *found*, so those
 * are what this weighs.
 */
function richness(words: readonly string[]): number {
  return words.filter((word) => word.length >= LONG_WORD).length;
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
  const ENOUGH = 15;
  const TRIES = 20;

  let best: string[] = [];
  let bestScore = -1;

  for (let attempt = 0; attempt < TRIES; attempt++) {
    const grid: Array<string | null> = Array(CELL_COUNT).fill(null);
    for (let i = 0; i < PLANTS; i++) plant(grid, pick(WORD_LIST, rng), rng);

    const filled = grid.map((letter) => letter ?? pick(BAG, rng));
    const score = richness(solve(filled));
    if (score > bestScore) {
      best = filled;
      bestScore = score;
    }
    if (score >= ENOUGH) return filled;
  }

  // Twenty grids and none of them rich: play the best of them rather than
  // looping forever. Every one of them still holds the words that were planted.
  return best;
}

function isOver(state: WhState): boolean {
  return state.phase === 'over';
}

/**
 * The biggest score wins; a tie at the top is a draw, however many are in it.
 * Nothing breaks a tie by who finished first — under free-simultaneous play
 * that would hand the game to the faster typist rather than the better hunter,
 * and nothing breaks it on word count either, because a player who found one
 * seven-letter word has not lost to one who found two threes.
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
  return {
    ...state,
    phase: 'over',
    // Nobody is still hunting a game that has ended, whether they stopped
    // themselves or the clock stopped them. Leaving a seat marked as hunting
    // in a finished game is a state that says two contradictory things.
    done: state.done.map(() => true),
    winner,
    draw,
    solutions: solve(state.grid),
  };
}

function found(state: WhState, path: unknown, seat: number, now: number): MoveResult<WhState> {
  if (timeIsUp(state, now)) return { ok: false, error: "Time — that one didn't count." };
  if (!canAct(state, seat)) {
    return {
      ok: false,
      error: isOver(state) ? 'The game is already over.' : 'You have finished hunting.',
    };
  }
  if (!Array.isArray(path) || !isLegalPath(path)) {
    return {
      ok: false,
      error: `Trace ${MIN_WORD} to ${MAX_WORD} touching letters, using each one once.`,
    };
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
      // Unset: the room stamps it on the tick that follows the deal.
      endsAt: null,
      solutions: [],
      winner: null,
      draw: false,
    };
  },

  /**
   * The whistle. Idempotent, because `tick` runs on every message the room
   * handles and only the first of them may set the clock — otherwise every
   * word anybody found would buy the table another two minutes.
   */
  start(state, now) {
    if (state.phase !== 'play' || state.endsAt !== null) return null;
    return { ...state, endsAt: now + ROUND_MS };
  },

  applyMove(state, move, seat, _rng, now = Date.now()): MoveResult<WhState> {
    if (seat < 0 || seat >= state.done.length) return { ok: false, error: 'You are not playing.' };
    if (!move) return { ok: false, error: 'Unknown move.' };
    if (move.type === 'found') return found(state, move.path, seat, now);
    if (move.type === 'done') return stop(state, seat);
    return { ok: false, error: 'Unknown move.' };
  },

  /** The hunt is on a clock, once it has started. */
  deadline(state) {
    return state.phase === 'play' ? state.endsAt : null;
  },

  /**
   * Time. Settles the game exactly as the last player stopping would, so a
   * round that runs out and a round everyone finished early end up in the same
   * shape — same answer key, same result, one code path deciding both.
   */
  expire(state, now) {
    return timeIsUp(state, now) ? finish(state) : null;
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
        const score = scoreOf(state, state.winner);
        const count = countOf(state, state.winner);
        return `${nameFor(state.winner)} wins on ${score} — ${count} ${
          count === 1 ? 'word' : 'words'
        }`;
      }
      const score = scoreOf(state, 0);
      return score === 0
        ? 'A draw. Nobody found a thing.'
        : `A draw — ${score} each`;
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
   * They arrive masked rather than dropped, so the count and the score both
   * survive — a mask is as long as the word it stands for, and length is what
   * a word is worth. Watching an opponent's total climb while you are stuck is
   * most of the tension in this game, and it gives away nothing but the shape.
   *
   * The answer key is empty until the game is over, by construction — nothing
   * computes it before then.
   */
  view(state, seat) {
    if (state.phase === 'over') return state;
    return {
      ...state,
      found: state.found.map((words, index) =>
        index === seat ? words : words.map(maskWord),
      ),
    };
  },
};
