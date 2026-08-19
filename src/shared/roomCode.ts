/**
 * Room codes, and nothing else.
 *
 * This module exists to have no imports. The client needs these helpers to
 * validate and format a code in the lobby, and it used to reach them through
 * `room.ts` — which imports the game registry, which imports every reducer,
 * including the Wheel of Fortune answer bank. The bundler shook the answers
 * back out, so nothing ever leaked, but the secret rested on an optimisation
 * rather than on structure. Keeping this file free of imports is what makes
 * "the client's graph never reaches a reducer" a fact instead of a hope.
 *
 * `room.ts` re-exports these so the adapters can carry on importing one thing.
 */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Six characters, not four. The whole code space is walkable by anyone who
 * wants to — there is no rate limiting, by choice — and the only thing that
 * makes walking it pointless is its size. Four characters is 923k codes; six
 * is 887 million, for two more characters to read out.
 */
export const CODE_LENGTH = 6;

/** Room codes skip O/0 and I/1 so they survive being read aloud. */
export function makeRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * Validated against the generator's own alphabet, not merely [A-Z0-9]. O/0 and
 * I/1 are never generated, so a code containing one is always a typo — better
 * to say so at once than to send it off and come back with "no room".
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
