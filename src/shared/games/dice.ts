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
 * simulation then applies some rotation to it — a complicated one, but the
 * *same* one whichever of the 24 it started in. A uniformly random orientation
 * composed with a fixed rotation is still uniformly random, so the face that
 * ends up pointing at the player is exactly uniform over the six. The physics
 * decides which face; the draw decides that it is even.
 *
 * Two things keep that "same one whichever it started in" true, and both are
 * load-bearing:
 *
 * - **The 2D motion never reads the 3D orientation.** The tumble and the fall
 *   onto a face are driven by where the die slides, and neither writes a
 *   velocity. Let the orientation nudge the motion and every die's path
 *   depends on the draw, which is the end of the argument.
 * - **What does read the orientation is even-handed about the 24.** The
 *   settling looks at which face a die is nearest, so it is not a fixed
 *   rotation on its own — but it treats the 24 alike, and turning the whole
 *   throw by one of them turns its answer by the same one (see `slerp`). Start
 *   in `g` rather than upright and everything that follows is the upright
 *   throw turned by `g`, so the 24 starts still reach 24 different finishes.
 *
 * `dice.test.ts` holds the conclusion directly: sweep a throw across all 24
 * starts and each face comes up exactly four times per die.
 *
 * ── The vertical channel, and why it is blind ──────────────────────────
 *
 * Dice are thrown onto a table, so they have a height: they leave the hand,
 * arc, land, bounce, and only then start losing speed to the felt. That is
 * `z` and `vz`, and it is a *channel* — gravity, a floor, a restitution — and
 * not a third dimension of the solver. The dice still meet each other and the
 * walls as squares in the plane; height only decides whether two of them are
 * at the same height to meet at all.
 *
 * **The floor is at `half`, whichever way the die is turned.** A real cube
 * balanced on a corner has its middle further up than one lying flat, and
 * modelling that is the end of the fairness argument: the height a die bounces
 * from would depend on its orientation, the orientation would decide where it
 * went, and the uniform draw would stop carrying through. So the floor sees a
 * ball of radius `half`, exactly as the collisions see a square that does not
 * know which face is up. By the time the die stops it is lying on a face, and
 * the player never sees the sphere.
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
  /**
   * Fixed, so the same toss lands the same way at any refresh rate.
   *
   * 240Hz rather than the 120 it ran at, and the reason is `THROW`'s: a die
   * must not cross more than its own half-width between two steps, or it can
   * pass clean through a neighbour without the solver ever seeing them touch.
   * Shrinking the dice by a quarter broke that — a die was crossing 1.2 of its
   * half-widths — and the choice was to throw them more gently or to look more
   * often. Looking more often costs microseconds a throw on the server and
   * four steps a frame in a board, and keeps the throw.
   */
  STEP: 1 / 240,
  /**
   * Substeps per frame, so a tab that stalled cannot spiral catching up.
   * Sixteen at 240Hz is the same 66ms of catching-up that eight was at 120.
   */
  MAX_STEPS: 16,
  /**
   * The table itself, per second, in tray widths.
   *
   * Damping alone decides how long a throw lasts; speed alone decides how much
   * of the tray it crosses. That pairing is why `THROW` is as high as it is —
   * turning both up buys distance without buying time.
   *
   * Lowered from 2.6 when the throw was asked to last longer: a die that keeps
   * rolling is the part of a throw worth watching, and it is also the part
   * that tumbles, since the tumble is driven by travel and not by a clock.
   */
  LIN_DAMP: 1.8,
  /** Higher than linear, or dice keep spinning after they stop travelling. */
  ANG_DAMP: 3.4,
  /**
   * The most a die may spin in the plane, in radians a second.
   *
   * A ceiling on the physics for the sake of the eye, and the same argument as
   * `ROLL`: what a player can follow is a die turning less than a quarter turn
   * between one frame and the next, and past that the die is not turning, it
   * is flickering. The spin comes off corner strikes, which got sharper when
   * the dice got smaller — a cube's resistance to being spun falls with the
   * square of its size, so the same knock spins a small die half again as
   * fast.
   *
   * Blind to the orientation, like everything else that touches the motion.
   */
  SPIN_MAX: 30,
  /** The tray is the hard thing in the room, so it bounces more than a die. */
  WALL_E: 0.42,
  /** Die on die. Above ~0.5 they ping about like marbles. */
  E: 0.34,
  /** Coulomb friction at a contact in the plane: what turns a slide into a skid. */
  MU: 0.45,
  /**
   * And the same at the floor, where a landing die hands over some of its
   * travel to the table.
   *
   * A constant of its own, against the instinct to reuse `MU` — the tray is
   * felt wherever the die touches it, so one number ought to do. It does not,
   * and the reason is worth keeping: at `MU` a die loses nearly all its travel
   * to its first landing, arrives where it touched down, and everything after
   * that is a die falling over. The throw was over in two thirds of a second
   * and the only part of it that moved was the part in the air.
   *
   * Lower, and the die skids on after it lands — which is where the tumbling
   * is, since the tumble is driven by travel.
   */
  FLOOR_MU: 0.12,
  /**
   * Below this a body is a candidate for sleep, in tray units a second.
   * Lowered with `LIN_DAMP`: a die creeping to a halt is still a die moving,
   * and stopping it early was a third of a second of the throw thrown away.
   */
  SLEEP_V: 2,
  SLEEP_W: 0.5,
  /** And it has to stay slow this long, or dice flicker awake on a nudge. */
  SLEEP_MS: 70,
  /**
   * Damping quadruples here. A throw is a moment, not a cutscene — but the
   * moment is longer than it was: an ordinary throw now comes to rest around
   * 1.3 seconds and this catches the tail that would otherwise run to two.
   */
  DEADLINE: 1400,
  /**
   * Everything sleeps regardless. The promise that a turn always ends — plus
   * `SQUARE_MS` for the last of the fall, which is not a throw carrying on.
   */
  HARD_STOP: 2400,
  /** Contacts softer than this are the solver settling, not dice landing. */
  QUIET: 4,
  /**
   * The least a throw is thrown at, in tray widths a second.
   *
   * A flick is measured from a finger, and a finger that moved slowly measures
   * slowly. At the bottom of the range that put the dice down about a die and
   * a half from where they picked up — a nudge the player had to be told was
   * a throw. The floor is applied along whatever line the throw was aimed on,
   * so aiming survives and half-heartedness does not; a flick already past it
   * is left exactly as it was thrown, which is what keeps throwing hard worth
   * doing.
   *
   * Deliberately under a third of `MAX_FLICK`, and under the die's own
   * half-width per step: a die that moved further than half of itself between
   * two steps could pass through a neighbour without the solver seeing it.
   */
  THROW: 4.2,
  /**
   * How wide the throw opens, in radians of arc across the whole handful.
   *
   * Scaling each die's speed was never enough on its own: five dice given the
   * same direction and a fifth more or less of the same speed travel on
   * parallel lines, arrive together and settle in a stripe. Dice leave a hand
   * fanned, and the fan is most of what makes five of them read as five
   * objects rather than one object drawn five times.
   *
   * It costs nothing in time — the dice are going just as fast, only not all
   * the same way.
   */
  FAN: 1.4,
  /**
   * Gravity, in tray widths a second squared.
   *
   * A tray is about a hand's span across — a quarter of a metre — so 9.81
   * m/s² is a touch under forty of them. Written in widths rather than units
   * for the same reason `THROW` is: the number has to mean the same thing on
   * a phone and a laptop, and it is the tray that differs between them.
   */
  G: 39,
  /**
   * How hard a throw sends the dice up, in tray widths a second.
   *
   * Dice are thrown, not slid: they leave the hand, arc, land, and bounce
   * before they run out. Three widths a second is about a metre a second up,
   * which puts the apex a die and a half over the table and the first landing
   * a hundred and fifty milliseconds in — near enough to the flat 140ms flag
   * this replaced, except that now the die is somewhere while it is up there.
   *
   * It is also what stops a die thrown out of a gap between two dice you are
   * keeping from being boxed in and travelling five pixels. You do not throw a
   * die from between two others; you pick it up and throw it over them. Walls
   * still stop it, because the tray has sides and they are taller than this.
   */
  HOP: 4.2,
  /**
   * The table, hit square on. Dice are not superballs — but they are not bags
   * of sand either, and at 0.36 the whole throw was over in two bounces.
   * Four, now, which is what a die thrown onto a table actually does.
   */
  FLOOR_E: 0.5,
  /**
   * Below this, in tray widths a second, a landing is not a bounce — the die
   * stays down. Without it a die spends its last quarter second buzzing
   * against the floor a fraction of a millimetre deep, which is a lot of
   * arithmetic to draw nothing.
   *
   * **It has to stay above `G * STEP`**, which is the speed one step of
   * gravity adds to a die already lying still. Below that, a resting die is
   * landing every step at a speed the threshold calls a bounce, so it never
   * sleeps and the throw runs to the hard stop every time. Tuned to 0.3 once,
   * and that is exactly what happened: 0.16 is the floor, so this is
   * comfortably clear of it.
   */
  REST_VZ: 0.55,
  /**
   * How much of the die's travel goes into tumbling, against the corner-over-
   * corner rate a cube would turn at if it rolled without slipping.
   *
   * At 1 it is that rate exactly, and that was the bug the throw has been
   * carrying: a die crossing the tray at a metre a second is *eighteen
   * revolutions a second* if it never slips. Sampled at 60Hz that is a cube at
   * an unrelated angle in every frame — which does not read as a die rolling,
   * it reads as a die with no floor under it, which is precisely what a player
   * said when they saw it. Dice mostly skid. This is how much they do not.
   *
   * Set as high as the quarter-turn line allows, because tumbling is the point
   * — with `SPIN_MAX` holding the other half of the budget, the worst frame in
   * an ordinary throw turns 57 degrees.
   */
  ROLL: 0.3,
  /**
   * Collision passes per step. One is not enough: a die shoved out of its
   * neighbour lands in the next one, and a resting pile settled about a tenth
   * of a die deep into itself — visibly overlapping, and dice that overlap
   * stop reading as objects.
   */
  PASSES: 3,
  /**
   * Where the tumble hands over to gravity.
   *
   * A real die does not spin freely until it stops and then jump onto a face:
   * as it runs out of speed the corner it is riding on stops carrying it and
   * it falls onto whichever face it was nearest. Below this speed — in tray
   * units a second, and well above the speed it sleeps at, so there is a
   * stretch of the throw where both are happening — that fall starts, coming
   * on gradually as the die slows rather than switching on.
   */
  SETTLE_V: 9,
  /** And it does not start while the die is still spinning in the plane. */
  SETTLE_SPIN: 9,
  /**
   * How quickly that fall closes the gap: the share of whatever is left to
   * turn that it takes each second.
   *
   * A share rather than a rate, so the die decelerates onto the face instead
   * of turning at a constant speed and stopping dead when it arrives — which
   * is the same jump as before, only smaller and further from the end.
   */
  SETTLE_W: 7,
  /**
   * The last of it, once the die has stopped travelling: whatever is left of
   * the fall, eased rather than cut. A die that has been rolling all the way
   * down needs almost none of this; it is here because "almost" is not "none",
   * and a jump of two degrees is as wrong as a jump of forty.
   *
   * Fixed, not scaled by how far there is to go — see the note on the tip
   * itself for why the number of steps a throw takes must not depend on which
   * way a die happens to be turned.
   */
  SQUARE_MS: 150,
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

/**
 * Turn `a` a fraction of the way towards `b`, the short way round.
 *
 * The one operation the settling is made of, and the reason the odds survive
 * it: it is *right-equivariant*. Turn both ends by the same rotation and the
 * result turns with them — `slerp(a·g, b·g, t) = slerp(a, b, t)·g` — and the
 * same is true of `squareUp`, because right-multiplying by one of the 24
 * permutes the 24 without moving any of them relative to each other. So a
 * throw that starts in orientation `g` ends in `R·g` for a rotation `R` that
 * is the same for all 24 starts, even though the settling looks at the
 * orientation to decide what to do. The uniform draw still carries through
 * exactly, which `dice.test.ts` checks across all 24.
 */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  // q and -q are the same rotation, so take whichever of the two is nearer —
  // otherwise the die takes the long way round to the face it is already on.
  let end: Quat = b;
  if (dot < 0) {
    end = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    // Nearly there; the arc is shorter than the arithmetic's precision.
    return normalise([
      a[0] + (end[0] - a[0]) * t,
      a[1] + (end[1] - a[1]) * t,
      a[2] + (end[2] - a[2]) * t,
      a[3] + (end[3] - a[3]) * t,
    ]);
  }
  const theta = Math.acos(dot);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [
    a[0] * wa + end[0] * wb,
    a[1] * wa + end[1] * wb,
    a[2] * wa + end[2] * wb,
    a[3] * wa + end[3] * wb,
  ];
}

/** The angle between two rotations, in radians. */
function between(a: Quat, b: Quat): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
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
  /**
   * How high the die's middle is above the floor, and how fast that is
   * changing. The third axis, and the only thing in the die's motion the
   * player cannot see directly — see the note on the vertical channel above
   * for why it is a channel and not a solver.
   */
  z: number;
  vz: number;
  /** The last of the fall onto a face, once it has stopped travelling. */
  tip: Tip | null;
}

/**
 * A die going the last few degrees onto its face.
 *
 * A die that has stopped sliding has not finished moving: it is resting on an
 * edge or a corner and has to fall the rest of the way. Most of that fall
 * happens while it is still slowing down — see `SETTLE_V` — and this is
 * whatever is left of it at the moment the die stops, played out over
 * `SQUARE_MS` rather than applied in a single frame. The face it arrives on is
 * the one it was already nearest, so nothing about the result changes; what
 * changes is that the die is never seen to jump.
 *
 * The plane angle comes along for the ride, and for the same reason: the
 * footprint and the cube are two views of one die, and one of them snapping
 * square while the other eases would look like two objects.
 *
 * **Why the duration is a constant.** The footprint turns while this runs, so
 * a die still rolling can strike a settling one — which means the length of
 * the settle is part of the motion. Scale it by how far the *cube* has to
 * turn and the 3D orientation is suddenly deciding where dice end up, and the
 * fairness argument at the top of this file is gone. It has to be a number
 * that does not know which way the die is facing.
 */
interface Tip {
  /** Milliseconds elapsed, out of `P.SQUARE_MS`. */
  t: number;
  q0: Quat;
  q1: Quat;
  a0: number;
  a1: number;
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

/**
 * Whether the die is on the floor. A hair of slack, because a die resting on
 * the floor is a die whose height the integration keeps putting back.
 */
function grounded(b: Body): boolean {
  return b.z <= b.half * 1.001;
}

/**
 * Whether two dice are at heights that cannot meet — one is over the other.
 * The honest version of the flag this replaced: a die is above another when it
 * is above it, rather than for a fixed hundred and forty milliseconds.
 */
function overhead(a: Body, b: Body): boolean {
  return Math.abs(a.z - b.z) >= a.half + b.half;
}

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
        if (overhead(a, b)) continue;
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
 * Gravity, on a die that is running out of speed.
 *
 * A cube crossing a table rolls corner over corner for as long as its own
 * speed keeps carrying it over; once it is slow enough, the corner it is
 * riding stops being a hinge and starts being a pivot it falls off. This is
 * that: a pull towards the face the die is already nearest, worth nothing at
 * `SETTLE_V` and everything at a standstill, so a die arrives at rest already
 * lying on a face instead of being put on one.
 *
 * Reads the motion and never writes to it — the same rule the tumble follows,
 * for the same reason.
 */
function fall(b: Body, dt: number): void {
  // Nothing to fall onto yet. A die in the air keeps whatever tumble it left
  // the hand with, and starts lying down when it has a floor to lie on.
  if (!grounded(b)) return;
  const pull = Math.min(
    1 - Math.min(1, Math.hypot(b.vx, b.vy) / P.SETTLE_V),
    1 - Math.min(1, Math.abs(b.w) / P.SETTLE_SPIN),
  );
  if (pull <= 0) return;
  const onto = ORIENTATIONS[squareUp(b.q)];
  if (between(b.q, onto) < 1e-6) return;
  b.q = slerp(b.q, onto, Math.min(1, P.SETTLE_W * pull * dt));
}

/**
 * A die arriving on the table.
 *
 * The vertical bounce, and the horizontal price of it. Both matter: a die that
 * bounces without losing any travel skates on after landing as if the table
 * were ice, and one that loses all of it stops dead where it first touches —
 * neither of which is a thrown die. What it loses is capped by Coulomb against
 * the impulse that stopped it, so a die that drops in gently keeps running and
 * one that comes down hard does not.
 *
 * Reads the height and the motion; never the orientation. Same rule as
 * everything else here, and for the reason at the top of the file.
 */
function land(b: Body, world: World, contacts: Contact[]): void {
  const hit = -b.vz;
  /*
    Not a landing: a die already lying on the table, which gravity pushes the
    better part of a millimetre into the floor every step and this pulls back
    out.

    Worth a branch of its own, because the two things below both fired on it.
    A die at rest was reporting a contact 120 times a second — a clatter at two
    thirds volume, every frame, for as long as the throw took to fall asleep —
    and scrubbing a slice of its travel each time, which is a friction nobody
    wrote down and could not be tuned because it was not on the list.
  */
  if (hit <= P.REST_VZ * world.tray.w) {
    b.vz = 0;
    return;
  }
  b.vz = hit * P.FLOOR_E;

  const speed = Math.hypot(b.vx, b.vy);
  if (speed > 0) {
    const scrub = Math.min(1, (P.FLOOR_MU * (1 + P.FLOOR_E) * hit) / speed);
    b.vx -= b.vx * scrub;
    b.vy -= b.vy * scrub;
    b.w -= b.w * scrub;
  }

  /*
    The knock, in the units every other contact here reports: mass is one, so
    an impulse is a change in momentum.

    Divided by what a plane contact is divided by, and that division is the
    whole of why this is not simply `(1 + e)·hit`. A cube comes down on a
    corner and some of the blow turns it instead of reaching the table — which
    is exactly the rotational term in `resolve`, and leaving it out here made
    the floor four times louder than anything else in the tray. Four bounces
    all clamped to full volume, and a die that had nearly stopped bouncing
    sounded like a die being thrown.

    The lever is `half` rather than the corner the die actually landed on,
    because the corner it landed on is its orientation, and nothing in the
    motion is allowed to know that. It works out at 2.5 for a cube of any
    size, which is the point: shrinking the dice must not change how loud the
    tray is.
  */
  const impulse = ((1 + P.FLOOR_E) * hit) / (1 + b.half * b.half * b.ii);
  if (impulse > P.QUIET) contacts.push({ impulse, wall: true });
}

/** The last of the fall. True while there is still some of it left. */
function tipOver(b: Body, dt: number): boolean {
  const tip = b.tip;
  if (!tip) return false;
  tip.t = Math.min(P.SQUARE_MS, tip.t + dt * 1000);
  const k = tip.t / P.SQUARE_MS;
  // Smoothstep: a die that is toppling is not moving at the instant it starts
  // and is not moving at the instant it lands, and a linear ramp says it was
  // doing the same speed at both ends.
  const s = k * k * (3 - 2 * k);
  b.q = slerp(tip.q0, tip.q1, s);
  b.a = tip.a0 + (tip.a1 - tip.a0) * s;
  if (tip.t < P.SQUARE_MS) return true;
  // Exactly, rather than to within a rounding error: this is the moment the
  // number the die shows becomes a number, and `squareUp` has to find it where
  // it was put.
  b.q = tip.q1;
  b.a = tip.a1;
  b.tip = null;
  return false;
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
    // A die on its way onto a face. It has stopped travelling, so there is no
    // motion left to integrate — only the fall to finish.
    if (b.tip) {
      tipOver(b, dt);
      continue;
    }
    if (b.asleep) continue;

    // Gravity, then the floor. Damping is the *table*, so a die that is not on
    // the table is not slowed by it: a thrown die keeps its speed until it
    // lands, which is both what really happens and most of what makes the
    // first landing read as a landing.
    if (grounded(b)) {
      b.vx -= b.vx * damp * dt;
      b.vy -= b.vy * damp * dt;
      b.w -= b.w * adamp * dt;
    }
    b.vz -= P.G * world.tray.w * dt;
    b.z += b.vz * dt;
    if (b.z < b.half) {
      b.z = b.half;
      if (b.vz < 0) land(b, world, contacts);
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.a += b.w * dt;

    /*
      The tumble. A cube crossing a table rolls about the axis across its own
      travel — a die going right turns away from you — so the rate comes
      straight out of the velocity, scaled by how much of that travel is
      rolling rather than skidding (`ROLL`), and the plane spin turns it about
      the axis pointing at the player.

      Passive, and that word is doing real work: this reads the motion and
      never writes to it. The moment it does, the fairness argument at the top
      of this file stops holding.
    */
    const wx = (-b.vy / b.half) * P.ROLL;
    const wy = (b.vx / b.half) * P.ROLL;
    // See `SPIN_MAX`: a die spinning faster than the eye can follow is drawn
    // at an unrelated angle every frame, which reads as a fault rather than as
    // a fast die.
    b.w = clamp(b.w, -P.SPIN_MAX, P.SPIN_MAX);
    const wz = b.w;
    b.q = normalise(
      multiply(
        [1, (wx * dt) / 2, (wy * dt) / 2, (wz * dt) / 2],
        b.q,
      ),
    );

    fall(b, dt);
    walls(b, world, contacts);
  }

  for (let pass = 0; pass < P.PASSES; pass++) {
    for (let i = 0; i < world.bodies.length; i++) {
      for (let k = i + 1; k < world.bodies.length; k++) {
        const a = world.bodies[i];
        const b = world.bodies[k];
        if (a.asleep && b.asleep) continue;
        // One of them is over the other, so they are not at the same height.
        if (overhead(a, b)) continue;
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
    // Still falling onto its face, which is not the same as at rest: the
    // throw is not over and the board must not read the dice yet.
    if (b.tip) {
      moving++;
      continue;
    }
    if (b.asleep) continue;
    if (!grounded(b) || b.vz !== 0) {
      // Off the table, or still bouncing on it. Either way it has not come to
      // rest, whatever its speed across the tray says.
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
      // It has stopped sliding; it has not finished falling. Whatever is left
      // of the tip onto a face is played out over the next few frames rather
      // than in this one — most of it is already done, because `fall` has been
      // working on it since the die slowed down.
      //
      // Square in the plane as well as on a face: the footprint and the cube
      // are two views of one die and must agree about which way it is facing.
      b.tip = {
        t: 0,
        q0: b.q,
        q1: ORIENTATIONS[squareUp(b.q)],
        a0: b.a,
        a1: Math.round(b.a / (Math.PI / 2)) * (Math.PI / 2),
      };
      moving++;
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
      // Lying on the table, which is where dice are between throws.
      z: tray.die / 2,
      vz: 0,
      im: 1,
      ii: 1 / ((tray.die * tray.die) / 6),
      asleep: false,
      slow: 0,
      tip: null,
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

  /*
    A tap has no direction of its own, so it is given one: down the length of
    the tray, away from whichever end the dice are already lying at.

    Both halves of that are worth stating. **Down the length**, because the
    tray is well over twice as wide as it is tall, and a throw aimed mostly up
    it crosses the short way in a few frames and spends the rest of the throw
    trapped against the top edge. **Away from where they are**, because a
    throw is a traverse: dice picked up at one end and sent to the other cross
    the whole tray, where dice sent at the nearest wall pile into the corner
    they started beside. Drawn at random, half of all throws were that.

    It reads the dice's positions and nothing else — never their orientation —
    so the fairness argument at the top of this file still holds: every die in
    the throw gets the same direction whichever of the 24 it started in.
  */
  const tap = toss.x === 0 && toss.y === 0;
  const mid = from.length ? from.reduce((sum, at) => sum + at.x, 0) / from.length : tray.w / 2;
  // -1 with the dice against the left wall, +1 against the right, 0 in the
  // middle. A lean and not a rule: decided outright, the direction is a
  // function of where the last throw finished, so every throw is the mirror
  // of the one before it and the dice end up on the same side every time.
  // Leaning keeps the traverse and gives the table its memory back.
  const lean = (mid - tray.w / 2) / (tray.w / 2);
  const away = rng() < 0.5 - lean * 0.42 ? 1 : -1;
  const ax = tap ? away * (0.9 + rng() * 0.24) : toss.x;
  // A little across the tray as well, either way, so a throw does not run the
  // same groove down the middle every time.
  const ay = tap ? (rng() - 0.5) * 0.62 : toss.y;
  // The direction is the player's, the effort is the table's — see `THROW`.
  // A tap has no direction to keep, so it lands on the floor exactly.
  const aim = Math.hypot(ax, ay) || 1;
  const power = (Math.max(P.THROW, aim) / aim) * tray.w;
  const fx = ax * power;
  const fy = ay * power;

  for (const body of thrown) {
    // Up, as well as along. Jittered like the rest of it, so the handful does
    // not rise and land as one plate.
    body.vz = P.HOP * tray.w * (0.82 + rng() * 0.36);
    // Jittered per die, or five of them travel as one block and never touch.
    const fan = (rng() - 0.5) * P.FAN;
    const cos = Math.cos(fan);
    const sin = Math.sin(fan);
    const push = 0.82 + rng() * 0.36;
    body.vx = (fx * cos - fy * sin) * push;
    body.vy = (fx * sin + fy * cos) * push;
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
