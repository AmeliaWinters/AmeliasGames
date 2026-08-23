/**
 * A throw of the dice, drawn as a contact sheet you can actually look at.
 *
 * ## Why this exists
 *
 * The dice are the one thing in this project whose quality is a matter of how
 * it *looks*, and the one thing that cannot be looked at. `npm test` proves the
 * throw is fair, reproducible and finite; none of that says whether it reads as
 * dice being thrown. The in-app Browser pane cannot help either — it runs as a
 * hidden document, so `requestAnimationFrame` never fires and screenshots come
 * back "not compositing frames". A throw is 125 frames of animation that
 * nothing in the toolchain will play.
 *
 * So it is drawn here instead. `dice.ts` is pure, seeded and dependency-free,
 * which means it runs perfectly well in Node — and the projection the browser
 * applies is only `perspective: 900px` about the tray's centre. Run the real
 * simulation, project it the same way, and write a PNG. What comes out is what
 * the player sees, one panel per sampled frame, time running left to right.
 *
 * This is not decoration. Retuning the throw once produced numbers that all
 * moved the right way — travel up three quarters, wall contacts doubled — while
 * the dice were in fact using a third of the tray and dying in the corner they
 * started beside, because the tap was aimed up a tray twice as wide as it is
 * tall. No test caught it. The first sheet made it obvious.
 *
 * ## Using it
 *
 *     npm run render:throw
 *
 * PNGs land in `preview/` (gitignored). Pass `--old` to draw the constants as
 * they were before a change, for a before-and-after from the same seed:
 *
 *     npm run render:throw -- --old
 *
 * The numbers underneath each run are printed too, because "looks better" and
 * "measures better" should be checked to be the same claim.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PALETTE, Raster, rgba } from './png.mjs';
import { P, open, row, step, turn, type Tray } from '../src/shared/games/dice.js';
import { YAHTZEE_TRAY } from '../src/shared/games/yahtzeeDisplay.js';
import { BACKGAMMON_TRAY } from '../src/shared/games/backgammon.js';

/** `.dice-tray { perspective: 900px }`. The one number the drawing borrows. */
const PERSPECTIVE = 900;
/** A tray about the width of one on a 390px phone. */
const TRAY_PX = 300;
const PANEL_GAP = 8;

/**
 * The die's own colours, which are literals in `styles.css` for the reason
 * given there: this is the colour of an object under a light, not of the
 * interface, so it does not follow the palette.
 */
const CREAM = rgba('#f5f1e8');
const TONE: Record<number, ReturnType<typeof rgba>> = {
  1: CREAM,
  6: CREAM,
  3: rgba('#e6ded0'),
  4: rgba('#e6ded0'),
  2: rgba('#d7cdba'),
  5: rgba('#d7cdba'),
};
const EDGE = rgba('#3d3d47');

/**
 * The six faces in the cube's own frame, placed to match `FACE_AXES` in
 * `dice.ts` — x right, y down, z towards the player — with an in-plane basis
 * each so the pips can be laid on them. Opposite faces sum to seven.
 */
const FACES = [
  { num: 1, n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { num: 6, n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  { num: 2, n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { num: 5, n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { num: 3, n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { num: 4, n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
] as const;

/** Pip positions on a face's own 3×3, in units of half the face. */
const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

type Vec = readonly [number, number, number];
const add = (a: Vec, b: Vec, s = 1): Vec => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

interface Snapshot {
  x: number;
  y: number;
  q: readonly [number, number, number, number];
  air: number;
}

/**
 * One die, projected and painted.
 *
 * The airborne lift is a *uniform* 3D scale about the die's own middle, which
 * is what `scale3d` means in `DiceTray.tsx`. It was a plain `scale()` for a
 * while, which scales x and y and leaves z — so a die coming off the table
 * grew wider and taller without growing deeper and stopped being a cube.
 * Drawing it the same way here is what would show that again.
 */
function drawDie(art: Raster, ox: number, oy: number, tray: Tray, body: Snapshot) {
  const k = TRAY_PX / tray.w;
  const trayH = TRAY_PX * (tray.h / tray.w);
  const lift = 1 + 0.11 * (body.air / P.AIRBORNE);
  const half = ((tray.die * k) / 2) * lift;
  const centre: Vec = [body.x * k, body.y * k, 0];
  const eye: Vec = [TRAY_PX / 2, trayH / 2, PERSPECTIVE];

  /** The perspective divide, about the tray's centre, exactly as CSS does it. */
  const project = (p: Vec): [number, number] => {
    const s = PERSPECTIVE / (PERSPECTIVE - p[2]);
    return [ox + TRAY_PX / 2 + (p[0] - TRAY_PX / 2) * s, oy + trayH / 2 + (p[1] - trayH / 2) * s];
  };

  const visible = [];
  for (const face of FACES) {
    const n = turn(body.q, face.n as unknown as Vec) as unknown as Vec;
    const u = turn(body.q, face.u as unknown as Vec) as unknown as Vec;
    const v = turn(body.q, face.v as unknown as Vec) as unknown as Vec;
    const fc = add(centre, n, half);
    // Back-face cull against the eye rather than against the screen, since a
    // die at the edge of the tray is seen at a steep angle.
    if (dot(n, [eye[0] - fc[0], eye[1] - fc[1], eye[2] - fc[2]]) <= 0) continue;
    visible.push({ z: fc[2], num: face.num, fc, u, v });
  }
  // Painter's algorithm. Five of six faces are culled most of the time, but
  // near edge-on two survive and the nearer one has to win.
  visible.sort((a, b) => a.z - b.z);

  for (const face of visible) {
    const corners: Array<[number, number]> = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(
      ([a, b]) => project(add(add(face.fc, face.u, a * half), face.v, b * half)),
    );
    art.polygon(corners, TONE[face.num]);
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      const steps = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let s = 0; s <= steps; s++) {
        art.rect(a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps, 1, 1, EDGE);
      }
    }
    for (const [pu, pv] of PIPS[face.num]) {
      const p = project(add(add(face.fc, face.u, pu * half * 0.58), face.v, pv * half * 0.58));
      art.circle(p[0], p[1], Math.max(0.8, half * 0.13), PALETTE.ground);
    }
  }
}

/** Run one throw all the way out, keeping every frame of it. */
function record(tray: Tray, from: ReturnType<typeof row>, n: number, seed: number) {
  const toss = {
    x: 0,
    y: 0,
    n,
    seed,
    spin: [0, 5, 11, 17, 22].slice(0, from.length),
    from,
    rest: from,
  };
  const world = open({ tray, toss, from });
  const frames: Snapshot[][] = [];
  const bin: Array<{ impulse: number; wall: boolean }> = [];
  let moving = 1;
  let steps = 0;
  let wall = 0;
  let travel = 0;
  while (moving > 0 && steps < 500) {
    frames.push(world.bodies.map((b) => ({ x: b.x, y: b.y, q: b.q, air: b.air })));
    const before = world.bodies.map((b) => ({ x: b.x, y: b.y }));
    bin.length = 0;
    moving = step(world, bin);
    world.bodies.forEach((b, i) => {
      travel += Math.hypot(b.x - before[i].x, b.y - before[i].y);
    });
    for (const c of bin) if (c.wall) wall++;
    steps++;
  }
  frames.push(world.bodies.map((b) => ({ x: b.x, y: b.y, q: b.q, air: 0 })));
  return {
    frames,
    rest: world.bodies.map((b) => ({ x: b.x, y: b.y, o: 0 })),
    ms: Math.round(steps * P.STEP * 1000),
    wall,
    travel: travel / world.bodies.length / tray.w,
  };
}

/** A sheet: one row per throw, one panel per sampled frame. */
function sheet(tray: Tray, count: number, throws: number, cols: number, seed: number, file: string) {
  const trayH = Math.round(TRAY_PX * (tray.h / tray.w));
  const art = new Raster(
    PANEL_GAP + cols * (TRAY_PX + PANEL_GAP),
    PANEL_GAP + throws * (trayH + PANEL_GAP),
  );
  art.fill(PALETTE.hole);

  let from = row(tray, count);
  const runs = [];
  for (let t = 0; t < throws; t++) {
    const run = record(tray, from, t + 1, (seed + t * 7919) >>> 0);
    runs.push(run);
    const oy = PANEL_GAP + t * (trayH + PANEL_GAP);
    for (let i = 0; i < cols; i++) {
      const fi = Math.min(run.frames.length - 1, Math.round((i / (cols - 1)) * (run.frames.length - 1)));
      const ox = PANEL_GAP + i * (TRAY_PX + PANEL_GAP);
      art.rect(ox, oy, TRAY_PX, trayH, PALETTE.board);
      art.rect(ox, oy, TRAY_PX, 1, EDGE);
      art.rect(ox, oy + trayH - 1, TRAY_PX, 1, EDGE);
      art.rect(ox, oy, 1, trayH, EDGE);
      art.rect(ox + TRAY_PX - 1, oy, 1, trayH, EDGE);
      for (const body of run.frames[fi]) drawDie(art, ox, oy, tray, body);
    }
    from = run.rest;
  }

  writeFileSync(file, art.toPNG());
  const avg = (pick: (r: (typeof runs)[number]) => number) =>
    runs.reduce((s, r) => s + pick(r), 0) / runs.length;
  console.log(
    file.padEnd(34),
    `die ${String(tray.die).padStart(4)}`,
    `| travel ${avg((r) => r.travel).toFixed(2)} tray-widths`,
    `| wall ${(avg((r) => r.wall) / count).toFixed(1)}/die`,
    `| rest ${Math.round(avg((r) => r.ms))}ms`,
  );
}

/**
 * The constants as they were before the throw was retuned, so a change can be
 * argued from a before-and-after rather than asserted. Kept here and not in
 * `dice.ts`, which should only ever hold the numbers actually in use.
 */
const BEFORE = { LIN_DAMP: 2.4, DEADLINE: 620, HARD_STOP: 1150, THROW: 1.0, FAN: 0 };

const out = 'preview';
mkdirSync(out, { recursive: true });
const old = process.argv.includes('--old');
if (old) Object.assign(P as unknown as Record<string, number>, BEFORE);
const tag = old ? '-before' : '';
const yahtzee = old ? { ...YAHTZEE_TRAY, die: 10 } : YAHTZEE_TRAY;
const backgammon = old ? { ...BACKGAMMON_TRAY, die: 12 } : BACKGAMMON_TRAY;

sheet(yahtzee, 5, 2, 5, 20260823, `${out}/yahtzee${tag}.png`);
sheet(backgammon, 2, 2, 5, 20260823, `${out}/backgammon${tag}.png`);
sheet(backgammon, 4, 2, 5, 20260823, `${out}/backgammon-double${tag}.png`);
