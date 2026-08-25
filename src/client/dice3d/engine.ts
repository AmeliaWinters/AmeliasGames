/**
 * The dice, as actual cubes.
 *
 * This replaces the 2.5D solver in `src/shared/games/dice.ts`, which met dice
 * as squares in a plane and carried height as a scalar channel beside the
 * motion rather than inside it. That bought a proof, since the plane never
 * read the cube's orientation, so the odds were exactly even and could be
 * asserted as `[20,20,20,20,20,20]`. It cost everything a cube does that a
 * square cannot: land on a corner, topple, wedge, or rest on top of another.
 *
 * The trade has been made deliberately. Rapier decides where the dice go, the
 * face is read off whichever normal ends up pointing at the ceiling, and the
 * distribution is now an empirical claim tested statistically rather than a
 * structural one proved by construction. `engine.test.ts` is where that claim
 * lives, and it is weaker on purpose rather than by accident.
 *
 * Where this runs
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
 * Units
 *
 * A `Tray` is measured in its own abstract units, where a Yahtzee die is 5.63
 * and the tray is 100 across. Everything inside here is scaled so that **a die
 * is 1.6 centimetres on a side**, a real 16 mm casino die, which makes a
 * Yahtzee tray about 28 cm and lets every constant below be checked against
 * something in the world. See `DIE_HALF` for why the units are real rather than
 * abstract; it is the single largest reason the old throw looked fake.
 *
 * `scaleOf` is the only place that knows the factor, and every value leaving
 * this file is back in tray units, because a tray is about 320px on a phone and
 * twice that on a laptop, and a simulation fed pixels would land the dice on
 * different faces on the two of them.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { Tray, Quat } from '../../shared/games/dice.js';
import { faceUp, seeded } from '../../shared/games/dice.js';
import type { Rest3 } from '../../shared/games/toss.js';

export { faceUp };
export type { Rest3 };

/**
 * Half a die, in physics units, and the physics units are **centimetres**.
 *
 * This used to be 1, with the unit left abstract and gravity set to whatever
 * looked right against it. That is where the throw got its plastic, toy-like
 * read from, and the reason is worth writing down because it is not obvious:
 * **gravity is how an eye infers scale.** Shown an object with no absolute
 * size cue, a viewer reads the size off how fast it falls, and a die falling
 * under 4.6 g is read as a small light thing rather than as a die seen close
 * up. Every other trick (bevels, better materials, softer shadows) is fighting
 * that one number.
 *
 * So the scale is now real and stated: a 16 mm casino die, which is what these
 * are drawn as, in a tray that works out at about 28 cm across. Gravity is
 * 981 cm/s^2, throw speeds are in cm/s, and every number in `PHYS` below can be
 * checked against something in the world rather than against a taste.
 *
 * The consequence, and it is the whole of why this needed a version bump: real
 * gravity on a 16 mm die runs about five times faster than the old make-believe
 * did. A throw that used to be watchable at its own pace is over in a blink
 * unless the dice are actually *thrown*, which is why `THROW_SPEED` below went
 * up by a factor of seven and why the dice now cross the tray several times
 * before they settle. Not a workaround; it is what throwing dice is.
 */
export const DIE_HALF = 0.8;

/**
 * The radius rolled onto the die's corners and edges, in the same centimetres.
 *
 * 1.5 mm on a 16 mm die, which is a real "round corner" casino die and close to
 * the middle of what dice are actually made to.
 *
 * **It is here for the picture, and the measurement says so.** This was put in
 * expecting it to be what finally stopped the dice skidding, a sharp-cornered
 * cube being able only to pivot over an edge and fall flat where a rounded one
 * rolls. It is not. Held against a radius of effectively zero, with every other
 * constant fixed, the roll-out skid came to 0.79 cm per radian against 0.77:
 * the same die. What actually fixed the skid was the rescale (see `DIE_HALF`),
 * and the honest record is that the theory was wrong.
 *
 * It stays, at no measured cost, for two reasons. A real die has this radius,
 * and this file is now trying to be a real die throughout rather than in the
 * places that happened to show up in a metric. And `scene.ts` draws the shape
 * the collider is, so the die on screen gets its bevel from this line, worth
 * having on its own, a perfectly sharp cube being one of the more reliable ways
 * to look computer-generated.
 *
 * Rapier's `roundCuboid` takes the half-extents of the *inner* box and adds the
 * radius outside them, so the inner box has to be shrunk by exactly this or the
 * die comes out too big, which would be invisible on screen and wrong in every
 * contact.
 */
export const DIE_ROUND = 0.15;

/**
 * Stride for keying a pair of collider handles into one number. Larger than
 * any handle count a tray will ever reach, so two different pairs cannot
 * collide onto the same key.
 */
const PAIR = 1 << 16;

/**
 * Every constant the throw has, and why it is the number it is.
 *
 * These used to be a feel, tuned by eye against an abstract unit, inherited
 * from a reference implementation and adjusted until it looked right. They are
 * now **measurements**, in centimetres and seconds, of a 16 mm acrylic die in a
 * 28 cm tray, because a number you can check against the world is a number the
 * next person can argue with. Where one is still a taste it says so.
 *
 * `npm run render:throw` is how you look at the result.
 */
export const PHYS = {
  /**
   * Real gravity, in cm/s^2. Not a taste, and no longer negotiable.
   *
   * It was -45 in abstract units, about 4.6 g, and every retune of it went the
   * wrong way for the same reason: exaggerating gravity does not make a die
   * look heavier, it makes it look *smaller*. See `DIE_HALF`. Setting it to
   * 981 is what makes a die read as a die, and it is also what forced every
   * other number here to be re-derived, because the natural timescale of a
   * 16 mm die under real gravity is about five times faster than the old one.
   */
  GRAVITY: -981,
  /**
   * Fixed, because two clients replaying one seed must take the same steps.
   *
   * Doubled from 1/60. A die thrown at 250 cm/s covers 4 cm in a sixtieth of a
   * second, which is two and a half die-widths: far enough that a die-against-
   * die contact can happen entirely between two steps and never be found. CCD
   * catches the walls and does not catch that. `dice.ts` recorded this lesson
   * once already, from the other side, when shrinking the dice forced the old
   * solver from 1/120 to 1/240.
   */
  STEP: 1 / 120,
  /**
   * Substeps per frame. Two are needed at 60fps just to keep up, so this is
   * headroom over that and not much more. A frame that tries to catch up an
   * arbitrary stall spirals: catching up costs more than the frame it is
   * catching up for, and the next frame is later still.
   */
  MAX_SUBSTEPS: 6,
  /** A gap longer than this is a stall, not a frame. */
  MAX_FRAME: 0.1,

  /**
   * Die against tray and die against die.
   *
   * Up from 0.22. The earlier note here, that "bouncing is the one thing a real
   * die mostly does not do", was true only of the dice it was written about. A
   * cube under 4.6 g really does just stop. A 16 mm die dropped on a tray
   * bounces two or three times and audibly so; measured coefficients for acrylic
   * sit around 0.4 to 0.6.
   *
   * This is also what buys the throw its length, which throw *speed* turned out
   * not to. Raising the release speed from 190 to 300 cm/s left settling time
   * flat at 0.87s and only spread the dice further; raising restitution and
   * dropping friction to a hard tray took it to 0.95s and, more to the point,
   * took wall reversals from 0.83 to 1.13 per die. A die that comes back off a
   * wall is the difference between a throw and a shove, and it is bounce rather
   * than speed that produces one.
   */
  DIE_RESTITUTION: 0.5,
  /**
   * Acrylic on a cloth-lined tray. A real number at last, and, this being the
   * surprise, no longer a number that matters much.
   *
   * It was **0.95**: roughly rubber on dry concrete, and nothing like a die on
   * anything. It was that high because it was the only lever anyone had on the
   * skid. The old note records what that lever cost to pull: distance travelled
   * per radian turned went 4.5 -> 3.2 -> 1.8 as friction went 0.5 -> 0.6 -> 0.95,
   * and a cube that genuinely rolls scores about 1. Even at 0.95 it was still
   * skidding, just slowly.
   *
   * Under real gravity the lever does almost nothing, which is the clearest
   * sign that the old physics was solving the wrong problem. Measured over 120
   * throws each, everything else fixed, roll-out skid against a rolling ideal
   * of 0.80:
   *
   *     friction  0.28 -> 2.13 overall, 0.82 rolling out
   *     friction  0.40 -> 2.10 overall, 0.77 rolling out
   *     friction  0.55 -> 1.99 overall, 0.83 rolling out
   *
   * Two things in that table. Friction has stopped being a knob: doubling it
   * moves the number by five percent. And splitting the throw in two is what the
   * old measurement was missing, since a thrown die *should* skid on the landing
   * and then roll itself out, and the overall figure averages those two into a
   * number that describes neither. The roll-out is 0.77 against an ideal of
   * 0.80, a die rolling over its own edges, the thing the complaint that started
   * all this said was not happening.
   *
   * So this can now simply be what acrylic on cloth is.
   */
  DIE_FRICTION: 0.4,
  /**
   * The walls. Livelier than the floor, because they are bare and it is not.
   *
   * These were 0.15 and 0.18, chosen when a wall contact was a thing to be
   * survived: the dice were slow, and a wall that took anything from them ended
   * the throw early. The dice now arrive at the wall with real speed and the
   * throw *wants* them to come back off it. At these numbers a die reverses
   * against a wall about once per throw, where it used to be well under half
   * that, and that reversal is most of what makes a throw look thrown rather
   * than placed.
   */
  WALL_RESTITUTION: 0.55,
  WALL_FRICTION: 0.28,

  /** How hard the dice are thrown when the flick says nothing: a tap. cm/s. */
  THROW_SPEED: 240,
  /**
   * And what a flick can ask for, from the gentlest measured one to the
   * hardest. `entryOf` maps the hand's speed across this range. cm/s.
   *
   * A hand throwing dice releases them at somewhere between one and four metres
   * a second, so this range is real rather than invented, which it was not
   * before, when the soft end was 15 abstract units and worked out at about
   * 24 cm/s, a shove rather than a throw.
   *
   * Worth knowing before reaching for these: **they do not control how long a
   * throw lasts.** 240 and 300 cm/s settle within a hundredth of a second of
   * each other. What they control is spread, 40% of the tray against 55%, so
   * this is the pair to move when the dice are landing in a heap, and
   * `DIE_RESTITUTION` is the one to move when the throw is over too quickly.
   *
   * The soft end is deliberately still a throw: the dice cross the tray and come
   * back off the far wall, because a flick that only nudged them would read as
   * the gesture not having worked. The hard end is short of the speed at which
   * a die is still climbing when it reaches the far wall, which is the point
   * where throws stop looking different from one another and start looking like
   * a bug.
   */
  THROW_SOFT: 180,
  THROW_HARD: 420,
  /**
   * Below this, in tray widths a second, the hand was not throwing.
   *
   * `flick.ts` has already refused anything under about 140px/s as a tap; this
   * is the same judgement made a second time in the tray's own units, and it
   * is what a replayed throw is measured against: a client whose gesture
   * thresholds differ still has to agree with everyone else about what this
   * particular flick meant.
   *
   * Dimensionless, tray widths rather than centimetres, so the rescale left it
   * alone.
   */
  FLICK_FLOOR: 0.35,
  /** And at this the hand is asking for everything. Above it, nothing more. */
  FLICK_FULL: 3.2,
  /**
   * Upward component at release, cm/s, scaled by how hard the throw was.
   *
   * A throw is mostly *along*, not up, which is easy to get wrong and the cost
   * of getting wrong is framing. `scene.ts` has to keep the whole flight in
   * shot, and every centimetre of arc is paid for by drawing the tray smaller. At 35 cm/s a die rises about 6 mm on its own account and the
   * handful peaks around two dice above the floor; the throws that go higher
   * than that go there by bouncing off each other, which is real and cannot be
   * tuned away. `HEADROOM` in `scene.ts` is sized against the measured p99 of
   * that, not against this number.
   */
  THROW_LIFT: 35,
  /**
   * Radians a second per axis, drawn uniformly in +/-this.
   *
   * Angular velocity is one-over-time, so it scaled up with everything else: a
   * die released from a hand tumbles at a few turns a second, and 24 rad/s is a
   * little under four. Faster than this and the die is a blur rather than a
   * tumbling object, which loses the thing the tumble is for.
   */
  SPIN: 24,
  /**
   * How high above the floor the dice are released, in dice.
   *
   * Two and a half dice is 4 cm, about where a hand lets go over a tray, and at
   * real gravity that is a tenth of a second of fall rather than the wasted
   * second it would have been under the old make-believe.
   *
   * Lower is not better, and it was tried: releasing at 1.6 dice puts the
   * handful into the tray nearly flat and at full speed, and the overall skid
   * went from 2.2 to 3.4 cm per radian because the dice arrive with nothing but
   * forward motion and have to shed it by sliding. A die needs some fall to
   * turn over on.
   */
  DROP: 2.5,
  /** The arc a handful is fanned across, so five dice are not one die. Radians. */
  FAN: 1.2,

  /**
   * Steps after which the throw is over whatever the dice think. Rapier sleeps
   * bodies on its own and this is only ever reached by a bug, so it is generous
   * rather than tight. It exists because a client that never stops animating
   * never reports its roll, and the turn never ends.
   *
   * Ten seconds, same as it was; the number doubled with the timestep.
   */
  HARD_STOP: 1200,
  /**
   * Impulse below which a contact is not worth a sound.
   *
   * This is in the physics' units and they changed underneath it, so it was
   * re-measured rather than re-guessed. Over 150 Yahtzee throws the contacts
   * Rapier reports run:
   *
   *     p10 742    p50 3724    p90 7916    p99 12382    max 18939
   *
   * and the loudest contact in a throw is around 10,000, which is the number
   * `clatter`'s divisor in `Dice3DTray.tsx` is set from, so the hardest hit of
   * a typical throw is a full-volume one.
   *
   * 700 trims roughly the quietest tenth. It is deliberately not higher: this
   * threshold is a floor on what is *audible*, and the volume is already scaled
   * by impulse, so a contact just above it makes a very quiet click rather than
   * a full one. Raising it to silence the clatter of five dice would silence the
   * light contacts that make it sound like five dice.
   */
  QUIET: 700,

  /**
   * Drag, and it is now only the air.
   *
   * Small, and smaller than it was relative to everything around it. Real air
   * drag on a 16 mm die over a two-second throw is very nearly nothing, and
   * with rounded corners doing the rolling and real friction doing the stopping
   * there is no longer any work for this to do beyond keeping a nearly-stopped
   * die from jittering until Rapier notices it.
   */
  DAMP_LIN: 0.05,
  DAMP_ANG: 0.2,
  /**
   * After this many steps the throw has been interesting for long enough and
   * the damping above is multiplied up, which brings it down inside another
   * half second.
   *
   * **This is still a cheat, and it is the last one left.** Momentum is being
   * deleted with nothing on screen to account for it, and if a throw is ever
   * seen to sag, this is why. It survives the rescale for one reason: a die
   * that is barely moving but not yet asleep holds up the turn, and the
   * deadline is cheaper than waiting.
   *
   * Much later and much gentler than it was: 1.6 seconds at four times the
   * damping, against 0.77 seconds at fourteen. Under the old physics the contact
   * that settled the last die landed *after* the deadline, so the lean was being
   * applied to dice still doing the interesting part; here it lands well into
   * the tail, and at four rather than fourteen it is a nudge towards a stop the
   * dice were already making rather than a hand on top of them. The honest fix
   * is to delete it and lift Rapier's sleep thresholds instead, which is a
   * separate change and has not been made.
   */
  DEADLINE: 190,
  DEADLINE_DAMP: 4,
} as const;

/** A contact worth hearing, in the frame it happened. */
export interface Hit {
  impulse: number;
  wall: boolean;
  /** Where across the tray, 0 to 1, so the sound can be panned to it. */
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
 * base64: one file, no second network request, and it works unchanged in Node,
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


// The tray

/**
 * Four walls, a floor and a lid.
 *
 * The lid is not decoration. The old solver's dice could not leave the tray
 * upward because height was a scalar with a hard ceiling of its own; these are
 * real bodies with real velocity, and a die that catches another one on the
 * corner at the top of its arc will otherwise leave the tray and never come
 * back, which reads as a die that vanished and hangs the turn, because the
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

// The throw

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
   * which was not merely incomplete: it silently accepted a fresh literal with
   * the aim left out, and two of the three call sites built exactly that. The
   * dice then flew in from the wrong edge on every replay and jumped to their
   * reported places at the end.
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
 * The flick *is* the throw
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
 * A tap is not a flick
 *
 * No aim (`ax`/`ay` absent) and no speed worth measuring, so it gets the tray's
 * own throw: down the long axis, from whichever end the dice are *not* already
 * lying at, so a second throw crosses the tray rather than nudging the pile
 * where it stands. Leaned rather than decided, because deciding outright made
 * every throw the mirror of the last one, its own kind of obviously-not-random.
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
  // inside it. The walls are thick slabs, and a die spawned in one is a die
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
    tuned for and straight through the far wall. It is a *dial*: the range of
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
  /*
    Tell Rapier what a metre is, because several of its thresholds are lengths
    and it assumes SI unless told otherwise.

    `allowedLinearError`, `predictionDistance`, `maxPenetrationCorrection` and,
    the one that bit, `RigidBodyActivation.linearThreshold` are all scaled by
    this. The sleep threshold defaults to something sensible for a human-sized
    object in metres, which in centimetres is a hundred times too *small*: a die
    creeping across the tray at two millimetres a second is stopped as far as
    anybody watching is concerned, and Rapier would keep simulating it.

    That is not a theory. Before this line, 4% of Liar's Dice throws ran to
    `HARD_STOP`, the full ten seconds, because one die of five never quite fell
    below a threshold meant for a crate sliding across a warehouse.
  */
  world.lengthUnit = 100;
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
    overlap, and where the tray is too short to hold the handful in one row
    (Backgammon's is a strip) the stagger below keeps them apart instead.

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

        Tighter than it was: it used to spread them over another 2.6 units,
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
    /*
      A cube with its corners rolled off, not a cube.

      The inner half-extent is shrunk by exactly the radius that is added back
      outside it, so the die is still 16 mm across its flats. `roundCuboid`
      inflates the box it is given rather than carving into it, and a die built
      from the full half-extent would be 3 mm too big in every direction. That
      error would be invisible on screen, because `scene.ts` draws the shape it
      is told to, and wrong in every single contact.

      This is the change that lets `DIE_FRICTION` be a real material number: a
      rounded corner rolls, a sharp one can only pivot and fall. See
      `DIE_ROUND`.
    */
    world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(
        DIE_HALF - DIE_ROUND,
        DIE_HALF - DIE_ROUND,
        DIE_HALF - DIE_ROUND,
        DIE_ROUND,
      )
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
    against a wall is in contact with it for the rest of the throw. The first
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
 * Here rather than in `scene.ts` so the renderer never has to reach into a
 * Rapier body. `scene.ts` reads this and nothing else, which is what keeps the
 * simulation runnable in Node.
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
