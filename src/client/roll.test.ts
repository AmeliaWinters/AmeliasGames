/**
 * The spin's schedule.
 *
 * This is the one animation in this app that is arithmetic rather than a
 * stylesheet, so it is the one that can be held to numbers. `css.test.ts`
 * covers the movement around it; nobody can look at either, because the
 * Browser pane never composites a frame (see CLAUDE.md).
 *
 * Three properties, and each of them is a bug that would otherwise ship
 * looking fine in a screenshot: it must not run backwards, it must land on the
 * floor rather than near it, and it must slow down. The last is the whole
 * point of the change -- a constant interval that stops on the answer reads as
 * a list cut off rather than as a machine settling.
 */
import { describe, expect, it } from 'vitest';
import { SPIN_MS, spinFace, spinTicks, startSpin } from './roll.js';

describe('the spin schedule', () => {
  it('runs forwards and ends exactly on the floor', () => {
    const at = spinTicks();
    expect(at.length).toBeGreaterThan(4);
    for (let i = 1; i < at.length; i++) {
      expect(at[i], `tick ${i} is not after ${i - 1}`).toBeGreaterThan(at[i - 1]);
    }
    // Exactly, not nearly: a caller uses the last entry as the floor and
    // should never have to add a fudge to it.
    expect(at[at.length - 1]).toBeCloseTo(SPIN_MS, 6);
    expect(at[0]).toBeGreaterThan(0);
  });

  it('slows down, and opens slower than three frames', () => {
    const at = spinTicks();
    const gaps = at.map((when, i) => when - (i === 0 ? 0 : at[i - 1]));
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i], `gap ${i} is not longer than ${i - 1}`).toBeGreaterThan(gaps[i - 1]);
    }
    /* The first gap is the one taste can get wrong in the direction that
       matters. Under about 50ms is three frames on a 60Hz phone, which is a
       flicker rather than speed -- cubic easing put it at 40 and that is why
       this is quadratic. The last is the hold the reveal lands out of, and it
       has to be long enough to read one face. */
    expect(gaps[0]).toBeGreaterThan(50);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(300);
  });

  it('is a floor a slow answer can overrun', () => {
    // Not a duration this app waits out on top of a slow server. The schedule
    // takes its total from the caller, so a longer spin is longer everywhere
    // rather than a fast one with a pause welded on the end.
    const long = spinTicks(4000);
    expect(long[long.length - 1]).toBeCloseTo(4000, 6);
    expect(long.length).toBe(spinTicks().length);
  });
});

describe('which face a step lands on', () => {
  it('walks the whole pool before it repeats, at every size', () => {
    /* A stride rather than the next entry along, because both pools are
       sorted: in order, fourteen faces out of one series, or fourteen variants
       of one hat. The sizes below are the ones a fixed stride of seven gets
       wrong -- seven itself stands still, and fourteen visits two of them. */
    for (const count of [1, 2, 3, 5, 7, 8, 14, 21, 39, 300]) {
      const seen = new Set<number>();
      for (let step = 0; step < count; step++) {
        const face = spinFace(step, count);
        expect(face, `face ${face} is outside a pool of ${count}`).toBeLessThan(count);
        expect(face).toBeGreaterThanOrEqual(0);
        seen.add(face);
      }
      expect(seen.size, `a pool of ${count} repeats before it is spent`).toBe(count);
    }
  });

  it('has something to show for a pool of one', () => {
    // A set can have one part in a slot, and a modulo by zero or a negative
    // index would be a blank card rather than a still one.
    expect(spinFace(9, 1)).toBe(0);
    expect(spinFace(9, 0)).toBe(0);
  });
});

describe('running a spin', () => {
  it('hands back a way to stop it, and stops', async () => {
    /* Timers rather than fake ones: the whole spin is under two seconds and
       the thing being checked is that cancelling actually clears the chain,
       which a fake clock that never advances would pass without trying. */
    const seen: number[] = [];
    const stop = startSpin((step) => seen.push(step), 200);
    await new Promise((done) => setTimeout(done, 60));
    stop();
    const after = seen.length;
    await new Promise((done) => setTimeout(done, 300));
    expect(seen.length, 'the spin kept going after it was stopped').toBe(after);
  });

  it('counts up from one', async () => {
    // The caller turns a step into an index with `spinFace`, and `spinFace(0)`
    // is the face already on screen -- so a spin that started at zero would
    // open by holding still for a tick.
    const seen: number[] = [];
    const stop = startSpin((step) => seen.push(step), 200);
    await new Promise((done) => setTimeout(done, 60));
    stop();
    expect(seen[0]).toBe(1);
    expect(seen[1]).toBe(2);
  });
});
