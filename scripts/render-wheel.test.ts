/**
 * The wheel's silhouette, pinned.
 *
 * `render-wheel.ts` exists because the preview pane cannot show a clipped or a
 * moving thing, and because measurement had already been confidently wrong
 * about this exact shape: the band was geometrically correct while it still
 * looked like a fan of stripes in a card, and one contact sheet settled it.
 * What the script could not do was notice. It draws a picture and waits for
 * somebody to think of running it, which for the dice meant a retune shipped
 * with the throw using a fifth of the tray.
 *
 * So the sheet is a golden. `wheelGeometry.ts` and `wheelDisplay.ts` are pure
 * and dependency-free, the raster is arithmetic on a byte buffer with no engine
 * underneath it, and the same code therefore draws the same pixels on any
 * machine. That makes the picture a fact, and this file is the assertion that
 * the fact has not changed by accident.
 *
 * The golden is the digest below and not a file, because `preview/` is
 * gitignored on purpose -- contact sheets are drawn to be looked at and thrown
 * away, and a directory of them is not what this repo is for. Sixteen hex
 * characters carry the same claim and survive a `git clean`. What is lost is
 * the ability to *look* at the reference, so the failure path below restores
 * it: it draws the sheet it got, and `npm run render:wheel` draws the sheet the
 * digest was taken from, which is the pair you want side by side anyway.
 *
 * **When this fails**, it is not telling you that you were wrong. It is telling
 * you that the wheel looks different, which is often exactly what you meant:
 *
 *     git stash && npm run render:wheel && git stash pop   # the old sheet
 *     npx vitest run scripts/render-wheel.test.ts          # the new one
 *
 * leaves `preview/wheel.png` and `preview/wheel-actual.png` beside each other.
 * Look at both. If the new one is right, paste the digest the failure printed
 * into `SILHOUETTE`. The looking is the point and is the one step nothing here
 * can do for you.
 *
 * The digest is over the raw RGBA buffer rather than over the encoded PNG. The
 * pixels are ours; the encoding is zlib's, and pinning a number that a Node
 * upgrade can change would make this file cry wolf.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PANELS, restSheet, sheet } from './render-wheel.js';
import {
  WHEEL,
  WEDGE_ARC,
  SPIN_MIN_SPEED,
  spinThrow,
} from '../src/shared/games/wheelDisplay.js';
import { RADIUS, flapAngle, restAngle } from '../src/client/games/wheelGeometry.js';

/**
 * The sheet as it was last looked at and approved, as a digest of its pixels.
 *
 * Regenerate deliberately. See the note at the top of this file.
 */
const SILHOUETTE = '882b59208a19af90';

const digest = (art: { data: Buffer }) =>
  createHash('sha256').update(art.data).digest('hex').slice(0, 16);

describe('the wheel as drawn', () => {
  it('still draws the silhouette this repo signed off on', () => {
    const art = restSheet();
    const drew = digest(art);
    if (drew !== SILHOUETTE) {
      // Written before the assertion, so that the failure hands over a picture
      // rather than only a number. A digest cannot say *what* moved, and the
      // whole reason this sheet exists is that the eye can.
      mkdirSync('preview', { recursive: true });
      writeFileSync('preview/wheel-actual.png', art.toPNG());
    }
    expect(
      drew,
      'the wheel draws differently. What it drew is in ' +
        'preview/wheel-actual.png; `npm run render:wheel` draws the sheet this ' +
        'digest was taken from, into preview/wheel.png. Look at both. If the ' +
        `new one is right, set SILHOUETTE in this file to ${drew}.`,
    ).toBe(SILHOUETTE);
  });

  it('draws the sheet the script says it drew', () => {
    /*
      The digest above is one number and says nothing about what it covers, so
      these are the dimensions in words: a sheet is `PANELS` panels wide, and
      each panel is the same size. If a future sheet has five panels or a
      different scale, this fails first and with a sentence, rather than as an
      unexplained hash.
    */
    const one = sheet([restAngle(0)]);
    const all = restSheet();
    expect(all.height).toBe(one.height);
    // Panels plus the gaps between and around them, which is what makes the
    // width a multiple rather than a product.
    expect((all.width - one.width) % (PANELS - 1)).toBe(0);
    expect(all.width).toBeGreaterThan(one.width * (PANELS - 1));
  });

  it('changes when the geometry it is drawn from changes', () => {
    /*
      Guards the guard, and it is worth the lines: a digest over a blank buffer
      is stable too. Two sheets a fraction of a wedge apart must differ, or this
      file is pinning the size of the canvas and nothing on it.
    */
    const rest = restAngle(0);
    expect(digest(sheet([rest]))).not.toBe(digest(sheet([rest + WEDGE_ARC / 4])));
  });

  it('puts the flapper where the board puts it', () => {
    /*
      The sheet's whole claim is that it is the board's own geometry and not a
      drawing of it, so what it leans on is checked here rather than assumed.

      Swept across a wedge rather than sampled at two points: the flapper hangs
      still for the first half of every wedge and only lifts through the second,
      so the two obvious samples -- a wedge apart, or half a wedge apart from
      rest -- both come back zero, and an assertion built on either would have
      passed for a flapper that never moved at all.
    */
    const sweep = Array.from({ length: 16 }, (_, i) => flapAngle(restAngle(0) + (WEDGE_ARC * i) / 16));
    expect(Math.max(...sweep)).toBeGreaterThan(Math.min(...sweep));
    expect(RADIUS).toBeGreaterThan(0);
    expect(WHEEL.length).toBe(36);
    expect(spinThrow(SPIN_MIN_SPEED * 1.02).travel).toBeGreaterThan(0);
  });
});
