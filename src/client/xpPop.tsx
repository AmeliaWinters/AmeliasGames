/**
 * "+7 XP", said out loud and then gone.
 *
 * The one piece of pure feedback in the app: a number that rises off the place
 * the answer was given, fades, and is not on the screen a second later. It
 * carries no information the end screen does not repeat, and that is the
 * point -- the end screen is the record and this is the moment.
 *
 * ## What it is allowed to claim
 *
 * The exact figure is `xpFor(grade, boxAfter(box, grade))`, and `box` lives on
 * the ledger, which lives on the server. This client cannot look one up: the
 * ledger is keyed by **folded lemma**, `fold()` lives in `chainDictionary.ts`
 * behind eighty thousand words of Polish, and `bundle.test.ts` fails the build
 * over exactly that import. See the note at the top of `profile.ts`.
 *
 * So the price is looked up **by the text on the screen** against the rows this
 * browser has already been sent -- the summary's `recent`, and the cached
 * ledger from `vocabCache.ts` -- and falls back to a first sighting when no row
 * matches. Three consequences, all of them acceptable and none of them silent:
 *
 * - **A word met for the first time is exact.** There is no row because there
 *   is no row, and a first sighting is what the fallback prices.
 * - **A word being reviewed is exact whenever its row is here**, which is the
 *   common case: `vocabCache.ts` is refreshed at the end of every game and the
 *   words in front of somebody are the words that were due.
 * - **An inflection can miss its lemma** and be priced as a first sighting,
 *   which understates. Word Chain plays inflections; Vocab Race asks for
 *   dictionary forms and so matches. Understating is the right direction to be
 *   wrong in: the authoritative total lands on the end screen a minute later,
 *   from the server, and finding it larger than the sum of the pops is a good
 *   surprise rather than a broken promise.
 *
 * If the boxes are ever put on the wire per seat, this whole file collapses to
 * one lookup and the caveat above goes with it.
 */
import { useEffect, useRef, useState } from "react";
import type { Known, LearnLang, ProfileView } from "../shared/profile.js";
import { type Grade, schedule, xpFor } from "../shared/review.js";
import { loadVocabCache } from "./vocabCache.js";
import { chime } from "./feel.js";

/**
 * The rung a word is on, as far as this browser knows. Zero when it cannot say.
 *
 * Matched on the lemma first and the last-seen form second, both folded to
 * lower case, which is as much folding as a client is allowed to do. See the
 * note at the top of this file.
 */
export function boxOf(rows: readonly Known[], word: string): number {
  const needle = word.trim().toLowerCase();
  if (!needle) return 0;
  const row = rows.find(
    (entry) => entry.lemma.toLowerCase() === needle || entry.word.toLowerCase() === needle,
  );
  return row?.box ?? 0;
}

/**
 * What one answer is worth, priced as well as this browser can price it.
 *
 * `schedule` then `xpFor`, in that order, because experience is paid on **the
 * rung reached** rather than the one left -- see `applyGrade` in `harvest.ts`,
 * which does the same two steps in the same order and is the thing this has to
 * agree with.
 */
export function xpPreview(rows: readonly Known[], word: string, grade: Grade, now: number): number {
  const box = boxOf(rows, word);
  const placement = schedule(box, grade, now);
  return placement === null ? 0 : xpFor(grade, placement.box);
}

/**
 * Every row this browser holds for one language, newest knowledge first.
 *
 * Two sources and neither is complete: the summary carries the twenty most
 * recently touched rows and the cache carries what was there after the last
 * game. The summary wins on a tie because it is the newer of the two.
 */
export function rowsFor(profile: ProfileView | null, lang: LearnLang): Known[] {
  const recent = (profile?.recent ?? []).filter((row) => row.lang === lang);
  const cached = loadVocabCache(lang)?.words ?? [];
  return [...recent, ...cached];
}

/** How long one pop lives, in ms. Long enough to read, short enough to ignore. */
const POP_MS = 1100;

interface Pop {
  /** Distinct per pop, because two answers can be worth the same number. */
  id: number;
  xp: number;
}

/**
 * The pops on screen, and the one call that makes another.
 *
 * A list rather than a single value: fast answers overlap, and a pop replaced
 * mid-flight is a flicker rather than two rewards. Each removes itself.
 *
 * Silent and invisible for zero, which is not a special case so much as the
 * only honest reading of it -- nothing is paid for a miss (see `xpFor`), and
 * "+0 XP" over a wrong answer would be the app rubbing it in.
 */
export function useXpPops(): { pops: Pop[]; pop(xp: number): void } {
  const [pops, setPops] = useState<Pop[]>([]);
  const next = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Every pending timer is cleared on unmount. A board that ends mid-pop would
  // otherwise call `setPops` on a component that has gone.
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return {
    pops,
    pop(xp: number) {
      if (xp <= 0) return;
      const id = ++next.current;
      setPops((all) => [...all, { id, xp }]);
      chime(xp);
      timers.current.push(
        setTimeout(() => setPops((all) => all.filter((entry) => entry.id !== id)), POP_MS),
      );
    },
  };
}

/**
 * The pops, drawn.
 *
 * `aria-hidden`, and deliberately. Every one of these is a restatement of
 * something the board has already said in words -- the answer was right --
 * and a screen reader interrupting the next clue to say "+7 XP" would be the
 * decoration talking over the game. The figure that matters is announced on
 * the end screen, where it is the point rather than the garnish.
 *
 * The animation is CSS, so `prefers-reduced-motion` can turn it into a plain
 * fade in one place. See `xp.css`.
 */
export function XpPops({ pops }: { pops: Pop[] }) {
  if (pops.length === 0) return null;
  return (
    <div className="xp-pops" aria-hidden="true">
      {pops.map((entry) => (
        <span key={entry.id} className="xp-pop">
          +{entry.xp} XP
        </span>
      ))}
    </div>
  );
}
