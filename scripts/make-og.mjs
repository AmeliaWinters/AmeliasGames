/**
 * Draws public/og.png — the link preview image.
 *
 * It renders the real final position from the first phone-versus-browser game
 * rather than stock artwork, in Stage — the default palette:
 *
 *   node scripts/make-og.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Raster, PALETTE } from "./png.mjs";

const WIDTH = 1200;
const HEIGHT = 630;

/** The position as actually played: bottom row taken, three stacked in col 7. */
const POSITION = [
  ".......",
  ".......",
  ".......",
  "......2",
  "......2",
  "1111..2",
];
const WINNING = new Set(["5,0", "5,1", "5,2", "5,3"]);

const CELL = 78;
const GAP = 10;
const PAD = 14;
const BOARD_W = 7 * CELL + 6 * GAP + 2 * PAD;
const BOARD_H = 6 * CELL + 5 * GAP + 2 * PAD;
const BOARD_X = Math.round((WIDTH - BOARD_W) / 2);
const BOARD_Y = Math.round((HEIGHT - BOARD_H) / 2);

const raster = new Raster(WIDTH, HEIGHT);
raster.fill(PALETTE.ground);
raster.roundedRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H, 4, PALETTE.board);

const radius = CELL / 2;
POSITION.forEach((row, r) => {
  [...row].forEach((token, c) => {
    const cx = BOARD_X + PAD + c * (CELL + GAP) + radius;
    const cy = BOARD_Y + PAD + r * (CELL + GAP) + radius;
    const colour = token === "1" ? PALETTE.seat0 : token === "2" ? PALETTE.seat1 : PALETTE.hole;
    raster.circle(cx, cy, radius, colour);
    if (WINNING.has(`${r},${c}`)) raster.ring(cx, cy, radius + 3, 3, PALETTE.ink);
  });
});

const png = raster.toPNG();
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "og.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`wrote ${out} — ${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} kB`);
