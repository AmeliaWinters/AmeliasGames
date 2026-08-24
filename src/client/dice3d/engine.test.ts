/**
 * What the 3D dice are held to.
 *
 * This is the weaker half of a trade. `dice.test.ts` could assert the odds
 * exactly — `[20,20,20,20,20,20]`, every start orientation, no tolerance —
 * because the solver it tested provably never let a cube's rotation touch its
 * motion. Rapier's does, so evenness here is measured rather than proved, and
 * the claim is a chi-square that would catch a bias big enough to matter and
 * would not catch a small one.
 *
 * It is not flaky despite being statistical: the seeds are fixed, so the
 * numbers are the same on every run and on every machine that agrees with this
 * one about floating point. A failure is a real change in behaviour, not a bad
 * roll of the dice about the dice.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  DIE_HALF,
  PHYS,
  faceUp,
  initDice,
  openThrow,
  settleThrow,
  stepThrow,
  restOf,
  facesOf,
  scoutThrow,
  disposeThrow,
  type Hit,
  type Rest3,
} from './engine.js';
import { paceOf } from './beats.js';
import { YAHTZEE_TRAY } from '../../shared/games/yahtzeeDisplay.js';
import { BACKGAMMON_TRAY } from '../../shared/games/backgammon.js';
import type { Quat } from '../../shared/games/dice.js';

beforeAll(async () => {
  await initDice();
});

const TRAY = YAHTZEE_TRAY;

/** A throw, run out, cleaned up. */
function thrown(seed: number, opts: { count?: number; from?: Rest3[] | null; held?: boolean[]; tray?: typeof TRAY } = {}) {
  const tray = opts.tray ?? TRAY;
  const count = opts.count ?? 5;
  const live = openThrow({ tray, count, seed, flick: { x: 0, y: 0 }, from: opts.from ?? null, held: opts.held });
  const spawn = live.bodies.map((b) => {
    const t = b.translation();
    return [t.x, t.y, t.z] as const;
  });
  const out = settleThrow(live);
  const steps = live.steps;
  disposeThrow(live);
  return { ...out, steps, spawn, tray, count };
}

describe('the cube', () => {
  it('shows a one when it has not been turned', () => {
    expect(faceUp([1, 0, 0, 0])).toBe(1);
  });

  it('never shows two numbers at once, whichever way it is turned', () => {
    // A thousand arbitrary rotations, each of which must name exactly one face.
    for (let i = 0; i < 1000; i++) {
      const a = i * 0.7891;
      const q: Quat = [Math.cos(a), Math.sin(a) * 0.6, Math.sin(a * 1.7) * 0.5, Math.sin(a * 2.3) * 0.4];
      const n = Math.hypot(...q) || 1;
      const face = faceUp([q[0] / n, q[1] / n, q[2] / n, q[3] / n]);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
  });

  it('puts opposite faces on opposite sides, so they sum to seven', () => {
    // Turning the die upside down must show the other member of the pair.
    const flip: Quat = [0, 1, 0, 0]; // 180° about x
    for (let i = 0; i < 200; i++) {
      const a = i * 0.31;
      const q: Quat = [Math.cos(a), Math.sin(a) * 0.5, Math.sin(a * 1.3) * 0.7, Math.sin(a * 0.9) * 0.2];
      const n = Math.hypot(...q) || 1;
      const unit: Quat = [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
      const turned: Quat = [
        flip[0] * unit[0] - flip[1] * unit[1] - flip[2] * unit[2] - flip[3] * unit[3],
        flip[0] * unit[1] + flip[1] * unit[0] + flip[2] * unit[3] - flip[3] * unit[2],
        flip[0] * unit[2] - flip[1] * unit[3] + flip[2] * unit[0] + flip[3] * unit[1],
        flip[0] * unit[3] + flip[1] * unit[2] - flip[2] * unit[1] + flip[3] * unit[0],
      ];
      expect(faceUp(unit) + faceUp(turned)).toBe(7);
    }
  });
});

describe('a throw', () => {
  it('always ends, and well inside the hard stop', () => {
    let worst = 0;
    for (let s = 0; s < 60; s++) worst = Math.max(worst, thrown(s * 7919 + 3).steps);
    expect(worst).toBeLessThan(PHYS.HARD_STOP);
    // And is over in a couple of seconds, because a player is waiting for it.
    expect(worst * PHYS.STEP).toBeLessThan(3.5);
  });

  it('starts with the dice apart rather than inside one another', () => {
    /*
      The first cut fanned five two-unit cubes across six units of tray, so
      they spawned interpenetrating and Rapier's push-apart — not the throw —
      was most of where they ended up. Nothing measured caught it; the contact
      sheet did, as five dice exploding out of one point.
    */
    for (let s = 0; s < 60; s++) {
      const { spawn } = thrown(s * 104729 + 11);
      for (let i = 0; i < spawn.length; i++) {
        for (let j = i + 1; j < spawn.length; j++) {
          const gap = Math.max(
            Math.abs(spawn[i][0] - spawn[j][0]),
            Math.abs(spawn[i][1] - spawn[j][1]),
            Math.abs(spawn[i][2] - spawn[j][2]),
          );
          expect(gap).toBeGreaterThanOrEqual(DIE_HALF * 2);
        }
      }
    }
  });

  it('leaves every die on the tray', () => {
    for (let s = 0; s < 80; s++) {
      const { rest } = thrown(s * 2654435761);
      for (const r of rest) {
        expect(r.x).toBeGreaterThan(-0.01);
        expect(r.x).toBeLessThan(TRAY.w + 0.01);
        expect(r.y).toBeGreaterThan(-0.01);
        expect(r.y).toBeLessThan(TRAY.h + 0.01);
      }
    }
  });

  it('leaves no die standing inside another', () => {
    for (let s = 0; s < 80; s++) {
      const { rest } = thrown(s * 40503 + 7);
      for (let i = 0; i < rest.length; i++) {
        for (let j = i + 1; j < rest.length; j++) {
          const gap = Math.hypot(rest[i].x - rest[j].x, rest[i].y - rest[j].y, rest[i].up - rest[j].up);
          // Not a full die apart: they are allowed to touch, and a die resting
          // on a corner of another one is a thing these dice may now do.
          expect(gap).toBeGreaterThan(TRAY.die * 0.7);
        }
      }
    }
  });

  it('uses the tray it is thrown into', () => {
    /*
      The number this replaced: the 2.5D solver covered 16.3% of the tray's
      length on the same chained-throw protocol, and a retune once moved every
      other metric the right way while the dice quietly used a fifth of the
      tray. So this is a floor on spread, measured, and it is the assertion
      that would catch that happening again.
    */
    let span = 0;
    const runs = 60;
    for (let s = 0; s < runs; s++) {
      let from: Rest3[] | null = null;
      for (let t = 0; t < 2; t++) {
        const out = thrown(s * 7919 + t * 104729, { from });
        const xs = out.rest.map((r) => r.x);
        span += (Math.max(...xs) - Math.min(...xs)) / TRAY.w / 2;
        from = out.rest;
      }
    }
    expect(span / runs).toBeGreaterThan(0.25);
  });

  it('works in a tray of a different shape', () => {
    // Backgammon's is a strip: two dice, a third of the height, and the fan
    // has to squeeze rather than overlap.
    for (let s = 0; s < 40; s++) {
      const { rest, faces } = thrown(s * 31337 + 5, { count: 2, tray: BACKGAMMON_TRAY });
      expect(faces).toHaveLength(2);
      for (const f of faces) expect(f).toBeGreaterThanOrEqual(1);
      for (const r of rest) {
        expect(r.x).toBeGreaterThan(-0.01);
        expect(r.x).toBeLessThan(BACKGAMMON_TRAY.w + 0.01);
        expect(r.y).toBeGreaterThan(-0.01);
        expect(r.y).toBeLessThan(BACKGAMMON_TRAY.h + 0.01);
      }
    }
  });
});

describe('the same seed', () => {
  it('throws the same dice twice', () => {
    for (let s = 0; s < 20; s++) {
      const one = thrown(s * 99991 + 1);
      const two = thrown(s * 99991 + 1);
      expect(two.faces).toEqual(one.faces);
      expect(two.rest).toEqual(one.rest);
    }
  });

  it('gives a different answer to a different seed', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 30; s++) seen.add(JSON.stringify(thrown(s * 6700417 + 13).faces));
    // Not all distinct — five dice can repeat a hand — but nowhere near one.
    expect(seen.size).toBeGreaterThan(20);
  });

  it('lands the same way whether it is stepped evenly or in ragged chunks', () => {
    /*
      This is what lets one client replay another's throw at whatever frame
      rate it happens to be running at. It is a property of the fixed timestep:
      the accumulator decides *when* a step is taken and never *how big* it is.
    */
    for (let s = 0; s < 12; s++) {
      const even = thrown(s * 15485863 + 17);

      const live = openThrow({ tray: TRAY, count: 5, seed: s * 15485863 + 17, flick: { x: 0, y: 0 }, from: null });
      const bin: Hit[] = [];
      let moving = 1;
      let n = 0;
      while (moving > 0) {
        // One to five steps at a time, in a pattern that is not the loop's.
        const chunk = 1 + ((n * 7 + 3) % 5);
        for (let i = 0; i < chunk && moving > 0; i++) moving = stepThrow(live, bin);
        n++;
      }
      expect(facesOf(live)).toEqual(even.faces);
      expect(restOf(live)).toEqual(even.rest);
      disposeThrow(live);
    }
  });
});

describe('a die being kept', () => {
  it('does not move, and keeps the number it was showing', () => {
    for (let s = 0; s < 30; s++) {
      const first = thrown(s * 22369621 + 9);
      const held = [true, false, true, false, false];
      const again = thrown(s * 22369621 + 10, { from: first.rest, held });

      for (let i = 0; i < held.length; i++) {
        if (!held[i]) continue;
        expect(again.faces[i]).toBe(first.faces[i]);
        expect(again.rest[i].x).toBeCloseTo(first.rest[i].x, 6);
        expect(again.rest[i].y).toBeCloseTo(first.rest[i].y, 6);
      }
    }
  });

  it('is not walked through by the dice that were thrown', () => {
    for (let s = 0; s < 30; s++) {
      const first = thrown(s * 3010349 + 4);
      const held = [true, false, false, false, false];
      const again = thrown(s * 3010349 + 5, { from: first.rest, held });
      for (let i = 1; i < again.rest.length; i++) {
        const gap = Math.hypot(
          again.rest[0].x - again.rest[i].x,
          again.rest[0].y - again.rest[i].y,
          again.rest[0].up - again.rest[i].up,
        );
        expect(gap).toBeGreaterThan(TRAY.die * 0.7);
      }
    }
  });
});

describe('the odds', () => {
  it('are even enough that a chi-square cannot tell them from even', () => {
    /*
      2400 dice over 480 fixed seeds. Five degrees of freedom, so the critical
      values are 11.07 at p=0.05 and 15.09 at p=0.01; this asserts the looser
      one, because the point is to catch a die that is meaningfully loaded and
      not to fail the build on a number that was always going to wander.

      What it would catch: a face favoured by even a couple of per cent shows
      up here as a chi-square in the dozens. What it would not: a bias of a
      fraction of a per cent. `dice.test.ts` could rule that out by
      construction. This cannot, and that is the cost of real cubes.
    */
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let s = 0; s < 480; s++) {
      for (const f of thrown(s * 2654435761 + 1).faces) counts[f]++;
    }
    const total = counts.slice(1).reduce((a, b) => a + b, 0);
    expect(total).toBe(2400);
    const want = total / 6;
    const chi = counts.slice(1).reduce((a, c) => a + (c - want) ** 2 / want, 0);
    expect(chi).toBeLessThan(15.09);
  });

  it('do not depend on where the dice were lying when they were thrown', () => {
    // A second throw from a settled table must be as even as a first one from
    // an empty one — otherwise the previous hand is leaking into this one.
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (let s = 0; s < 300; s++) {
      const first = thrown(s * 1000003 + 7);
      for (const f of thrown(s * 1000003 + 8, { from: first.rest }).faces) counts[f]++;
    }
    const total = counts.slice(1).reduce((a, b) => a + b, 0);
    const want = total / 6;
    const chi = counts.slice(1).reduce((a, c) => a + (c - want) ** 2 / want, 0);
    expect(chi).toBeLessThan(15.09);
  });
});

/**
 * The beats the animation is paced against.
 *
 * `beats.ts` decides the shape of the slow moment and this decides whether
 * there is one to shape: both facts are properties of the *physics*, they moved
 * once already when the friction was retuned, and neither can be seen from the
 * Browser pane. So they are pinned here rather than left to somebody
 * re-rendering a contact sheet — the rule `dice.test.ts` set with "a throw uses
 * the tray it is thrown into".
 */
describe('the beats of a throw', () => {
  /** Taps and flicks mixed, which is what a real table produces. */
  function scouted(seed: number, tray: typeof TRAY, count: number) {
    const hard = (seed % 4) / 3;
    return scoutThrow({
      tray,
      count,
      seed: seed * 7919 + 13,
      flick: hard === 0 ? { x: 0, y: 0 } : { x: hard * 2.4, y: hard * 1.1, ax: 0.2, ay: 0.8 },
      from: null,
    });
  }

  it('finds a moment worth slowing down for in very nearly every throw', () => {
    // If this fails the feature is silently gone: the throw still plays, at one
    // speed, and nothing says so.
    let missing = 0;
    for (let s = 0; s < 90; s++) if (scouted(s, TRAY, 5).decisive < 18) missing++;
    expect(missing / 90).toBeLessThan(0.1);
  });

  it('puts that moment inside the throw rather than at either end', () => {
    // Measured at a median of 67 steps into a 134-step throw. A decisive
    // contact in the first few steps is a throw that slows down before it has
    // done anything; one in the last few leaves no tail to snap through.
    const where: number[] = [];
    for (let s = 0; s < 90; s++) {
      const beats = scouted(s, TRAY, 5);
      if (beats.decisive >= 0) where.push(beats.decisive / beats.steps);
    }
    const median = where.sort((a, b) => a - b)[Math.floor(where.length / 2)];
    expect(median).toBeGreaterThan(0.25);
    expect(median).toBeLessThan(0.75);
  });

  it('costs the player no waiting for it', () => {
    /*
      The whole trade. A slow-motion beat is worth having only if it is paid for
      out of the tail nobody watches rather than out of the player's evening —
      a Yahtzee turn is three of these, a game is thirteen rounds.

      An earlier cut ran 270ms a throw longer and read as lag with a reason.
    */
    for (const [tray, count] of [
      [TRAY, 5],
      [BACKGAMMON_TRAY, 2],
    ] as const) {
      let plain = 0;
      let paced = 0;
      for (let s = 0; s < 60; s++) {
        const beats = scouted(s, tray, count);
        plain += beats.steps * PHYS.STEP;
        for (let step = 0; step < beats.steps; step++) paced += PHYS.STEP / paceOf(step, beats);
      }
      expect(paced).toBeLessThanOrEqual(plain * 1.02);
    }
  });

  it('never asks for more substeps than a frame is allowed', () => {
    // The fast tail is capped by `MAX_SUBSTEPS`: ask for more steps per frame
    // than a frame may take and the snap silently becomes a stutter.
    const beats = scouted(3, TRAY, 5);
    for (let step = 0; step < beats.steps; step++) {
      const perFrame = paceOf(step, beats) / 60 / PHYS.STEP;
      expect(perFrame).toBeLessThanOrEqual(PHYS.MAX_SUBSTEPS);
    }
  });

  it('agrees with the throw it scouted', () => {
    // Two runs of one seed, so the step count the pacing is built on is the
    // step count the animation will actually take.
    const beats = scoutThrow({ tray: TRAY, count: 5, seed: 4242, flick: { x: 0, y: 0 }, from: null });
    expect(beats.steps).toBe(thrown(4242).steps);
  });
});
