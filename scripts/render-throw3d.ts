/**
 * Draw a 3D throw to a PNG, because it cannot be watched anywhere else.
 *
 * The successor to the orthographic `render-throw.ts`, and it exists for the
 * same reason that one did: a throw is a couple of hundred frames of animation, the Browser
 * pane runs as a hidden document where `requestAnimationFrame` never fires,
 * and measurement has already been confidently wrong about these dice once —
 * a retune moved every number the right way while the dice were using a fifth
 * of the tray and dying in the corner they started beside. One sheet made it
 * obvious.
 *
 * What changed is the camera. The old sheet was orthographic and exact,
 * because the app was orthographic too: `.dice-tray` had no `perspective`, so
 * dropping z reproduced the shipped projection precisely rather than
 * approximating it. These dice are drawn by three.js through a real camera, so
 * this is now an *approximation* — same geometry, same physics, a simpler
 * shading model. It is here to answer "do the dice go anywhere, tumble, and
 * end up spread out", which it answers well. It is not here to check a
 * material or a shadow's softness; open the app for that.
 *
 * The camera is steep and long-lensed on purpose — the same near-orthographic
 * read the app uses — but tilted enough that height is visible, which is the
 * whole thing the old sheet could not show.
 *
 *     npm run render:throw
 */

import { PALETTE, Raster, rgba } from './png.mjs';
import { initDice, openThrow, stepThrow, disposeThrow, PHYS, DIE_HALF, type Rest3, type Hit } from '../src/client/dice3d/engine.js';
import type { Tray } from '../src/shared/games/dice.js';
import { YAHTZEE_TRAY } from '../src/shared/games/yahtzeeDisplay.js';
import { BACKGAMMON_TRAY } from '../src/shared/games/backgammon.js';

const TRAY_PX = Number(process.env.TRAY_PX ?? 300);
const PANEL_GAP = 8;

/**
 * The die's own colours, which are literals in `styles.css` for the reason
 * given there: this is the colour of an object under a light, not of the
 * interface, so it does not follow the palette.
 */
const CREAM = rgba('#f5f1e8');
const EDGE = rgba('#3d3d47');
const SHADOW = rgba('#000000b3');

type Vec = readonly [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec, b: Vec, s = 1): Vec => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec): Vec => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};
const spin = (q: readonly [number, number, number, number], v: Vec): Vec => {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
};

/**
 * The six faces by the direction they point in the die's own frame, matching
 * `FACE_AXES` in `engine.ts` — y up. `u` is an in-plane axis; the other is
 * derived as `n × u` so the two cannot drift apart.
 */
const FACES = [
  { num: 1, n: [0, 1, 0] as Vec, u: [1, 0, 0] as Vec },
  { num: 6, n: [0, -1, 0] as Vec, u: [1, 0, 0] as Vec },
  { num: 2, n: [0, 0, 1] as Vec, u: [1, 0, 0] as Vec },
  { num: 5, n: [0, 0, -1] as Vec, u: [-1, 0, 0] as Vec },
  { num: 3, n: [1, 0, 0] as Vec, u: [0, 0, -1] as Vec },
  { num: 4, n: [-1, 0, 0] as Vec, u: [0, 0, 1] as Vec },
];

/** Pip positions on a face's own 3×3, in units of half the face. */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

/**
 * A long lens, high and slightly in front.
 *
 * Long because a wide one bends the tray's straight edges into something that
 * reads as a fisheye toy; steep because the game is played by reading the tops
 * of the dice and a low camera hides them behind each other. The remaining
 * tilt is the entire reason this sheet exists rather than the old one.
 */
const PITCH = (68 * Math.PI) / 180;
const LENS = 3.2;

function camera(tray: Tray, k: number) {
  const w = tray.w / k;
  const h = tray.h / k;
  const dist = Math.max(w, h) * LENS;
  const eye: Vec = [0, Math.sin(PITCH) * dist, Math.cos(PITCH) * dist];
  const fwd = norm(sub([0, 0, 0], eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  // Chosen so the tray fills the panel: solve the scale from the tray's own
  // corners rather than from a field of view nobody would be able to picture.
  let extent = 0;
  for (const cx of [-w / 2, w / 2]) {
    for (const cz of [-h / 2, h / 2]) {
      const p = sub([cx, 0, cz], eye);
      extent = Math.max(extent, Math.abs(dot(p, right) / dot(p, fwd)));
    }
  }
  const f = TRAY_PX / 2 / extent;

  return (p: Vec): [number, number, number] => {
    const d = sub(p, eye);
    const depth = dot(d, fwd);
    const s = f / depth;
    return [dot(d, right) * s, -dot(d, up) * s, depth];
  };
}

type Project = ReturnType<typeof camera>;

/** The shadow a die casts straight down, drawn on the tray floor. */
function drawShadow(art: Raster, ox: number, oy: number, project: Project, at: Vec) {
  const rise = Math.max(0, at[1] - DIE_HALF);
  const ground: Vec = [at[0], 0.02, at[2]];
  const [sx, sy, depth] = project(ground);
  // Spread and faded as it rises, which is the cue that says "this die is in
  // the air" in a still frame where nothing is moving.
  const grow = Math.min(1, rise / (DIE_HALF * 6));
  const [ex] = project(add(ground, [DIE_HALF, 0, 0]));
  const radius = Math.abs(ex - sx) * (1 + grow * 0.5);
  if (depth <= 0) return;
  art.circle(ox + sx, oy + sy, radius, [
    SHADOW[0],
    SHADOW[1],
    SHADOW[2],
    SHADOW[3] * (0.85 - grow * 0.45),
  ]);
}

/** One die, projected and painted. */
function drawDie(art: Raster, ox: number, oy: number, project: Project, at: Vec, q: readonly [number, number, number, number], eye: Vec) {
  const visible: Array<{ depth: number; num: number; pts: Array<[number, number]>; pips: Array<[number, number]>; shade: number }> = [];

  for (const face of FACES) {
    const n = spin(q, face.n);
    const u = spin(q, face.u);
    const v = cross(n, u);
    const fc = add(at, n, DIE_HALF);
    // Backface cull against a real eye position, not against a fixed axis:
    // the camera is close enough that a die at the far corner is seen from a
    // meaningfully different direction than one under it.
    if (dot(n, norm(sub(eye, fc))) <= 0.02) continue;

    const corner = (a: number, b: number) => add(add(fc, u, a * DIE_HALF), v, b * DIE_HALF);
    const projected = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([a, b]) => project(corner(a, b)));
    if (projected.some((p) => p[2] <= 0)) continue;

    // A flat lambert against a light over the player's shoulder. Enough to
    // tell the three visible faces of a cube apart, which is all the shading
    // in a line drawing has to do.
    const light = norm([0.35, 1, 0.45] as Vec);
    const shade = 0.62 + 0.38 * Math.max(0, dot(n, light));

    visible.push({
      depth: projected.reduce((a, p) => a + p[2], 0) / 4,
      num: face.num,
      pts: projected.map((p) => [ox + p[0], oy + p[1]] as [number, number]),
      pips: PIPS[face.num].map(([pu, pv]) => {
        const p = project(add(add(fc, u, pu * DIE_HALF * 0.58), v, pv * DIE_HALF * 0.58));
        return [ox + p[0], oy + p[1]] as [number, number];
      }),
      shade,
    });
  }

  // Painter's algorithm, far to near. Three faces of a cube are visible at
  // once and a nearly edge-on one has to lose to the face in front of it.
  visible.sort((a, b) => b.depth - a.depth);

  for (const face of visible) {
    art.polygon(face.pts, [
      Math.round(CREAM[0] * face.shade),
      Math.round(CREAM[1] * face.shade),
      Math.round(CREAM[2] * face.shade),
      255,
    ]);
    for (let i = 0; i < face.pts.length; i++) {
      const a = face.pts[i];
      const b = face.pts[(i + 1) % face.pts.length];
      const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let s = 0; s <= steps; s++) {
        art.rect(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps, 1, 1, EDGE);
      }
    }
    // A pip radius from the face's own projected size, so a die at the far end
    // of the tray gets smaller pips along with everything else about it.
    const across = Math.hypot(face.pts[1][0] - face.pts[0][0], face.pts[1][1] - face.pts[0][1]);
    for (const [px, py] of face.pips) art.circle(px, py, Math.max(0.7, across * 0.075), PALETTE.ground);
  }
}

interface Frame {
  dice: Array<{ at: Vec; q: readonly [number, number, number, number] }>;
}

/** Run one throw all the way out, keeping every frame of it. */
function record(tray: Tray, count: number, seed: number, from: Rest3[] | null) {
  const live = openThrow({ tray, count, seed, flick: { x: 0, y: 0 }, from });
  const k = live.k;
  const frames: Frame[] = [];
  const bin: Hit[] = [];
  let moving = 1;
  let walls = 0;
  let travel = 0;
  let last: Vec[] | null = null;

  const snap = (): Frame => ({
    dice: live.bodies.map((b) => {
      const t = b.translation();
      const r = b.rotation();
      return { at: [t.x, t.y, t.z] as Vec, q: [r.w, r.x, r.y, r.z] as const };
    }),
  });

  while (moving > 0) {
    const f = snap();
    frames.push(f);
    if (last) {
      f.dice.forEach((d, i) => {
        travel += Math.hypot(d.at[0] - last![i][0], d.at[2] - last![i][2]);
      });
    }
    last = f.dice.map((d) => d.at);
    moving = stepThrow(live, bin);
    for (const hit of bin) if (hit.wall) walls++;
  }
  frames.push(snap());

  const rest: Rest3[] = live.bodies.map((b) => {
    const t = b.translation();
    const r = b.rotation();
    return {
      x: (t.x + tray.w / k / 2) * k,
      y: (t.z + tray.h / k / 2) * k,
      up: Math.max(0, (t.y - DIE_HALF) * k),
      q: [r.w, r.x, r.y, r.z] as const,
    };
  });
  const xs = rest.map((r) => r.x);
  const out = {
    frames,
    rest,
    k,
    steps: live.steps,
    ms: Math.round(live.steps * PHYS.STEP * 1000),
    walls,
    travel: (travel * k) / count / tray.w,
    span: (Math.max(...xs) - Math.min(...xs)) / tray.w,
  };
  disposeThrow(live);
  return out;
}

/** A sheet: one row per throw, one panel per sampled frame. */
async function sheet(tray: Tray, count: number, throws: number, cols: number, seed: number, file: string) {
  const trayH = Math.round(TRAY_PX * (tray.h / tray.w));
  const art = new Raster(
    cols * (TRAY_PX + PANEL_GAP) + PANEL_GAP,
    throws * (trayH + PANEL_GAP) + PANEL_GAP,
  );
  art.fill(PALETTE.ground);

  let from: Rest3[] | null = null;
  const notes: string[] = [];

  for (let t = 0; t < throws; t++) {
    const shot = record(tray, count, seed + t * 7919, from);
    const project = camera(tray, shot.k);
    const dist = Math.max(tray.w / shot.k, tray.h / shot.k) * LENS;
    const eye: Vec = [0, Math.sin(PITCH) * dist, Math.cos(PITCH) * dist];
    const oy = PANEL_GAP + t * (trayH + PANEL_GAP);

    for (let c = 0; c < cols; c++) {
      const ox = PANEL_GAP + c * (TRAY_PX + PANEL_GAP);
      // Sampled quadratically, so the panels bunch where the action is: a
      // throw is mostly over in its first third and evenly spaced frames spend
      // most of the sheet on dice that have already stopped.
      const at = Math.min(shot.frames.length - 1, Math.round(((c / (cols - 1)) ** 2) * (shot.frames.length - 1)));
      const frame = shot.frames[at];

      art.rect(ox, oy, TRAY_PX, trayH, PALETTE.board);
      const cx = ox + TRAY_PX / 2;
      const cy = oy + trayH / 2;
      for (const die of frame.dice) drawShadow(art, cx, cy, project, die.at);
      // Far to near, or a die at the back paints over the one in front of it.
      const order = frame.dice
        .map((d, i) => ({ i, depth: project(d.at)[2] }))
        .sort((a, b) => b.depth - a.depth);
      for (const { i } of order) drawDie(art, cx, cy, project, frame.dice[i].at, frame.dice[i].q, eye);
    }

    notes.push(
      `throw ${t + 1}: ${shot.ms}ms (${shot.steps} steps), travel ${shot.travel.toFixed(2)} trays, ` +
        `span ${(shot.span * 100).toFixed(0)}%, ${shot.walls} wall contacts`,
    );
    from = shot.rest;
  }

  const fs = await import('node:fs/promises');
  await fs.mkdir('preview', { recursive: true });
  await fs.writeFile(`preview/${file}`, art.toPNG());
  console.log(`preview/${file}`);
  for (const note of notes) console.log(`  ${note}`);
}

await initDice();
if (process.env.BIG) {
  await sheet(YAHTZEE_TRAY, 5, 4, 4, 1234, 'yahtzee3d-big.png');
} else {
  await sheet(YAHTZEE_TRAY, 5, 3, 7, 1234, 'yahtzee3d.png');
  await sheet(BACKGAMMON_TRAY, 2, 3, 7, 99, 'backgammon3d.png');
}
