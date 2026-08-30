/**
 * The word rows this browser was last sent, kept so the lobby can draw them.
 *
 * The same bargain as `profileCache.ts`, one size up, and made for the same
 * reason: **the lobby has no socket.** The profile panel lives on the shelf,
 * the Vocabulary screen opens out of it, and neither of them is in a room. A
 * ledger only ever arrives down a socket, so the screen either draws a stored
 * copy or draws nothing at all, and nothing at all is not a feature.
 *
 * Refreshed at the one moment it can be: a game has just been filed, the
 * server has pushed the new summary, and the socket is still open. That is
 * also the only moment the ledger *changed*, so a copy taken then is stale
 * only in the sense that it does not know about a game played on another
 * device. Same three consequences as the summary cache, and the same verdict
 * on each:
 *
 * - **It is stale.** It says what was true after your last game here. For a
 *   list of words you have learned, that is close enough to never wrong: words
 *   are added to it, and a missing row understates rather than overstates.
 * - **It works with no server at all**, which is the Android build's whole
 *   case for existing. Somebody on a train can read their own vocabulary.
 * - **It is not authority.** The server owns the ledger. When a socket is
 *   live the screen asks and draws the answer; this is what it falls back to.
 *
 * One entry per language rather than one blob, because the screen shows one
 * language at a time and a player studying Japanese should not be paying to
 * write out their Polish. Carries the `?as=` suffix for the reason every other
 * key here does: two tabs driving both sides of a game are two players.
 */
import type { Known, LearnLang } from '../shared/profile.js';

/**
 * How many rows of one language are kept.
 *
 * A busy year of Word Chain is a few thousand rows at about eighty bytes, so
 * the whole ledger would fit -- but it would be written out on every game
 * finish, on a phone, and `localStorage` writes are synchronous on the main
 * thread. Twelve hundred is more than anybody has and small enough that the
 * write is not felt. `vocabOf` sorts learned words first, so the cut comes off
 * the end nobody scrolls to.
 */
export const VOCAB_CACHE_CAP = 1200;

interface Stored {
  words: Known[];
  /** When this copy was taken, so the screen can say it is showing one. */
  at: number;
}

function storageKey(lang: LearnLang): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return `ag.vocab.${lang}${suffix ? `.${suffix}` : ''}`;
}

/**
 * The cached rows for one language, or null.
 *
 * Null before the first game, null for a guest, and null for anything at all
 * that has gone wrong with the stored blob. A screen is not the place to
 * discover a parse error and the answer to every one of those cases is the
 * same: ask the socket, or say there is nothing here yet.
 */
export function loadVocabCache(lang: LearnLang): Stored | null {
  try {
    const raw = localStorage.getItem(storageKey(lang));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    return Array.isArray(parsed?.words) ? { words: parsed.words, at: Number(parsed.at) || 0 } : null;
  } catch {
    return null;
  }
}

export function saveVocabCache(lang: LearnLang, words: Known[], at: number): void {
  try {
    localStorage.setItem(storageKey(lang), JSON.stringify({ words: words.slice(0, VOCAB_CACHE_CAP), at }));
  } catch {
    /* a full or disabled store is not a reason to interrupt a game */
  }
}

/** Forget every language. Paired with signing out, like the summary cache. */
export function clearVocabCache(langs: readonly LearnLang[]): void {
  for (const lang of langs) localStorage.removeItem(storageKey(lang));
}
