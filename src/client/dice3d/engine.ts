/**
 * The dice, as actual cubes.
 *
 * This replaces the 2.5D solver in `src/shared/games/dice.ts`, which met dice
 * as squares in a plane and carried height as a scalar channel beside the
 * motion rather than inside it. That bought a proof — the plane never read the
 * cube's orientation, so the odds were exactly even and could be asserted as
 * `[20,20,20,20,20,20]` — and it cost everything a cube does that a square
 * cannot: land on a corner, topple, wedge, or come to rest on top of another.
 *
 * The trade has been made deliberately. Rapier decides where the dice go, the
 * face is read off whichever normal ends up pointing at the ceiling, and the
 * distribution is now an empirical claim tested statistically rather than a
 * structural one proved by construction. `engine.test.ts` is where that claim
 * lives, and it is weaker on purpose rather than by accident.
 *
 * ── Where this runs ───────────────────────────────────────────────────
 *
 * Nowhere near the server. The throw is computed on the client that threw it
 * and reported as a result; the reducer validates the shape and stores it. So
 * this file is client-only, and it is reached through a dynamic `import()` so
 * that the eight games with no dice in them never download a physics engine.
 *
 * It has no DOM in it, which is what lets the tests and `render-throw` run the
 * real simulation in Node instead of a second opinion about it. The renderer
 * is `scene.ts`, and it only ever reads.
 *
 * ── Units ─────────────────────────────────────────────────────────────
 *
 * Rapier is happiest with lengths near 1, and a `Tray` is measured in its own
 * abstract units where a Yahtzee die is 5.63 and the tray is 100 across. So
 * everything inside here is scaled so that **a die is two units on a side**,
 * which is what the reference implementation uses and what its gravity is
 * tuned against. `scaleOf` is the only place that knows the factor, and every
 * value that leaves this file is back in tray units — because a tray is about
 * 320px on a phone and twice that on a laptop, and a simulation fed pixels
 * would land the dice on different faces on the two of them.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { Tray, Quat } from '../../shared/games/dice.js';
import { faceUp, seeded } from '../../shared/games/dice.js';
import type { Rest3 } from '../../shared/games/toss.js';
import type { Beats } from './beats.js';

export { faceUp };
export type { Rest3 };
export type { Beats };

/** Half a die, in physics units. The number the whole scale is defined by. */
export const DIE_HALF = 1;

/**
 * Stride for keying a pair of collider handles into one number. Larger than
 * any handle count a tray will ever reach, so two different pairs cannot
 * collide onto the same key.
 */
const PAIR = 1 << 16;

/**
 * Every constant the throw has, and why it is the number it is.
 *
 * The starting point is the reference implementation this was asked to match,
 * which is worth saying plainly: these are not derived from anything, they are
 * a feel that was tuned by looking. `npm run render:throw` is how you look.
 */
export const PHYS = {
  /**
   * Stronger than life, and less so than it was.
   *
   * Real gravity on a two-unit die gives a slow, floaty, moon-like tumble that
   * reads as cheap, so this has always been exaggerated. It was −55, about
   * five and a half g, and the report from playing it was "too fast, too
   * snappy": at that strength a die is pinned to the floor the moment it first
   * touches, and what should be a bounce and a topple is a stop. This is four
   * and a half, which still reads as weight and leaves a die time to turn over
   * on its way down — and the height it is dropped from came down with it (see
   * `DROP` and `THROW_LIFT`), because weaker gravity over the same arc is only
   * the same picture arriving later.
   */
  GRAVITY: -45,
  /** Fixed, because two clients replaying one seed must take the same steps. */
  STEP: 1 / 60,
  /**
   * Substeps per frame. Low, because a frame that tries to catch up an
   * arbitrary stall spirals: catching up costs more than the frame it is
   * catching up for, and the next frame is later still.
   */
  MAX_SUBSTEPS: 5,
  /** A gap longer than this is a stall, not a frame. */
  MAX_FRAME: 0.1,

  /**
   * Die against tray and die against die. Lively, not rubbery.
   *
   * Down from 0.4, which read as rubber: a die that gives back two fifths of
   * every impact bounces three or four times on the flat before it will lie
   * down, and bouncing is the one thing a real die mostly does not do. What it
   * does instead is land on an edge and fall over, which is what the friction
   * below buys.
   */
  DIE_RESTITUTION: 0.22,
  /**
   * The knob that matters most, and the one the reference gets wrong for us.
   *
   * It ships 0.03 — almost frictionless — because its dice roll in a small
   * area and a long slide is what it wants. Copied here it settled a Yahtzee
   * throw in **7.8 seconds**, because a sliding die neither stops nor tumbles;
   * it just travels. Raising it converts that slide into a *roll*, which is
   * travel that also ends, and it improved spread and settling time together
   * rather than trading one against the other. Measured, over 400 chained
   * throws per row (`spanX` is how much of the tray's length a throw covers):
   *
   *     friction  0.03 → 173 steps, span 24%
   *     friction  0.20 → 122 steps, span 20%
   *     friction  0.50 → 134 steps, span 30%
   *
   * For comparison the 2.5D solver this replaces settled in 74 steps and
   * covered 16% of the tray. These dice take about twice as long and go
   * roughly twice as far, which is the trade that was wanted.
   *
   * **And 0.5 was still a slide.** The complaint that shipped it was that the
   * dice slide instead of tumbling, which none of the numbers above can see —
   * so it was measured directly: how far a die travels along the table per
   * radian it turns while it is on it. A cube that rolls covers about half its
   * edge per radian, so a ratio near 1 is rolling and a large one is skidding.
   *
   *     friction  0.50 → 4.5   ← the old number: a skid with a turn in it
   *     friction  0.60 → 3.2
   *     friction  0.95 → 1.8   ← a die that rolls over its own edges
   *
   * It costs nothing on the other axis: settling time and spread came out the
   * same either side of it, because a die that rolls is still a die that
   * stops.
   */
  DIE_FRICTION: 0.95,
  /**
   * Walls give the die back rather than stealing its spin — but not *nothing*.
   *
   * It was frictionless, so that a die clipping a wall could not stop dead
   * against it, which reads as a bug even when it is not. At zero it also
   * cannot bite: a die meeting the wall slid along it with its rotation
   * untouched, which is the same sliding-not-tumbling complaint the floor had.
   * A little friction turns a glancing wall hit into a tumble away from it, and
   * is still far too little to stop anything.
   */
  WALL_RESTITUTION: 0.15,
  WALL_FRICTION: 0.18,

  /** How hard the dice are thrown when the flick says nothing: a tap. */
  THROW_SPEED: 24,
  /**
   * And what a flick can ask for, from the gentlest measured one to the
   * hardest. `entryOf` maps the hand's speed across this range.
   *
   * The soft end is deliberately still a throw — the dice cross most of the
   * tray, because a flick that produced a shove of two inches would read as
   * the gesture not having worked. The hard end is short of the speed at which
   * a die reaches the far wall while still on its way up, which is the point
   * where throws stop looking different from one another and start looking
   * like a bug.
   */
  THROW_SOFT: 15,
  THROW_HARD: 40,
  /**
   * Below this, in tray widths a second, the hand was not throwing.
   *
   * `flick.ts` has already refused anything under about 140px/s as a tap; this
   * is the same judgement made a second time in the tray's own units, and it
   * is what a replayed throw is measured against — a client whose gesture
   * thresholds differ still has to agree with everyone else about what this
   * particular flick meant.
   */
  FLICK_FLOOR: 0.35,
  /** And at this the hand is asking for everything. Above it, nothing more. */
  FLICK_FULL: 3.2,
  /** Upward, so they arc rather than skid. Scaled by how hard the throw was. */
  THROW_LIFT: 3.4,
  /** Radians a second per axis, drawn uniformly in ±this. */
  SPIN: 18,
  /**
   * How high above the floor the dice are released, in dice.
   *
   * Down with the gravity, and for the reason given there: a second of hang
   * time before the dice have done anything is a second of nothing to watch.
   */
  DROP: 2,
  /** The arc a handful is fanned across, so five dice are not one die. */
  FAN: 1.2,

  /**
   * Steps after which the throw is over whatever the dice think. Rapier sleeps
   * bodies on its own and this is only ever reached by a bug, so it is
   * generous rather than tight — but it exists, because a client that never
   * stops animating never reports its roll, and the turn never ends.
   */
  HARD_STOP: 600,
  /** Impulse below which a contact is not worth a sound. */
  QUIET: 1.5,

  /**
   * Drag, and the reason the throw ever ends.
   *
   * Friction does most of the stopping (see `DIE_FRICTION`); this is small,
   * and is the air rather than the table. Its job is the tail — the last half
   * second where a die is barely moving and Rapier has not yet decided it is
   * asleep, which is time nobody is watching and everybody is waiting through.
   */
  DAMP_LIN: 0.04,
  DAMP_ANG: 0.09,
  /**
   * After this many steps the throw has been interesting for long enough and
   * the damping above is multiplied up, which brings it down inside another
   * half second.
   *
   * A deadline rather than more damping throughout, because those are not the
   * same shape: more damping everywhere makes every throw sluggish from the
   * first bounce, where this leaves the part anybody watches untouched and
   * only leans on the tail nobody does. The old solver learned this and the
   * number here started as its `DEADLINE` in steps.
   *
   * Later, and gentler, than it was. It was step 40 at eighteen times the
   * damping, which under the old gravity was a die still rolling being *shut
   * off* — the other half of "too snappy". At 46 and fourteen the deadline
   * lands after the dice have finished doing anything worth watching, and it
   * leans rather than stamps.
   */
  DEADLINE: 46,
  DEADLINE_DAMP: 14,
} as const;

/** A contact worth hearing, in the frame it happened. */
export interface Hit {
  impulse: number;
  wall: boolean;
  /** Where across the tray, 0 to 1 — so the sound can be panned to it. */
  at: number;
}

export interface ThrowWorld {
  world: RAPIER.World;
  bodies: RAPIER.RigidBody[];
  /** Which dice were kept and never thrown. Fixed bodies; they do not move. */
  held: boolean[];
  tray: Tray;
  /** Tray units per physics unit. */
  k: number;
  steps: number;
  events: RAPIER.EventQueue;
}

/** The tray's own size in physics units. What the camera has to frame. */
export function trayInPhysics(tray: Tray): { w: number; h: number; k: number } {
  const k = scaleOf(tray);
  return { w: tray.w / k, h: tray.h / k, k };
}

let ready: Promise<void> | null = null;

/**
 * Load the physics engine. Idempotent, and awaited by everything else here.
 *
 * Rapier is WebAssembly, and `-compat` is the build with the module inlined as
 * base64 — one file, no second network request, and it works unchanged in Node,
 * so the tests and the contact sheet run the same engine the browser does.
 */
export function initDice(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}

/** Tray units per physics unit. A die is two units on a side, by definition. */
export function scaleOf(tray: Tray): number {
  return tray.die / (DIE_HALF * 2);
}


// ── The tray ───────────────────────────────────────────────────────────

/**
 * Four walls, a floor and a lid.
 *
 * The lid is not decoration. The old solver's dice could not leave the tray
 * upward because height was a scalar with a hard ceiling of its own; these are
 * real bodies with real velocity, and a die that catches another one on the
 * corner at the top of its arc will otherwise leave the tray and never come
 * back — which reads as a die that vanished, and hangs the turn, because the
 * throw is not over until everything sleeps.
 *
 * The walls are thick slabs rather than thin planes. A thin wall is something
 * a fast die tunnels through between two steps; `dice.ts` already recorded
 * that lesson once, from the other side, when shrinking the dice forced its
 * timestep from 1/120 to 1/240.
 */
function buildTray(world: RAPIER.World, w: number, h: number): void {
  const T = 4; // slab thickness, in dice
  const LID = DIE_HALF * 2 * 8; // high enough that a normal throw never meets it
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const slabs: Array<[number, number, number, number, number, number]> = [
    // half-extents x, y, z, then centre x, y, z
    [w / 2 + T, T, h / 2 + T, 0, -T, 0], // floor
    [w / 2 + T, T, h / 2 + T, 0, LID + T, 0], // lid
    [T, LID, h / 2 + T, -w / 2 - T, LID, 0], // left
    [T, LID, h / 2 + T, w / 2 + T, LID, 0], // right
    [w / 2 + T, LID, T, 0, LID, -h / 2 - T], // far
    [w / 2 + T, LID, T, 0, LID, h / 2 + T], // near
  ];
  for (const [hx, hy, hz, cx, cy, cz] of slabs) {
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz)
      .setRestitution(PHYS.WALL_RESTITUTION)
      .setFriction(PHYS.WALL_FRICTION)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(PHYS.QUIET);
    world.createCollider(desc, ground);
  }
}

// ── The throw ──────────────────────────────────────────────────────────

export interface ThrowSpec {
  tray: Tray;
  count: number;
  /** The client's, drawn fresh per throw. Drives everything random here. */
  seed: number;
  /**
   * How it was thrown, in tray widths a second. Zero for a tap.
   *
   * `ax`/`ay` are where on the tray the hand let go, and they are part of the
   * throw rather than a note about it: `entryOf` walks backwards from them to
   * find the edge the dice come in by. The type used to be `{ x, y }` alone,
   * which was not merely incomplete — it silently accepted a fresh literal
   * with the aim left out, and two of the three call sites built exactly that.
   * The dice then flew in from the wrong edge on every replay and jumped to
   * their reported places at the end.
   */
  flick: { x: number; y: number; ax?: number; ay?: number };
  /** Where the dice were standing, or null before anyone has rolled. */
  from: readonly Rest3[] | null;
  /** Dice being kept: they stay exactly where they were and are not thrown. */
  held?: readonly boolean[];
}

/**
 * Where a throw comes in from, and where it is going.
 *
 * Pure, and exported, because it is the only part of the aiming a test can
 * reach: everything downstream of it is Rapier's, and Rapier does not explain
 * itself. `engine.test.ts` asks this what a gesture meant; the simulation
 * merely obeys it.
 */
export interface Entry {
  /** Where the handful is released, in physics units, on the floor plane. */
  x: number;
  z: number;
  /** The unit direction it is thrown along. */
  dx: number;
  dz: number;
  /** How hard, in physics units a second. */
  speed: number;
}

/**
 * Read a gesture as a throw.
 *
 * ── The flick *is* the throw ──────────────────────────────────────────
 *
 * Direction, speed, and the edge the dice come in by are all three the
 * gesture's. They used to be none of them: the flick was *added* to a fixed
 * shove down the tray's length, so a hard flick across the tray came out as a
 * throw down it with a lean on the side, and the honest report from playing it
 * was that flicking did nothing. Adding a velocity to a throw that is already
 * aimed somewhere else is not aiming it.
 *
 * The entry point is found by walking **backwards** from where the hand
 * started, against the throw, until the tray runs out. A flick that starts in
 * the middle and goes right brings the dice in from the left wall; one that
 * starts near the bottom-left corner and goes up and to the right enters at
 * that corner. Which is what a hand expects, because it is where the hand was.
 *
 * ── A tap is not a flick ──────────────────────────────────────────────
 *
 * No aim (`ax`/`ay` absent) and no speed worth measuring, so it gets the
 * tray's own throw: down the long axis, from whichever end the dice are *not*
 * already lying at, so a second throw crosses the tray rather than nudging the
 * pile where it stands. Leaned rather than decided — deciding outright made
 * every throw the mirror of the last one, which is its own kind of
 * obviously-not-random.
 */
export function entryOf(opts: {
  flick: { x: number; y: number; ax?: number; ay?: number };
  /** The tray, in physics units. */
  w: number;
  h: number;
  /** Where the dice are lying across the tray, 0 to 1, or null for a fresh table. */
  lie: number | null;
  rng: () => number;
}): Entry {
  const { flick, w, h, rng } = opts;
  // Far enough in that the handful is released beside the wall rather than
  // inside it — the walls are thick slabs, and a die spawned in one is a die
  // Rapier has to eject before the throw can begin.
  const inset = DIE_HALF * 2.2;
  const hard = Math.hypot(flick.x, flick.y);

  if (flick.ax === undefined || flick.ay === undefined || hard < PHYS.FLICK_FLOOR) {
    const lie = opts.lie ?? 0.5;
    const away = rng() < 0.5 + (lie - 0.5) * 0.84 ? -1 : 1;
    return {
      x: away * (w / 2 - inset),
      z: 0,
      dx: -away,
      dz: 0,
      speed: PHYS.THROW_SPEED * (0.85 + rng() * 0.3),
    };
  }

  const dx = flick.x / hard;
  const dz = flick.y / hard;

  /*
    How hard, from how hard the hand moved.

    Not the flick's own speed converted into physics units, which would be
    nonsense: eight tray widths a second across a tray thirty-five units wide
    is 280 units a second, an order of magnitude past anything these dice are
    tuned for and straight through the far wall. It is a *dial* — the range of
    throws a hand can ask for, from a gentle roll to a hard one, spread across
    the range of speeds a hand can actually flick at.
  */
  const reach = Math.min(1, (hard - PHYS.FLICK_FLOOR) / (PHYS.FLICK_FULL - PHYS.FLICK_FLOOR));
  const speed = PHYS.THROW_SOFT + reach * (PHYS.THROW_HARD - PHYS.THROW_SOFT);

  // Where the hand was, in the tray's own frame.
  const px = flick.ax * w - w / 2;
  const pz = flick.ay * h - h / 2;

  // And back from there, against the throw, to whichever wall it meets first.
  const hx = Math.max(w / 2 - inset, DIE_HALF);
  const hz = Math.max(h / 2 - inset, DIE_HALF);
  let back = Infinity;
  if (Math.abs(dx) > 1e-6) back = Math.min(back, (px + hx * Math.sign(dx)) / dx);
  if (Math.abs(dz) > 1e-6) back = Math.min(back, (pz + hz * Math.sign(dz)) / dz);
  if (!Number.isFinite(back) || back < 0) back = 0;

  return {
    x: Math.min(hx, Math.max(-hx, px - dx * back)),
    z: Math.min(hz, Math.max(-hz, pz - dz * back)),
    dx,
    dz,
    speed: speed * (0.92 + rng() * 0.16),
  };
}

/**
 * Set up a throw, ready to be stepped.
 *
 * The dice are released as a fanned handful at one edge of the tray and given
 * a shove across it. Which edge, which way and how hard are `entryOf`'s, and
 * that is where the gesture is read. Everything here is the handful itself:
 * spreading it across the throw so that five dice are not one die, and giving
 * each of them its own turn, its own spin and its own small disagreement about
 * how fast it was going.
 */
export function openThrow(spec: ThrowSpec): ThrowWorld {
  const { tray, count, seed, flick, from } = spec;
  const held = Array.from({ length: count }, (_, i) => Boolean(spec.held?.[i]));
  const k = scaleOf(tray);
  const w = tray.w / k;
  const h = tray.h / k;
  const rng = seeded(seed);

  const world = new RAPIER.World({ x: 0, y: PHYS.GRAVITY, z: 0 });
  world.timestep = PHYS.STEP;
  buildTray(world, w, h);

  const entry = entryOf({
    flick,
    w,
    h,
    lie: from && from.length > 0 ? from.reduce((sum, r) => sum + r.x, 0) / from.length / tray.w : null,
    rng,
  });
  // Across the throw. The handful is spread along this axis and thrown along
  // the other, whichever way round the two happen to lie in the tray.
  const latX = -entry.dz;
  const latZ = entry.dx;

  /*
    The lane each die gets, and it is at least its own width.

    The first cut fanned five two-unit cubes across six units of tray: they
    spawned inside one another, and Rapier's first act was to shove them apart
    hard enough that the push-apart, rather than the throw, was most of where
    they ended up. On the contact sheet it read as five dice exploding out of a
    single point. So the row is squeezed to fit the tray rather than allowed to
    overlap, and where the tray is too short to hold the handful in one row —
    Backgammon's is a strip — the stagger below keeps them apart instead.

    Measured along the lateral axis rather than simply down the tray's height,
    because the throw is no longer always down its length: a diagonal one has
    the tray's full diagonal support to spread across.
  */
  const room = Math.abs(latX) * w + Math.abs(latZ) * h;
  const lane = Math.min(DIE_HALF * 2.3, (room - DIE_HALF * 3) / Math.max(1, count - 1));
  const spread = (lane * Math.max(0, count - 1)) / 2;

  /*
    And the release point pulled in until the whole row fits inside the tray.

    Clamping each die on its own would be wrong: two dice clamped against the
    same wall are two dice in the same place, which is the interpenetration
    above arriving by a different road. Moving the row bodily keeps the lanes.
  */
  const roomX = Math.max(0, w / 2 - DIE_HALF * 1.1 - Math.abs(latX) * spread - Math.abs(entry.dx) * DIE_HALF);
  const roomZ = Math.max(0, h / 2 - DIE_HALF * 1.1 - Math.abs(latZ) * spread - Math.abs(entry.dz) * DIE_HALF);
  const originX = Math.min(roomX, Math.max(-roomX, entry.x));
  const originZ = Math.min(roomZ, Math.max(-roomZ, entry.z));

  const bodies: RAPIER.RigidBody[] = [];
  for (let i = 0; i < count; i++) {
    const keep = held[i] && from?.[i];
    const desc = keep ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();

    if (keep) {
      // Exactly where it was, turned exactly as it was. A kept die is not
      // re-simulated at all: it is scenery the thrown ones bounce off, and its
      // face comes back out of this untouched.
      const r = from![i];
      desc.setTranslation(r.x / k - w / 2, r.up / k + DIE_HALF, r.y / k - h / 2);
      desc.setRotation({ w: r.q[0], x: r.q[1], y: r.q[2], z: r.q[3] });
    } else {
      const lateral = count > 1 ? (i / (count - 1) - 0.5) * lane * (count - 1) : 0;
      // Staggered along the throw as well, so a row that has been squeezed is
      // still a handful of separate dice and not a wall of them.
      const stagger = (i % 2 === 0 ? 1 : -1) * DIE_HALF * 0.9;
      /*
        And staggered in height too, which is the third way five dice in a
        handful are kept out of one another.

        Tighter than it was — it used to spread them over another 2.6 units,
        which put the highest die of a handful at 4.6 before the throw had even
        started. The camera frames four units of headroom (see `HEADROOM` in
        `scene.ts`), so that die spent the first part of its flight above the
        top of the picture, which is the "the dice go off screen" report from
        one end. The other end was the framing, and both had to move.
      */
      desc.setTranslation(
        originX + latX * lateral - entry.dx * stagger,
        DIE_HALF * PHYS.DROP + (i % 3) * DIE_HALF * 0.4 + rng() * DIE_HALF * 0.5,
        originZ + latZ * lateral - entry.dz * stagger,
      );
      // A uniformly random start orientation. The old solver drew this from
      // the server and leaned on it for its fairness proof; here it is just an
      // honest handful, and the evenness of the result is Rapier's problem and
      // the test's.
      const u1 = rng();
      const u2 = rng() * Math.PI * 2;
      const u3 = rng() * Math.PI * 2;
      const s1 = Math.sqrt(1 - u1);
      const s2 = Math.sqrt(u1);
      desc.setRotation({
        w: s2 * Math.cos(u3),
        x: s1 * Math.sin(u2),
        y: s1 * Math.cos(u2),
        z: s2 * Math.sin(u3),
      });

      // Fanned in *velocity* as well as in position: the dice diverge as they
      // fly, which is what stops five of them arriving at the far wall as one
      // clump and stacking up against it.
      const splay = count > 1 ? (i / (count - 1) - 0.5) * PHYS.FAN : 0;
      const cs = Math.cos(splay);
      const sn = Math.sin(splay);
      const speed = entry.speed * (0.94 + rng() * 0.12);
      desc.setLinvel(
        (entry.dx * cs - entry.dz * sn) * speed,
        /*
          Lift with the throw rather than a fixed arc: a hard flick throws the
          dice up as well as along, and a gentle one rolls them in low. Square
          rooted, because the arc is what the *time* in the air buys and the
          hardest throw should be higher than the softest without being on the
          lid.
        */
        PHYS.THROW_LIFT * (0.8 + rng() * 0.4) * Math.sqrt(entry.speed / PHYS.THROW_SPEED),
        (entry.dx * sn + entry.dz * cs) * speed,
      );
      // Spin with the throw too, and for the same reason: a die lobbed gently
      // should turn over a few times on its way, not blur.
      const whirl = PHYS.SPIN * (0.55 + (0.65 * entry.speed) / PHYS.THROW_SPEED);
      desc.setAngvel({
        x: (rng() * 2 - 1) * whirl,
        y: (rng() * 2 - 1) * whirl,
        z: (rng() * 2 - 1) * whirl,
      });
      desc.setCcdEnabled(true);
      desc.setLinearDamping(PHYS.DAMP_LIN);
      desc.setAngularDamping(PHYS.DAMP_ANG);
    }

    const body = world.createRigidBody(desc);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(DIE_HALF, DIE_HALF, DIE_HALF)
        .setRestitution(PHYS.DIE_RESTITUTION)
        .setFriction(PHYS.DIE_FRICTION)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(PHYS.QUIET),
      body,
    );
    bodies.push(body);
  }

  return { world, bodies, held, tray, k, steps: 0, events: new RAPIER.EventQueue(true) };
}

/**
 * One step. Returns how many dice are still moving.
 *
 * `hits` is emptied and refilled, so a caller that wants the loudest contact
 * of a frame can find it without allocating one array per frame for the life
 * of the throw.
 */
export function stepThrow(live: ThrowWorld, hits: Hit[]): number {
  hits.length = 0;
  // Past the deadline, lean on them. Applied here rather than at setup because
  // it is a property of how long this throw has gone on, not of the dice.
  if (live.steps === PHYS.DEADLINE) {
    for (let i = 0; i < live.bodies.length; i++) {
      if (live.held[i]) continue;
      live.bodies[i].setLinearDamping(PHYS.DAMP_LIN * PHYS.DEADLINE_DAMP);
      live.bodies[i].setAngularDamping(PHYS.DAMP_ANG * PHYS.DEADLINE_DAMP);
    }
  }
  live.world.step(live.events);
  live.steps++;

  /*
    Only contacts that *began* this step, and this is not a detail.

    A contact force event fires every frame the contact exists, and a die lying
    against a wall is in contact with it for the rest of the throw — the first
    cut reported 440 wall contacts for a throw with maybe a dozen real ones,
    because five resting dice re-announced themselves sixty times a second. Fed
    to `clatter` that is not a clatter, it is a tone.

    The force threshold alone cannot separate them either: a resting die pushes
    on the floor with its whole weight, which under this gravity is far louder
    than the impulse of a real glancing hit. So the *start* is what makes a
    sound and the force only says how loud.
  */
  const began = new Set<number>();
  live.events.drainCollisionEvents((a, b, started) => {
    if (started) began.add(a * PAIR + b).add(b * PAIR + a);
  });

  live.events.drainContactForceEvents((event) => {
    const impulse = event.totalForceMagnitude();
    if (impulse < PHYS.QUIET) return;
    if (!began.has(event.collider1() * PAIR + event.collider2())) return;
    // Which of the pair was a die tells us whether this was the table or a
    // neighbour, and the two do not sound alike.
    const a = live.world.getCollider(event.collider1());
    const b = live.world.getCollider(event.collider2());
    const dice = [a, b].filter((c) => c?.parent()?.isDynamic() || c?.parent()?.isFixed() === false);
    const wall = dice.length < 2;
    const where = (dice[0] ?? a)?.translation();
    const w = live.tray.w / live.k;
    hits.push({
      impulse,
      wall,
      at: where ? Math.min(1, Math.max(0, (where.x + w / 2) / w)) : 0.5,
    });
  });

  if (live.steps >= PHYS.HARD_STOP) {
    // Whatever they were doing, they have stopped doing it. Putting them to
    // sleep rather than merely reporting stillness, so a later step cannot
    // start them off again after the faces have been read.
    for (const body of live.bodies) body.sleep();
    return 0;
  }

  let moving = 0;
  for (let i = 0; i < live.bodies.length; i++) {
    if (live.held[i]) continue;
    if (!live.bodies[i].isSleeping()) moving++;
  }
  return moving;
}

/** Run the whole throw here and now, and read the numbers off the dice. */
export function settleThrow(live: ThrowWorld): { faces: number[]; rest: Rest3[] } {
  const bin: Hit[] = [];
  let moving = 1;
  while (moving > 0) moving = stepThrow(live, bin);
  return { faces: facesOf(live), rest: restOf(live) };
}

/**
 * How loud a contact has to be, against the loudest one in this throw, to count
 * as the moment the throw was about.
 *
 * Relative rather than absolute, because a lobbed tap and a hard flick are two
 * orders of magnitude apart in impulse and a fixed threshold would find every
 * contact in one and none in the other. A quarter of the loudest is, in
 * practice, the difference between a die falling over and a die nudging one.
 */
const DECISIVE = 0.25;

/**
 * Run the throw once *before* it is watched, to find out where its beats are.
 *
 * The animation needs to slow down for the contact that settles the last die,
 * and it has to start slowing *before* that contact rather than after it —
 * which is only knowable by having already run the throw. So it is run twice:
 * once here, discarded except for two numbers, and once for real.
 *
 * That is about two milliseconds for five dice, on top of the two the throwing
 * client already spends in `settleThrow`. It buys the one thing a live loop
 * cannot have, which is foresight.
 *
 * The world is opened, settled and freed here rather than handed back, because
 * a caller holding a finished Rapier world is a caller who can forget to free
 * it — and the only two numbers worth keeping are these.
 */
export function scoutThrow(spec: ThrowSpec): Beats {
  const live = openThrow(spec);
  const bin: Hit[] = [];
  const heard: Array<{ step: number; impulse: number }> = [];
  let moving = 1;
  let loudest = 0;
  while (moving > 0) {
    moving = stepThrow(live, bin);
    for (const hit of bin) {
      heard.push({ step: live.steps, impulse: hit.impulse });
      if (hit.impulse > loudest) loudest = hit.impulse;
    }
  }
  const steps = live.steps;
  disposeThrow(live);

  let decisive = -1;
  for (const hit of heard) {
    if (hit.impulse >= loudest * DECISIVE) decisive = hit.step;
  }
  return { steps, decisive };
}

/** Where every die is, in tray units. */
export function restOf(live: ThrowWorld): Rest3[] {
  const w = live.tray.w / live.k;
  const h = live.tray.h / live.k;
  return live.bodies.map((body) => {
    const t = body.translation();
    const r = body.rotation();
    return {
      x: (t.x + w / 2) * live.k,
      y: (t.z + h / 2) * live.k,
      up: Math.max(0, (t.y - DIE_HALF) * live.k),
      q: [r.w, r.x, r.y, r.z] as Quat,
    };
  });
}

/**
 * Every die as the renderer wants it: physics frame, centred on the tray.
 *
 * Here rather than in `scene.ts` so that the renderer never has to reach into
 * a Rapier body — `scene.ts` reads this and nothing else, which is what keeps
 * the simulation runnable in Node.
 */
export function placedOf(live: ThrowWorld): Array<{ x: number; y: number; z: number; q: Quat }> {
  return live.bodies.map((body) => {
    const t = body.translation();
    const r = body.rotation();
    return { x: t.x, y: t.y, z: t.z, q: [r.w, r.x, r.y, r.z] as Quat };
  });
}

/** What every die is showing. */
export function facesOf(live: ThrowWorld): number[] {
  return live.bodies.map((body) => {
    const r = body.rotation();
    return faceUp([r.w, r.x, r.y, r.z]);
  });
}

/** Rapier holds its own memory; a world that is finished has to say so. */
export function disposeThrow(live: ThrowWorld): void {
  live.events.free();
  live.world.free();
}
