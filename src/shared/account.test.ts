import { describe, expect, it } from 'vitest';
import {
  accountIdFor,
  fromBase64Url,
  isClaim,
  payloadFor,
  toBase64Url,
  verifyClaim,
  type AccountClaim,
  type ClaimScope,
} from './account.js';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** A key pair and the claim it can make, the way the client builds one. */
async function makeAccount() {
  const generated = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  // Narrowed structurally rather than named. `@cloudflare/workers-types` types
  // `generateKey` as `CryptoKey | CryptoKeyPair` (for an asymmetric algorithm
  // it is always the pair, and the union is the type not knowing that), while
  // the shared config's lib has no `CryptoKeyPair` to name at all. This
  // compiles under both.
  const pair = generated as Extract<typeof generated, { privateKey: unknown }>;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  const key = toBase64Url(raw);
  const id = await accountIdFor(fromBase64Url(key));

  return {
    id,
    key,
    async claim(code: string, scope: ClaimScope = 'room'): Promise<AccountClaim> {
      const sig = await crypto.subtle.sign(SIGNING, pair.privateKey, payloadFor(id, code, scope));
      return { id, key, sig: toBase64Url(sig) };
    },
  };
}

describe('proving an account', () => {
  it('accepts a claim signed by the key it names', async () => {
    const account = await makeAccount();
    expect(await verifyClaim(await account.claim('ABCD'), 'ABCD')).toBe(account.id);
  });

  it('accepts it however the room code was cased', async () => {
    // The code is upper-cased into the payload on both sides, because `hello`
    // upper-cases it and a signature made against a lower-cased one would
    // verify on some paths and not others.
    const account = await makeAccount();
    expect(await verifyClaim(await account.claim('abcd'), 'ABCD')).toBe(account.id);
  });

  /**
   * The check the whole scheme rests on. Without it an attacker signs
   * truthfully with a key they really do own, while claiming somebody else's
   * id — and the signature verifies perfectly, because it is a real signature.
   */
  it('refuses an id that is not the hash of the key that signed', async () => {
    const mine = await makeAccount();
    const theirs = await makeAccount();
    const forged: AccountClaim = { ...(await mine.claim('ABCD')), id: theirs.id };
    expect(await verifyClaim(forged, 'ABCD')).toBeNull();
  });

  it('refuses a signature made for a different room', async () => {
    const account = await makeAccount();
    expect(await verifyClaim(await account.claim('ABCD'), 'WXYZ')).toBeNull();
  });

  it('refuses a signature from a different key', async () => {
    const mine = await makeAccount();
    const theirs = await makeAccount();
    const swapped: AccountClaim = { ...(await mine.claim('ABCD')), sig: (await theirs.claim('ABCD')).sig };
    expect(await verifyClaim(swapped, 'ABCD')).toBeNull();
  });

  /**
   * Null means "play as a guest", never "you may not play". An identity system
   * that can stop somebody having a game of Connect Four has been built wrong,
   * so every one of these has to be an answer rather than an exception.
   */
  it('answers null for anything malformed, and never throws', async () => {
    const account = await makeAccount();
    const good = await account.claim('ABCD');

    const junk: unknown[] = [
      undefined,
      null,
      0,
      'a string',
      [],
      {},
      { id: account.id },
      { ...good, sig: 'not base64 !!!' },
      { ...good, key: 'not base64 !!!' },
      { ...good, key: toBase64Url(new Uint8Array(64)) },
      { ...good, id: 'too-short' },
      { ...good, sig: '' },
    ];

    for (const value of junk) {
      await expect(verifyClaim(value, 'ABCD')).resolves.toBeNull();
    }
  });

  it('refuses a key that is not a P-256 point, whatever length it is', async () => {
    const account = await makeAccount();
    const good = await account.claim('ABCD');
    // Right length, wrong contents: 65 zero bytes is not a curve point, and
    // `importKey` is what has to notice rather than the length check.
    const bogus = { ...good, key: toBase64Url(new Uint8Array(65)) };
    expect(await verifyClaim(bogus, 'ABCD')).toBeNull();
  });
});

describe('the shape of a claim', () => {
  it('is checked before any crypto is attempted', async () => {
    const account = await makeAccount();
    expect(isClaim(await account.claim('ABCD'))).toBe(true);
    expect(isClaim({ id: account.id, key: account.key })).toBe(false);
    expect(isClaim(null)).toBe(false);
  });

  it('refuses absurdly long strings rather than handing them to WebCrypto', () => {
    // A hostile client can send anything at all; the length caps are what stop
    // a megabyte of base64 becoming a megabyte of work per socket.
    expect(isClaim({ id: 'x'.repeat(22), key: 'a'.repeat(5000), sig: 'a' })).toBe(false);
    expect(isClaim({ id: 'x'.repeat(22), key: 'a', sig: 'a'.repeat(5000) })).toBe(false);
  });
});

describe('base64url', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });

  it('produces nothing that needs escaping in a URL', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(toBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('gives two different keys two different ids', async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    expect(a.id).not.toBe(b.id);
    expect(a.id).toHaveLength(22);
  });
});

/**
 * The scopes, which exist because the two things this key signs were once
 * separated only by a coincidence of length.
 *
 * A room code is four characters and the chest nonce regex demands eight or
 * more, so no room code could be presented as a nonce. That is an accident of
 * two unrelated constants, not a property, and the day somebody widens
 * `CODE_LENGTH` to eight it stops being true silently and every hello claim a
 * server ever saw becomes a chest key. These tests are the thing that fails
 * instead.
 */
describe('what a signature is for', () => {
  it('refuses a room signature presented as a chest one', async () => {
    const account = await makeAccount();
    const forRoom = await account.claim('ABCDEFGH', 'room');
    expect(await verifyClaim(forRoom, 'ABCDEFGH', 'room')).toBe(account.id);
    // The same account, the same key, the same value, the same signature. Only
    // the scope differs, and that is enough.
    expect(await verifyClaim(forRoom, 'ABCDEFGH', 'chest')).toBeNull();
  });

  it('refuses a chest signature presented as a room one', async () => {
    const account = await makeAccount();
    const forChest = await account.claim('ABCDEFGH', 'chest');
    expect(await verifyClaim(forChest, 'ABCDEFGH', 'chest')).toBe(account.id);
    expect(await verifyClaim(forChest, 'ABCDEFGH', 'room')).toBeNull();
  });

  it('signs different bytes for the two scopes at the same value', () => {
    const room = payloadFor('anid', 'ABCDEFGH', 'room');
    const chest = payloadFor('anid', 'ABCDEFGH', 'chest');
    expect(new TextDecoder().decode(chest)).not.toBe(new TextDecoder().decode(room));
    // And the room scope is still the default, so every existing caller and
    // every signature already minted keeps working.
    expect(new TextDecoder().decode(payloadFor('anid', 'ABCDEFGH'))).toBe(
      new TextDecoder().decode(room),
    );
  });
});
