import { UPRIGHT, faceUp, type Quat, type Tray } from './dice.js';
import { die } from './random.js';
import type { Rng } from '../types.js';

/**
 * A throw of the dice: how it was thrown, and where it went.
 *
 * Three games roll dice and two of them throw them into a tray, so this is one
 * type rather than two fields invented separately.
 *
 * ── Why the throw is on the wire, and who computed it ─────────────────
 *
 * The dice are simulated and the number a die shows is read off the cube when
 * it stops, so the simulation is what decides and every client has to be able
 * to run it. This is what makes that possible: the seed, the flick that threw
 * them and where they were standing when it happened are between them the
 * whole input.
 *
 * What changed, and it is the largest architectural decision in this app: the
 * simulation is **Rapier, and it runs on the client**. The server no longer
 * throws the dice, because the thing that throws them is now a WebAssembly
 * physics engine in a browser. The client that rolled computes the whole throw
 * before it sends anything, and sends what happened; the reducer checks the
 * shape and keeps it. See `readThrow` for exactly how much is checked, and
 * `src/client/dice3d/engine.ts` for what was traded away.
 *
 * The consequence, stated plainly because it is easy to forget: **a modified
 * client can choose its own dice.** That was accepted deliberately in exchange
 * for real cubes. Nothing downstream should be written as though the faces
 * were trustworthy.
 *
 * ── Why `n` exists ────────────────────────────────────────────────────
 *
 * Two throws running can produce the same faces from the same places, and dice
 * that sat still on the second one would read as broken. It is the same lesson
 * `spins` taught the Wheel.
 */
export interface Toss extends Flick {
  /** Counts up for the life of the game. Never reset, never reused. */
  n: number;
  /**
   * Drives everything random in the throw: where the dice start, how they are
   * turned, how hard they go.
   *
   * The **client's**, now, and drawn by whoever rolled. It used to be the
   * server's and drawn after the flick arrived, which is what made a throw
   * impossible to aim. That protection is gone with server authority; what it
   * still buys is that the other player replays exactly this throw rather than
   * inventing a different one.
   */
  seed: number;
  /** Where the dice were standing when it was thrown. */
  from: Rest3[];
  /** And where they came to rest, which is where the next throw starts. */
  rest: Rest3[];
}

/**
 * Where a die came to rest: on the tray, at a height, turned some way.
 *
 * This used to be `{ x, y, o }`, where `o` indexed the 24 ways a cube can sit
 * square — which was enough, because the old solver met dice as squares in a
 * plane and a die could only ever finish flat on the floor. A die can now
 * finish on top of another one, or leaning on a wall, so it needs a height and
 * a full rotation and cannot be one of 24.
 *
 * In **tray units**, origin at the tray's top-left corner, `up` being height
 * above the floor. Not pixels: a tray is about 320px on a phone and twice that
 * on a laptop, and a throw measured in pixels would land on different faces on
 * the two of them.
 */
export interface Rest3 {
  x: number;
  y: number;
  up: number;
  /** `[w, x, y, z]`, matching `Quat` in `dice.ts`. */
  q: Quat;
}

/**
 * How the dice were thrown, as measured by the hand that threw them.
 *
 * Still clamped, and the clamp still earns its place even though a client that
 * can lie about the faces has no need to lie about the flick: a velocity of
 * 1e308 would put the dice through the wall on the first step, on *every*
 * device in the room, and the other player's client is not the one that chose
 * to send it.
 */
export interface Flick {
  /**
   * The throw, in tray widths a second. Zero for a tap, which is a plain throw
   * with no direction of its own.
   *
   * Widths rather than pixels, and both axes scale by the width since a tray's
   * shape is fixed.
   */
  x: number;
  y: number;
  /**
   * Where on the tray the hand was when it let go, as a fraction of the tray's
   * own width and height: `0,0` is the top-left corner and `1,1` the bottom
   * right.
   *
   * **Absent for a tap**, and absent rather than centred on purpose — a tap
   * has no aim, and a tap recorded as "aimed at the middle" would be a
   * different throw from the one the player made. `openThrow` reads the two
   * together: with a speed, this is where the dice come *in* from; without
   * one, it is not consulted at all.
   *
   * A fraction rather than tray units so that the number means the same thing
   * on a phone and on a laptop, which is the same reason everything else here
   * is measured in widths.
   */
  ax?: number;
  ay?: number;
}

/**
 * The whole result of a throw, as the client that ran it reports it.
 *
 * `faces` is redundant with `rest` — the face is a function of the rotation,
 * and `src/client/dice3d/engine.ts` computes it from there. It is sent anyway
 * because the reducer must not have to know how a cube is read to score a
 * hand, and because the two disagreeing is a thing a test can catch.
 */
export interface ThrownDice extends Flick {
  seed: number;
  faces: number[];
  rest: Rest3[];
}

/**
 * As hard as a die can be thrown: eight tray widths a second, which is faster
 * than a thumb can move and well short of a number that would need the solver
 * to start worrying about tunnelling.
 */
export const MAX_FLICK = 8;

/** How far out of the tray a reported die is still believed. */
const SLOP = 2;

function real(value: unknown, low: number, high: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, low), high)
    : 0;
}

/** A number in range, or undefined — for a field whose absence means something. */
function maybe(value: unknown, low: number, high: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, low), high)
    : undefined;
}

/** A flick as it arrived from a client, which is to say: anything at all. */
export function readFlick(value: unknown): Flick {
  if (!value || typeof value !== 'object') return { x: 0, y: 0 };
  const sent = value as Partial<Flick>;
  const flick: Flick = {
    x: real(sent.x, -MAX_FLICK, MAX_FLICK),
    y: real(sent.y, -MAX_FLICK, MAX_FLICK),
  };
  // Both or neither: half an aim is not one, and a throw that knew where it
  // came from on one axis only would be aimed at a corner nobody flicked from.
  const ax = maybe(sent.ax, 0, 1);
  const ay = maybe(sent.ay, 0, 1);
  if (ax !== undefined && ay !== undefined) {
    flick.ax = ax;
    flick.ay = ay;
  }
  return flick;
}

/** One resting die off the wire, or null if it is not one. */
function readRest(value: unknown, tray: Tray): Rest3 | null {
  if (!value || typeof value !== 'object') return null;
  const sent = value as Partial<Rest3>;
  const q = sent.q;
  if (!Array.isArray(q) || q.length !== 4 || !q.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }
  // A rotation has to be one. Rejected rather than normalised: a quaternion
  // that is not a unit is not a near miss, it is a client that is not running
  // the code this expects, and guessing what it meant helps nobody.
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(len > 0.99 && len < 1.01)) return null;

  const { x, y, up } = sent;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof up !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(up)) return null;
  // Inside the tray it was thrown into, with a little slop for the moment a
  // die is resting against a wall and the solver has it a hair outside.
  if (x < -SLOP || x > tray.w + SLOP) return null;
  if (y < -SLOP || y > tray.h + SLOP) return null;
  if (up < -SLOP || up > tray.h) return null;

  return { x, y, up, q: [q[0], q[1], q[2], q[3]] as Quat };
}

/**
 * A throw as it arrived from a client: anything at all, until this says so.
 *
 * Returns null for anything it does not fully believe, and the caller's job is
 * then to roll the dice itself — see `fallbackThrow`. Null is not an error to
 * show a player: a client with no WebAssembly, a keyboard-only roll, or a
 * build older than this one all arrive here, and all of them should still be
 * able to play a turn.
 *
 * **What this does not check is the part that matters.** It cannot tell a real
 * throw from a made-up one, because the only thing that could is running the
 * simulation, and the server has no simulation any more. Five sixes and a
 * plausible set of resting places will pass. That is the accepted cost of
 * client-side physics, and the reason it is safe to say so here is that saying
 * nothing would not make it less true.
 */
export function readThrow(value: unknown, count: number, tray: Tray): ThrownDice | null {
  if (!value || typeof value !== 'object') return null;
  const sent = value as Partial<ThrownDice>;

  if (typeof sent.seed !== 'number' || !Number.isFinite(sent.seed)) return null;
  const seed = Math.abs(Math.trunc(sent.seed)) % 0x1_0000_0000;

  if (!Array.isArray(sent.faces) || sent.faces.length !== count) return null;
  const faces: number[] = [];
  for (const face of sent.faces) {
    if (!Number.isInteger(face) || face < 1 || face > 6) return null;
    faces.push(face);
  }

  if (!Array.isArray(sent.rest) || sent.rest.length !== count) return null;
  const rest: Rest3[] = [];
  for (const one of sent.rest) {
    const at = readRest(one, tray);
    if (!at) return null;
    rest.push(at);
  }

  return { ...readFlick(sent), seed, faces, rest };
}

/**
 * Dice in a row across the middle of the tray, lying flat and square.
 *
 * Where the dice are before anyone has thrown them, and where a throw the
 * server had to invent for itself puts them.
 */
export function row3(tray: Tray, count: number, faces?: readonly number[]): Rest3[] {
  const gap = tray.die * 0.17;
  const span = count * tray.die + (count - 1) * gap;
  const x0 = (tray.w - span) / 2 + tray.die / 2;
  return Array.from({ length: count }, (_, i) => ({
    x: x0 + i * (tray.die + gap),
    y: tray.h / 2,
    up: 0,
    // Turned to show the number it is meant to be showing. `UPRIGHT` and
    // `faceUp` are the same fact from opposite ends, so a die placed here is
    // read back as the face it was placed for.
    q: (faces ? (UPRIGHT[faces[i]] ?? UPRIGHT[1]) : UPRIGHT[1]) as Quat,
  }));
}

/**
 * The dice, rolled by whoever is holding the rules, and laid out in a row.
 *
 * The path taken when a client sends no throw this believes: no WebAssembly,
 * a build older than this one, a keyboard-only roll, or a `readThrow` that
 * refused what arrived. There is no animation to replay — `seed` is zero and
 * the dice are simply *there* — and that is the honest result, because nothing
 * simulated this and pretending otherwise would put a tumble on screen that
 * did not decide anything.
 *
 * It is deliberately still here after the physics left. A game whose only way
 * to roll is "the client managed to load a physics engine" is a game that
 * cannot be played on a device that did not.
 */
export function fallbackThrow(
  tray: Tray,
  count: number,
  rng: Rng,
): { faces: number[]; rest: Rest3[]; seed: number } {
  const faces = Array.from({ length: count }, () => die(rng));
  return { faces, rest: row3(tray, count, faces), seed: 0 };
}

/**
 * The next throw, from whatever the client sent.
 *
 * The reducer's entry point, and the only place a `Toss` is built. Both dice
 * games call it and neither of them needs to know whether the throw on screen
 * was simulated by a browser or invented here.
 *
 * **Kept dice are overruled, not trusted.** A die being held keeps the place
 * and the rotation it already had, whatever the client reported for it. This
 * is the one part of a throw the rules still know the answer to, so it is the
 * one part still enforced — and with the faces themselves now unverifiable it
 * is worth more than it was, not less: a client that lies about a held die is
 * changing a number the player already committed to.
 */
/**
 * Where the dice are standing before a throw.
 *
 * Exported because **both sides have to agree about it**. The client runs the
 * throw to report it and then runs it again to animate it, and the reducer
 * runs nothing but stores where it started; feed those two different starting
 * places and the same seed produces two different throws. One function, called
 * from both, is the cheapest way for that not to happen quietly.
 */
export function startingFrom(previous: Toss | null, tray: Tray, count: number): Rest3[] {
  return previous?.rest?.length === count ? previous.rest : row3(tray, count);
}

export function nextToss(opts: {
  previous: Toss | null;
  /** The `throw` field off the move. Anything at all, until `readThrow` runs. */
  sent: unknown;
  tray: Tray;
  count: number;
  rng: Rng;
  held?: readonly boolean[];
}): { toss: Toss; faces: number[] } {
  const { previous, sent, tray, count, rng, held } = opts;
  const from = startingFrom(previous, tray, count);

  const believed = readThrow(sent, count, tray);
  const thrown = believed ?? { ...fallbackThrow(tray, count, rng), x: 0, y: 0 };

  const faces = thrown.faces.slice();
  const rest = thrown.rest.map((r) => ({ ...r, q: [...r.q] as unknown as Quat }));
  for (let i = 0; i < count; i++) {
    if (!held?.[i]) continue;
    rest[i] = { ...from[i], q: [...from[i].q] as unknown as Quat };
    faces[i] = faceUp(from[i].q);
  }

  return {
    toss: {
      n: (previous?.n ?? 0) + 1,
      seed: thrown.seed,
      // The flick entire, aim included: a stored throw is re-run rather than
      // replayed frame by frame, and a re-run missing where the dice came in
      // from lands them somewhere else.
      ...readFlick(thrown),
      from: from.map((r) => ({ ...r, q: [...r.q] as unknown as Quat })),
      rest,
    },
    faces,
  };
}
