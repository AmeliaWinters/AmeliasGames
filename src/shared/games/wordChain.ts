import type { GameDefinition, MoveResult, Rng } from '../types.js';
import type { Learned, SeatOutcome } from '../harvest.js';
import { wasFast } from '../review.js';
import { GAME_MANIFEST } from './manifest.js';
import { named } from '../refusal.js';
// The turn machinery. Same side of the boundary as this file: it reaches the
// dictionary, so nothing on the client may import either.
import {
  answererOf,
  beginPlay,
  cooledBy,
  ended,
  handTo,
  handsOn,
  isLang,
  isLevel,
  linkFrom,
  linkLearned,
  missed,
  modeOf,
  opponentOf,
  tookUntil,
  tooThin,
  SEATS,
} from './wordChainTurns.js';
import {
  chainKey,
  chainLookup,
  foldLetter,
} from './chainDictionary.js';
import {
  CHAIN_DEFAULT_LEVEL,
  LANG_NAME,
  MIN_LENGTH,
  TURN_MS,
  canAct,
  hasBeaten,
  hintsFor,
  isFinished,
  lockedFor,
  scoreFor,
  stoppedSeat,
  targetScore,
  turnMsFor,
  usedKeys,
} from './wordChainDisplay.js';

import type {
  ChainLang,
  WcMove,
  WcState,
} from './wordChainDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word lists.
export {
  CHAIN_DEFAULT_LEVEL,
  CHAIN_LEVELS,
  HINT_AT,
  LANGS,
  LANG_NAME,
  LEVEL_NAME,
  LIST_SIZE,
  MIN_ANSWERS,
  MIN_LENGTH,
  MIN_TURN_MS,
  TURN_MS,
  TURN_STEP_MS,
  TURN_STEP_WORDS,
  canAct,
  chainHintSteps,
  chainStats,
  clockCall,
  formatClock,
  hasBeaten,
  hintsFor,
  isFinished,
  levelOf,
  lockTurns,
  lockedFor,
  maskWord,
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
export { MAX_LOCK, THIN_START } from './wordChainDisplay.js';
export type {
  ActiveCooldown,
  ChainHighlight,
  ChainHint,
  ChainHintStep,
  ChainLang,
  ChainLevel,
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
 * Ten things here are worth knowing before changing anything:
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
 * 7. **Leave somebody on a thin letter once and you may not do it again.**
 *    Hand over a letter the answering seat has fewer than five hundred words
 *    for and it is out of *your* reach for your next five turns. `THIN_START`
 *    is the bar, `lockTurns` is the whole rule and `lockedFor` is the check.
 *
 *    It is rule 2 one bar up, and priced off the same count: words in the
 *    answering seat's language that start with the letter and are still
 *    unsaid. Under `MIN_ANSWERS` the word is refused, because there is no
 *    answer; under `THIN_START` it is allowed once, because there is an answer
 *    but not five of them in a row. English *-y* is the case it is written
 *    for: 228 words start with it, which is playable, and playable four times
 *    running is not.
 *
 *    Two earlier versions of this got it wrong in opposite directions, and
 *    `lockTurns` records both. No escape hatch: unlike `tooThin`, which
 *    protects a player from the dictionary, this is what stops two players
 *    stripping the same corner of the list bare. It also means the reveal has
 *    to respect it, or the game would end by showing the loser a word it would
 *    have refused.
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
 *
 * 10. **A level buys help, not time and not points.** Every seat gets the same
 *     clock and the same scoring; the three bands decide when, on a turn that
 *     is going badly, the game starts walking you towards a word you could
 *     have said. A beginner is nudged at twenty seconds with what the word
 *     means and at forty with its first two letters and its length, the middle
 *     band at thirty-five and fifty, and somebody fluent never. `HINT_AT` is
 *     the ladder and `hintsFor` reads it against the allowance that turn
 *     actually had, so the hints stop coming as the clock shrinks past them.
 *     Two rules hold it together: it is the *same* word `revealFor` would show
 *     at the end of the minute, found by one function (`answerFor`), because
 *     hinting at one word and revealing another reads as the game changing its
 *     mind; and it goes only to the seat on the clock, blanked harder than the
 *     cooldowns are, because it is the answer to the turn in progress.
 */

export const wordChain: GameDefinition<WcState, WcMove> = {
  ...GAME_MANIFEST.wordchain,

  setup(_playerCount, _rng, _now, study): WcState {
    return {
      phase: 'setup',
      langs: Array(SEATS).fill(null),
      // The middle band for both, so a table that ignores the control plays
      // very much the game it played before hints existed. See
      // `CHAIN_DEFAULT_LEVEL`.
      levels: Array(SEATS).fill(CHAIN_DEFAULT_LEVEL),
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
      // Nobody is on the clock, so nobody is being walked anywhere. Set with
      // the clock, see `handTo`.
      hint: null,
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

    if (move.type === 'level') {
      // Setup only, and `canAct` narrows that further: a seat may act during
      // setup right up until it picks a language, so in practice the level is
      // settled *before* the language and is final the moment the language is.
      // Deliberate. The second language to land starts the game, so a level
      // that could still be changed after that would be a control the other
      // player is already playing against.
      if (state.phase !== 'setup') {
        return { ok: false, error: 'Levels are set before the first word.' };
      }
      if (!isLevel(move.level)) {
        return { ok: false, error: `${named(move.level)} is not one of the levels.` };
      }
      const levels = (state.levels ?? Array(SEATS).fill(CHAIN_DEFAULT_LEVEL)).slice();
      levels[seat] = move.level;
      return { ok: true, state: { ...state, levels } };
    }

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
    const next = answererOf(state, seat);
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
      // Names the thin letter and not the count, the way `tooThin` does and
      // for the same reason: told there are 228 words in Y, a player will name
      // a 229th and be right.
      return {
        ok: false,
        error: `${entry.word} ends in ${letter.toUpperCase()}, and you have just left somebody on that letter with hardly anything to say. It is yours again in ${turns}.`,
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

    // Read off the pre-append state, which is the one the player was looking
    // at while they typed. Any rung showing counts, not just the one that
    // names the word: the gloss alone is often enough to retrieve it, and a
    // grade that only fired on the spelling rung would let the ladder's first
    // step through for free.
    const helped = hintsFor(state, seat, at).length > 0;

    const chained: WcState = {
      ...state,
      chain: [...state.chain, linkFrom(entry, lang, seat, tookUntil(state, at), helped)],
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
      // Blanked harder than the cooldowns below, and for a better reason: this
      // is the answer to the turn that is running. A seat waiting on its
      // opponent would otherwise be handed the word that opponent is failing to
      // find, and with it the letter it is about to be asked for.
      hint: state.hint?.seat === seat ? state.hint : null,
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

  // Word Chain settles a loser rather than a winner: the seat that ran out is
  // the one the rules name, and with two seats the other one won.
  winner(state) {
    return state.loser === null ? null : opponentOf(state.loser);
  },

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
              ? link.hinted
                ? // A word the ladder handed over is not production, however
                  // fast it was typed: reading a hint and typing it is quick.
                  // Vocab Race grades the same situation the same way, and the
                  // two games have to agree, because they file into one ledger
                  // and a card does not know which game promoted it.
                  'hinted'
                : wasFast(link.ms, turnMsFor(i))
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
