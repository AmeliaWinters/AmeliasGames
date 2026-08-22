/**
 * Counting down, in the one format a countdown is ever written in.
 *
 * Its own module because two games are on clocks now — Word Hunt's round and
 * Word Duel's shot clock — and both their display modules are leaves of the
 * client's import graph on purpose. A leaf may import another leaf; what it
 * must never do is reach a reducer and drag a word list into the browser
 * behind it. This file imports nothing, so it stays safe to import anywhere.
 */

/**
 * A countdown as `M:SS`. Rounds up, so the clock reads 1:00 for the whole of
 * the last minute's first second and only shows 0:00 when the time really has
 * gone — a timer that displays zero while play continues reads as broken.
 */
export function formatClock(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * How long is left, said out loud — but only at the moments worth saying.
 *
 * The visible clock is deliberately `aria-live="off"`: a countdown ticking
 * four times a second would be read out four times a second, which makes a
 * board unusable with a screen reader on. The cost of that, until now, was
 * that time pressure reached a blind player through nothing at all — not the
 * colour, not the pulse — and they could run out the clock with no warning.
 *
 * This is the other half. It returns the *same string* for the whole of a
 * stretch and a new one only on crossing a mark, and a live region announces
 * only when its text changes — so the throttling is the shape of the data
 * rather than a timer that has to be kept in step with one.
 */
const MARKS = [10_000, 30_000, 60_000];

export function clockCall(left: number, running: boolean): string {
  if (!running) return '';
  if (left <= 0) return 'Time is up.';
  const mark = MARKS.find((m) => left <= m);
  return mark === undefined ? '' : `${mark / 1000} seconds left.`;
}
