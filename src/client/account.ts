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
 */
import { accountIdFor, fromBase64Url, payloadFor, toBase64Url } from '../shared/account.js';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const;

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

/** A key pair, as it is stored: two base64url strings. */
interface StoredKeys {
  /** pkcs8, the secret half. This string *is* the account. */
  priv: string;
  /** raw, the half the server checks signatures against. */
  pub: string;
}

export interface Account {
  id: string;
  /** base64url of the raw public key, sent with every claim. */
  key: string;
  /** Signs the payload for one room. See `payloadFor`. */
  sign(code: string): Promise<string>;
}

function read(): StoredKeys | null {
  try {
    const raw = localStorage.getItem(keyFor('account'));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredKeys>;
    return typeof parsed.priv === 'string' && typeof parsed.pub === 'string'
      ? { priv: parsed.priv, pub: parsed.pub }
      : null;
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
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const keys: StoredKeys = {
    priv: toBase64Url(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    pub: toBase64Url(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
  write(keys);
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
      sign: async (code: string) =>
        toBase64Url(await crypto.subtle.sign(SIGNING, priv, payloadFor(id, code))),
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
export async function claimFor(code: string): Promise<{ id: string; key: string; sig: string } | undefined> {
  const account = await loadAccount();
  if (!account) return undefined;
  try {
    return { id: account.id, key: account.key, sig: await account.sign(code) };
  } catch {
    return undefined;
  }
}

/**
 * Take an account over from another device, or from a backup.
 *
 * The second-device story in one function: paste the recovery key and this
 * browser *is* that account. No pairing, no code, no third object to broker
 * it. That is a real simplification and it costs one thing worth stating — the
 * key travels through wherever the player pastes it, so the advice on the
 * screen has to be to move it somewhere private rather than to message it to
 * themselves.
 *
 * Takes both halves, because WebCrypto cannot derive a public key from a
 * pkcs8 import. That is why `exportAccount` writes out a pair rather than the
 * one secret string it would be nicer to hand somebody.
 */
export async function importAccount(text: string): Promise<Account | null> {
  try {
    const parsed = JSON.parse(text) as Partial<StoredKeys>;
    if (typeof parsed.priv !== 'string' || typeof parsed.pub !== 'string') return null;
    // Proved before it is stored, so a mistyped or truncated paste fails here
    // rather than silently becoming an account that cannot sign anything and
    // is therefore permanently a guest without ever saying so.
    const priv = await crypto.subtle.importKey(
      'pkcs8',
      fromBase64Url(parsed.priv),
      ALGORITHM,
      false,
      ['sign'],
    );
    const id = await accountIdFor(fromBase64Url(parsed.pub));
    const pub = await crypto.subtle.importKey('raw', fromBase64Url(parsed.pub), ALGORITHM, false, [
      'verify',
    ]);
    const sig = await crypto.subtle.sign(SIGNING, priv, payloadFor(id, 'TEST'));
    if (!(await crypto.subtle.verify(SIGNING, pub, sig, payloadFor(id, 'TEST')))) return null;

    write({ priv: parsed.priv, pub: parsed.pub });
    return await loadAccount();
  } catch {
    return null;
  }
}

/**
 * The recovery key: both halves of the pair, as the text `importAccount` reads.
 *
 * **This is the account.** Anybody holding it is the account holder, and
 * anybody who has lost it has lost the account — there is nobody to appeal to,
 * because there is no email address and no password on file, which is the same
 * property that makes this system hold no personal data at all. The screen
 * that shows this should say that in those words rather than in the language
 * of security.
 *
 * Both halves rather than just the secret one, because WebCrypto will not
 * derive a public key from a pkcs8 import, so a private key alone is not
 * enough to rebuild an account. It is JSON rather than a word list for a
 * duller reason: a BIP39-style phrase would be far kinder to transcribe and it
 * is a real amount of machinery — wordlist, checksum, a seed the key is
 * derived from rather than generated — and shipping *something* recoverable on
 * the first day beats shipping the nicer thing on some later one. This is the
 * function to revisit.
 */
export function exportAccount(): string | null {
  const keys = read();
  return keys === null ? null : JSON.stringify(keys, null, 2);
}

/**
 * The same key with the whitespace taken out, for the QR.
 *
 * Not a formatting preference. A QR's size is decided by how many bytes go
 * into it in steps, and the indentation `exportAccount` adds for a human
 * reading a file is about twenty bytes that push this payload over one of
 * those steps, costing four modules of grid on a code that a phone camera has
 * to resolve across a room. Same JSON, same `importAccount` on the other end.
 */
export function exportCompact(): string | null {
  const keys = read();
  return keys === null ? null : JSON.stringify(keys);
}

/** Forget this browser's account. The key is gone; anything not exported is gone with it. */
export function forgetAccount(): void {
  localStorage.removeItem(keyFor('account'));
}
