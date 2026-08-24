/**
 * A throw as it arrives from a client, which is to say: anything at all.
 *
 * `readThrow` and `readFlick` are the whole of what the rules still check
 * about a throw, now that the simulation runs on the client that threw it —
 * see the note in `toss.ts` about what that does and does not buy. This file
 * is about the part that is still enforceable: the shape.
 */

import { describe, expect, it } from 'vitest';
import { MAX_FLICK, nextToss, readFlick, readThrow, row3, type Toss } from './toss.js';
import { UPRIGHT, type Quat, type Tray } from './dice.js';

const TRAY: Tray = { w: 100, h: 44, die: 5.63 };

/** A throw an honest client would send: five dice, lying flat, in a row. */
function honest(faces: number[], flick: Record<string, number> = {}) {
  return {
    seed: 1234,
    faces,
    rest: row3(TRAY, faces.length, faces),
    x: 0,
    y: 0,
    ...flick,
  };
}

describe('a flick off the wire', () => {
  it('keeps a throw that was aimed', () => {
    expect(readFlick({ x: 1.5, y: -2, ax: 0.25, ay: 0.75 })).toEqual({
      x: 1.5,
      y: -2,
      ax: 0.25,
      ay: 0.75,
    });
  });

  it('is a tap when there was no gesture at all', () => {
    expect(readFlick({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(readFlick(null)).toEqual({ x: 0, y: 0 });
    expect(readFlick('a throw, honest')).toEqual({ x: 0, y: 0 });
  });

  it('takes the speed down to the cap and leaves the direction alone', () => {
    const wild = readFlick({ x: 1e308, y: -1e308 });
    expect(wild.x).toBe(MAX_FLICK);
    expect(wild.y).toBe(-MAX_FLICK);
  });

  it('reads nonsense as nothing rather than as NaN', () => {
    expect(readFlick({ x: 'fast', y: undefined })).toEqual({ x: 0, y: 0 });
    expect(readFlick({ x: 0, y: 0, ax: Number.NaN, ay: 0.5 })).toEqual({ x: 0, y: 0 });
  });

  it('refuses half an aim, because half an aim is not one', () => {
    // A corner nobody flicked from is worse than no aim at all: `entryOf`
    // would bring the dice in from an edge the hand never went near.
    expect(readFlick({ x: 2, y: 0, ax: 0.3 })).toEqual({ x: 2, y: 0 });
    expect(readFlick({ x: 2, y: 0, ay: 0.3 })).toEqual({ x: 2, y: 0 });
  });

  it('keeps an aim on the tray', () => {
    const off = readFlick({ x: 2, y: 2, ax: -4, ay: 9 });
    expect(off.ax).toBe(0);
    expect(off.ay).toBe(1);
  });
});

describe('a throw off the wire', () => {
  it('believes an honest one', () => {
    const sent = honest([1, 2, 3, 4, 5], { x: 2, y: -1, ax: 0.1, ay: 0.9 });
    const read = readThrow(sent, 5, TRAY);
    expect(read?.faces).toEqual([1, 2, 3, 4, 5]);
    // The aim rides along with it: the animation is a re-run, and a re-run
    // that does not know where the dice came in from is a different throw.
    expect(read?.ax).toBe(0.1);
    expect(read?.ay).toBe(0.9);
  });

  it('refuses a die that is not on the tray', () => {
    const sent = honest([1, 2, 3, 4, 5]);
    sent.rest[2] = { ...sent.rest[2], x: TRAY.w + 40 };
    expect(readThrow(sent, 5, TRAY)).toBeNull();
  });

  it('refuses a rotation that is not one', () => {
    const sent = honest([1, 2, 3, 4, 5]);
    sent.rest[0] = { ...sent.rest[0], q: [2, 0, 0, 0] as unknown as Quat };
    expect(readThrow(sent, 5, TRAY)).toBeNull();
  });

  it('refuses a face that is not on a die', () => {
    expect(readThrow(honest([1, 2, 3, 4, 7]), 5, TRAY)).toBeNull();
  });
});

describe('the next throw', () => {
  const rng = () => 0.5;

  it('carries the whole flick onto the stored throw', () => {
    /*
      The property that makes a replay a replay. The reducer stores a `Toss`
      and every other client re-runs it, so anything `openThrow` reads has to
      survive the trip — the aim was added to `Flick` after `x` and `y`, and
      dropping it here would have lost it silently on every device but the one
      that threw.
    */
    const { toss } = nextToss({
      previous: null,
      sent: honest([6, 6, 6, 6, 6], { x: 3, y: -2, ax: 0.2, ay: 0.8 }),
      tray: TRAY,
      count: 5,
      rng,
    });
    expect(toss.x).toBe(3);
    expect(toss.y).toBe(-2);
    expect(toss.ax).toBe(0.2);
    expect(toss.ay).toBe(0.8);
  });

  it('rolls for itself when it does not believe what arrived', () => {
    const { toss, faces } = nextToss({ previous: null, sent: 'five sixes', tray: TRAY, count: 5, rng });
    expect(faces).toHaveLength(5);
    // No seed means no animation to replay, which is the honest result: this
    // throw was not simulated by anybody.
    expect(toss.seed).toBe(0);
    expect(toss.ax).toBeUndefined();
  });

  it('overrules a kept die, whatever the client said about it', () => {
    const previous: Toss = {
      n: 1,
      seed: 1,
      x: 0,
      y: 0,
      from: row3(TRAY, 2, [1, 1]),
      rest: row3(TRAY, 2, [4, 5]),
    };
    const lying = {
      seed: 9,
      faces: [6, 6],
      rest: row3(TRAY, 2, [6, 6]),
      x: 0,
      y: 0,
    };
    const { toss, faces } = nextToss({
      previous,
      sent: lying,
      tray: TRAY,
      count: 2,
      rng,
      held: [true, false],
    });
    expect(faces[0]).toBe(4);
    expect(toss.rest[0].q).toEqual(UPRIGHT[4]);
    // And the die that was not being kept is still the client's to report.
    expect(faces[1]).toBe(6);
  });
});
