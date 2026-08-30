import type { GameDefinition, MoveResult, Rng } from "../types.js";
import { GAME_MANIFEST } from "./manifest.js";
import { named } from "../refusal.js";
import { pick } from "./random.js";

/**
 * Wheel of Fortune, for two to four.
 *
 * A hidden phrase, a wheel, and three rounds. On your turn you may spin and
 * name a consonant, buy a vowel out of the money you have won this round, or
 * try to solve. Getting it right keeps the turn, up to three letters, then it
 * moves on anyway; getting it wrong hands it over on the spot. Most money after
 * three rounds wins.
 *
 * The reducer is written for however many seats it is handed. `setup` is given
 * the room's real player count, so nothing here assumes two. `state.bank` is
 * as long as there are players, and the turn walks round it.
 *
 * The part that matters
 *
 * This is the first game here with something to hide, and `view()` is the
 * whole reason it is playable. `state.answer` holds the real phrase, and the
 * server masks it on the way out to each client. Nothing else would do: the
 * client is sent the state, so an answer that reaches it is an answer anyone
 * can read out of devtools. The mask preserves length and punctuation, since a
 * player is meant to know the shape of the phrase, and reveals a letter only
 * once someone has called it.
 *
 * The answer becomes public the moment the round ends, which is what lets the
 * board show what it was.
 *
 * `PUZZLES` is the second half of the same problem: masking the current answer
 * achieves nothing if the client is holding the list it was drawn from, since
 * the shape of the phrase would pick it out. It stays out of the browser
 * because no client module imports a runtime binding from this file: the board
 * takes its values from `wheelDisplay.js` and its types type-only, the lobby
 * reads `manifest.js` rather than the registry, and the room-code helpers live
 * in `roomCode.js` so `App.tsx` never pulls in `room.js` and the registry
 * behind it.
 *
 * That is structure, not bundler luck. An earlier version relied on Rollup
 * shaking the answers back out of a graph that did reach them, which held, but
 * only until someone added one value import. `bundle.test.ts` builds the client
 * and greps it, so the guarantee is checked rather than asserted.
 */

// Constants and the money formatter live in wheelDisplay.ts, which imports
// nothing, so the board can reach them without reaching PUZZLES. Re-exported
// here so the reducer and its tests still import from one place.
import {
  ALPHABET,
  BLANK,
  CONSONANTS,
  FINDS_PER_TURN,
  ROUNDS,
  SOLVE_BONUS,
  VOWELS,
  VOWEL_COST,
  WHEEL,
  money,
  restAfter,
  spinThrow,
  wedgeName,
  wedgeUnder,
} from "./wheelDisplay.js";
import type { Wedge } from "./wheelDisplay.js";

export {
  ALPHABET,
  BLANK,
  CONSONANTS,
  FINDS_PER_TURN,
  ROUNDS,
  SOLVE_BONUS,
  FLICK_GAIN,
  SPIN_DRAG,
  SPIN_MAX_SPEED,
  SPIN_MAX_TRAVEL,
  SPIN_MIN_SPEED,
  SPIN_MIN_TRAVEL,
  VOWELS,
  VOWEL_COST,
  WEDGE_ARC,
  WHEEL,
  isThrow,
  money,
  restAfter,
  spinMs,
  spinThrow,
  wedgeAfter,
  wedgeLabel,
  wedgeName,
  wedgeUnder,
} from "./wheelDisplay.js";
export type { Throw, Wedge } from "./wheelDisplay.js";

/** A hostile client is not owed an unbounded string to normalise. */
const MAX_GUESS = 200;

export interface Note {
  /** Who did the thing, so the board can name them. */
  seat: number;
  /** Reads as a sentence after a name: "Ann spun Bankrupt." */
  text: string;
}

export interface WofState {
  /** 1-based, up to ROUNDS. */
  round: number;
  category: string;
  /**
   * The phrase. Masked by `view()` while the round runs: the one field in the
   * project that is not safe to broadcast as it is.
   */
  answer: string;
  /** Answers already played, so one match never sets the same puzzle twice. */
  used: string[];
  /** Letters called this round, right or wrong, in the order they were called. */
  called: string[];
  /** Who opened the current round. Rounds rotate on from here. */
  starter: number;
  turn: number;
  /** `call` means the wheel has stopped and a consonant is owed. */
  phase: "spin" | "call";
  /**
   * The cash wedge backing a consonant the player still owes, or null when
   * nothing is owed. The *entitlement*, and it is spent: cleared when the
   * letter is called, and when the turn moves on.
   */
  wedge: Wedge | null;
  /**
   * Which wedge the wheel physically stopped on, as an index into `WHEEL`, or
   * null before the first spin of a round.
   *
   * Deliberately not the same field as `wedge` above, and deliberately not
   * cleared when the turn passes: this is where the pointer is, and the board
   * animates to it. Bankrupt ends a turn, and the wheel still has to be seen
   * landing on Bankrupt. Two identical $300 wedges are also why this is an
   * index and not the wedge itself: the board cannot tell them apart, and must
   * spin to the right one.
   */
  wedgeAt: number | null;
  /**
   * Where the flapper actually stands, in wedges of pointer position. See
   * `restAfter`. Fractional, and `wedgeAt` is this rounded.
   *
   * Two fields for what sounds like one fact, because they answer two
   * questions. `wedgeAt` is which wedge came up and what the game is scored on.
   * `rest` is where the wheel physically stopped, and a wheel that only ever
   * stopped on midpoints was the complaint that got this written. It is also
   * the anchor the next throw is measured from, so the fraction is not
   * cosmetic: it carries from spin to spin the way a real rim does.
   */
  rest: number;
  /**
   * Spins so far this game, only ever going up. The board watches it to know
   * a spin has happened at all: two spins running can land on the same wedge,
   * and without this the wheel would sit still on the second one.
   */
  spins: number;
  /**
   * Wedges of rotation the last spin travelled, signed: positive is clockwise,
   * which is the way a finger dragging the top of the rim to the right sends
   * it. So the board can turn the wheel the distance and the direction it was
   * actually thrown rather than a stock number of rotations one way.
   *
   * On the state rather than worked out on the client that flicked, because
   * everyone at the table watches the same spin: the player who threw it is
   * the only one who knows how hard, and the other three would otherwise see a
   * different wheel reach the same wedge. Zero before the first spin.
   *
   * Fractional: a throw carries however far it carries, and rounding it to
   * whole wedges was one of the two reasons every landing sat dead-centre.
   *
   * `restAfter` is the only thing that turns this into `rest`, and it subtracts,
   * because rotation and wedge numbering run opposite ways round.
   */
  travel: number;
  /**
   * Correct letters found by the player to move, this turn. Reset whenever the
   * turn changes hands. At FINDS_PER_TURN the turn moves on: a hot streak is
   * worth having, not worth keeping the wheel for the whole round.
   *
   * There is no counter for the other way a turn ends, because there is
   * nothing to count: one wrong guess and the turn is over.
   */
  finds: number;
  /** Money won this round, lost entirely to Bankrupt. One entry per seat. */
  bank: number[];
  /** Money banked from rounds already won. Bankrupt cannot touch it. */
  score: number[];
  /** What just happened, for the board to narrate. */
  note: Note | null;
  roundOver: boolean;
  over: boolean;
}

export type WofMove =
  /**
   * `velocity` is the rim's speed as the finger left it, in signed degrees of
   * rotation per millisecond. See `spinThrow`, which is the whole of the physics
   * and runs here rather than on the machine that threw it.
   *
   * It is optional because the Spin button has no flick behind it: a keyboard,
   * a screen reader and a player who would rather tap all reach the wheel that
   * way, and for them the wheel decides, as it always did.
   */
  | { type: "spin"; velocity?: number }
  | { type: "letter"; letter: string }
  | { type: "solve"; answer: string }
  | { type: "next" };


// The bank is its own file: it is data rather than rules, and keeping the
// answers apart from the reducer that hides them makes the one thing this
// game must not leak easy to point at. Re-exported because the tests, the
// server test and `bundle.test.ts` all name it through here.
export { PUZZLES } from './wheelPuzzles.js';
export type { Puzzle } from './wheelPuzzles.js';
import { PUZZLES } from './wheelPuzzles.js';
import type { Puzzle } from './wheelPuzzles.js';

/** How many seats this game was set up for. Derived, so it cannot disagree. */
export function seatCount(state: WofState): number {
  return state.bank.length;
}

/** Replace every letter nobody has called with BLANK. Spaces and punctuation stay. */
export function mask(answer: string, called: readonly string[]): string {
  const known = new Set(called);
  return [...answer]
    .map((ch) => (ALPHABET.includes(ch) && !known.has(ch) ? BLANK : ch))
    .join("");
}

/**
 * Letters only, so a solver is judged on the phrase rather than on their
 * punctuation and spacing: "A BAKER'S DOZEN" accepts "a bakers dozen".
 */
export function normalize(text: string): string {
  return text
    .slice(0, MAX_GUESS)
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

export function occurrences(answer: string, letter: string): number {
  let found = 0;
  for (const ch of answer) if (ch === letter) found++;
  return found;
}

/** Letters from `pool` that are still available. */
export function remaining(pool: string, called: readonly string[]): string[] {
  return [...pool].filter((ch) => !called.includes(ch));
}

/** Seats holding the top score. More than one means nobody has won outright. */
export function leaders(state: WofState): number[] {
  const best = Math.max(...state.score);
  return state.score.flatMap((value, seat) => (value === best ? [seat] : []));
}

function isSolved(state: WofState): boolean {
  const known = new Set(state.called);
  for (const ch of state.answer) {
    if (ALPHABET.includes(ch) && !known.has(ch)) return false;
  }
  return true;
}

const NUMBERS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
];

function count(n: number): string {
  return NUMBERS[n] ?? String(n);
}

function clone(state: WofState): WofState {
  return {
    ...state,
    used: [...state.used],
    called: [...state.called],
    // Arrays and objects survive a spread as the same reference. Leaving any of
    // them shared means a derived state can write through to the snapshot it
    // came from.
    bank: [...state.bank],
    score: [...state.score],
    wedge: state.wedge === null ? null : ({ ...state.wedge } as Wedge),
    note: state.note === null ? null : { ...state.note },
  };
}

function drawPuzzle(used: readonly string[], rng: Rng): Puzzle {
  const pool = PUZZLES.filter((puzzle) => !used.includes(puzzle.answer));
  // The bank is far larger than ROUNDS, so this cannot run dry, but a reducer
  // that could hand back undefined is one that eventually does.
  const source = pool.length > 0 ? pool : PUZZLES;
  return source[pick(rng, source.length)];
}

/**
 * Hand over to the next seat round the table. The wedge goes with the turn: it
 * means "what the player to move spun", so leaving it in place would show the
 * next player someone else's $900.
 */
function passTurn(state: WofState): void {
  state.phase = "spin";
  state.wedge = null;
  // `wedgeAt` deliberately survives: it is where the wheel is standing, and
  // the next player watches it spin away from there.
  state.finds = 0;
  state.turn = (state.turn + 1) % seatCount(state);
}

/**
 * A wrong guess: a letter that is not there, a vowel that is not there, or a
 * failed attempt at the phrase. The turn ends on it, the way it does on the
 * show: a guess costs the wheel, which is what makes naming a letter you are
 * only half sure of a decision worth making.
 *
 * `what` is the sentence so far; this appends what it cost. `passTurn` clears
 * the spin as it goes: a wedge means "what the player to move spun".
 */
function strike(state: WofState, seat: number, what: string): void {
  state.note = { seat, text: `${what} The turn moves on.` };
  passTurn(state);
}

/**
 * A letter that was there: bank the find, and hand the wheel on once the
 * player has had `FINDS_PER_TURN` of them.
 *
 * Without this a good turn was the whole round: find a letter, spin again,
 * find another, and the player who got going never gave the wheel back while
 * everyone else watched. The cap is the same three as `strike`'s on purpose: a
 * turn is three letters, and it ends whichever way you spend them.
 *
 * Only called on a round still running. Finishing the puzzle on your third find
 * takes the round, and "the turn moves on" is no thing to say about a round
 * that has ended, so the caller checks `roundOver` first. Like `strike`, this
 * appends to the note already standing rather than replacing it: the player
 * still needs to read what their letter paid.
 */
function credit(state: WofState, seat: number): void {
  state.finds += 1;
  if (state.finds < FINDS_PER_TURN) return;
  const sentence = state.note === null ? "" : `${state.note.text} `;
  state.note = {
    seat,
    text: `${sentence}That is ${count(FINDS_PER_TURN)}, so the turn moves on.`,
  };
  passTurn(state);
}

/**
 * Close the round out. `seat` is whoever finished the puzzle.
 *
 * Two rules live here, and they are the ones that decide what the game feels
 * like:
 *
 * 1. **Solving pays `SOLVE_BONUS`**, on top of whatever the round already won.
 *    Spotting the phrase is the skill this game is about, so it is the thing
 *    worth the most.
 *
 * 2. **Everybody banks what they won**, not only the solver. That money was
 *    won letter by letter and it is theirs; taking it away because somebody
 *    else saw the phrase first made every round a write-off from second place,
 *    and made calling letters for a player who was behind pointless.
 *
 * Bankrupt still takes a bank to nothing, which is what keeps it frightening.
 * It just no longer has a rival in "somebody else solved it".
 */
function awardRound(state: WofState, seat: number): void {
  state.bank[seat] += SOLVE_BONUS;
  state.score = state.score.map((banked, index) => banked + state.bank[index]);
  state.roundOver = true;
  state.phase = "spin";
  state.wedge = null;
  state.finds = 0;

  if (state.round >= ROUNDS) {
    state.over = true;
    return;
  }
  // The next round opens with the next player round the table, so taking one
  // round does not compound into the first spin of the next.
  state.starter = (state.starter + 1) % seatCount(state);
  state.turn = state.starter;
}

/**
 * A correct call that fills in the last letter takes the round. There is
 * nothing left to solve, and no state worth having where the board is complete
 * and the game is still waiting to be told so.
 */
function finishIfSolved(state: WofState, seat: number): void {
  if (!isSolved(state)) return;
  if (state.note)
    state.note = { seat, text: `${state.note.text} That's the puzzle.` };
  awardRound(state, seat);
}

function beginRound(state: WofState, rng: Rng): WofState {
  const used = [...state.used, state.answer];
  const puzzle = drawPuzzle(used, rng);
  return {
    ...clone(state),
    round: state.round + 1,
    category: puzzle.category,
    answer: puzzle.answer,
    used,
    called: [],
    turn: state.starter,
    phase: "spin",
    wedge: null,
    // A fresh puzzle gets a fresh wheel, standing where it was left, which is
    // why `rest` is not in this list. `wedgeAt` is nulled because no wedge is
    // *owed* yet; the rim has not moved, and the next throw is measured from
    // where the last one stopped, round boundary or not.
    wedgeAt: null,
    travel: 0,
    finds: 0,
    bank: state.bank.map(() => 0),
    note: null,
    roundOver: false,
  };
}

// Moves

/**
 * `velocity` is the rim's speed at the moment of release, or undefined when
 * the wheel was spun by the button and nobody threw it.
 *
 * Two paths on purpose, differing in which end is decided first. A button spin
 * picks the wedge and works out a plausible journey to it, which is what the
 * game has always done and what every seeded test here relies on. A flick picks
 * the journey, which is what the player did, and finds out where it ended up,
 * with no draw from `rng` at all: `spinThrow` is physics, and physics does not
 * roll dice.
 *
 * Why the anchor is `state.wedgeAt` and not the rim under the finger
 *
 * A drag can put the wheel anywhere on screen. If the landing were measured
 * from where the finger let go, a player could line up the wedge they fancied,
 * stop dead, release, and take the one throw whose distance they know exactly.
 * Measured from where the wheel *stopped last time*, which no gesture moves, a
 * careful drag buys nothing and the flick still decides everything it should:
 * how far, and which way. The board draws the journey from wherever the drag
 * left the rim, so the seam never shows.
 */
function spin(
  state: WofState,
  seat: number,
  rng: Rng,
  velocity?: number,
): MoveResult<WofState> {
  if (state.phase !== "spin")
    return { ok: false, error: "Name your consonant first." };

  // Where the flapper is standing now, fractionally. This is the anchor, and
  // it carries the fraction the last throw left behind.
  const from = state.rest;
  let rest: number;
  let travel: number;
  if (velocity === undefined) {
    const at = pick(rng, WHEEL.length);
    // A button press has no throw of its own, so one is made up for it: land
    // somewhere inside the chosen wedge rather than on its midpoint, and work
    // backwards to the distance that gets there. Held off the seam by a
    // twentieth of a wedge each side so the flapper is unambiguously on one
    // face. The *flick* may stop on a seam, because that is what physics does,
    // but an invented throw has no business inventing one.
    const inside = at + (pick(rng, 901) - 450) / 1000;
    // Four whole turns clockwise, plus however much more reaches that spot.
    travel =
      4 * WHEEL.length +
      ((((from - inside) % WHEEL.length) + WHEEL.length) % WHEEL.length);
    rest = restAfter(from, travel);
  } else {
    const thrown = spinThrow(velocity);
    // A nudge is not a throw. Refused rather than clamped up to a minimum,
    // because a clamp made every under-strength release the same known distance
    // from a `rest` the player can see. See `SPIN_MIN_TRAVEL`. The wheel is left
    // exactly where the hand put it; nothing moves, and the player is asked for
    // a real one.
    if (thrown === null)
      return { ok: false, error: "That was a nudge. Flick the wheel harder." };
    travel = thrown.travel;
    rest = restAfter(from, travel);
  }
  const at = wedgeUnder(rest);
  const wedge = WHEEL[at];
  const next = clone(state);
  next.wedge = wedge;
  // Where the pointer now is, and the fact that it moved at all. The board
  // needs both to spin the wheel to the right place.
  next.wedgeAt = at;
  next.rest = rest;
  next.travel = travel;
  next.spins += 1;

  if (wedge.kind === "bankrupt") {
    const lost = next.bank[seat];
    next.bank[seat] = 0;
    next.note = {
      seat,
      text:
        lost > 0 ? `spun Bankrupt and lost ${money(lost)}.` : "spun Bankrupt.",
    };
    passTurn(next);
    return { ok: true, state: next };
  }

  if (wedge.kind === "lose-turn") {
    next.note = { seat, text: `spun ${wedgeName(wedge)}.` };
    passTurn(next);
    return { ok: true, state: next };
  }

  // Every consonant already called would otherwise strand the player in a
  // phase whose only legal move no longer exists.
  if (remaining(CONSONANTS, state.called).length === 0) {
    next.note = {
      seat,
      text: `spun ${money(wedge.value)}, but every consonant is gone.`,
    };
    passTurn(next);
    return { ok: true, state: next };
  }

  next.phase = "call";
  next.note = { seat, text: `spun ${money(wedge.value)}.` };
  return { ok: true, state: next };
}

function callConsonant(
  state: WofState,
  seat: number,
  letter: string,
): MoveResult<WofState> {
  const wedge = state.wedge;
  // Unreachable while `phase` and `wedge` agree, and checked anyway, because a
  // reducer that trusts its own invariants is one refactor from a crash.
  if (!wedge || wedge.kind !== "cash")
    return { ok: false, error: "Spin the wheel first." };

  const hits = occurrences(state.answer, letter);
  const next = clone(state);
  next.called = [...state.called, letter];

  if (hits === 0) {
    strike(next, seat, `called ${letter}. There is no ${letter}.`);
    return { ok: true, state: next };
  }

  const won = hits * wedge.value;
  next.bank[seat] += won;
  // The spin is spent whether or not it paid; another consonant needs another spin.
  next.phase = "spin";
  next.wedge = null;
  next.note = {
    seat,
    text: `found ${count(hits)} ${letter}${hits === 1 ? "" : "'s"}, worth ${money(won)}.`,
  };
  finishIfSolved(next, seat);
  if (!next.roundOver) credit(next, seat);
  return { ok: true, state: next };
}

function buyVowel(
  state: WofState,
  seat: number,
  letter: string,
): MoveResult<WofState> {
  if (state.bank[seat] < VOWEL_COST) {
    return {
      ok: false,
      error: `A vowel costs ${money(VOWEL_COST)}. Spin for it first.`,
    };
  }

  const next = clone(state);
  next.called = [...state.called, letter];
  // Charged either way: the money buys the question, not the answer.
  next.bank[seat] -= VOWEL_COST;

  const hits = occurrences(state.answer, letter);
  if (hits === 0) {
    strike(next, seat, `bought ${letter}. There is no ${letter}.`);
    return { ok: true, state: next };
  }

  next.note = {
    seat,
    text:
      hits === 1
        ? `bought ${letter}. Just the one.`
        : `bought ${letter}, ${count(hits)} of them.`,
  };
  finishIfSolved(next, seat);
  if (!next.roundOver) credit(next, seat);
  return { ok: true, state: next };
}

function solve(
  state: WofState,
  seat: number,
  guess: string,
): MoveResult<WofState> {
  if (state.phase !== "spin")
    return { ok: false, error: "Name your consonant first." };

  const attempt = normalize(guess);
  if (!attempt) return { ok: false, error: "Type an answer to solve with." };

  const next = clone(state);
  if (attempt !== normalize(state.answer)) {
    strike(next, seat, "guessed, and got it wrong.");
    return { ok: true, state: next };
  }

  // Fill the board in, so the round ends showing the whole phrase.
  next.called = [
    ...new Set(
      [...state.called, ...state.answer].filter((ch) => ALPHABET.includes(ch)),
    ),
  ];
  next.note = { seat, text: "solved it." };
  awardRound(next, seat);
  return { ok: true, state: next };
}

// The definition

export const wheel: GameDefinition<WofState, WofMove> = {
  id: GAME_MANIFEST.wheel.id,
  name: GAME_MANIFEST.wheel.name,
  minPlayers: GAME_MANIFEST.wheel.minPlayers,
  maxPlayers: GAME_MANIFEST.wheel.maxPlayers,

  setup(playerCount, rng): WofState {
    // However many seats the room was opened for. Clamped rather than trusted:
    // this is the one place the rest of the app's arithmetic gets baked in, and
    // a zero here would make `% seats` divide by nothing.
    const seats = Math.min(
      Math.max(
        Math.trunc(playerCount) || GAME_MANIFEST.wheel.minPlayers,
        GAME_MANIFEST.wheel.minPlayers,
      ),
      GAME_MANIFEST.wheel.maxPlayers,
    );
    // Nobody has an opening advantage: who starts is decided by the wheel.
    const starter = pick(rng, seats);
    const puzzle = drawPuzzle([], rng);
    return {
      round: 1,
      category: puzzle.category,
      answer: puzzle.answer,
      used: [],
      called: [],
      starter,
      turn: starter,
      phase: "spin",
      wedge: null,
      wedgeAt: null,
      rest: 0,
      spins: 0,
      travel: 0,
      finds: 0,
      bank: Array<number>(seats).fill(0),
      score: Array<number>(seats).fill(0),
      note: null,
      roundOver: false,
      over: false,
    };
  },

  applyMove(state, move, seat, rng): MoveResult<WofState> {
    if (state.over) return { ok: false, error: "The game is already over." };
    if (seat !== state.turn) return { ok: false, error: "It's not your turn." };
    if (!move || typeof move !== "object")
      return { ok: false, error: "Unknown move." };

    if (state.roundOver) {
      if (move.type !== "next")
        return { ok: false, error: "That round is finished." };
      return { ok: true, state: beginRound(state, rng) };
    }
    if (move.type === "next")
      return { ok: false, error: "This round is still going." };

    if (move.type === "spin") {
      // Anything but a number means "no flick": the button, an old client, or
      // one making things up. `spinThrow` clamps the range; this only decides
      // which of the two spins happened.
      // Anything that is not a real number is not a measurement, so it is no
      // flick at all and the wheel decides, the same path the Spin button
      // takes. That covers an old client sending `power`, and a new one whose
      // pointer trail divided by a zero-length window.
      const velocity = Number.isFinite(move.velocity)
        ? (move.velocity as number)
        : undefined;
      return spin(state, seat, rng, velocity);
    }

    if (move.type === "letter") {
      const letter = String(move.letter ?? "").toUpperCase();
      if (letter.length !== 1 || !ALPHABET.includes(letter)) {
        return { ok: false, error: `${named(move.letter)} is not a letter.` };
      }
      if (state.called.includes(letter)) {
        return { ok: false, error: `${letter} has already been called.` };
      }

      const vowel = VOWELS.includes(letter);
      if (state.phase === "call") {
        if (vowel)
          return { ok: false, error: "You spun for a consonant, so name one." };
        return callConsonant(state, seat, letter);
      }
      if (!vowel)
        return {
          ok: false,
          error: "Spin the wheel before naming a consonant.",
        };
      return buyVowel(state, seat, letter);
    }

    if (move.type === "solve")
      return solve(state, seat, String(move.answer ?? ""));

    return { ok: false, error: "Unknown move." };
  },

  /**
   * Everything a client is allowed to know. The answer is the only secret in
   * the project and this is the only thing keeping it: the server sends
   * whatever comes back from here.
   */
  view(state) {
    // Every seat sees the same board: what is hidden is hidden from everyone.
    // Once the round is over the phrase is public, which is what lets the board
    // show what it was.
    // A copy either way. Returning `state` itself here would hand a caller a
    // live reference to reducer state on exactly one branch -- harmless while
    // every caller serialises the result, and a trap the first time one does
    // not. The two branches should differ in what they mask, not in that.
    if (state.roundOver) return { ...state };
    return { ...state, answer: mask(state.answer, state.called) };
  },

  turn(state) {
    return state.over ? null : state.turn;
  },

  canAct(state, seat) {
    return !state.over && state.turn === seat;
  },

  isOver(state) {
    return state.over;
  },

  // A tie at the top names nobody, which is what `status` below says in
  // words. See `leaders`.
  winner(state) {
    const top = leaders(state);
    return state.over && top.length === 1 ? top[0] : null;
  },

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    if (state.over) {
      const top = leaders(state);
      const best = money(state.score[top[0]]);
      if (top.length > 1) {
        const tied = top.map(nameFor);
        return `A tie at ${best}: ${tied.slice(0, -1).join(", ")} and ${tied[tied.length - 1]}`;
      }
      return `${nameFor(top[0])} wins with ${best}`;
    }
    if (state.roundOver)
      return `${nameFor(state.turn)} to start round ${state.round + 1}`;

    // Letters left in the streak is worth saying out loud once the player has
    // found any: it is the only part of the turn's shape that is not obvious
    // from the board, since the other way a turn ends takes exactly one guess.
    const left = FINDS_PER_TURN - state.finds;
    const tail = left < FINDS_PER_TURN ? `, ${count(left)} left` : "";
    if (state.phase === "call")
      return `${nameFor(state.turn)} to name a consonant${tail}`;
    return `${nameFor(state.turn)} to spin or solve${tail}`;
  },
};
