/**
 * Room codes, and nothing else.
 *
 * This module exists to have no imports. The client needs these helpers in
 * the lobby, and it used to reach them through `room.ts`, which imports the
 * game registry, which imports every reducer, including the Wheel of Fortune
 * answer bank. The bundler shook the answers back out, so nothing ever leaked,
 * but the secret rested on an optimisation rather than on structure. Keeping
 * this file import-free makes "the client's graph never reaches a reducer" a
 * fact instead of a hope.
 *
 * `room.ts` re-exports these so the adapters still import one thing.
 */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Four letters, so a code is easy to read out and easy to type. The whole
 * code space is walkable by anyone who wants to (there is no rate limiting, by
 * choice), so the space is the only defence: 23 letters to the fourth is 280k
 * codes, well down from the 887 million six mixed characters gave. Short codes
 * are the trade that was asked for.
 */
export const CODE_LENGTH = 4;

/** Room codes are letters only, and skip O and I so they survive being read aloud. */
export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * Validated against the generator's own alphabet, not merely [A-Z]. Digits, O
 * and I are never generated, so a code containing one is always a typo, and
 * better to say so at once than to send it off and come back with "no room".
 */
export function isRoomCode(value: string): boolean {
  return CODE_PATTERN.test(value);
}

/** Uppercase and drop anything that could never appear in a code. */
export function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, CODE_LENGTH);
}
