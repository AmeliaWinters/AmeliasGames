/**
 * The die's shape, checked against the die's collider.
 *
 * This is the only drawing in the app that has a second opinion to be held
 * against: Rapier is simulating a `roundCuboid` of half-extent `DIE_HALF` and
 * radius `DIE_ROUND`, and `dieGeometry` claims to be that surface. A die drawn
 * even slightly larger than the one being simulated visibly misses the wall it
 * just bounced off, and nothing else in the pipeline can tell: `faceUp` reads
 * a rotation and the tests above it read numbers, so the picture is exactly
 * where a mismatch would hide.
 *
 * Geometry is arithmetic, so all of this runs in Node with no WebGL, the same
 * seam `scene.test.ts` is built on.
 */
import { describe, expect, it } from 'vitest';
import { dieGeometry, DIE_MATERIALS } from './dieGeometry.js';
import { DIE_HALF, DIE_ROUND } from './engine.js';

/** Every vertex, as triples. */
function points(geometry = dieGeometry()): Array<[number, number, number]> {
  const p = geometry.getAttribute('position');
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
  return out;
}

describe('the die as drawn', () => {
  /**
   * The invariant the whole shape rests on.
   *
   * A rounded cuboid is the inner box grown by a sphere, so *every* point on
   * its surface, flat faces and edge rounds and corner rounds alike, is exactly
   * one radius from the inner box. One line, and it catches a face at the wrong
   * offset, a roundover of the wrong size, and a corner patch that does not
   * meet the strips beside it, all at once.
   */
  it('lies exactly on the surface Rapier is simulating', () => {
    const core = DIE_HALF - DIE_ROUND;
    for (const [x, y, z] of points()) {
      const dx = x - Math.max(-core, Math.min(core, x));
      const dy = y - Math.max(-core, Math.min(core, y));
      const dz = z - Math.max(-core, Math.min(core, z));
      expect(Math.hypot(dx, dy, dz)).toBeCloseTo(DIE_ROUND, 6);
    }
  });

  it('is exactly a die across its flats', () => {
    // The mistake this is here for: `roundCuboid` adds its radius *outside* the
    // half-extents it is given, so building the mesh from the full `DIE_HALF`
    // produces a die a radius too big in all six directions: 19mm of die where
    // the physics has 16.
    for (const axis of [0, 1, 2] as const) {
      const all = points().map((p) => p[axis]);
      expect(Math.max(...all)).toBeCloseTo(DIE_HALF, 6);
      expect(Math.min(...all)).toBeCloseTo(-DIE_HALF, 6);
    }
  });

  it('keeps a face of its own for each of the six numbers, plus the shell', () => {
    /*
      `scene.ts` maps `FACE_ORDER` onto groups 0-5 in `BoxGeometry`'s order, and
      a die that draws its numbers on the wrong sides is internally consistent
      and wrong about what it rolled, the bug the whole 3D rewrite started
      from. So the group *indices* are pinned, not just the count.
    */
    const geometry = dieGeometry();
    const used = geometry.groups.map((g) => g.materialIndex).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(used).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(DIE_MATERIALS).toBe(7);
    // The six flats come first and in order, because that order is the contract.
    expect(geometry.groups.slice(0, 6).map((g) => g.materialIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('points every triangle outwards', () => {
    /*
      Backface culling means a triangle wound the wrong way is not a small
      shading error, it is a hole you can see the inside of the die through, and
      it only shows from one side, so it survives a glance at a still.

      The die is convex and centred on the origin, so a correctly wound triangle
      has its geometric normal pointing away from the centre. That is the whole
      test, and it covers all 26 patches at once, which is the point: the edge
      strips and corner octants are mirror images of one another and the winding
      that is right for one is inside-out for its neighbour.
    */
    const geometry = dieGeometry();
    const p = points(geometry);
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const a = p[index.getX(i)];
      const b = p[index.getX(i + 1)];
      const c = p[index.getX(i + 2)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]).toBeGreaterThan(0);
    }
  });

  it('draws no triangle with nothing in it', () => {
    /*
      The other half of the test above, and the reason that one was passing a
      lie for as long as it was.

      A zero-area triangle paints nothing, so on its own it is only waste. The
      damage is that it has no normal either, which is what `quad` reads to
      decide which way round to wind the cell -- so at the twenty-four cells
      that had one, the winding check silently abstained and took its
      un-flipped branch, and on four of the eight corner octants that branch is
      the inside-out one. "Points every triangle outwards" cannot catch that,
      because the triangle it would have caught is the one with no area to
      have a direction.

      So the two are pinned separately: this one is the guard, and it fails
      first if a future patch reintroduces a collapsed row.
    */
    const geometry = dieGeometry();
    const p = points(geometry);
    const index = geometry.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      const a = p[index.getX(i)];
      const b = p[index.getX(i + 1)];
      const c = p[index.getX(i + 2)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      expect(Math.hypot(n[0], n[1], n[2])).toBeGreaterThan(0);
    }
  });

  it('samples the pips at the size the canvas drew them', () => {
    /*
      The flat part of a rounded die is smaller than the die, so stretching the
      whole texture across it draws every pip about a fifth too large. The face
      has to sample the *middle* of the canvas instead, and how much of the
      middle is fixed by the geometry rather than chosen.
    */
    const geometry = dieGeometry();
    const uv = geometry.getAttribute('uv');
    const inset = (DIE_HALF - DIE_ROUND) / DIE_HALF;
    const flats: number[] = [];
    // Groups 0-5 are the flats; their vertices are the first 24, four per face.
    for (let i = 0; i < 24; i++) flats.push(uv.getX(i), uv.getY(i));
    for (const t of flats) {
      expect(Math.abs(t - 0.5)).toBeCloseTo(inset / 2, 6);
    }
  });

  it('stays a small mesh, because five of them are drawn per tray', () => {
    // Three trays of five dice are on screen at once in Liar's Dice.
    expect(dieGeometry().getIndex()!.count / 3).toBeLessThan(400);
  });
});
