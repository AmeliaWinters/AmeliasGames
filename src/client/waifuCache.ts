/**
 * What this browser was last told the account has rolled.
 *
 * The same bargain as `wardrobeCache.ts`, made for the same reason: **the
 * lobby has no socket**, the gacha opens off the account menu, and a
 * collection that could only be drawn while a game was running would be a
 * collection nobody could look at.
 *
 * Like the wardrobe, this one has a live read to fall back on. `/account/waifu`
 * is plain HTTP and works from the lobby, and every roll's response carries the
 * whole claimed list back, so the cache is refreshed by the act that changes
 * it. The only way it goes stale is a roll made on another device.
 *
 * **It is not authority.** The server owns the list, and the showcase is
 * checked against it again on every write (see `legalShowcase`). What a
 * tampered cache buys is a character who looks claimed until the page reloads,
 * which is a lie to yourself rather than an exploit.
 *
 * Carries the `?as=` suffix like every other per-browser store here: two tabs
 * driving both seats of a game are two players.
 */

function storageKey(): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return `ag.waifu${suffix ? `.${suffix}` : ''}`;
}

/**
 * The stored list, or null for a browser that has never been told.
 *
 * Null rather than an empty array, because the two mean different things to
 * the screen: nothing stored means "ask, and draw nothing until the answer
 * arrives", while an empty list is a real answer about somebody who has never
 * rolled, and that person needs to be shown the button rather than a spinner.
 */
export function loadCollection(): string[] | null {
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

export function saveCollection(claimed: string[]): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(claimed));
  } catch {
    /* a full or disabled store is not a reason to interrupt anything */
  }
}
