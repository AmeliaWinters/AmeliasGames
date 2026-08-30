/**
 * The two translations every account screen makes, written once.
 *
 * Both of these were a copy in `Stats.tsx` and a copy in `Vocabulary.tsx`, and
 * they had already drifted: one asked `days === 1` and the other `days <= 1`.
 * Nothing turned on it, because `BOXES` starts at 1 and no rung yields less --
 * which is exactly why it survived. A screen and its neighbour disagreeing
 * about the boundary is the kind of thing that stays invisible until the day
 * somebody adds a same-day rung, and then it is two bugs in two files.
 *
 * Client-side rather than shared, because both are about wording rather than
 * about the scheduler: `BOXES` is the rule, and these are how it is said.
 */
import { BOXES } from "../shared/review.js";

/** What to call each language on a screen. */
export const LANG_NAME: Record<string, string> = {
  en: "English",
  pl: "Polish",
  ja: "Japanese",
};

/**
 * How long a word has earned, in words rather than in days.
 *
 * "Back in a week" is a thing somebody can act on; "box 3" is a thing they
 * would have to learn a scheme to read. The rung is still what the scheduler
 * thinks in, and this is the only place it is translated.
 *
 * `<= 1` rather than `=== 1`: a rung of a day or less is "tomorrow" either
 * way, and the comparison that cannot be wrong is the one that does not
 * assume where the ladder starts.
 */
export function restingFor(box: number): string {
  const days = BOXES[Math.max(0, Math.min(box, BOXES.length - 1))];
  if (days <= 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}
