import { describe, expect, it } from 'vitest';
import { WEDGE_ARC } from '../../shared/games/wheelDisplay.js';
import { FLAP_MAX, WEDGE_COUNT, bandPath, flapAngle, restAngle } from './wheelGeometry.js';

/**
 * The flapper, pinned rather than looked at.
 *
 * It is driven frame by frame off the wheel's live rotation, which is the one
 * kind of thing this project cannot verify in a browser — the preview pane is
 * a hidden document and never composites a frame. So the shape of the motion
 * is a pure function, and this is where it is checked.
 */
describe('the flapper', () => {
  it('hangs still wherever the wheel comes to rest', () => {
    for (let at = 0; at < WEDGE_COUNT; at++) {
      expect(flapAngle(restAngle(at))).toBe(0);
    }
    // And after any number of whole turns on top, which is how a spin arrives.
    expect(flapAngle(restAngle(7) + 5 * 360)).toBe(0);
  });

  it('is pushed hardest just before a peg passes, and drops as it does', () => {
    const peg = restAngle(0) + WEDGE_ARC / 2; // a wedge boundary under the pointer
    expect(flapAngle(peg - 0.01)).toBeGreaterThan(FLAP_MAX * 0.99);
    expect(flapAngle(peg + 0.01)).toBeLessThan(FLAP_MAX * 0.01);
  });

  it('ticks once per wedge, and never further than FLAP_MAX', () => {
    const drops: number[] = [];
    let previous = flapAngle(0);
    // Stepped by an exact fraction rather than by adding 0.05 twenty times a
    // degree: the accumulated error was enough to walk straight over the last
    // peg of the turn and count thirty-five.
    for (let step = 1; step <= 7200; step++) {
      const deg = step / 20;
      const now = flapAngle(deg);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).toBeLessThanOrEqual(FLAP_MAX);
      if (now < previous - FLAP_MAX / 2) drops.push(deg);
      previous = now;
    }
    expect(drops).toHaveLength(WEDGE_COUNT);
  });

  it('does not care how many turns the wheel has done', () => {
    for (const deg of [3, 47.5, 112.25]) {
      expect(flapAngle(deg + 12 * 360)).toBeCloseTo(flapAngle(deg), 10);
      expect(flapAngle(deg - 12 * 360)).toBeCloseTo(flapAngle(deg), 10);
    }
  });
});

/** The window the wheel is seen through — two circles, not a rectangle. */
describe('the rim band', () => {
  it('is a ring: an outer edge and a hole', () => {
    const d = bandPath(55);
    expect(d.match(/M /g)).toHaveLength(2);
    // The outer edge is the rim itself, so the wedges reach it exactly.
    expect(d).toContain('A 100 100');
    expect(d).toContain('A 55 55');
  });
});
