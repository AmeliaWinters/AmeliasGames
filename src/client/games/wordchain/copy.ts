/**
 * What Word Chain calls things, and how it writes its numbers down.
 *
 * Not components: the words and the arithmetic of saying them, read from the
 * live board, the reveal and the end-of-game stats. Kept together so a figure
 * quoted on two screens cannot be rounded two ways.
 *
 * Several of these read their numbers out of the rules rather than repeating
 * them (`levelBlurb` off `HINT_AT`, `urgentAt` off `turnMsFor`). That is the
 * point of the file: a number typed into copy goes stale the first time
 * somebody retunes the ladder, and nothing fails when it does.
 */
import { HINT_AT } from "../../../shared/games/wordChainDisplay.js";
import type { ChainLang, ChainLevel } from "../../../shared/games/wordChainDisplay.js";

/** Under this much left, the clock starts shouting about it. */
export const URGENT_MS = 15 * 1000;


/**
 * What each level buys, said as what happens rather than as what you are.
 *
 * The seconds are read out of `HINT_AT` rather than written down beside it, for
 * the reason Vocab Race counts its own mix out of `LEVEL_ASKS`: a number typed
 * into the copy is a number that goes stale the first time somebody retunes the
 * ladder, and this is the one screen where the promise has to be exact.
 */
export function levelBlurb(level: ChainLevel): string {
  const at = HINT_AT[level];
  if (at.length === 0) return "No help. The lost minute is the lesson.";
  const [first, second] = at;
  return `A nudge towards the word after ${Math.round((first as number) / 1000)} seconds, and its shape after ${Math.round((second as number) / 1000)}.`;
}
/**
 * Where the clock starts shouting, on a turn that is only `had` long.
 *
 * Never more than half the turn, because the allowance shrinks as the chain
 * grows (see `turnMsFor`) and a flat fifteen seconds would have the clock red
 * from the moment a late turn started, which is a warning that has stopped
 * being one. Half is the same shape of warning the opening minute gets at
 * fifteen: enough time left to do something about it.
 */
export function urgentAt(had: number): number {
  return Math.min(URGENT_MS, had / 2);
}

/** What each language is called on its own terms, under the English name. */
export const LANG_NATIVE: Record<ChainLang, string> = {
  en: "English",
  pl: "polski",
  ja: "日本語",
};

/** Thousands separated, because `1501 words` reads as a year. */
/** Thousands separators, exported so a rank drawn by the board and by the
 *  end-of-game stats is written the same way in both. */
export const count = new Intl.NumberFormat();

/**
 * How long the chain is, in words.
 *
 * One number for both players rather than a tally each: neither seat built the
 * chain alone, and the per-seat tally is the score, which is drawn separately
 * and means something else. See `Scores`.
 */
export function words(n: number): string {
  return `${count.format(n)} ${n === 1 ? "word" : "words"}`;
}

/** A score, spoken. Singular at one, because the game reaches one. */
export function points(n: number): string {
  return `${count.format(n)} ${n === 1 ? "point" : "points"}`;
}

/**
 * A mean answer time. One decimal, because whole seconds throw away the
 * difference between a word that arrived instantly and one that took a beat,
 * which over a game is the whole of what this number is measuring.
 */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * How common a seat's words were, as a share of their own language's list.
 *
 * A share rather than a mean rank, because the three lists are different sizes
 * and a mean rank compared across them measures the lists. See `LIST_SIZE`.
 * Rounded away from zero: nobody's words average "the top 0% of English", and
 * up is the honest way to round a boast about rarity.
 */
export function share(fraction: number): string {
  return `top ${Math.max(1, Math.ceil(fraction * 100))}%`;
}

/**
 * How much of the minute was still there, in whole seconds.
 *
 * Whole, unlike the averages, because this one is a story rather than a
 * measurement: "with two seconds left" is the thing you tell someone
 * afterwards, and "with 2.3s left" is not.
 *
 * `had` is that turn's own allowance, which is not the minute once the chain
 * has run past three words. The deadline it beat is long overwritten by then,
 * so it is recovered from the word's place in the chain instead.
 */
export function toSpare(ms: number, had: number): string {
  const left = Math.round((had - ms) / 1000);
  return left === 0 ? "with less than a second left" : `with ${left} second${left === 1 ? "" : "s"} left`;
}

/** `1st`, `2nd`, `13th`, `742nd`, spoken aloud by the rank, so it has to be right. */
export function ordinal(n: number): string {
  const teen = n % 100;
  const suffix =
    teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${count.format(n)}${suffix}`;
}
