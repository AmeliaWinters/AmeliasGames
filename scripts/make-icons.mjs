/**
 * Draws the Android launcher icons and the web favicon.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark is a two-by-two of counters — one ember, one ice, two empty
 * — which is the smallest fragment of a board that still reads as one. It
 * survives being shrunk to 48px, where anything more detailed turns to mush.
 *
 * The two empties are rings rather than filled holes. A hole is the board
 * colour minus a little, which is fine on a real board where six counters
 * around it establish the grid — but at four counters and 48px it just
 * disappeared, and the mark read as two dots on a dark square rather than as
 * a fragment of a board. Drawn as an edge, which is what --motif-off is for.
 *
 * minSdkVersion is 24, so both shapes are needed: adaptive icons for API 26+
 * (a separate foreground layer the launcher masks to whatever shape the phone
 * uses) and pre-baked legacy PNGs for 24-25.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Raster, PALETTE } from "./png.mjs";

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
 * Draw the four counters into a box of `span`, centred on the canvas.
 * Two circles across with a gap of a tenth of a counter.
 */
function drawMark(raster, centre, span) {
  const diameter = span / 2.1;
  const radius = diameter / 2;
  const offset = span / 2 - radius;

  // Thick enough to survive mdpi, where the whole icon is 48px and a counter
  // is about eight across, and still an edge rather than a second fill.
  const stroke = Math.max(1, radius * 0.22);

  const positions = [
    [centre - offset, centre - offset, PALETTE.seat0, true],
    [centre + offset, centre - offset, PALETTE.motifOff, false],
    [centre - offset, centre + offset, PALETTE.motifOff, false],
    [centre + offset, centre + offset, PALETTE.seat1, true],
  ];

  for (const [x, y, colour, filled] of positions) {
    // The ring is measured to the same outer edge a filled counter reaches,
    // so the four still sit on one grid.
    if (filled) raster.circle(x, y, radius, colour);
    else raster.ring(x, y, radius - stroke / 2, stroke, colour);
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
  drawMark(foreground, fgSize / 2, fgSize * (62 / 108));
  write(join(RES, `mipmap-${density}`, "ic_launcher_foreground.png"), foreground.toPNG());

  // ── Legacy square icon: nothing masks it, so it carries its own shape.
  const size = Math.round(48 * scale);
  const square = new Raster(size, size);
  square.roundedRect(0, 0, size, size, size * 0.22, PALETTE.board);
  drawMark(square, size / 2, size * 0.72);
  write(join(RES, `mipmap-${density}`, "ic_launcher.png"), square.toPNG());

  // ── Legacy round icon, for launchers that ask for one.
  const round = new Raster(size, size);
  round.circle(size / 2, size / 2, size / 2, PALETTE.board);
  drawMark(round, size / 2, size * 0.66);
  write(join(RES, `mipmap-${density}`, "ic_launcher_round.png"), round.toPNG());

  count += 3;
}

// The adaptive background is a flat colour behind the foreground layer.
write(
  join(RES, "values", "ic_launcher_background.xml"),
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#1e1e24</color>
</resources>
`,
    "utf8",
  ),
);

// Matching favicon for the web build.
write(
  join(ROOT, "public", "icon.svg"),
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Two Connect Four counters, ember and ice, on a dark board">
  <rect width="64" height="64" rx="14" fill="#1e1e24"/>
  <circle cx="21" cy="21" r="11" fill="#ff5a47"/>
  <circle cx="43" cy="21" r="9.8" fill="none" stroke="#7a7a86" stroke-width="2.4"/>
  <circle cx="21" cy="43" r="9.8" fill="none" stroke="#7a7a86" stroke-width="2.4"/>
  <circle cx="43" cy="43" r="11" fill="#21c7f0"/>
</svg>
`,
    "utf8",
  ),
);

console.log(`wrote ${count} launcher PNGs across ${DENSITIES.length} densities, plus the background colour and favicon`);
