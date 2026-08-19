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
 * `wordle.ts` re-exports everything here, so the reducer and its tests carry
 * on importing from one place.
 */

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

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
   * `secrets[s]` is the word seat `s` CHOSE, which is the word their opponent
   * has to guess. Storing it under the setter rather than the guesser is what
   * makes `view()` a one-liner: a seat may see its own entry and no other.
   *
   * After redaction an opponent's entry reads `HIDDEN` if they have chosen and
   * `null` if they have not.
   */
  secrets: Array<string | null>;
  /** `guesses[s]` is what seat `s` has thrown at their opponent's word. */
  guesses: Row[][];
  /** Guesses seat `s` needed to solve, or null if they have not solved it. */
  solvedIn: Array<number | null>;
  winner: number | null;
  draw: boolean;
}

export type WordleMove =
  | { type: 'setWord'; word: string }
  | { type: 'guess'; word: string };

/** The seat across the table. Two-player only, so this is the whole story. */
export function opponentOf(seat: number): number {
  return seat === 0 ? 1 : 0;
}

/**
 * A seat is finished when it has solved the word or run out of guesses. The
 * game ends when both are finished — not when the first player solves, so the
 * other still gets to use the guesses they have left rather than being cut off
 * mid-word.
 */
export function isFinished(state: WordleState, seat: number): boolean {
  return state.solvedIn[seat] !== null || state.guesses[seat].length >= MAX_GUESSES;
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
  if (seat !== 0 && seat !== 1) return false;
  if (state.phase === 'setup') return state.secrets[seat] === null;
  if (state.phase === 'play') return !isFinished(state, seat);
  return false;
}
