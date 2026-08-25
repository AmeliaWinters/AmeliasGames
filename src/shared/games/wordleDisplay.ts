/**
 * The parts of head-to-head Wordle the board may know. See the display-module
 * boundary in `types.ts`: importing anything that reaches a reducer would pull
 * the word list into the client bundle. `wordle.ts` re-exports all of this.
 */

export { clockCall, formatClock } from '../clock.js';

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

/**
 * Shot clock. Play is free-simultaneous, so nothing else forces a move. Held
 * back until somebody solves: the stall worth policing is the one holding up a
 * finished result, not the thinking that gets you there.
 */
export const GUESS_MS = 60 * 1000;

/** Wordle's three tile colours: green, yellow, grey. */
export type Mark = 'hit' | 'near' | 'miss';

export interface Row {
  word: string;
  marks: Mark[];
}

/**
 * What `view()` puts where an opponent's word was. A sentinel, not `null`:
 * "chosen, hidden" and "not chosen yet" read differently to the player waiting.
 * Not letters, so it cannot collide with a real word.
 */
export const HIDDEN = '?????';

export interface WordleState {
  /**
   * No phase has one player choosing while another guesses: the first guess
   * would be against a word that does not exist yet.
   */
  phase: 'setup' | 'play' | 'over';
  /**
   * The word seat `s` CHOSE, not the one it guesses. Filed under the setter so
   * `view()` stays trivial: a seat sees its own entry, and the one it is
   * guessing only once that can no longer help it. After redaction, another
   * player's entry is `HIDDEN` if they have chosen and `null` if not.
   */
  secrets: Array<string | null>;
  /**
   * `target[s]` is the seat whose word `s` guesses. A random derangement drawn
   * at setup: no self-pointing (that hands a player the answer), and a
   * permutation so every word is guessed exactly once. Always `[1, 0]` at two
   * players, which is why the game managed without it for so long.
   */
  target: number[];
  /** `guesses[s]` is what seat `s` has thrown at the word it was pointed at. */
  guesses: Row[][];
  /** Guesses seat `s` needed to solve, or null if they have not solved it. */
  solvedIn: Array<number | null>;
  /**
   * Epoch ms when seat `s`'s most recent guess landed, or null if they have
   * not guessed. For a seat that solved this *is* the solve, since a solved
   * seat cannot guess again, which is why one field covers both the "fastest
   * to it" tiebreak and the one between players who never got there.
   * See `decide` in `wordle.ts`; this game has no draws, so something has to
   * separate two players who spent the same guesses.
   */
  guessedAt: Array<number | null>;
  /**
   * Epoch ms by which seat `s` owes a guess, or null if no clock is on them.
   * Null for everyone until the first solve. Per seat: a player refreshes only
   * their own by guessing, and cannot hand anyone else a fresh minute. See
   * `reclock` in `wordle.ts`.
   */
  dueBy: Array<number | null>;
  /**
   * Seats whose clock ran out, in order. A list because above two players a
   * timeout finishes that player, not the game. Derivable, but only by an
   * argument, and the status line has to say plainly what happened.
   */
  timedOut: number[];
  /**
   * Always set once `phase` is `over`. There is no `draw` beside it: every
   * finish this game can reach comes down to one seat, see `decide`.
   */
  winner: number | null;
}

export type WordleMove =
  | { type: 'setWord'; word: string }
  | { type: 'guess'; word: string };

/**
 * Replaced an `opponentOf` that was `seat === 0 ? 1 : 0`. Who you guess is now
 * drawn at setup, so it must be read from state. There is no "the" opponent.
 */
export function targetOf(state: WordleState, seat: number): number {
  return state.target[seat];
}

/** The seat guessing `seat`'s word: the other direction along the ring. */
export function guesserOf(state: WordleState, seat: number): number {
  return state.target.findIndex((t) => t === seat);
}

/** Every seat at the table. */
export function seatsOf(state: WordleState): number[] {
  return state.secrets.map((_, index) => index);
}

/**
 * Solved, out of guesses, or out of time. The game ends when *everyone* is
 * finished, not on the first solve; the rest keep the guesses they have left.
 */
export function isFinished(state: WordleState, seat: number): boolean {
  return (
    state.solvedIn[seat] !== null ||
    state.guesses[seat].length >= MAX_GUESSES ||
    state.timedOut.includes(seat)
  );
}

/**
 * The only question the UI should ask. Play is free-simultaneous, so
 * `room.turn` says nothing about whether you personally may type.
 */
export function canAct(state: WordleState, seat: number): boolean {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.secrets.length) return false;
  if (state.phase === 'setup') return state.secrets[seat] === null;
  if (state.phase === 'play') return !isFinished(state, seat);
  return false;
}

/**
 * Ms left, or null if no clock is on them, which is a different thing from
 * zero and not flattened together. Floored at zero, measured against a
 * caller-supplied `now`, because the only clock that decides is the server's.
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

/** Hardcoded, not derived: the point of QWERTY is that letters sit where expected. */
export const KEY_ROWS: readonly string[] = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/**
 * A letter keeps the *best* news it has ever had. CRANE against ABIDE marks A
 * yellow; ABIDE next turns it green and it must stay green, since a downgraded
 * key would lie about a letter already placed. Own guesses only; an opponent's
 * marks are against a different word.
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
