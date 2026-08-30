/**
 * What Vocab Race calls things, and how it writes numbers down.
 *
 * Split out of the board because none of it is a component: it is the words
 * and the formatting, and it is read from four screens (setup, the round, the
 * reveal and the end-of-game review). Keeping it here is what stops the same
 * label being written twice under two spellings, which is the bug this file
 * exists to prevent -- see `HOW_WORD`.
 *
 * Nothing in here holds state or touches the clock. Anything that does belongs
 * in `parts.tsx` or on the board itself.
 */
import { LEVEL_ASKS, LEVEL_SCALE } from "../../../shared/games/vocabDisplay.js";
import type {
  VocabHow,
  VocabLang,
  VocabLevel,
  VocabMode,
} from "../../../shared/games/vocabDisplay.js";

/**
 * The speaker on every button that says a word.
 *
 * One glyph in one constant because it is drawn in three places and they have
 * to be the same mark: a learner looking for "the thing that makes the sound"
 * should find one shape, not three. Always paired with `sr-only` text, since a
 * bare emoji is announced as "speaker with three sound waves" or as nothing at
 * all, depending on the reader.
 */
export const SPEAKER = "\u{1F50A}";

/** Under this much left, the clock starts shouting about it. */
export const URGENT_MS = 10 * 1000;

/** What each language is called on its own terms, under the English name. */
export const LANG_NATIVE: Record<VocabLang, string> = {
  pl: "polski",
  ja: "日本語",
};

/**
 * What each difficulty actually asks for, said in words rather than as a
 * number nobody can place. "Top 100" means nothing until you know that the top
 * hundred words of a language are the ones you cannot construct a sentence
 * without.
 */
export const MODE_BLURB: Record<VocabMode, string> = {
  normal: "The hundred words the language leans on hardest.",
  hard: "The first thousand, where a learner actually lives.",
  // The odd one out, and the setup screen is where that has to be said: the
  // other two are depths into one list and this is a different list entirely.
  // Whole sentences, so the box is longer and the hint gives you the first
  // letter of every word in it.
  phrases: "Whole sentences: the coffee, the light, the bill.",
};

/**
 * What each level is honestly claiming, said in the second person.
 *
 * Worth the words because the setting is self-reported and the whole handicap
 * rests on people picking truthfully. Nobody undersells a language on purpose,
 * but plenty of people will read "I speak it" as a boast they are not entitled
 * to make and pick the middle band out of modesty, so the copy names the
 * situation rather than the skill, and says what the choice costs.
 */
export const LEVEL_SHORT: Record<VocabLevel, string> = {
  new: "just starting",
  some: "getting there",
  // Not `LEVEL_NAME` lowercased: that one is "I speak it", and the I is a word
  // a blanket `toLowerCase()` ruins on the one line four people read at once.
  fluent: "speaks it",
};

export const LEVEL_BLURB: Record<VocabLevel, string> = {
  new: "Weeks in. Mostly multiple choice, and free hints.",
  some: "You know some of it. The middle.",
  fluent: "You'd win every round. Type every one, for half points.",
};

/**
 * What a level actually buys, in figures.
 *
 * Counted out of `LEVEL_ASKS` and `LEVEL_SCALE` rather than written down
 * beside them, because the cycle and the scale are the rule and a second copy
 * of either in prose is a lie waiting to happen. Everyone gets the same clock;
 * what differs is the mix of questions and, for the top band, what a right one
 * pays.
 *
 * The discount is printed rather than left to be discovered. A seat that finds
 * out from the scoreline that it has been scoring half all game has been
 * handicapped behind its own back, and the level is self-reported, so the one
 * thing that must not happen is somebody feeling tricked by the box they
 * ticked honestly.
 */
export function levelTerms(level: VocabLevel): string {
  const cycle = LEVEL_ASKS[level];
  const picks = cycle.filter((ask) => ask === "pick").length;
  const scale = LEVEL_SCALE[level];
  const cut = scale === 1 ? "" : `, ${Math.round((1 - scale) * 100)}% fewer points`;
  if (picks === 0) return `Type every round${cut}`;
  if (picks === cycle.length) return `Choose every round${cut}`;
  return `${picks} in ${cycle.length} multiple choice${cut}`;
}

/** Thousands separators. Shared, because a score and a word rank drawn by two
 *  different screens must not disagree about how a number is written. */
export const count = new Intl.NumberFormat();

/** A time to a right answer. One decimal: whole seconds throw away the race. */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `1st`, `2nd`, `13th`, `742nd`, read aloud by the rank, so it has to be right. */
export function ordinal(n: number): string {
  const teen = n % 100;
  const suffix =
    teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${count.format(n)}${suffix}`;
}

/**
 * How a seat's round ended, in one word.
 *
 * Said the same way in three places (the live scoreline, the reveal and the
 * end-of-game review) because a player learning what "gave up" costs should not
 * have to learn it twice under two names.
 */
export const HOW_WORD: Record<VocabHow, string> = {
  right: "had it",
  wrong: "wrong",
  "gave-up": "passed",
  timeout: "ran out",
};
