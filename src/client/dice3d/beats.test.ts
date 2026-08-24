import { describe, expect, it } from 'vitest';
import { faceUp, UPRIGHT, type Quat } from '../../shared/games/dice.js';
import {
  cheerLength,
  cheerPose,
  inSlowMoment,
  landedBetween,
  paceOf,
  slerp,
  windUp,
  WINDUP_MS,
  type Beats,
  type Pose,
} from './beats.js';

const at = (x: number, y: number, z: number, q: Quat = [1, 0, 0, 0]): Pose => ({ x, y, z, q });

/** A die lying flat showing `face`, where a rest pose would put it. */
const lying = (face: number, x = 0, z = 0): Pose => at(x, 1, z, UPRIGHT[face]);

describe('the wind-up', () => {
  it('starts on the table and ends where the throw begins', () => {
    const from = [at(-3, 1, 2)];
    const to = [at(1, 4, -1)];

    const first = windUp(from, to, 0)[0];
    expect([first.x, first.y, first.z]).toEqual([-3, 1, 2]);

    const last = windUp(from, to, 1)[0];
    expect([last.x, last.y, last.z]).toEqual([1, 4, -1]);
  });

  it('carries the handful up over the straight line between them', () => {
    // Both ends at the same height, so any height in the middle is the arc's.
    const from = [at(-4, 1, 0)];
    const to = [at(4, 1, 0)];
    const middle = windUp(from, to, 0.5)[0];
    expect(middle.y).toBeGreaterThan(1);
  });

  it('leaves a held die exactly where it is', () => {
    /*
      Held means the player chose to keep it, and a kept die is scenery the
      thrown ones bounce off — `openThrow` makes it a *fixed* body. It must not
      move a pixel while the others are picked up.

      This caught the bug it is written for: the lift is added on top of the
      interpolation rather than along it, so a die whose two ends are the same
      pose still rose a fifth of its own height into the air and came back.
    */
    const still = lying(4, 2, -2);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(windUp([still], [still], t, [true])[0]).toEqual(still);
    }
  });

  it('is short enough not to read as lag', () => {
    // Three rolls a turn in Yahtzee, so this is paid three times a turn.
    expect(WINDUP_MS).toBeLessThanOrEqual(200);
  });
});

describe('the slow moment', () => {
  const beats: Beats = { steps: 120, decisive: 60 };

  it('runs at life speed until the decisive contact is coming', () => {
    expect(paceOf(0, beats)).toBe(1);
    expect(paceOf(40, beats)).toBe(1);
  });

  it('slows through the contact and then runs fast through the tail', () => {
    expect(paceOf(60, beats)).toBeLessThan(1);
    expect(paceOf(55, beats)).toBeLessThan(1);
    expect(paceOf(110, beats)).toBeGreaterThan(1);
  });

  it('leaves a throw with no moment in it alone', () => {
    // A gentle tap settles almost at once. Slowing a die down before it has
    // done anything reads as a dropped frame, not as emphasis.
    const brief: Beats = { steps: 20, decisive: 4 };
    for (let step = 0; step <= 20; step++) expect(paceOf(step, brief)).toBe(1);
    expect(inSlowMoment(4, brief)).toBe(false);
  });

  it('never stops the clock, in either direction', () => {
    // A rate of zero hangs the throw; a negative one runs it backwards. Both
    // are the kind of thing a retune does by accident.
    for (const spec of [beats, { steps: 300, decisive: 200 }]) {
      for (let step = 0; step <= spec.steps; step++) {
        expect(paceOf(step, spec)).toBeGreaterThan(0);
      }
    }
  });
});

describe('the flourish', () => {
  const hand = [lying(5, -4, 0), lying(5, -2, 0), lying(5, 0, 0), lying(5, 2, 0), lying(5, 4, 0)];

  /**
   * The rule the whole flourish is built around: the scoresheet beside the
   * tray already says what was rolled, and a cube that disagrees with it is the
   * bug the 3D rewrite started from. A turn about the world's vertical axis is
   * the one spin that cannot change which face is on top — this is that claim,
   * checked rather than trusted.
   */
  it('never changes the number a die is showing', () => {
    const total = cheerLength('all', hand.length);
    for (let ms = 0; ms <= total; ms += 4) {
      for (const die of cheerPose(hand, 'all', ms)) {
        expect(faceUp(die.q)).toBe(5);
      }
    }
  });

  it('holds every face through a smaller flourish too', () => {
    const pair = [lying(2, -2, 0), lying(2, 2, 0)];
    const total = cheerLength('pair', pair.length);
    for (let ms = 0; ms <= total; ms += 4) {
      for (const die of cheerPose(pair, 'pair', ms)) expect(faceUp(die.q)).toBe(2);
    }
  });

  it('holds every one of the six', () => {
    for (let face = 1; face <= 6; face++) {
      const one = [lying(face)];
      const total = cheerLength('all', 1);
      for (let ms = 0; ms <= total; ms += 7) {
        expect(faceUp(cheerPose(one, 'all', ms)[0].q)).toBe(face);
      }
    }
  });

  it('starts and finishes with the dice exactly where they were lying', () => {
    const total = cheerLength('all', hand.length);
    for (const ms of [0, total, total + 500]) {
      expect(cheerPose(hand, 'all', ms)).toEqual(hand);
    }
  });

  it('never lifts a die out of the frame', () => {
    // `scene.ts` frames four units of headroom above the floor; a die is two on
    // a side, so its top is its centre plus one. Above that is a celebration
    // drawn outside the picture.
    const total = cheerLength('all', hand.length);
    for (let ms = 0; ms <= total; ms += 4) {
      for (const die of cheerPose(hand, 'all', ms)) expect(die.y + 1).toBeLessThanOrEqual(4);
    }
  });

  it('leaves a die out where it is told to', () => {
    const skip = [false, false, true, false, false];
    const mid = cheerLength('all', hand.length) / 2;
    const drawn = cheerPose(hand, 'all', mid, skip);
    expect(drawn[2]).toEqual(hand[2]);
  });

  it('ripples rather than jumping as one', () => {
    // Five dice leaving the table on the same frame is one object, not five.
    const drawn = cheerPose(hand, 'all', 90);
    const heights = new Set(drawn.map((die) => die.y));
    expect(heights.size).toBeGreaterThan(1);
  });

  it('reports each landing exactly once across the whole flourish', () => {
    const total = cheerLength('all', hand.length);
    const seen: number[] = [];
    let was = 0;
    // 16ms apart, which is the frame budget the real loop samples on.
    for (let ms = 0; ms <= total + 32; ms += 16) {
      seen.push(...landedBetween('all', hand.length, was, ms));
      was = ms;
    }
    expect(seen.slice().sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('slerp', () => {
  it('takes the short way round', () => {
    // A quaternion and its negation are the same rotation. Interpolating
    // towards the wrong one of them spins a die visibly backwards.
    const a: Quat = [1, 0, 0, 0];
    const away: Quat = [-0.9999, 0, 0.0141, 0];
    const half = slerp(a, away, 0.5);
    // Halfway to a rotation this close to the start is still close to it.
    expect(Math.abs(half[0])).toBeGreaterThan(0.99);
  });

  it('returns unit rotations throughout', () => {
    const a = UPRIGHT[3];
    const b = UPRIGHT[6];
    for (let t = 0; t <= 1; t += 0.05) {
      const q = slerp(a, b, t);
      expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 10);
    }
  });

  it('hits both ends', () => {
    const a = UPRIGHT[2];
    const b = UPRIGHT[5];
    expect(faceUp(slerp(a, b, 0))).toBe(2);
    expect(faceUp(slerp(a, b, 1))).toBe(5);
  });
});
