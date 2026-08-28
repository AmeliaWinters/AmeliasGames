/**
 * The recovery key as something a person can hold.
 *
 * An account is a 32 byte seed (see `src/client/account.ts`). This turns that
 * seed into 52 characters somebody can write on paper, read down a phone line
 * or type into a second device, and turns it back again.
 *
 * ## Why base32 and not twelve words
 *
 * Words transcribe better than characters and it is not close: a wordlist has
 * no ambiguous glyphs at all, and a phone call is easier. The cost is a 2048
 * word list, which is another 13KB in the bundle and another file that has to
 * be exactly right forever, since one edited word is every key minted after it
 * failing to decode. Crockford's alphabet gets most of the benefit for nothing:
 * no I, no L, no O, no U, so no letter-versus-digit confusion at the reading
 * end and no accidental word at the writing end. **If somebody reports that
 * reading a key aloud is still bad, the wordlist is the next thing to try, and
 * the format tag on the front is there so both can be read.**
 *
 * ## The checksum is four free bits
 *
 * 32 bytes is 256 bits and 52 characters carry 260, so four bits were going to
 * be padding. They hold a checksum instead, which costs no length at all and
 * turns most single-character slips into "that is not a key" at the moment of
 * typing rather than into a silent, valid-looking key for an account that does
 * not exist. It is a fold, not a hash, so this stays synchronous, and it is
 * not the real check: what proves an imported key is that the account it
 * derives can sign. See `importAccount`.
 */

/** Crockford's base32: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 32 bytes plus four checksum bits, at five bits a character. */
const KEY_CHARS = 52;

/** How the key is broken up on screen and on paper. 13 groups of 4. */
const GROUP = 4;

/**
 * A four bit fold over the seed.
 *
 * The multiply and the rotate are there so that two swapped bytes do not
 * cancel, which a plain sum would let them do, and transposition is the error
 * a person copying by hand actually makes.
 */
function checksum(seed: Uint8Array): number {
  let acc = 0;
  for (const byte of seed) acc = ((acc * 31 + byte) ^ (acc >>> 5)) & 0xffff;
  return acc & 0xf;
}

/** Bytes to the key, ungrouped. `formatRecoveryKey` adds the dashes. */
export function encodeRecoveryKey(seed: Uint8Array): string {
  if (seed.length !== 32) throw new RangeError('a seed is 32 bytes');
  let value = 0n;
  for (const byte of seed) value = (value << 8n) | BigInt(byte);
  value = (value << 4n) | BigInt(checksum(seed));
  // Appended, not prepended. Prepending while the shift counts down reverses
  // the string, and reversed keys still round trip through a reversed decoder,
  // so this is a bug that hides from any test that only checks the round trip.
  let text = '';
  for (let i = KEY_CHARS - 1; i >= 0; i--) {
    text += ALPHABET[Number((value >> BigInt(i * 5)) & 31n)];
  }
  return text;
}

/** The key in groups of four, which is how it goes on screen and into the file. */
export function formatRecoveryKey(seed: Uint8Array): string {
  const text = encodeRecoveryKey(seed);
  const groups: string[] = [];
  for (let i = 0; i < text.length; i += GROUP) groups.push(text.slice(i, i + GROUP));
  return groups.join('-');
}

/**
 * A typed key back to bytes, or null.
 *
 * Forgiving about everything that is not information: spaces, dashes, line
 * breaks and case all go, and the four glyphs Crockford dropped are folded
 * onto the digits they get mistaken for, so a hand-written O read back as a
 * zero still opens the account. Null on a wrong length or a failed checksum.
 */
export function decodeRecoveryKey(text: string): Uint8Array<ArrayBuffer> | null {
  const cleaned = text
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/[^0-9A-Z]/g, '');
  if (cleaned.length !== KEY_CHARS) return null;

  let value = 0n;
  for (const glyph of cleaned) {
    const digit = ALPHABET.indexOf(glyph);
    if (digit < 0) return null;
    value = value * 32n + BigInt(digit);
  }

  const claimed = Number(value & 0xfn);
  value >>= 4n;
  const seed = new Uint8Array(new ArrayBuffer(32));
  for (let i = 31; i >= 0; i--) {
    seed[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return checksum(seed) === claimed ? seed : null;
}

/**
 * Whether text looks like a recovery key rather than the old JSON export.
 *
 * Deliberately loose: it only has to tell the two import formats apart, and
 * `decodeRecoveryKey` is what actually judges. A JSON key starts with `{`, so
 * anything that does not is offered to the decoder.
 */
export function looksLikeRecoveryKey(text: string): boolean {
  return !text.trim().startsWith('{');
}
