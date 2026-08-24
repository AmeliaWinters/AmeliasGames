/**
 * The parts of Word Chain the board is allowed to know.
 *
 * Same boundary as `wordleDisplay.ts` and `wordHuntDisplay.ts`, and for the
 * same reason, only more so: this game's three word lists are the second
 * largest thing in the repo after `words.ts`, and they exist to validate a
 * move, which happens on the server. One convenience import in
 * `WordChainBoard.tsx` would put thirty thousand Polish inflections and twelve
 * thousand Japanese entries on the phone of everyone who opens the lobby.
 * `bundle.test.ts` holds that line.
 *
 * The only thing it imports is another leaf that imports nothing itself. The
 * rule is not "no imports" but "nothing that reaches a reducer".
 *
 * There is deliberately no folding or letter logic here. The board never needs
 * to work out what a word must start with, because the server puts the answer
 * in `required` — which is also what stops the board and the reducer ever
 * disagreeing about whose turn it is to say a word beginning with A.
 *
 * `wordChain.ts` re-exports everything here, so the reducer and its tests
 * carry on importing from one place.
 */

export { clockCall, formatClock } from '../clock.js';

export type ChainLang = 'en' | 'pl' | 'ja';

export const LANGS: readonly ChainLang[] = ['en', 'pl', 'ja'];

/** What to call each language, and what to call a word in it. */
export const LANG_NAME: Record<ChainLang, string> = {
  en: 'English',
  pl: 'Polish',
  ja: 'Japanese',
};

/**
 * The shortest word the game will take, in every language.
 *
 * Three, not two, and the reason is the same in all three: two-letter words
 * are function words — Polish `to`, `na`, `za`; Japanese single mora like `no`
 * and `ga`; English `of`, `an`. They are the commonest words in each language,
 * so an unbounded chain becomes two players trading particles. The lists are
 * built to this limit as well, so a word this short is not merely refused, it
 * is not in the dictionary at all; the constant is here for the copy that has
 * to explain the refusal.
 */
export const MIN_LENGTH = 3;

/**
 * How long a player has to produce a word, and how long the two of them have
 * to choose their languages.
 *
 * A minute is the whole game: running out of it is the only way to lose, so
 * this number is not a stall-breaker bolted onto the rules the way Word Duel's
 * is, it *is* the rule. Sixty seconds is long enough that a word you know will
 * surface and short enough that one you don't will not.
 *
 * Setup gets the same minute for a duller reason: a player who never picks a
 * language would otherwise hang the room forever. Nobody loses to it — see
 * `expire` in the reducer, which defaults the undecided to English and starts
 * the game rather than ending it.
 */
export const TURN_MS = 60 * 1000;

/** One word in the chain, as the board should draw it. */
export interface ChainLink {
  /**
   * The word as it should be *read*: Polish with its diacritics back on,
   * Japanese in romaji, English as typed. Not what the game compares — see
   * `key`.
   */
  word: string;
  /**
   * The folded form the game actually reasons about: lower case, ASCII, Polish
   * diacritics flattened, Japanese romanisation variants collapsed. It is on
   * the wire because the board underlines the letter that carries to the next
   * word, and that letter is this string's last one, not `word`'s — `ręką`
   * hands on an `a`.
   */
  key: string;
  lang: ChainLang;
  /** Who said it. */
  seat: number;
  /** English meaning, or empty when the list has none for this word. */
  gloss: string;
  /**
   * Japanese in its own script, so the romaji is not the only thing a learner
   * ever sees. Empty for the other two languages.
   */
  script: string;
  /**
   * The dictionary form, when the word played was an inflection of it — Polish
   * `jestem` carries `być`. Empty when the word is already its own lemma, and
   * for the languages where the distinction does not arise.
   */
  lemma: string;
}

export type WcPhase = 'setup' | 'playing' | 'over';

export interface WcState {
  phase: WcPhase;
  /** Each seat's language, or null while they are still choosing. */
  langs: (ChainLang | null)[];
  /** Oldest first. The last link is the one being answered. */
  chain: ChainLink[];
  /** The seat the game is waiting on. Meaningless once `phase` is `over`. */
  at: number;
  /**
   * The letter the next word must start with, or '' for the opening word,
   * which is free. Computed by the server from the last link's `key` so that
   * nothing else has to know how folding works.
   */
  required: string;
  /** When the current minute runs out, or null before the game is on a clock. */
  deadline: number | null;
  /** The seat that ran out of time, or null while nobody has. */
  loser: number | null;
  /**
   * The word the loser could have said: the commonest one in their language
   * that starts with `required` and has not been used. Null until somebody
   * loses, and null in the vanishingly rare case that no such word exists.
   *
   * This is the reason the lists are frequency-ordered, and most of the reason
   * to play the game at all — a minute of failing to think of a word is the
   * moment you are most likely to remember the answer.
   */
  reveal: ChainLink | null;
}

export type WcMove =
  | { type: 'lang'; lang: ChainLang }
  | { type: 'say'; word: string };

export function isFinished(state: WcState): boolean {
  return state.phase === 'over';
}

/** Whether the clock has run out as of `now`. False when there is no clock. */
export function outOfTime(state: WcState, now: number | undefined): boolean {
  return state.deadline !== null && now !== undefined && now >= state.deadline;
}

/** How much of the minute is left, for the countdown. */
export function msLeftFor(state: WcState, now: number): number {
  return state.deadline === null ? 0 : Math.max(0, state.deadline - now);
}

/**
 * Whether `seat` may act right now.
 *
 * Written out rather than aliased to `turn(state) === seat`, because this game
 * is only *sometimes* strictly alternating and the contract has to be honest
 * about which kind it is. During setup both players choose at once and neither
 * is waiting on the other, so two seats can act; once play starts exactly one
 * can. `turn` reports a single seat throughout, which is why it is a hint for
 * the status line and this is the predicate every control is gated on.
 */
export function canAct(state: WcState, seat: number, now?: number): boolean {
  if (seat < 0 || seat >= state.langs.length) return false;
  if (state.phase === 'setup') return state.langs[seat] === null;
  if (state.phase === 'over') return false;
  return state.at === seat && !outOfTime(state, now);
}

/** Every word already said, folded, so a repeat can be spotted in one lookup. */
export function usedKeys(state: WcState): Set<string> {
  return new Set(state.chain.map((link) => link.key));
}
