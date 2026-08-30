/**
 * The last profile this browser was sent, kept so the lobby can draw one.
 *
 * The lobby has no socket. A profile only ever arrives down one — the server
 * pushes it on being welcomed and again when a finished game has been filed —
 * and by then you are in a room, which is the one screen that does not need to
 * ask you to come back. The screen that does is the shelf, before any of that.
 *
 * So the summary is cached, and the lobby draws the cached one. Three things
 * follow from that, and all three are fine:
 *
 * - **It is stale.** It says what was true when you last played. For "18 words
 *   due" that is close enough to useless-if-wrong and it is never wrong by
 *   much: a due count only ever goes *up* while you are away, so the number on
 *   the shelf understates rather than overstates, which is the right way round
 *   for a nudge.
 * - **It works with no server at all**, which the Android build cares about:
 *   the shelf renders on a train, and the count is the last one anybody knew.
 * - **It is not authority.** Nothing is decided from this. The server owns the
 *   ledger and re-sends the summary on every join, which is also what corrects
 *   it. If the two ever disagree, this one is wrong.
 *
 * Carries the `?as=` suffix for the same reason `ag.playerId` and the account
 * key do: two tabs driving both sides of a game are two players.
 */
import type { LearnLang, ProfileView } from '../shared/profile.js';
import { POINTS_FIRST_GAME_OF_DAY } from '../shared/review.js';

function storageKey(): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return `ag.profile${suffix ? `.${suffix}` : ''}`;
}

/**
 * The cached summary, or null.
 *
 * Null for a guest, null before the first game, and null for anything at all
 * that has gone wrong with the stored blob — a lobby is not the place to
 * discover a parse error, and the answer to every one of those cases is the
 * same: draw the shelf without a badge on it.
 */
export function loadProfileCache(): ProfileView | null {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileView;
    // A stored view from an older build can be missing anything. Only what the
    // lobby actually draws is checked, because that is what it would otherwise
    // render as `undefined` -- or, since the chip started wearing a level,
    // throw on: `rank` arrived after this cache did, so every blob written
    // before that deploy has none, and `profile.rank.level` on one of those is
    // a white lobby rather than a missing badge. Dropped and refetched, which
    // is what this function does with every other kind of stale.
    return typeof parsed?.due === 'number' &&
      typeof parsed?.words === 'number' &&
      typeof parsed?.xp === 'number' &&
      typeof parsed?.rank?.level === 'number'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveProfileCache(profile: ProfileView): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(profile));
  } catch {
    /* a full or disabled store is not a reason to interrupt a game */
  }
}

/** Forget it. Paired with signing out, so a shared device does not keep a badge. */
export function clearProfileCache(): void {
  localStorage.removeItem(storageKey());
}

/**
 * What one game did, by comparing the summary before it with the summary after.
 *
 * The end of a game is the moment to show somebody what it taught them, and
 * this is how that is worked out without putting a delta on the wire. The
 * server already sends the whole summary at exactly that moment; two summaries
 * subtract.
 *
 * Deliberately not a protocol message. A delta on the wire would be a second
 * thing that can disagree with the profile it describes, and it would have to
 * survive a reconnect — a player who was away when it arrived would never see
 * it, and re-sending it would need the room to remember what it had already
 * said. Subtracting two summaries has neither problem: the newer one is always
 * authoritative, and a client that missed the moment simply shows nothing,
 * which is the honest answer to "what did that game teach you" for somebody
 * who was not there.
 */
export interface Earned {
  /** Experience added, across every language. See `langs` for the breakdown. */
  xp: number;
  /**
   * The languages that gained anything, and what each gained.
   *
   * Kept apart from the total because a level belongs to a language now, and
   * "you reached level 4" with no language attached is the sentence the split
   * was made to stop printing. Empty for a game that taught no words.
   */
  langs: Array<{ lang: LearnLang; xp: number; level: number; levelled: boolean }>;
  /** Words that were not in the ledger before this game. */
  learned: number;
  /** Words that came back round, which is the number worth acting on. */
  due: number;
  /** True when this game was the day's first review. */
  streak: boolean;
  /**
   * Goth points added, which is `spendable` subtracted the way everything else
   * here is.
   *
   * The number this whole panel was missing. Every game pays into the purse --
   * see `POINTS_PER_GAME`, which the eleven games that teach nothing also pay
   * -- and until now the only place that showed was a pill in the header
   * quietly holding a larger number than it did a minute ago.
   *
   * Never negative. A chest opened between two summaries takes `spendable`
   * down, and "-100 GP" over the end of a game would be billing somebody for a
   * thing they already chose to buy.
   */
  points: number;
  /**
   * How much of `points` was the once-a-day bonus, or zero.
   *
   * Named rather than inferred: `playedToday` goes false to true across the
   * day's first game and no other, so this is a fact rather than the reading
   * of a large number. See `ProfileView.playedToday`.
   */
  daily: number;
}

export function earnedBetween(before: ProfileView | null, after: ProfileView): Earned | null {
  if (before === null) return null;

  const was = new Map(before.byLang.map((row) => [row.lang, row]));
  const langs = after.byLang.flatMap((row) => {
    const old = was.get(row.lang);
    const gained = row.xp - (old?.xp ?? 0);
    return gained > 0
      ? [{ lang: row.lang, xp: gained, level: row.level, levelled: row.level > (old?.level ?? 0) }]
      : [];
  });
  const xp = langs.reduce((n, row) => n + row.xp, 0);
  const learned = after.words - before.words;
  const points = Math.max(0, after.spendable - before.spendable);
  const daily = !before.playedToday && after.playedToday ? POINTS_FIRST_GAME_OF_DAY : 0;
  // A game that changed nothing is a game somebody watched, or a repeat that
  // was recognised and dropped. Either way there is nothing to announce, and a
  // panel reading "+0" is worse than no panel.
  //
  // The purse is in that test now, and it is what makes the panel appear at
  // all for the eleven games that teach no words: a night of Backgammon paid
  // twenty points a game and said nothing, which is exactly the thing the
  // per-game payment was added to stop.
  if (xp <= 0 && learned <= 0 && points <= 0) return null;
  return {
    xp,
    langs,
    learned,
    due: after.due,
    streak: after.streak.days > before.streak.days,
    points,
    daily,
  };
}
