/**
 * The parts of head-to-head Wordle the board is allowed to know.
 *
 * Like `wheelDisplay.ts` and `roomCode.ts`, this module deliberately imports
 * nothing. The board has to decide whether the player may type right now, and
 * that decision is real logic — but routing it through `wordle.ts` would pull
 * the reducer and the whole word list into the client bundle for the sake of
 * two booleans. Keeping the shapes and the derived predicates here means the
 * client's runtime import graph stops at this file.
 *
 * The one thing it imports is another leaf that imports nothing itself. The
 * rule is not "no imports" but "nothing that reaches a reducer".
 *
 * `wordle.ts` re-exports everything here, so the reducer and its tests carry
 * on importing from one place.
 */

export { clockCall, formatClock } from '../clock.js';

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

/**
 * The shot clock: how long you have to produce a guess once one is on you.
 *
 * A minute is deliberately generous for a five-letter word and deliberately
 * short of "as long as you like". The clock exists because Word Duel is
 * free-simultaneous — nothing about the rules ever forced a player to move —
 * and a game where one side can simply stop is not a game. It is held back
 * until somebody solves, though: the stall worth policing is the one holding
 * up a finished result, not the thinking that gets you to it.
 */
export const GUESS_MS = 60 * 1000;

/** Wordle's three tile colours: green, yellow, grey. */
export type Mark = 'hit' | 'near' | 'miss';

export interface Row {
  word: string;
  marks: Mark[];
}

/**
 * What `view()` puts where an opponent's word used to be. A sentinel rather
 * than `null`, because "they have chosen, you cannot see what" and "they have
 * not chosen yet" are different things to the player waiting on them, and the
 * board would have no way to tell them apart otherwise. Not letters, so it can
 * never collide with a real word.
 */
export const HIDDEN = '?????';

export interface WordleState {
  /**
   * `setup` while either player still owes a word, `play` once both are in,
   * `over` when both are finished. There is no phase in which one player is
   * choosing and the other is guessing: the first guess would be against a
   * word that does not exist yet.
   */
  phase: 'setup' | 'play' | 'over';
  /**
   * `secrets[s]` is the word seat `s` CHOSE, which is the word whoever is
   * pointed at `s` has to guess. Storing it under the setter rather than the
   * guesser is what makes `view()` nearly a one-liner: a seat may see its own
   * entry, and the one it is guessing only once that can no longer help it.
   *
   * After redaction another player's entry reads `HIDDEN` if they have chosen
   * and `null` if they have not.
   */
  secrets: Array<string | null>;
  /**
   * `target[s]` is the seat whose word `s` is guessing.
   *
   * Drawn once, at setup, as a random derangement — a permutation with no seat
   * left pointing at itself, because a player handed their own word has been
   * handed the answer. At two players there is exactly one derangement and
   * this is always `[1, 0]`, which is why the game could get away without it
   * for as long as it did.
   *
   * A permutation rather than free choice: everybody sets exactly one word and
   * everybody guesses exactly one, so no player is left without a word to
   * work on and no word goes unguessed.
   */
  target: number[];
  /** `guesses[s]` is what seat `s` has thrown at the word it was pointed at. */
  guesses: Row[][];
  /** Guesses seat `s` needed to solve, or null if they have not solved it. */
  solvedIn: Array<number | null>;
  /**
   * `dueBy[s]` is when seat `s` must have got their next guess in by, in epoch
   * milliseconds, or null if no clock is running on them.
   *
   * Nobody is on a clock until somebody *solves*: guessing at a word you have
   * not cracked yet is untimed, so until the first solve every entry is null
   * and the game runs on nobody's clock. See `reclock` in `wordle.ts` for when
   * a clock starts, stops and stays put.
   *
   * Above two players several run at once, so this is genuinely per seat: the
   * first solve starts a clock on everyone who can still act, and each player
   * refreshes only their own by guessing. Nobody can hand anybody else a fresh
   * minute, and nobody can buy one.
   */
  dueBy: Array<number | null>;
  /**
   * The seats whose clock ran out, in the order they ran out. Empty when
   * nobody has been caught by one.
   *
   * A list rather than a single seat because above two players a timeout is
   * not the end of the game: the player who let their minute go is finished,
   * and everyone else carries on. Derivable — a seat that is over without
   * having solved or spent its guesses ran out — but only by an argument, and
   * the status line and the board both need to say plainly what happened.
   */
  timedOut: number[];
  winner: number | null;
  draw: boolean;
}

export type WordleMove =
  | { type: 'setWord'; word: string }
  | { type: 'guess'; word: string };

/**
 * The seat whose word `seat` is guessing.
 *
 * This replaced an `opponentOf(seat)` that was `seat === 0 ? 1 : 0`. The
 * change is not cosmetic: who you are guessing is now drawn at setup rather
 * than implied by arithmetic, so it has to be read from the state, and there
 * is no longer any such thing as "the" opponent.
 */
export function targetOf(state: WordleState, seat: number): number {
  return state.target[seat];
}

/** The seat guessing `seat`'s word — the other direction along the ring. */
export function guesserOf(state: WordleState, seat: number): number {
  return state.target.findIndex((t) => t === seat);
}

/** Every seat at the table. */
export function seatsOf(state: WordleState): number[] {
  return state.secrets.map((_, index) => index);
}

/**
 * A seat is finished when it has solved its word, spent its guesses, or let
 * its clock run out. The game ends when *everyone* is finished — not when the
 * first player solves, so the rest still get to use the guesses they have left
 * rather than being cut off mid-word.
 */
export function isFinished(state: WordleState, seat: number): boolean {
  return (
    state.solvedIn[seat] !== null ||
    state.guesses[seat].length >= MAX_GUESSES ||
    state.timedOut.includes(seat)
  );
}

/**
 * Whether `seat` may move right now — the only question the UI should ask, and
 * the reason this file exists. Play is free-simultaneous, so `room.turn` says
 * nothing about whether you personally may type.
 *
 * During setup this means "you have not submitted a word yet"; during play,
 * "you have guesses left and have not solved it".
 */
export function canAct(state: WordleState, seat: number): boolean {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.secrets.length) return false;
  if (state.phase === 'setup') return state.secrets[seat] === null;
  if (state.phase === 'play') return !isFinished(state, seat);
  return false;
}

/**
 * Milliseconds left on `seat`'s shot clock, or null if no clock is on them —
 * which is a different thing from zero and has to read differently, so this
 * does not flatten the two together.
 *
 * Floored at zero. Measured against a clock the caller supplies, because the
 * only clock that decides anything is the server's.
 */
export function msLeftFor(state: WordleState, seat: number, now: number): number | null {
  if (state.phase !== 'play') return null;
  const due = state.dueBy[seat];
  if (due === undefined || due === null) return null;
  return Math.max(0, due - now);
}

/** Whether `seat`'s minute has gone. The server's answer is the one that counts. */
export function outOfTime(state: WordleState, seat: number, now: number): boolean {
  return msLeftFor(state, seat, now) === 0;
}

/**
 * The keyboard, in the three rows everyone already knows. A layout constant
 * rather than something derived, because the point of a QWERTY keyboard is
 * that the letters are exactly where the player expects them.
 */
export const KEY_ROWS: readonly string[] = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/**
 * What each letter has turned out to be, across every guess a player has made.
 *
 * The precedence is the interesting part: a letter keeps the *best* news it
 * has ever had. Guess CRANE against ABIDE and the A comes back yellow; guess
 * ABIDE next and it goes green — the key must stay green, because a key that
 * downgraded would be telling the player something false about a letter they
 * have already placed.
 *
 * Only ever fed a player's own guesses. Their opponent's marks are against a
 * different word and would be nonsense here.
 */
export function keyMarks(rows: Row[]): Record<string, Mark> {
  const rank: Record<Mark, number> = { miss: 1, near: 2, hit: 3 };
  const marks: Record<string, Mark> = {};

  for (const row of rows) {
    for (let i = 0; i < row.word.length; i++) {
      const letter = row.word[i];
      const mark = row.marks[i];
      const held = marks[letter];
      if (held === undefined || rank[mark] > rank[held]) marks[letter] = mark;
    }
  }

  return marks;
}
