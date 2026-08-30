/**
 * What this browser was last told the account owns.
 *
 * The same bargain as `profileCache.ts` and `vocabCache.ts`, and made for the
 * same reason: **the lobby has no socket**, the customiser opens off the
 * account menu, and a wardrobe that could only be drawn while a game was
 * running would be a wardrobe nobody could look at.
 *
 * Unlike those two, this one has a live read it can fall back on. Chests are
 * opened over `/account/chest`, which is plain HTTP and works from the lobby,
 * and every one of those responses carries the whole owned list back. So the
 * cache is refreshed by the act that changes it, and the only way it goes
 * stale is a chest opened on another device.
 *
 * **It is not authority.** The server owns the list; every part the customiser
 * draws as owned is checked against it again the moment anything is spent.
 * What a tampered cache buys is a locked item that looks unlocked until the
 * page reloads, which is a cosmetic lie to yourself rather than an exploit.
 *
 * Carries the `?as=` suffix like every other per-browser store here: two tabs
 * driving both seats of a game are two players.
 */

function storageKey(): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return `ag.wardrobe${suffix ? `.${suffix}` : ''}`;
}

/**
 * The stored list, or null for a browser that has never been told.
 *
 * Null rather than an empty array, because the two mean different things to
 * the customiser: nothing stored means "ask, and draw the starter set until
 * the answer arrives", while an empty list is a real answer about an account
 * that owns nothing at all, which no account does past its first chest.
 */
export function loadWardrobe(): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return null;
  }
}

export function saveWardrobe(owned: string[]): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(owned));
  } catch {
    /* a full or disabled store is not a reason to interrupt anything */
  }
}
