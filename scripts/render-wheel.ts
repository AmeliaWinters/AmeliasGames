/**
 * Draw the wheel's window to a PNG, for the same reason `render-throw3d.ts`
 * draws a throw: the preview pane is a hidden document and cannot show a
 * moving — or in this case a *clipped* — thing. Measurement said the band was
 * geometrically right while it still looked like a fan of stripes in a card,
 * and one sheet settled it.
 *
 *   npm run render:wheel
 *
 * Four panels, left to right: the wheel a little further round each time, with
 * the flapper laid over at the deflection `flapAngle` gives for that angle. So
 * the sheet shows both the shape of the window and the tick.
 *
 * The geometry is the board's own — `restAngle` and `flapAngle` come straight
 * from `wheelGeometry.ts`, and the arcs are struck from the same RADIUS. What
 * is *not* here is the lettering: this raster has no text, and the question the
 * sheet answers is the silhouette.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PALETTE, Raster, rgba } from "./png.mjs";
import {
  WHEEL,
  WEDGE_ARC,
  SPIN_MIN_SPEED,
  SPIN_MAX_SPEED,
  spinThrow,
  restAfter,
  wedgeUnder,
  wedgeName,
} from "../src/shared/games/wheelDisplay.js";
import {
  RADIUS,
  flapAngle,
  restAngle,
} from "../src/client/games/wheelGeometry.js";

/** The window, in the board's own units — see VIEW_W, CROP, RIM_INNER. */
const VIEW_W = 104;
const CROP = 64;
const RIM_INNER = 55;
const HUB_X = VIEW_W / 2;
const HUB_Y = 110;

/** Pixels to a unit. Big enough that a hairline is a hairline. */
const SCALE = 4;

// The Daylight palette, read off the running app rather than guessed.
const INK = rgba("#14141a");
const BOARD = rgba("#e4e2da");
const SURFACE = rgba("#ffffff");
const ALERT = rgba("#cf3a24");
const ACCENT = rgba("#0a7d9e");
const GROUND = rgba("#f2f1ec");

type Pt = readonly [number, number];

const at = (deg: number, r: number, ox: number, oy: number): Pt => {
  const rad = (deg * Math.PI) / 180;
  return [ox + r * Math.sin(rad) * SCALE, oy - r * Math.cos(rad) * SCALE];
};

/** One wedge, already cut to the band: outer arc out, inner arc back. */
function bandSector(from: number, ox: number, oy: number): Pt[] {
  const steps = 6;
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++)
    out.push(at(from + (WEDGE_ARC * i) / steps, RADIUS, ox, oy));
  for (let i = steps; i >= 0; i--)
    out.push(at(from + (WEDGE_ARC * i) / steps, RIM_INNER, ox, oy));
  return out;
}

function panel(art: Raster, ox: number, oy: number, wheelAngle: number) {
  const hubX = ox + HUB_X * SCALE;
  const hubY = oy + HUB_Y * SCALE;
  /* The panel's own edges, as a clip. The app gets this free from the viewBox;
     here every arc would otherwise run on into the panel beside it and the
     sheet would show a wheel wider than the window ever draws. Clamping the
     points rather than clipping the shape is crude, and it is exact for these
     shapes: everything drawn here crosses the boundary along one edge. */
  const hold = (p: Pt): Pt => [
    Math.min(Math.max(p[0], ox), ox + VIEW_W * SCALE),
    Math.min(Math.max(p[1], oy), oy + CROP * SCALE),
  ];

  WHEEL.forEach((wedge, index) => {
    const from = wheelAngle + index * WEDGE_ARC;
    // Only what could reach the window; the rest is behind the crop.
    const mid = (((from + WEDGE_ARC / 2) % 360) + 360) % 360;
    if (mid > 60 && mid < 300) return;
    const colour =
      wedge.kind === "bankrupt"
        ? INK
        : wedge.kind === "lose-turn"
          ? ALERT
          : index % 2 === 0
            ? BOARD
            : SURFACE;
    art.polygon(bandSector(from, hubX, hubY).map(hold), colour);
  });

  // The rim, and the band's inner edge — struck after the wedges, as the board
  // strikes them. Drawn as strips over the visible arc rather than as whole
  // circles: `ring` would carry on past the edge of the panel and into its
  // neighbour, which would make the sheet show something the app never draws.
  const edge = (
    r: number,
    thickness: number,
    colour: ReturnType<typeof rgba>,
  ) => {
    for (let deg = -70; deg < 70; deg += 2) {
      art.polygon(
        [
          at(deg, r + thickness / 2, hubX, hubY),
          at(deg + 2, r + thickness / 2, hubX, hubY),
          at(deg + 2, r - thickness / 2, hubX, hubY),
          at(deg, r - thickness / 2, hubX, hubY),
        ].map(hold),
        colour,
      );
    }
  };
  edge(RADIUS, 1.4, INK);
  edge(RIM_INNER, 0.8, rgba("#d8d6cd"));

  // The flapper, hinged on its top edge at the hub's x — the same triangle the
  // board draws, swung by the same function.
  const flap = (flapAngle(wheelAngle) * Math.PI) / 180;
  const hinge: Pt = [hubX, oy + 1 * SCALE];
  const swing = (p: Pt): Pt => {
    const dx = p[0] - hinge[0];
    const dy = p[1] - hinge[1];
    return [
      hinge[0] + dx * Math.cos(flap) - dy * Math.sin(flap),
      hinge[1] + dx * Math.sin(flap) + dy * Math.cos(flap),
    ];
  };
  art.polygon(
    [
      [hubX, oy + 22 * SCALE],
      [hubX - 7 * SCALE, oy + 1 * SCALE],
      [hubX + 7 * SCALE, oy + 1 * SCALE],
    ].map((p) => hold(swing(p as Pt))),
    ACCENT,
  );
}

const GAP = 10;
const W = VIEW_W * SCALE;
const H = CROP * SCALE;

/** A sheet of `angles`, left to right, one panel each. */
function sheet(angles: number[]): Raster {
  const art = new Raster(
    angles.length * W + (angles.length + 1) * GAP,
    H + GAP * 2,
  );
  art.fill(GROUND);
  angles.forEach((a, i) => panel(art, GAP + i * (W + GAP), GAP, a));
  return art;
}

mkdirSync("preview", { recursive: true });

/*
  Default sheet: the tick. Four panels a quarter of a wedge apart, so the
  flapper is caught at four points of one tick — hanging, lifting, about to
  drop, and just dropped. This is the silhouette question.
*/
const PANELS = 4;
const rest = restAngle(0);
writeFileSync(
  "preview/wheel.png",
  sheet(
    Array.from({ length: PANELS }, (_, i) => rest + (WEDGE_ARC * i) / PANELS),
  ).toPNG(),
);
console.log(
  `preview/wheel.png — ${PANELS} panels, ${WHEEL.length} wedges, band ${RIM_INNER}..${RADIUS}`,
);

/*
  `--spin`: a whole throw, sampled at equal *times*.

  The other question, and the one the pane can never answer: does it slow down?
  Panels evenly spaced in time means the gap between them is speed — a sheet
  that steps far and then close is a wheel shedding speed, and a sheet with
  even steps is the bug that got this written. The wheel is drawn at the angle
  the CSS easing resolves to at that instant, which is the same `2t - t²` the
  stylesheet carries, so this is the animation and not a model of it.

  Two rows are printed rather than drawn: where each sample landed, and where
  the throw finally stopped — the fractional part is the whole point, and it is
  a number, not a picture.
*/
if (process.argv.includes("--spin")) {
  const hard = process.argv.includes("--hard");
  // Just inside the clamps rather than on them. The clamps are whole numbers
  // of wedges, so a throw sitting exactly on one stops exactly on a midpoint
  // from a standing start — true, and the least representative sheet to draw
  // when the fractional stop is half of what this is showing.
  const throwc = spinThrow(
    hard ? SPIN_MAX_SPEED * 0.98 : SPIN_MIN_SPEED * 1.02,
  );
  const SAMPLES = 8;
  const from = 0;
  const stop = restAfter(from, throwc.travel);
  const angles: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    // Equal slices of the duration, ending at the stop.
    const t = (i + 1) / SAMPLES;
    // Distance covered by time t, normalised — constant deceleration.
    const covered = 2 * t - t * t;
    angles.push(restAngle(from) - throwc.travel * WEDGE_ARC * covered);
  }
  writeFileSync(
    `preview/wheel-spin${hard ? "-hard" : ""}.png`,
    sheet(angles).toPNG(),
  );
  const at = wedgeUnder(stop);
  console.log(
    `preview/wheel-spin${hard ? "-hard" : ""}.png — ${throwc.travel.toFixed(2)} wedges ` +
      `(${(throwc.travel / WHEEL.length).toFixed(2)} turns) in ${throwc.ms}ms, ` +
      `${SAMPLES} panels at equal times`,
  );
  console.log(
    `  stops at ${stop.toFixed(3)} — wedge ${at} (${wedgeName(WHEEL[at])}), ` +
      `${Math.abs(stop - Math.round(stop)).toFixed(3)} of a wedge off its midpoint`,
  );
  const each = Array.from({ length: SAMPLES }, (_, i) => {
    const t0 = i / SAMPLES;
    const t1 = (i + 1) / SAMPLES;
    return ((2 * t1 - t1 * t1 - (2 * t0 - t0 * t0)) * throwc.travel).toFixed(1);
  });
  console.log(`  wedges per panel: ${each.join("  ")}`);
}
void PALETTE;
