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
 * applies is nothing at all: the tray has no `perspective`, so a cube under
 * `preserve-3d` is drawn orthographically, straight down. Run the real
 * simulation, drop the height, and write a PNG. What comes out is what the
 * player sees, one panel per sampled frame, time running left to right.
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
 * The die's shadow. Straight down, because the light is: an offset shadow
 * under a camera looking straight down puts the light somewhere the drawing
 * never commits to anywhere else.
 *
 * It is the only thing in an orthographic top-down view that says a die is
 * *above* the table rather than on it — height moves nothing else on screen,
 * which is exactly what orthographic means. Drawn here as well as in the app
 * because the arc is now the thing worth looking at.
 */
const SHADOW = rgba('#000000b3');

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

interface Snapshot {
  x: number;
  y: number;
  /** Height of the die's middle above the floor. `half` when it is lying on it. */
  z: number;
  a: number;
  q: readonly [number, number, number, number];
}

/**
 * The shadow a die casts, drawn before it. Its footprint, spread and faded as
 * the die rises — the one cue for height there is.
 */
function drawShadow(art: Raster, ox: number, oy: number, tray: Tray, body: Snapshot) {
  const k = TRAY_PX / tray.w;
  const rest = (tray.die / 2) * k;
  // The same numbers `DiceTray` writes, so the sheet is the app and not a
  // second opinion about it: out from under the die by a third of a die per
  // die of height, capped at two, spreading and fading as it goes.
  const rise = Math.min(1, Math.max(0, (body.z - tray.die / 2) / tray.die) / 2);
  const off = rise * tray.die * 0.3 * k;
  const radius = rest * (1 + rise * 0.3);
  art.circle(
    ox + body.x * k + off,
    oy + body.y * k + off,
    radius,
    [SHADOW[0], SHADOW[1], SHADOW[2], SHADOW[3] * (0.9 - rise * 0.3)],
  );
}

/**
 * One die, projected and painted.
 *
 * Orthographic, straight down, which is what the app does now: no perspective
 * on the tray, so a die at the edge is seen exactly as square as one in the
 * middle and its height moves it not at all. The whole of the projection is
 * dropping z, and the whole of the camera is that the eye is at infinity
 * along it.
 */
function drawDie(art: Raster, ox: number, oy: number, tray: Tray, body: Snapshot) {
  const k = TRAY_PX / tray.w;
  const half = (tray.die * k) / 2;
  const centre: Vec = [body.x * k, body.y * k, body.z * k];

  const project = (p: Vec): [number, number] => [ox + p[0], oy + p[1]];

  const visible = [];
  for (const face of FACES) {
    const n = turn(body.q, face.n as unknown as Vec) as unknown as Vec;
    const u = turn(body.q, face.u as unknown as Vec) as unknown as Vec;
    const v = turn(body.q, face.v as unknown as Vec) as unknown as Vec;
    const fc = add(centre, n, half);
    // The eye is at infinity, so one direction culls every face on the die.
    if (n[2] <= 0) continue;
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
    frames.push(world.bodies.map((b) => ({ x: b.x, y: b.y, z: b.z, a: b.a, q: b.q })));
    const before = world.bodies.map((b) => ({ x: b.x, y: b.y }));
    bin.length = 0;
    moving = step(world, bin);
    world.bodies.forEach((b, i) => {
      travel += Math.hypot(b.x - before[i].x, b.y - before[i].y);
    });
    for (const c of bin) if (c.wall) wall++;
    steps++;
  }
  frames.push(world.bodies.map((b) => ({ x: b.x, y: b.y, z: b.z, a: b.a, q: b.q })));
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
      /*
        Time left to right, but not evenly: the panels bunch towards the start
        of the throw, because that is where the throw is. A die is in the air
        for about a sixth of it and lying still for the last third, and an even
        sample spent two panels on dice that had stopped moving and none at all
        on the arc — which is the part with a floor under it now.
      */
      const at = (i / (cols - 1)) ** 2;
      const fi = Math.min(run.frames.length - 1, Math.round(at * (run.frames.length - 1)));
      const ox = PANEL_GAP + i * (TRAY_PX + PANEL_GAP);
      art.rect(ox, oy, TRAY_PX, trayH, PALETTE.board);
      art.rect(ox, oy, TRAY_PX, 1, EDGE);
      art.rect(ox, oy + trayH - 1, TRAY_PX, 1, EDGE);
      art.rect(ox, oy, 1, trayH, EDGE);
      art.rect(ox + TRAY_PX - 1, oy, 1, trayH, EDGE);
      // Every shadow, then every die: a shadow belongs to the table, and one
      // die's shadow falling across another's face would say otherwise.
      for (const body of run.frames[fi]) drawShadow(art, ox, oy, tray, body);
      // Lowest first, so a die passing over another is drawn over it.
      for (const body of [...run.frames[fi]].sort((a, b) => a.z - b.z)) {
        drawDie(art, ox, oy, tray, body);
      }
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
