import { describe, expect, it } from 'vitest';
import {
  ORIENTATIONS,
  P,
  faceOf,
  open,
  restOf,
  row,
  settle,
  squareUp,
  step,
  throwNext,
  turn,
  type Rest,
  type Tray,
} from './dice.js';
import type { Toss } from './toss.js';
import { YAHTZEE_TRAY } from './yahtzeeDisplay.js';

/**
 * The dice simulation decides what the dice say, and it runs in two places at
 * once — in the reducer, where the faces come from, and in every board, where
 * the same throw is replayed. So the properties worth testing are not about
 * how it looks:
 *
 * - the same toss lands the same way, or the table disagrees about the throw;
 * - the throw always ends, and on the table;
 * - the six faces come up equally often, or the game is crooked.
 */

const TRAY: Tray = { w: 100, h: 44, die: 10 };

function toss(over: Partial<Toss> = {}): Toss {
  const from = row(TRAY, 5);
  return { n: 1, seed: 1, x: 0, y: 0, spin: [0, 0, 0, 0, 0], from, rest: from, ...over };
}

function thrown(over: Partial<Toss> = {}, held?: boolean[]) {
  const t = toss(over);
  return open({ tray: TRAY, toss: t, from: t.from, held });
}

describe('the cube', () => {
  it('has twenty-four ways to sit square, all different', () => {
    expect(ORIENTATIONS).toHaveLength(24);
    const seen = new Set(ORIENTATIONS.map((q) => q.map((n) => n.toFixed(4)).join(',')));
    expect(seen.size).toBe(24);
  });

  it('shows each face from four of them', () => {
    const tally = new Map<number, number>();
    for (const q of ORIENTATIONS) tally.set(faceOf(q), (tally.get(faceOf(q)) ?? 0) + 1);
    expect([...tally.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...tally.values()]).toEqual([4, 4, 4, 4, 4, 4]);
  });

  it('puts opposite faces on opposite sides', () => {
    // The one thing every real die does, and the thing a hand-written face
    // table gets wrong: the number you cannot see is seven minus the one you
    // can. `turn` by 180° about y swaps front for back.
    for (const q of ORIENTATIONS) {
      const behind = turn(q, [0, 0, -1]);
      const front = turn(q, [0, 0, 1]);
      // Component-wise, because -0 and +0 are the same direction and not the
      // same value.
      behind.forEach((n, axis) => expect(-n).toBeCloseTo(front[axis], 10));
    }
  });

  it('leaves a square orientation where it found it', () => {
    ORIENTATIONS.forEach((q, i) => expect(squareUp(q)).toBe(i));
  });
});

describe('a throw', () => {
  it('comes to rest, and inside the second', () => {
    for (let seed = 0; seed < 40; seed++) {
      const world = thrown({ seed, x: 2.4, y: -3.1 });
      let moving = 1;
      let steps = 0;
      while (moving > 0 && steps < 2000) {
        moving = step(world, []);
        steps++;
      }
      expect(moving).toBe(0);
      // The hard stop, plus the last of the fall onto a face, plus the step
      // the hard stop is noticed in.
      expect(steps * P.STEP * 1000).toBeLessThanOrEqual(
        P.HARD_STOP + P.SQUARE_MS + P.STEP * 1000,
      );
    }
  });

  it('comes to rest however hard it is thrown', () => {
    // The clamp in `toss.ts` is the only thing between this and a number a
    // client made up, so both ends of its range have to be survivable.
    for (const speed of [0.05, 1, 4, 8]) {
      const world = thrown({ x: speed, y: -speed });
      expect(settle(world).faces.every((f) => f >= 1 && f <= 6)).toBe(true);
    }
  });

  it('keeps every die on the table', () => {
    for (let seed = 0; seed < 40; seed++) {
      const world = thrown({ seed, x: -3.5, y: -2.2 });
      settle(world);
      for (const body of world.bodies) {
        expect(body.x - body.half).toBeGreaterThanOrEqual(-0.01);
        expect(body.y - body.half).toBeGreaterThanOrEqual(-0.01);
        expect(body.x + body.half).toBeLessThanOrEqual(TRAY.w + 0.01);
        expect(body.y + body.half).toBeLessThanOrEqual(TRAY.h + 0.01);
      }
    }
  });

  it('leaves no two dice on top of each other', () => {
    for (let seed = 0; seed < 40; seed++) {
      const rest = settle(thrown({ seed, x: 1.8, y: -2.6 })).rest;
      for (let i = 0; i < rest.length; i++) {
        for (let k = i + 1; k < rest.length; k++) {
          const overlap = Math.min(
            TRAY.die - Math.abs(rest[i].x - rest[k].x),
            TRAY.die - Math.abs(rest[i].y - rest[k].y),
          );
          expect(overlap).toBeLessThan(0.3);
        }
      }
    }
  });

  it('starts the dice where they already were', () => {
    // Throwing dice that are lying on the table does not gather them up and
    // set them off from somewhere else. This is the whole of that promise.
    const from: Rest[] = [
      { x: 20, y: 10, o: 3 },
      { x: 80, y: 30, o: 7 },
      { x: 50, y: 20, o: 1 },
      { x: 30, y: 33, o: 9 },
      { x: 70, y: 12, o: 5 },
    ];
    const world = open({ tray: TRAY, toss: toss({ from, rest: from }), from });
    world.bodies.forEach((body, i) => {
      expect(body.x).toBe(from[i].x);
      expect(body.y).toBe(from[i].y);
    });
  });

  it('throws them the way the flick went', () => {
    const left = settle(thrown({ x: -4, y: 0 })).rest;
    const right = settle(thrown({ x: 4, y: 0 })).rest;
    const middle = (places: Rest[]) => places.reduce((sum, at) => sum + at.x, 0) / places.length;
    expect(middle(left)).toBeLessThan(middle(right));
  });
});

describe('a die coming to rest', () => {
  /** How far a die turned between one step and the next, in radians. */
  function turns(over: Partial<Toss>): number[][] {
    const world = thrown(over);
    const each: number[][] = world.bodies.map(() => []);
    let moving = 1;
    let steps = 0;
    while (moving > 0 && steps < 2000) {
      const before = world.bodies.map((b) => b.q);
      moving = step(world, []);
      world.bodies.forEach((b, i) => {
        const dot = Math.abs(
          before[i][0] * b.q[0] +
            before[i][1] * b.q[1] +
            before[i][2] * b.q[2] +
            before[i][3] * b.q[3],
        );
        each[i].push(2 * Math.acos(Math.min(1, dot)));
      });
      steps++;
    }
    return each;
  }

  it('does not jump onto its face', () => {
    // The bug this is here about: a die used to tumble, stop, and then snap
    // upright in a single frame — up to sixty degrees in eight milliseconds,
    // which reads as the die being corrected rather than as a die landing. It
    // falls onto the face now, so the last thing it does is nearly nothing.
    for (let seed = 0; seed < 20; seed++) {
      for (const each of turns({ seed, x: 2.7, y: -2.2 })) {
        const last = each.map((turn, i) => (turn > 1e-9 ? i : -1)).reduce((a, b) => Math.max(a, b));
        expect(each[last]).toBeLessThan(0.03);
      }
    }
  });

  it('turns no faster settling than it did rolling', () => {
    // The other half of the same claim: the fall is not a jump spread over a
    // few frames either. Nothing in the last quarter of a second turns faster
    // than the die was turning while it was still crossing the tray.
    for (let seed = 0; seed < 20; seed++) {
      for (const each of turns({ seed, x: 2.7, y: -2.2 })) {
        const tail = Math.max(0, each.length - Math.round(0.25 / P.STEP));
        const fastest = Math.max(...each.slice(0, tail));
        for (const turn of each.slice(tail)) expect(turn).toBeLessThanOrEqual(fastest);
      }
    }
  });

  it('ends square, on the face it is read from', () => {
    for (let seed = 0; seed < 20; seed++) {
      const world = thrown({ seed, x: -2.1, y: -3.3 });
      const settled = settle(world);
      world.bodies.forEach((body, i) => {
        // Exactly one of the 24, not merely near one — the face the reducer
        // puts on the wire is read off this.
        expect(body.q).toEqual(ORIENTATIONS[settled.rest[i].o]);
        expect(faceOf(ORIENTATIONS[settled.rest[i].o])).toBe(settled.faces[i]);
      });
    }
  });
});

describe('the same toss', () => {
  it('lands the same way twice', () => {
    const one = settle(thrown({ seed: 99, x: 2.1, y: -1.7 }));
    const two = settle(thrown({ seed: 99, x: 2.1, y: -1.7 }));
    expect(two).toEqual(one);
  });

  it('lands differently on a different seed', () => {
    // The seed is what stops two throws of the same flick being the same
    // throw, so it has to actually reach the dice.
    const one = settle(thrown({ seed: 1, x: 2.1, y: -1.7 }));
    const two = settle(thrown({ seed: 2, x: 2.1, y: -1.7 }));
    expect(two.rest).not.toEqual(one.rest);
  });

  it('survives being stepped in different-sized chunks', () => {
    // A browser hands the loop whatever gap the last frame took, and the whole
    // point of the fixed step is that this changes nothing. If it ever does,
    // two players watching the same throw see different dice.
    const smooth = thrown({ seed: 7, x: 1.5, y: -2.4 });
    const jerky = thrown({ seed: 7, x: 1.5, y: -2.4 });
    settle(smooth);
    let done = false;
    let n = 0;
    while (!done && n < 4000) {
      for (let i = 0; i < 1 + (n % 5); i++) {
        if (step(jerky, []) === 0) done = true;
        n++;
      }
    }
    expect(restOf(jerky)).toEqual(restOf(smooth));
  });
});

describe('a die being kept', () => {
  it('does not move, and keeps its face', () => {
    const held = [true, false, false, false, false];
    const from = row(TRAY, 5).map((at, i) => (i === 0 ? { ...at, o: 11 } : at));
    const world = open({ tray: TRAY, toss: toss({ x: 2.4, y: -2.4, from, rest: from }), from, held });
    const before = faceOf(world.bodies[0].q);
    const after = settle(world);
    expect(after.rest[0]).toEqual(from[0]);
    expect(after.faces[0]).toBe(before);
  });

  it('is not walked through by the dice thrown at it', () => {
    const held = [true, false, false, false, false];
    const from = row(TRAY, 5);
    const world = open({ tray: TRAY, toss: toss({ x: 2.4, y: -2.4 }), from, held });
    const rest = settle(world).rest;
    for (let i = 1; i < rest.length; i++) {
      const overlap = Math.min(
        TRAY.die - Math.abs(rest[i].x - rest[0].x),
        TRAY.die - Math.abs(rest[i].y - rest[0].y),
      );
      expect(overlap).toBeLessThan(0.3);
    }
  });
});

describe('the odds', () => {
  /**
   * The claim in `dice.ts` is that the faces are exactly uniform, and the
   * reason has nothing to do with the tumble: each die starts in one of the 24
   * orientations drawn uniformly from the server's rng, and the simulation
   * applies a rotation that does not depend on which one it drew. So the test
   * that matters is not "does a chaotic system look fair" — it is that the
   * starting orientation genuinely reaches the answer, and that sweeping it
   * across all 24 sweeps the answer across all six evenly.
   */
  it('come out even across the twenty-four starts, whatever the throw', () => {
    for (const shot of [
      { seed: 5, x: 2.2, y: -1.4 },
      { seed: 61, x: -3.1, y: -2.8 },
      { seed: 404, x: 0, y: 0 },
    ]) {
      const tally = [0, 0, 0, 0, 0, 0, 0];
      for (let spin = 0; spin < ORIENTATIONS.length; spin++) {
        const faces = settle(thrown({ ...shot, spin: Array<number>(5).fill(spin) })).faces;
        for (const face of faces) tally[face]++;
      }
      // Five dice, twenty-four starts: 120 faces, and exactly 20 of each.
      expect(tally.slice(1)).toEqual([20, 20, 20, 20, 20, 20]);
    }
  });

  it('are even over a run of ordinary throws', () => {
    // The above is the proof; this is the sanity check that the proof is about
    // the code that actually runs. Loose bounds — it is a sample, not a law.
    const tally = [0, 0, 0, 0, 0, 0, 0];
    let previous: Toss | null = null;
    for (let n = 0; n < 300; n++) {
      const rng = seededRng(n * 7919 + 13);
      const result = throwNext({ previous, flick: { x: 1.6, y: -2.2 }, rng, tray: TRAY, count: 5 });
      for (const face of result.faces) tally[face]++;
      previous = result.toss;
    }
    for (const count of tally.slice(1)) {
      expect(count).toBeGreaterThan(1500 / 6 - 90);
      expect(count).toBeLessThan(1500 / 6 + 90);
    }
  });
});

describe('throwing from the reducer', () => {
  it('counts up and starts where the last throw finished', () => {
    const rng = seededRng(42);
    const one = throwNext({ previous: null, flick: { x: 1, y: -2 }, rng, tray: TRAY, count: 5 });
    const two = throwNext({ previous: one.toss, flick: { x: 1, y: -2 }, rng, tray: TRAY, count: 5 });
    expect(one.toss.n).toBe(1);
    expect(two.toss.n).toBe(2);
    expect(two.toss.from).toEqual(one.toss.rest);
  });

  it('replays to the faces the reducer read off it', () => {
    // The whole architecture in one assertion: the server reads the faces off
    // its own simulation, and the board re-runs that simulation and must land
    // on the same numbers. If this ever fails, players are being told a number
    // their dice did not land on.
    const rng = seededRng(2024);
    for (let n = 0; n < 25; n++) {
      const result = throwNext({ previous: null, flick: { x: 2.5, y: -1.9 }, rng, tray: TRAY, count: 5 });
      const replay = settle(
        open({ tray: TRAY, toss: result.toss, from: result.toss.from }),
      );
      expect(replay.faces).toEqual(result.faces);
      expect(replay.rest).toEqual(result.toss.rest);
    }
  });

  it('refuses to be aimed by a flick alone', () => {
    // A client picks the flick and nothing else. The same flick has to be able
    // to produce any result, or aiming would be worth something.
    const seen = new Set<string>();
    for (let n = 0; n < 30; n++) {
      const rng = seededRng(n * 104729 + 7);
      seen.add(
        throwNext({ previous: null, flick: { x: 3, y: -3 }, rng, tray: TRAY, count: 5 })
          .faces.join(','),
      );
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it('survives a flick made of nonsense', () => {
    const rng = seededRng(3);
    for (const flick of [undefined, null, 'left', { x: NaN, y: 1 }, { x: 1e308, y: -1e308 }]) {
      const result = throwNext({ previous: null, flick, rng, tray: TRAY, count: 5 });
      expect(result.faces.every((f) => f >= 1 && f <= 6)).toBe(true);
    }
  });
});

/**
 * The throw has to *look* like a throw, and two things about that turned out
 * to be measurable.
 *
 * Neither is a property of the maths — the simulation was correct, fair and
 * terminating while failing both — so nothing else here was ever going to
 * catch them. They are pinned down because they were each found by rendering a
 * throw and looking at it (`npm run render:throw`), which is not something
 * that happens on every change.
 *
 * The tray these run against is Yahtzee's real one, not this file's `TRAY`.
 * The point is what ships.
 */
describe('a throw uses the tray it is thrown into', () => {
  /** Two throws from a standing start, since the second begins where the first left off. */
  function sequences(runs: number) {
    const grids: number[] = [];
    const ends: number[] = [];
    const across = 20;
    const down = 9;
    for (let s = 1; s <= runs; s++) {
      const seen = new Set<number>();
      let from = row(YAHTZEE_TRAY, 5);
      for (let t = 0; t < 2; t++) {
        const t0: Toss = {
          n: t + 1,
          seed: (s * 2654435761 + t * 7919) % 0x1_0000_0000,
          x: 0,
          y: 0,
          spin: [0, 5, 11, 17, 22],
          from,
          rest: from,
        };
        const world = open({ tray: YAHTZEE_TRAY, toss: t0, from });
        let moving = 1;
        let steps = 0;
        while (moving > 0 && steps < 500) {
          for (const b of world.bodies) {
            const col = Math.min(across - 1, Math.max(0, Math.floor((b.x / YAHTZEE_TRAY.w) * across)));
            const rowAt = Math.min(down - 1, Math.max(0, Math.floor((b.y / YAHTZEE_TRAY.h) * down)));
            seen.add(rowAt * across + col);
          }
          moving = step(world, []);
          steps++;
        }
        from = restOf(world);
      }
      grids.push(seen.size / (across * down));
      ends.push(from.reduce((sum, at) => sum + at.x, 0) / from.length);
    }
    return { grids, ends };
  }

  it('crosses most of it rather than dying in the corner it started beside', () => {
    /*
      A tap aimed up a tray twice as wide as it is tall left two thirds of it
      empty in every frame of every throw: the dice crossed the short way in
      a few frames and spent the rest of the throw pinned against the top
      edge. Aimed down the length instead, they traverse it.

      The numbers, measured over six independent batches of forty: **0.554 to
      0.578 as it stands, and 0.394 with the old aim** (holding everything
      else — die size, damping, `THROW`, `FAN` — at today's values, so this
      is the aim's contribution alone). 0.48 sits clear of both, which is the
      only useful place for a floor: tight enough to fail the thing it was
      written for, loose enough that ordinary retuning does not trip it.
    */
    const { grids } = sequences(40);
    const mean = grids.reduce((a, b) => a + b, 0) / grids.length;
    expect(mean).toBeGreaterThan(0.48);
  });

  it('does not leave the dice on the same side every time', () => {
    // The throw leans away from whichever end the dice are lying at, which is
    // what makes it a traverse. Decided outright rather than leaned, every
    // throw became the mirror of the one before it and the dice came to rest
    // on the same side of the tray a hundred times out of a hundred — correct,
    // fair, and visibly mechanical.
    const { ends } = sequences(40);
    const right = ends.filter((x) => x > YAHTZEE_TRAY.w / 2).length / ends.length;
    expect(right).toBeGreaterThan(0.2);
    expect(right).toBeLessThan(0.8);
  });
});

/** A plain deterministic rng, so these tests are exact. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
