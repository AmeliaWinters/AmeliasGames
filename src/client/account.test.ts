// @vitest-environment jsdom
/**
 * The seed, the curve and the account they rebuild.
 *
 * The point of this file is the one thing WebCrypto cannot check for itself:
 * that the public point `p256.ts` derives really is the point for the scalar
 * the seed produced. Nothing asserts a coordinate. Instead the derived pair is
 * handed back to WebCrypto, which signs with the private half and verifies
 * with the public one, so a wrong point fails the same way a wrong point would
 * fail in a room.
 *
 * The rest is the promise the recovery key makes: the same key gives the same
 * account, on this device or another one, and the JSON pairs this app exported
 * before seeds existed still open the accounts behind them.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createAccount,
  exportAccount,
  exportCompact,
  forgetAccount,
  hasAccount,
  importAccount,
  loadAccount,
} from './account.js';
import { payloadFor, verifyClaim } from '../shared/account.js';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

/**
 * A store by hand, for the reason `profileGames.test.tsx` sets out: Node's own
 * `localStorage` wins the global lookup under jsdom and throws unless the
 * process was started with a file behind it, and jsdom's is not reachable past
 * it. Four methods is the whole of what `account.ts` touches.
 */
beforeAll(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
});

beforeEach(() => {
  localStorage.clear();
});

describe('an account from a seed', () => {
  it('signs a claim the server accepts', async () => {
    const account = await createAccount();
    const sig = await account.sign('ABCD');
    expect(await verifyClaim({ id: account.id, key: account.key, sig }, 'abcd')).toBe(account.id);
  });

  it('derives the public point that matches the private scalar', async () => {
    // The whole reason `p256.ts` exists, checked the only way that counts:
    // WebCrypto signs with the derived private half and verifies against the
    // derived public half. A scalar multiply that is off by anything at all
    // produces a point that cannot verify its own signature.
    const account = await createAccount();
    const raw = new Uint8Array(
      Uint8Array.from(atob(account.key.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0),
      ),
    );
    expect(raw.length).toBe(65);
    expect(raw[0]).toBe(0x04);
    const pub = await crypto.subtle.importKey('raw', raw, ALGORITHM, false, ['verify']);
    const sig = Uint8Array.from(
      atob((await account.sign('ROOM')).replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0),
    );
    expect(await crypto.subtle.verify(SIGNING, pub, sig, payloadFor(account.id, 'ROOM'))).toBe(true);
  });
});

describe('the recovery key', () => {
  it('is short enough to say out loud', async () => {
    await createAccount();
    const key = exportAccount();
    expect(key).not.toBeNull();
    // 52 characters and 12 dashes. The number is here so that a change which
    // makes the key longer has to be a decision rather than a side effect.
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){12}$/);
    expect(exportCompact()).toHaveLength(52);
  });

  it('rebuilds the same account on another device', async () => {
    const first = await createAccount();
    const key = exportAccount();
    expect(key).not.toBeNull();

    // The other device: nothing in storage at all.
    forgetAccount();
    expect(hasAccount()).toBe(false);

    const second = await importAccount(key as string);
    expect(second).not.toBeNull();
    expect(second?.id).toBe(first.id);
    expect(second?.key).toBe(first.key);
    // Same account, and it can still prove it.
    const sig = await (second as NonNullable<typeof second>).sign('ZZZZ');
    expect(await verifyClaim({ id: first.id, key: first.key, sig }, 'ZZZZ')).toBe(first.id);
  });

  it('is read back however somebody happens to type it', async () => {
    const first = await createAccount();
    const key = exportAccount() as string;
    forgetAccount();
    const typed = ` ${key.replace(/-/g, ' ').toLowerCase()} \n`;
    expect((await importAccount(typed))?.id).toBe(first.id);
  });

  it('refuses a key with a character wrong instead of making a new account', async () => {
    await createAccount();
    const key = exportAccount() as string;
    // Every single-character slip, at every position, rather than one slip at
    // one position on one freshly generated key. That version of this test
    // failed about one run in sixteen and looked like a real bug each time:
    // the checksum is four bits, so a *given* corruption has a 1-in-16 chance
    // of checksumming clean, and a random one is a coin the suite was tossing
    // on every run. Counted rather than demanded, because four bits cannot
    // catch everything and a test claiming otherwise would be lying.
    let missed = 0;
    let tried = 0;
    for (let at = 0; at < key.length; at++) {
      if (key[at] === '-') continue;
      for (const ch of ['0', '7', 'K', 'Z']) {
        if (ch === key[at]) continue;
        tried++;
        if ((await importAccount(key.slice(0, at) + ch + key.slice(at + 1))) !== null) missed++;
      }
    }
    // Four bits is one in sixteen, and the fold is not a hash, so this is
    // "close to the theoretical rate" rather than a promise about any one key.
    // Four bits is one in sixteen at worst, and measured over the ~200 slips
    // above it sits at three to seven percent, because a good many corruptions
    // also break the length or hit a character Crockford does not have. The
    // threshold is set clear of that spread rather than against the mean: this
    // test is here to catch the checksum being *dropped*, and a flaky one that
    // fails a run in twenty would get deleted long before it ever caught it.
    expect(tried).toBeGreaterThan(100);
    expect(missed / tried).toBeLessThan(0.12);

    expect(await importAccount('')).toBeNull();
    expect(await importAccount('not a key at all')).toBeNull();
  });
});

describe('accounts minted before seeds existed', () => {
  /** What `createAccount` used to write: a generated pair, and no seed. */
  async function legacyPair(): Promise<string> {
    const generated = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
    const pair = generated as Extract<typeof generated, { privateKey: unknown }>;
    const b64 = (buffer: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return JSON.stringify({
      priv: b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
      pub: b64(await crypto.subtle.exportKey('raw', pair.publicKey)),
    });
  }

  it('still import, and still export the pair that is their only copy', async () => {
    const json = await legacyPair();
    const account = await importAccount(json);
    expect(account).not.toBeNull();

    // No seed to print, so the export has to stay the JSON. Handing one of
    // these players a 52 character key would mean minting them a new account
    // and losing every word behind the old one.
    const exported = exportAccount();
    expect(exported).not.toBeNull();
    expect(JSON.parse(exported as string)).toEqual(JSON.parse(json));

    // And it round trips again, so nothing about the new path has eaten them.
    forgetAccount();
    expect((await importAccount(exported as string))?.id).toBe(account?.id);
  });

  it('refuse a pair whose halves do not go together', async () => {
    const a = JSON.parse(await legacyPair()) as { priv: string; pub: string };
    const b = JSON.parse(await legacyPair()) as { priv: string; pub: string };
    expect(await importAccount(JSON.stringify({ priv: a.priv, pub: b.pub }))).toBeNull();
    // And nothing was stored on the way to saying no.
    expect(hasAccount()).toBe(false);
  });
});

describe('what is on the device', () => {
  it('is nothing at all until somebody asks for an account', async () => {
    expect(hasAccount()).toBe(false);
    expect(await loadAccount()).toBeNull();
    expect(exportAccount()).toBeNull();
    expect(exportCompact()).toBeNull();
  });
});
