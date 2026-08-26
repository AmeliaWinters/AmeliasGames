/**
 * The *beats* of a throw: the wind-up before it, and the flourish after it.
 *
 * There used to be a third, inside it: a slow-motion moment at the contact
 * that settled the last die. It has been removed, and the section below says
 * why, because the reasoning that put it there was sound and is worth not
 * repeating.
 *
 * Pure, and its own file, for the same reason `entryOf` is pure and exported:
 * everything else about a throw is Rapier's and Rapier does not explain
 * itself, but these are decisions about *time and drawing* and a test can hold
 * them to account. Nothing here touches the physics.
 *
 * Why none of this needs a version bump
 *
 * A throw is stored as a seed and a flick and re-run to be watched (see
 * `toss.ts`), so anything that changes what the simulation *does* relands
 * every stored throw and costs a `SNAPSHOT_VERSION`. None of this does. The
 * wind-up happens before step 0 and the flourish runs after the dice have
 * already been reported. Same steps, same faces, same resting places.
 *
 * The rule the flourish is built around
 *
 * **A celebrating die must still show its number.** The scoresheet beside the
 * tray already says what was rolled, and a cube that disagrees with it is the
 * bug this whole 3D rewrite started from. That is why the hop is scripted
 * rather than thrown: a real upward impulse is livelier, and it also lets five
 * dice knock each other over into faces the sheet never saw. What is here
 * instead is a parabola and a turn about the *world's* vertical axis, and
 * spinning a die about the axis its top face is already pointing along cannot
 * change which face that is at any point in the turn, which `beats.test.ts`
 * asserts rather than trusts.
 */
import { multiply, type Quat } from '../../shared/games/dice.js';

/** A die as the renderer takes it: physics frame, centred on the tray. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  q: Quat;
}

/* The wind-up */

/**
 * How long the dice take to leave the table, in milliseconds.
 *
 * Short. The beat before a throw, not an animation in its own right: long
 * enough that the dice are seen to be *picked up* rather than to appear in the
 * air, and short enough that a player rolling three times a turn is not waiting
 * through it. Much longer and it reads as lag on the button.
 */
export const WINDUP_MS = 170;

/**
 * The handful, on its way from the table to where the throw begins.
 *
 * The dice used to simply exist at their release point, two die-heights up and
 * already moving. That is where `openThrow` puts them and it is correct, but on
 * screen it meant the tray was empty for a frame and then full of dice in
 * mid-flight, the largest reason a throw did not read as a throw: no gesture
 * was ever shown, only its result.
 *
 * So the handful is drawn *travelling* from where the dice were lying to where
 * the throw begins. It is the same dice: a die you can see on the table is the
 * die that gets thrown, which is a thing a player checks without knowing they
 * are checking it.
 *
 * `skip` is the kept dice, and it is not an optimisation. A kept die's release
 * pose is already its resting pose, so the interpolation moves it nowhere, but
 * `LIFT` is added on top of that interpolation rather than along it, and a die
 * going nowhere was still being lifted a fifth of its own height into the air
 * and put back. Held means the player chose to keep it, and a kept die that
 * bobs every time the others are thrown is a kept die that looks thrown.
 */
export function windUp(
  from: readonly Pose[],
  to: readonly Pose[],
  t: number,
  skip?: readonly boolean[],
): Pose[] {
  const u = ease(clamp01(t));
  return to.map((end, i) => {
    if (skip?.[i]) return end;
    const start = from[i] ?? end;
    return {
      x: start.x + (end.x - start.x) * u,
      y: start.y + (end.y - start.y) * u + LIFT * arc(u),
      z: start.z + (end.z - start.z) * u,
      q: slerp(start.q, end.q, u),
    };
  });
}

/**
 * The extra height the handful carries over the straight line between the two
 * poses, so the dice are gathered upward rather than dragged across the felt.
 * In physics units, where a die is two on a side.
 */
const LIFT = 0.55;

/** Nought at both ends, one in the middle. */
const arc = (u: number) => 4 * u * (1 - u);

/**
 * Slow out of the table, fast into the throw: the shape of a hand gathering
 * something and then flinging it, and the opposite of the usual ease-out. A
 * wind-up that decelerates into its release looks like the dice changed their
 * minds.
 */
const ease = (u: number) => u * u;

/* The slow moment, and why there is no longer one
   A throw used to be time-warped as it played: `paceOf` ran the clock at about
   a third of life for eighteen steps around the contact that settled the last
   die, and then at four times life through the tail behind it. `scoutThrow` in
   `engine.ts` ran the whole throw once in advance, for about two milliseconds,
   purely so the slowdown could begin *before* the contact rather than after it.

   It is gone, and the note is kept because the case for it was good and the
   thing was still wrong.

   The case: it was measured rather than eyeballed, the beat landed near the
   middle of a throw in over 99% of them, and, the part genuinely hard to argue
   with, it was *free*, buying the slow moment out of a tail nobody was watching
   and coming out a few milliseconds shorter per throw than no pacing at all.

   Why it went anyway: none of that is the question a viewer asks. Dice are one
   of the few things everyone has watched land in real life, and a throw that
   changes speed partway through does not read as emphasis, it reads as
   *broken*, the same instinct that spots a dropped frame. Every argument above
   is about the throw's budget and none is about whether it looks real, which
   was the only thing wrong with it. Reported, in the end, as "the slow-mo looks
   awful", which was correct.

   The general lesson, since it is easy to reach for this again: the throw is
   simulated so that it can be *believed*, and anything that treats the playback
   clock as a place to add expression is spending the one thing the simulation
   was bought with. Emphasis belongs in the flourish below, which happens after
   the dice have stopped and reported, where a viewer has no physical intuition
   left to violate.

   `Beats` and `scoutThrow` went with it: with nothing needing foresight, the
   two-millisecond pre-run bought nothing. */

/* The flourish */

/**
 * What the dice are celebrating.
 *
 * One vocabulary across the three games that have dice, because they are the
 * same object doing the same thing and three separately-invented flourishes
 * would be three registers on one table.
 *
 * **It keys off what the dice did, not off what the game made of it**, and
 * that is what lets one treatment serve three rulebooks. `all` is every die
 * showing the same number: a Yahtzee, and equally a Liar's Dice hand of five
 * alike, which is the same event and deserves the same noise even though one
 * of them scores fifty and the other is just a good hand to bluff from.
 * `pair` is two alike, which is Backgammon's double.
 *
 * Liar's Dice gets no flourish for *winning a call*, and that is a limit of
 * the staging rather than a judgement: its tray is on screen only while you
 * owe a throw and is gone by the time a call is settled. There is nothing left
 * to celebrate with.
 */
export type CheerKind = 'all' | 'pair';

interface Cheer {
  /** Peak height above the die's resting place, in physics units. */
  hop: number;
  /** Full turns about the world's vertical axis. Whole, or it lands askew. */
  turns: number;
  /** How long one die's hop lasts, in ms. */
  span: number;
  /** And how far behind the one before it each die starts. */
  stagger: number;
  /** How hard the rim flashes, 0 to 1. */
  flash: number;
}

/**
 * Two sizes of the same gesture. Five alike is the rarest thing any of these
 * games can put on the table and gets two turns and the full height; a double
 * happens every few throws of Backgammon, and a flourish that big every few
 * throws is not a flourish, it is the animation.
 *
 * `hop` is capped by the camera, not by taste: `scene.ts` frames four units of
 * headroom above the floor, and a die whose top passes that is a die drawn
 * outside the picture at the peak of the celebration. A die at rest has its
 * centre at 1 and its top at 2, so a hop of 1.8 puts the top at 3.8 with a
 * little to spare.
 */
const CHEERS: Record<CheerKind, Cheer> = {
  all: { hop: 1.8, turns: 2, span: 460, stagger: 72, flash: 1 },
  pair: { hop: 0.9, turns: 1, span: 380, stagger: 60, flash: 0.55 },
};

/** How long the whole flourish takes, so the caller knows when to stop asking. */
export function cheerLength(kind: CheerKind, count: number): number {
  const cheer = CHEERS[kind];
  return cheer.span + cheer.stagger * Math.max(0, count - 1);
}

/** How hard the tray's rim flashes for this one. */
export function cheerFlash(kind: CheerKind): number {
  return CHEERS[kind].flash;
}

/**
 * Every die, mid-flourish, `ms` into it.
 *
 * A die that has not started yet and one that has finished are both simply
 * where they were lying, which is what makes this safe to call for the whole
 * length of the animation and safe to stop calling at any point: the rest pose
 * is the fixed point of the whole function.
 */
export function cheerPose(
  resting: readonly Pose[],
  kind: CheerKind,
  ms: number,
  skip?: readonly boolean[],
): Pose[] {
  const cheer = CHEERS[kind];
  return resting.map((die, i) => {
    if (skip?.[i]) return die;
    const u = clamp01((ms - i * cheer.stagger) / cheer.span);
    if (u <= 0 || u >= 1) return die;
    const angle = cheer.turns * 2 * Math.PI * u;
    const half = angle / 2;
    // About the world's vertical axis, applied on the left so it turns the die
    // where it stands rather than about an axis of the die's own, which is the
    // whole reason the face survives. See the note at the top.
    const spin: Quat = [Math.cos(half), 0, Math.sin(half), 0];
    return { ...die, y: die.y + cheer.hop * arc(u), q: multiply(spin, die.q) };
  });
}

/**
 * The dice that touch down between the last frame and this one, so each landing
 * can be heard.
 *
 * The hop is scripted, so there is no contact for the solver to report and no
 * impulse to take a volume from, but a die that lands in silence when every
 * other landing in the app makes a noise reads as the sound having broken. The
 * crossing is asked between two times rather than tested at one, because at
 * 60fps a die is only exactly at the ground for an instant no frame is likely
 * to sample.
 */
export function landedBetween(kind: CheerKind, count: number, was: number, now: number): number[] {
  const cheer = CHEERS[kind];
  const down: number[] = [];
  for (let i = 0; i < count; i++) {
    const end = i * cheer.stagger + cheer.span;
    if (was < end && now >= end) down.push(i);
  }
  return down;
}

/* Small maths */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The short way round between two rotations.
 *
 * Negated where the two point away from each other: a quaternion and its
 * negation are the same rotation, and interpolating towards the wrong one of
 * them takes a die the long way round, which in a 170ms wind-up is a die that
 * visibly spins backwards on its way into the hand.
 */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let end: Quat = b;
  if (dot < 0) {
    end = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  // Nearly parallel: the sines below both go to zero and the division becomes a
  // ratio of two roundings. Straight-line blend and renormalise, which for
  // rotations this close is the same answer.
  if (dot > 0.9995) {
    const q: Quat = [
      a[0] + (end[0] - a[0]) * t,
      a[1] + (end[1] - a[1]) * t,
      a[2] + (end[2] - a[2]) * t,
      a[3] + (end[3] - a[3]) * t,
    ];
    const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
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

/* The playback rate */

/**
 * How fast the simulated clock runs against the wall clock, and why it is not
 * one.
 *
 * Read the note above about the slow moment first, because this looks like the
 * same mistake and is not. What went wrong there was that the throw *changed
 * speed partway through*: a viewer who has watched dice land in real life spots
 * that instantly and reads it as a dropped frame. This is a single constant
 * applied to every step of every throw, so nothing inside the throw accelerates
 * or decelerates relative to anything else. The throw stays one continuous
 * piece of motion; it is only the size of the thing being watched that changes.
 *
 * Which is the whole argument. `DIE_HALF` fixed the scale by making it real:
 * a 16 mm die under 981 cm/s^2, and it landed like a die instead of like a toy.
 * But a 16 mm die on screen is not being watched from where you watch a real
 * one. The tray fills a phone held a foot away, so the dice come to the eye
 * several times larger in angle than dice on a table do, and magnified real
 * motion looks fast: it is exactly why a filmed miniature has to be slowed to
 * read as full size, and the correction there is the square root of the
 * magnification. That puts this somewhere between 0.6 and 0.7 on a phone and
 * lower on a laptop, where the tray is bigger still.
 *
 * Half, then, which is a little slower than the arithmetic asks for and lands
 * a typical throw at about two seconds rather than one. It buys the second
 * thing a real throw has and a blink does not: time to watch a die come off a
 * wall and roll itself out.
 *
 * **It changes nothing about what the dice do.** The steps are the same steps
 * in the same order, `PHYS.STEP` is untouched, and the faces and resting places
 * are the ones the throw was reported with. It costs no version bump for the
 * same reason the wind-up does not: see the top of this file.
 */
export const PLAYBACK = 0.5;
