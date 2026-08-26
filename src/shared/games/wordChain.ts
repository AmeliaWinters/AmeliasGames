import type { GameDefinition, MoveResult, Rng } from '../types.js';
import type { Learned, SeatOutcome } from '../harvest.js';
import type { Grade } from '../review.js';
import { wasFast } from '../review.js';
import { GAME_MANIFEST } from './manifest.js';
import { named } from '../refusal.js';
import {
  chainKey,
  chainLookup,
  commonestStarting,
  countEnding,
  countStarting,
  fold,
  foldLetter,
} from './chainDictionary.js';
import type { ChainEntry } from './chainDictionary.js';
import {
  LANGS,
  LANG_NAME,
  MIN_ANSWERS,
  MIN_LENGTH,
  TURN_MS,
  canAct,
  hasBeaten,
  isFinished,
  lockTurns,
  lockedFor,
  saidBy,
  scoreFor,
  stoppedSeat,
  studyFor,
  targetScore,
  turnMsFor,
  usedKeys,
} from './wordChainDisplay.js';

import type {
  ChainLang,
  ChainLink,
  ChainMiss,
  ChainMode,
  LetterCooldown,
  WcMove,
  WcState,
} from './wordChainDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word lists.
export {
  LANGS,
  LANG_NAME,
  LIST_SIZE,
  MIN_ANSWERS,
  MIN_LENGTH,
  MIN_TURN_MS,
  TURN_MS,
  TURN_STEP_MS,
  TURN_STEP_WORDS,
  canAct,
  chainStats,
  clockCall,
  formatClock,
  hasBeaten,
  isFinished,
  lockTurns,
  lockedFor,
  missFor,
  msLeftFor,
  outOfTime,
  saidBy,
  scoreFor,
  stoppedSeat,
  studyFor,
  targetScore,
  turnMsFor,
  usedKeys,
  wordPoints,
} from './wordChainDisplay.js';
export { LOCK_FREE, LOCK_FULL, MAX_LOCK } from './wordChainDisplay.js';
export type {
  ActiveCooldown,
  ChainHighlight,
  ChainLang,
  ChainLink,
  ChainMiss,
  ChainMode,
  ChainStats,
  LetterCooldown,
  SeatStat,
  WcMove,
  WcPhase,
  WcState,
} from './wordChainDisplay.js';

/**
 * Word chain across three languages: say a word starting with the letter the
 * last one ended on, in the language you chose, before your minute runs out.
 *
 * Two play, each on a language of their own, so a Polish word ending in A is
 * answered by an English or Japanese one beginning with A and the chain crosses
 * languages every turn. The clock is what beats you, either by running out or
 * by your admitting it was going to, and when it does the game shows the
 * commonest word that would have worked. That reveal is the point of the whole
 * thing: a minute of failing to think of a word is when you are most likely to
 * remember the answer.
 *
 * Words score their letters, and the score is what the game is settled on: a
 * lost minute puts you out of the chain, not out of the game. See point 5.
 *
 * Nine things here are worth knowing before changing anything:
 *
 * 1. **Japanese links on romaji letters, not on kana.** Real shiritori chains
 *    the last *mora* to the first, and a word ending in the kana `n` loses
 *    outright. This game cannot do that, because a kana has no letter for an
 *    English or Polish word to answer, and cross-language chaining is the
 *    whole idea. So Japanese is typed and linked as romaji: the word for
 *    cherry blossom is `sakura`, it ends in an `a`, and the next player
 *    answers an `a` in whatever language they are playing. A word ending in
 *    the kana `n` is an `n` here and perfectly legal. This is a deliberate
 *    departure from the game Japanese speakers know.
 *
 * 2. **A word that leaves the opponent almost nothing to say is refused.** No
 *    Japanese word begins with L, Q or X, and Polish has exactly one starting
 *    with X. Without this rule a player could be handed a letter their
 *    language cannot answer and lose to the dictionary rather than to their
 *    own vocabulary, which is not a game. `tooThin` is the check, and the bar
 *    is a count rather than one word. The numbers, per language, and the
 *    measurements behind them are on `MIN_ANSWERS`.
 *
 * 3. **A refused word costs seconds, not the game.** The lists hold common
 *    words only and will not have everything a player knows, so a rejection
 *    has to be survivable: `applyMove` says why and leaves the clock alone.
 *
 * 4. **Two players in the same language get their accents back.** The chain
 *    normally links on the folded letter, because `ś` is not something an
 *    English or Japanese player can answer. When both seats picked the same
 *    language there is nobody to strand, so the chain links on the letter as
 *    written: *coś* asks for *świat*, and *był* asks for *łatwo*. A Polish rule
 *    in practice, English and Japanese having no accented forms, and `mode` is
 *    the whole of it, decided once in `beginPlay` and stored on the state so
 *    the board and the reducer cannot come to differ. Five of the nine accented
 *    letters begin no Polish word at all, and the same `MIN_ANSWERS` gate that
 *    refuses a Japanese L refuses a word ending in one of them.
 *
 * 5. **Losing a minute is not losing the game.** Two ways to lose one, the
 *    clock running out and saying so yourself, and `missed` is both, because
 *    the reveal is the point of the game and a player who has given up on the
 *    minute should not sit through the rest of it to see the word. Only
 *    `gaveUp` tells the two apart, and only the copy reads it.
 *
 *    What it costs is the chain, not the game. The seat that misses is out of
 *    it with whatever they have scored, and the other player carries the chain
 *    on alone, answering the very letter their opponent could not, until they
 *    are strictly past that score (which wins it) or their own minute goes
 *    (which does not). That is `chase`, and `ChainMiss` carries the reasoning,
 *    the tie-break and the one case where the chase is skipped.
 *
 * 6. **Every word scores its letters, and nothing else scores.** `wordPoints`
 *    is the whole rule and `scoreFor` reads it off the chain, so there is no
 *    running total anywhere to fall out of step with the words on the screen.
 *    Length is the only axis: a ten-letter word is worth a little over three
 *    three-letter ones, which is what makes reaching for a long word under a
 *    five-second clock a decision rather than a flourish.
 *
 * 7. **A thin ending is not yours again for a while.** Ending a word puts that
 *    letter out of your own reach for up to five of your turns, priced purely
 *    by how many words in your language still end on it: three hundred left
 *    costs nothing, a hundred and fifty or fewer costs the full five, and it is
 *    a straight line between. `lockTurns` is the whole rule and `lockedFor` is
 *    the check. It replaced a per-seat ladder that grew every time you went
 *    back to a letter, which was fair and untrackable: the count was private,
 *    invisible until a word was refused, and spread over every letter at once.
 *    This price is a fact about the list, so both players see the same number
 *    and it can be shown before the word is submitted. No escape hatch: unlike
 *    `tooThin`, which protects a player from the dictionary, this is what stops
 *    two players stripping the same corner of the list bare. It also means the
 *    reveal has to respect it, or the game would end by showing the loser a
 *    word it would have refused.
 *
 * 8. **The minute shrinks as the chain grows.** Every word on the chain takes
 *    a second off the answer, down to a floor of five. `turnMsFor` is the whole
 *    rule, and `TURN_STEP_WORDS` and `MIN_TURN_MS` carry the reasoning. Two
 *    players who can keep going forever should not be able to, and the chain is
 *    the only thing this game counts, so it is the only honest thing to tighten
 *    against. Nothing on the state records it: the allowance is a function of
 *    `chain.length`, so any turn's clock can be recovered from the word's place
 *    in the chain, which is what the end screen needs to say a word landed with
 *    four seconds to spare. The only clock that never shrinks is setup's, see
 *    `start`.
 *
 * 9. **The chase is played under every rule the chain was.** Same shrinking
 *    clock, same cooldowns, same refusal to hand over a letter with nothing
 *    behind it, except that the seat protected from a dead letter is now the
 *    chaser themselves, since they are answering their own words. The one
 *    concession is the letter the chase *starts* on, see `chaseLetter`.
 */

const SEATS = 2;

const opponentOf = (seat: number): number => (seat + 1) % SEATS;

/**
 * The letter a word hands on: the last of the key the chain is linking on.
 *
 * In a `loose` game that is the folded key, so *ręką* hands on an `a`. In a
 * `strict` one it is the word as written, so *coś* hands on a `ś`.
 */
const handsOn = (entry: ChainEntry, mode: ChainMode): string => chainKey(entry, mode).slice(-1);

/** Which chain this game is: see `ChainMode`, and point 4 above. */
const modeOf = (state: WcState): ChainMode => (state.strict ? 'strict' : 'loose');

function linkFrom(entry: ChainEntry, lang: ChainLang, seat: number, ms: number): ChainLink {
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
function tookUntil(state: WcState, now: number): number {
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
function tooThin(
  lang: ChainLang,
  letter: string,
  used: ReadonlySet<string>,
  mode: ChainMode,
): boolean {
  return countStarting(lang, letter, used, mode) < MIN_ANSWERS[lang];
}

/** The letters `seat` may not end a word on right now. */
function blockedFor(state: WcState, seat: number): Set<string> {
  return new Set(lockedFor(state, seat).map((cool) => cool.letter));
}

/**
 * How long ending on `letter` would lock it for `seat`, were they to do it
 * now. Zero when the ending is free, which is the common case.
 *
 * `used` is the set of words that count as spent for the question, which at
 * the moment of charging includes the word being said: a player is not
 * credited with the ending they have just consumed. Exported because the board
 * can price a word before it is submitted, and because the warning and the
 * penalty must not be able to disagree.
 */
export function lockCostFor(
  state: WcState,
  seat: number,
  letter: string,
  used: ReadonlySet<string> = usedKeys(state),
): number {
  const lang = state.langs[seat];
  if (lang == null) return 0;
  return lockTurns(countEnding(lang, letter, used, modeOf(state)));
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
function cooledBy(
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
function handTo(
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
    // Shorter the further the chain has run, see `turnMsFor`. Measured off the
    // chain this state already carries, so the seat answering the fourth word
    // is the first to get less than the minute.
    deadline: now + turnMsFor(state.chain.length),
  };
}

/** Nobody is on the clock any more, and `loser` is settled. */
function ended(state: WcState, loser: number): WcState {
  return { ...state, phase: 'over', loser, available: null, deadline: null };
}

/**
 * The word `seat` could have said, as a link ready for the end screen.
 *
 * Filtered by that seat's own cooldowns, because the reveal is a claim ("this
 * is what you could have said") and a word the game would have refused makes a
 * liar of the one screen the whole game is played for.
 */
function revealFor(state: WcState, seat: number, lang: ChainLang): ChainLink | null {
  const found = commonestStarting(
    lang,
    state.required,
    usedKeys(state),
    modeOf(state),
    blockedFor(state, seat),
    // Only this seat's, and only in the language they were playing. A word
    // their opponent owes a review on is nothing to do with the minute that
    // has just gone, and a word due in a language nobody at this table chose
    // would be matched on a folded key that means something else entirely.
    // See `WcState.study` and `commonestStarting`.
    new Set(studyFor(state, seat, lang)),
  );
  // Zero milliseconds, because nobody spent any time on it: the reveal is a
  // word out of the list, not a turn that was played.
  return found ? linkFrom(found, lang, seat, 0) : null;
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
function chaseLetter(state: WcState, chaser: number, used: ReadonlySet<string>): string {
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
function missed(state: WcState, seat: number, gaveUp: boolean, now: number): WcState {
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
function beginPlay(state: WcState, langs: ChainLang[], now: number): WcState {
  const strict = langs[0] === langs[1];
  return handTo({ ...state, phase: 'playing', langs, strict }, 0, '', new Set(), now);
}

function isLang(value: unknown): value is ChainLang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

export const wordChain: GameDefinition<WcState, WcMove> = {
  ...GAME_MANIFEST.wordchain,

  setup(_playerCount, _rng, _now, study): WcState {
    return {
      phase: 'setup',
      langs: Array(SEATS).fill(null),
      // Not knowable until both seats have chosen. See `beginPlay`.
      strict: false,
      chain: [],
      // One list per seat, both empty: nobody has ended a word on anything.
      cooldowns: Array.from({ length: SEATS }, () => []),
      // Copied in seat by seat rather than taken whole, because the room hands
      // over one entry per *seated player* and this game always holds two
      // lists: a room dealt before somebody's profile arrived, or with a guest
      // in seat one, would otherwise leave a hole `revealFor` had to check.
      // A missing list and an empty one mean the same thing here, which is the
      // point. See `WcState.study`.
      study: Array.from({ length: SEATS }, (_, seat) => ({ ...study?.[seat] })),
      at: 0,
      required: '',
      // Nobody is thinking yet, so there is nothing to count. Set the moment
      // play begins, see `handTo`.
      available: null,
      // Null until the room says both seats are filled, see `start`. A clock
      // armed when the room *opened* would run down while the second player
      // was still reading the invite.
      deadline: null,
      // Nobody is out until a minute goes, and the game is not over when one
      // does. See `missed`.
      loser: null,
      misses: [],
    };
  },

  start(state, now) {
    if (state.phase !== 'setup' || state.deadline !== null) return null;
    return { ...state, deadline: now + TURN_MS };
  },

  deadline(state) {
    return state.deadline;
  },

  applyMove(state, move, seat, _rng: Rng, now): MoveResult<WcState> {
    const at = now ?? 0;
    if (!canAct(state, seat, now)) return { ok: false, error: 'Not your move.' };

    if (move.type === 'lang') {
      if (!isLang(move.lang)) {
        return { ok: false, error: `${named(move.lang)} is not one of the languages.` };
      }
      const langs = state.langs.slice();
      langs[seat] = move.lang;
      if (langs.some((l) => l === null)) return { ok: true, state: { ...state, langs } };
      return { ok: true, state: beginPlay(state, langs as ChainLang[], at) };
    }

    if (move.type === 'give-up') {
      // Setup is the one phase where `canAct` lets both seats through, and
      // there is nothing to give up on there: a player who does not want to
      // choose a language is handled by `expire`. A chaser may give up like
      // anybody else, being the only seat on the clock, and conceding a chase
      // they cannot finish is the same admission the button has always been
      // for.
      if (state.phase !== 'playing' && state.phase !== 'chase') {
        return { ok: false, error: 'The game has not started.' };
      }
      return { ok: true, state: missed(state, seat, true, at) };
    }

    if (move.type !== 'say') return { ok: false, error: 'No such move.' };

    const lang = state.langs[seat];
    if (lang == null) return { ok: false, error: 'Choose a language first.' };

    const typed = move.word.trim();
    if (typed.length < MIN_LENGTH) {
      return {
        ok: false,
        error: `${named(typed)} is too short. Words have to be at least ${MIN_LENGTH} letters.`,
      };
    }

    const entry = chainLookup(lang, typed);
    // The lists hold common words only, so this is the refusal a player is
    // most likely to think is wrong. Naming the language it looked in is what
    // makes it arguable rather than baffling.
    // The word is quoted rather than interpolated bare, the way Word Duel and
    // Word Hunt do it: those have already reduced theirs to letters by this
    // point, and this one has not -- `typed` is whatever was in the box.
    if (!entry) {
      return { ok: false, error: `${named(typed)} is not in the ${LANG_NAME[lang]} list.` };
    }

    // Repeats are checked before the letter, and the order is the message. A
    // word that is both already said and starts wrongly is most usefully
    // reported as the repeat: "has to start with E" sends a player hunting for
    // a word they have in fact already played.
    const used = usedKeys(state);
    if (used.has(entry.key)) return { ok: false, error: `${entry.word} has already been said.` };

    // Matched against the *stored* word, not the typed one. In a strict game
    // that is the entire trick: `chainLookup` found this entry from `swiatlo`,
    // and it is **światło** that has to start with the required `ś`. Nobody is
    // ever asked to type a letter their keyboard does not have.
    const mode = modeOf(state);
    if (state.required && !chainKey(entry, mode).startsWith(foldLetter(state.required, mode))) {
      return {
        ok: false,
        error: `${entry.word} has to start with ${state.required.toUpperCase()}.`,
      };
    }

    // In a chase there is nobody to hand the letter to but yourself, which is
    // what makes the cooldowns and `tooThin` matter more rather than less: a
    // chaser is the one who has to answer the word they just played.
    const next = state.phase === 'chase' ? seat : opponentOf(seat);
    const nextLang = state.langs[next];
    const letter = handsOn(entry, mode);

    // Checked after the letter the word must *start* with and before the one
    // it hands on, which is the order the player reads them in: a word that
    // does not fit the chain at all is not yet a cooldown question.
    const cooling = lockedFor(state, seat).find((cool) => cool.letter === letter);
    if (cooling) {
      const turns = cooling.turns === 1 ? 'your next turn' : `${cooling.turns} more of your turns`;
      // Says how long rather than just refusing, because unlike a word that is
      // not in the list this is a rule the player can plan around: knowing it
      // is back in two turns is the difference between a wall and a cost.
      return {
        ok: false,
        error: `${entry.word} ends in ${letter.toUpperCase()}, and you have just used that ending. It is yours again in ${turns}.`,
      };
    }

    const after = new Set(used).add(entry.key);
    if (nextLang != null && tooThin(nextLang, letter, after, mode)) {
      const ends = letter.toUpperCase();
      // Says "hardly any" rather than a count, because the count is the part a
      // player would argue with: told there are three, they will name a fourth
      // that the list has never heard of and be right. The complaint the copy
      // has to answer is "why won't you take my word", and the answer is that
      // the other player would have had nothing to say to it.
      return {
        ok: false,
        error: `${entry.word} ends in ${ends}, and there are hardly any ${LANG_NAME[nextLang]} words left that start with it.`,
      };
    }

    const chained: WcState = {
      ...state,
      chain: [...state.chain, linkFrom(entry, lang, seat, tookUntil(state, at))],
      // Charged off the pre-append state, see `cooledBy`.
      cooldowns: cooledBy(state, seat, letter, after),
    };

    // A chase ends the moment it is won, in the middle of the chaser's run
    // rather than at the end of a turn: they are past the score, there is
    // nothing left to prove, and a game that made them say one more word for
    // it would be asking for a formality. The seat they passed is the loser,
    // there being only two.
    const stopped = stoppedSeat(chained);
    if (state.phase === 'chase' && stopped !== null && hasBeaten(chained, seat)) {
      return { ok: true, state: ended(chained, stopped) };
    }

    return { ok: true, state: handTo(chained, next, letter, after, at) };
  },

  /**
   * Show a seat its own cooldowns and nobody else's.
   *
   * The letters you have worn out are yours to keep track of. An opponent who
   * could see them would be playing a different game, steering the chain
   * towards a letter they know is locked, and this rule is meant to be a tax on
   * your own habits rather than a weapon to hand over.
   *
   * A blanked list is indistinguishable from an empty one, which is the point:
   * knowing that a lock exists without knowing which letter it is on is worse
   * than knowing nothing, because it invites guessing at it.
   *
   * Kept hidden after the game ends too, unlike Battleship's fleet. There is
   * nothing to find out, the chain being on screen and the reveal the ending
   * this game is played for, and a table of the loser's worn-out letters would
   * read as a second verdict on them.
   */
  view(state, seat) {
    return {
      ...state,
      cooldowns: state.cooldowns.map((cools, index) => (index === seat ? cools : [])),
      // The other seat's is blanked for a different reason than the cooldowns
      // are, and a stronger one: a cooldown is a fact about this game, and a
      // study list is somebody's vocabulary. See `WcState.study`.
      // `?? []` for the same reason `studyFor` has one: a room dealt before
      // this field existed can still be restored from storage.
      study: (state.study ?? []).map((keys, index) => (index === seat ? keys : {})),
    };
  },

  /**
   * Settle a minute that has gone.
   *
   * Two quite different endings share this hook. During setup nobody loses: an
   * undecided seat is given English and the game starts, because a player who
   * wandered off before picking a language should not hand their opponent a
   * win, and a room stuck forever on a menu is worse than either. Once play
   * has started the clock is what takes a seat out of the chain, and `missed`
   * is where that becomes either a chase or an ending, along with the reveal,
   * the commonest word they could have said. The give-up button goes through
   * the same function; the only thing telling the two apart afterwards is
   * `gaveUp`.
   *
   * A chase runs on the same clock and expires the same way, which is the
   * second half of the rule: the chaser is not given unlimited time to find
   * the points, they are given the turn the chain has got down to.
   */
  expire(state, now) {
    if (state.deadline === null || now < state.deadline) return null;

    if (state.phase === 'setup') {
      const langs = state.langs.map((l) => l ?? 'en') as ChainLang[];
      return beginPlay(state, langs, now);
    }
    if (state.phase !== 'playing' && state.phase !== 'chase') return null;

    return missed(state, state.at, false, now);
  },

  /**
   * A hint for the status line, and nothing more.
   *
   * During setup it names whoever has still to choose, but both may act then
   * and neither is waiting on the other, so it is a guess in exactly the way
   * the contract warns about. `canAct` is the question every control means. In
   * a chase it names the chaser every turn, which is honest: they are the only
   * seat left with anything to do.
   */
  turn(state) {
    if (state.phase === 'over') return null;
    if (state.phase === 'setup') {
      const waiting = state.langs.findIndex((l) => l === null);
      return waiting === -1 ? 0 : waiting;
    }
    return state.at;
  },

  canAct,

  isOver: isFinished,

  status(state, names) {
    const who = (seat: number): string => names[seat] ?? `Player ${seat + 1}`;
    if (state.phase === 'over') {
      if (state.loser === null) return 'Game over.';
      const winner = opponentOf(state.loser);
      // The last miss is always the loser's: a chase that ended in points
      // finishes the seat that fell out first, and a chase that ran out of
      // time finishes the chaser. So this is how *they* lost, either way.
      const how = state.misses.at(-1)?.gaveUp ? 'gave up' : 'ran out of time';
      // The score is said out loud because it is what the game was decided on,
      // and because in a chase the verdict is otherwise baffling: the player
      // who ran out of time first can perfectly well have won.
      return `${who(state.loser)} ${how}. ${who(winner)} wins, ${scoreFor(state, winner)} points to ${scoreFor(state, state.loser)}.`;
    }
    if (state.phase === 'setup') {
      const waiting = state.langs.flatMap((l, i) => (l === null ? [who(i)] : []));
      return waiting.length === SEATS
        ? 'Choosing languages.'
        : `Waiting for ${waiting.join(' and ')} to choose a language.`;
    }
    const lang = state.langs[state.at];
    const named = lang ? `${LANG_NAME[lang]} word` : 'word';
    // "a English word" was on this line for as long as the line existed. The
    // three language names are all the article ever has to cope with, and one
    // of them starts with a vowel.
    const asked = state.required
      ? `${/^[aeiou]/i.test(named) ? 'an' : 'a'} ${named} starting with ${state.required.toUpperCase()}`
      : `any ${named}`;
    if (state.phase === 'chase') {
      const target = targetScore(state) ?? 0;
      const stopped = stoppedSeat(state);
      // Says the number they need rather than the number they have, because
      // that is all a chaser is thinking about, and it is one more than the
      // target, since level does not take it.
      return `${stopped === null ? 'The other player' : who(stopped)} is out on ${target}. ${who(state.at)} needs ${target + 1 - scoreFor(state, state.at)} more ${target + 1 - scoreFor(state, state.at) === 1 ? 'point' : 'points'}: ${asked}.`;
    }
    return `${who(state.at)}'s turn: ${asked}.`;
  },

  /**
   * What the chain taught the two of them.
   *
   * Three kinds of event come out of one game, and the third is the reason
   * this method is worth having at all:
   *
   * 1. **A word you said** is production under a clock, which is the strongest
   *    evidence this app can produce that you know something. `produced-fast`
   *    when it landed inside two fifths of the allowance *that turn* had —
   *    `turnMsFor(i)`, not `TURN_MS`, because the minute shrinks a second a
   *    word and a five-second turn near the end of a long chain is a different
   *    thing entirely. A word said in four seconds is fast at the start and
   *    ordinary at word fifty-five, and the ledger should not report the
   *    difference between those as a difference in the player.
   *
   * 2. **A word they said** is a sighting, and nothing more. It bumps `seen`
   *    on a row that already exists and never creates one — see `applyRecord`.
   *    Reading a word is not knowing it, and a ledger that counted it would
   *    have both players "knowing" every word in a language neither was
   *    playing.
   *
   * 3. **The word you could not find** is the best data in the whole app. This
   *    game's entire argument (see the note at the top of this file) is that a
   *    minute of failing to think of a word is when you are most likely to
   *    remember it, and the reveal is what that minute is for. So a reveal
   *    goes in as `shown`: introduced at the bottom of the ladder, back
   *    tomorrow. It is the single behaviour that turns this from a game into a
   *    course, and it costs one line.
   *
   * Only ever called once the game is over, so `loser` is set and both misses
   * are in. A game with no loser cannot happen here — `phase` only becomes
   * `over` through a path that names one — but it is read defensively anyway,
   * because the cost of being wrong is a profile write and profiles are the
   * one thing in this repo that does not get thrown away.
   */
  record(state, seats) {
    const outcomes: SeatOutcome[] = [];

    for (let seat = 0; seat < seats; seat++) {
      const learned: Learned[] = [];

      state.chain.forEach((link, i) => {
        learned.push(
          linkLearned(
            link,
            link.seat === seat
              ? wasFast(link.ms, turnMsFor(i))
                ? 'produced-fast'
                : 'produced'
              : 'seen',
          ),
        );
      });

      // Both misses are walked rather than only this seat's, because a seat
      // reads its opponent's reveal too — it is on the same end screen — but
      // only its own counts as having failed to find anything.
      for (const miss of state.misses) {
        if (miss.reveal === null) continue;
        learned.push(linkLearned(miss.reveal, miss.seat === seat ? 'shown' : 'seen'));
      }

      outcomes.push({
        seat,
        result: state.loser === null ? 'drew' : state.loser === seat ? 'lost' : 'won',
        learned,
      });
    }

    return { gameId: wordChain.id, seats: outcomes };
  },
};

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
function linkLearned(link: ChainLink, grade: Grade): Learned {
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
