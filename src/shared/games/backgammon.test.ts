import { describe, it, expect } from "vitest";
import {
  backgammon,
  legalMoves,
  applyOne,
  canBearOff,
  pipCount,
  barEntry,
  POINTS,
  CHECKERS,
  type BgState,
} from "./backgammon.js";

/** An empty board to hang a specific position on. */
function position(overrides: Partial<BgState> = {}): BgState {
  return {
    points: Array<number>(POINTS).fill(0),
    bar: [0, 0],
    off: [0, 0],
    turn: 0,
    dice: [],
    roll: null,
    toss: null,
    phase: "move",
    winner: null,
    result: null,
    ...overrides,
  };
}

/*
  There is no loading the dice any more, and that is the point: the pair is
  read off cubes that were thrown, so an rng cannot hand one over. Tests that
  need a particular roll ask `rolls` for a seed that produces it.
*/

const never = () => 0;

/** A lone seat-0 checker with a made enemy point three pips ahead of it. */
function blockedSolo(): number[] {
  const points = Array<number>(POINTS).fill(0);
  points[12] = 1;
  points[9] = -2;
  return points;
}

describe("setup", () => {
  it("lays out the standard opening position", () => {
    const s = backgammon.setup(2, never);
    expect(s.points[23]).toBe(2);
    expect(s.points[12]).toBe(5);
    expect(s.points[7]).toBe(3);
    expect(s.points[5]).toBe(5);
    expect(s.points[0]).toBe(-2);
    expect(s.points[11]).toBe(-5);
    expect(s.points[16]).toBe(-3);
    expect(s.points[18]).toBe(-5);
  });

  it("gives each player fifteen checkers", () => {
    const s = backgammon.setup(2, never);
    const seat0 = s.points.filter((n) => n > 0).reduce((a, b) => a + b, 0);
    const seat1 = -s.points.filter((n) => n < 0).reduce((a, b) => a + b, 0);
    expect(seat0).toBe(CHECKERS);
    expect(seat1).toBe(CHECKERS);
  });

  it("starts both players on the standard 167 pips", () => {
    const s = backgammon.setup(2, never);
    expect(pipCount(s, 0)).toBe(167);
    expect(pipCount(s, 1)).toBe(167);
  });

  it("decides who starts by chance rather than by who made the room", () => {
    expect(backgammon.setup(2, () => 0.1).turn).toBe(0);
    expect(backgammon.setup(2, () => 0.9).turn).toBe(1);
  });
});

/** Throw until the dice come up the way a test needs them. */
function rolls(from: BgState, want: (roll: [number, number]) => boolean): BgState {
  for (let seed = 0; seed < 400; seed++) {
    const result = backgammon.applyMove(from, { type: "roll" }, from.turn, () => seed / 400);
    if (result.ok && result.state.roll && want(result.state.roll)) return result.state;
  }
  throw new Error("no seed in 400 produced the roll this test needs");
}

describe("rolling", () => {
  /*
    The pair is the simulation's — read off the dice where they stop — so a
    test cannot hand one over with a stubbed rng. It can ask for a seed that
    produces the pair it needs, which is what `rolls` does, and everything
    else asserts the rule rather than a number.
  */
  it("produces two dice and moves to the move phase", () => {
    const s = backgammon.setup(2, never);
    const result = backgammon.applyMove(s, { type: "roll" }, s.turn, () => 0.42);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [a, b] = result.state.roll!;
    expect(a).toBeGreaterThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(6);
    expect(result.state.dice).toEqual(a === b ? [a, a, a, a] : [a, b]);
    expect(result.state.phase).toBe("move");
  });

  it("gives four moves for doubles", () => {
    const s = backgammon.setup(2, never);
    const doubled = rolls(s, (roll) => roll[0] === roll[1]);
    expect(doubled.dice).toEqual([doubled.roll![0], doubled.roll![0], doubled.roll![0], doubled.roll![0]]);
  });

  it("plays a pair as two dice", () => {
    const s = backgammon.setup(2, never);
    const split = rolls(s, (roll) => roll[0] !== roll[1]);
    expect(split.dice).toEqual(split.roll);
  });

  it("refuses a second roll in the same turn", () => {
    const s = position({ phase: "move", dice: [3, 5] });
    const result = backgammon.applyMove(s, { type: "roll" }, 0, never);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/already rolled/i);
  });

  it("refuses a roll from the player not on turn", () => {
    const s = backgammon.setup(2, () => 0.1); // seat 0 to start
    expect(backgammon.applyMove(s, { type: "roll" }, 1, never).ok).toBe(false);
  });
});

describe("moving", () => {
  it("moves seat 0 downward and seat 1 upward", () => {
    const down = applyOne(position({ points: withChecker(10, 1), dice: [4] }), 0, 10, 4);
    expect(down?.points[6]).toBe(1);

    const up = applyOne(
      position({ points: withChecker(10, -1), dice: [4], turn: 1 }),
      1,
      10,
      4,
    );
    expect(up?.points[14]).toBe(-1);
  });

  it("refuses a point held by two or more opposing checkers", () => {
    const s = position({ points: withCheckers([[10, 1], [6, -2]]), dice: [4] });
    expect(applyOne(s, 0, 10, 4)).toBeNull();
  });

  it("allows a point holding a single opposing checker, and hits it", () => {
    const s = position({ points: withCheckers([[10, 1], [6, -1]]), dice: [4] });
    const after = applyOne(s, 0, 10, 4);
    expect(after).not.toBeNull();
    expect(after!.points[6]).toBe(1);
    expect(after!.bar[1]).toBe(1);
  });

  it("consumes exactly one die", () => {
    const s = position({ points: withChecker(10, 1), dice: [4, 4] });
    expect(applyOne(s, 0, 10, 4)!.dice).toEqual([4]);
  });

  it("refuses a die that was not rolled", () => {
    const s = position({ points: withChecker(10, 1), dice: [4] });
    expect(applyOne(s, 0, 10, 3)).toBeNull();
  });

  it("refuses to move from a point you do not occupy", () => {
    const s = position({ points: withChecker(10, 1), dice: [4] });
    expect(applyOne(s, 0, 9, 4)).toBeNull();
  });

  it("never mutates the state it is given", () => {
    const s = position({ points: withCheckers([[10, 1], [6, -1]]), dice: [4] });
    const snapshot = JSON.stringify(s);
    applyOne(s, 0, 10, 4);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

describe("the bar", () => {
  it("puts a hit checker on the bar and blocks all other movement", () => {
    const s = position({ points: withCheckers([[10, 1], [20, 1]]), bar: [1, 0], dice: [4] });
    expect(applyOne(s, 0, 10, 4)).toBeNull();
    expect(applyOne(s, 0, 20, 4)).toBeNull();
    expect(applyOne(s, 0, "bar", 4)).not.toBeNull();
  });

  it("enters on the point matching the die", () => {
    expect(barEntry(0, 1)).toBe(23);
    expect(barEntry(0, 6)).toBe(18);
    expect(barEntry(1, 1)).toBe(0);
    expect(barEntry(1, 6)).toBe(5);

    const s = position({ bar: [1, 0], dice: [6] });
    expect(applyOne(s, 0, "bar", 6)!.points[18]).toBe(1);
  });

  it("cannot enter on a point the opponent holds", () => {
    const s = position({ points: withChecker(18, -2), bar: [1, 0], dice: [6] });
    expect(applyOne(s, 0, "bar", 6)).toBeNull();
  });

  it("hits a blot on entry", () => {
    const s = position({ points: withChecker(18, -1), bar: [1, 0], dice: [6] });
    const after = applyOne(s, 0, "bar", 6)!;
    expect(after.points[18]).toBe(1);
    expect(after.bar[1]).toBe(1);
    expect(after.bar[0]).toBe(0);
  });

  it("counts a barred checker as a full lap in the pip count", () => {
    const s = position({ bar: [1, 0] });
    expect(pipCount(s, 0)).toBe(25);
  });
});

describe("bearing off", () => {
  const home = (extra: Array<[number, number]> = []) =>
    position({ points: withCheckers([[5, 13], ...extra]), off: [2, 0], dice: [6] });

  it("is only allowed once every checker is home", () => {
    expect(canBearOff(home(), 0)).toBe(true);
    expect(canBearOff(position({ points: withCheckers([[5, 14], [9, 1]]), dice: [6] }), 0)).toBe(false);
  });

  it("is not allowed while a checker sits on the bar", () => {
    expect(canBearOff(position({ points: withChecker(5, 14), bar: [1, 0] }), 0)).toBe(false);
  });

  it("bears off on an exact roll", () => {
    const after = applyOne(home(), 0, 5, 6);
    expect(after?.off[0]).toBe(3);
  });

  it("bears off on a larger roll only from the furthest point", () => {
    // Checkers on the 4-point and the 6-point; a 6 must take the 6-point one.
    const s = position({ points: withCheckers([[3, 7], [5, 6]]), off: [2, 0], dice: [6] });
    expect(applyOne(s, 0, 3, 6)).toBeNull();
    expect(applyOne(s, 0, 5, 6)).not.toBeNull();

    // With the 6-point cleared, the 4-point becomes the furthest.
    const cleared = position({ points: withChecker(3, 13), off: [2, 0], dice: [6] });
    expect(applyOne(cleared, 0, 3, 6)).not.toBeNull();
  });

  it("moves within the home board instead when it prefers to", () => {
    const s = position({ points: withChecker(5, 15), dice: [2] });
    expect(applyOne(s, 0, 5, 2)!.points[3]).toBe(1);
  });

  it("works the same way for seat 1 at the other end", () => {
    const s = position({
      points: withChecker(18, -15),
      turn: 1,
      dice: [6],
    });
    expect(canBearOff(s, 1)).toBe(true);
    expect(applyOne(s, 1, 18, 6)!.off[1]).toBe(1);
  });
});

describe("using as many dice as possible", () => {
  it("forces the higher die when only one can be played", () => {
    // A single checker on 10; both 2 and 5 are playable, but the follow-up
    // point is held by the opponent, so only one die can ever be used.
    const s = position({ points: withCheckers([[10, 1], [3, -2]]), dice: [2, 5] });
    const moves = legalMoves(s);
    expect(moves).toEqual([{ from: 10, die: 5 }]);
  });

  it("allows the lower die when the higher one cannot be played at all", () => {
    const s = position({
      points: withCheckers([[8, 1], [3, -2], [2, -2], [0, -2]]),
      dice: [3, 5],
    });
    expect(legalMoves(s)).toEqual([{ from: 8, die: 3 }]);
  });

  it("rejects a legal-looking move that strands the other die", () => {
    // Coming in off the bar: entering with the 1 leaves the 6 unplayable,
    // while entering with the 6 leaves a legal 1. Only the 6 is allowed.
    const s = position({
      points: withCheckers([[23, 1], [17, -2]]),
      bar: [1, 0],
      dice: [1, 6],
    });

    expect(applyOne(s, 0, "bar", 1)).not.toBeNull(); // legal in isolation
    expect(legalMoves(s)).toEqual([{ from: "bar", die: 6 }]);

    const rejected = backgammon.applyMove(s, { type: "move", from: "bar", die: 1 }, 0, never);
    expect(rejected.ok).toBe(false);
    expect(rejected.ok === false && rejected.error).toMatch(/as many dice as possible/i);
  });

  it("reports no legal move when the opponent has closed every entry point", () => {
    const shut = [18, 19, 20, 21, 22, 23].map((p) => [p, -2] as [number, number]);
    const s = position({ points: withCheckers(shut), bar: [1, 0], dice: [3, 4] });
    expect(legalMoves(s)).toEqual([]);
  });
});

describe("turn flow", () => {
  it("ends the turn once the dice are spent", () => {
    const s = position({ points: withChecker(10, 1), dice: [4], turn: 0 });
    const after = backgammon.applyMove(s, { type: "move", from: 10, die: 4 }, 0, never);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.state.turn).toBe(1);
    expect(after.state.phase).toBe("roll");
    expect(after.state.dice).toEqual([]);
  });

  it("ends the turn early when the remaining die is unplayable", () => {
    // After the 4, the 6 has nowhere to go: 6-6 lands on a closed point.
    const s = position({
      points: withCheckers([[10, 1], [0, -2]]),
      dice: [4, 6],
      turn: 0,
    });
    const after = backgammon.applyMove(s, { type: "move", from: 10, die: 6 }, 0, never);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.state.turn).toBe(1);
  });

  it("lets a stuck player pass, but only when genuinely stuck", () => {
    const shut = [18, 19, 20, 21, 22, 23].map((p) => [p, -2] as [number, number]);
    const stuck = position({ points: withCheckers(shut), bar: [1, 0], dice: [3, 4] });
    const passed = backgammon.applyMove(stuck, { type: "pass" }, 0, never);
    expect(passed.ok).toBe(true);
    expect(passed.ok && passed.state.turn).toBe(1);

    const free = position({ points: withChecker(10, 1), dice: [3, 4] });
    const refused = backgammon.applyMove(free, { type: "pass" }, 0, never);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toMatch(/still have a legal move/i);
  });

  it("refuses a move before rolling", () => {
    const s = position({ points: withChecker(10, 1), phase: "roll" });
    expect(backgammon.applyMove(s, { type: "move", from: 10, die: 4 }, 0, never).ok).toBe(false);
  });
});

describe("winning", () => {
  it("wins on bearing off the fifteenth checker", () => {
    const s = position({ points: withChecker(0, 1), off: [14, 3], dice: [1] });
    const after = backgammon.applyMove(s, { type: "move", from: 0, die: 1 }, 0, never);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.state.winner).toBe(0);
    expect(after.state.result).toBe(1);
    expect(backgammon.isOver(after.state)).toBe(true);
    expect(backgammon.turn(after.state)).toBeNull();
  });

  it("scores a gammon when the loser bore none off", () => {
    const s = position({
      points: withCheckers([[0, 1], [12, -15]]),
      off: [14, 0],
      dice: [1],
    });
    const after = backgammon.applyMove(s, { type: "move", from: 0, die: 1 }, 0, never);
    expect(after.ok && after.state.result).toBe(2);
    expect(after.ok && backgammon.status(after.state, ["Amelia", "Sam"])).toMatch(/gammon/);
  });

  it("scores a backgammon when the loser is still in the winner's home", () => {
    const s = position({
      points: withCheckers([[0, 1], [3, -15]]), // seat 1 stuck in seat 0's home
      off: [14, 0],
      dice: [1],
    });
    const after = backgammon.applyMove(s, { type: "move", from: 0, die: 1 }, 0, never);
    expect(after.ok && after.state.result).toBe(3);
  });

  it("scores a backgammon when the loser is still on the bar", () => {
    const s = position({
      points: withCheckers([[0, 1], [12, -14]]),
      bar: [0, 1],
      off: [14, 0],
      dice: [1],
    });
    const after = backgammon.applyMove(s, { type: "move", from: 0, die: 1 }, 0, never);
    expect(after.ok && after.state.result).toBe(3);
  });

  it("refuses further moves once won", () => {
    const won = position({ winner: 0, result: 1, off: [15, 4] });
    expect(backgammon.applyMove(won, { type: "roll" }, 0, never).ok).toBe(false);
  });
});

describe("status line", () => {
  it("describes each phase in the player's own name", () => {
    const names = ["Amelia", "Sam"];
    expect(backgammon.status(position({ phase: "roll" }), names)).toBe("Amelia to roll");
    expect(
      backgammon.status(position({ points: withChecker(10, 1), dice: [3] }), names),
    ).toBe("Amelia to play");

    const onBar = position({ points: withChecker(10, 1), bar: [1, 0], dice: [3] });
    expect(backgammon.status(onBar, names)).toMatch(/must come in off the bar/);

    const shut = [18, 19, 20, 21, 22, 23].map((p) => [p, -2] as [number, number]);
    const stuck = position({ points: withCheckers(shut), bar: [1, 0], dice: [3, 4] });
    expect(backgammon.status(stuck, names)).toMatch(/no legal move/);
  });
});

// ── helpers ────────────────────────────────────────────────────────────

function withChecker(point: number, count: number): number[] {
  return withCheckers([[point, count]]);
}

/** Signed counts: positive for seat 0, negative for seat 1. */
function withCheckers(entries: Array<[number, number]>): number[] {
  const points = Array<number>(POINTS).fill(0);
  for (const [point, count] of entries) points[point] += count;
  return points;
}

// ── Property test ──────────────────────────────────────────────────────

describe("full games", () => {
  /** Deterministic generator, so a failure here is reproducible. */
  function seeded(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
      value = (value * 1664525 + 1013904223) >>> 0;
      return value / 0x100000000;
    };
  }

  /** Every checker must be somewhere: on a point, on the bar, or borne off. */
  function checkersOf(state: BgState, seat: number): number {
    let total = state.bar[seat] + state.off[seat];
    for (let i = 0; i < POINTS; i++) {
      total += seat === 0 ? Math.max(0, state.points[i]) : Math.max(0, -state.points[i]);
    }
    return total;
  }

  it("plays 40 random games to completion without breaking an invariant", () => {
    for (let game = 0; game < 40; game++) {
      const rng = seeded(game * 7919 + 13);
      let state = backgammon.setup(2, rng);
      let turns = 0;

      while (!backgammon.isOver(state) && turns < 4000) {
        turns++;
        const seat = state.turn;

        const move =
          state.phase === "roll"
            ? ({ type: "roll" } as const)
            : (() => {
                const options = legalMoves(state);
                if (options.length === 0) return { type: "pass" } as const;
                const pick = options[Math.floor(rng() * options.length)];
                return { type: "move", from: pick.from, die: pick.die } as const;
              })();

        const result = backgammon.applyMove(state, move, seat, rng);
        expect(result.ok, `game ${game}: ${JSON.stringify(move)} rejected`).toBe(true);
        if (!result.ok) return;
        state = result.state;

        expect(checkersOf(state, 0), `game ${game}: seat 0 lost a checker`).toBe(CHECKERS);
        expect(checkersOf(state, 1), `game ${game}: seat 1 lost a checker`).toBe(CHECKERS);
        // A point can never hold checkers belonging to both players.
        expect(state.points.every((n) => Number.isInteger(n))).toBe(true);
        expect(state.off[0] <= CHECKERS && state.off[1] <= CHECKERS).toBe(true);
      }

      expect(backgammon.isOver(state), `game ${game} never finished`).toBe(true);
      expect(state.off[state.winner!]).toBe(CHECKERS);
      // The loser cannot also have borne everything off.
      expect(state.off[1 - state.winner!]).toBeLessThan(CHECKERS);
      expect([1, 2, 3]).toContain(state.result);
    }
  });

  it("never offers a move it would then refuse", () => {
    const rng = seeded(4242);
    let state = backgammon.setup(2, rng);

    for (let step = 0; step < 3000 && !backgammon.isOver(state); step++) {
      if (state.phase === "roll") {
        const rolled = backgammon.applyMove(state, { type: "roll" }, state.turn, rng);
        expect(rolled.ok).toBe(true);
        if (!rolled.ok) return;
        state = rolled.state;
        continue;
      }

      const options = legalMoves(state);
      if (options.length === 0) {
        const passed = backgammon.applyMove(state, { type: "pass" }, state.turn, rng);
        expect(passed.ok).toBe(true);
        if (!passed.ok) return;
        state = passed.state;
        continue;
      }

      // Every option the engine advertises must be accepted by the engine.
      for (const option of options) {
        const trial = backgammon.applyMove(
          state,
          { type: "move", from: option.from, die: option.die },
          state.turn,
          rng,
        );
        expect(trial.ok, `advertised ${JSON.stringify(option)} but refused it`).toBe(true);
      }

      const chosen = options[Math.floor(rng() * options.length)];
      const result = backgammon.applyMove(
        state,
        { type: "move", from: chosen.from, die: chosen.die },
        state.turn,
        rng,
      );
      if (!result.ok) return;
      state = result.state;
    }
  });
});

describe("immutability", () => {
  it("never mutates the state it is given, including the roll", () => {
    // `roll` is a tuple, and a shallow spread leaves it shared with the state
    // it came from — one careless write away from corrupting a snapshot that
    // has already been persisted.
    const before = position({ points: withChecker(10, 1), dice: [4], roll: [4, 2] });
    const after = applyOne(before, 0, 10, 4)!;
    expect(after).not.toBeNull();

    after.roll![0] = 99;
    after.points[10] = 99;
    after.bar[0] = 99;
    after.off[0] = 99;
    after.dice.push(99);

    expect(before.roll).toEqual([4, 2]);
    expect(before.points[10]).toBe(1);
    expect(before.bar[0]).toBe(0);
    expect(before.off[0]).toBe(0);
    expect(before.dice).toEqual([4]);
  });

  it("never mutates the throw the dice arrived on", () => {
    // Same lesson as `roll`, one level deeper: a `Toss` carries three arrays of
    // its own, and a shallow spread copies only the reference to it. Nothing
    // writes to a stored throw today, which is exactly when this is cheap to
    // guarantee rather than expensive to discover.
    const toss = {
      n: 1,
      seed: 12345,
      x: 0,
      y: 0,
      spin: [3, 7],
      from: [{ x: 1, y: 2, o: 0 }, { x: 3, y: 4, o: 1 }],
      rest: [{ x: 5, y: 6, o: 2 }, { x: 7, y: 8, o: 3 }],
    };
    const before = position({ points: withChecker(10, 1), dice: [4], roll: [4, 2], toss });
    const after = applyOne(before, 0, 10, 4)!;
    expect(after).not.toBeNull();

    after.toss!.rest[0].x = 99;
    after.toss!.from[0].y = 99;
    after.toss!.spin[0] = 99;

    expect(before.toss!.rest[0].x).toBe(5);
    expect(before.toss!.from[0].y).toBe(2);
    expect(before.toss!.spin[0]).toBe(3);
  });

  it("does not leave the previous player's dice lying around after the turn flips", () => {
    // `roll` means "what the player to move rolled". Once the turn changes it
    // would otherwise still describe the player who just finished.
    const stuck = position({ points: blockedSolo(), dice: [3, 3], roll: [3, 3], turn: 0 });
    const passed = backgammon.applyMove(stuck, { type: "pass" }, 0, never);
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.state.turn).toBe(1);
    expect(passed.state.roll).toBeNull();
  });
});

describe("scoring for seat 1", () => {
  // Every other win test in this file has seat 0 winning, so a mirrored bug in
  // scoreFor would go unseen.
  function seatOneBearingOff(seatZeroPoints: Record<number, number>): BgState {
    const points = Array<number>(POINTS).fill(0);
    points[23] = -1; // seat 1's last checker, one pip from off
    for (const [point, count] of Object.entries(seatZeroPoints)) points[Number(point)] = count;
    return position({ points, off: [0, 14], dice: [1], turn: 1, phase: "move" });
  }

  const finish = (state: BgState) => {
    const result = backgammon.applyMove(state, { type: "move", from: 23, die: 1 }, 1, never);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    return result.state;
  };

  it("awards a single game when the loser has borne one off", () => {
    const state = finish(position({
      points: (() => {
        const p = Array<number>(POINTS).fill(0);
        p[23] = -1;
        p[5] = 14;
        return p;
      })(),
      off: [1, 14],
      dice: [1],
      turn: 1,
      phase: "move",
    }));
    expect(state.winner).toBe(1);
    expect(state.result).toBe(1);
  });

  it("awards a gammon when the loser has borne nothing off", () => {
    const state = finish(seatOneBearingOff({ 5: 15 }));
    expect(state.winner).toBe(1);
    expect(state.result).toBe(2);
  });

  it("awards a backgammon when the loser still sits in the winner's home", () => {
    const state = finish(seatOneBearingOff({ 5: 14, 20: 1 }));
    expect(state.winner).toBe(1);
    expect(state.result).toBe(3);
  });

  it("awards a backgammon when the loser is still on the bar", () => {
    const points = Array<number>(POINTS).fill(0);
    points[23] = -1;
    points[5] = 14;
    const state = finish(position({
      points,
      bar: [1, 0],
      off: [0, 14],
      dice: [1],
      turn: 1,
      phase: "move",
    }));
    expect(state.result).toBe(3);
  });
});

describe("doubles played only in part", () => {
  it("accepts a turn that uses two of the four dice and then has nowhere to go", () => {
    // A lone checker walking 12 -> 9 -> 6, with 3 blocked by a made point.
    const points = Array<number>(POINTS).fill(0);
    points[12] = 1;
    points[3] = -2;
    let state = position({ points, dice: [3, 3, 3, 3], turn: 0, phase: "move" });

    expect(legalMoves(state).map((m) => m.from)).toEqual([12]);
    state = applyOne(state, 0, 12, 3)!;
    expect(state).not.toBeNull();
    state = applyOne(state, 0, 9, 3)!;
    expect(state).not.toBeNull();

    expect(state.dice).toEqual([3, 3]);
    expect(legalMoves(state)).toEqual([]);

    const passed = backgammon.applyMove(state, { type: "pass" }, 0, never);
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.state.turn).toBe(1);
  });

  it("does not apply the higher-die rule to doubles", () => {
    // Vacuously true while all four dice are equal — pinned because it is
    // exactly the condition a refactor breaks silently.
    const points = Array<number>(POINTS).fill(0);
    points[12] = 1;
    points[3] = -2;
    const state = position({ points, dice: [3, 3, 3, 3], turn: 0, phase: "move" });
    expect(legalMoves(state).length).toBeGreaterThan(0);
  });
});

describe("refusals", () => {
  it("refuses a pass before the dice have been rolled", () => {
    const state = position({ points: withChecker(10, 1), dice: [], phase: "roll", turn: 0 });
    const result = backgammon.applyMove(state, { type: "pass" }, 0, never);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/roll/i);
  });

  it("refuses every malformed move without throwing", () => {
    const state = position({ points: withChecker(10, 1), dice: [3], turn: 0, phase: "move" });
    const shapes: unknown[] = [
      null,
      undefined,
      "move",
      [],
      42,
      { type: "move" },
      { type: "move", from: 1.5, die: 3 },
      { type: "move", from: NaN, die: 3 },
      { type: "move", from: -1, die: 3 },
      { type: "move", from: POINTS, die: 3 },
      { type: "move", from: 1e9, die: 3 },
      { type: "move", from: {}, die: 3 },
      { type: "move", from: "10", die: 3 },
      { type: "move", from: 10, die: "3" },
      { type: "move", from: 10, die: 0 },
      { type: "move", from: 10, die: -1 },
      { type: "move", from: 10, die: Infinity },
      { type: "teleport" },
    ];

    for (const shape of shapes) {
      const attempt = () => backgammon.applyMove(state, shape as never, 0, never);
      expect(attempt, `threw on ${JSON.stringify(shape)}`).not.toThrow();
      expect(attempt().ok, `accepted ${JSON.stringify(shape)}`).toBe(false);
    }
  });
});

describe("the dice themselves", () => {
  it("never rolls outside 1-6, even for an rng that breaks its contract", () => {
    // Math.random cannot return 1, but a hand-written test rng can — and that
    // would otherwise roll a 7.
    for (const broken of [() => 1, () => 0.9999999999, () => NaN, () => -0.5, () => 2]) {
      const state = position({ points: withChecker(10, 1), dice: [], phase: "roll", turn: 0 });
      const result = backgammon.applyMove(state, { type: "roll" }, 0, broken);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      for (const value of result.state.dice) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(6);
      }
    }
  });
});
