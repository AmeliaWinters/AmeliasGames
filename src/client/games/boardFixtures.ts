/**
 * Real states for every game, for the boards to be rendered against.
 *
 * The boards are the least covered code in this repo and the reducers are the
 * best covered, which is backwards: every bug reported here has been a bug in
 * something drawn, not in something decided. `boards.test.tsx` fixes the ratio,
 * and this file is what makes that test worth having -- a board rendered
 * against a hand-written object proves the board survives *that object*, and
 * hand-written objects drift into fiction the moment a reducer gains a field.
 * So nothing here is written by hand. Every state below came out of the game's
 * own `setup` and its own `applyMove`, and a reducer change that a board cannot
 * survive arrives here as a failure rather than as a stale fixture.
 *
 * The walker is deliberately stupid: it *proposes* moves and lets the reducer
 * refuse them. `applyMove` already answers `{ ok: false }` for anything
 * illegal, so a proposer only has to be a superset of the legal moves and never
 * has to be right. That is the difference between thirteen move generators and
 * thirteen reimplementations of thirteen rulebooks, and the second of those
 * would be a second place for the rules to be wrong.
 *
 * What comes out is a handful of states per game rather than the whole walk:
 * see `sample`, which keeps the first state of every phase the walk reached.
 * Phases are where boards change shape, so they are the thing a render test is
 * actually asking about.
 */
import type { GameDefinition, Rng } from '../../shared/types.js';
import { GAMES } from '../../shared/games/index.js';
import { legalMoves as bgLegalMoves } from '../../shared/games/backgammon.js';
import { solve as whSolve } from '../../shared/games/wordHunt.js';
import { areAdjacent } from '../../shared/games/wordHuntDisplay.js';
import { playable as lpPlayable } from '../../shared/games/letterpress.js';
import { duelWords } from '../../shared/games/words.js';
import { commonestStarting } from '../../shared/games/chainDictionary.js';
import { CATEGORIES } from '../../shared/games/yahtzeeDisplay.js';
import { FLEET } from '../../shared/games/battleshipDisplay.js';
import { CHAIN_LEVELS, LANGS } from '../../shared/games/wordChainDisplay.js';
import { GHOST_LANGS, GHOST_SIDES, ghostAlphabet } from '../../shared/games/ghostDisplay.js';

/**
 * A fixed clock, and a fixed one on purpose: three of these games are timed,
 * and a fixture built from `Date.now()` is a fixture whose deadline is a
 * different distance away on every run. Boards that draw a countdown would
 * then be rendered against a different number each time, which is how a test
 * that passes today fails on a slow morning in December.
 */
export const NOW = 1_700_000_000_000;

/** Enough of the round left that a timed game is mid-play rather than expiring. */
const MID_ROUND = NOW + 5_000;

/**
 * The same seeded generator the reducers are tested with, so a fixture is
 * reproducible: `setup` draws grids, decks and puzzles from this, and a real
 * `Math.random` would mean a board was rendered against a different Word Hunt
 * grid every run and a failure nobody could reproduce.
 */
function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** One state, and what to call it when it is the one that failed. */
export interface Fixture {
  /** `wordle: play` -- the game and the phase it was caught in. */
  name: string;
  /** Unredacted. The test applies `view()` itself, once per seat. */
  state: unknown;
  /** How many seats were dealt in. */
  seats: number;
  /**
   * The server clock this state was reached at, which a timed board must be
   * given rather than left to `Date.now()`. It moves: see the clock in `walk`.
   */
  now: number;
}

/** Moves a seat might make. Wrong ones are free; see the note at the top. */
type Propose = (state: any, seat: number, now: number) => unknown[];

/**
 * How far a walk is allowed to run before it gives up on reaching the end.
 *
 * Generous rather than tuned, because it is a budget and not a rule, and the
 * cost of it is a second of test time against a phase nobody would otherwise
 * see drawn. Vocab Race sets the floor: it ends at a hundred points, scored
 * four at a time by a walker choosing at random from four options, and a
 * budget that stopped short of that left its endgame screen untested.
 */
const STEPS = 900;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * A word from the grid, as the path that spells it.
 *
 * Word Hunt's move is the trace and not the word, so knowing that BLADE is on
 * the board is not yet a move: the cells have to be walked. Depth-first from
 * every cell bearing the first letter, which is the same search `solve` runs
 * and is cheap enough at sixteen cells to run for real rather than be faked.
 */
function tracePath(grid: readonly string[], word: string): number[] | null {
  const walk = (at: number, i: number, used: number[]): number[] | null => {
    if (i === word.length) return used;
    for (let next = 0; next < grid.length; next++) {
      if (used.includes(next) || !areAdjacent(at, next)) continue;
      if (grid[next] !== word[i]) continue;
      const found = walk(next, i + 1, [...used, next]);
      if (found) return found;
    }
    return null;
  };
  for (let start = 0; start < grid.length; start++) {
    if (grid[start] !== word[0]) continue;
    const found = walk(start, 1, [start]);
    if (found) return found;
  }
  return null;
}

/**
 * The same, for Letterpress, where it is much easier: there is no adjacency in
 * that game, so any tile bearing the letter will do and the only rule is that
 * a tile is used once.
 */
function pickTiles(grid: readonly string[], word: string): number[] | null {
  const used: number[] = [];
  for (const letter of word) {
    const at = grid.findIndex((cell, i) => cell === letter && !used.includes(i));
    if (at === -1) return null;
    used.push(at);
  }
  return used;
}

const PROPOSERS: Record<string, Propose> = {
  connect4: () => Array.from({ length: 7 }, (_, col) => ({ type: 'drop', col })),

  // `roll` first: in the `move` phase it is refused, and in the `roll` phase
  // every move below is, so one list serves both halves of the turn.
  backgammon: (state) => [
    { type: 'roll' },
    ...bgLegalMoves(state).map((m) => ({ type: 'move', from: m.from, die: m.die })),
    { type: 'pass' },
  ],

  // `solve` with the answer off the *unredacted* state is the only way a walk
  // reaches a finished round, and this walker is the one caller entitled to
  // read it: `view()` is what redacts it, and the test applies that afterwards.
  wheel: (state) => [
    { type: 'spin' },
    ...LETTERS.map((letter) => ({ type: 'letter', letter })),
    { type: 'solve', answer: state.answer },
    { type: 'next' },
  ],

  wordle: (state) => {
    const words = [...duelWords()].slice(0, 8);
    return [
      ...words.map((word) => ({ type: 'setWord', word })),
      ...words.map((word) => ({ type: 'guess', word })),
    ];
  },

  yahtzee: () => [
    { type: 'roll' },
    ...[0, 1, 2, 3, 4].map((die) => ({ type: 'hold', die })),
    ...CATEGORIES.map((category) => ({ type: 'score', category })),
  ],

  // `scatter` lays a whole fleet out at once, so the placing phase is one move
  // per seat rather than five, and the walk gets to the firing phase inside its
  // step budget. One hand-placed ship first, so a board that draws a
  // part-placed fleet differently is still rendered in that state.
  battleship: (state) => [
    ...FLEET.map((ship) => ({
      type: 'place', kind: ship.kind, row: 0, col: 0, horizontal: true,
    })),
    { type: 'scatter' },
    ...Array.from({ length: 100 }, (_, i) => ({
      type: 'fire', row: Math.floor(i / 10), col: i % 10,
    })),
  ],

  liarsdice: (state) => {
    const bid = state.bid;
    return [
      { type: 'roll' },
      // One step up from the standing bid, which is the only bid that is legal;
      // an opening bid when there is none.
      bid
        ? { type: 'bid', quantity: bid.quantity + 1, face: bid.face }
        : { type: 'bid', quantity: 1, face: 2 },
      { type: 'challenge' },
      { type: 'exact' },
      { type: 'next' },
    ];
  },

  wordhunt: (state) => {
    const words = whSolve(state.grid).slice(0, 6);
    const paths = words
      .map((word) => tracePath(state.grid, word))
      .filter((path): path is number[] => path !== null);
    return [...paths.map((path) => ({ type: 'found', path })), { type: 'done' }];
  },

  morris: (state) => [
    ...state.board.map((_: unknown, to: number) => ({ type: 'place', to })),
    ...state.board.flatMap((_: unknown, from: number) =>
      state.board.map((__: unknown, to: number) => ({ type: 'move', from, to })),
    ),
    ...state.board.map((_: unknown, at: number) => ({ type: 'take', at })),
  ],

  ultimate: () => Array.from({ length: 81 }, (_, cell) => ({ type: 'play', cell })),

  letterpress: (state) => {
    const words = lpPlayable(state.grid, state.played, 6);
    const paths = words
      .map((word) => pickTiles(state.grid, word))
      .filter((path): path is number[] => path !== null);
    return [...paths.map((path) => ({ type: 'play', path })), { type: 'pass' }];
  },

  wordchain: (state, seat) => {
    const lang = state.langs[seat] ?? 'en';
    const used = new Set<string>(state.chain.map((link: any) => link.key));
    const entry = commonestStarting(lang, state.required ?? '', used);
    return [
      // Levels first, so the walk lands on a seat that has one before it picks
      // a language and setup ends. Every band is proposed and seats take them
      // in order, which is what draws the hint ladder at all: a table all on
      // `fluent` never puts a hint on the screen. See `HINT_AT`.
      ...CHAIN_LEVELS.map((level) => ({ type: 'level', level })),
      ...LANGS.map((l) => ({ type: 'lang', lang: l })),
      ...(entry ? [{ type: 'say', word: entry.word }] : []),
      { type: 'give-up' },
    ];
  },

  // No `guess`: the word behind a `say` round is not on the state at all while
  // the round is running, by design, and a fixture is not the place to reach
  // around that. `pass` and `hint` reach every phase a guess would, and
  // `choose` answers a `pick` round for real.
  //
  // Every level is declared, because a level now decides which *question* a
  // seat is asked (see `LEVEL_ASKS`) and a table all on one of them would
  // never draw the mixed board: one seat choosing from four while the seat
  // beside it types. Seats take these in order, so a room of three gets one of
  // each. `new` is the seat that is given its hint rather than sold one.
  /*
    Every letter on both ends, and no attempt whatever to pick a good one.

    The walker is meant to be stupid (see the top of this file) and here it can
    afford to be completely so: a dead letter is not refused by this reducer,
    it loses the round, which is one of the three screens this game has. So the
    proposer is the keyboard, twice, and both walks reach the reveal -- the
    forward one by finishing a word, the conceding one by giving up. Neither
    needs to know a word of Polish, which is the point: the dictionary is
    server-side and this file is client-side, and `bundle.test.ts` would fail
    the build over an import that fixed that.

    One reveal is out of reach here and it is the same rule that puts it there:
    the walk never *finishes* a word, because building a real four-letter one
    out of a rotating alphabet is luck, and steering it would mean knowing
    which letters spell something, which is the word list. So `ghost.test.ts`
    covers the completed reveal and this covers the other two. Do not fix it by
    importing the dictionary.
  */
  ghost: (state) => [
    ...GHOST_LANGS.map((lang) => ({ type: 'lang', lang })),
    { type: 'begin' },
    { type: 'next' },
    ...GHOST_SIDES.flatMap((side) =>
      [...ghostAlphabet(state.lang)].map((letter) => ({ type: 'play', side, letter })),
    ),
    { type: 'give-up' },
  ],

  vocab: () => [
    { type: 'settings', lang: 'pl', mode: 'normal' },
    { type: 'level', level: 'new' },
    { type: 'level', level: 'some' },
    { type: 'level', level: 'fluent' },
    { type: 'begin' },
    ...[0, 1, 2, 3].map((option) => ({ type: 'choose', option })),
    { type: 'hint' },
    { type: 'pass' },
  ],
};

/**
 * How a state is filed. Games name their phase differently -- `phase`, or a
 * pair of booleans, or nothing at all -- so this reads whichever it has and
 * falls back to the coarsest honest answer, which is "playing or finished".
 */
const FACETS: Record<string, (state: any) => string> = {
  /*
    Three games draw a materially different board without changing any field
    called `phase`, and filing by phase alone gave each of them one mid-game
    fixture -- the first one, which for Yahtzee is the screen before the dice
    have been thrown, where every scoring button is correctly disabled. The
    whole scoring half of that board went untested behind a name that said it
    was covered. A facet is not a phase; it is the other thing this board can
    look like.
  */
  yahtzee: (state) => (state.rollsLeft < 3 ? 'rolled' : 'fresh'),
  // The take-a-man screen: same phase, and the only board in the game where
  // tapping an enemy piece is the move.
  morris: (state) => (state.taking !== null ? 'taking' : 'placing-or-moving'),
  // Everyone's dice hit the table at once, so "still owes a throw" is a
  // different screen from "has thrown and is waiting to bid".
  liarsdice: (state) => (state.rolled?.every(Boolean) ? 'all-in' : 'rolling'),
  // The three ways a round ends draw three different panels: a completed word
  // has no escapes under it, and the other two do. Not a phase, they are all
  // `round`, and filing by phase alone covered whichever one the walk happened
  // to reach first.
  ghost: (state) => state.reveals.at(-1)?.reason ?? 'fresh',
  // Sent to a board, or free to play anywhere: the difference is which
  // three-quarters of the board is greyed out.
  ultimate: (state) => (state.sent === null ? 'free' : 'sent'),
};

function phaseOf(def: GameDefinition<any, any>, state: any): string {
  if (def.isOver(state)) return 'over';
  // The Wheel's between-rounds screen is a different board -- the puzzle
  // solved, the money moved, a Next button where the letters were -- and it is
  // not a phase, it is a flag beside one. Phase alone would file it with the
  // calling screen it looks nothing like.
  const round = state.roundOver === true ? '+round-over' : '';
  const facet = FACETS[def.id] ? `/${FACETS[def.id](state)}` : '';
  if (typeof state.phase === 'string') return state.phase + round + facet;
  return 'play' + round + facet;
}

/**
 * Walk a game and keep the first state of each phase it reaches.
 *
 * The cap is a budget rather than a rule: Nine Men's Morris and Ultimate both
 * run for a hundred-odd moves, and the phases a board draws differently all
 * arrive in the first few. A walk that stalls -- every proposal refused for
 * every seat -- stops, and `fixturesFor` holds the result to having reached
 * more than the opening position, so a stall is a failure and not a quiet
 * shrug.
 */
function walk(
  def: GameDefinition<any, any>,
  seats: number,
  seed: number,
  steps: number,
  /**
   * `concede` reverses every proposal list, which is a one-word way of saying
   * "prefer the move that ends things". The concession move is written last in
   * every proposer below -- `pass`, `done`, `give-up`, `next` -- because a walk
   * that reaches for it first never plays the game. But a walk that never
   * reaches for it never *finishes* several of them either: Letterpress ends on
   * two passes or a full grid, and two hundred steps of finding another word is
   * not two hundred steps towards a full grid. So both walks run, and between
   * them a board is rendered against a game played out and a game given up on.
   */
  order: 'forward' | 'concede',
): Fixture[] {
  const rng = seeded(seed);
  let state = def.setup(seats, rng, NOW);
  if (def.start) state = def.start(state, NOW) ?? state;

  /*
    A clock that only ever goes forward, and it is not decoration.

    Three of these games are on one, and in two of them there are states no
    move can reach: Vocab Race's reveal screen is shown *between* rounds and is
    left by the round timer, not by anybody pressing anything, so a walk that
    only ever made moves stopped dead on it and that game's endgame screen was
    never drawn in a test at all. When nothing can move, the walk asks the game
    when it is next due to happen and winds the clock to there. That is the
    same thing the room does, and it is why `expire` is on the contract.
  */
  let clock = MID_ROUND;

  const propose = PROPOSERS[def.id];
  const out: Fixture[] = [];
  const seen = new Set<string>();
  const keep = (s: any) => {
    const phase = phaseOf(def, s);
    if (seen.has(phase)) return;
    seen.add(phase);
    out.push({ name: `${def.id}: ${phase}`, state: s, seats, now: clock });
  };
  keep(state);

  for (let step = 0; step < steps && !def.isOver(state); step++) {
    let moved = false;
    for (let seat = 0; seat < seats && !moved; seat++) {
      if (!def.canAct(state, seat, clock)) continue;
      /*
        Rotated, and this is the whole reason the walk gets anywhere.

        Taking the first proposal the reducer accepts sounds harmless and is
        not: several games here have a move that is *always* legal and changes
        nothing structural -- Vocab Race's `settings`, which the host may send
        as often as they like. A walk that always tried that first sent it two
        hundred times and left the game sitting in setup, so that game's
        fixtures were the opening screen, twice. Rotating the starting point by
        the step number means every proposal is reached and no always-legal
        move can hold the walk still.
      */
      const proposed = propose(state, seat, clock);
      const list = order === 'concede' ? [...proposed].reverse() : proposed;
      // The rotation below is what stops an always-legal move holding the walk
      // still, and it is exactly wrong for a conceding walk: Letterpress ends
      // on two passes *in a row*, and a rotation that offered `pass` on one
      // step and a word on the next meant the conceding walk played the game
      // out like the other one and never reached the final screen.
      const from = order === 'concede' ? 0 : step;
      for (let i = 0; i < list.length; i++) {
        const move = list[(i + from) % list.length];
        const result = def.applyMove(state, move, seat, rng, clock);
        if (!result.ok) continue;
        state = result.state;
        moved = true;
        break;
      }
    }
    if (!moved) {
      const due = def.deadline?.(state) ?? null;
      if (due === null) break;
      clock = Math.max(clock, due) + 1;
      const settled = def.expire?.(state, clock) ?? null;
      if (settled === null) break;
      state = settled;
    }
    keep(state);
  }
  return out;
}

/**
 * Every state this game's board will be asked to draw, at every seat count it
 * can be played at.
 *
 * Both ends of the seat range and nothing in between: the shapes that break are
 * the smallest table and the largest one -- a two-column layout asked to hold
 * six, a six-column one holding two -- and the middle of the range has never
 * been where a board went wrong here.
 */
export function fixturesFor(id: string): Fixture[] {
  const def = GAMES[id];
  if (!def) throw new Error(`no such game: ${id}`);
  if (!PROPOSERS[id]) {
    throw new Error(
      `${id} has no move proposer in boardFixtures.ts, so its board would be ` +
        'rendered against the opening position only. Add one: it may propose ' +
        'illegal moves freely, since the reducer refuses them.',
    );
  }

  const counts = def.minPlayers === def.maxPlayers
    ? [def.minPlayers]
    : [def.minPlayers, def.maxPlayers];

  const out: Fixture[] = [];
  for (const seats of counts) {
    // Two seeds, because one grid is one grid: a Word Hunt board that cannot
    // draw a Q, or a puzzle with an apostrophe in it, is a real bug that a
    // single draw has a good chance of missing.
    for (const seed of [12345, 99991]) {
      const walks = [
        ...walk(def, seats, seed, STEPS, 'forward'),
        ...walk(def, seats, seed, STEPS, 'concede'),
      ];
      for (const fixture of walks) {
        const key = `${fixture.name} x${seats}`;
        if (out.some((f) => `${f.name} x${f.seats}` === key)) continue;
        out.push(fixture);
      }
    }
  }
  return out;
}

/** Games with a board, which is every game the client can deal. */
export function playableIds(): string[] {
  return Object.keys(PROPOSERS);
}
