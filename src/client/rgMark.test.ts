import { describe, expect, it } from "vitest";

import { RG_H, RG_RUNS, RG_W } from "./rgMark.js";

/*
 * The logo exists twice on purpose and must not exist twice in fact.
 *
 * `scripts/rgMark.mjs` holds the grid, and `scripts/make-icons.mjs` draws the
 * favicon and the Android launcher icons from it and generates
 * `src/client/rgMark.ts` for the header glyph. The generated copy is checked
 * in, because the client build must not depend on a Node script having been
 * run -- which is exactly the arrangement where the two quietly stop matching
 * and the tab icon and the header are different logos for a year.
 *
 * So: read the source grid the way the script does, and hold the checked-in
 * copy to it. `npm run icons` is the fix when this fails, not an edit here.
 */
describe("the RG monogram", () => {
  it("matches the grid the icons are drawn from", async () => {
    const source = (await import("../../scripts/rgMark.mjs")) as {
      runs(): { x: number; y: number; len: number }[];
      MARK_W: number;
      MARK_H: number;
    };

    expect(RG_W).toBe(source.MARK_W);
    expect(RG_H).toBe(source.MARK_H);
    expect(RG_RUNS.map(([x, y, len]) => ({ x, y, len }))).toEqual(source.runs());
  });

  it("draws two letters that stay separate", () => {
    // The gap between the R and the G is the whole reason the mark survives a
    // 32px favicon: at a gap of zero the two fused into one shape. Nothing
    // here may span it, so no run may start left of the seam and end right of
    // it. The seam is the R's width, which is where the blank column sits.
    const seam = 13;
    for (const [x, , len] of RG_RUNS) {
      expect(x < seam && x + len > seam, `run at ${x} spans the seam`).toBe(false);
    }
  });
});
