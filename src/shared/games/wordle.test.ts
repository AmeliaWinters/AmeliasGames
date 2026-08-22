import { describe, expect, it } from 'vitest';
import {
  GUESS_MS,
  HIDDEN,
  KEY_ROWS,
  MAX_GUESSES,
  canAct,
  isFinished,
  keyMarks,
  markGuess,
  msLeftFor,
  outOfTime,
  wordle,
} from './wordle.js';
import type { WordleState } from './wordle.js';
import { DUEL_WORDS } from './words.js';

/**
 * No move in this game consults the rng, so a poisoned one proves it. `setup`
 * is the exception and always was going to be: it draws the ring saying who
 * guesses whose word.
 */
const noRng = () => {
  throw new Error('wordle must not use randomness once it is under way');
};

/**
 * Fixed, and it does not matter: at two players there is exactly one ring
 * without a seat pointing at itself, so `setup` returns [1, 0] whatever this
 * says. The multi-player tests below vary it deliberately.
 */
const flat = () => 0;

function fresh(): WordleState {
  return wordle.setup(2, flat);
}

/** Apply a move that is expected to succeed, or fail loudly with its reason. */
function play(state: WordleState, move: unknown, seat: number): WordleState {
  const result = wordle.applyMove(state, move as never, seat, noRng);
  if (!result.ok) throw new Error(`move rejected: ${result.error}`);
  return result.state;
}

function refuse(state: WordleState, move: unknown, seat: number, now?: number): string {
  const result = wordle.applyMove(state, move as never, seat, noRng, now);
  if (result.ok) throw new Error('expected the move to be rejected');
  return result.error;
}

/**
 * A move at a stated moment. The shot clock makes `now` part of the rules, and
 * a test that let it default to the wall clock would be asserting against a
 * number it did not choose.
 */
function playAt(state: WordleState, move: unknown, seat: number, now: number): WordleState {
  const result = wordle.applyMove(state, move as never, seat, noRng, now);
  if (!result.ok) throw new Error(`move rejected: ${result.error}`);
  return result.state;
}

/** An arbitrary but fixed epoch to hang the clock tests off. */
const T0 = 1_700_000_000_000;

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


describe('the shot clock', () => {
  it('leaves everybody untimed until somebody guesses', () => {
    const state = started();
    expect(state.dueBy).toEqual([null, null]);
    expect(wordle.deadline?.(state)).toBeNull();
    expect(wordle.expire?.(state, T0 + 10 * GUESS_MS)).toBeNull();
  });

  it('puts the other player on a minute and takes the guesser off', () => {
    const state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    expect(state.dueBy).toEqual([null, T0 + GUESS_MS]);
    expect(wordle.deadline?.(state)).toBe(T0 + GUESS_MS);
    expect(msLeftFor(state, 1, T0 + 20_000)).toBe(GUESS_MS - 20_000);
    // No clock is not the same as no time left, and the board draws them
    // differently, so the two must not collapse into each other.
    expect(msLeftFor(state, 0, T0)).toBeNull();
    expect(outOfTime(state, 0, T0 + 10 * GUESS_MS)).toBe(false);
  });

  it('does not hand out a fresh minute for a second guess in a row', () => {
    // Otherwise a player could keep their opponent's clock topped up for ever
    // by guessing at them, and the clock would never actually run out.
    let state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    state = playAt(state, { type: 'guess', word: 'ledge' }, 0, T0 + 30_000);
    expect(state.dueBy).toEqual([null, T0 + GUESS_MS]);
  });

  it('swaps the clock over when the guess is answered', () => {
    let state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    state = playAt(state, { type: 'guess', word: 'blank' }, 1, T0 + 30_000);
    expect(state.dueBy).toEqual([T0 + 30_000 + GUESS_MS, null]);
  });

  it('keeps the last player standing on a clock of their own', () => {
    // Seat 1 solves and is finished, so no guess of theirs is ever coming to
    // restart seat 0's clock. Without this, seat 0 could sit on the game.
    let state = playAt(started(), { type: 'guess', word: 'slate' }, 1, T0);
    expect(state.solvedIn[1]).toBe(1);
    expect(state.dueBy).toEqual([T0 + GUESS_MS, null]);

    state = playAt(state, { type: 'guess', word: 'blank' }, 0, T0 + 10_000);
    expect(state.dueBy).toEqual([T0 + 10_000 + GUESS_MS, null]);
  });

  it('stops the clock the moment the game ends the ordinary way', () => {
    let state = started();
    for (let i = 0; i < MAX_GUESSES; i++) {
      state = playAt(state, { type: 'guess', word: 'blank' }, 0, T0);
      state = playAt(state, { type: 'guess', word: 'blank' }, 1, T0);
    }
    expect(state.phase).toBe('over');
    expect(state.dueBy).toEqual([null, null]);
    expect(state.timedOut).toEqual([]);
    expect(wordle.deadline?.(state)).toBeNull();
  });

  it('does nothing while the minute is still running', () => {
    const state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    expect(wordle.expire?.(state, T0 + GUESS_MS - 1)).toBeNull();
  });

  it('loses the game for whoever runs out', () => {
    const state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    const settled = wordle.expire?.(state, T0 + GUESS_MS);
    expect(settled).not.toBeNull();
    expect(settled?.phase).toBe('over');
    expect(settled?.timedOut).toEqual([1]);
    expect(settled?.winner).toBe(0);
    expect(settled?.draw).toBe(false);
    // Neither player solved anything. Running out of time is a loss all the
    // same, where two players simply failing would have been a draw.
    expect(settled?.solvedIn).toEqual([null, null]);
    expect(settled?.dueBy).toEqual([null, null]);
    expect(wordle.isOver(settled as WordleState)).toBe(true);
  });

  it('says so in the status line', () => {
    const state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    expect(wordle.status(state, ['Ada', 'Bo'])).toBe('Bo is on the clock');
    const settled = wordle.expire?.(state, T0 + GUESS_MS) as WordleState;
    expect(wordle.status(settled, ['Ada', 'Bo'])).toBe('Bo ran out of time — Ada wins');
  });

  it('points the turn hint at whoever is under the whistle', () => {
    const state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    expect(wordle.turn(state)).toBe(1);
  });

  it('refuses a guess that arrives after the whistle', () => {
    const state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    expect(refuse(state, { type: 'guess', word: 'blank' }, 1, T0 + GUESS_MS)).toMatch(
      /minute is up/i,
    );
  });

  it('never runs two clocks at once', () => {
    // The board draws one countdown and `expire` names one loser, and both
    // rest on this. Every guess either side can make, in every order.
    let state = started();
    let now = T0;
    for (let i = 0; i < MAX_GUESSES * 2; i++) {
      const seat = i % 3 === 0 ? 1 : 0;
      if (!canAct(state, seat)) continue;
      state = playAt(state, { type: 'guess', word: 'blank' }, seat, now);
      expect(state.dueBy.filter((at) => at !== null).length).toBeLessThanOrEqual(1);
      now += 5_000;
    }
  });

  it('does not mutate the state it settles', () => {
    const state = playAt(started(), { type: 'guess', word: 'blank' }, 0, T0);
    const before = JSON.stringify(state);
    wordle.expire?.(state, T0 + GUESS_MS);
    expect(JSON.stringify(state)).toBe(before);
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

// ── More than two at the table ─────────────────────────────────────────

/** Words straight from the list, so every one of them is certain to be legal. */
const WORDS = [...DUEL_WORDS].slice(0, 8);

/** Deterministic, so a failure here is reproducible. */
function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** A table of `count` players with every word set, so play has begun. */
function table(count: number, seed = 1): WordleState {
  let state = wordle.setup(count, seeded(seed));
  for (let seat = 0; seat < count; seat++) {
    state = play(state, { type: 'setWord', word: WORDS[seat] }, seat);
  }
  expect(state.phase).toBe('play');
  return state;
}

describe('who guesses whose word', () => {
  it('never points a player at their own word, at any table size', () => {
    // The whole reason `target` exists. Swept rather than sampled: this is the
    // one property the game is unplayable without.
    for (let count = 2; count <= 8; count++) {
      for (let seed = 0; seed < 60; seed++) {
        const { target } = wordle.setup(count, seeded(seed));
        expect(target).toHaveLength(count);
        for (let seat = 0; seat < count; seat++) {
          expect(target[seat], `seat ${seat} of ${count} was handed its own word`).not.toBe(seat);
        }
      }
    }
  });

  it('leaves no word unguessed and no player without one', () => {
    // A permutation, not just a derangement. Anything less means somebody sets
    // a word nobody is looking for, or sits with nothing to work on.
    for (let count = 2; count <= 8; count++) {
      for (let seed = 0; seed < 60; seed++) {
        const { target } = wordle.setup(count, seeded(seed));
        expect([...target].sort((a, b) => a - b)).toEqual(
          Array.from({ length: count }, (_, i) => i),
        );
      }
    }
  });

  it('does not always draw the same ring', () => {
    // Otherwise "randomise who gets which word" is a comment rather than a
    // behaviour. Four players have plenty of rings; two have exactly one, which
    // is why this asks four.
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) seen.add(wordle.setup(4, seeded(seed)).target.join(''));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('still has only one possible ring at two players', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(wordle.setup(2, seeded(seed)).target).toEqual([1, 0]);
    }
  });
});

describe('a table of more than two', () => {
  it('waits for every word before play starts', () => {
    let state = wordle.setup(4, seeded(3));
    state = play(state, { type: 'setWord', word: WORDS[0] }, 0);
    state = play(state, { type: 'setWord', word: WORDS[1] }, 1);
    expect(state.phase).toBe('setup');
    expect(wordle.status(state, ['A', 'B', 'C', 'D'])).toBe('Waiting on 2 more words');
    state = play(state, { type: 'setWord', word: WORDS[2] }, 2);
    expect(wordle.status(state, ['A', 'B', 'C', 'D'])).toBe('Waiting for D to choose a word');
    state = play(state, { type: 'setWord', word: WORDS[3] }, 3);
    expect(state.phase).toBe('play');
  });

  it('marks a guess against the word its target set, not seat 0 or 1', () => {
    const state = table(5, 7);
    const seat = 2;
    const secret = state.secrets[state.target[seat]] as string;
    const next = play(state, { type: 'guess', word: secret }, seat);
    expect(next.solvedIn[seat]).toBe(1);
  });

  it('refuses a seat that is not at the table', () => {
    const state = table(3);
    expect(refuse(state, { type: 'guess', word: WORDS[0] }, 3)).toMatch(/not playing/i);
    expect(refuse(state, { type: 'guess', word: WORDS[0] }, -1)).toMatch(/not playing/i);
  });

  it('puts everyone else on a clock when one player guesses', () => {
    const state = table(4, 11);
    const next = playAt(state, { type: 'guess', word: WORDS[0] }, 0, T0);
    expect(next.dueBy[0]).toBeNull();
    for (const seat of [1, 2, 3]) expect(next.dueBy[seat]).toBe(T0 + GUESS_MS);
  });

  it('does not let a fast player keep handing the others a fresh minute', () => {
    // The rule that stops a guess-spammer resetting everyone else's clock.
    const state = table(4, 11);
    let next = playAt(state, { type: 'guess', word: WORDS[0] }, 0, T0);
    next = playAt(next, { type: 'guess', word: WORDS[1] }, 0, T0 + 30_000);
    for (const seat of [1, 2, 3]) expect(next.dueBy[seat]).toBe(T0 + GUESS_MS);
  });

  it('ends the game when a timeout leaves only one player in it', () => {
    const state = table(4, 11);
    const ticking = playAt(state, { type: 'guess', word: WORDS[0] }, 0, T0);
    const settled = wordle.expire?.(ticking, T0 + GUESS_MS) as WordleState;

    expect(settled).not.toBeNull();
    // All three ran out together, which leaves one player - so it is over.
    expect(settled.timedOut).toEqual([1, 2, 3]);
    expect(settled.phase).toBe('over');
    expect(settled.winner).toBe(0);
  });

  it('carries on when a timeout still leaves two players in it', () => {
    const state = table(4, 11);
    // Seat 0 guesses, putting 1, 2 and 3 on the clock. Two of them answer, so
    // only seat 3's minute is still running when it runs out.
    let next = playAt(state, { type: 'guess', word: WORDS[0] }, 0, T0);
    next = playAt(next, { type: 'guess', word: WORDS[1] }, 1, T0 + 1000);
    next = playAt(next, { type: 'guess', word: WORDS[2] }, 2, T0 + 2000);

    const settled = wordle.expire?.(next, T0 + GUESS_MS) as WordleState;
    expect(settled).not.toBeNull();
    expect(settled.timedOut).toEqual([3]);
    expect(settled.phase).toBe('play');
    expect(canAct(settled, 3)).toBe(false);
    expect(canAct(settled, 0)).toBe(true);
    // Nobody is left without a clock, or the game could stall all over again.
    for (const seat of [0, 1, 2]) expect(settled.dueBy[seat]).not.toBeNull();
  });
});

describe('what a player at a big table may see', () => {
  it('hides every word but your own while it could still matter', () => {
    const state = table(5, 9);
    const seen = wordle.view?.(state, 2) as WordleState;
    expect(seen.secrets[2]).toBe(state.secrets[2]);
    for (const seat of [0, 1, 3, 4]) expect(seen.secrets[seat]).toBe(HIDDEN);
  });

  it('reveals the word you were hunting once you are finished with it', () => {
    let state = table(4, 13);
    const mine = state.target[1];
    state = play(state, { type: 'guess', word: state.secrets[mine] as string }, 1);
    const seen = wordle.view?.(state, 1) as WordleState;
    expect(seen.secrets[mine]).toBe(state.secrets[mine]);
  });

  it('does not hand a finished player another word to pass on', () => {
    // The one genuinely new leak above two players: a player who is done could
    // otherwise read a word that somebody else is still hunting.
    let state = table(4, 13);
    const mine = state.target[1];
    state = play(state, { type: 'guess', word: state.secrets[mine] as string }, 1);
    const seen = wordle.view?.(state, 1) as WordleState;
    for (const seat of [0, 1, 2, 3]) {
      if (seat === 1 || seat === mine) continue;
      expect(seen.secrets[seat]).toBe(HIDDEN);
    }
  });
});
