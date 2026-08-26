/**
 * A recovery key, drawn as something a phone can look at.
 *
 * The second-device story used to be "get four lines of base64 onto the other
 * device", and the only ways to do that were a file and a clipboard. Both work
 * desktop-to-desktop and both are miserable in the direction people actually
 * go, which is desktop to phone: mailing yourself the one string that *is* the
 * account is exactly the "message it to yourself" that `importAccount`'s
 * comment warns against.
 *
 * A QR moves the same bytes between two devices the same person is holding,
 * and it moves them through *less* than a paste does: no clipboard, no inbox,
 * no chat app keeping a copy. Nothing about the trust model changes, which is
 * the point -- this is the existing import path with a shorter road to it.
 *
 * ## Why the encoder is a dependency
 *
 * Nearly everything in this repo is written here and pinned in a test, and
 * this is the exception. A QR encoder is Reed-Solomon over GF(256), eight mask
 * patterns and a placement order, and the failure mode of getting any of it
 * subtly wrong is a code that round-trips against your own reader and is
 * refused by every phone in the house -- which is precisely the thing the
 * Browser pane cannot show us (see CLAUDE.md). So: a small, dependency-free,
 * twenty-year-old implementation, and `qr.test.ts` pins the properties we
 * actually rely on rather than re-deriving the spec.
 *
 * ## Error correction L, deliberately
 *
 * The usual reflex is M or better. Here the channel is a bright screen a foot
 * from a camera, and the thing that decides whether a scan lands is how *big*
 * each module is: the key is about 280 bytes, which is 61 modules at L and 69
 * at M, so L draws a fifth more pixels per module on the same card. Redundancy
 * buys nothing extra either, because a corrupt key cannot get through anyway
 * -- `importAccount` signs and verifies before it stores, so the failure is
 * always "that is not a key", never a broken account.
 */
import { useMemo } from "react";
// The ESM build by path, not the bare specifier: see
// `qrcode-generator.d.ts` for why the two disagree and what breaks if this
// is "tidied".
import { qrcode } from "qrcode-generator/dist/qrcode.mjs";

/**
 * The code as a grid of dark/light, row-major, without its quiet zone.
 *
 * Pure and free of the DOM so it can be tested in Node, which is the only
 * place anything about this is going to be checked automatically.
 */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, "L");
  // 'Byte' rather than the auto mode: base64url is all alphanumerics plus `-`
  // and `_`, and QR's "alphanumeric" mode is a 45-character set that has
  // neither, nor lower case. Left to choose, the encoder picks byte mode
  // anyway; saying so means a payload that changes shape cannot quietly land
  // in a mode that mangles it.
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.isDark(row, col)),
  );
}

/** The white margin a scanner needs to find the code at all, in modules. */
export const QUIET = 4;

/**
 * The code, as an SVG that scales to whatever box it is given.
 *
 * Two things here are not decoration. The fill colours are literal white and
 * black rather than palette tokens: a scanner is looking for contrast between
 * light and dark modules, and a code drawn in `--board` on `--ink` is a code
 * that stops working when somebody switches to the dark palette. And the quiet
 * zone is part of the `viewBox` rather than CSS padding, so it survives the
 * card behind it changing colour.
 *
 * One path for every dark module, because a rect each is four thousand
 * elements and this is one.
 */
export function QrCode({ text, alt }: { text: string; alt: string }) {
  const path = useMemo(() => {
    const matrix = qrMatrix(text);
    const parts: string[] = [];
    for (let row = 0; row < matrix.length; row++) {
      for (let col = 0; col < matrix.length; col++) {
        if (matrix[row][col]) parts.push(`M${col + QUIET} ${row + QUIET}h1v1h-1z`);
      }
    }
    return { d: parts.join(""), size: matrix.length + QUIET * 2 };
  }, [text]);

  return (
    <svg
      className="qr"
      viewBox={`0 0 ${path.size} ${path.size}`}
      role="img"
      aria-label={alt}
      shapeRendering="crispEdges"
    >
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}
