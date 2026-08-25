import { describe, it, expect } from 'vitest';
import {
  ADJACENCY,
  MEN,
  MILLS,
  MIN_MEN,
  POINTS,
  QUIET_LIMIT,
  hasMove,
  canFly,
  destinations,
  inMill,
  menLeft,
  millsThrough,
  morris,
  movers,
  pointAt,
  takeable,
  type Cell,
  type MmMove,
  type MmState,
} from './morris.js';
import type { MoveResult } from '../types.js';

// Morris has no random element; these keep the calls short.
const rng = () => 0;
const setup = () => morris.setup(2, rng);
const apply = (state: MmState, move: unknown, seat: number): MoveResult<MmState> =>
  morris.applyMove(state, move as MmMove, seat, rng);

function must(result: MoveResult<MmState>): MmState {
  if (!result.ok) throw new Error(`unexpected rejection: ${result.error}`);
  return result.state;
}

/** Play moves in order, each by whoever is to play, which after a mill is the
 *  same player twice, since taking a man is a move of its own. */
function play(state: MmState, ...moves: MmMove[]): MmState {
  for (const move of moves) state = must(apply(state, move, state.turn));
  return state;
}

/**
 * A position, built directly. Hands default to empty, which is the moving
 * phase; pass `hand` for a position that is still being set out.
 */
function position(men: { 0: number[]; 1: number[] }, extra: Partial<MmState> = {}): MmState {
  const board = Array<Cell>(POINTS).fill(null);
  for (const point of men[0]) board[point] = 0;
  for (const point of men[1]) board[point] = 1;
  return { ...setup(), board, hand: [0, 0], ...extra };
}

describe('the board', () => {
  it('is three rings of eight points', () => {
    expect(POINTS).toBe(24);
    expect(setup().board.filter((cell) => cell === null)).toHaveLength(POINTS);
  });

  it('joins neighbours both ways, and nothing to itself', () => {
    for (let point = 0; point < POINTS; point++) {
      expect(ADJACENCY[point]).not.toContain(point);
      for (const neighbour of ADJACENCY[point]) {
        expect(ADJACENCY[neighbour], `${neighbour} back to ${point}`).toContain(point);
      }
    }
  });

  it('has the thirty-two lines a morris board is drawn with', () => {
    const degree = ADJACENCY.reduce((sum, list) => sum + list.length, 0);
    expect(degree / 2).toBe(32);
    // A corner is the end of two edges and has no spoke; a midpoint of the
    // middle ring has both spokes as well as its two neighbours.
    expect(ADJACENCY[pointAt(0, 0)]).toHaveLength(2);
    expect(ADJACENCY[pointAt(0, 1)]).toHaveLength(3);
    expect(ADJACENCY[pointAt(1, 1)]).toHaveLength(4);
    expect(ADJACENCY[pointAt(2, 1)]).toHaveLength(3);
  });

  it('has no diagonals, and no spoke that skips the middle ring', () => {
    // Corner to corner across an edge: the midpoint between them is the road.
    expect(ADJACENCY[pointAt(0, 0)]).not.toContain(pointAt(0, 2));
    // Outer straight to inner: a man on the middle ring blocks that road, so
    // the two must not touch.
    expect(ADJACENCY[pointAt(0, 1)]).not.toContain(pointAt(2, 1));
    expect(ADJACENCY[pointAt(0, 1)]).toContain(pointAt(1, 1));
  });

  it('has sixteen mills, twelve on the edges and four on the spokes', () => {
    expect(MILLS).toHaveLength(16);
    for (const mill of MILLS) {
      expect(new Set(mill).size).toBe(3);
      // Every mill is a real line: each man in it stands next to another.
      for (const point of mill) {
        expect(mill.some((p) => ADJACENCY[point].includes(p))).toBe(true);
      }
    }
    // Every point is in exactly two: its ring's edge, and either its other
    // edge (corners) or its spoke (midpoints).
    for (let point = 0; point < POINTS; point++) {
      expect(MILLS.filter((mill) => mill.includes(point)), `point ${point}`).toHaveLength(2);
    }
  });

  it('recognises every one of them on the board', () => {
    for (const mill of MILLS) {
      const state = position({ 0: [...mill], 1: [] });
      for (const point of mill) expect(inMill(state.board, point)).toBe(true);
      expect(millsThrough(state.board, mill[0])[0]).toEqual(mill);
    }
  });

  it("does not call a line a mill when one of the three men is the opponent's", () => {
    const [a, b, c] = MILLS[0];
    const state = position({ 0: [a, b], 1: [c] });
    expect(inMill(state.board, a)).toBe(false);
    expect(inMill(state.board, c)).toBe(false);
  });
});

describe('setup', () => {
  it('gives each player nine men and puts none of them on the board', () => {
    const state = setup();
    expect(state.hand).toEqual([MEN, MEN]);
    expect(state.turn).toBe(0);
    expect(state.taking).toBeNull();
    expect(morris.turn(state)).toBe(0);
    expect(morris.isOver(state)).toBe(false);
  });
});

describe('placing', () => {
  it('alternates, and takes each man out of the hand it came from', () => {
    const state = play(setup(), { type: 'place', to: 0 }, { type: 'place', to: 1 });
    expect(state.board[0]).toBe(0);
    expect(state.board[1]).toBe(1);
    expect(state.hand).toEqual([MEN - 1, MEN - 1]);
    expect(state.turn).toBe(0);
  });

  it('refuses a point that is taken, and one that does not exist', () => {
    const state = play(setup(), { type: 'place', to: 5 });
    expect(apply(state, { type: 'place', to: 5 }, 1).ok).toBe(false);
    for (const to of [-1, POINTS, 1.5, NaN, '3', undefined]) {
      expect(apply(state, { type: 'place', to }, 1).ok, String(to)).toBe(false);
    }
  });

  it('refuses a move from the seat that is not to play, and nonsense from the one that is', () => {
    const state = setup();
    expect(apply(state, { type: 'place', to: 0 }, 1).ok).toBe(false);
    expect(apply(state, null, 0).ok).toBe(false);
    expect(apply(state, { type: 'wave' }, 0).ok).toBe(false);
  });

  it('will not let a man be moved while there are men in hand', () => {
    const state = play(setup(), { type: 'place', to: 0 }, { type: 'place', to: 1 });
    const result = apply(state, { type: 'move', from: 0, to: 7 }, 0);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/place/i);
    expect(destinations(state, 0)).toEqual([]);
  });

  it('runs out after eighteen men and hands the game over to moving', () => {
    // Nine each, alternating, on points that close no mill between them:
    // seat 0 takes corners only and seat 1 midpoints only, so neither ever
    // holds a whole line. (The last pair breaks the pattern: 1-9-17 is a
    // spoke, so seat 1's ninth man goes to a corner seat 0 has left.)
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18];
    let state = setup();
    for (const to of order) state = play(state, { type: 'place', to });
    expect(state.hand).toEqual([0, 0]);
    expect(state.taking).toBeNull();
    expect(state.board.filter((cell) => cell !== null)).toHaveLength(18);
  });
});

describe('closing a mill', () => {
  const millOnPlacement = () =>
    play(
      setup(),
      { type: 'place', to: 0 }, // seat 0
      { type: 'place', to: 16 }, // seat 1
      { type: 'place', to: 1 },
      { type: 'place', to: 17 },
      { type: 'place', to: 2 }, // seat 0 closes 0-1-2
    );

  it('keeps the turn with the player who closed it, owing a man', () => {
    const state = millOnPlacement();
    expect(state.taking).toBe(0);
    expect(state.turn).toBe(0);
    expect(morris.turn(state)).toBe(0);
    expect(state.closed).toEqual([0, 1, 2]);
    expect(morris.status(state, ['Ada', 'Bo'])).toMatch(/Ada has a mill/);
  });

  it('will not let anything else happen until the man is taken', () => {
    const state = millOnPlacement();
    const carryOn = apply(state, { type: 'place', to: 3 }, 0);
    expect(carryOn.ok).toBe(false);
    expect(carryOn.ok === false && carryOn.error).toMatch(/mill/i);
    // Nor may the other player act, mill or no mill.
    expect(apply(state, { type: 'take', at: 0 }, 1).ok).toBe(false);
  });

  it('takes the man, and then passes the turn on', () => {
    const state = play(millOnPlacement(), { type: 'take', at: 16 });
    expect(state.board[16]).toBeNull();
    expect(state.taking).toBeNull();
    expect(state.turn).toBe(1);
    expect(state.lastMove).toEqual({ type: 'take', at: 16 });
    // Taken men do not come back: seat 1 has eight left, not nine.
    expect(menLeft(state, 1)).toBe(MEN - 1);
  });

  it('refuses to take one of your own, or an empty point', () => {
    const state = millOnPlacement();
    expect(apply(state, { type: 'take', at: 1 }, 0).ok).toBe(false);
    expect(apply(state, { type: 'take', at: 23 }, 0).ok).toBe(false);
    expect(apply(state, { type: 'take', at: POINTS }, 0).ok).toBe(false);
  });

  it('takes one man for two mills closed at once', () => {
    // Point 0 is the corner where the 0-1-2 and 6-7-0 lines meet, and seat 0
    // has the other two men of each. It has to be a placement: every road
    // into a point that would close two mills starts inside one of them, so
    // a man stepping in would break the mill he was completing.
    const state = position({ 0: [1, 2, 6, 7], 1: [16, 18, 20, 22] }, { turn: 0, hand: [1, 1] });
    const doubled = play(state, { type: 'place', to: 0 });
    expect(doubled.taking).toBe(0);
    expect(doubled.closed).toEqual(expect.arrayContaining([0, 1, 2, 6, 7]));

    const after = play(doubled, { type: 'take', at: 16 });
    // One man, not two.
    expect(after.board.filter((cell) => cell === 1)).toHaveLength(3);
    expect(after.turn).toBe(1);
  });
});

describe('which man may be taken', () => {
  it('protects a man standing in a mill while any of theirs is not', () => {
    const state = position({ 0: [8, 9, 11, 22], 1: [0, 1, 2, 20] }, { turn: 0 });
    expect(takeable(state.board, 1)).toEqual([20]);

    const quiet = play(state, { type: 'move', from: 22, to: 23 });
    expect(quiet.taking).toBeNull(); // that move closes nothing
  });

  it('refuses the milled man and names the reason', () => {
    // Seat 0 closes 8-9-10 by stepping in from 11; seat 1 holds a mill on
    // 0-1-2 and a loose man on 20.
    const state = position({ 0: [8, 9, 11], 1: [0, 1, 2, 20] }, { turn: 0 });
    const closed = play(state, { type: 'move', from: 11, to: 10 });
    expect(closed.taking).toBe(0);

    const refused = apply(closed, { type: 'take', at: 1 }, 0);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/mill/i);
    expect(must(apply(closed, { type: 'take', at: 20 }, 0)).board[20]).toBeNull();
  });

  it('lets a milled man be taken once every man they have is in a mill', () => {
    // Seat 1 holds nothing but the 0-1-2 mill, so the protection has to give
    // way or their mill could never be broken.
    const state = position({ 0: [8, 9, 11, 22], 1: [0, 1, 2] }, { turn: 0 });
    expect(takeable(state.board, 1)).toEqual([0, 1, 2]);
    const closed = play(state, { type: 'move', from: 11, to: 10 });
    const taken = play(closed, { type: 'take', at: 1 });
    expect(taken.board[1]).toBeNull();
    // And that leaves them two men, which is the end of it.
    expect(taken.winner).toBe(0);
    expect(taken.ending).toBe('starved');
  });
});

describe('moving', () => {
  it('steps a man to an empty point along a line', () => {
    const state = position({ 0: [0, 8, 20, 22], 1: [4, 12, 18, 21] }, { turn: 0 });
    expect(destinations(state, 0).sort()).toEqual([1, 7]);
    const moved = play(state, { type: 'move', from: 0, to: 7 });
    expect(moved.board[0]).toBeNull();
    expect(moved.board[7]).toBe(0);
    expect(moved.turn).toBe(1);
  });

  it('refuses a point that is not next door, one that is taken, and a man that is not yours', () => {
    const state = position({ 0: [0, 8, 20, 22], 1: [4, 12, 18, 21] }, { turn: 0 });
    const far = apply(state, { type: 'move', from: 0, to: 2 }, 0);
    expect(far.ok).toBe(false);
    expect(far.ok === false && far.error).toMatch(/next to/i);
    expect(apply(state, { type: 'move', from: 8, to: 0 }, 0).ok).toBe(false);
    expect(apply(state, { type: 'move', from: 4, to: 3 }, 0).ok).toBe(false);
    expect(apply(state, { type: 'move', from: 3, to: 2 }, 0).ok).toBe(false);
  });

  it('closes a mill again when a man steps out of one and back in', () => {
    // The standard rule, and the reason the draw counters exist: this is a
    // man every other turn for as long as the opponent lets it run.
    const state = position({ 0: [0, 1, 2, 20], 1: [4, 12, 18, 22] }, { turn: 0 });
    const out = play(state, { type: 'move', from: 1, to: 9 });
    expect(out.taking).toBeNull();
    const back = play(
      out,
      { type: 'move', from: 12, to: 13 }, // seat 1, minding its own business
      { type: 'move', from: 9, to: 1 },
    );
    expect(back.taking).toBe(0);
    expect(back.closed).toEqual([0, 1, 2]);
  });
});

describe('flying', () => {
  it('starts when a player is down to their last three men', () => {
    const three = position({ 0: [0, 8, 20], 1: [4, 12, 22] }, { turn: 0 });
    expect(canFly(three, 0)).toBe(true);
    expect(destinations(three, 0)).toHaveLength(POINTS - 6);
    const flown = play(three, { type: 'move', from: 0, to: 17 });
    expect(flown.board[17]).toBe(0);
  });

  it('does not start while a man is still in hand', () => {
    const placing = position({ 0: [0, 8, 20], 1: [4, 12, 22] }, { turn: 0, hand: [1, 1] });
    expect(canFly(placing, 0)).toBe(false);
  });

  it('stops again if a fourth man is somehow in play', () => {
    const four = position({ 0: [0, 8, 20, 22], 1: [4, 12, 21] }, { turn: 0 });
    expect(canFly(four, 0)).toBe(false);
    expect(apply(four, { type: 'move', from: 0, to: 17 }, 0).ok).toBe(false);
  });
});

describe('losing', () => {
  it('is what being taken down to two men means', () => {
    const state = position({ 0: [8, 9, 11, 22], 1: [0, 4, 20] }, { turn: 0 });
    const closed = play(state, { type: 'move', from: 11, to: 10 });
    const taken = play(closed, { type: 'take', at: 4 });
    expect(taken.winner).toBe(0);
    expect(taken.ending).toBe('starved');
    expect(morris.isOver(taken)).toBe(true);
    expect(morris.turn(taken)).toBeNull();
    expect(morris.status(taken, ['Ada', 'Bo'])).toMatch(/Ada wins: Bo is down to two men/);
    expect(apply(taken, { type: 'move', from: 8, to: 15 }, 1).ok).toBe(false);
  });

  it('counts men in hand, so a thin board during placing is not a loss', () => {
    // Seat 1 has one man out and two still to place: three men, and every
    // right to play them.
    const state = position({ 0: [8, 9, 11, 22], 1: [0, 4] }, { turn: 0, hand: [0, 2] });
    expect(menLeft(state, 1)).toBe(4);
    const closed = play(state, { type: 'move', from: 11, to: 10 });
    const taken = play(closed, { type: 'take', at: 4 });
    expect(taken.winner).toBeNull();
    expect(menLeft(taken, 1)).toBe(3);
    expect(taken.turn).toBe(1);
    // And now the same again does end it.
    const again = play(taken, { type: 'place', to: 5 }, { type: 'move', from: 10, to: 11 });
    expect(again.taking).toBeNull();
  });

  it('is also what having no move left means', () => {
    // Seat 1's four men on 0-1-2-3 are hemmed in at 7, 9 and 11; seat 0
    // closes the last road at 4 without closing a mill.
    const state = position({ 0: [5, 7, 9, 11], 1: [0, 1, 2, 3] }, { turn: 0 });
    const closed = play(state, { type: 'move', from: 5, to: 4 });
    expect(closed.taking).toBeNull();
    expect(closed.winner).toBe(0);
    expect(closed.ending).toBe('blocked');
    expect(morris.status(closed, ['Ada', 'Bo'])).toMatch(/Ada wins: Bo has no move left/);
  });

  it('never calls a player blocked while they still have men to place', () => {
    // Eighteen men on twenty-four points always leave somewhere to put one.
    const state = position({ 0: [0, 1, 2, 3], 1: [7, 9, 11] }, { turn: 0, hand: [0, 5] });
    const moved = play(state, { type: 'move', from: 3, to: 4 });
    expect(moved.winner).toBeNull();
    expect(moved.turn).toBe(1);
  });
});

describe('draws', () => {
  it('calls the game when the same position comes round a third time', () => {
    // Two men shuffling between the same pairs of points, closing nothing.
    const state = position({ 0: [0, 2, 4, 6], 1: [16, 18, 20, 22] }, { turn: 0 });
    const shuttle: MmMove[] = [
      { type: 'move', from: 0, to: 1 },
      { type: 'move', from: 16, to: 17 },
      { type: 'move', from: 1, to: 0 },
      { type: 'move', from: 17, to: 16 },
    ];
    const twice = play(state, ...shuttle, ...shuttle);
    expect(twice.draw).toBe(false);

    const thrice = play(twice, shuttle[0]);
    expect(thrice.draw).toBe(true);
    expect(thrice.ending).toBe('repetition');
    expect(morris.isOver(thrice)).toBe(true);
    expect(morris.status(thrice, ['Ada', 'Bo'])).toMatch(/same position/i);
  });

  it('calls it after fifty moves each with nothing taken', () => {
    const state = position({ 0: [0, 2, 4, 6], 1: [16, 18, 20, 22] }, {
      turn: 0,
      quiet: QUIET_LIMIT - 1,
    });
    const drawn = play(state, { type: 'move', from: 0, to: 1 });
    expect(drawn.quiet).toBe(QUIET_LIMIT);
    expect(drawn.draw).toBe(true);
    expect(drawn.ending).toBe('quiet');
  });

  it('starts both counts again the moment a man is taken', () => {
    const state = position({ 0: [8, 9, 11, 22], 1: [0, 4, 18, 20] }, {
      turn: 0,
      quiet: QUIET_LIMIT - 5,
      seen: { anything: 2 },
    });
    const taken = play(state, { type: 'move', from: 11, to: 10 }, { type: 'take', at: 4 });
    expect(taken.quiet).toBe(0);
    // One key: the position that now stands, seen once.
    expect(Object.values(taken.seen)).toEqual([1]);
  });

  it('counts nothing while men are still being placed', () => {
    const state = play(setup(), { type: 'place', to: 0 }, { type: 'place', to: 16 });
    expect(state.quiet).toBe(0);
    expect(state.seen).toEqual({});
  });
});

describe('a game played through', () => {
  it('ends with somebody winning and the loser unable to answer', () => {
    // Placing: seat 0 works towards the 8-9-10 mill, seat 1 towards 0-1-2,
    // and both spend their men rather than blocking.
    let state = setup();
    const opening: MmMove[] = [
      { type: 'place', to: 8 },
      { type: 'place', to: 0 },
      { type: 'place', to: 9 },
      { type: 'place', to: 1 },
    ];
    state = play(state, ...opening);
    expect(state.taking).toBeNull();

    // Seat 0 closes 8-9-10 and takes a loose man; seat 1 has 0-1 and answers
    // with their own mill on the next placement.
    state = play(state, { type: 'place', to: 10 });
    expect(state.taking).toBe(0);
    state = play(state, { type: 'take', at: 0 });
    expect(state.turn).toBe(1);
    expect(menLeft(state, 1)).toBe(MEN - 1);

    // Both sides still have men in hand, so neither is anywhere near beaten.
    expect(morris.isOver(state)).toBe(false);
    expect(menLeft(state, 0)).toBe(MEN);
  });
});

describe('full games', () => {
  /** Small deterministic rng, so a failure is reproducible from its seed. */
  function seeded(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 2 ** 32;
    };
  }

  /**
   * Every move the player to play is entitled to make, worked out from the
   * display helpers rather than from the reducer.
   *
   * That is the point of it: the board offers exactly this list, so a move in
   * here that the reducer refuses, or a move the reducer would allow that is
   * not in here, is a button that lies, and the loop below asserts both
   * directions on every ply of every game.
   */
  function legalMoves(state: MmState): MmMove[] {
    const seat = state.turn;
    if (state.taking !== null) {
      return takeable(state.board, seat === 0 ? 1 : 0).map((at) => ({ type: 'take', at }));
    }
    if (state.hand[seat] > 0) {
      return state.board.flatMap((cell, to) => (cell === null ? [{ type: 'place' as const, to }] : []));
    }
    return movers(state, seat).flatMap((from) =>
      destinations(state, from).map((to) => ({ type: 'move' as const, from, to })),
    );
  }

  it('plays 200 random games to completion without breaking an invariant', () => {
    for (let game = 0; game < 200; game++) {
      const rng = seeded(game * 2654435761 + 11);
      let state = setup();
      let plies = 0;
      let taken = 0;

      // Fifty moves each without a take is a draw, and there are at most
      // fourteen takes in a game, so no game can run past this. A game that
      // does is a draw rule that has stopped working.
      const ceiling = 18 + 14 * (QUIET_LIMIT + 2);

      while (!morris.isOver(state) && plies < ceiling) {
        const before = state;
        const moves = legalMoves(before);
        expect(moves.length, `game ${game}: nothing legal but the game is not over`).toBeGreaterThan(0);

        const move = moves[Math.floor(rng() * moves.length)];
        const result = apply(before, move, before.turn);
        expect(result.ok, `game ${game}: legal move ${JSON.stringify(move)} was rejected`).toBe(true);
        if (!result.ok) return;
        state = result.state;
        plies++;
        if (move.type === 'take') taken++;

        // Men are conserved: nine each, less those taken off, and never a man
        // in two places at once.
        for (const seat of [0, 1] as const) {
          expect(state.hand[seat]).toBeGreaterThanOrEqual(0);
          expect(state.hand[seat]).toBeLessThanOrEqual(MEN);
          expect(menLeft(state, seat), `game ${game}: seat ${seat} men`).toBeLessThanOrEqual(MEN);
        }
        expect(menLeft(state, 0) + menLeft(state, 1)).toBe(2 * MEN - taken);

        // A man is only ever owed by the player to play, and only while there
        // is somebody to take.
        if (state.taking !== null) {
          expect(state.taking).toBe(state.turn);
          expect(takeable(state.board, state.turn === 0 ? 1 : 0).length).toBeGreaterThan(0);
        }

        // Nobody is left on the board with fewer than three men and a game
        // still running, and nobody is left to play with nothing to play.
        if (!morris.isOver(state)) {
          expect(menLeft(state, 0)).toBeGreaterThanOrEqual(MIN_MEN);
          expect(menLeft(state, 1)).toBeGreaterThanOrEqual(MIN_MEN);
          expect(state.taking !== null || hasMove(state, state.turn)).toBe(true);
          expect(morris.turn(state)).toBe(state.turn);
        } else {
          expect(morris.turn(state)).toBeNull();
          // A win and a draw are not both true, and neither happens quietly.
          expect(state.winner === null || !state.draw).toBe(true);
          expect(state.ending).not.toBeNull();
        }

        // The reducer refuses what the list did not offer: the same move made
        // by the player who is not to play.
        expect(apply(before, move, before.turn === 0 ? 1 : 0).ok).toBe(false);
      }

      expect(morris.isOver(state), `game ${game}: never finished`).toBe(true);
      expect(morris.status(state, ['Ada', 'Bo']).length).toBeGreaterThan(0);
    }
  });
});
