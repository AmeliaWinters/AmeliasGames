/**
 * The parts of Drill the board is allowed to know.
 *
 * Same boundary as `vocabDisplay.ts` and for both of the same reasons: this
 * game reads Word Chain's word lists, which are the second largest thing in the
 * repo and exist to mark an answer on the server; and the answer to the clue on
 * screen is a secret until the card is settled, so a board that could reach the
 * dictionary could resolve the clue itself. `bundle.test.ts` holds the first
 * line however it is reached, and `view()` in the reducer holds the second.
 *
 * The only things it imports are `../clock.js` and `../profile.js`, both of
 * which import nothing themselves.
 */

export { clockCall, formatClock } from '../clock.js';
import type { StudyLists } from '../profile.js';

/**
 * The two languages you can drill, which are Vocab Race's two.
 *
 * English is missing for the reason `vocabDisplay.ts` sets out at length: the
 * clue is an English meaning, so an English round would be an English word
 * described in English, and the frequency list is bare words with no
 * descriptions to describe them with.
 */
export type DrillLang = 'pl' | 'ja';

export const DRILL_LANGS: readonly DrillLang[] = ['pl', 'ja'];

export const DRILL_LANG_NAME: Record<DrillLang, string> = { pl: 'Polish', ja: 'Japanese' };

/**
 * How many cards a session is.
 *
 * Twelve, and the number is chosen against the thing this exists to compete
 * with, which is not another game but *not playing at all*. A drill has to be
 * finishable in the gap where somebody picked their phone up: at twenty
 * seconds a card and most of them answered in five, twelve cards is two or
 * three minutes.
 *
 * Short enough that finishing is the default outcome matters more than it
 * sounds. A review session abandoned half way still files what it got — see
 * `record` — but a person who abandons one is a person who has learned that
 * this thing does not end, and they do not open it again.
 */
export const DRILL_CARDS = 12;

/**
 * How long one card stays open.
 *
 * Twenty seconds, against Vocab Race's thirty, and shorter on purpose. There
 * is nobody else at the table, so the clock is not protecting anyone's turn;
 * its only job is to stop a card sitting there forever when somebody has put
 * the phone down. Either the word is in your head or it is not, and twenty
 * seconds is well past the point where staring produces it.
 */
export const CARD_MS = 20 * 1000;

/**
 * How long the answer stays up before the next card.
 *
 * The entire point of the exercise, and a phase of its own for the reason
 * Vocab Race gives it one: being wrong is the moment the word sticks, and a
 * card that rolled straight into the next would spend that moment showing you
 * something else to read. Four seconds rather than six, because here you are
 * reading one word you already half-knew rather than catching up on a round
 * three other people just played.
 */
export const REVEAL_MS = 4 * 1000;

/**
 * How long the language menu stays open before the game picks.
 *
 * Nobody loses to it: a setup clock that runs out chooses whichever language
 * has the most due and deals. See `expire` in the reducer. It exists only so a
 * session left open on a menu does not hold a room forever.
 */
export const SETUP_MS = 60 * 1000;

export type DrillPhase = 'setup' | 'asking' | 'reveal' | 'over';

/**
 * How one card ended.
 *
 * The same four `VocabHow` has, deliberately, because the ledger grades them
 * and a fifth state here would be a fifth case there. `timeout` is the card
 * nobody answered, and it is not graded at all — see `record`.
 */
export type DrillHow = 'right' | 'wrong' | 'gave-up' | 'timeout';

/** One card: the clue, the answer, and what happened. */
export interface DrillCard {
  /** The English meaning. The question, and the only field sent while asking. */
  clue: string;
  /**
   * The word, as it should be read. **Redacted while the card is open**, along
   * with everything below it: this is the answer, and a board holding it has
   * finished the exercise.
   */
  word: string;
  script: string;
  lemma: string;
  rank: number;
  /**
   * Whether this card is a word the player already owed a review on, as
   * against one drawn from the top of the list to fill a short session.
   *
   * Kept so the end screen can say "eight reviews and four new words", which
   * is a different sentence from "twelve words" and the one that tells
   * somebody whether they are getting through their backlog.
   */
  review: boolean;
  /** Null while the card is open. */
  how: DrillHow | null;
  /** What they typed. Empty for a card passed or timed out. */
  said: string;
  /** How long it took, in ms out of `CARD_MS`. */
  ms: number;
  /** When the card went up, as a server clock. */
  began: number;
}

export interface DrillState {
  phase: DrillPhase;
  /** Null until chosen. */
  lang: DrillLang | null;
  /**
   * The ranks this session will ask about, review-first, dealt at setup.
   *
   * **Redacted to an empty array by `view()`** for the same reason Vocab Race
   * redacts its deck: it is the rest of the session in order, and a client
   * holding it beside a downloadable word list would know every answer before
   * it was asked.
   */
  queue: number[];
  /** How far into the queue this session has read. Harmless on its own. */
  drawn: number;
  /** The card on the table. Null during setup and once it is over. */
  card: DrillCard | null;
  /** Settled cards, oldest first. The end screen reads this. */
  done: DrillCard[];
  /** What the current phase ends at. Null before the session starts. */
  deadline: number | null;
  /**
   * The words this player is due, as their profile stood when the room dealt.
   *
   * The whole reason this game exists: it is a review, so what it asks has to
   * come from what is owed. Empty for a guest and for anybody with nothing due,
   * and a session with it empty is still a perfectly good game — it draws from
   * the top of the frequency list instead, which is where a learner with no
   * history should be starting anyway.
   *
   * **Redacted to `{}` by `view()`**, with the queue it built.
   */
  study: StudyLists;
}

export type DrillMove =
  /** During setup: which language. The only seat there is may choose it. */
  | { type: 'lang'; lang: DrillLang }
  /** During a card: type the word. */
  | { type: 'say'; word: string }
  /** During a card: I do not know this one. */
  | { type: 'pass' };

export function isFinished(state: DrillState): boolean {
  return state.phase === 'over';
}

/** Whether the phase's clock has run out as of `now`. False when there is none. */
export function outOfTime(state: DrillState, now: number | undefined): boolean {
  return state.deadline !== null && now !== undefined && now >= state.deadline;
}

/** How much of the phase is left, for the countdown. */
export function msLeftFor(state: DrillState, now: number): number {
  return state.deadline === null ? 0 : Math.max(0, state.deadline - now);
}

/**
 * Whether `seat` may act right now.
 *
 * Written out rather than aliased to `turn(state) === seat`, because the
 * contract asks every game to be honest about which kind it is and this one is
 * a third kind again: there is only ever one seat, so "whose turn" is not a
 * question the game has. What it does have is a clock, and the last second of a
 * card belongs to whoever is holding it.
 */
export function canAct(state: DrillState, seat: number, now?: number): boolean {
  if (seat !== 0) return false;
  if (state.phase === 'setup') return state.lang === null;
  if (state.phase !== 'asking') return false;
  return !outOfTime(state, now);
}

/** How many cards have been settled, and how many there are. Both for the copy. */
export function progress(state: DrillState): { done: number; total: number } {
  return { done: state.done.length, total: state.done.length + (state.card ? 1 : 0) + remaining(state) };
}

/**
 * How many cards are still queued behind the one on the table.
 *
 * Counted off the queue rather than kept as a number, for the reason every
 * other derived figure in this repo is: a second copy of something readable
 * from the record is a second thing that can disagree with it.
 */
function remaining(state: DrillState): number {
  return Math.max(0, Math.min(state.queue.length - state.drawn, DRILL_CARDS - state.done.length - 1));
}

/** How many of the settled cards went each way. What the end screen counts. */
export interface DrillTally {
  right: number;
  wrong: number;
  passed: number;
  missed: number;
  /** Of the right answers, how many were words already owed a review. */
  reviewed: number;
}

export function tally(state: DrillState): DrillTally {
  const out: DrillTally = { right: 0, wrong: 0, passed: 0, missed: 0, reviewed: 0 };
  for (const card of state.done) {
    if (card.how === 'right') {
      out.right += 1;
      if (card.review) out.reviewed += 1;
    } else if (card.how === 'wrong') out.wrong += 1;
    else if (card.how === 'gave-up') out.passed += 1;
    else out.missed += 1;
  }
  return out;
}
