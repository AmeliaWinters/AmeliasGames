import { describe, it, expect } from 'vitest';
import {
  ALPHABET,
  BLANK,
  CONSONANTS,
  PUZZLES,
  ROUNDS,
  ROUND_MINIMUM,
  VOWELS,
  VOWEL_COST,
  WHEEL,
  leaders,
  mask,
  money,
  normalize,
  occurrences,
  remaining,
  seatCount,
  wheel,
  type WofMove,
  type WofState,
} from './wheel.js';
import { RoomEngine } from '../room.js';
import type { MoveResult } from '../types.js';

/** A position to hang a specific test on. Seat count follows `bank` if given. */
function position(overrides: Partial<WofState> = {}): WofState {
  const seats = overrides.bank?.length ?? overrides.score?.length ?? 2;
  return {
    round: 1,
    category: 'Phrase',
    answer: 'A PIECE OF CAKE',
    used: [],
    called: [],
    starter: 0,
    turn: 0,
    phase: 'spin',
    wedge: null,
    bank: Array<number>(seats).fill(0),
    score: Array<number>(seats).fill(0),
    note: null,
    roundOver: false,
    over: false,
    ...overrides,
  };
}

const never = () => 0;

const apply = (
  state: WofState,
  move: unknown,
  seat: number,
  rng: () => number = never,
): MoveResult<WofState> => wheel.applyMove(state, move as WofMove, seat, rng);

/** Asserts the move was accepted and hands back the state it produced. */
function ok(result: MoveResult<WofState>): WofState {
  if (!result.ok) throw new Error(`unexpected rejection: ${result.error}`);
  return result.state;
}

function rejection(result: MoveResult<WofState>): string {
  if (result.ok) throw new Error('expected this move to be refused');
  return result.error;
}

/** Wedge positions found by kind, so reordering the wheel does not break tests. */
const CASH = WHEEL.findIndex((w) => w.kind === 'cash');
const BANKRUPT = WHEEL.findIndex((w) => w.kind === 'bankrupt');
const LOSE_TURN = WHEEL.findIndex((w) => w.kind === 'lose-turn');
const cashValue = (index: number) => {
  const w = WHEEL[index];
  return w.kind === 'cash' ? w.value : 0;
};

/** An rng that always stops the wheel on one wedge. */
const spinTo = (index: number) => () => (index + 0.5) / WHEEL.length;

/** Deterministic noise, so a "random" game is the same random game every run. */
function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spin onto a cash wedge and take the state where a consonant is owed. */
function spun(state: WofState, seat = state.turn, index = CASH): WofState {
  return ok(apply(state, { type: 'spin' }, seat, spinTo(index)));
}

describe('setup', () => {
  it.each([2, 3, 4])('lays out one seat per player for a table of %i', (players) => {
    const s = wheel.setup(players, seeded(7));
    expect(s.bank).toHaveLength(players);
    expect(s.score).toHaveLength(players);
    expect(seatCount(s)).toBe(players);
    expect(s.turn).toBeLessThan(players);
    expect(s.starter).toBe(s.turn);
  });

  it('clamps a table size the game cannot seat', () => {
    // The room clamps too, but a reducer that divides by `seats` cannot afford
    // to find out that it was handed a zero.
    expect(seatCount(wheel.setup(0, never))).toBe(wheel.minPlayers);
    expect(seatCount(wheel.setup(99, never))).toBe(wheel.maxPlayers);
    expect(seatCount(wheel.setup(NaN, never))).toBe(wheel.minPlayers);
  });

  it('opens on a real puzzle with nobody ahead', () => {
    const s = wheel.setup(2, seeded(3));
    expect(PUZZLES.some((p) => p.answer === s.answer && p.category === s.category)).toBe(true);
    expect(s.bank).toEqual([0, 0]);
    expect(s.score).toEqual([0, 0]);
    expect(s.called).toEqual([]);
    expect(s.round).toBe(1);
    expect(s.phase).toBe('spin');
    expect(wheel.isOver(s)).toBe(false);
  });

  it('decides who opens by chance rather than by who made the room', () => {
    expect(wheel.setup(4, () => 0.1).starter).toBe(0);
    expect(wheel.setup(4, () => 0.9).starter).toBe(3);
  });

  it('is a pure function of its rng', () => {
    expect(wheel.setup(3, seeded(11))).toEqual(wheel.setup(3, seeded(11)));
  });
});

describe('the puzzle bank', () => {
  it('holds only characters the mask knows how to handle', () => {
    for (const { answer } of PUZZLES) {
      expect(answer, answer).toMatch(/^[A-Z' ]+$/);
      expect(answer.includes(BLANK), answer).toBe(false);
      expect(answer.trim(), answer).toBe(answer);
      expect(answer.includes('  '), answer).toBe(false);
    }
  });

  it('gives every puzzle both a consonant to win and a vowel to buy', () => {
    for (const { answer } of PUZZLES) {
      expect([...CONSONANTS].some((c) => answer.includes(c)), answer).toBe(true);
      expect([...VOWELS].some((v) => answer.includes(v)), answer).toBe(true);
    }
  });

  it('never lists the same answer twice', () => {
    expect(new Set(PUZZLES.map((p) => p.answer)).size).toBe(PUZZLES.length);
  });

  it('stays inside what the board can draw', () => {
    // The board lays a tile per character and wraps whole words. A word wider
    // than the phone it is on has nowhere to go.
    for (const { answer } of PUZZLES) {
      expect(answer.length, answer).toBeLessThanOrEqual(30);
      for (const word of answer.split(' ')) expect(word.length, word).toBeLessThanOrEqual(12);
    }
  });

  it('has far more puzzles than a match can use', () => {
    expect(PUZZLES.length).toBeGreaterThan(ROUNDS * 4);
    expect(PUZZLES.every((p) => p.category.length > 0)).toBe(true);
  });
});

describe('hiding the answer', () => {
  it('replaces every uncalled letter and keeps everything else', () => {
    expect(mask('A PIECE OF CAKE', [])).toBe('_ _____ __ ____');
    expect(mask('A PIECE OF CAKE', ['E'])).toBe('_ __E_E __ ___E');
    expect(mask("A BAKER'S DOZEN", ['A'])).toBe("A _A___'_ _____");
  });

  it('never sends a letter nobody has called', () => {
    // The whole game rests on this: the client is handed the state, so an
    // answer that reaches it is an answer anyone can read out of devtools.
    for (const { answer } of PUZZLES) {
      const seen = wheel.view!(position({ answer }), 0);
      expect(seen.answer, answer).not.toBe(answer);
      expect(seen.answer, answer).not.toMatch(/[A-Z]/);
      expect(seen.answer.length, answer).toBe(answer.length);
    }
  });

  it('reveals exactly the letters that have been called', () => {
    const seen = wheel.view!(position({ answer: 'A PIECE OF CAKE', called: ['C', 'E'] }), 0);
    expect(seen.answer).toBe('_ __ECE __ C__E');
  });

  it('hides the same amount from every seat', () => {
    const state = position({ answer: 'GARDEN SHED', called: ['D'] });
    expect(wheel.view!(state, 0)).toEqual(wheel.view!(state, 1));
  });

  it('shows the whole phrase once the round is over', () => {
    const state = position({ answer: 'GARDEN SHED', roundOver: true });
    expect(wheel.view!(state, 0).answer).toBe('GARDEN SHED');
  });

  it('never names the answer in the status line', () => {
    for (const { answer } of PUZZLES) {
      const line = wheel.status(position({ answer }), ['Ann', 'Bo']);
      expect(line, answer).not.toContain(answer);
    }
  });

  it('is redacted by the room, not merely available to be', () => {
    // `view` only protects anything if the room actually calls it on the way
    // out. This is the assertion that the wiring is real.
    const room = RoomEngine.create('TEST', 'wheel', seeded(5), 2)!;
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    const sent = room.viewFor(0, new Set([0, 1])).state as WofState;
    expect(sent.answer).not.toMatch(/[A-Z]/);
    expect(sent.answer).toContain(BLANK);
  });
});

describe('the wheel', () => {
  it('asks for a consonant when it stops on money', () => {
    const s = spun(position());
    expect(s.phase).toBe('call');
    expect(s.wedge).toEqual({ kind: 'cash', value: cashValue(CASH) });
    expect(s.turn).toBe(0);
  });

  it('takes the round bank on Bankrupt but never the banked score', () => {
    const start = position({ bank: [1200, 0], score: [4000, 0] });
    const s = ok(apply(start, { type: 'spin' }, 0, spinTo(BANKRUPT)));
    expect(s.bank[0]).toBe(0);
    expect(s.score[0]).toBe(4000);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('spin');
    expect(s.wedge).toBeNull();
    expect(s.note?.text).toMatch(/Bankrupt/);
  });

  it('passes the turn on Lose a Turn without touching the money', () => {
    const start = position({ bank: [1200, 0] });
    const s = ok(apply(start, { type: 'spin' }, 0, spinTo(LOSE_TURN)));
    expect(s.bank).toEqual([1200, 0]);
    expect(s.turn).toBe(1);
    expect(s.note?.text).toMatch(/Lose a Turn/);
  });

  it('lands on a real wedge however badly the rng behaves', () => {
    // Rng is documented as [0, 1). A hand-written one returning exactly 1 would
    // otherwise index past the end of the wheel and hand back undefined.
    for (const rng of [() => 0, () => 1, () => -1, () => NaN, () => 0.999999999]) {
      const s = ok(apply(position(), { type: 'spin' }, 0, rng));
      expect(s.wedge === null || WHEEL.some((w) => w.kind === s.wedge?.kind)).toBe(true);
      expect(s.note).not.toBeNull();
    }
  });

  it('will not spin while a consonant is owed', () => {
    expect(rejection(apply(spun(position()), { type: 'spin' }, 0))).toMatch(/consonant/i);
  });
});

describe('consonants', () => {
  it('pays per occurrence and keeps the turn', () => {
    const s = ok(apply(spun(position({ answer: 'A CUP OF TEA' })), { type: 'letter', letter: 'C' }, 0));
    expect(s.bank[0]).toBe(cashValue(CASH));
    expect(s.turn).toBe(0);
    expect(s.phase).toBe('spin');
    // The spin is spent — another consonant needs another one.
    expect(s.wedge).toBeNull();
    expect(s.called).toEqual(['C']);
  });

  it('multiplies by how many there are', () => {
    const answer = 'THE KITCHEN SINK';
    expect(occurrences(answer, 'T')).toBe(2);
    const s = ok(apply(spun(position({ answer })), { type: 'letter', letter: 'T' }, 0));
    expect(s.bank[0]).toBe(cashValue(CASH) * 2);
    expect(s.note?.text).toContain(money(cashValue(CASH) * 2));
  });

  it('passes the turn when the letter is not there', () => {
    const s = ok(apply(spun(position({ answer: 'A CUP OF TEA' })), { type: 'letter', letter: 'Z' }, 0));
    expect(s.bank[0]).toBe(0);
    expect(s.turn).toBe(1);
    expect(s.called).toEqual(['Z']);
    expect(s.note?.text).toMatch(/no Z/i);
  });

  it('refuses a vowel while a consonant is owed', () => {
    expect(rejection(apply(spun(position()), { type: 'letter', letter: 'E' }, 0))).toMatch(
      /consonant/i,
    );
  });

  it('refuses a consonant nobody spun for', () => {
    expect(rejection(apply(position(), { type: 'letter', letter: 'C' }, 0))).toMatch(/spin/i);
  });

  it('refuses a letter already called', () => {
    const s = spun(position({ called: ['C'] }));
    expect(rejection(apply(s, { type: 'letter', letter: 'C' }, 0))).toMatch(/already/i);
  });

  it.each(['', '1', 'AB', '#', ' '])('refuses %p as a letter', (letter) => {
    expect(rejection(apply(spun(position()), { type: 'letter', letter }, 0))).toMatch(/not a letter/i);
  });

  it('accepts a lowercase letter rather than punishing the client for it', () => {
    const s = ok(apply(spun(position({ answer: 'A CUP OF TEA' })), { type: 'letter', letter: 'c' }, 0));
    expect(s.called).toEqual(['C']);
  });

  it('hands the turn on rather than stranding a player when every consonant is gone', () => {
    // Otherwise the only legal move in the `call` phase no longer exists.
    const s = ok(apply(position({ called: [...CONSONANTS] }), { type: 'spin' }, 0, spinTo(CASH)));
    expect(s.phase).toBe('spin');
    expect(s.turn).toBe(1);
    expect(s.note?.text).toMatch(/every consonant is gone/i);
  });
});

describe('vowels', () => {
  it('costs the same whether or not it is there', () => {
    const rich = position({ answer: 'A CUP OF TEA', bank: [1000, 0] });
    expect(ok(apply(rich, { type: 'letter', letter: 'E' }, 0)).bank[0]).toBe(1000 - VOWEL_COST);
    expect(ok(apply(rich, { type: 'letter', letter: 'I' }, 0)).bank[0]).toBe(1000 - VOWEL_COST);
  });

  it('keeps the turn when the vowel is there and hands it over when it is not', () => {
    const rich = position({ answer: 'A CUP OF TEA', bank: [1000, 0] });
    expect(ok(apply(rich, { type: 'letter', letter: 'E' }, 0)).turn).toBe(0);
    expect(ok(apply(rich, { type: 'letter', letter: 'I' }, 0)).turn).toBe(1);
  });

  it('refuses a vowel nobody can afford', () => {
    const broke = position({ bank: [VOWEL_COST - 1, 0] });
    expect(rejection(apply(broke, { type: 'letter', letter: 'E' }, 0))).toContain(money(VOWEL_COST));
  });

  it('sells it at exactly the asking price', () => {
    const s = position({ answer: 'A CUP OF TEA', bank: [VOWEL_COST, 0] });
    expect(ok(apply(s, { type: 'letter', letter: 'E' }, 0)).bank[0]).toBe(0);
  });
});

describe('solving', () => {
  const start = position({ answer: 'A PIECE OF CAKE', bank: [3000, 0] });

  it('takes the round and banks the money', () => {
    const s = ok(apply(start, { type: 'solve', answer: 'A PIECE OF CAKE' }, 0));
    expect(s.roundOver).toBe(true);
    expect(s.score[0]).toBe(3000);
    expect(s.note?.text).toMatch(/solved/i);
    // And the board now shows the whole phrase.
    expect(wheel.view!(s, 1).answer).toBe('A PIECE OF CAKE');
  });

  it.each([
    'a piece of cake',
    '  A Piece Of Cake  ',
    'APIECEOFCAKE',
    'a-piece-of-cake!',
  ])('accepts %p', (guess) => {
    expect(ok(apply(start, { type: 'solve', answer: guess }, 0)).roundOver).toBe(true);
  });

  it('ignores an apostrophe the player did not type', () => {
    const s = position({ answer: "A BAKER'S DOZEN" });
    expect(ok(apply(s, { type: 'solve', answer: 'a bakers dozen' }, 0)).roundOver).toBe(true);
  });

  it('passes the turn on a wrong answer', () => {
    const s = ok(apply(start, { type: 'solve', answer: 'A SLICE OF CAKE' }, 0));
    expect(s.roundOver).toBe(false);
    expect(s.turn).toBe(1);
    expect(s.score[0]).toBe(0);
    // Losing the turn costs the bank nothing; Bankrupt is the only thing that does.
    expect(s.bank[0]).toBe(3000);
  });

  it('refuses an empty answer rather than spending the turn on it', () => {
    expect(rejection(apply(start, { type: 'solve', answer: '   ' }, 0))).toMatch(/type an answer/i);
  });

  it('refuses a solve while a consonant is owed', () => {
    const owed = spun(start);
    expect(rejection(apply(owed, { type: 'solve', answer: 'A PIECE OF CAKE' }, 0))).toMatch(
      /consonant/i,
    );
  });

  it('pays the minimum to someone who solves with nothing in the bank', () => {
    const s = ok(apply(position({ bank: [0, 0] }), { type: 'solve', answer: 'A PIECE OF CAKE' }, 0));
    expect(s.score[0]).toBe(ROUND_MINIMUM);
  });

  it('takes the round when the last letter goes up, with no solve needed', () => {
    // There is nothing left to solve, and no state worth having where the
    // board is complete and the game is still waiting to be told so.
    const answer = 'GARDEN SHED';
    const called = [...new Set([...answer])].filter((c) => ALPHABET.includes(c) && c !== 'N');
    const s = ok(apply(spun(position({ answer, called })), { type: 'letter', letter: 'N' }, 0));
    expect(s.roundOver).toBe(true);
    expect(s.score[0]).toBeGreaterThan(0);
    expect(s.note?.text).toMatch(/that's the puzzle/i);
  });
});

describe('rounds', () => {
  const solved = () => ok(apply(position(), { type: 'solve', answer: 'A PIECE OF CAKE' }, 0));

  it('refuses everything but `next` once the round is over', () => {
    const s = solved();
    for (const move of [{ type: 'spin' }, { type: 'letter', letter: 'B' }, { type: 'solve', answer: 'X' }]) {
      expect(rejection(apply(s, move, s.turn))).toMatch(/finished/i);
    }
  });

  it('refuses `next` while the round is still going', () => {
    expect(rejection(apply(position(), { type: 'next' }, 0))).toMatch(/still going/i);
  });

  it('deals a fresh puzzle and clears the round bank', () => {
    const s = solved();
    const round2 = ok(apply(s, { type: 'next' }, s.turn, seeded(2)));
    expect(round2.round).toBe(2);
    expect(round2.roundOver).toBe(false);
    expect(round2.called).toEqual([]);
    expect(round2.bank).toEqual([0, 0]);
    expect(round2.note).toBeNull();
    // The banked score survives the round boundary; that is the whole point of it.
    expect(round2.score).toEqual(s.score);
    expect(round2.answer).not.toBe('A PIECE OF CAKE');
  });

  it('opens the next round with the next player round the table', () => {
    const s = solved();
    expect(s.turn).toBe(1);
    expect(ok(apply(s, { type: 'next' }, 1, seeded(2))).turn).toBe(1);
  });

  it('never sets the same puzzle twice in one match', () => {
    let state = wheel.setup(2, seeded(19));
    const seen = [state.answer];
    for (let round = 1; round < ROUNDS; round++) {
      state = ok(apply(state, { type: 'solve', answer: state.answer }, state.turn));
      state = ok(apply(state, { type: 'next' }, state.turn, seeded(round * 31)));
      seen.push(state.answer);
    }
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('ends the match after the last round rather than dealing another', () => {
    let state = wheel.setup(2, seeded(23));
    for (let round = 1; round <= ROUNDS; round++) {
      state = ok(apply(state, { type: 'solve', answer: state.answer }, state.turn));
      if (round < ROUNDS) state = ok(apply(state, { type: 'next' }, state.turn, seeded(round)));
    }
    expect(state.round).toBe(ROUNDS);
    expect(state.over).toBe(true);
    expect(wheel.isOver(state)).toBe(true);
    expect(wheel.turn(state)).toBeNull();
    expect(rejection(apply(state, { type: 'next' }, state.turn))).toMatch(/already over/i);
  });
});

describe('more than two at the table', () => {
  it('walks the turn round the table', () => {
    let state = position({ bank: [0, 0, 0, 0], score: [0, 0, 0, 0] });
    for (const expected of [1, 2, 3, 0]) {
      state = ok(apply(state, { type: 'spin' }, state.turn, spinTo(LOSE_TURN)));
      expect(state.turn).toBe(expected);
    }
  });

  it('rotates who opens each round', () => {
    let state = position({ bank: [0, 0, 0], score: [0, 0, 0], starter: 2, turn: 2 });
    state = ok(apply(state, { type: 'solve', answer: 'A PIECE OF CAKE' }, 2));
    expect(state.starter).toBe(0);
    expect(ok(apply(state, { type: 'next' }, 0, seeded(4))).turn).toBe(0);
  });

  it('names a single winner and a tie by their scores', () => {
    const names = ['Ann', 'Bo', 'Cai'];
    const won = position({ score: [900, 100, 100], bank: [0, 0, 0], over: true });
    expect(wheel.status(won, names)).toBe('Ann wins with $900');

    const tied = position({ score: [900, 900, 100], bank: [0, 0, 0], over: true });
    expect(wheel.status(tied, names)).toContain('Ann and Bo');
    expect(leaders(tied)).toEqual([0, 1]);
  });
});

describe('the contract', () => {
  it('refuses a move from the seat that is not to play', () => {
    expect(rejection(apply(position(), { type: 'spin' }, 1))).toMatch(/not your turn/i);
  });

  it.each([null, undefined, 'spin', 42, { type: 'teleport' }])('refuses %p as a move', (move) => {
    expect(apply(position(), move, 0).ok).toBe(false);
  });

  it('never mutates the state it is given', () => {
    const moves: unknown[] = [
      { type: 'spin' },
      { type: 'solve', answer: 'A PIECE OF CAKE' },
      { type: 'letter', letter: 'E' },
    ];
    for (const move of moves) {
      const state = position({ bank: [1000, 0] });
      const before = JSON.stringify(state);
      apply(state, move, 0, spinTo(BANKRUPT));
      expect(JSON.stringify(state), JSON.stringify(move)).toBe(before);
    }
    // And the same for the round boundary, which rebuilds most of the state.
    const finished = ok(apply(position(), { type: 'solve', answer: 'A PIECE OF CAKE' }, 0));
    const before = JSON.stringify(finished);
    apply(finished, { type: 'next' }, finished.turn, seeded(1));
    expect(JSON.stringify(finished)).toBe(before);
  });

  it('gives the same answer to the same rng', () => {
    const a = apply(position(), { type: 'spin' }, 0, seeded(9));
    const b = apply(position(), { type: 'spin' }, 0, seeded(9));
    expect(a).toEqual(b);
  });

  it('reports the turn as nobody once the match is over', () => {
    expect(wheel.turn(position({ over: true }))).toBeNull();
    expect(wheel.turn(position())).toBe(0);
  });
});

describe('helpers', () => {
  it('groups money the way it is read aloud', () => {
    expect(money(0)).toBe('$0');
    expect(money(500)).toBe('$500');
    expect(money(1250)).toBe('$1,250');
    expect(money(1234567)).toBe('$1,234,567');
  });

  it('reduces a guess to the letters that matter', () => {
    expect(normalize("  it's  a  test! ")).toBe('ITSATEST');
    expect(normalize('')).toBe('');
  });

  it('caps a guess before working on it', () => {
    // A hostile client is not owed an unbounded string to normalise.
    expect(normalize('A'.repeat(10_000)).length).toBeLessThanOrEqual(200);
  });

  it('reports what is left to call', () => {
    expect(remaining(VOWELS, ['A', 'E'])).toEqual(['I', 'O', 'U']);
    expect(remaining(CONSONANTS, [...CONSONANTS])).toEqual([]);
  });
});

describe('full games', () => {
  /**
   * Plays whole matches with a seeded rng, checking after every accepted move
   * that the money, the turn and the round are all still somewhere they could
   * legitimately be. The move cap is not decoration: it is what would catch a
   * round that can no longer be brought to an end.
   */
  it.each([2, 3, 4])('plays 40 random matches at a table of %i', (players) => {
    for (let game = 0; game < 40; game++) {
      const rng = seeded(game * 977 + players);
      let state = wheel.setup(players, rng);
      let previous = state.score.slice();
      let moves = 0;
      let awards = 0;
      const seen: string[] = [state.answer];

      while (!state.over) {
        if (++moves > 2000) throw new Error('a match failed to reach an end');

        const seat = state.turn;
        let move: WofMove;
        if (state.roundOver) {
          move = { type: 'next' };
        } else if (state.phase === 'call') {
          const pool = remaining(CONSONANTS, state.called);
          move = { type: 'letter', letter: pool[Math.floor(rng() * pool.length)] };
        } else {
          const vowels = remaining(VOWELS, state.called);
          const roll = rng();
          if (roll < 0.12) move = { type: 'solve', answer: state.answer };
          else if (roll < 0.3 && vowels.length > 0 && state.bank[seat] >= VOWEL_COST) {
            move = { type: 'letter', letter: vowels[Math.floor(rng() * vowels.length)] };
          } else move = { type: 'spin' };
        }

        const before = state;
        state = ok(apply(state, move, seat, rng));

        // The accounting identity, and the wheel's analogue of backgammon's
        // checker conservation: a round pays exactly one seat, and it is the
        // seat that solved it. Nothing else distinguishes awarding to `seat`
        // from awarding to `state.turn`, or from awarding twice.
        if (state.roundOver && !before.roundOver) {
          const gained = state.score.map((n, i) => n - before.score[i]);
          expect(gained.filter((n) => n > 0)).toHaveLength(1);
          // Against the bank as it stands at the award, not before the move:
          // the winning call's own money counts, and awardRound floors the
          // bank at ROUND_MINIMUM before paying it out.
          expect(gained[seat]).toBe(state.bank[seat]);
          expect(state.bank[seat]).toBeGreaterThanOrEqual(ROUND_MINIMUM);
          awards++;
        }

        // Masking, checked on a live game rather than only on a fresh puzzle.
        // This is what would catch `roundOver` being set one move early — the
        // single failure that ruins the game silently, and the one the static
        // per-puzzle assertion cannot see.
        if (!state.roundOver) {
          expect(wheel.view!(state, state.turn).answer).toBe(mask(state.answer, state.called));
        }

        expect(state.bank.every((n) => n >= 0)).toBe(true);
        expect(state.score.every((n) => n >= 0)).toBe(true);
        // Money that has been banked is never taken back — not by Bankrupt,
        // not by a lost turn, not by a new round.
        expect(state.score.every((n, i) => n >= previous[i])).toBe(true);
        expect(state.turn).toBeGreaterThanOrEqual(0);
        expect(state.turn).toBeLessThan(players);
        expect(state.round).toBeGreaterThanOrEqual(1);
        expect(state.round).toBeLessThanOrEqual(ROUNDS);
        expect(new Set(state.called).size).toBe(state.called.length);
        expect(state.bank).toHaveLength(players);
        if (state.over) expect(state.roundOver).toBe(true);
        if (state.round !== before.round) seen.push(state.answer);
        previous = state.score.slice();
      }

      expect(state.round).toBe(ROUNDS);
      // Every round paid out exactly once, across the whole match.
      expect(awards).toBe(ROUNDS);
      // A match never repeats a puzzle, checked over random play rather than
      // in one hand-driven three-round game.
      expect(new Set(seen).size).toBe(seen.length);
      // Somebody has to have won something: every round pays its winner.
      expect(Math.max(...state.score)).toBeGreaterThanOrEqual(ROUND_MINIMUM);
      expect(leaders(state).length).toBeGreaterThanOrEqual(1);
    }
  });
});
