/**
 * The RG monogram, as a bitmap.
 *
 * One grid, read by everything that draws the mark: the web favicon, the
 * Android launcher icons, and the header glyph in `art.tsx`. It is here rather
 * than in each of them because a logo that is three hand-copies of the same
 * letterforms is a logo that will be two different logos by the third time
 * somebody nudges a pixel.
 *
 * Bitmap rather than paths because the mark is a bitmap: 5x7-family arcade
 * caps thickened to a two-cell stem, with slab feet and a stepped leg on the
 * R. Every stroke is a whole number of cells, which is the only reason it
 * stays crisp when it is rasterised at five Android densities.
 *
 * The two letters are separated by one blank column (`GAP`), not touching and
 * not kerned tight. At the gap of zero they had already fused into one shape
 * at 32px, which is where a favicon actually lives.
 */

/** The R. Thirteen cells wide, fourteen tall, stem two cells. */
export const R = [
  "#############",
  "#############",
  "##.......####",
  "##.......####",
  "##.......####",
  "##.......####",
  "##.......####",
  "#############",
  "#############",
  "##..#####....",
  "##...#####...",
  "##...#####...",
  "##....#####..",
  "##....#######",
];

/** The G, on the same body. Its aperture is the four open rows on the right. */
export const G = [
  ".###########.",
  "#############",
  "##.........##",
  "##...........",
  "##...........",
  "##...........",
  "##...........",
  "##.....######",
  "##.....######",
  "##........###",
  "##........###",
  "##.........##",
  "#############",
  ".###########.",
];

/** Blank columns between the two letters. */
export const GAP = 1;

/** The whole mark, in cells. 27 x 14, so it is close to two to one. */
export const MARK_W = R[0].length + GAP + G[0].length;
export const MARK_H = R.length;

/**
 * The mark's two colour pairs, ground first.
 *
 * Daylight is the primary: it is what the launcher icon and the default
 * favicon are drawn in. Stage is the variant the favicon swaps to under
 * `prefers-color-scheme: dark`. Both pairs are the palette's own tokens --
 * `--board` and `--seat-0` from `palette.css` -- so the mark cannot drift away
 * from the app it sits on top of.
 */
export const DAYLIGHT = { ground: "#e4e2da", ink: "#cf3a24" };
export const STAGE = { ground: "#1e1e24", ink: "#ff5a47" };

/**
 * The mark as horizontal runs of cells: `{ x, y, len }` in cell coordinates.
 *
 * Runs rather than one rect per cell because both consumers want them that way
 * -- the SVG comes out a quarter the size, the rasteriser does a quarter the
 * calls -- and because merging them here means neither consumer has to know
 * the grid is a grid.
 */
export function runs() {
  const out = [];
  for (const [rows, ox] of [
    [R, 0],
    [G, R[0].length + GAP],
  ]) {
    rows.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (row[x] !== "#") {
          x += 1;
          continue;
        }
        let len = 0;
        while (row[x + len] === "#") len += 1;
        out.push({ x: ox + x, y, len });
        x += len;
      }
    });
  }
  return out;
}
