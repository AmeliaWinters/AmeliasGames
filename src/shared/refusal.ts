/**
 * Quoting a client's own words back at it, safely.
 *
 * A refusal that names what it refused beats one that does not: "No room with
 * code WXYZ" tells a player they typed W for V, where "No room with that code"
 * tells them only that something is wrong. But the name usually came off the
 * wire, so it is whatever a client chose to send, any length and any bytes,
 * and it ends up rendered to a *person* in a toast.
 *
 * So it is trimmed to what a sentence can carry, control characters are
 * dropped rather than displayed, and an empty one becomes a word rather than
 * an empty pair of quotes.
 */
const MAX_QUOTED = 24;

/** Control characters, which have no business in a message shown to a player. */
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\x00-\x1f\x7f]/g;

export function named(raw: unknown): string {
  // A number needs no quotes, and `column "99"` reads as though 99 might have
  // been a string all along.
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  const text = String(raw ?? '')
    .replace(UNPRINTABLE, '')
    .trim();
  if (!text) return 'nothing';
  return text.length > MAX_QUOTED ? `"${text.slice(0, MAX_QUOTED)}..."` : `"${text}"`;
}
