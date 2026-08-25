/**
 * Who somebody is, and how they prove it.
 *
 * An account here is **a keypair and a name**. No email, no password, no
 * recovery questions, no third-party sign-in. That is not minimalism for its
 * own sake: the threat model is nearly empty and the failure mode is not.
 *
 * What does a thief get? Fake experience points in a game their victim plays
 * with four friends. What does the *owner* lose by being locked out? Every word
 * they have learned. So this is a system where **durability matters more than
 * secrecy**, which is the opposite of the usual bias, and the design follows the
 * real risk rather than the reflex. Hence a recovery key the player keeps, and
 * an export button that shipped before the profile screen did.
 *
 * ## Why P-256 and not Ed25519
 *
 * Ed25519 is the better-behaved choice and it is not the available one. This
 * app ships as an Android APK through Capacitor, so it runs in whatever WebView
 * the device has, and `Ed25519` only reached browser WebCrypto recently. P-256
 * ECDSA has been in every implementation for a decade, in the browser, in
 * workerd and in Node. A signature scheme that fails to exist on a two-year-old
 * phone is not a security improvement.
 *
 * ## What the signature actually proves
 *
 * It proves possession of the private key for the account being claimed, and
 * that is all it is asked to prove. It carries **no freshness** — the same
 * signature works for the same account in the same room forever — and that is a
 * deliberate call rather than an oversight.
 *
 * A nonce would need either an extra round trip before `hello` (changing the
 * handshake for every player, including the ones with no account) or a
 * timestamp. A timestamp is the trap: this codebase already knows that a
 * device's clock can be minutes out — it is why `RoomView.now` exists — so a
 * freshness window narrow enough to be worth having is a window that locks out
 * people whose clock is simply wrong.
 *
 * And freshness would buy very little, because a signature never leaves the
 * TLS channel between one client and the server. `PlayerView` carries seat,
 * name and connected; no account id and no signature is ever broadcast to
 * another player. The attack this defends against is somebody who has learned
 * an account *id* — from an export file, or from a league table when those
 * arrive — trying to claim it, and a static signature stops that completely.
 *
 * The room code is in the signed payload anyway, so a signature is at least
 * pinned to one room. **If account ids ever become reachable another way, or a
 * signature ever travels anywhere but client-to-server, this is the comment to
 * come back to.**
 */

/** Prefix on the signed payload, so a signature can never be read as anything else. */
const DOMAIN = 'ag1';

/** Raw P-256 public keys are 65 bytes: an 0x04 tag and two 32-byte coordinates. */
const RAW_KEY_BYTES = 65;

/**
 * How many characters of the key's hash make an account id.
 *
 * Twenty-two base64url characters is 132 bits, which is far more than the
 * collision resistance this needs and is chosen for a duller reason: it is what
 * `idFromName` will be handed, so it wants to be short enough to log and long
 * enough that nobody ever thinks about collisions again.
 */
const ID_CHARS = 22;

export interface AccountClaim {
  /** The account id, which must be the hash of `key`. Checked, never trusted. */
  id: string;
  /** base64url of the raw public key. */
  key: string;
  /** base64url of the signature over `payloadFor`. */
  sig: string;
}

/** Whether a value has the shape of a claim. Says nothing about whether it is true. */
export function isClaim(value: unknown): value is AccountClaim {
  if (typeof value !== 'object' || value === null) return false;
  const claim = value as Partial<AccountClaim>;
  return (
    typeof claim.id === 'string' &&
    typeof claim.key === 'string' &&
    typeof claim.sig === 'string' &&
    claim.id.length === ID_CHARS &&
    claim.key.length > 0 &&
    claim.key.length < 200 &&
    claim.sig.length > 0 &&
    claim.sig.length < 200
  );
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Built over an explicit `ArrayBuffer` rather than the plain
 * `new Uint8Array(n)` this obviously wants to be.
 *
 * `crypto.subtle` takes a `BufferSource`, which since TypeScript 5.7 means an
 * `ArrayBufferView<ArrayBuffer>` specifically — a bare `Uint8Array` is typed
 * over `ArrayBufferLike`, which might be a `SharedArrayBuffer`, and does not
 * fit. Writing the buffer out is what pins the type, and it costs nothing.
 */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * What a client signs to claim an account in a room.
 *
 * The id is in it as well as the key, so a signature cannot be lifted onto a
 * different account id even if two ids somehow shared a key; the code is in it
 * so a signature is pinned to one room; and the domain prefix is in it so this
 * string can never collide with anything else this app might one day ask
 * somebody to sign.
 */
export function payloadFor(id: string, code: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(`${DOMAIN}|${id}|${code.toUpperCase()}`);
  // Copied for the same reason `fromBase64Url` builds its own buffer: what
  // `crypto.subtle` will accept is narrower than what `encode` hands back.
  const bytes = new Uint8Array(new ArrayBuffer(encoded.length));
  bytes.set(encoded);
  return bytes;
}

/** The account id a public key produces. The id is never taken on trust. */
export async function accountIdFor(rawKey: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', rawKey);
  return toBase64Url(digest).slice(0, ID_CHARS);
}

/**
 * Check a claim, and hand back the account id it proves, or null.
 *
 * **Async, which is why it is not in `session.ts`.** Everything in that module
 * is deliberately synchronous, because that is what lets the Durable Object —
 * whose engine arrives from storage, asynchronously — share it verbatim with a
 * dev server holding rooms in a `Map`. Verification cannot be synchronous, so
 * it lives here and both adapters await it before they call `admit`. The split
 * still falls where the `await` does; there is simply one more await.
 *
 * Never throws. A malformed key, a corrupt signature and an outright forgery
 * all come back as null, and null means "play as a guest" rather than "you may
 * not play": somebody whose key has gone wrong should still get their game of
 * Connect Four.
 */
export async function verifyClaim(claim: unknown, code: string): Promise<string | null> {
  if (!isClaim(claim)) return null;
  try {
    const raw = fromBase64Url(claim.key);
    if (raw.length !== RAW_KEY_BYTES) return null;

    // The id must be the hash of the key that signed. Without this check an
    // attacker could sign truthfully with their own key while claiming
    // somebody else's id, and the signature would verify perfectly.
    if ((await accountIdFor(raw)) !== claim.id) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromBase64Url(claim.sig),
      payloadFor(claim.id, code),
    );
    return ok ? claim.id : null;
  } catch {
    return null;
  }
}
