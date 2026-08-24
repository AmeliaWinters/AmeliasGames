/**
 * The cube, as geometry.
 *
 * What is left of a 567-line file after the solver it tested moved to Rapier
 * and to the client. The throw is now covered by
 * `src/client/dice3d/engine.test.ts`, which is a weaker set of claims on
 * purpose and says so. This is the half that did not move and did not weaken:
 * which number is on which face is a fact about a cube, and it is still exactly
 * checkable.
 */

import { describe, expect, it } from 'vitest';
import { FACE_AXES, UPRIGHT, faceUp, multiply, normalise, turn, seeded, type Quat } from './dice.js';

describe('the cube', () => {
  it('has six faces, each with a different number', () => {
    expect(new Set(FACE_AXES.map((f) => f.face))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
  });

  it('puts opposite faces on opposite sides, so they sum to seven', () => {
    for (const { face, axis } of FACE_AXES) {
      const other = FACE_AXES.find(
        (f) => f.axis[0] === -axis[0] && f.axis[1] === -axis[1] && f.axis[2] === -axis[2],
      );
      expect(other, `face ${face} has nothing opposite it`).toBeDefined();
      expect(face + other!.face).toBe(7);
    }
  });

  it('reads a one off a die that has not been turned', () => {
    expect(faceUp([1, 0, 0, 0])).toBe(1);
  });
});

describe('a die stood up on purpose', () => {
  it('shows the number it was stood up for', () => {
    /*
      `UPRIGHT` and `faceUp` are the same fact from opposite ends — one puts a
      face up, the other reads which face is up — and this is the assertion
      that stops them drifting apart. It matters more than it looks: `row3` in
      `toss.ts` places dice with `UPRIGHT` whenever the server has to roll for
      itself, and every board reads them back with `faceUp`. The two disagreeing
      is a die showing a number the scoresheet does not have, which is a bug
      this project has now shipped twice.
    */
    for (let face = 1; face <= 6; face++) {
      expect(faceUp(UPRIGHT[face]), `a die stood up for ${face}`).toBe(face);
    }
  });

  it('is stood up by a rotation and not by a stretch', () => {
    for (let face = 1; face <= 6; face++) {
      expect(Math.hypot(...UPRIGHT[face])).toBeCloseTo(1, 12);
    }
  });

  it('still shows it after a turn of the wrist', () => {
    // Spinning a die about the vertical does not change which face is up, and
    // this is the property that lets a resting die be drawn at any angle.
    for (let face = 1; face <= 6; face++) {
      for (const angle of [0.3, 1.1, Math.PI / 2, 2.6, Math.PI]) {
        const spin: Quat = [Math.cos(angle / 2), 0, Math.sin(angle / 2), 0];
        expect(faceUp(normalise(multiply(spin, UPRIGHT[face])))).toBe(face);
      }
    }
  });
});

describe('turning a vector', () => {
  it('leaves its length alone', () => {
    const rng = seeded(12345);
    for (let i = 0; i < 200; i++) {
      const q = normalise([rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5]);
      const v: [number, number, number] = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      expect(Math.hypot(...turn(q, v))).toBeCloseTo(Math.hypot(...v), 10);
    }
  });

  it('agrees with doing it in two steps', () => {
    const rng = seeded(999);
    for (let i = 0; i < 100; i++) {
      const a = normalise([rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5]);
      const b = normalise([rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5]);
      const v: [number, number, number] = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
      const once = turn(multiply(a, b), v);
      const twice = turn(a, turn(b, v));
      for (let k = 0; k < 3; k++) expect(once[k]).toBeCloseTo(twice[k], 10);
    }
  });
});

describe('the seeded rng', () => {
  it('gives the same sequence from the same seed', () => {
    // The property the whole replay rests on: one client's throw is another
    // client's throw only because this is the same everywhere it runs.
    const a = seeded(4242);
    const b = seeded(4242);
    for (let i = 0; i < 500; i++) expect(b()).toBe(a());
  });

  it('gives a different one from a different seed', () => {
    const a = seeded(1);
    const b = seeded(2);
    let same = 0;
    for (let i = 0; i < 500; i++) if (a() === b()) same++;
    expect(same).toBe(0);
  });

  it('stays between zero and one', () => {
    const rng = seeded(0xbeef);
    for (let i = 0; i < 5000; i++) {
      const n = rng();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});
