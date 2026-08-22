import { pick } from './random.js';
import { readFlick, type Toss } from './toss.js';
import type { Rng } from '../types.js';

/**
 * Dice, simulated.
 *
 * Cubes tumbling across a tray, seen from above. The number a die shows is not
 * chosen and then displayed — it is **read off the die when it stops**, from
 * whichever face happens to be pointing at the player. The throw decides.
 *
 * ── Why this is in `shared/` ───────────────────────────────────────────
 *
 * Because the server runs it. Everything else in this project rests on the
 * server owning the rng and the client only rendering what it is sent, and a
 * client that decided its own faces could roll until it liked one. So the
 * reducer runs this simulation, reads the faces off the resting cubes, and
 * puts the throw on the wire; every client re-runs the identical simulation
 * for the animation and arrives at the same dice on the same faces. Nobody is
 * told a number the dice did not land on.
 *
 * That only works if it is **exactly** reproducible, which is why:
 *
 * - no `Math.random` — every random number comes from the seeded generator
 *   below, and the seed comes from the server;
 * - no `Date.now`, and a fixed timestep, so a 120Hz phone, a 60Hz phone and a
 *   Durable Object all step it identically;
 * - the tray is measured in its own units, not pixels. A phone's tray is half
 *   the width of a laptop's, and a simulation in pixels would land on
 *   different faces on the two of them.
 *
 * Break any of the three and the dice disagree across the table, which no test
 * of a single client will catch.
 *
 * ── Why the odds are still even ────────────────────────────────────────
 *
 * A tumbling cube is chaotic but not obviously *fair*, and "the physics
 * decides" is worthless if the physics has a favourite number. It is fair for
 * a reason that has nothing to do with the tumble:
 *
 * Each die starts in one of the cube's 24 orientations, drawn uniformly from
 * the server's rng and independently of everything else (`Toss.spin`). The
 * simulation then applies some rotation to it — a complicated one, but a
 * *fixed* one, because the tumbling is driven entirely by where the die slides
 * and never feeds back into it. A uniformly random orientation composed with
 * any fixed rotation is still uniformly random, so the face that ends up
 * pointing at the player is exactly uniform over the six. The physics decides
 * which face; the draw decides that it is even.
 *
 * That independence is load-bearing: the moment the 3D orientation is allowed
 * to affect the 2D motion, the argument above stops holding and the dice
 * quietly stop being fair.
 */

/** Where a die is: in the plane, plus which of the 24 orientations it is in. */
export interface Rest {
  x: number;
  y: number;
  /** An index into `ORIENTATIONS`. */
  o: number;
}

/** A tray, in its own units. Fixed per game, and the same on every device. */
export interface Tray {
  w: number;
  h: number;
  /** A die's edge, in the same units. */
  die: number;
}

/** Tunables, one constant each. The comments are why, not what. */
export const P = {
  /** Fixed, so the same toss lands the same way at any refresh rate. */
  STEP: 1 / 120,
  /** Substeps per frame, so a tab that stalled cannot spiral catching up. */
  MAX_STEPS: 8,
  /** The table itself, per second, in tray widths. */
  LIN_DAMP: 2.4,
  /** Higher than linear, or dice keep spinning after they stop travelling. */
  ANG_DAMP: 3.4,
  /** The tray is the hard thing in the room, so it bounces more than a die. */
  WALL_E: 0.42,
  /** Die on die. Above ~0.5 they ping about like marbles. */
  E: 0.34,
  /** Coulomb friction at every contact: what turns a slide into a skid. */
  MU: 0.45,
  /** Below this a body is a candidate for sleep, in tray units a second. */
  SLEEP_V: 3.4,
  SLEEP_W: 0.8,
  /** And it has to stay slow this long, or dice flicker awake on a nudge. */
  SLEEP_MS: 70,
  /** Damping quadruples here. A throw is a moment, not a cutscene. */
  DEADLINE: 620,
  /** Everything sleeps regardless. The promise that a turn always ends. */
  HARD_STOP: 1150,
  /** Contacts softer than this are the solver settling, not dice landing. */
  QUIET: 4,
  /**
   * How long a thrown die is off the table, in milliseconds.
   *
   * Not a flourish — it is what stops a die thrown out of a gap between two
   * dice you are keeping from being boxed in and travelling five pixels. You
   * do not throw a die from between two others; you pick it up and throw it
   * over them, and for the first part of its flight it is above the table.
   * Walls still stop it, because the tray has sides.
   */
  AIRBORNE: 140,
  /**
   * Collision passes per step. One is not enough: a die shoved out of its
   * neighbour lands in the next one, and a resting pile settled about a tenth
   * of a die deep into itself — visibly overlapping, and dice that overlap
   * stop reading as objects.
   */
  PASSES: 3,
} as const;

// ── The cube ───────────────────────────────────────────────────────────

/**
 * A rotation, as a quaternion `[w, x, y, z]`.
 *
 * Axes are the screen's: x right, y **down**, z out towards the player. Those
 * are CSS's axes too, which is what lets the client hand the same matrix
 * straight to `matrix3d` without a change of basis nobody would remember.
 */
export type Quat = readonly [number, number, number, number];

/**
 * Which number is on which face, by the direction that face points in the
 * die's own frame. Opposite faces sum to seven, as they must.
 */
const FACE_AXES: ReadonlyArray<{ face: number; axis: readonly [number, number, number] }> = [
  { face: 1, axis: [0, 0, 1] },
  { face: 6, axis: [0, 0, -1] },
  { face: 2, axis: [0, 1, 0] },
  { face: 5, axis: [0, -1, 0] },
  { face: 3, axis: [1, 0, 0] },
  { face: 4, axis: [-1, 0, 0] },
];

function multiply(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

function normalise(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Turn a vector by a rotation. */
export function turn(q: Quat, v: readonly [number, number, number]): [number, number, number] {
  const [w, x, y, z] = q;
  // v + 2·q_v × (q_v × v + w·v), the usual expansion — cheaper than building
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

/**
 * The 24 ways a cube can sit square: six faces towards the player, each with
 * four turns of the wrist.
 *
 * Built rather than written out, so the order is fixed by the code and the
 * list cannot drift out of step with itself. The order is only ever an index
 * into this array, so it need not mean anything — but it must never change,
 * because it goes on the wire.
 */
export const ORIENTATIONS: readonly Quat[] = (() => {
  const quarter = Math.SQRT1_2;
  /** Six rotations that bring each face to the front. */
  const faces: Quat[] = [
    [1, 0, 0, 0], //                     1 towards the player
    [0, 0, 1, 0], // 180° about y →      6
    [quarter, 0, -quarter, 0], // -90° about y →  3
    [quarter, 0, quarter, 0], //  +90° about y →  4
    [quarter, quarter, 0, 0], //  +90° about x →  5
    [quarter, -quarter, 0, 0], // -90° about x →  2
  ];
  /** And four turns about the axis pointing at the player. */
  const spins: Quat[] = [
    [1, 0, 0, 0],
    [quarter, 0, 0, quarter],
    [0, 0, 0, 1],
    [quarter, 0, 0, -quarter],
  ];
  const all: Quat[] = [];
  for (const f of faces) for (const s of spins) all.push(normalise(multiply(f, s)));
  return all;
})();

/** The number a die in this orientation is showing. */
export function faceOf(q: Quat): number {
  let best = 0;
  let towards = -Infinity;
  for (const { face, axis } of FACE_AXES) {
    // How much of this face's normal points at the player.
    const z = turn(q, axis)[2];
    if (z > towards) {
      towards = z;
      best = face;
    }
  }
  return best;
}

/** The nearest of the 24 square orientations — where a landing die settles. */
export function squareUp(q: Quat): number {
  let best = 0;
  let nearest = -Infinity;
  for (let i = 0; i < ORIENTATIONS.length; i++) {
    const o = ORIENTATIONS[i];
    // |dot| rather than dot: q and -q are the same rotation.
    const dot = Math.abs(q[0] * o[0] + q[1] * o[1] + q[2] * o[2] + q[3] * o[3]);
    if (dot > nearest) {
      nearest = dot;
      best = i;
    }
  }
  return best;
}

// ── Bodies ─────────────────────────────────────────────────────────────

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /**
   * The footprint's angle, and how fast it is turning. Two fields and not one:
   * the collisions need the angle to know the shape and the rate to know the
   * momentum, and they are as different as a position and a velocity.
   *
   * This is the die's turn *in the plane* only. Which face it is showing is
   * `q`, and the two are not the same question.
   */
  a: number;
  w: number;
  /** How the cube is turned. Driven by the motion, and never driving it. */
  q: Quat;
  half: number;
  /** Inverse mass and inverse inertia. Zero for a die being kept. */
  im: number;
  ii: number;
  asleep: boolean;
  slow: number;
  /** Milliseconds of flight left before it is on the table again. */
  air: number;
}

/** One resolved contact, for the sound. `wall` is die on tray, not die on die. */
export interface Contact {
  impulse: number;
  wall: boolean;
}

export interface World {
  tray: Tray;
  /** Milliseconds since the throw began. */
  t: number;
  bodies: Body[];
  rng: () => number;
}

/** mulberry32: small, fast, and good enough to scatter five dice. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Dice in a row, at rest — where they sit before anything has been thrown. */
export function row(tray: Tray, count: number): Rest[] {
  const gap = tray.die * 0.17;
  const span = count * tray.die + (count - 1) * gap;
  const x0 = (tray.w - span) / 2 + tray.die / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: x0 + i * (tray.die + gap),
    y: tray.h / 2,
    o: 0,
  }));
}

// ── The solver ─────────────────────────────────────────────────────────

/** Half-extent of the die's footprint projected on a unit axis. */
function extent(b: Body, nx: number, ny: number): number {
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  return b.half * (Math.abs(nx * c + ny * s) + Math.abs(-nx * s + ny * c));
}

/** The four corners of the die's footprint, in tray space. */
function corners(b: Body): Array<[number, number]> {
  const c = Math.cos(b.a);
  const s = Math.sin(b.a);
  const h = b.half;
  return [
    [b.x - h * c + h * s, b.y - h * s - h * c],
    [b.x + h * c + h * s, b.y + h * s - h * c],
    [b.x + h * c - h * s, b.y + h * s + h * c],
    [b.x - h * c - h * s, b.y - h * s + h * c],
  ];
}

const cross = (rx: number, ry: number, nx: number, ny: number) => rx * ny - ry * nx;

/**
 * One contact, resolved as an impulse. Returns its magnitude, which is what
 * the sound is made of — a glancing touch and a full-speed corner strike are
 * not the same noise, and that is the thing a recorded clip can never do.
 *
 * `b` is null for a wall, which is an immovable body with no inverse mass.
 */
function resolve(
  a: Body,
  b: Body | null,
  nx: number,
  ny: number,
  depth: number,
  px: number,
  py: number,
  e: number,
): number {
  const rax = px - a.x;
  const ray = py - a.y;
  const rbx = b ? px - b.x : 0;
  const rby = b ? py - b.y : 0;

  const avx = a.vx - a.w * ray;
  const avy = a.vy + a.w * rax;
  const bvx = b ? b.vx - b.w * rby : 0;
  const bvy = b ? b.vy + b.w * rbx : 0;
  const vn = (bvx - avx) * nx + (bvy - avy) * ny;
  // Already separating. Resolving this would suck the bodies back together.
  if (vn > 0) return 0;

  const ra = cross(rax, ray, nx, ny);
  const rb = b ? cross(rbx, rby, nx, ny) : 0;
  const denom = a.im + (b ? b.im : 0) + ra * ra * a.ii + (b ? rb * rb * b.ii : 0);
  if (denom <= 0) return 0;

  const j = (-(1 + e) * vn) / denom;
  a.vx -= j * nx * a.im;
  a.vy -= j * ny * a.im;
  a.w -= j * ra * a.ii;
  if (b) {
    b.vx += j * nx * b.im;
    b.vy += j * ny * b.im;
    b.w += j * rb * b.ii;
  }

  // Friction along the tangent, clamped by Coulomb. Without it a die glides
  // forever and never spins down.
  const tx = -ny;
  const ty = nx;
  const avx2 = a.vx - a.w * ray;
  const avy2 = a.vy + a.w * rax;
  const bvx2 = b ? b.vx - b.w * rby : 0;
  const bvy2 = b ? b.vy + b.w * rbx : 0;
  const vt = (bvx2 - avx2) * tx + (bvy2 - avy2) * ty;
  const rat = cross(rax, ray, tx, ty);
  const rbt = b ? cross(rbx, rby, tx, ty) : 0;
  const dt = a.im + (b ? b.im : 0) + rat * rat * a.ii + (b ? rbt * rbt * b.ii : 0);
  if (dt > 0) {
    const jt = clamp(-vt / dt, -P.MU * j, P.MU * j);
    a.vx -= jt * tx * a.im;
    a.vy -= jt * ty * a.im;
    a.w -= jt * rat * a.ii;
    if (b) {
      b.vx += jt * tx * b.im;
      b.vy += jt * ty * b.im;
      b.w += jt * rbt * b.ii;
    }
  }

  // Positional correction, or a pile of dice slowly sinks into itself. The
  // slop keeps resting bodies from jittering against a correction that never
  // quite finishes.
  const slop = a.half * 0.01;
  if (depth > slop) {
    const push = (depth - slop) * 0.7;
    const total = a.im + (b ? b.im : 0);
    if (total > 0) {
      a.x -= nx * push * (a.im / total);
      a.y -= ny * push * (a.im / total);
      if (b) {
        b.x += nx * push * (b.im / total);
        b.y += ny * push * (b.im / total);
      }
    }
  }
  return j;
}

/** Separating-axis test between two dice footprints. */
function collide(a: Body, b: Body): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let best = Infinity;
  let nx = 0;
  let ny = 0;

  // Four axes: the two each footprint's edges run along. A square is
  // symmetric, so its other two axes test the same separation negated.
  for (const box of [a, b]) {
    const c = Math.cos(box.a);
    const s = Math.sin(box.a);
    for (const [ax, ay] of [
      [c, s],
      [-s, c],
    ]) {
      const along = dx * ax + dy * ay;
      const overlap = extent(a, ax, ay) + extent(b, ax, ay) - Math.abs(along);
      if (overlap <= 0) return 0;
      if (overlap < best) {
        best = overlap;
        const sign = along < 0 ? -1 : 1;
        nx = ax * sign;
        ny = ay * sign;
      }
    }
  }

  // Contact point: whichever of b's corners is deepest inside a. Approximate,
  // and close enough at this scale — what it buys is that a corner strike
  // spins the die instead of merely pushing it.
  let px = b.x;
  let py = b.y;
  let deepest = Infinity;
  for (const [cx, cy] of corners(b)) {
    const d = (cx - a.x) * nx + (cy - a.y) * ny;
    if (d < deepest) {
      deepest = d;
      px = cx;
      py = cy;
    }
  }
  return resolve(a, b, nx, ny, best, px, py, P.E);
}

function walls(b: Body, world: World, contacts: Contact[]): void {
  const sides: Array<[number, number, number]> = [
    [1, 0, b.x - extent(b, 1, 0)],
    [-1, 0, world.tray.w - (b.x + extent(b, 1, 0))],
    [0, 1, b.y - extent(b, 0, 1)],
    [0, -1, world.tray.h - (b.y + extent(b, 0, 1))],
  ];
  for (const [nx, ny, gap] of sides) {
    if (gap >= 0) continue;
    // The deepest corner against this wall, so a corner strike spins the die.
    let px = b.x;
    let py = b.y;
    let deepest = Infinity;
    for (const [cx, cy] of corners(b)) {
      const d = cx * nx + cy * ny;
      if (d < deepest) {
        deepest = d;
        px = cx;
        py = cy;
      }
    }
    b.x += nx * -gap;
    b.y += ny * -gap;
    const j = resolve(b, null, -nx, -ny, 0, px, py, P.WALL_E);
    if (Math.abs(j) > P.QUIET) contacts.push({ impulse: Math.abs(j), wall: true });
  }
}

/**
 * Positions only, no impulses: the last word on where things actually are.
 *
 * Two things the velocity solver above cannot promise on its own. A die can be
 * shoved back through a wall it was already resting against by a contact
 * resolved after it — an impulse cannot rule that out, where a clamp can, and
 * a die outside the tray is the one failure with nowhere to hide. And a pair
 * can come to rest a little inside each other, which then never gets fixed,
 * because a sleeping pair is skipped.
 *
 * So: push apart, then clamp, and again — clamping can push a die into its
 * neighbour, and separating can push one through a wall. Two rounds settles
 * both to nothing at this scale.
 */
function tidy(world: World): void {
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < world.bodies.length; i++) {
      for (let k = i + 1; k < world.bodies.length; k++) {
        const a = world.bodies[i];
        const b = world.bodies[k];
        const total = a.im + b.im;
        if (total <= 0) continue;
        if (a.air > 0 || b.air > 0) continue;
        const overlap = depth(a, b);
        if (!overlap) continue;
        a.x -= overlap.nx * overlap.d * (a.im / total);
        a.y -= overlap.ny * overlap.d * (a.im / total);
        b.x += overlap.nx * overlap.d * (b.im / total);
        b.y += overlap.ny * overlap.d * (b.im / total);
      }
    }
    for (const body of world.bodies) {
      if (body.im === 0) continue;
      const ex = extent(body, 1, 0);
      const ey = extent(body, 0, 1);
      body.x = clamp(body.x, ex, Math.max(ex, world.tray.w - ex));
      body.y = clamp(body.y, ey, Math.max(ey, world.tray.h - ey));
    }
  }
}

/** How far two footprints overlap, and along which way out. Null if apart. */
function depth(a: Body, b: Body): { nx: number; ny: number; d: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let best = Infinity;
  let nx = 0;
  let ny = 0;
  for (const box of [a, b]) {
    const c = Math.cos(box.a);
    const s = Math.sin(box.a);
    for (const [ax, ay] of [
      [c, s],
      [-s, c],
    ]) {
      const along = dx * ax + dy * ay;
      const overlap = extent(a, ax, ay) + extent(b, ax, ay) - Math.abs(along);
      if (overlap <= 0) return null;
      if (overlap < best) {
        best = overlap;
        const sign = along < 0 ? -1 : 1;
        nx = ax * sign;
        ny = ay * sign;
      }
    }
  }
  return { nx, ny, d: best };
}

/**
 * One fixed step. Returns how many bodies are still moving; zero means the
 * throw is over. Contacts worth hearing are appended to `contacts`.
 */
export function step(world: World, contacts: Contact[]): number {
  const dt = P.STEP;
  world.t += dt * 1000;
  // Not a fade-out: a promise that the throw ends. Yahtzee is up to three
  // throws a turn and thirteen turns a game, and an animation you sit through
  // thirty-nine times is one you resent.
  const past = world.t > P.DEADLINE;
  const damp = past ? P.LIN_DAMP * 4 : P.LIN_DAMP;
  const adamp = past ? P.ANG_DAMP * 4 : P.ANG_DAMP;

  for (const b of world.bodies) {
    if (b.asleep) continue;
    b.air = Math.max(0, b.air - dt * 1000);
    b.vx -= b.vx * damp * dt;
    b.vy -= b.vy * damp * dt;
    b.w -= b.w * adamp * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.a += b.w * dt;

    /*
      The tumble. A cube crossing a table rolls about the axis across its own
      travel — a die going right turns away from you — so the rate comes
      straight out of the velocity, and the plane spin turns it about the axis
      pointing at the player.

      Passive, and that word is doing real work: this reads the motion and
      never writes to it. The moment it does, the fairness argument at the top
      of this file stops holding.
    */
    const wx = -b.vy / b.half;
    const wy = b.vx / b.half;
    const wz = b.w;
    b.q = normalise(
      multiply(
        [1, (wx * dt) / 2, (wy * dt) / 2, (wz * dt) / 2],
        b.q,
      ),
    );

    walls(b, world, contacts);
  }

  for (let pass = 0; pass < P.PASSES; pass++) {
    for (let i = 0; i < world.bodies.length; i++) {
      for (let k = i + 1; k < world.bodies.length; k++) {
        const a = world.bodies[i];
        const b = world.bodies[k];
        if (a.asleep && b.asleep) continue;
        // One of them is still in the air, so they are not at the same height.
        if (a.air > 0 || b.air > 0) continue;
        const j = collide(a, b);
        // Only the first pass is heard. The later ones are the same contact
        // being tidied up, and hearing a knock three times is a rattle.
        if (pass === 0 && Math.abs(j) > P.QUIET) {
          contacts.push({ impulse: Math.abs(j), wall: false });
        }
      }
    }
  }

  let moving = 0;
  for (const b of world.bodies) {
    if (b.asleep) continue;
    if (b.air > 0) {
      // A die in the air has not come to rest, whatever its speed says.
      b.slow = 0;
      moving++;
      continue;
    }
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < P.SLEEP_V && Math.abs(b.w) < P.SLEEP_W) b.slow += dt * 1000;
    else b.slow = 0;

    if (b.slow > P.SLEEP_MS || world.t > P.HARD_STOP) {
      b.asleep = true;
      b.vx = 0;
      b.vy = 0;
      b.w = 0;
      // Square in the plane as well as on a face: the footprint and the cube
      // are two views of one die and must agree about which way it is facing.
      b.a = Math.round(b.a / (Math.PI / 2)) * (Math.PI / 2);
      // A die comes to rest on a face. Landing it at 7° off square would read
      // as a rendering bug rather than as a die — and this is the moment the
      // number it shows becomes a number.
      b.q = ORIENTATIONS[squareUp(b.q)];
    } else moving++;
  }

  // Last, and after the squaring-up above rather than before it: turning a
  // resting die the last few degrees onto its face moves its corners, and can
  // put one inside a neighbour that nothing would then look at again.
  tidy(world);
  return moving;
}

/**
 * A throw, set up and ready to be stepped.
 *
 * The dice start **where they already are** and are thrown from there. They do
 * not gather at the flick and set off from it: dice on a table that you throw
 * to the left are dice that were on the table and are now going left.
 */
export function open(opts: {
  tray: Tray;
  toss: Toss;
  /** Where each die is now. As long as the number of dice. */
  from: readonly Rest[];
  /** Dice being kept: they stay exactly where they are. */
  held?: readonly boolean[];
}): World {
  const { tray, toss, from, held = [] } = opts;
  const rng = seeded(toss.seed);
  const world: World = { tray, t: 0, bodies: [], rng };

  const thrown: Body[] = [];
  from.forEach((at, i) => {
    const body: Body = {
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      a: 0,
      w: 0,
      // The one draw that makes the odds even, and the reason it is on the
      // toss rather than made up here: it has to come from the server's rng,
      // independently of the seed that drives the tumble.
      q: ORIENTATIONS[(toss.spin[i] ?? 0) % ORIENTATIONS.length],
      half: tray.die / 2,
      im: 1,
      ii: 1 / ((tray.die * tray.die) / 6),
      asleep: false,
      slow: 0,
      air: 0,
    };
    world.bodies.push(body);
    if (held[i]) {
      body.im = 0;
      body.ii = 0;
      body.asleep = true;
      // A die being kept keeps its face, so it keeps the orientation it had.
      body.q = ORIENTATIONS[at.o % ORIENTATIONS.length];
    } else thrown.push(body);
  });

  // A tap has no direction of its own, so it is given one: across the tray
  // rather than straight up it. A die thrown at the far wall bounces and
  // settles somewhere different every time; one thrown straight parks against
  // the same edge every time.
  const tap = toss.x === 0 && toss.y === 0;
  const fx = tap ? (rng() < 0.5 ? -1 : 1) * (0.56 + rng() * 0.5) * tray.w : toss.x * tray.w;
  const fy = tap ? -0.78 * tray.w : toss.y * tray.w;

  for (const body of thrown) {
    body.air = P.AIRBORNE;
    // Jittered per die, or five of them travel as one block and never touch.
    body.vx = fx * (0.82 + rng() * 0.36);
    body.vy = fy * (0.82 + rng() * 0.36);
    body.w = (rng() - 0.5) * 26 + (fx / tray.w) * 1.9;
  }

  return world;
}

/** Run a throw to a standstill. What the server does, and what a test does. */
export function settle(world: World): { faces: number[]; rest: Rest[] } {
  let moving = 1;
  let steps = 0;
  // The hard stop guarantees termination; this only guarantees it in the face
  // of a bug, so it is generous rather than tight.
  const limit = Math.ceil((P.HARD_STOP / 1000 / P.STEP) * 2);
  const bin: Contact[] = [];
  while (moving > 0 && steps < limit) {
    bin.length = 0;
    moving = step(world, bin);
    steps++;
  }
  return { faces: facesOf(world), rest: restOf(world) };
}

export function facesOf(world: World): number[] {
  return world.bodies.map((b) => faceOf(b.q));
}

export function restOf(world: World): Rest[] {
  return world.bodies.map((b) => ({ x: b.x, y: b.y, o: squareUp(b.q) }));
}

/**
 * Throw the dice, and see what they say.
 *
 * The reducer's entry point, and the only place the faces come from. It runs
 * the whole throw here and now — a hundred and forty steps over five cubes,
 * which costs microseconds — reads the numbers off the resting dice, and
 * returns the toss for the boards to replay.
 *
 * The seed is drawn *after* the flick has arrived, which is what stops a
 * player aiming for a result: they choose the throw, the server chooses the
 * world it happens in, and neither alone decides the answer.
 */
export function throwNext(opts: {
  previous: Toss | null;
  flick: unknown;
  rng: Rng;
  tray: Tray;
  count: number;
  /** Dice being kept. They stay put and keep the face they are showing. */
  held?: readonly boolean[];
}): { toss: Toss; faces: number[] } {
  const { previous, flick, rng, tray, count, held } = opts;
  const from = previous?.rest?.length === count ? previous.rest : row(tray, count);

  const toss: Toss = {
    ...readFlick(flick),
    n: (previous?.n ?? 0) + 1,
    // 2^32, the width of the solver's generator.
    seed: pick(rng, 0x1_0000_0000),
    spin: Array.from({ length: count }, () => pick(rng, ORIENTATIONS.length)),
    from,
    rest: from,
  };

  const world = open({ tray, toss, from, held });
  const settled = settle(world);
  toss.rest = settled.rest;
  return { toss, faces: settled.faces };
}
