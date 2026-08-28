/**
 * One scalar multiply on P-256, in about a hundred lines of BigInt.
 *
 * This exists for exactly one reason: WebCrypto will not derive a public key
 * from a private one. It will import a pkcs8 or a jwk and sign with it, but
 * there is no `getPublicKey`, so a private key on its own is not an account.
 * That is why the recovery key used to be a pair of base64 blobs in a JSON
 * file, and why nobody could read one out over the phone.
 *
 * Deriving the point ourselves buys back the short key: a 32 byte seed becomes
 * the scalar, this file turns the scalar into the point, and the pair is
 * rebuilt from a string a person can say. See `seedToKeyPair` in
 * `src/client/account.ts` for where it is called.
 *
 * ## What this is not
 *
 * It is not a general curve library and it must not become one. It runs twice
 * in the life of an account, at create and at import, on a scalar the device
 * itself just generated, and it never touches a value an attacker chose.
 * **Signing stays on WebCrypto.** So the timing side channels a real
 * implementation spends its complexity on are not in the threat model here:
 * double-and-add branches on the bits of the secret, and that is fine when the
 * secret is local and the attacker is not in the process. If anything ever
 * wants to multiply a point somebody else supplied (ECDH, a shared secret, key
 * agreement of any kind), this is the wrong file and the answer is a real
 * library.
 */

/** The field. p = 2^256 - 2^224 + 2^192 + 2^96 - 1. */
const P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn;

/** The group order, and so the range a private scalar has to land in. */
export const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/*
 * a is -3 on this curve, and there is no constant for it because nothing ever
 * multiplies by it: -3 is exactly the value that lets `double` factor
 * 3x^2 + a*z^4 into 3(x - z^2)(x + z^2). The curve's b never appears either,
 * since nothing here is checked back onto the equation.
 */

/** The base point. */
const GX = 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n;
const GY = 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n;

/** Positive mod. BigInt `%` keeps the sign of the dividend, which is never wanted here. */
function mod(x: bigint): bigint {
  const r = x % P;
  return r < 0n ? r + P : r;
}

/**
 * Inverse by Fermat rather than by extended Euclid.
 *
 * p is prime so x^(p-2) is the inverse, and it is one call to the exponent
 * ladder below instead of a second loop to get wrong. It is slower, and it
 * runs once per key derivation.
 */
function inverse(x: bigint): bigint {
  let result = 1n;
  let base = mod(x);
  let exp = P - 2n;
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base);
    base = mod(base * base);
    exp >>= 1n;
  }
  return result;
}

/**
 * A point in Jacobian coordinates, where the affine point is (x/z^2, y/z^3).
 *
 * Jacobian rather than affine so the ladder never divides: one inversion at
 * the end instead of one per bit, which is the difference between a derivation
 * you do not notice and one you do.
 */
interface Jacobian {
  x: bigint;
  y: bigint;
  z: bigint;
}

/** z = 0 is the point at infinity, the identity the ladder starts from. */
const INFINITY: Jacobian = { x: 1n, y: 1n, z: 0n };

function double(p: Jacobian): Jacobian {
  if (p.z === 0n || p.y === 0n) return INFINITY;
  const ysq = mod(p.y * p.y);
  const s = mod(4n * p.x * ysq);
  const zsq = mod(p.z * p.z);
  // The a = -3 shortcut: 3x^2 + a*z^4 factors to 3(x - z^2)(x + z^2).
  const m = mod(3n * mod(p.x - zsq) * mod(p.x + zsq));
  const x = mod(m * m - 2n * s);
  return {
    x,
    y: mod(m * (s - x) - 8n * mod(ysq * ysq)),
    z: mod(2n * p.y * p.z),
  };
}

function add(p: Jacobian, q: Jacobian): Jacobian {
  if (p.z === 0n) return q;
  if (q.z === 0n) return p;
  const pz2 = mod(p.z * p.z);
  const qz2 = mod(q.z * q.z);
  const u1 = mod(p.x * qz2);
  const u2 = mod(q.x * pz2);
  const s1 = mod(p.y * qz2 * q.z);
  const s2 = mod(q.y * pz2 * p.z);
  const h = mod(u2 - u1);
  const r = mod(s2 - s1);
  // Same point: the chord is a tangent and the formula below divides by zero.
  if (h === 0n) return r === 0n ? double(p) : INFINITY;
  const h2 = mod(h * h);
  const h3 = mod(h2 * h);
  const u1h2 = mod(u1 * h2);
  const x = mod(r * r - h3 - 2n * u1h2);
  return {
    x,
    y: mod(r * (u1h2 - x) - s1 * h3),
    z: mod(h * p.z * q.z),
  };
}

/**
 * k*G, as affine (x, y).
 *
 * Plain double-and-add over the bits of k. See the header for why the branch
 * on a secret bit is acceptable here and nowhere else.
 */
export function basePointMultiply(k: bigint): { x: bigint; y: bigint } {
  if (k <= 0n || k >= N) throw new RangeError('scalar out of range');
  let acc = INFINITY;
  let addend: Jacobian = { x: GX, y: GY, z: 1n };
  let rest = k;
  while (rest > 0n) {
    if (rest & 1n) acc = add(acc, addend);
    addend = double(addend);
    rest >>= 1n;
  }
  if (acc.z === 0n) throw new Error('k*G came out at infinity, which cannot happen for k < n');
  const zi = inverse(acc.z);
  const zi2 = mod(zi * zi);
  return { x: mod(acc.x * zi2), y: mod(acc.y * zi2 * zi) };
}

/** A field element as the fixed 32 bytes every P-256 encoding wants. Leading zeros kept. */
export function toFieldBytes(value: bigint): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(32));
  let rest = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return bytes;
}

export function fromFieldBytes(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}
