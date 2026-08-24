import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { pick } from './random.js';
import { allWords, isWord } from './words.js';
import {
  CELL_COUNT,
  MAX_WORD,
  MIN_WORD,
  blockedBy,
  canAct,
  claim,
  isFull,
  isLegalPath,
  spell,
  tally,
  unclaimed,
} from './letterpressDisplay.js';

import type { LpMove, LpState, Owner } from './letterpressDisplay.js';

// Re-exported so the reducer, its tests and the server name a game from one
// place, while only this file ever reaches the word list.
export {
  CELL_COUNT,
  GRID_SIZE,
  MAX_WORD,
  MIN_WORD,
  blockedBy,
  canAct,
  canExtend,
  cellAt,
  claim,
  flips,
  isFull,
  isLegalPath,
  isLocked,
  neighbours,
  spell,
  tally,
  unclaimed,
} from './letterpressDisplay.js';
export type { LpMove, LpState, Owner } from './letterpressDisplay.js';

/**
 * Letterpress. One 5x5 grid of letters, two players, and every tile you use
 * turns your colour — including the ones your opponent had already taken.
 *
 * Four things are worth knowing before reading on:
 *
 * 1. **There is no adjacency.** A word is built from any tiles anywhere on the
 *    grid. That is the whole difference between this and Word Hunt, and it is
 *    why the two share no geometry: here the board is a bag of letters that
 *    happens to be arranged in a square, and the square only matters for the
 *    one rule below.
 *
 * 2. **The square matters for defence.** A tile with every orthogonal
 *    neighbour held by its own owner is locked: it still spells, but it cannot
 *    be taken. That is the only protection in the game, and building it is the
 *    positional half of what looks like a word game.
 *
 * 3. **Every tile is judged before any tile turns** — see `claim` in
 *    `letterpressDisplay.ts`. Otherwise the order of the letters within a word
 *    would decide what the word took.
 *
 * 4. **The game ends when the grid is full**, and the count of tiles is the
 *    result. Nothing is banked along the way: a player twenty tiles up can
 *    lose the last one, which is the reason a comeback stays live to the end
 *    and the reason the best word is so often not the right move.
 *
 * Strictly alternating and open-information: no clock, no `view()`, and the
 * `rng` is used once, to deal the grid.
 */

/**
 * The letters that fill the grid. Weighted roughly by how often English uses
 * them, leaning on the vowels harder than that.
 *
 * Word Hunt has a bag of its own and the two are deliberately not shared. Its
 * grid is sixteen letters that have to spell words *along a path*, so it is
 * tuned to keep a vowel within reach of everywhere. This one is twenty-five
 * letters with no adjacency at all, so the whole grid is one pool and what
 * matters instead is the tail: a bag with several of the awkward consonants in
 * it leaves tiles that will still be unclaimed at the end, and the last tiles
 * on the board decide games here. So the tail is thinner than English's.
 *
 * Q is absent for the same reason it is absent there — it arrives needing a U
 * beside it, and a dead tile is worse than a slightly untrue alphabet.
 */
const BAG = 'AAAAAEEEEEEIIIIOOOOUURRRSSSTTTLLLNNNDDCCMMPPHHGGBBFFYYKVWXJZ'.split('');

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

/**
 * How many vowels a playable grid holds. Not a tuning knob so much as a floor
 * and a ceiling on a grid nobody can do anything with: under seven and there
 * are no long words in twenty-five tiles, over eleven and there are no
 * consonants to hang them on. The bag lands inside this range most of the
 * time; the range exists for the deal that does not.
 */
const MIN_VOWELS = 7;
const MAX_VOWELS = 11;

/**
 * The lengths a planted seed word may be — long enough to be worth planting,
 * short enough to leave a grid.
 *
 * The ceiling used to be the dictionary's, back when the list stopped at
 * eight; now that it runs to twenty-five it has to be written down, and eight
 * is the number it was. A planted word is dealt into the grid whole, so a
 * fifteen-letter seed would be three fifths of the board arriving pre-spelt
 * and the same word every game for both players to race to.
 */
const SEED_MIN = 7;
const SEED_MAX = 8;

/**
 * The seven- and eight-letter words as an array, so one can be drawn by index.
 * Built on first use for the reason Word Hunt's list is: work done at import
 * taxes every server start for a game nobody in the room may play.
 */
let seedCache: readonly string[] | null = null;
function seedWords(): readonly string[] {
  if (seedCache === null) {
    const out: string[] = [];
    for (const word of allWords()) {
      if (word.length >= SEED_MIN && word.length <= SEED_MAX) out.push(word);
    }
    seedCache = out;
  }
  return seedCache;
}

/**
 * The length at which a word is worth counting when judging a grid.
 *
 * Five and up, because three- and four-letter words are dense on any
 * twenty-five tiles — with no adjacency to get in the way, a grid with a
 * couple of vowels in it holds hundreds of them, so counting them measures
 * nothing at all. What a game of this needs is words long enough to take a
 * defended shape apart, and those are what get weighed.
 */
const LONG_WORD = 5;

const A = 'A'.charCodeAt(0);

/**
 * How many of each letter a set of tiles holds, as twenty-six counts indexed
 * from A.
 *
 * An array rather than the obvious `Map<string, number>` because of what uses
 * it: `spellableFrom` copies the pool once per dictionary word, and the
 * dictionary is a third of a million words long. Twenty-six bytes copy for
 * a fraction of what a Map of twenty-five string keys costs: one full sweep of
 * the list went from about 340ms to about 15ms when the list grew to a third
 * of a million words, which is the difference between a bad deal costing a
 * blink and costing three seconds of somebody's game starting.
 */
function counts(letters: readonly string[]): Int8Array {
  const out = new Int8Array(26);
  for (const letter of letters) out[letter.charCodeAt(0) - A] += 1;
  return out;
}

/** Whether these tiles can spell this word, each tile used at most once. */
function spellable(pool: Int8Array, word: string): boolean {
  const left = Int8Array.from(pool);
  for (let i = 0; i < word.length; i++) {
    const at = word.charCodeAt(i) - A;
    if (at < 0 || at > 25 || left[at] === 0) return false;
    left[at] -= 1;
  }
  return true;
}

/**
 * Every word these tiles can spell, at `minLength` or longer, lazily.
 *
 * The dictionary is walked as the set it already is rather than copied into an
 * array first — the caller either counts these or takes a handful, and neither
 * wants a hundred and fifty thousand strings spread out to do it.
 */
function* spellableFrom(grid: readonly string[], minLength: number): Generator<string> {
  const pool = counts(grid);
  for (const word of allWords()) {
    // The list runs to twenty-five letters for this game's sake, and the tail
    // of it cannot be spelt from a grid that has already spent tiles — but the
    // length test is a number compare and `spellable` is not, so it goes here.
    if (word.length < minLength || word.length > grid.length) continue;
    if (spellable(pool, word)) yield word;
  }
}

/**
 * Long words the grid can spell, counted up to `cap`.
 *
 * Capped rather than totalled because the count itself is never wanted — the
 * only question is "enough or not", and stopping at the answer turns a sweep
 * of a hundred and fifty thousand words into a few hundred for any grid that
 * is fine. Exported for the test that holds this promise.
 */
export function richness(grid: readonly string[], cap = Infinity): number {
  let found = 0;
  for (const _ of spellableFrom(grid, LONG_WORD)) {
    found += 1;
    if (found >= cap) break;
  }
  return found;
}

/**
 * Words that could be played on this grid right now: spellable from the tiles,
 * and not shut out by something already played.
 *
 * Nothing in the running game asks this — the players are the ones who find
 * words, and a reducer that could enumerate them would be a hint feature
 * nobody has asked for. It exists for the playout test, which has to be able
 * to move in order to prove the game ends, and it is here rather than in the
 * test because it needs the dictionary sweep above and duplicating that would
 * mean the test measuring a copy of the thing rather than the thing.
 */
export function playable(
  grid: readonly string[],
  played: readonly string[],
  limit = Infinity,
  minLength = MIN_WORD,
): string[] {
  const out: string[] = [];
  for (const word of spellableFrom(grid, Math.max(minLength, MIN_WORD))) {
    if (blockedBy(played, word) !== null) continue;
    out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

function shuffle(letters: string[], rng: Rng): string[] {
  const out = letters.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * One deal: a long word's letters, the rest from the bag, the vowel count
 * dragged into range, and the lot shuffled so the planted word is not sitting
 * along the top row.
 *
 * The seed word is the cheap half of making a grid playable. Twenty-five tiles
 * drawn at random will spell plenty of five-letter words, but a *seven*-letter
 * word — the thing that takes a defended corner apart in one turn — is not
 * guaranteed by any letter distribution, and one is guaranteed here by
 * construction.
 */
function deal(rng: Rng): string[] {
  const seeds = seedWords();
  const letters = seeds[pick(rng, seeds.length)].toUpperCase().split('');
  const planted = letters.length;
  while (letters.length < CELL_COUNT) letters.push(BAG[pick(rng, BAG.length)]);

  // Redraw individual tiles rather than the whole grid: a grid two vowels
  // short is two tiles from being fine. Only the filled tail is fair game —
  // the seed word sits at the front and its letters are the point of it, so
  // the swap that fixes the vowel count must not spell it away.
  for (let guard = 0; guard < CELL_COUNT * 4; guard++) {
    const vowels = letters.filter((letter) => VOWELS.has(letter)).length;
    if (vowels >= MIN_VOWELS && vowels <= MAX_VOWELS) break;
    const wanted = vowels < MIN_VOWELS;
    const at = planted + pick(rng, CELL_COUNT - planted);
    // Already the kind of tile we are short of: swapping it would move the
    // count the wrong way.
    if (VOWELS.has(letters[at]) === wanted) continue;
    let replacement = BAG[pick(rng, BAG.length)];
    for (let tries = 0; tries < 20 && VOWELS.has(replacement) !== wanted; tries++) {
      replacement = BAG[pick(rng, BAG.length)];
    }
    letters[at] = replacement;
  }

  return shuffle(letters, rng);
}

/**
 * A grid worth playing: dealt, then measured, then dealt again if it is thin.
 *
 * The measure is the point of the function. "Nothing left to play" and
 * "nothing left that I can see" feel identical from the player's side, and
 * only one of them is fair — and in this game a thin grid is worse than in
 * Word Hunt, because a player who cannot find a word does not merely score
 * nothing, they hand the board over untouched.
 */
export function makeGrid(rng: Rng): string[] {
  /*
    A floor, not a target. Twenty-five tiles with no adjacency are enormously
    rich — forty measured deals ran from 766 long words to 26,429, median
    9,006 — so this passes on the first deal essentially always, and the cap in
    `richness` means the count stops at 400 and the whole check costs under a
    millisecond. What it is for is the deal that goes wrong: a bag that comes
    up all tail, or a vowel fix that could not find one. Those grids exist and
    they are unplayable, and this is cheap enough to keep looking for them.
  */
  const ENOUGH = 400;
  const TRIES = 8;

  let best: string[] = [];
  let bestScore = -1;

  for (let attempt = 0; attempt < TRIES; attempt++) {
    const grid = deal(rng);
    const score = richness(grid, ENOUGH);
    if (score > bestScore) {
      best = grid;
      bestScore = score;
    }
    if (score >= ENOUGH) return grid;
  }

  // Eight deals and none of them rich: play the best of them rather than
  // looping forever. Every one of them still holds its seed word.
  return best;
}

function isOver(state: LpState): boolean {
  return state.winner !== null || state.draw;
}

function other(seat: 0 | 1): 0 | 1 {
  return seat === 0 ? 1 : 0;
}

/**
 * Settle the game on the count of tiles. The only ending there is: a full grid
 * settles it, and so does a turn nobody could move in.
 */
function finish(state: LpState): LpState {
  const [zero, one] = tally(state);
  return {
    ...state,
    winner: zero === one ? null : zero > one ? 0 : 1,
    draw: zero === one,
  };
}

function play(state: LpState, path: unknown, mover: 0 | 1): MoveResult<LpState> {
  if (!Array.isArray(path) || !isLegalPath(path)) {
    return { ok: false, error: `Tap ${MIN_WORD} to ${MAX_WORD} different tiles.` };
  }

  const word = spell(state.grid, path);
  if (!isWord(word)) return { ok: false, error: `${word} is not in the word list.` };

  const spent = blockedBy(state.played, word);
  if (spent !== null) {
    return {
      ok: false,
      error:
        spent === word
          ? `${word} has already been played.`
          : `${word} is out — ${spent} has been played.`,
    };
  }

  const owner = claim(state.owner, path, mover);
  const next: LpState = {
    ...state,
    owner,
    played: state.played.concat(word),
    words: state.words.map((mine, seat) => (seat === mover ? mine.concat(word) : mine)),
    turn: other(mover),
    lastWord: word,
    lastPlay: path.slice(),
    // A word played is a board that has moved, so whatever standoff the last
    // pass started is over.
    passes: 0,
    moveCount: state.moveCount + 1,
  };

  return { ok: true, state: isFull(next) ? finish(next) : next };
}

/**
 * Nothing to play. Not a rule of Letterpress as it is usually written, and
 * here for a reason that is: without it, two players who between them cannot
 * find a word on the tiles that are left sit in a room that will never end.
 * That is rare and it is not impossible, and "rare" is not a plan.
 *
 * It takes both of you, one after the other, which is what keeps it from being
 * a way to bank a lead: a player who is ahead can offer to stop, and the one
 * who is behind simply plays on.
 */
function pass(state: LpState): MoveResult<LpState> {
  const next: LpState = {
    ...state,
    turn: other(state.turn),
    // Nothing was played, so nothing is the last thing played. Leaving the
    // previous word marked would have the board pointing at a move that is now
    // two turns old.
    lastWord: null,
    lastPlay: null,
    passes: state.passes + 1,
    moveCount: state.moveCount + 1,
  };
  return { ok: true, state: next.passes >= 2 ? finish(next) : next };
}

export const letterpress: GameDefinition<LpState, LpMove> = {
  id: GAME_MANIFEST.letterpress.id,
  name: GAME_MANIFEST.letterpress.name,
  minPlayers: GAME_MANIFEST.letterpress.minPlayers,
  maxPlayers: GAME_MANIFEST.letterpress.maxPlayers,

  setup(_playerCount, rng): LpState {
    return {
      grid: makeGrid(rng),
      owner: Array<Owner>(CELL_COUNT).fill(null),
      played: [],
      words: [[], []],
      turn: 0,
      lastWord: null,
      lastPlay: null,
      passes: 0,
      winner: null,
      draw: false,
      moveCount: 0,
    };
  },

  applyMove(state, move, seat): MoveResult<LpState> {
    if (isOver(state)) return { ok: false, error: 'The game is already over.' };
    if (seat !== state.turn) return { ok: false, error: "It's not your turn." };
    if (!move) return { ok: false, error: 'Unknown move.' };

    const mover = seat as 0 | 1;
    if (move.type === 'play') return play(state, move.path, mover);
    if (move.type === 'pass') return pass(state);
    return { ok: false, error: 'Unknown move.' };
  },

  turn(state) {
    // Deliberately not `this.isOver` — GameDefinition promises nothing about
    // method binding, so a destructured `turn` would throw.
    return isOver(state) ? null : state.turn;
  },

  canAct,

  isOver,

  status(state, names) {
    const nameFor = (seat: 0 | 1) => names[seat] ?? `Player ${seat + 1}`;
    const [zero, one] = tally(state);

    if (state.winner !== null) {
      const mine = state.winner === 0 ? zero : one;
      const theirs = state.winner === 0 ? one : zero;
      return `${nameFor(state.winner)} wins — ${mine} tiles to ${theirs}`;
    }
    if (state.draw) return `A draw — ${zero} tiles each`;
    if (state.passes === 1) {
      // The one thing more urgent than the score: the game is one move from
      // ending, and it will end on a count the player can see above.
      return `${nameFor(state.turn)} to play — pass again and that is the game`;
    }

    const free = unclaimed(state);
    return `${nameFor(state.turn)} to play — ${zero}–${one}, ${free} ${
      free === 1 ? 'tile' : 'tiles'
    } free`;
  },
};
