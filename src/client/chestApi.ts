/**
 * Buying a chest, from the client's side.
 *
 * One request, and it is the only one this app makes that changes a profile
 * without a game having been played. It goes over plain HTTP rather than the
 * socket **because the chest screen lives in the account menu and the account
 * menu lives in the lobby**, which has no socket at all. See `net.ts`.
 *
 * Two things are worth knowing before changing anything here.
 *
 * **The nonce is minted before the claim, and the claim is signed over it.**
 * `claimFor` normally signs a room code, which pins a signature to one room;
 * here there is no room, so it signs the nonce under the `chest` scope and the
 * signature is pinned to one press of one button. That is tighter than the
 * room case, and it is why a lifted request is harmless: replaying it reopens
 * the same chest, and reopening the same chest is idempotent by design.
 *
 * The scope is what keeps the two apart. Before it, only the nonce being
 * longer than a room code stopped a hello signature opening a chest.
 *
 * **A failed request is not a failed chest.** The commonest failure is the
 * response going missing after the server has already written, so this retries
 * with the *same* nonce rather than a fresh one, and the second attempt comes
 * back with `repeat: true` and the original drop. Minting a new nonce on retry
 * is the one change here that would quietly charge somebody twice.
 */
import { claimFor } from './account.js';
import { serverOrigin } from './net.js';
import type { ProfileView } from '../shared/profile.js';

/** What the server says came out. Mirrors `ChestResult`, less the profile. */
export interface ChestOpened {
  drop: string | null;
  /** The set's floor, on its first chest. Empty afterwards. */
  granted: string[];
  refusal: 'no-such-set' | 'too-poor' | 'complete' | null;
  repeat: boolean;
  owned: string[];
  profile: ProfileView;
}

/** Everything that can go wrong before the server gets an opinion. */
export type ChestError = 'no-account' | 'offline' | 'refused';

/**
 * A nonce the signing payload will accept.
 *
 * Uppercase hex because `payloadFor` upper-cases whatever it is handed, so a
 * lowercase nonce would be signed as one string and verified as another. That
 * is a one-character bug that would look like a broken key, so the alphabet is
 * constrained here rather than trusted.
 */
export function mintNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Open one chest. Never throws; every failure is a value.
 *
 * `nonce` is taken rather than made so a caller can retry with the one it
 * already used. See the note at the top: this is the whole of the
 * double-charge defence on this side.
 */
export async function openChest(
  set: string,
  nonce: string,
): Promise<{ ok: true; result: ChestOpened } | { ok: false; error: ChestError }> {
  // Signed under the chest scope, not the room one: see `ClaimScope`. The two
  // used to be separated only by the nonce being longer than a room code.
  const claim = await claimFor(nonce, 'chest');
  // No account means no wardrobe to open, which is a different thing from a
  // request that failed and must not be offered a retry.
  if (!claim) return { ok: false, error: 'no-account' };

  try {
    const response = await fetch(`${serverOrigin()}/account/chest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claim, nonce, set }),
    });
    if (!response.ok) return { ok: false, error: response.status === 401 ? 'no-account' : 'refused' };
    return { ok: true, result: (await response.json()) as ChestOpened };
  } catch {
    // A thrown fetch is a network failure rather than a rejection, and it is
    // the case where the write may well have happened. The caller keeps the
    // nonce and offers a retry.
    return { ok: false, error: 'offline' };
  }
}
