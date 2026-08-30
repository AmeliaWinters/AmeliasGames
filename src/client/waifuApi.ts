/**
 * Rolling, arranging and reading the collection, from the client's side.
 *
 * `chestApi.ts` is the file this was written against and everything it says
 * applies here: plain HTTP rather than the socket **because the account menu
 * lives in the lobby and the lobby has no socket**, the nonce is minted before
 * the claim and the claim is signed over it, and a failed request is not a
 * failed roll. Read that file first; only the differences are argued here.
 *
 * The difference is that there are three requests instead of one, and only the
 * first of them costs anything. `setShowcase` and `fetchCollection` still carry
 * a nonce, because the signature has to be pinned to something and a nonce is
 * the tightest thing available: a lifted `setShowcase` replays somebody's own
 * rearrangement, and a lifted `fetchCollection` reads a list its holder already
 * had.
 */
import { claimFor } from './account.js';
import { serverOrigin } from './net.js';
import type { ProfileView } from '../shared/profile.js';
import type { Waifu } from '../shared/waifu.js';

/** What the server says came out. Mirrors `RollResult`, less the profile. */
export interface Rolled {
  pulled: Waifu | null;
  duplicate: boolean;
  /** What it actually cost, after any duplicate refund. Zero on a credit. */
  paid: number;
  refusal: 'too-poor' | 'empty' | null;
  repeat: boolean;
  claimed: string[];
  profile: ProfileView;
}

/** Everything that can go wrong before the server gets an opinion. */
export type WaifuError = 'no-account' | 'offline' | 'refused';

export type Answer<T> = { ok: true; result: T } | { ok: false; error: WaifuError };

/**
 * A nonce the signing payload will accept.
 *
 * Uppercase hex because `payloadFor` upper-cases whatever it is handed, so a
 * lowercase nonce would be signed as one string and verified as another. The
 * same function as `chestApi.mintNonce` and deliberately a second copy rather
 * than an import: the two features share the server's receipt ring, and a
 * change to the alphabet on one side that did not reach the other would be a
 * signature failure presenting as a broken key. Two call sites of six lines
 * that must agree, with `waifu.test.ts` holding the ring's tagging, is a
 * smaller risk than a shared helper either could quietly widen.
 */
export function mintNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Roll once. Never throws; every failure is a value.
 *
 * `nonce` is taken rather than made so a caller can retry with the one it
 * already used. Minting a fresh one on retry is the single change here that
 * would quietly charge somebody twice.
 */
export function rollWaifu(nonce: string): Promise<Answer<Rolled>> {
  return post<Rolled>('/account/waifu', nonce, {});
}

/** Set the three on show. Free, and the server repairs whatever it is sent. */
export function setShowcase(showcase: string[]): Promise<Answer<{ profile: ProfileView }>> {
  return post<{ profile: ProfileView }>('/account/showcase', mintNonce(), { showcase });
}

/** Every id this account has rolled, newest last. See `PLAYER_PATHS.collection`. */
/*
  The summary is optional on the way in, because this is a read and a read that
  answers with the ids alone is a valid answer to the question asked. Typing it
  as always present is what let a transport that omitted it hand `undefined` to
  a screen that stored it. See `WaifuGacha`'s `onCollection`.
*/
export function fetchCollection(): Promise<Answer<{ claimed: string[]; profile?: ProfileView }>> {
  return post<{ claimed: string[]; profile?: ProfileView }>(
    '/account/collection',
    mintNonce(),
    {},
  );
}

/**
 * The one request shape all three share.
 *
 * A helper rather than three copies, unlike `chestApi.ts`, which is one
 * request and had nothing to share with. What is deliberately *not* hidden
 * here is the nonce: it is a parameter on the way in, because the roll's retry
 * turns on reusing one and a helper that minted its own would make that
 * impossible to express.
 */
async function post<T>(
  path: string,
  nonce: string,
  body: Record<string, unknown>,
): Promise<Answer<T>> {
  const claim = await claimFor(nonce);
  // No account means no collection, which is a different thing from a request
  // that failed and must not be offered a retry.
  if (!claim) return { ok: false, error: 'no-account' };

  try {
    const answer = await fetch(`${serverOrigin()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim, nonce, ...body }),
    });
    if (!answer.ok) return { ok: false, error: answer.status === 401 ? 'no-account' : 'refused' };
    return { ok: true, result: (await answer.json()) as T };
  } catch {
    // A thrown fetch is a network failure rather than a rejection, and it is
    // the case where the write may well have happened. The caller keeps the
    // nonce and offers a retry.
    return { ok: false, error: 'offline' };
  }
}
