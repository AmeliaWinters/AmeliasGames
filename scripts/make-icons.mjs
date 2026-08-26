/**
 * Draws the Android launcher icons and the web favicon.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark is the RG monogram from `rgMark.mjs`: pixel arcade caps, the
 * initials and nothing else. It replaced a two-by-two of counters, which was
 * the smallest fragment of a board that still read as one -- true, and the
 * problem: it read as Connect Four, which is one game out of the ten that
 * ship, and the mark on the home screen is the one thing that has to stand for
 * all of them.
 *
 * Daylight is the primary pair, ember on the warm board colour, and it is what
 * every Android icon here is drawn in. The favicon carries both: daylight by
 * default and stage under `prefers-color-scheme: dark`, which an SVG favicon
 * can do for itself and a launcher PNG cannot.
 *
 * minSdkVersion is 24, so both shapes are needed: adaptive icons for API 26+
 * (a separate foreground layer the launcher masks to whatever shape the phone
 * uses) and pre-baked legacy PNGs for 24-25.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Raster, rgba } from "./png.mjs";
import { DAYLIGHT, MARK_H, MARK_W, STAGE, runs } from "./rgMark.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RES = join(ROOT, "android", "app", "src", "main", "res");

/** Android's density ladder, as multiples of the baseline. */
const DENSITIES = [
  ["mdpi", 1],
  ["hdpi", 1.5],
  ["xhdpi", 2],
  ["xxhdpi", 3],
  ["xxxhdpi", 4],
];

/**
 * Draw the monogram into a box of `span`, centred on the canvas.
 *
 * The cell size is floored to a whole number of pixels and the mark is then
 * centred on whatever that comes to, rather than scaled to fill `span`
 * exactly. A fractional cell is the one thing this mark cannot survive: it
 * puts a stem at 2.6px, which the rasteriser rounds to three on one row and
 * two on the next, and the arcade letterforms turn to fringe. Slightly smaller
 * and sharp beats exactly-sized and soft.
 */
function drawMark(raster, centre, span, colour) {
  const cell = Math.max(1, Math.floor(span / MARK_W));
  const x0 = Math.round(centre - (MARK_W * cell) / 2);
  const y0 = Math.round(centre - (MARK_H * cell) / 2);

  for (const { x, y, len } of runs()) {
    raster.rect(x0 + x * cell, y0 + y * cell, len * cell, cell, colour);
  }
}

function write(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}

let count = 0;

for (const [density, scale] of DENSITIES) {
  // ── Adaptive foreground: 108dp canvas, but only the middle 66dp is
  //    guaranteed visible once the launcher applies its mask.
  const fgSize = Math.round(108 * scale);
  const foreground = new Raster(fgSize, fgSize);
  drawMark(foreground, fgSize / 2, fgSize * (62 / 108), rgba(DAYLIGHT.ink));
  write(join(RES, `mipmap-${density}`, "ic_launcher_foreground.png"), foreground.toPNG());

  // ── Legacy square icon: nothing masks it, so it carries its own shape.
  const size = Math.round(48 * scale);
  const square = new Raster(size, size);
  square.roundedRect(0, 0, size, size, size * 0.22, rgba(DAYLIGHT.ground));
  drawMark(square, size / 2, size * 0.86, rgba(DAYLIGHT.ink));
  write(join(RES, `mipmap-${density}`, "ic_launcher.png"), square.toPNG());

  // ── Legacy round icon, for launchers that ask for one.
  const round = new Raster(size, size);
  round.circle(size / 2, size / 2, size / 2, rgba(DAYLIGHT.ground));
  drawMark(round, size / 2, size * 0.72, rgba(DAYLIGHT.ink));
  write(join(RES, `mipmap-${density}`, "ic_launcher_round.png"), round.toPNG());

  count += 3;
}

// The adaptive background is a flat colour behind the foreground layer.
write(
  join(RES, "values", "ic_launcher_background.xml"),
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${DAYLIGHT.ground}</color>
</resources>
`,
    "utf8",
  ),
);

// Matching favicon for the web build.
//
// The one place both palettes ship in a single file. A favicon is drawn by the
// browser chrome, not by the page, so it never sees `data-palette` -- the
// media query is the only handle on it, and it is why this is an SVG at all.
// Daylight is the plain fill and stage is the override, so a browser that
// ignores the query gets the primary rather than nothing.
const cell = 2;
const x0 = (64 - MARK_W * cell) / 2;
const y0 = (64 - MARK_H * cell) / 2;
const marks = runs()
  .map(
    ({ x, y, len }) =>
      `<rect x="${x0 + x * cell}" y="${y0 + y * cell}" width="${len * cell}" height="${cell}"/>`,
  )
  .join("");

write(
  join(ROOT, "public", "icon.svg"),
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="RG, the Rebellia Games monogram, in ember pixel caps">
  <style>
    .ground { fill: ${DAYLIGHT.ground} }
    .mono { fill: ${DAYLIGHT.ink} }
    @media (prefers-color-scheme: dark) {
      .ground { fill: ${STAGE.ground} }
      .mono { fill: ${STAGE.ink} }
    }
  </style>
  <rect class="ground" width="64" height="64" rx="14"/>
  <g class="mono">${marks}</g>
</svg>
`,
    "utf8",
  ),
);

// The same runs again, for the header glyph in `art.tsx`.
//
// Generated rather than hand-copied, and generated rather than imported: the
// client cannot reach into `scripts/` without dragging an untyped .mjs through
// four tsconfigs, and a third hand-drawn copy of the letterforms is how a logo
// quietly becomes two logos. `rgMark.test.ts` fails if this file drifts from
// the grid, so regenerating it is not something anyone has to remember.
const cells = runs()
  .map(({ x, y, len }) => `  [${x}, ${y}, ${len}],`)
  .join("\n");

write(
  join(ROOT, "src", "client", "rgMark.ts"),
  Buffer.from(
    `/* Generated by scripts/make-icons.mjs. Do not edit; edit scripts/rgMark.mjs. */

/** The monogram in cells, as [x, y, length] horizontal runs. */
export const RG_RUNS: readonly (readonly [number, number, number])[] = [
${cells}
];

/** The mark's extent in cells, which is what a viewBox is built from. */
export const RG_W = ${MARK_W};
export const RG_H = ${MARK_H};
`,
    "utf8",
  ),
);

console.log(`wrote ${count} launcher PNGs across ${DENSITIES.length} densities, plus the background colour, the favicon and src/client/rgMark.ts`);
