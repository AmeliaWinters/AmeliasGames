/**
 * A turn of Word Chain: whose it is, what it costs, what the chain looks like
 * afterwards, and what the seat on the clock is allowed to be told.
 *
 * Everything the reducer in `wordChain.ts` does between moves. The definition
 * object is what decides whether a move is legal; this is what the game
 * becomes once it is.
 *
 * Same rule as `wordChain.ts`: this reaches `chainDictionary.ts` and so the
 * three word lists, which are the largest thing in the repo. **Nothing on the
 * client may import it** -- `bundle.test.ts` builds the real bundle and fails
 * over exactly that, however the import is reached. The board's half is
 * `wordChainDisplay.ts`.
 *
 * The redaction lives here too, in `revealFor`, `answerFor` and `hintFor`: a
 * seat is told the answer to its own turn and nothing about anybody else's.
 * Read those three together before changing any of them.
 */
import type { Learned } from '../harvest.js';
import type { Grade } from '../review.js';
import {
  chainKey,
  commonestStarting,
  countStarting,
  fold,
} from './chainDictionary.js';
import type { ChainEntry } from './chainDictionary.js';
import {
  CHAIN_LEVELS,
  HINT_AT,
  LANGS,
  MIN_ANSWERS,
  levelOf,
  lockTurns,
  lockedFor,
  saidBy,
  scoreFor,
  studyFor,
  turnMsFor,
  usedKeys,
} from './wordChainDisplay.js';

import type {
  ChainHint,
  ChainLang,
  ChainLevel,
  ChainLink,
  ChainMiss,
  ChainMode,
  LetterCooldown,
  WcState,
} from './wordChainDisplay.js';

export const SEATS = 2;

export const opponentOf = (seat: number): number => (seat + 1) % SEATS;

/**
 * The seat that has to answer the word `seat` is about to say.
 *
 * The opponent, except in a chase, where there is nobody to hand the letter to
 * but yourself. Both `tooThin` and `lockCostFor` are questions about that
 * seat's language and that seat's remaining answers, so they ask it here
 * rather than each working it out.
 */
export const answererOf = (state: WcState, seat: number): number =>
  state.phase === 'chase' ? seat : opponentOf(seat);

/**
 * The letter a word hands on: the last of the key the chain is linking on.
 *
 * In a `loose` game that is the folded key, so *ręką* hands on an `a`. In a
 * `strict` one it is the word as written, so *coś* hands on a `ś`.
 */
export const handsOn = (entry: ChainEntry, mode: ChainMode): string => chainKey(entry, mode).slice(-1);

/** Which chain this game is: see `ChainMode`, and point 4 above. */
export const modeOf = (state: WcState): ChainMode => (state.strict ? 'strict' : 'loose');

export function linkFrom(
  entry: ChainEntry,
  lang: ChainLang,
  seat: number,
  ms: number,
  hinted = false,
): ChainLink {
  return {
    word: entry.word,
    key: entry.key,
    lang,
    seat,
    gloss: entry.gloss,
    script: entry.script,
    lemma: entry.lemma,
    rank: entry.rank,
    ms,
    hinted,
  };
}

/**
 * How long the seat on the clock has taken, as of `now`.
 *
 * Read back out of the deadline rather than kept as a start time, because the
 * deadline is what the whole game already agrees on (the board counts down to
 * it, `expire` fires on it) and a second field recording when the turn began
 * could drift from it.
 *
 * Clamped to the turn's own allowance at both ends, which is not always a
 * minute. See `turnMsFor`, and take the chain length from the state *before*
 * the word being timed is appended, which is what this is handed.
 *
 * `now` is the server's, but a restored room or a missing clock can hand this
 * arithmetic a number from anywhere, and a word that took minus four seconds
 * would poison every average built on it.
 */
export function tookUntil(state: WcState, now: number): number {
  if (state.deadline === null) return 0;
  const had = turnMsFor(state.chain.length);
  return Math.min(had, Math.max(0, had - (state.deadline - now)));
}

/**
 * Whether answering `letter` in `lang` is unreasonable: too few words start
 * with it and are still unsaid, or the language never had any.
 *
 * Not a check for zero. See `MIN_ANSWERS`: a letter with three answers, all of
 * them proper nouns out of a subtitle corpus, is a letter nobody can play.
 */
export function tooThin(
  lang: ChainLang,
  letter: string,
  used: ReadonlySet<string>,
  mode: ChainMode,
): boolean {
  return countStarting(lang, letter, used, mode) < MIN_ANSWERS[lang];
}

/** The letters `seat` may not end a word on right now. */
export function blockedFor(state: WcState, seat: number): Set<string> {
  return new Set(lockedFor(state, seat).map((cool) => cool.letter));
}

/**
 * How long handing `letter` over would lock it for `seat`, were they to do it
 * now. Zero when it is free, which is the common case.
 *
 * Priced off the pool in *front* of the letter, in the language of whoever has
 * to answer it, which is the opponent or -- in a chase, where you answer your
 * own words -- yourself. Same seat and same count `tooThin` protects, one bar
 * up: see `THIN_START`. Pricing it off the seat's own language, or off how
 * many words *end* on the letter, is what the bug was.
 *
 * `used` is the set of words that count as spent for the question, which at
 * the moment of charging includes the word being said: the ending a player has
 * just consumed is not still there for the next one.
 */
export function lockCostFor(
  state: WcState,
  seat: number,
  letter: string,
  used: ReadonlySet<string> = usedKeys(state),
): number {
  const lang = state.langs[answererOf(state, seat)];
  if (lang == null) return 0;
  return lockTurns(countStarting(lang, letter, used, modeOf(state)));
}

/**
 * Charge `seat` for ending a word on `letter`, and hand back every seat's
 * cooldowns with that one seat's updated.
 *
 * Called with the state from *before* the word is appended, so the seat's own
 * word count is taken as `saidBy + 1`; `used` is the after set, see
 * `lockCostFor`. A free ending stores nothing, and clears any expired entry
 * the letter was still carrying, so `cooldowns` never grows a row that means
 * "this letter is fine".
 */
export function cooledBy(
  state: WcState,
  seat: number,
  letter: string,
  used: ReadonlySet<string>,
): LetterCooldown[][] {
  const said = saidBy(state, seat) + 1;
  const mine = (state.cooldowns[seat] ?? []).filter((cool) => cool.letter !== letter);
  const turns = lockCostFor(state, seat, letter, used);
  return state.cooldowns.map((cools, index) =>
    index === seat ? (turns === 0 ? mine : [...mine, { letter, until: said + turns }]) : cools,
  );
}

/**
 * The state the seat on the clock is handed: whose turn, what letter, how many
 * words are behind it, and a fresh clock, shorter than the last one every
 * third word.
 *
 * One place, because the count and the letter have to agree: a `required` set
 * without recounting would leave the board telling a player there are 1,501
 * words when the letter has changed underneath it.
 */
export function handTo(
  state: WcState,
  seat: number,
  required: string,
  used: ReadonlySet<string>,
  now: number,
): WcState {
  const lang = state.langs[seat];
  return {
    ...state,
    at: seat,
    required,
    available: lang == null ? null : countStarting(lang, required, used, modeOf(state)),
    // Recomputed here and nowhere else, so it can never be an answer to a
    // letter the chain has already moved off. See `hintFor`.
    hint: hintFor(state, seat, required, used),
    // Shorter the further the chain has run, see `turnMsFor`. Measured off the
    // chain this state already carries, so the seat answering the fourth word
    // is the first to get less than the minute.
    deadline: now + turnMsFor(state.chain.length),
  };
}

/** Nobody is on the clock any more, and `loser` is settled. */
export function ended(state: WcState, loser: number): WcState {
  // The hint goes with the clock. What it was pointing at is on the end screen
  // now, as the reveal, with its meaning and its spelling and no blanks in it.
  return { ...state, phase: 'over', loser, available: null, deadline: null, hint: null };
}

/**
 * The word `seat` could have said, as a link ready for the end screen.
 *
 * Filtered by that seat's own cooldowns, because the reveal is a claim ("this
 * is what you could have said") and a word the game would have refused makes a
 * liar of the one screen the whole game is played for.
 */
export function revealFor(state: WcState, seat: number, lang: ChainLang): ChainLink | null {
  const found = answerFor(state, seat, lang, state.required, usedKeys(state));
  // Zero milliseconds, because nobody spent any time on it: the reveal is a
  // word out of the list, not a turn that was played.
  return found ? linkFrom(found, lang, seat, 0) : null;
}

/**
 * The commonest word `seat` could legally say to `letter` in `lang`, filtered
 * by their own cooldowns and preferring one they already owe a review on.
 *
 * One function because it is one claim made twice: `revealFor` shows it at the
 * end of a lost minute, and `hintFor` walks a player towards it while the
 * minute is still running. Two lookups that could drift apart would have the
 * game hint at one word and then reveal another, which reads as the game
 * changing its mind about the answer.
 */
export function answerFor(
  state: WcState,
  seat: number,
  lang: ChainLang,
  letter: string,
  used: ReadonlySet<string>,
): ChainEntry | null {
  return commonestStarting(
    lang,
    letter,
    used,
    modeOf(state),
    blockedFor(state, seat),
    // Only this seat's, and only in the language they were playing. A word
    // their opponent owes a review on is nothing to do with the minute that
    // has just gone, and a word due in a language nobody at this table chose
    // would be matched on a folded key that means something else entirely.
    // See `WcState.study` and `commonestStarting`.
    new Set(studyFor(state, seat, lang)),
  );
}

/**
 * The word the seat being handed the clock is to be walked towards, or null
 * where there is nothing to walk them to.
 *
 * Computed once a turn, when the clock changes hands, rather than on demand:
 * `view` has no clock to decide with (see the `GameDefinition` signature), so
 * the answer goes down with the turn and the board holds each rung back until
 * its moment. That does mean a seat's own board is holding that seat's own hint
 * from the start of the turn. It is the bargain the vocabulary game's free hint
 * makes, and worth it for the same reason: what leaks is one player's hint to
 * that one player, on a turn the game has already decided to give it to them.
 *
 * Skipped for a level with no rungs, because a fluent seat's hint would be a
 * scan of a whole language, every turn, for something nobody is ever shown.
 */
export function hintFor(
  state: WcState,
  seat: number,
  letter: string,
  used: ReadonlySet<string>,
): ChainHint | null {
  const lang = state.langs[seat];
  if (lang == null || HINT_AT[levelOf(state, seat)].length === 0) return null;
  const found = answerFor(state, seat, lang, letter, used);
  return found ? { seat, word: found.word, gloss: found.gloss ?? '' } : null;
}

/**
 * The letter the chase opens on.
 *
 * Normally the one the chain is already asking for: the chaser answers what
 * their opponent could not, which is the whole shape of the thing and keeps the
 * chain a chain rather than a fresh start with the same players.
 *
 * Unless their own language has hardly anything behind it, in which case they
 * open free, exactly as the first word of the game does. `tooThin` only ever
 * looked ahead to the *opponent's* language, so a letter that is perfectly
 * fair to hand across the table can be one the hander's own list cannot
 * answer: an English player may legally end on L, and if their Japanese
 * opponent then misses, chasing them on an L would be a chase nobody could ever
 * complete. Being handed an impossible letter is losing to the dictionary
 * (point 2) and it does not stop being that because the game is nearly over.
 */
export function chaseLetter(state: WcState, chaser: number, used: ReadonlySet<string>): string {
  const lang = state.langs[chaser];
  if (lang == null) return '';
  return tooThin(lang, state.required, used, modeOf(state)) ? '' : state.required;
}

/**
 * A minute of `seat`'s has gone. Work out what that costs them.
 *
 * Both ways of losing one come through here, the clock and the give-up button,
 * because they differ only in what the status line says.
 *
 * What it costs depends on where the game is. The first miss puts that seat
 * out of the chain and hands the other one a chase; the second is the chaser's
 * own, and ends it. And a chase that could not be lost is not run at all: a
 * survivor who is already ahead has already beaten the score they would be
 * chasing. `ChainMiss` is where the reasoning lives, tie-break included.
 */
export function missed(state: WcState, seat: number, gaveUp: boolean, now: number): WcState {
  const lang = state.langs[seat] ?? 'en';
  const miss: ChainMiss = { seat, gaveUp, reveal: revealFor(state, seat, lang) };
  const withMiss: WcState = { ...state, misses: [...state.misses, miss] };

  // The chaser's own minute. They had the chain to themselves and did not get
  // past the target, so the seat that set it takes it, level included.
  if (state.phase === 'chase') return ended(withMiss, seat);

  const other = opponentOf(seat);
  if (scoreFor(state, other) > scoreFor(state, seat)) return ended(withMiss, seat);

  const used = usedKeys(state);
  return handTo({ ...withMiss, phase: 'chase' }, other, chaseLetter(state, other, used), used, now);
}

/**
 * Setup is over: decide what kind of chain this is, and put the first player
 * on the clock with the whole of their language open.
 *
 * The mode is settled here and never again. Deciding it per word, by asking
 * each time whether the two languages match, comes to the same answer, but it
 * puts the rule somewhere a later change could make it waver mid-chain, and a
 * game that starts asking for `ł` after ten words of `l` is unplayable.
 */
export function beginPlay(state: WcState, langs: ChainLang[], now: number): WcState {
  const strict = langs[0] === langs[1];
  return handTo({ ...state, phase: 'playing', langs, strict }, 0, '', new Set(), now);
}

export function isLevel(value: unknown): value is ChainLevel {
  return typeof value === 'string' && (CHAIN_LEVELS as readonly string[]).includes(value);
}

export function isLang(value: unknown): value is ChainLang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/**
 * One link, as the ledger wants it.
 *
 * The key is the folded **lemma** where the list knows one, and that is the
 * whole of why this lives here rather than in `harvest.ts`: `fold` is in
 * `chainDictionary.ts` with eighty thousand lines of word list behind it, and
 * the ledger may never reach either. Polish files `jestem` and `być`
 * separately and plays them separately, which is right for the chain and wrong
 * for a vocabulary — six inflections of one verb is one verb learned, and a
 * profile claiming six is lying to somebody deciding what to study.
 *
 * `link.key` is deliberately *not* reused for this even though it is already
 * folded: it is the folded form of the word as played, which is the thing the
 * chain links on, and using it would file every inflection under its own row.
 */
export function linkLearned(link: ChainLink, grade: Grade): Learned {
  return {
    lang: link.lang,
    key: fold(link.lemma || link.word),
    word: link.word,
    script: link.script,
    lemma: link.lemma,
    gloss: link.gloss,
    rank: link.rank,
    grade,
    ms: link.ms,
  };
}
