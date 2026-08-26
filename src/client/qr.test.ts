import { describe, expect, it } from 'vitest';
import { QUIET, qrMatrix } from './qr.js';

/**
 * The encoder is somebody else's (see `qr.tsx` for why), so these do not
 * re-derive the spec. They pin the three things this app relies on and would
 * otherwise only discover on a phone, which is the one place CLAUDE.md says we
 * cannot look.
 */

/** A recovery key, at the size the real one is: two base64url halves in JSON. */
const KEY = JSON.stringify({ priv: 'A'.repeat(184), pub: 'B'.repeat(88) });

describe('the recovery code', () => {
  it('is square, and every row is the same length', () => {
    const matrix = qrMatrix(KEY);
    expect(matrix.length).toBeGreaterThan(20);
    for (const row of matrix) expect(row.length).toBe(matrix.length);
  });

  it('carries a finder pattern in three corners', () => {
    const matrix = qrMatrix(KEY);
    const last = matrix.length - 1;
    // The 7x7 eye a scanner locks onto: dark ring, light ring, dark core. Three
    // corners and not the fourth, which is what tells it the rotation.
    const eyeAt = (top: number, left: number) =>
      matrix[top][left] &&
      matrix[top + 6][left + 6] &&
      !matrix[top + 1][left + 1] &&
      matrix[top + 3][left + 3];
    expect(eyeAt(0, 0)).toBe(true);
    expect(eyeAt(0, last - 6)).toBe(true);
    expect(eyeAt(last - 6, 0)).toBe(true);
  });

  /**
   * The size the screen was built around.
   *
   * `.prof-qr .qr` caps the code at 260px, so 61 modules plus two quiet zones
   * is about 3.7px each, which a phone camera resolves at arm's length. A
   * payload that grew -- a third field on the stored key, or the pretty-printed
   * export going in here by mistake -- would push this to the next version and
   * shrink every module without anything else complaining. That is the failure
   * this test exists for, and the fix is to shorten the payload, not to raise
   * the number.
   */
  it('stays inside the version the profile screen is drawn for', () => {
    expect(qrMatrix(KEY).length).toBeLessThanOrEqual(61);
    expect(QUIET).toBe(4);
  });
});
