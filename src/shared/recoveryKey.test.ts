/**
 * The recovery key's encoding.
 *
 * The account behind it is tested in `src/client/account.test.ts`; this file
 * is only about the characters. Two things matter and neither is obvious from
 * reading the code: that the round trip is exact for seeds with leading and
 * trailing zero bytes, which is where an integer encoding loses length, and
 * that the four spare bits actually catch the errors a person makes copying by
 * hand.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  formatRecoveryKey,
  looksLikeRecoveryKey,
} from './recoveryKey.js';

function seedOf(fill: (i: number) => number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => fill(i));
}

describe('the recovery key', () => {
  it('is 52 characters, or 13 groups of 4', () => {
    const seed = seedOf((i) => i * 7 + 3);
    expect(encodeRecoveryKey(seed)).toHaveLength(52);
    expect(formatRecoveryKey(seed).split('-')).toHaveLength(13);
  });

  it('round trips, including seeds that are mostly zero', () => {
    const seeds = [
      seedOf(() => 0),
      seedOf(() => 255),
      seedOf((i) => (i === 31 ? 1 : 0)),
      seedOf((i) => (i === 0 ? 1 : 0)),
      seedOf((i) => (i * 37 + 11) & 0xff),
    ];
    for (const seed of seeds) {
      expect(decodeRecoveryKey(encodeRecoveryKey(seed))).toEqual(seed);
      expect(decodeRecoveryKey(formatRecoveryKey(seed))).toEqual(seed);
    }
  });

  it('forgives everything that is not information', () => {
    const seed = seedOf((i) => (i * 13 + 5) & 0xff);
    const key = formatRecoveryKey(seed);
    expect(decodeRecoveryKey(`  ${key.toLowerCase()}\n`)).toEqual(seed);
    expect(decodeRecoveryKey(key.replace(/-/g, ' '))).toEqual(seed);
  });

  it('reads back the letters Crockford dropped as the digits they look like', () => {
    const seed = seedOf((i) => (i * 29 + 17) & 0xff);
    const key = encodeRecoveryKey(seed);
    // Somebody has written a 0 down and read it back as an O, or a 1 as an l.
    const misread = key.replace(/0/g, 'O').replace(/1/g, 'l');
    expect(decodeRecoveryKey(misread)).toEqual(seed);
  });

  it('refuses a key of the wrong length', () => {
    const key = encodeRecoveryKey(seedOf((i) => i));
    expect(decodeRecoveryKey(key.slice(0, 51))).toBeNull();
    expect(decodeRecoveryKey(key + 'A')).toBeNull();
    expect(decodeRecoveryKey('')).toBeNull();
  });

  it('catches most single character slips rather than opening a stranger account', () => {
    // A wrong character is a valid key for *some* seed, so the checksum is the
    // only thing between a typo and a silently empty account. Four bits puts
    // the floor at 1 in 16, and this is the guard against the fold drifting
    // well above it. Averaged over several keys because a single key can sit
    // an unlucky way off on its own.
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let missed = 0;
    let tried = 0;
    for (let n = 0; n < 8; n++) {
      const key = encodeRecoveryKey(seedOf((i) => (i * 37 + n * 61 + 1) & 0xff));
      for (let at = 0; at < key.length; at++) {
        for (const glyph of alphabet) {
          if (glyph === key[at]) continue;
          tried++;
          if (decodeRecoveryKey(key.slice(0, at) + glyph + key.slice(at + 1))) missed++;
        }
      }
    }
    expect(missed / tried).toBeLessThan(0.09);
  });

  it('tells a key apart from the JSON export it replaced', () => {
    expect(looksLikeRecoveryKey('{"priv":"a","pub":"b"}')).toBe(false);
    expect(looksLikeRecoveryKey('  \n{"priv":"a"}')).toBe(false);
    expect(looksLikeRecoveryKey(encodeRecoveryKey(seedOf(() => 4)))).toBe(true);
  });
});

/**
 * One key, written out in full.
 *
 * Every other test in this file is a round trip, and `encodeRecoveryKey`'s own
 * comment names the bug a round trip cannot see: prepending instead of
 * appending reverses the string, and a reversed key still decodes perfectly
 * through the reversed decoder that same edit would produce. The suite would
 * stay green while every key already written on paper stopped working.
 *
 * So this is the one test that says what the characters *are*. It is not a
 * property, it is a promise: these 52 characters are what this seed has always
 * produced, and if this test fails then either the encoding changed or the
 * checksum did, and both mean every recovery key ever minted is now unreadable.
 * Do not update the string to make it pass. Work out which change did it.
 */
describe('the format, pinned', () => {
  const seed = Uint8Array.from({ length: 32 }, (_, i) => i);

  it('encodes the bytes 0..31 to exactly these characters', () => {
    expect(formatRecoveryKey(seed)).toBe(
      '000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFX',
    );
  });

  it('reads that same string back as the seed it came from', () => {
    const back = decodeRecoveryKey('000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFX');
    expect(back).not.toBeNull();
    expect([...(back as Uint8Array)]).toEqual([...seed]);
  });

  it('is not its own reverse, which is the bug the comment warns about', () => {
    const plain = encodeRecoveryKey(seed);
    expect(plain).not.toBe([...plain].reverse().join(''));
    expect(decodeRecoveryKey([...plain].reverse().join(''))).toBeNull();
  });
});
