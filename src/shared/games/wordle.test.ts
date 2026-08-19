import { describe, expect, it } from 'vitest';
import {
  HIDDEN,
  KEY_ROWS,
  MAX_GUESSES,
  canAct,
  isFinished,
  keyMarks,
  markGuess,
  wordle,
} from './wordle.js';
import type { WordleState } from './wordle.js';

/** The rng is never consulted, so a poisoned one proves the reducer is pure. */
const noRng = () => {
  throw new Error('wordle must not use randomness');
};

function fresh(): WordleState {
  return wordle.setup(2, noRng);
}

/** Apply a move that is expected to succeed, or fail loudly with its reason. */
function play(state: WordleState, move: unknown, seat: number): WordleState {
  const result = wordle.applyMove(state, move as never, seat, noRng);
  if (!result.ok) throw new Error(`move rejected: ${result.error}`);
  return result.state;
}

function refuse(state: WordleState, move: unknown, seat: number): string {
  const result = wordle.applyMove(state, move as never, seat, noRng);
  if (result.ok) throw new Error('expected the move to be rejected');
  return result.error;
}

/** Both words set: seat 0 must find CRANE, seat 1 must find SLATE. */
function started(): WordleState {
  let state = fresh();
  // Seat 0 sets SLATE *for seat 1*, so seat 0 is the one hunting CRANE.
  state = play(state, { type: 'setWord', word: 'slate' }, 0);
  state = play(state, { type: 'setWord', word: 'crane' }, 1);
  return state;
}

describe('markGuess', () => {
  it('greens an exact match and greys a letter that is absent', () => {
    expect(markGuess('CRANE', 'CRANE')).toEqual(['hit', 'hit', 'hit', 'hit', 'hit']);
    expect(markGuess('BUDDY', 'CRANE')).toEqual(['miss', 'miss', 'miss', 'miss', 'miss']);
  });

  it('yellows a letter in the word but the wrong place', () => {
    // A is in CRANE at index 3, guessed at index 0.
    expect(markGuess('ABIDE', 'CRANE')).toEqual(['near', 'miss', 'miss', 'miss', 'hit']);
  });

  it('does not yellow a duplicate that an exact match already claimed', () => {
    // SLATE has one E, and ELITE's own final E matches it exactly. The E the
    // player opened with therefore has nothing left to point at and is grey,
    // not yellow — the rule people get wrong when they implement this.
    expect(markGuess('ELITE', 'SLATE')).toEqual(['miss', 'hit', 'miss', 'hit', 'hit']);
  });

  it('hands out only as many yellows as the word has copies left', () => {
    // EERIE has three Es. GEESE matches two of them exactly, leaving exactly
    // one spare — so exactly one of the guess's remaining Es turns yellow.
    expect(markGuess('GEESE', 'EERIE')).toEqual(['miss', 'hit', 'near', 'miss', 'hit']);
  });
});

describe('setting a word', () => {
  it('starts in setup with nothing chosen', () => {
    const state = fresh();
    expect(state.phase).toBe('setup');
    expect(state.secrets).toEqual([null, null]);
    expect(canAct(state, 0)).toBe(true);
    expect(canAct(state, 1)).toBe(true);
  });

  it('stores the word upper case, however it was typed', () => {
    const state = play(fresh(), { type: 'setWord', word: '  SlAtE ' }, 0);
    expect(state.secrets[0]).toBe('SLATE');
  });

  it('moves to play only once both players are in', () => {
    let state = play(fresh(), { type: 'setWord', word: 'slate' }, 0);
    expect(state.phase).toBe('setup');
    expect(canAct(state, 0)).toBe(false);
    expect(canAct(state, 1)).toBe(true);

    state = play(state, { type: 'setWord', word: 'crane' }, 1);
    expect(state.phase).toBe('play');
  });

  it('refuses a second word from the same player', () => {
    const state = play(fresh(), { type: 'setWord', word: 'slate' }, 0);
    expect(refuse(state, { type: 'setWord', word: 'crane' }, 0)).toMatch(/already set/i);
  });

  it('refuses a guess before both words are set', () => {
    const state = play(fresh(), { type: 'setWord', word: 'slate' }, 0);
    expect(refuse(state, { type: 'guess', word: 'crane' }, 1)).toMatch(/waiting/i);
  });

  it('rejects anything that is not a five-letter word', () => {
    const state = fresh();
    expect(refuse(state, { type: 'setWord', word: 'four' }, 0)).toMatch(/5 letters/);
    expect(refuse(state, { type: 'setWord', word: 'ab de' }, 0)).toMatch(/letters only/i);
    expect(refuse(state, { type: 'setWord', word: 'zzzzz' }, 0)).toMatch(/not in the word list/i);
    expect(refuse(state, { type: 'setWord', word: 42 }, 0)).toMatch(/not a word/i);
    expect(refuse(state, { type: 'nonsense' }, 0)).toMatch(/unknown move/i);
  });

  it('accepts the slang and profanity the list promises', () => {
    expect(wordle.applyMove(fresh(), { type: 'setWord', word: 'bitch' }, 0, noRng).ok).toBe(true);
    expect(wordle.applyMove(fresh(), { type: 'setWord', word: 'janky' }, 0, noRng).ok).toBe(true);
  });
});

describe('guessing', () => {
  it('marks a guess against the word the OPPONENT set', () => {
    // Seat 0 is hunting CRANE, the word seat 1 set.
    const state = play(started(), { type: 'guess', word: 'crane' }, 0);
    expect(state.guesses[0][0].marks).toEqual(['hit', 'hit', 'hit', 'hit', 'hit']);
    expect(state.solvedIn[0]).toBe(1);
    // Solving does not end the game — seat 1 still has their guesses.
    expect(state.phase).toBe('play');
    expect(wordle.isOver(state)).toBe(false);
  });

  it('lets either player move at any time, in any order', () => {
    let state = started();
    state = play(state, { type: 'guess', word: 'blank' }, 1);
    state = play(state, { type: 'guess', word: 'blank' }, 1);
    state = play(state, { type: 'guess', word: 'blank' }, 1);
    // Seat 0 has not moved at all and is still perfectly welcome to.
    expect(canAct(state, 0)).toBe(true);
    state = play(state, { type: 'guess', word: 'blank' }, 0);
    expect(state.guesses[0]).toHaveLength(1);
    expect(state.guesses[1]).toHaveLength(3);
  });

  it('refuses to let a solved player keep guessing', () => {
    const state = play(started(), { type: 'guess', word: 'crane' }, 0);
    expect(canAct(state, 0)).toBe(false);
    expect(refuse(state, { type: 'guess', word: 'blank' }, 0)).toMatch(/already solved/i);
  });

  it('cuts a player off after their last guess', () => {
    let state = started();
    for (let i = 0; i < MAX_GUESSES; i++) {
      state = play(state, { type: 'guess', word: 'blank' }, 0);
    }
    expect(isFinished(state, 0)).toBe(true);
    expect(refuse(state, { type: 'guess', word: 'blank' }, 0)).toMatch(/out of guesses/i);
  });

  it('refuses a move from a seat that is not at the table', () => {
    expect(refuse(started(), { type: 'guess', word: 'blank' }, 2)).toMatch(/not playing/i);
  });
});

describe('finishing', () => {
  /** Burn `count` wrong guesses for `seat`. */
  function waste(state: WordleState, seat: number, count: number): WordleState {
    for (let i = 0; i < count; i++) state = play(state, { type: 'guess', word: 'blank' }, seat);
    return state;
  }

  it('gives it to whoever needed fewer guesses', () => {
    let state = started();
    state = waste(state, 0, 1);
    state = play(state, { type: 'guess', word: 'crane' }, 0); // seat 0 in 2
    state = waste(state, 1, 3);
    state = play(state, { type: 'guess', word: 'slate' }, 1); // seat 1 in 4

    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(state.draw).toBe(false);
    expect(wordle.status(state, ['Amelia', 'Sam'])).toBe('Amelia wins in 2 guesses');
  });

  it('calls the same guess count a draw', () => {
    let state = started();
    state = play(state, { type: 'guess', word: 'crane' }, 0);
    state = play(state, { type: 'guess', word: 'slate' }, 1);
    expect(state.winner).toBeNull();
    expect(state.draw).toBe(true);
    expect(wordle.status(state, ['Amelia', 'Sam'])).toMatch(/draw/i);
  });

  it('lets a solver beat someone who never got there', () => {
    let state = waste(started(), 1, MAX_GUESSES);
    expect(wordle.isOver(state)).toBe(false); // seat 0 still has their turn
    state = waste(state, 0, MAX_GUESSES - 1);
    state = play(state, { type: 'guess', word: 'crane' }, 0);
    expect(state.winner).toBe(0);
  });

  it('is a draw when neither word is cracked', () => {
    let state = waste(started(), 0, MAX_GUESSES);
    state = waste(state, 1, MAX_GUESSES);
    expect(state.phase).toBe('over');
    expect(state.draw).toBe(true);
    expect(state.winner).toBeNull();
    expect(refuse(state, { type: 'guess', word: 'blank' }, 0)).toMatch(/already over/i);
  });

  it('reports no turn and no action once it is over', () => {
    let state = waste(started(), 0, MAX_GUESSES);
    state = waste(state, 1, MAX_GUESSES);
    expect(wordle.turn(state)).toBeNull();
    expect(canAct(state, 0)).toBe(false);
    expect(canAct(state, 1)).toBe(false);
  });
});

describe('what each player is shown', () => {
  it('never shows a player the word they are supposed to be guessing', () => {
    const state = started();
    const seen = wordle.view!(state, 0);
    expect(seen.secrets[0]).toBe('SLATE'); // their own, theirs to see
    expect(seen.secrets[1]).toBe(HIDDEN); // the one they are hunting
    expect(JSON.stringify(seen)).not.toContain('CRANE');
  });

  it('distinguishes an opponent still choosing from one who has chosen', () => {
    const state = play(fresh(), { type: 'setWord', word: 'slate' }, 0);
    expect(wordle.view!(state, 0).secrets[1]).toBeNull();
    expect(wordle.view!(state, 1).secrets[0]).toBe(HIDDEN);
  });

  it('shows both players every guess and mark, which they could derive anyway', () => {
    const state = play(started(), { type: 'guess', word: 'blank' }, 1);
    const seen = wordle.view!(state, 0);
    expect(seen.guesses[1][0].word).toBe('BLANK');
    expect(seen.guesses[1][0].marks).toEqual(markGuess('BLANK', 'SLATE'));
  });

  it('stops masking a word from the player who has just solved it', () => {
    const state = play(started(), { type: 'guess', word: 'crane' }, 0);
    expect(state.phase).toBe('play'); // seat 1 is still going
    expect(wordle.view!(state, 0).secrets[1]).toBe('CRANE');
    // Seat 1 has solved nothing and is still told nothing.
    expect(wordle.view!(state, 1).secrets[0]).toBe(HIDDEN);
  });

  it('reveals both words once the game is over', () => {
    let state = started();
    state = play(state, { type: 'guess', word: 'crane' }, 0);
    state = play(state, { type: 'guess', word: 'slate' }, 1);
    expect(wordle.view!(state, 0).secrets).toEqual(['SLATE', 'CRANE']);
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const state = started();
    const before = JSON.stringify(state);
    play(state, { type: 'guess', word: 'blank' }, 0);
    play(state, { type: 'guess', word: 'crane' }, 0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('gives the same answer every time for the same input', () => {
    const a = play(started(), { type: 'guess', word: 'blank' }, 0);
    const b = play(started(), { type: 'guess', word: 'blank' }, 0);
    expect(a).toEqual(b);
  });
});

describe('the turn hint', () => {
  it('points at whoever has played fewer rows', () => {
    let state = started();
    expect(wordle.turn(state)).toBe(0);
    state = play(state, { type: 'guess', word: 'blank' }, 0);
    expect(wordle.turn(state)).toBe(1);
  });

  it('points at the only player who can still move', () => {
    let state = started();
    for (let i = 0; i < MAX_GUESSES; i++) {
      state = play(state, { type: 'guess', word: 'blank' }, 0);
    }
    expect(wordle.turn(state)).toBe(1);
  });
});

describe('the keyboard', () => {
  /** Mark `guess` against `secret` the way a real row would be. */
  const row = (guess: string, secret: string) => ({
    word: guess,
    marks: markGuess(guess, secret),
  });

  it('has every letter exactly once', () => {
    const letters = KEY_ROWS.join('');
    expect(letters).toHaveLength(26);
    expect(new Set(letters).size).toBe(26);
  });

  it('says nothing before the first guess', () => {
    expect(keyMarks([])).toEqual({});
  });

  it('colours a letter by what it turned out to be', () => {
    // CRANE against CIGAR: C green, A and R yellow, N and E absent.
    const marks = keyMarks([row('CRANE', 'CIGAR')]);
    expect(marks).toEqual({ C: 'hit', R: 'near', A: 'near', N: 'miss', E: 'miss' });
  });

  it('promotes a yellow to green when a later guess places it', () => {
    // A is yellow in CRANE and green in ABIDE. The key must end up green.
    const marks = keyMarks([row('CRANE', 'ABIDE'), row('ABIDE', 'ABIDE')]);
    expect(marks.A).toBe('hit');
  });

  it('never demotes a letter it has already placed', () => {
    // The reverse order: green first, then a guess where that A is marked
    // grey because ABIDE's only A was claimed elsewhere in the row.
    const marks = keyMarks([row('ABIDE', 'ABIDE'), row('AROMA', 'ABIDE')]);
    expect(marks.A).toBe('hit');
  });

  it('leaves a letter nobody has tried out of the map entirely', () => {
    // The difference between "grey" and "not yet guessed" is the whole point.
    const marks = keyMarks([row('CRANE', 'CIGAR')]);
    expect(marks.Z).toBeUndefined();
    expect('N' in marks).toBe(true);
  });
});
