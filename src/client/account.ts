/**
 * This browser's account, and the key that proves it.
 *
 * The private key never leaves the device except when the player asks for it,
 * which is the whole of the recovery story. See `src/shared/account.ts` for
 * why it is a keypair rather than a password, and why P-256 rather than
 * Ed25519.
 *
 * ## Everything here is optional
 *
 * There is no sign-up wall, no account screen between the lobby and the game,
 * and no moment where somebody is asked to make a decision about identity
 * before they can play. `index.html` advertises "no accounts" and that is a
 * specification: a player who never touches any of this gets exactly the app
 * they had before, and a guest sitting down beside somebody signed in costs
 * that person nothing.
 *
 * ## Losing it
 *
 * Losing the key loses the account, and the screen that shows it should say so
 * in those words rather than in the language of security. That is the cost of
 * having no email and no password, and it is why `exportAccount` shipped before
 * any of the rest of this did.
 *
 * The key it hands over is 52 characters, because the pair is derived from a
 * 32 byte seed rather than generated. `p256.ts` is the one piece of curve
 * arithmetic that makes that possible, and the comment at the top of it is
 * where the trade is written down. Signing never leaves WebCrypto.
 */
import { accountIdFor, fromBase64Url, payloadFor, toBase64Url } from '../shared/account.js';
import type { ClaimScope } from '../shared/account.js';
import { basePointMultiply, fromFieldBytes, N, toFieldBytes } from '../shared/p256.js';
import {
  decodeRecoveryKey,
  encodeRecoveryKey,
  formatRecoveryKey,
  looksLikeRecoveryKey,
} from '../shared/recoveryKey.js';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** The whole account, in bytes. 256 bits, which is what P-256 has to spend. */
const SEED_BYTES = 32;

/** Prefix on the seed before it is hashed, so this derivation can never collide with another. */
const DERIVATION = 'ag1/p256/';

/**
 * Seed to private scalar.
 *
 * A P-256 scalar is a number in [1, n-1] and n is not a power of two, so
 * reading 32 random bytes as a number and using it directly is very slightly
 * biased and, once in about 2^32 tries, out of range outright. Hashing with a
 * counter and rejecting anything out of range is the standard fix and costs
 * one SHA-256 in the overwhelming case. The counter is in the hash rather than
 * the loop being over fresh randomness, because the whole point is that a seed
 * derives the same account every time, on every device, forever.
 */
async function scalarFromSeed(seed: Uint8Array): Promise<bigint> {
  for (let counter = 0; counter < 256; counter++) {
    const input = new TextEncoder().encode(`${DERIVATION}${counter}|`);
    const message = new Uint8Array(new ArrayBuffer(input.length + seed.length));
    message.set(input);
    message.set(seed, input.length);
    const candidate = fromFieldBytes(
      new Uint8Array(await crypto.subtle.digest('SHA-256', message)),
    );
    if (candidate > 0n && candidate < N) return candidate;
  }
  // Unreachable short of SHA-256 being broken; thrown rather than looped
  // forever so a bug here looks like a bug instead of a hang.
  throw new Error('no valid scalar after 256 tries');
}

/**
 * The stored pair a seed produces.
 *
 * The scalar multiply in `p256.ts` is the step WebCrypto cannot do. Once the
 * point is in hand this hands the whole thing straight back to WebCrypto as a
 * jwk and asks it for the pkcs8 and raw encodings, so the bytes that end up in
 * storage are WebCrypto's own and nothing downstream can tell a seeded account
 * from a generated one. Extractable, for the same reason `localStorage` is the
 * store: durability beats secrecy here.
 */
async function keysFromSeed(seed: Uint8Array): Promise<StoredKeys> {
  const scalar = await scalarFromSeed(seed);
  const point = basePointMultiply(scalar);
  const x = toFieldBytes(point.x);
  const y = toFieldBytes(point.y);
  const priv = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: toBase64Url(toFieldBytes(scalar)),
      x: toBase64Url(x),
      y: toBase64Url(y),
      ext: true,
    },
    ALGORITHM,
    true,
    ['sign'],
  );
  // 0x04 and the two coordinates, which is the raw encoding `verifyClaim`
  // expects. Built here rather than exported from a second import of the
  // public half, because building it is three lines and the import is a
  // round trip that can fail on its own.
  const raw = new Uint8Array(new ArrayBuffer(1 + x.length + y.length));
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 1 + x.length);
  return {
    seed: toBase64Url(seed),
    priv: toBase64Url(await crypto.subtle.exportKey('pkcs8', priv)),
    pub: toBase64Url(raw),
  };
}

/**
 * Where the key lives.
 *
 * `localStorage` rather than IndexedDB, which would let the key be stored as a
 * non-extractable `CryptoKey` and never be readable by script at all. That is
 * genuinely more secure and it is the wrong trade here: a non-extractable key
 * cannot be exported, and a key that cannot be exported is an account that
 * cannot be recovered or moved to a second device. **Durability beats
 * secrecy** in this system, and this is the line where that is decided rather
 * than merely stated.
 *
 * Carries the `?as=` suffix for the same reason `ag.playerId` and `ag.name`
 * do. Two tabs driving both sides of a game are two players, and one of them
 * finishing a round of Vocab Race must not land in the other's ledger.
 */
function keyFor(name: string): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return `ag.${name}${suffix ? `.${suffix}` : ''}`;
}

/** A key pair, as it is stored: base64url strings. */
interface StoredKeys {
  /**
   * base64url of the 32 byte seed the pair was derived from, when there was
   * one. Absent on accounts minted before seeds existed, and that absence is
   * load-bearing: it is what tells `exportAccount` to keep handing those
   * players the old JSON pair, which is still the only thing that can rebuild
   * their account.
   */
  seed?: string;
  /** pkcs8, the secret half. Derived from `seed` where there is one. */
  priv: string;
  /** raw, the half the server checks signatures against. */
  pub: string;
}

export interface Account {
  id: string;
  /** base64url of the raw public key, sent with every claim. */
  key: string;
  /**
   * Signs the payload for one room, or for one chest nonce. See `payloadFor`
   * and `ClaimScope`: the scope is in the signed bytes, so a room signature
   * cannot be replayed as a chest one however the code length changes.
   */
  sign(code: string, scope?: ClaimScope): Promise<string>;
}

function read(): StoredKeys | null {
  try {
    const raw = localStorage.getItem(keyFor('account'));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredKeys>;
    if (typeof parsed.priv !== 'string' || typeof parsed.pub !== 'string') return null;
    return typeof parsed.seed === 'string'
      ? { seed: parsed.seed, priv: parsed.priv, pub: parsed.pub }
      : { priv: parsed.priv, pub: parsed.pub };
  } catch {
    return null;
  }
}

function write(keys: StoredKeys): void {
  localStorage.setItem(keyFor('account'), JSON.stringify(keys));
}

/** Whether this browser has an account at all. Cheap; does no crypto. */
export function hasAccount(): boolean {
  return read() !== null;
}

/**
 * Make one. Overwrites whatever was there, so callers must ask first.
 *
 * There is no server round trip and nothing to register: the account exists
 * the moment the key does, and the profile behind it is created by the first
 * game that gets filed against it. That is deliberate — an account that has to
 * be registered is an account that can fail to be registered, on a train, at
 * the moment somebody wanted to play a game.
 */
export async function createAccount(): Promise<Account> {
  const seed = new Uint8Array(new ArrayBuffer(SEED_BYTES));
  crypto.getRandomValues(seed);
  write(await keysFromSeed(seed));
  const account = await loadAccount();
  if (!account) throw new Error('the key that was just written could not be read back');
  return account;
}

/**
 * This browser's account, or null.
 *
 * Null on anything at all going wrong — no key, a corrupt key, a browser with
 * no WebCrypto — because every caller's answer to null is the same and it is
 * the right one: play as a guest. An identity system that can stop somebody
 * playing a game of Connect Four has been built wrong.
 */
export async function loadAccount(): Promise<Account | null> {
  const keys = read();
  if (!keys) return null;
  try {
    const raw = fromBase64Url(keys.pub);
    const id = await accountIdFor(raw);
    const priv = await crypto.subtle.importKey(
      'pkcs8',
      fromBase64Url(keys.priv),
      ALGORITHM,
      false,
      ['sign'],
    );
    return {
      id,
      key: keys.pub,
      sign: async (code: string, scope: ClaimScope = 'room') =>
        toBase64Url(await crypto.subtle.sign(SIGNING, priv, payloadFor(id, code, scope))),
    };
  } catch {
    return null;
  }
}

/**
 * The claim to put in a `hello`, or undefined.
 *
 * Undefined for a guest and undefined for anything that went wrong, and the
 * server treats the two identically. Called on every connect, including every
 * reconnect, because the signature is per-room and a reconnect may be to a
 * different room.
 */
export async function claimFor(
  code: string,
  scope: ClaimScope = 'room',
): Promise<{ id: string; key: string; sig: string } | undefined> {
  const account = await loadAccount();
  if (!account) return undefined;
  try {
    return { id: account.id, key: account.key, sig: await account.sign(code, scope) };
  } catch {
    return undefined;
  }
}

/**
 * Take an account over from another device, or from a backup.
 *
 * The second-device story in one function: type or paste the recovery key and
 * this browser *is* that account. No pairing, no code, no third object to
 * broker it. That is a real simplification and it costs one thing worth
 * stating: the key travels through wherever the player pastes it, so the
 * advice on screen has to be to move it somewhere private rather than to
 * message it to themselves.
 *
 * Reads both formats. A 52 character key is a seed and rebuilds the pair from
 * scratch; a JSON pair is what this app exported before seeds existed, and it
 * has to keep working, because for those accounts it is the only copy that can
 * ever open them. Nothing re-mints an old account as a seeded one: the seed a
 * key was never derived from cannot be recovered, and quietly issuing a *new*
 * account under the old one's screen is the worst possible way to fail.
 */
export async function importAccount(text: string): Promise<Account | null> {
  const keys = looksLikeRecoveryKey(text) ? await fromRecoveryKey(text) : fromLegacyJson(text);
  if (!keys) return null;
  // Proved before it is stored, so a mistyped or truncated key fails here
  // rather than silently becoming an account that cannot sign anything and is
  // therefore permanently a guest without ever saying so.
  if (!(await provesItself(keys))) return null;
  write(keys);
  return await loadAccount();
}

async function fromRecoveryKey(text: string): Promise<StoredKeys | null> {
  const seed = decodeRecoveryKey(text);
  if (!seed) return null;
  try {
    return await keysFromSeed(seed);
  } catch {
    return null;
  }
}

function fromLegacyJson(text: string): StoredKeys | null {
  try {
    const parsed = JSON.parse(text) as Partial<StoredKeys>;
    if (typeof parsed.priv !== 'string' || typeof parsed.pub !== 'string') return null;
    return { priv: parsed.priv, pub: parsed.pub };
  } catch {
    return null;
  }
}

/** Whether the secret half really signs for the public half. Never throws. */
async function provesItself(keys: StoredKeys): Promise<boolean> {
  try {
    const rawPub = fromBase64Url(keys.pub);
    const priv = await crypto.subtle.importKey('pkcs8', fromBase64Url(keys.priv), ALGORITHM, false, [
      'sign',
    ]);
    const pub = await crypto.subtle.importKey('raw', rawPub, ALGORITHM, false, ['verify']);
    const id = await accountIdFor(rawPub);
    const sig = await crypto.subtle.sign(SIGNING, priv, payloadFor(id, 'TEST'));
    return await crypto.subtle.verify(SIGNING, pub, sig, payloadFor(id, 'TEST'));
  } catch {
    return false;
  }
}

/**
 * The recovery key: 52 characters, in groups of four.
 *
 * **This is the account.** Anybody holding it is the account holder, and
 * anybody who has lost it has lost the account. There is nobody to appeal to,
 * because there is no email address and no password on file, which is the same
 * property that makes this system hold no personal data at all. The screen
 * that shows this should say that in those words rather than in the language
 * of security.
 *
 * It is short because the pair is derived from a seed rather than generated,
 * which is what `p256.ts` is for. Short enough to read down a phone, write on
 * paper and type in by hand, and one thing rather than two halves, which is
 * what makes "recovery key" honest language instead of "recovery JSON".
 *
 * Accounts minted before seeds existed still get the old JSON pair, because
 * there is no seed behind them to print and there is no way to invent one. So
 * a caller cannot assume a shape here, which is why the download stays a file
 * and the screen shows whatever this returns.
 */
export function exportAccount(): string | null {
  const keys = read();
  if (keys === null) return null;
  const seed = keys.seed ? fromBase64Url(keys.seed) : null;
  if (seed) return formatRecoveryKey(seed);
  return JSON.stringify({ priv: keys.priv, pub: keys.pub }, null, 2);
}

/**
 * The same key with the grouping taken out, for the QR.
 *
 * Not a formatting preference. A QR's size is decided by how many bytes go
 * into it in steps, and the dashes are twelve bytes that can push the
 * payload over one of those steps, costing modules of grid on a code a phone
 * camera has to resolve across a room. `importAccount` strips them anyway, so
 * they carry nothing. On a legacy account this is still the JSON, unindented,
 * and it is still much the larger code.
 */
export function exportCompact(): string | null {
  const keys = read();
  if (keys === null) return null;
  const seed = keys.seed ? fromBase64Url(keys.seed) : null;
  return seed ? encodeRecoveryKey(seed) : JSON.stringify({ priv: keys.priv, pub: keys.pub });
}

/** Forget this browser's account. The key is gone; anything not exported is gone with it. */
export function forgetAccount(): void {
  localStorage.removeItem(keyFor('account'));
}
