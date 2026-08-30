/**
 * The multiply, pinned in both of the places it happens.
 *
 * The Character Kit is recoloured twice by two different mechanisms: an SVG
 * `feColorMatrix` in the browser, and `multiplyRgba` over decoded bytes in
 * `render-avatars.ts`. The whole value of the contact sheet rests on those two
 * agreeing, and nothing else would notice if they drifted -- the sheet would
 * simply be a lie, quietly, in whatever direction the drift went.
 *
 * So the matrix is checked against the arithmetic rather than against a
 * screenshot. What cannot be checked here is the browser applying it in sRGB;
 * that is one attribute on the filter element and a comment in two files
 * saying so.
 */
import { describe, expect, it } from 'vitest';

import {
  INK,
  multiply,
  multiplyRgba,
  parseHex,
  RAMP,
  shade,
  tintMatrix,
  toHex,
} from './tint.js';

/** The multiply the browser will do, worked out from the matrix it is given. */
function throughMatrix(hex: string, source: string): string {
  const values = tintMatrix(hex).split(' ').map(Number);
  const rgb = parseHex(source);
  const channel = (row: number) =>
    Math.round(values[row * 5] * rgb.r + values[row * 5 + 1] * rgb.g + values[row * 5 + 2] * rgb.b);
  return toHex({ r: channel(0), g: channel(1), b: channel(2) });
}

describe('tinting a mask', () => {
  it('turns the ramp into the colour and two shades of it', () => {
    // The whole promise of the art: white becomes the colour exactly, and the
    // artist's two shading steps stay proportional to it. If the first of
    // these ever stops being an identity, every recoloured part in the set is
    // slightly the wrong colour and nothing says so.
    expect(toHex(multiply(parseHex(RAMP[0]), parseHex('#6b4636')))).toBe('#6b4636');
    expect(toHex(multiply(parseHex(RAMP[1]), parseHex('#6b4636')))).toBe('#563628');
    expect(toHex(multiply(parseHex(RAMP[2]), parseHex('#6b4636')))).toBe('#3c2319');
  });

  it('agrees with the matrix the browser is handed', () => {
    // The two implementations, on every ramp step and a spread of colours.
    for (const hex of ['#ffffff', '#000000', '#6b4636', '#c8455a', '#3f6ea8', '#8fc06a']) {
      for (const step of RAMP) {
        expect(throughMatrix(hex, step), `${hex} through ${step}`).toBe(
          toHex(multiply(parseHex(step), parseHex(hex))),
        );
      }
    }
  });

  it('rounds rather than truncates', () => {
    // 254.004 is 254, not 253. Flooring costs a whole level at this bit depth
    // and shows up as a band across a flat area like a cloak.
    expect(multiply({ r: 255, g: 255, b: 255 }, { r: 254, g: 254, b: 254 }).r).toBe(254);
  });

  it('leaves the padding of a trimmed sprite alone', () => {
    // Transparent pixels carry whatever colour the exporter left in them.
    // Multiplied, they stay transparent and composite to nothing; but a
    // renderer that later reads them as straight colour would see a halo, so
    // this is a promise not to touch them.
    const pixels = new Uint8ClampedArray([255, 255, 255, 0, 255, 255, 255, 255]);
    multiplyRgba(pixels, '#804020');
    expect([...pixels.slice(0, 4)]).toEqual([255, 255, 255, 0]);
    expect([...pixels.slice(4)]).toEqual([128, 64, 32, 255]);
  });

  it('reads both lengths of hex and refuses anything else', () => {
    expect(parseHex('#abc')).toEqual(parseHex('#aabbcc'));
    expect(() => parseHex('red')).toThrow();
    expect(() => parseHex('#12345')).toThrow();
  });

  it('shades a colour by the ramp step the artist drew', () => {
    // The second tone of a two colour part is the same relationship the artist
    // drew *inside* one mask, reused, rather than a second decision.
    expect(shade('#ffffff')).toBe(RAMP[1]);
    expect(shade('#000000')).toBe('#000000');
  });

  it('never tints the line art', () => {
    // Not enforcement, a statement: `L` layers carry no tint, and the one ink
    // colour across the whole set is what makes a hundred mixed parts read as
    // one character. If this constant moves, the art moved.
    expect(INK).toBe('#31130b');
  });
});
