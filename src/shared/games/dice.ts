/**
 * What a cube is, and how you read one.
 *
 * This file used to be the simulation too: 1284 lines of 2.5D solver that met
 * dice as squares in a plane and carried height as a scalar beside the motion.
 * It ran on the server, it was pure and seeded, and its fairness was *proved*,
 * because the plane never read the cube's orientation, so a die's start
 * orientation passed through untouched and the odds came out exactly even.
 * `dice.test.ts` asserted `[20,20,20,20,20,20]` with no tolerance at all.
 *
 * That solver is gone, traded for real cubes that can land on a corner, topple,
 * wedge and stack. Its replacement is Rapier, it runs on the client, and
 * `src/client/dice3d/engine.ts` explains what the trade cost. What is left here
 * is the part that was never about motion: which number is on which face, and
 * which way up a die has to be to show it.
 *
 * It stays in `shared/` because the reducers need it. A game that has to invent
 * a throw for itself (no WebAssembly, a keyboard roll, anything `readThrow`
 * refuses) still has to put the dice down showing the numbers it rolled, and
 * that is `upright` below.
 *
 * Axes
 *
 * **x right, y up, z towards the bottom of the screen.** Gravity is along -y
 * and the face you read is the one pointing at the ceiling.
 *
 * This is a change. The old file used CSS's axes (x right, y *down*, z out
 * towards the player) because its rotations went straight to `matrix3d` and
 * reading the face meant asking which normal pointed at your eye. Nothing
 * hands rotations to CSS any more; three.js draws the dice, and three.js is
 * y-up. Anything still thinking in the old frame is wrong, and the swap
 * between them is y and z.
 */

/** `[w, x, y, z]`. */
export type Quat = readonly [number, number, number, number];

/**
 * A tray, in its own units.
 *
 * Not pixels, and that is the whole point of it: a tray is about 320px on a
 * phone and twice that on a laptop, and a throw fed pixels would land the dice
 * on different faces on the two of them.
 */
export interface Tray {
  w: number;
  h: number;
  /** A die's edge, in the same units. */
  die: number;
}

/**
 * Which number is on which face, by the direction that face points in the
 * die's own frame. Opposite faces sum to seven, as they must.
 */
export const FACE_AXES: ReadonlyArray<{ face: number; axis: readonly [number, number, number] }> = [
  { face: 1, axis: [0, 1, 0] },
  { face: 6, axis: [0, -1, 0] },
  { face: 2, axis: [0, 0, 1] },
  { face: 5, axis: [0, 0, -1] },
  { face: 3, axis: [1, 0, 0] },
  { face: 4, axis: [-1, 0, 0] },
];

export function multiply(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function normalise(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Turn a vector by a rotation. */
export function turn(q: Quat, v: readonly [number, number, number]): [number, number, number] {
  const [w, x, y, z] = q;
  // v + 2-q_v x (q_v x v + w-v), the usual expansion. Cheaper than building
  // the matrix for one vector, and this is called six times per die.
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** The number a die in this orientation is showing: the face pointing up. */
export function faceUp(q: Quat): number {
  let best = 0;
  let towards = -Infinity;
  for (const { face, axis } of FACE_AXES) {
    const up = turn(q, axis)[1];
    if (up > towards) {
      towards = up;
      best = face;
    }
  }
  return best;
}

const HALF = Math.SQRT1_2;

/**
 * A die lying flat with `face` showing, for each of the six.
 *
 * Built as the rotation that carries that face's own normal onto +y, and
 * checked by `dice.test.ts` against `faceUp` so the two cannot drift apart.
 * They are the same fact from opposite ends, and a die placed by one and read
 * by the other disagreeing about its number is the bug this project has
 * already shipped twice.
 */
export const UPRIGHT: Readonly<Record<number, Quat>> = {
  1: [1, 0, 0, 0], //                 already up
  6: [0, 1, 0, 0], // 180 deg about x
  2: [HALF, -HALF, 0, 0], // -90 deg about x, bringing +z up
  5: [HALF, HALF, 0, 0], //  +90 deg about x, bringing -z up
  3: [HALF, 0, 0, HALF], //  +90 deg about z, bringing +x up
  4: [HALF, 0, 0, -HALF], // -90 deg about z, bringing -x up
};

/**
 * mulberry32. Small, fast, and (the only property that matters here) the same
 * sequence from the same seed on every machine, which is what lets one client
 * replay another's throw.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
