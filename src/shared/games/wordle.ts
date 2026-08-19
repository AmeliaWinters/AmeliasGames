import type { GameDefinition, MoveResult } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { WORDS, isWord } from './words.js';
import {
  HIDDEN,
  MAX_GUESSES,
  WORD_LENGTH,
  canAct,
  isFinished,
  opponentOf,
} from './wordleDisplay.js';
import type { Mark, Row, WordleMove, WordleState } from './wordleDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word list.
export {
  HIDDEN,
  MAX_GUESSES,
  WORD_LENGTH,
  canAct,
  isFinished,
  opponentOf,
} from './wordleDisplay.js';
export type { Mark, Row, WordleMove, WordleState } from './wordleDisplay.js';

/**
 * Head-to-head Wordle. Each player sets a five-letter word for the other, then
 * both work on the word they were given.
 *
 * Two things here are unlike every other game in this repo:
 *
 * 1. **Nobody waits.** Play is free-simultaneous: a player may guess whenever
 *    they have a guess left, regardless of what the opponent is doing. The
 *    `turn` field of `GameDefinition` assumes one active seat, so it reports
 *    whoever is furthest behind purely as a hint for the status line —
 *    `applyMove` never consults it. Anything deciding whether a player may act
 *    must ask `canAct`, not `turn`.
 *
 * 2. **The only secret is the word.** Both players' guesses and marks are
 *    open, and that costs nothing: you are guessing your opponent's word and
 *    they are guessing yours, so their guesses at *your* word tell you only
 *    what you could already work out by marking them yourself. `view()`
 *    therefore hides exactly one thing — the word your opponent set for you —
 *    and only until the game ends, because losing without ever learning the
 *    word is the unsatisfying ending.
 */

/**
 * Standard Wordle marking, which is subtler than it looks: a letter is yellow
 * only if the secret has an unmatched copy of it left over. Guessing SPEED
 * against ABIDE greens the second E and greys the first, because ABIDE has
 * just the one E and that E is spoken for.
 *
 * Exact matches are therefore claimed in a first pass, before any near match
 * is allowed to consume a letter.
 */
export function markGuess(guess: string, secret: string): Mark[] {
  const marks: Mark[] = Array(guess.length).fill('miss');
  const spare = new Map<string, number>();

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) {
      marks[i] = 'hit';
    } else {
      spare.set(secret[i], (spare.get(secret[i]) ?? 0) + 1);
    }
  }

  for (let i = 0; i < guess.length; i++) {
    if (marks[i] === 'hit') continue;
    const left = spare.get(guess[i]) ?? 0;
    if (left > 0) {
      marks[i] = 'near';
      spare.set(guess[i], left - 1);
    }
  }

  return marks;
}

/**
 * Fewer guesses wins; solving beats not solving; the same count is a draw, as
 * is neither player solving. Nothing here breaks a tie by who finished first —
 * under free-simultaneous play that would hand the game to the faster typist
 * rather than the better guesser.
 */
function decide(solvedIn: Array<number | null>): { winner: number | null; draw: boolean } {
  const [a, b] = solvedIn;
  if (a === null && b === null) return { winner: null, draw: true };
  if (a === null) return { winner: 1, draw: false };
  if (b === null) return { winner: 0, draw: false };
  if (a === b) return { winner: null, draw: true };
  return { winner: a < b ? 0 : 1, draw: false };
}

/**
 * Accept a word, or say why not. Case and surrounding space are the player's
 * business, not the rules'; anything else is rejected with a reason specific
 * enough to act on, because "invalid word" tells a player nothing about
 * whether to retype it or think of another one.
 */
function readWord(raw: unknown): MoveResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'That is not a word.' };
  const word = raw.trim().toUpperCase();
  if (word.length !== WORD_LENGTH) {
    return { ok: false, error: `Words are ${WORD_LENGTH} letters.` };
  }
  if (!/^[A-Z]+$/.test(word)) {
    return { ok: false, error: 'Letters only — no spaces, digits or punctuation.' };
  }
  if (!isWord(word)) {
    return { ok: false, error: `${word} is not in the word list.` };
  }
  return { ok: true, state: word };
}

function isOver(state: WordleState): boolean {
  return state.phase === 'over';
}

function setWord(state: WordleState, word: string, seat: number): MoveResult<WordleState> {
  if (state.phase !== 'setup') {
    return { ok: false, error: 'Both words are already set.' };
  }
  if (state.secrets[seat] !== null) {
    // Deliberately final. Letting a player swap their word after seeing the
    // opponent's first guess would make every mark already shown a lie.
    return { ok: false, error: 'You have already set your word.' };
  }

  const secrets = state.secrets.slice();
  secrets[seat] = word;
  const bothIn = secrets.every((s) => s !== null);

  return { ok: true, state: { ...state, secrets, phase: bothIn ? 'play' : 'setup' } };
}

function guess(state: WordleState, word: string, seat: number): MoveResult<WordleState> {
  if (state.phase === 'setup') {
    return { ok: false, error: 'Waiting for both words to be set.' };
  }
  if (state.phase === 'over') {
    return { ok: false, error: 'The game is already over.' };
  }
  if (state.solvedIn[seat] !== null) {
    return { ok: false, error: 'You have already solved it.' };
  }
  if (state.guesses[seat].length >= MAX_GUESSES) {
    return { ok: false, error: 'You are out of guesses.' };
  }

  // The word this seat is guessing at is the one the OPPONENT set.
  const secret = state.secrets[opponentOf(seat)];
  if (secret === null) return { ok: false, error: 'Waiting for both words to be set.' };

  const rows: Row[] = state.guesses[seat].concat({ word, marks: markGuess(word, secret) });
  const guesses = state.guesses.slice();
  guesses[seat] = rows;

  const solvedIn = state.solvedIn.slice();
  if (word === secret) solvedIn[seat] = rows.length;

  const next: WordleState = { ...state, guesses, solvedIn };
  if (isFinished(next, 0) && isFinished(next, 1)) {
    const { winner, draw } = decide(solvedIn);
    return { ok: true, state: { ...next, phase: 'over', winner, draw } };
  }
  return { ok: true, state: next };
}

export const wordle: GameDefinition<WordleState, WordleMove> = {
  id: GAME_MANIFEST.wordle.id,
  name: GAME_MANIFEST.wordle.name,
  minPlayers: 2,
  maxPlayers: 2,

  // Both words come from the players, so there is nothing to draw and no rng.
  setup(): WordleState {
    return {
      phase: 'setup',
      secrets: [null, null],
      guesses: [[], []],
      solvedIn: [null, null],
      winner: null,
      draw: false,
    };
  },

  applyMove(state, move, seat): MoveResult<WordleState> {
    if (seat !== 0 && seat !== 1) return { ok: false, error: 'You are not playing.' };
    if (!move || (move.type !== 'setWord' && move.type !== 'guess')) {
      return { ok: false, error: 'Unknown move.' };
    }

    const word = readWord(move.word);
    if (!word.ok) return { ok: false, error: word.error };

    return move.type === 'setWord'
      ? setWord(state, word.state, seat)
      : guess(state, word.state, seat);
  },

  /**
   * A hint for the status line only — see the note at the top of this file.
   * Whoever has played fewer rows is the one the game is waiting on; ties go
   * to seat 0 so this stays a pure function of the state.
   */
  turn(state) {
    if (isOver(state)) return null;
    if (canAct(state, 0) && canAct(state, 1)) {
      return state.guesses[0].length <= state.guesses[1].length ? 0 : 1;
    }
    if (canAct(state, 0)) return 0;
    if (canAct(state, 1)) return 1;
    return null;
  },

  isOver,

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    if (state.phase === 'setup') {
      const waiting = [0, 1].filter((seat) => state.secrets[seat] === null);
      if (waiting.length === 2) return 'Both players are choosing a word';
      return `Waiting for ${nameFor(waiting[0])} to choose a word`;
    }

    if (state.phase === 'over') {
      if (state.winner !== null) {
        const count = state.solvedIn[state.winner];
        return `${nameFor(state.winner)} wins in ${count} ${count === 1 ? 'guess' : 'guesses'}`;
      }
      if (state.solvedIn[0] !== null) {
        return `A draw — both solved it in ${state.solvedIn[0]}`;
      }
      return 'A draw. Neither word was cracked.';
    }

    const done = [0, 1].filter((seat) => isFinished(state, seat));
    if (done.length === 1) return `Waiting on ${nameFor(opponentOf(done[0]))}`;
    return 'Both guessing';
  },

  /**
   * The one secret in the game: the word your opponent set for you. Everything
   * else — their guesses, their marks, how close they are — is information you
   * could derive yourself, so hiding it would only cost you the tension of
   * watching them close in.
   *
   * An opponent who has chosen shows as `HIDDEN` rather than `null`, so the
   * board can tell "chosen, not for your eyes" from "still thinking". Revealed
   * outright once the game is over, so a player who ran out of guesses still
   * finds out what the word was — and earlier to a player who has already
   * solved it, who is only being kept from something they typed themselves.
   */
  view(state, seat) {
    if (state.phase === 'over') return state;
    const solved = state.solvedIn[seat] !== null;
    return {
      ...state,
      secrets: state.secrets.map((word, index) => {
        if (index === seat || solved) return word;
        return word === null ? null : HIDDEN;
      }),
    };
  },
};

/** Exported for the test that holds the word list to a usable size. */
export const WORD_COUNT = WORDS.size;
