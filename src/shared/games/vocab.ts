import type { GameDefinition, MoveResult, Rng } from '../types.js';
import type { Learned, SeatOutcome } from '../harvest.js';
import type { Grade } from '../review.js';
import { wasFast } from '../review.js';
import { GAME_MANIFEST } from './manifest.js';
import { named } from '../refusal.js';
import { chainLookup, fold } from './chainDictionary.js';
import { vocabOptions, vocabQuestion } from './vocabDictionary.js';
import type { VocabQuestion } from './vocabDictionary.js';
import { phraseKeys } from './vocabPhrases.js';
import {
  DECK_DEPTH,
  DEFAULT_LEVEL,
  HINT_ALLOWANCE,
  HOST,
  MODE_CAP,
  MODE_LABEL,
  REVEAL_MS,
  SETUP_MS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LANG_NAME,
  VOCAB_LEVELS,
  VOCAB_MODES,
  askAt,
  canAct,
  canHint,
  everyoneDone,
  firstRight,
  hintOf,
  hintsLeft,
  isFinished,
  isPhrases,
  leaders,
  maskWord,
  roundDeadline,
  roundPoints,
  tryOf,
  windowMs,
} from './vocabDisplay.js';

import type {
  VocabAsk,
  VocabHow,
  VocabLang,
  VocabLevel,
  VocabMode,
  VocabMove,
  VocabRound,
  VocabState,
  VocabTry,
} from './vocabDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file and the dictionary ever reach the word lists.
export {
  DECK_DEPTH,
  DEFAULT_LEVEL,
  HINT_ALLOWANCE,
  HINT_SCALE,
  HOST,
  LEVEL_NAME,
  LEVEL_SCALE,
  LEVEL_WINDOW_MS,
  MODE_CAP,
  MODE_LABEL,
  MODE_NAME,
  PHRASE_COUNT,
  PHRASE_RARITY,
  PICK_EVERY,
  PICK_OPTIONS,
  PICK_SCALE,
  RARITY_STEP,
  REVEAL_MS,
  ROUND_MS,
  SETUP_MS,
  SPEED_BONUS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LANG_NAME,
  VOCAB_LEVELS,
  VOCAB_MODES,
  askAt,
  canAct,
  canHint,
  clockCall,
  everyoneDone,
  firstRight,
  formatClock,
  hintOf,
  hintsLeft,
  isFinished,
  isPhrases,
  leadScore,
  leaders,
  levelOf,
  maskWord,
  msLeftFor,
  outOfTime,
  rightTries,
  roundDeadline,
  roundPoints,
  tryOf,
  vocabStats,
  windowLeft,
  windowMs,
} from './vocabDisplay.js';
export type {
  VocabAnswer,
  VocabAsk,
  VocabHint,
  VocabHow,
  VocabLang,
  VocabLevel,
  VocabMode,
  VocabMove,
  VocabPhase,
  VocabRound,
  VocabSeatStat,
  VocabState,
  VocabStats,
  VocabTry,
} from './vocabDisplay.js';

/**
 * Learn Polish or Japanese by racing for it: everyone is shown what a word
 * means and types the word. Everybody who gets there scores, the earlier the
 * more, and a hundred points wins.
 *
 * The vocabulary is Word Chain's, read from the other side. Those lists are
 * ordered commonest first and carry an English gloss on every Polish and
 * Japanese entry, which is already a deck of flashcards, so "the top hundred
 * words" and "the top thousand" are a slice rather than a new corpus and this
 * game cost the bundle nothing. `vocabDictionary.ts` is where a gloss becomes a
 * clue.
 *
 * Nine things here are worth knowing before changing anything:
 *
 * 1. **One language and one difficulty for the whole room**, chosen by the
 *    seat that opened it. Per-player languages were the obvious design and
 *    they do not survive a shared clue: a clue has to be answerable by
 *    everybody racing for it, and Polish's top hundred and Japanese's top
 *    hundred overlap in *fourteen* meanings, all of them function words. Two
 *    players learning different languages are not in the same race, so the room
 *    picks one.
 *
 * 2. **A wrong answer costs you the round; a word nobody has heard of costs
 *    you nothing.** Those are different mistakes. Typing a real word with the
 *    wrong meaning is a guess, and a race where guessing is free is won by
 *    whoever types fastest rather than by whoever knows the word. Typing
 *    something the list has simply never heard of is usually a typo, or a real
 *    word from outside a subtitle corpus, and ending someone's round for that
 *    would be the dictionary playing rather than the player. See `guess`.
 *
 *    It costs you *your* round and nobody else's, which is the difference from
 *    every other version of this game: one seat being wrong, or one seat being
 *    right, leaves everybody else typing.
 *
 * 3. **What counts as right is generous, and deliberately wider than the clue
 *    it was cut from.** The clue for `mały` is "small", and a player who
 *    answers with a different Polish word meaning small has answered the
 *    question. `accepts` in the dictionary is every word in the language filed
 *    under any of the clue's senses. The alternative marks a learner wrong for
 *    knowing a synonym, the single most discouraging thing a language game can
 *    do.
 *
 * 4. **Accents and romaji spellings are optional**, because `chainLookup` does
 *    the finding: `zolty` reaches **żółty** and `kohii` reaches `koohii`. The
 *    board shows the canonical spelling back, which is the moment the spelling
 *    is taught rather than demanded, and the round records what was actually
 *    typed so the review can show both.
 *
 * 5. **The reveal is a phase, not a line of text.** Being beaten to a word is
 *    the moment it sticks, and a round that rolled straight into the next clue
 *    would spend that moment showing you something else to read. It is also
 *    the only phase where nobody may act.
 *
 *    A round reaches it two ways, the clock or every seat being done, and the
 *    second is much the commoner, because "give up" exists precisely so a table
 *    that has collectively run dry does not sit out the remaining twenty
 *    seconds. See `recordTry` and `roundDeadline`.
 *
 * 6. **The deck is dealt once, at setup, before the language is known.**
 *    `setup` and `applyMove` are the only places this game is handed an rng,
 *    and the round-to-round progression runs through `expire`, which is not.
 *    So `setup` shuffles the ranks 1...1000 and every later draw is a filter
 *    over that fixed order: deterministic, and decidable by a clock with no
 *    randomness anywhere near it. `view()` redacts the deck, because a client
 *    holding it beside a copy of the word list would know every answer before
 *    it was asked.
 *
 * 7. **A race between a fluent speaker and a learner is not a race**, and this
 *    game is meant to be played by exactly that pair: somebody learning Polish
 *    sitting down with somebody who grew up speaking it. Unhandicapped, the
 *    fluent player has the word before the clue has finished rendering and the
 *    learner answers nothing all game.
 *
 *    Three things together fix that, and none of them is a delay:
 *
 *    - **the round does not end when somebody wins it.** This is the load
 *      bearing one. The learner who needed twelve seconds now gets twelve
 *      seconds, because the expert answering at two no longer takes the clue
 *      off the screen;
 *    - **each seat declares what it knows, and that sets its window**: thirty
 *      seconds for a beginner, fifteen for somebody fluent
 *      (`LEVEL_WINDOW_MS`);
 *    - **and what its answers are worth**: full for a beginner, half for
 *      somebody fluent (`LEVEL_SCALE`), on top of a score that already pays
 *      for how rare the word was and how early the answer came
 *      (`roundPoints`).
 *
 *    So the expert still answers first and still scores; they just do not
 *    score enough, often enough, to run away with it, and nothing they do
 *    silences the other end of the table. `canAct` is the only gate.
 *
 * 8. **Every third round turns the question round.** A `say` round asks you to
 *    produce the word from its meaning; a `pick` round puts the word up and
 *    offers four meanings. Production is the direction this game is for, and it
 *    is also the direction where a learner who cannot reach the word does
 *    nothing at all for fifteen seconds, so recognition is mixed in at half
 *    points, as the round they can always play. See `VocabAsk`.
 *
 *    It costs a redaction rather than buying one. On a `say` round the clue is
 *    the question and the answer is the secret; on a `pick` round the *clue is
 *    the secret*, because it is the option that is correct, and the word is
 *    what goes out. A choice therefore names an index into `options` rather
 *    than a meaning, so a board never holds both halves. `view()` is where the
 *    asymmetry lives and it is the easiest thing in this file to get backwards.
 *
 * 9. **Three hints a game, and spending one is the only real decision in a
 *    round.** A hint shows the first letter and the length and halves what the
 *    answer pays. Before it there were two things to do with a word you did not
 *    know, stare at it or pass, and neither is playing.
 *
 *    It is the one move that does not end your round: it buys information and
 *    leaves you typing, which is what makes it a choice rather than a slower
 *    surrender. So it does not go through `recordTry`, nothing settles, and the
 *    round's deadline does not move. `canHint` is its gate, deliberately not
 *    folded into `canAct`, and hints are `say`-only, because the first letter
 *    of a word already printed on the screen is not information.
 */

const seatCount = (state: VocabState): number => state.scores.length;

/** A shuffled run of the ranks a game may ask about. See point 6 above. */
function deal(rng: Rng): number[] {
  const deck = Array.from({ length: DECK_DEPTH }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function roundFrom(
  question: VocabQuestion,
  now: number,
  ask: VocabAsk,
  options: string[],
): VocabRound {
  return {
    clue: question.clue,
    ask,
    options,
    hints: [],
    answer: {
      word: question.word,
      script: question.script,
      lemma: question.lemma,
      rank: question.rank,
    },
    began: now,
    tries: [],
  };
}

/**
 * The next clue this game can ask, reading forward from `drawn`.
 *
 * Three things can disqualify a rank and none of them is an error: it may sit
 * deeper than the difficulty allows, the word there may have no printable
 * gloss (about one in fifteen, see `vocabQuestion`), or its clue may be one
 * this game has already asked. The last is the only one that needs saying:
 * Polish files a lemma and its inflections separately and they are often
 * glossed identically, so without it a game could ask "to have" twice and mark
 * the same answer wrong the second time for being already used. Clues are
 * compared rather than words, because the clue is the thing a player sees.
 *
 * Null means the deck is spent, which ends the game. See `advance`.
 *
 * Which way round the clue is asked is decided here too, and it is a function
 * of how many rounds have already been filed and nothing else, because there is
 * no rng at this point in the game and there must not be, see point 6 above. A
 * `pick` round that cannot be built falls back to a `say`: `vocabOptions`
 * returns nothing when it cannot find three meanings that are not synonyms of
 * the answer, and asking the word the other way round is a better answer to
 * that than a question with two options in it.
 */
function draw(
  state: VocabState,
  lang: VocabLang,
  mode: VocabMode,
  now: number,
): { round: VocabRound; drawn: number } | null {
  const cap = MODE_CAP[mode];
  const asked = new Set(state.history.map((round) => round.clue));
  if (state.round) asked.add(state.round.clue);
  for (let i = state.drawn; i < state.deck.length; i++) {
    const rank = state.deck[i];
    if (rank > cap) continue;
    const question = vocabQuestion(lang, mode, rank);
    if (question === null || asked.has(question.clue)) continue;
    const wanted = askAt(state.history.length);
    const options = wanted === 'pick' ? vocabOptions(lang, mode, rank, cap, state.deck) : [];
    const ask = wanted === 'pick' && options.length === 0 ? 'say' : wanted;
    return { round: roundFrom(question, now, ask, options), drawn: i + 1 };
  }
  return null;
}

/**
 * Settle the game, naming a winner only where there is one.
 *
 * A shared lead leaves `winner` null, the honest answer and the one the copy
 * is written for. It can only happen when a game runs out of deck, since
 * reaching `TARGET` is reaching it first and one round hands out one point, so
 * it is rare and not worth inventing a tie-break for.
 */
function finish(state: VocabState): VocabState {
  const best = leaders(state);
  return {
    ...state,
    phase: 'over',
    deadline: null,
    winner: best.length === 1 ? best[0] : null,
  };
}

/**
 * Put the settled round away and deal the next one, or end the game.
 *
 * The two endings are checked in this order on purpose: somebody reaching five
 * ends the game even if the deck still has clues in it, and a spent deck ends
 * it even though nobody got there. Both come through `finish`, so the winner
 * is decided the same way either way.
 */
function advance(state: VocabState, now: number): VocabState {
  const put: VocabState = state.round === null
    ? state
    : { ...state, history: [...state.history, state.round], round: null };

  if (put.lang === null) return finish(put);
  if (put.scores.some((score) => score >= TARGET)) return finish(put);

  const next = draw(put, put.lang, put.mode, now);
  if (next === null) return finish(put);

  return {
    ...put,
    phase: 'asking',
    round: next.round,
    drawn: next.drawn,
    // The longest window in the room, not a fixed thirty: a table where
    // everybody has said they are fluent gets fifteen-second rounds, which is
    // the game running at the speed the people in it actually play.
    deadline: roundDeadline(put, next.round, now),
  };
}

/**
 * Close the round on the table, pay everybody who earned something, and hold
 * the answer up.
 *
 * Seats that never acted are written in as `timeout` here rather than left
 * absent, so a settled round holds exactly one try per seat and nothing
 * downstream (the review, the stats, the end screen) has to tell "did not
 * answer" from "is not in this game".
 *
 * A round where nobody got it right is the one worth having: nobody at the
 * table knew the word, and it is about to be on the screen for six seconds
 * with its meaning under it.
 */
function settle(state: VocabState, round: VocabRound, now: number): VocabState {
  const tries = [...round.tries];
  for (let seat = 0; seat < state.scores.length; seat++) {
    if (tryOf(round, seat) !== null) continue;
    tries.push({
      seat,
      how: 'timeout',
      said: '',
      ms: windowMs(state, seat),
      points: 0,
      // A seat that bought a hint and then let its window close still spent
      // the hint, and the review should say so. It scaled nothing, a timeout
      // scoring zero either way, but "hinted and still did not get it" is the
      // most useful line this screen can print about a word.
      hinted: hintOf(round, seat) !== null,
    });
  }

  const scores = state.scores.slice();
  for (const attempt of tries) scores[attempt.seat] += attempt.points;

  return {
    ...state,
    phase: 'reveal',
    round: { ...round, tries },
    scores,
    deadline: now + REVEAL_MS,
  };
}

/**
 * How long a seat has taken, as of `now`, counted from the clue going up.
 *
 * Clamped at both ends against the seat's own window. `now` is the server's,
 * but a restored room or a missing clock can hand this arithmetic a number
 * from anywhere, and a round answered in minus four seconds would poison both
 * the mean it feeds and the speed bonus it is about to be scored on.
 */
function tookUntil(round: VocabRound, state: VocabState, seat: number, now: number): number {
  return Math.min(windowMs(state, seat), Math.max(0, now - round.began));
}

/**
 * File what a seat did, and close the round if that was the last of them.
 *
 * The single place a try is recorded, because three things have to happen
 * together and in this order: the try goes on the round, the round's deadline
 * is pulled in to whatever windows are still open, and the round settles if
 * none are. Doing the first without the second is the bug where a table of two
 * sits watching a dead clock for twenty seconds after both have answered.
 */
function recordTry(state: VocabState, round: VocabRound, attempt: VocabTry, now: number): VocabState {
  const after: VocabRound = { ...round, tries: [...round.tries, attempt] };
  if (everyoneDone(state, after)) return settle(state, after, now);
  return { ...state, round: after, deadline: roundDeadline(state, after, now) };
}

/** One seat's attempt at the clue, scored. */
function attemptOf(
  state: VocabState,
  round: VocabRound,
  seat: number,
  how: VocabHow,
  said: string,
  now: number,
): VocabTry {
  const ms = tookUntil(round, state, seat, now);
  const rank = round.answer?.rank ?? 0;
  const hinted = hintOf(round, seat) !== null;
  return {
    seat,
    how,
    said,
    ms,
    hinted,
    points: how === 'right' ? roundPoints(state, seat, rank, ms, round.ask, hinted) : 0,
  };
}

/** Deal the first clue, with the settings the host chose. */
function beginPlay(state: VocabState, lang: VocabLang, mode: VocabMode, now: number): VocabState {
  return advance({ ...state, lang, mode }, now);
}

function isLang(value: unknown): value is VocabLang {
  return typeof value === 'string' && (VOCAB_LANGS as readonly string[]).includes(value);
}

function isMode(value: unknown): value is VocabMode {
  return typeof value === 'string' && (VOCAB_MODES as readonly string[]).includes(value);
}

function isLevel(value: unknown): value is VocabLevel {
  return typeof value === 'string' && (VOCAB_LEVELS as readonly string[]).includes(value);
}

export const vocab: GameDefinition<VocabState, VocabMove> = {
  ...GAME_MANIFEST.vocab,

  setup(playerCount, rng): VocabState {
    return {
      phase: 'setup',
      // Null rather than a default, so the board can tell "has not chosen" from
      // "chose Polish" and say so on a screen up to eight people are reading.
      lang: null,
      mode: 'normal',
      scores: Array(playerCount).fill(0),
      // Everyone in the middle band, which subtracts out to no handicap at
      // all. See `holdMs`. A room that never touches this plays the game it
      // always did.
      levels: Array(playerCount).fill(DEFAULT_LEVEL),
      // Three each, for the whole game, and they do not come back. See
      // `HINT_ALLOWANCE`.
      hints: Array(playerCount).fill(HINT_ALLOWANCE),
      round: null,
      history: [],
      // Dealt here because here is where the rng is. See point 6 above.
      deck: deal(rng),
      drawn: 0,
      // Null until the room says every seat is filled. See `start`.
      deadline: null,
      winner: null,
    };
  },

  start(state, now) {
    if (state.phase !== 'setup' || state.deadline !== null) return null;
    return { ...state, deadline: now + SETUP_MS };
  },

  deadline(state) {
    return state.deadline;
  },

  applyMove(state, move, seat, _rng: Rng, now): MoveResult<VocabState> {
    const at = now ?? 0;
    if (!canAct(state, seat, now)) return { ok: false, error: 'Not your move.' };

    if (move.type === 'level') {
      // Every seat owns this one, which is why `canAct` opens setup to the
      // whole table rather than to the host. The move carries no seat: you may
      // only ever declare your own, so there is nothing here a player could
      // use to hold a rival.
      if (state.phase !== 'setup') {
        return { ok: false, error: 'Levels are set before the first clue.' };
      }
      if (!isLevel(move.level)) {
        return { ok: false, error: `${named(move.level)} is not one of the levels.` };
      }
      const levels = state.levels.slice();
      levels[seat] = move.level;
      return { ok: true, state: { ...state, levels } };
    }

    // The other two setup moves are the host's, and this is where that is
    // enforced now that the phase itself is open to everybody.
    if (move.type === 'settings' || move.type === 'begin') {
      if (seat !== HOST) {
        return { ok: false, error: 'Only the seat that opened the room chooses that.' };
      }
    }

    if (move.type === 'settings') {
      if (!isLang(move.lang)) {
        return { ok: false, error: `${named(move.lang)} is not one of the languages.` };
      }
      if (!isMode(move.mode)) {
        return { ok: false, error: `${named(move.mode)} is not one of the difficulties.` };
      }
      return { ok: true, state: { ...state, lang: move.lang, mode: move.mode } };
    }

    if (move.type === 'begin') {
      // The host check above and `canAct` have between them established this
      // is the right seat in the right phase; all that is left is whether they
      // have chosen. No default here, unlike `expire`: a host who is present
      // and pressing buttons should be told what is missing rather than handed
      // a language they did not pick.
      if (state.lang === null) return { ok: false, error: 'Choose a language first.' };
      return { ok: true, state: beginPlay(state, state.lang, state.mode, at) };
    }

    if (
      move.type !== 'guess' &&
      move.type !== 'pass' &&
      move.type !== 'choose' &&
      move.type !== 'hint'
    ) {
      return { ok: false, error: 'No such move.' };
    }

    const { lang, round } = state;
    const phrasing = isPhrases(state.mode);
    // Both are guaranteed by `canAct`, which only lets a guess through during
    // `asking`, unreachable without a language or a round. Checked anyway,
    // because the alternative is two non-null assertions holding up a rule that
    // lives in another file.
    if (lang === null || round === null) return { ok: false, error: 'No clue on the table.' };

    // Giving up is the one move that needs nothing from the dictionary: it
    // scores nothing, so there is no word to look up and no rank to price.
    if (move.type === 'pass') {
      return {
        ok: true,
        state: recordTry(state, round, attemptOf(state, round, seat, 'gave-up', '', at), at),
      };
    }

    // The only move that leaves the seat in the round. Deliberately not
    // `recordTry`: no try is filed, so nothing settles and the round's deadline
    // does not move. The player goes back to the same box with one letter and a
    // length more than they had, and half the points if it lands.
    if (move.type === 'hint') {
      if (!canHint(state, seat, now)) {
        // Three different refusals, because they are three different situations
        // and "no" on its own would read as the button being broken.
        if (round.ask !== 'say') {
          return { ok: false, error: 'The word is already on the screen.' };
        }
        if (hintOf(round, seat) !== null) {
          return { ok: false, error: 'You have already had your hint on this one.' };
        }
        return { ok: false, error: 'You have no hints left.' };
      }
      const hints = state.hints.slice();
      hints[seat] = hintsLeft(state, seat) - 1;
      return {
        ok: true,
        state: {
          ...state,
          hints,
          round: {
            ...round,
            hints: [...round.hints, { seat, shown: maskWord(round.answer?.word ?? '') }],
          },
        },
      };
    }

    if (move.type === 'choose') {
      if (round.ask !== 'pick') {
        return { ok: false, error: 'This one is typed, not chosen.' };
      }
      // An index, so the board never held the answer to send back. Validated
      // rather than trusted: `option` arrives off a socket and a float or a
      // negative would index into nothing and mark the seat wrong for it.
      if (
        !Number.isInteger(move.option) ||
        move.option < 0 ||
        move.option >= round.options.length
      ) {
        return { ok: false, error: 'That is not one of the meanings on offer.' };
      }
      const said = round.options[move.option];
      // The comparison the whole redaction exists to keep on this side: `clue`
      // is the correct option and it never left the server while the round was
      // running.
      const how: VocabHow = said === round.clue ? 'right' : 'wrong';
      return {
        ok: true,
        state: recordTry(state, round, attemptOf(state, round, seat, how, said, at), at),
      };
    }

    if (round.ask !== 'say') {
      return { ok: false, error: 'Choose one of the meanings instead.' };
    }

    const typed = move.word.trim();
    if (typed === '') return { ok: false, error: `Type ${phrasing ? 'the phrase' : 'a word'}.` };

    const question = vocabQuestion(lang, state.mode, round.answer?.rank ?? 0);
    if (question === null) return { ok: false, error: 'No clue on the table.' };

    // The two modes disagree about what a typed answer even is, and that is the
    // whole of the difference between them here.
    //
    // A **word** is looked up in the language's list first, and something the
    // list has never heard of is refused rather than marked wrong: it is far
    // more often a typo than a guess, and ending a round for a misspelling
    // would be the dictionary playing. See point 2 above.
    //
    // A **phrase** has no such list to be absent from. There is nothing that
    // could vouch for *zrobisz mi kawe* being Polish at all, so there is no
    // honest way to tell a typo from a wrong guess, and inventing one would
    // mean either refusing every near miss (unplayable) or refusing every
    // wrong answer (free guessing, the thing point 2 exists to stop). So a
    // phrase that is not one of the ways of saying this one is simply wrong,
    // and the generosity is spent where it can be spent honestly instead: the
    // accepted forms carry both Polish genders, the casual Japanese, the kana,
    // and punctuation and accents are folded away. See `keysOf`.
    if (phrasing) {
      const right = phraseKeys(typed, lang).some((key) => question.accepts.has(key));
      return {
        ok: true,
        state: recordTry(
          state,
          round,
          attemptOf(state, round, seat, right ? 'right' : 'wrong', typed, at),
          at,
        ),
      };
    }

    const entry = chainLookup(lang, typed);
    if (!entry) {
      return {
        ok: false,
        error: `${named(typed)} is not in the ${VOCAB_LANG_NAME[lang]} list.`,
      };
    }

    if (!question.accepts.has(entry.key)) {
      // A real word, and the wrong one: the round is over for this seat and
      // nobody else. What they typed is kept but not shown until the reveal
      // (see `view()`), because a wrong word broadcast mid-round hands everyone
      // still typing a free elimination.
      return {
        ok: true,
        state: recordTry(state, round, attemptOf(state, round, seat, 'wrong', typed, at), at),
      };
    }

    // Right, and the round carries on for everybody who has not finished. This
    // is the line the whole redesign turns on: it used to be a `settle`.
    return {
      ok: true,
      state: recordTry(
        state,
        round,
        attemptOf(state, round, seat, 'right', entry.word, at),
        at,
      ),
    };
  },

  /**
   * Drive the clock: start the game the host abandoned, close a round nobody
   * answered, and turn a reveal into the next clue.
   *
   * This game leans on `expire` harder than any other here. It is not only how
   * a round ends, it is how the next one *begins*, since the reveal has to
   * finish by itself with nobody pressing anything, so the game only keeps
   * moving because both adapters re-arm on `deadline()` after every tick. That
   * is already how they work, and `vocab.test.ts` walks a whole game through
   * nothing but `tick` to hold it.
   *
   * One transition per call, and every new deadline is measured from `now`
   * rather than from the one that was missed. The difference only shows up in a
   * room woken late, by an alarm that slipped or a dev server that was asleep,
   * and it is the difference between coming back to a fresh clue and coming
   * back to find the game has silently burned nine words nobody was there to
   * see. This is a game for learning vocabulary; spending it while the room is
   * empty is the one thing it must not do.
   *
   * Setup is the one phase where running out of time costs nobody anything: an
   * undecided host gets Polish on normal and the game deals, because a player
   * who wandered off before choosing should not strand seven other people on a
   * menu, and a room stuck forever is worse than a language somebody did not
   * pick.
   */
  expire(state, now) {
    if (state.deadline === null || now < state.deadline) return null;

    if (state.phase === 'setup') {
      return beginPlay(state, state.lang ?? 'pl', state.mode, now);
    }
    if (state.phase === 'asking') {
      // Everyone still un-acted has run out of window by now, the deadline
      // being the last one to close (see `roundDeadline`), and `settle` writes
      // them in as timeouts.
      return state.round === null ? finish(state) : settle(state, state.round, now);
    }
    if (state.phase === 'reveal') return advance(state, now);
    return null;
  },

  /**
   * A hint for the status line, and nothing more.
   *
   * There is no such thing as whose turn it is here: every seat still in a
   * round may act at once, which is what a race is. So this answers the nearest
   * useful question instead. During setup it names the host, genuinely the one
   * seat holding things up, and during play whoever is furthest behind, the
   * only seat the game could be said to be waiting on. `canAct` is the question
   * every control means.
   */
  turn(state) {
    if (state.phase === 'over') return null;
    if (state.phase === 'setup') return HOST;
    let trailing = 0;
    for (let seat = 1; seat < seatCount(state); seat++) {
      if (state.scores[seat] < state.scores[trailing]) trailing = seat;
    }
    return trailing;
  },

  canAct,

  isOver: isFinished,

  /**
   * The one thing the answer must never appear in.
   *
   * `status` is rendered above every board, including during `asking`, so a
   * clue's answer reaching this string would put it on the screen of everyone
   * racing for it. The round's *clue* is fine and is most of what makes the
   * line useful.
   */
  status(state, names) {
    const who = (seat: number): string => names[seat] ?? `Player ${seat + 1}`;

    if (state.phase === 'over') {
      if (state.winner === null) {
        const shared = leaders(state).map(who);
        return `Game over. ${shared.join(' and ')} tie.`;
      }
      return `${who(state.winner)} wins with ${state.scores[state.winner]}.`;
    }

    if (state.phase === 'setup') {
      if (state.lang === null) return `Waiting for ${who(HOST)} to choose a language.`;
      return `${VOCAB_LANG_NAME[state.lang]}, ${MODE_LABEL[state.mode]}. Waiting for ${who(HOST)} to start.`;
    }

    const language = state.lang === null ? '' : VOCAB_LANG_NAME[state.lang];

    if (state.phase === 'reveal') {
      const word = state.round?.answer?.word ?? '';
      const first = state.round === null ? null : firstRight(state.round);
      if (first === null) return `Nobody had it: ${word}.`;
      const also = state.round === null
        ? 0
        : state.round.tries.filter((a) => a.how === 'right').length - 1;
      // Who was first, and how many others got there too. The second half is
      // the whole difference from the game this replaced, where there was never
      // anybody else.
      return also === 0
        ? `${who(first.seat)} had it: ${word}.`
        : `${who(first.seat)} had it first, and so did ${also} more: ${word}.`;
    }

    // The word goes in the line here and nowhere else. On a recognition round
    // it *is* the question and is already printed on every board; it is the
    // clue that is the secret on this kind of round, which is why the branch
    // below cannot be reused for it.
    if (state.round?.ask === 'pick') {
      return `What does “${state.round.answer?.word ?? ''}” mean?`;
    }

    return isPhrases(state.mode)
      ? `Say “${state.round?.clue ?? ''}” in ${language}.`
      : `Say the ${language} for “${state.round?.clue ?? ''}”.`;
  },

  /**
   * Two secrets, and they expire at different times.
   *
   * The **deck** is every question the rest of this game will ask, in order.
   * It never goes to a client at all: the word lists are downloadable by
   * anybody, so a deck in devtools is a game already won. Emptied rather than
   * dropped, so the field's type does not change shape on the wire.
   *
   * The **answer** is a secret only while the round is running, and stops
   * being one the moment the round settles, the reveal being the whole point of
   * the game and the history what the review screen reads. So it is stripped in
   * exactly one phase.
   *
   * The **tries** on a running round are the third, and they are half a
   * secret rather than a whole one. Who has finished and how it went for them
   * is public, most of what the tension is made of, and a player watching two
   * opponents fall out is being told something true about how hard the word is
   * rather than something about the word. But `said` on a right answer *is* the
   * answer, and `points` is a function of the rank, so a live one would narrow
   * the frequency band for everybody still typing. Both are blanked until the
   * round settles; `seat`, `how` and `ms` go out whole.
   *
   * The **hints** are the fourth, and the first thing here that is redacted per
   * seat rather than per phase. That a seat has taken one is public, the same
   * category as `how`; what it said is not, or one player's three hints would be
   * the whole table's. This is the only reason this `view` reads its `seat`
   * argument at all.
   *
   * Not redacted at all: everyone's score, and everyone's remaining allowance.
   * The first only moves when a round settles, by which time all of this is
   * public anyway; the second is a thing opponents are meant to be able to read.
   *
   * And the whole of it turns round on a `pick` round. There the clue is the
   * correct option, so the clue is what has to go and the word is what has to
   * stay, the exact opposite of every sentence above. Getting that backwards
   * would either put the answer on eight screens or ask a question with nothing
   * in it, so it is one branch rather than a condition threaded through five.
   */
  view(state, seat) {
    if (state.phase !== 'asking' || state.round === null) {
      return { ...state, deck: [] };
    }
    const round = state.round;
    const pick = round.ask === 'pick';
    return {
      ...state,
      deck: [],
      round: {
        ...round,
        clue: pick ? '' : round.clue,
        // On a recognition round the word and its script are the question. The
        // lemma and the rank are not, and they are the two things the reveal
        // has left to tell anybody, so they wait for it.
        answer: pick && round.answer !== null ? { ...round.answer, lemma: '', rank: 0 } : null,
        tries: round.tries.map((attempt) => ({ ...attempt, said: '', points: 0 })),
        hints: round.hints.map((hint) =>
          hint.seat === seat ? hint : { ...hint, shown: '' },
        ),
      },
    };
  },

  /**
   * What the clues taught the table.
   *
   * This game already grades its own questions along the two axes a scheduler
   * needs, and it does so for reasons of its own that have nothing to do with
   * the ledger: `PICK_SCALE` halves a recognition round because choosing one
   * meaning out of four is a one-in-four guess at worst, and `HINT_SCALE`
   * halves a hinted answer because the choice has to cost something. Both
   * distinctions cost the reducer real complexity. The only thing this method
   * has to get right is not throwing them away.
   *
   * So the mapping is the one the game already argues for:
   *
   * - **typed it, unhinted** is production, the thing the game exists to
   *   teach, and it climbs. `produced-fast` against *that seat's own window* —
   *   fifteen seconds for somebody fluent, thirty for a beginner — because a
   *   fixed threshold would report the level a player declared rather than
   *   whether the word was there.
   * - **typed it, hinted** climbs too, and this is the row worth defending.
   *   `HINT_ALLOWANCE` makes the argument outright: first letter plus length
   *   resolves a word already on the tip of the tongue, so the player did the
   *   retrieval themselves and arrived, which is what makes a word stick. A
   *   hint is not a reveal. It just does not climb as far — see
   *   `HINTED_CEILING`.
   * - **picked it out of four** holds its rung. Enough to keep a word where it
   *   is, not enough to carry it onto a ninety-day interval.
   * - **wrong** and **gave up** go back down, and stay apart, because
   *   `VocabHow` went to the trouble of keeping them apart: a player who
   *   guessed had the wrong word in their head, a player who passed had none
   *   and knew it.
   * - **timed out** produces *nothing at all*. Not a miss, not a sighting, no
   *   row. It is the seat that sat there — a phone that locked, somebody who
   *   put the game down — and grading it as failure would let one distracted
   *   evening bury a hundred words they actually know. It is the absence of an
   *   answer, not a bad one.
   *
   * Reads `history` plus the round still on the table, because a game that
   * ends on the target does so in `advance`, which has already filed the round
   * it settled — but a game that ends any other way may still be holding one,
   * and the last word of a game is not the one to drop.
   */
  record(state, seats) {
    const rounds = [...state.history, ...(state.round === null ? [] : [state.round])];
    const outcomes: SeatOutcome[] = [];

    for (let seat = 0; seat < seats; seat++) {
      const learned: Learned[] = [];

      for (const round of rounds) {
        const answer = round.answer;
        // A round still running on a client has no answer, and a round drawn
        // from a language that was never chosen has no word. Neither can reach
        // here on the server, and both would file a row with no word in it.
        if (answer === null || state.lang === null) continue;
        const attempt = round.tries.find((t) => t.seat === seat);
        if (attempt === undefined || attempt.how === 'timeout') continue;

        learned.push({
          lang: state.lang,
          // The folded lemma, for the same reason Word Chain uses one: the row
          // is a verb, not six of its inflections. Folded here because `fold`
          // lives with the word lists and the ledger may never reach them.
          key: fold(answer.lemma || answer.word),
          word: answer.word,
          script: answer.script,
          lemma: answer.lemma,
          // The clue is the English meaning, which is exactly what a gloss is.
          // On a `pick` round it is still the correct option, so it is still
          // the right string; the redaction that hides it is a `view()`
          // concern and the server is never looking at a redacted state.
          gloss: round.clue,
          rank: answer.rank,
          grade: gradeOf(attempt, round.ask, windowMs(state, seat)),
          ms: attempt.ms,
        });
      }

      outcomes.push({
        seat,
        result:
          state.winner === null ? 'drew' : state.winner === seat ? 'won' : 'lost',
        learned,
      });
    }

    return { gameId: vocab.id, seats: outcomes };
  },
};

/**
 * One try, as a grade. See `record` for the argument behind each row.
 *
 * `timeout` never reaches here: `record` drops it before asking, because the
 * answer would have to be "nothing" and a grade that means "do not grade this"
 * is a grade every caller has to remember to check for.
 */
function gradeOf(attempt: VocabTry, ask: VocabAsk, window: number): Grade {
  if (attempt.how === 'wrong') return 'wrong';
  if (attempt.how === 'gave-up') return 'gave-up';
  if (ask === 'pick') return 'recognised';
  if (attempt.hinted) return 'hinted';
  return wasFast(attempt.ms, window) ? 'produced-fast' : 'produced';
}
