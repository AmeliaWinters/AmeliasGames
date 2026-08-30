/**
 * Recolouring a sprite, which for this art is one multiply and nothing else.
 *
 * The Character Kit is drawn to be tinted. Every recolourable part ships a
 * `C` mask painted in a three step grey ramp -- white, `#cec3bd`, `#8f7f76` --
 * and the line art lives in a separate `L` file that is never touched. Multiply
 * a chosen colour through the mask and the artist's shading survives at the
 * ratios they drew it: the white becomes the colour, the mid step becomes 81%
 * of it, the dark step 56%. That is a Photoshop multiply layer, which is
 * almost certainly how the ramp was authored, and it is the reason a hundred
 * hairstyles need one hair colour each rather than a hundred repaints.
 *
 * **Two implementations, one function.** In the browser the multiply is an
 * SVG `feColorMatrix` on the `<img>`, because a canvas cannot recolour a PNG
 * until the PNG has decoded and an avatar that arrives one frame late is a
 * flicker in the account chip. In Node, `render-avatars.ts` has the pixels
 * already and multiplies them directly. Both go through the numbers below, so
 * the contact sheet is the app: see `tint.test.ts`, which pins the two against
 * each other on the ramp itself.
 *
 * Multiplying is not the only way to recolour pixel art and it has one known
 * cost: the ramp is very slightly warm (`#cec3bd` is not neutral grey), so a
 * cold blue picks up a few degrees of warmth on the way through. That is under
 * a step of hue at this size, and the alternative -- mapping the three ramp
 * steps to three colours chosen per hue -- is a palette design job, not a
 * function. If the blues ever look muddy, that is the thing to build.
 */

/** The grey ramp every `C` and `M` mask is painted in, light to dark. */
export const RAMP = ['#ffffff', '#cec3bd', '#8f7f76'] as const;

/** The one colour the `L` line art is drawn in. Never tinted. */
export const INK = '#31130b';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#8f7f76` or `#abc`, to channels. Throws on anything else: it is a bug. */
export function parseHex(hex: string): Rgb {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  if (!long) throw new Error(`not a hex colour: ${hex}`);
  return { r: parseInt(long[1], 16), g: parseInt(long[2], 16), b: parseInt(long[3], 16) };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * One channel through the multiply. Rounded, not truncated.
 *
 * Truncating costs a whole level at this bit depth: `0xff * 0xfe / 255` is
 * 254.004, and floored it lands on 253, which over a three step ramp is a
 * visible band on a large flat area like a cloak.
 */
export function multiplyChannel(source: number, tint: number): number {
  return Math.round((source * tint) / 255);
}

/** A pixel through the multiply. */
export function multiply(source: Rgb, tint: Rgb): Rgb {
  return {
    r: multiplyChannel(source.r, tint.r),
    g: multiplyChannel(source.g, tint.g),
    b: multiplyChannel(source.b, tint.b),
  };
}

/**
 * The same multiply as a colour matrix, for `feColorMatrix`.
 *
 * A multiply by a constant is a diagonal matrix, which is the whole trick:
 * the browser does per pixel what `multiply` does per pixel, on the GPU, to an
 * `<img>` that has not finished loading yet.
 *
 * **`color-interpolation-filters` has to be `sRGB` wherever this is used.**
 * The SVG default is linearRGB, which converts, multiplies and converts back,
 * and the result is nothing like a Photoshop multiply -- mid tones come out
 * several steps light. Whoever writes the filter element owes it that
 * attribute; there is no way to say it from here.
 */
export function tintMatrix(hex: string): string {
  const { r, g, b } = parseHex(hex);
  const row = (scale: number, at: number) =>
    [0, 1, 2].map((i) => (i === at ? (scale / 255).toFixed(6) : '0')).join(' ');
  return [
    `${row(r, 0)} 0 0`,
    `${row(g, 1)} 0 0`,
    `${row(b, 2)} 0 0`,
    '0 0 0 1 0',
  ].join(' ');
}

/**
 * Multiply a run of straight RGBA bytes in place, leaving alpha alone.
 *
 * For Node, where the pixels are already decoded. Fully transparent pixels are
 * skipped rather than multiplied, so a trimmed sprite's padding cannot pick up
 * a colour that later composites as a halo.
 */
export function multiplyRgba(rgba: Uint8Array | Uint8ClampedArray | number[], hex: string): void {
  const tint = parseHex(hex);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    rgba[i] = multiplyChannel(rgba[i], tint.r);
    rgba[i + 1] = multiplyChannel(rgba[i + 1], tint.g);
    rgba[i + 2] = multiplyChannel(rgba[i + 2], tint.b);
  }
}

/**
 * A darker relative of a colour, for the second tone a two colour part wants.
 *
 * The undercut's shaved side and a patterned background both need a colour
 * that reads as *related* to the one somebody picked rather than as a second
 * decision. Multiplying the colour by itself is too dark; this is the ramp's
 * own mid step, reused, so the relationship between the two tones is the same
 * one the artist drew between the two tones inside a single mask.
 */
export function shade(hex: string): string {
  return toHex(multiply(parseHex(hex), parseHex(RAMP[1])));
}
