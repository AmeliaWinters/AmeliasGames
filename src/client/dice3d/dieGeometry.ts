/**
 * The die, as a shape: a cube with its edges and corners rolled off.
 *
 * Its own file rather than four lines in `scene.ts`, because it is the one
 * piece of drawing in this app that has to agree with something outside
 * itself. `engine.ts` gives Rapier a `roundCuboid` of half-extent `DIE_HALF`
 * and radius `DIE_ROUND`; this builds *that surface*, from the same two
 * numbers, so the die a player sees is the die the physics is bouncing. A cube
 * drawn where a rounded cuboid is simulated is a die whose corner visibly
 * misses the wall it just hit, and nothing else in the pipeline would notice.
 *
 * Why not `BoxGeometry`
 *
 * It was `BoxGeometry`, and a perfectly sharp cube is one of the more reliable
 * ways for a rendered object to look rendered. Real dice have a radius on every
 * edge (1.5 mm on a 16 mm die is ordinary) and it is what gives them their
 * highlight: a sharp edge is a discontinuity that catches one thin line of
 * light, where a rounded one carries a soft band along its whole length and
 * reads as a solid object with a surface.
 *
 * Note what this is *not* claiming. The corner radius was expected to change
 * how the dice roll, and measurement says it does not; `DIE_ROUND` in
 * `engine.ts` carries that result. This is a change to the picture.
 *
 * Why not `RoundedBoxGeometry`
 *
 * three.js ships one, and it cannot be used here: it has no material groups and
 * no per-face UVs, and this die is textured with six different canvases keyed
 * to the six numbers. The faces have to stay separable, and they have to keep
 * `BoxGeometry`'s group order, because `FACE_ORDER` in `scene.ts` maps that
 * order onto the numbers and getting it wrong draws a die that shows a
 * different number from the one the rules recorded.
 */
import * as THREE from 'three';
import { DIE_HALF, DIE_ROUND } from './engine.js';

/**
 * Segments across each quarter-round, per edge and per corner arc.
 *
 * Two is enough and three is imperceptible. The rounded part is a tenth of the
 * die's width, drawn at somewhere between 20 and 60 pixels across on a phone,
 * and the shading across it is a smooth normal rather than the facets. The
 * facets only ever show on the silhouette, where at this radius they are
 * sub-pixel. Five dice at three segments is still under a thousand triangles.
 */
const ARC = 3;

/**
 * The six faces in `BoxGeometry`'s own order and orientation.
 *
 * `w` is the axis the face points along and `s` its sign; `u` and `v` are the
 * axes across it, with `du`/`dv` the direction each runs in. These are copied
 * from three.js's `buildPlane` calls rather than derived, because the *only*
 * thing that matters about them is that they match what `BoxGeometry` did: the
 * pip textures were drawn against that convention and the group indices are
 * read against it in `scene.ts`.
 */
const FACES: ReadonlyArray<{ w: 0 | 1 | 2; s: 1 | -1; u: 0 | 1 | 2; v: 0 | 1 | 2; du: 1 | -1; dv: 1 | -1 }> = [
  { w: 0, s: 1, u: 2, v: 1, du: -1, dv: -1 }, // +x
  { w: 0, s: -1, u: 2, v: 1, du: 1, dv: -1 }, // -x
  { w: 1, s: 1, u: 0, v: 2, du: 1, dv: 1 }, //  +y
  { w: 1, s: -1, u: 0, v: 2, du: 1, dv: -1 }, // -y
  { w: 2, s: 1, u: 0, v: 1, du: 1, dv: -1 }, //  +z
  { w: 2, s: -1, u: 0, v: 1, du: -1, dv: -1 }, // -z
];

type Vec = [number, number, number];

/**
 * A rounded die, centred on the origin.
 *
 * Seven groups: 0-5 are the flat faces, in `BoxGeometry`'s order, and **6 is
 * the shell**, every edge and corner at once, which takes one plain material
 * because there are no pips on it. `scene.ts` has to supply seven materials.
 *
 * `half` and `radius` default to the physics' own, and exist as arguments only
 * so the tests can hold the shape to account at sizes where a discrepancy is
 * visible in a number.
 */
export function dieGeometry(half = DIE_HALF, radius = DIE_ROUND): THREE.BufferGeometry {
  /** The inner box the rounding is grown from, the same one Rapier is given. */
  const core = half - radius;

  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const groups: Array<[number, number]> = [];

  const put = (p: Vec, n: Vec, s: number, t: number): number => {
    position.push(p[0], p[1], p[2]);
    normal.push(n[0], n[1], n[2]);
    uv.push(s, t);
    return position.length / 3 - 1;
  };

  /*
    A quad, wound so its front is the side its normal points at.

    Worked out from the normal rather than by getting the four corners in the
    right order at each of the twenty-six call sites below. Half of those sites
    are mirror images of another (the -x edge strips run backwards relative to
    the +x ones, and the eight corner octants alternate) so the ordering that is
    right for one is inside-out for its neighbour. One test of the cross product
    costs nothing at build time and removes a whole class of "one face of the
    die is invisible from outside" bug that only shows up at certain angles.
  */
  /**
   * The cross product of two of a triangle's edges: its normal, scaled by
   * twice its area, which is what makes it also the test for having any.
   */
  const cross = (a: number, b: number, c: number): Vec => {
    const at: Vec = [position[a * 3], position[a * 3 + 1], position[a * 3 + 2]];
    const bt: Vec = [position[b * 3], position[b * 3 + 1], position[b * 3 + 2]];
    const ct: Vec = [position[c * 3], position[c * 3 + 1], position[c * 3 + 2]];
    const e1: Vec = [bt[0] - at[0], bt[1] - at[1], bt[2] - at[2]];
    const e2: Vec = [ct[0] - at[0], ct[1] - at[1], ct[2] - at[2]];
    return [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
  };

  /*
    Anything below this is a triangle with no area rather than a small one.
    The quantity is twice an area in the die's own units, where the whole die
    is 1.6 across, so a real sliver off the corner mesh is around 1e-3 and the
    collapsed ones are exactly 0. Six orders of magnitude of daylight.
  */
  const FLAT = 1e-12;

  const quad = (a: number, b: number, c: number, d: number) => {
    const n: Vec = [normal[a * 3], normal[a * 3 + 1], normal[a * 3 + 2]];
    /*
      Which way round this quad has to go, decided from whichever of its two
      triangles has an area to decide it with.

      It used to be read off `a, b, c` alone, and that is the one triangle
      here that is allowed to have no area: each corner octant is a sphere
      patch whose theta = 0 row is the pole repeated, so its first band of
      quads arrives with `a` and `b` at the same point. The cross product came
      out `[0, 0, 0]`, `facing` came out exactly 0, and `facing >= 0` took the
      un-flipped branch -- so the check did not fail, it *abstained*, silently,
      at the twenty-four cells where it was the only thing deciding.

      On the four octants whose natural ordering is already outward that was
      the right answer by luck. On the other four -- the ones where sx*sy*sz
      is positive, which is the mirroring this comment block has warned about
      since it was written -- it was wrong, and every die in the app has been
      drawn with a triangle missing from three of its corners.
    */
    const abc = cross(a, b, c);
    const acd = cross(a, c, d);
    const lead = abc[0] * abc[0] + abc[1] * abc[1] + abc[2] * abc[2] > FLAT ? abc : acd;
    const facing = lead[0] * n[0] + lead[1] * n[1] + lead[2] * n[2];

    const tris: Array<[number, number, number]> =
      facing >= 0
        ? [
            [a, b, c],
            [a, c, d],
          ]
        : [
            [a, d, c],
            [a, c, b],
          ];
    for (const [x, y, z] of tris) {
      // And the flat one is dropped rather than drawn. It paints nothing at
      // any angle, and the twenty-four of them were a twentieth of the die's
      // index buffer being sent to the GPU five times a throw.
      const area = cross(x, y, z);
      if (area[0] * area[0] + area[1] * area[1] + area[2] * area[2] <= FLAT) continue;
      index.push(x, y, z);
    }
  };

  const mark = (start: number, material: number) => {
    groups.push([start, material]);
  };

  // The six flat faces

  /*
    Each is inset by the radius, because that is where the flat part of a
    rounded cuboid actually ends, and its UVs are inset by the same fraction,
    which is the part that is easy to miss. Stretching the full texture across
    the smaller quad would draw the pips about a fifth too large and, worse,
    slightly differently on every die size in the app. Sampling the middle of
    the texture instead keeps a pip the size the canvas drew it, and leaves the
    plain border of the canvas to meet the shell.
  */
  const inset = core / half;
  for (let f = 0; f < FACES.length; f++) {
    const face = FACES[f];
    mark(index.length, f);
    const n: Vec = [0, 0, 0];
    n[face.w] = face.s;
    const corner = (a: number, b: number) => {
      const p: Vec = [0, 0, 0];
      p[face.w] = face.s * half;
      p[face.u] = a * core;
      p[face.v] = b * core;
      // The parameter three.js would have had at this coordinate, so the
      // texture lands the way `BoxGeometry` put it.
      const s = 0.5 + (a * inset * face.du) / 2;
      const t = 0.5 + (b * inset * face.dv) / 2;
      return put(p, n, s, 1 - t);
    };
    quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1));
  }

  // The shell: twelve edges and eight corners

  mark(index.length, 6);

  /*
    A quarter-cylinder along one axis, at one of that axis's four edges.

    `axis` is the direction the edge runs; the other two axes carry the signs
    that say which of the four it is. The normal sweeps a quarter turn from one
    face's normal to the next, and the surface is the inner box's edge line
    pushed out along it, which is the definition of the Minkowski sum Rapier is
    simulating rather than an approximation of it.
  */
  const edge = (axis: 0 | 1 | 2, sa: number, sb: number) => {
    const a = ((axis + 1) % 3) as 0 | 1 | 2;
    const b = ((axis + 2) % 3) as 0 | 1 | 2;
    const ring: number[][] = [];
    for (let i = 0; i <= ARC; i++) {
      const phi = (i / ARC) * (Math.PI / 2);
      const n: Vec = [0, 0, 0];
      n[a] = sa * Math.cos(phi);
      n[b] = sb * Math.sin(phi);
      const row: number[] = [];
      for (const end of [-1, 1]) {
        const p: Vec = [0, 0, 0];
        p[axis] = end * core;
        p[a] = sa * core + n[a] * radius;
        p[b] = sb * core + n[b] * radius;
        row.push(put(p, n, 0.5, 0.5));
      }
      ring.push(row);
    }
    for (let i = 0; i < ARC; i++) quad(ring[i][0], ring[i][1], ring[i + 1][1], ring[i + 1][0]);
  };

  for (const axis of [0, 1, 2] as const) {
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) edge(axis, sa, sb);
  }

  /*
    And an octant of a sphere at each corner, parameterised so its three
    boundaries land exactly on the three edge strips that meet there.

    theta runs from the `z`-ish pole to the equator and phi around it. At theta = pi/2 the
    normal is the one the axis-2 strip has at the same phi; at phi = 0 and phi = pi/2
    it matches the other two. Not decoration: a mismatch of a thousandth of a
    centimetre is a hairline crack you can see the inside of the die through,
    and the die is lit from outside.
  */
  const corner = (sx: number, sy: number, sz: number) => {
    const grid: number[][] = [];
    for (let i = 0; i <= ARC; i++) {
      const theta = (i / ARC) * (Math.PI / 2);
      const row: number[] = [];
      for (let j = 0; j <= ARC; j++) {
        const phi = (j / ARC) * (Math.PI / 2);
        const n: Vec = [
          sx * Math.sin(theta) * Math.cos(phi),
          sy * Math.sin(theta) * Math.sin(phi),
          sz * Math.cos(theta),
        ];
        row.push(
          put(
            [sx * core + n[0] * radius, sy * core + n[1] * radius, sz * core + n[2] * radius],
            n,
            0.5,
            0.5,
          ),
        );
      }
      grid.push(row);
    }
    for (let i = 0; i < ARC; i++) {
      for (let j = 0; j < ARC; j++) {
        quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
      }
    }
  };

  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corner(sx, sy, sz);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  for (let g = 0; g < groups.length; g++) {
    const [start, material] = groups[g];
    const end = g + 1 < groups.length ? groups[g + 1][0] : index.length;
    geometry.addGroup(start, end - start, material);
  }
  return geometry;
}

/** How many materials `dieGeometry` expects: six faces and the shell. */
export const DIE_MATERIALS = 7;
