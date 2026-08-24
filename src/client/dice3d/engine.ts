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

export { faceUp };
export type { Rest3 };

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
   * Far stronger than life. Real gravity on a two-unit die gives a slow,
   * floaty, moon-like tumble that reads as cheap; exaggerating it is what
   * makes dice land with a snap and settle inside a second.
   */
  GRAVITY: -55,
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

  /** Die against tray and die against die. Lively, not rubbery. */
  DIE_RESTITUTION: 0.4,
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
   *     friction  0.50 → 134 steps, span 30%   ← with the damping below
   *
   * For comparison the 2.5D solver this replaces settled in 74 steps and
   * covered 16% of the tray. These dice take about twice as long and go
   * roughly twice as far, which is the trade that was wanted.
   */
  DIE_FRICTION: 0.5,
  /**
   * Walls give the die back rather than stealing its spin. Zero friction, or a
   * die that clips a wall stops dead against it, which reads as a bug even
   * when it is not.
   */
  WALL_RESTITUTION: 0.1,
  WALL_FRICTION: 0,

  /** How hard the dice are thrown when the flick says nothing. */
  THROW_SPEED: 24,
  /** Upward, so they arc rather than skid. */
  THROW_LIFT: 6,
  /** Radians a second per axis, drawn uniformly in ±this. */
  SPIN: 18,
  /** How high above the floor the dice are released, in dice. */
  DROP: 3.2,
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
  DAMP_ANG: 0.12,
  /**
   * After this many steps the throw has been interesting for long enough and
   * the damping above is multiplied up, which brings it down inside another
   * half second.
   *
   * A deadline rather than more damping throughout, because those are not the
   * same shape: more damping everywhere makes every throw sluggish from the
   * first bounce, where this leaves the part anybody watches untouched and
   * only leans on the tail nobody does. The old solver learned this and the
   * number here is its `DEADLINE` in steps.
   */
  DEADLINE: 40,
  DEADLINE_DAMP: 18,
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
  /** How it was thrown, in tray widths a second. Zero for a tap. */
  flick: { x: number; y: number };
  /** Where the dice were standing, or null before anyone has rolled. */
  from: readonly Rest3[] | null;
  /** Dice being kept: they stay exactly where they were and are not thrown. */
  held?: readonly boolean[];
}

/**
 * Set up a throw, ready to be stepped.
 *
 * The dice are released as a fanned handful from one end of the tray and given
 * a shove down its length. **Which** end is the one they are not already
 * lying at, so a second throw crosses the tray rather than nudging the pile
 * where it stands — the same aiming heuristic the old solver arrived at, and
 * for the same reason: it is what makes a throw use the tray it is thrown
 * into.
 *
 * It is a lean rather than a rule. Deciding outright made every throw the
 * mirror of the last one, which is its own kind of obviously-not-random.
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

  // Which end to throw from: away from where the dice already are, leaned
  // rather than decided. With nothing on the table, either end will do.
  const lie = from && from.length > 0 ? from.reduce((sum, r) => sum + r.x, 0) / from.length / tray.w : 0.5;
  const away = rng() < 0.5 + (lie - 0.5) * 0.84 ? -1 : 1;

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
      /*
        Fanned across the throwing end, and **not touching**.

        The first cut fanned them across `sin(spread) * count * DIE_HALF`,
        which for five dice is under six units of room for five two-unit cubes:
        they spawned inside one another, and Rapier's first act was to shove
        them apart hard enough that the push-apart, rather than the throw, was
        most of where they ended up. On the contact sheet it read as five dice
        exploding out of a single point.

        So the lane each die gets is at least its own width, and the row is
        squeezed to fit the tray rather than allowed to overlap. Where the tray
        is too short to hold the handful in one row — Backgammon's is a strip —
        the stagger below is what keeps them apart instead.
      */
      const lane = Math.min(DIE_HALF * 2.3, (h - DIE_HALF * 3) / Math.max(1, count - 1));
      const across = count > 1 ? (i / (count - 1) - 0.5) * lane * (count - 1) : 0;
      // Staggered along the throw as well, so a row that has been squeezed is
      // still a handful of separate dice and not a wall of them.
      const stagger = (i % 2 === 0 ? 1 : -1) * DIE_HALF * 0.9;
      desc.setTranslation(
        away * (w / 2 - DIE_HALF * 2.2) + away * stagger,
        DIE_HALF * PHYS.DROP + (i % 3) * DIE_HALF * 0.8 + rng() * DIE_HALF,
        across,
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

      // Down the tray, plus whatever the hand added. The flick is in tray
      // widths a second, so it scales by the width on both axes — a tray's
      // shape is fixed, and using its height for the other axis would make a
      // sideways flick mean something different in a short tray.
      const speed = PHYS.THROW_SPEED * (0.85 + rng() * 0.3);
      // Fanned in *velocity* as well as in position: the dice diverge as they
      // fly, which is what stops five of them arriving at the far wall as one
      // clump and stacking up against it.
      const splay = count > 1 ? (i / (count - 1) - 0.5) * PHYS.FAN : 0;
      desc.setLinvel(
        -away * speed * Math.cos(splay) + flick.x * w,
        PHYS.THROW_LIFT * (0.8 + rng() * 0.4),
        Math.sin(splay) * speed + (rng() - 0.5) * speed * 0.15 + flick.y * w,
      );
      desc.setAngvel({
        x: (rng() * 2 - 1) * PHYS.SPIN,
        y: (rng() * 2 - 1) * PHYS.SPIN,
        z: (rng() * 2 - 1) * PHYS.SPIN,
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
