/**
 * Dealing a round, drawing a clue, taking an answer and settling the round.
 *
 * Everything the reducer in `vocab.ts` does between moves, and nothing that
 * decides *whether* a move is allowed -- that is `canAct` in `vocabDisplay.ts`
 * and the move handlers themselves. Split out because the definition object had
 * four hundred lines of scaffolding in front of it and the file could not be
 * read from the top.
 *
 * Same rule as `vocab.ts`: this reaches the dictionary and therefore the word
 * lists, so **nothing on the client may import it**. `bundle.test.ts` builds
 * the real bundle and fails over exactly that, however the import is reached.
 * The board's half is `vocabDisplay.ts`.
 *
 * Every function here is pure: state in, state out, and any randomness arrives
 * as an `Rng`.
 */
import type { Rng } from '../types.js';
import type { StudyLists } from '../profile.js';
import { vocabOptions, vocabQuestion, vocabRanksFor } from './vocabDictionary.js';
import type { VocabQuestion } from './vocabDictionary.js';
import {
  DECK_DEPTH,
  FREE_HINT_MS,
  MODE_CAP,
  REVEAL_MS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LEVELS,
  VOCAB_MODES,
  RETRY_AFTER,
  askFor,
  askIn,
  autoHinted,
  choosing,
  everyoneDone,
  hintOf,
  leaders,
  levelOf,
  maskWord,
  retryAsks,
  roundDeadline,
  roundPoints,
  tryOf,
  windowMs,
} from './vocabDisplay.js';

import type {
  VocabAsk,
  VocabHint,
  VocabRetry,
  VocabHow,
  VocabLang,
  VocabLevel,
  VocabMode,
  VocabRound,
  VocabState,
  VocabTry,
} from './vocabDisplay.js';

export const seatCount = (state: VocabState): number => state.scores.length;

/**
 * Everybody's due words, merged into one list per language.
 *
 * A union rather than a per-seat list, and that is the whole shape of how this
 * game differs from Word Chain: a chain asks one player for one word, so a
 * reveal can be theirs alone, while a race asks the whole table the same
 * question and a clue chosen for one seat would be a clue nobody else was
 * racing on.
 *
 * Deduplicated, because two people learning Polish will be due many of the same
 * words and a rank appearing twice would do nothing but make the list longer.
 */
export function union(study: readonly StudyLists[] | undefined): StudyLists {
  const out: StudyLists = {};
  for (const seat of study ?? []) {
    for (const lang of VOCAB_LANGS) {
      const keys = seat?.[lang];
      if (!keys || keys.length === 0) continue;
      out[lang] = [...new Set([...(out[lang] ?? []), ...keys])];
    }
  }
  return out;
}

/** A shuffled run of the ranks a game may ask about. See point 6 above. */
export function deal(rng: Rng): number[] {
  const deck = Array.from({ length: DECK_DEPTH }, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function roundFrom(
  question: VocabQuestion,
  now: number,
  asks: VocabAsk[],
  options: string[],
  retry = false,
): VocabRound {
  return {
    clue: question.clue,
    asks,
    options,
    hints: [],
    answer: {
      word: question.word,
      script: question.script,
      lemma: question.lemma,
      rank: question.rank,
      also: [...question.also],
    },
    began: now,
    tries: [],
    retry,
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
 * Which way round the clue is asked is decided here too, once per seat, and it
 * is a function of that seat's level and how many rounds have already been
 * filed and nothing else, because there is no rng at this point in the game and
 * there must not be, see point 6 above.
 *
 * The options are drawn once and shared by everybody who is picking, because
 * the clue is shared: four meanings drawn twice would be two different
 * questions about one word, and the redaction in `view()` would have to keep
 * both straight. A seat assigned a `pick` on a round where none could be built
 * falls back to a `say` -- `vocabOptions` returns nothing when it cannot find
 * three meanings that are not synonyms of the answer, and asking the word the
 * other way round is a better answer to that than a question with two options
 * in it. That fallback is all-or-nothing by construction: with no options,
 * nobody picks.
 */
export function draw(
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
    const index = state.history.length;
    const wanted = state.scores.map((_, seat) => askFor(levelOf(state, seat), index));
    const options = wanted.some(choosing)
      ? vocabOptions(lang, mode, rank, cap, state.deck)
      : [];
    const asks: VocabAsk[] =
      options.length === 0 ? wanted.map(() => 'say') : wanted;
    return { round: roundFrom(question, now, asks, options), drawn: i + 1 };
  }
  return null;
}

/**
 * The clue owed a second showing, if one is due.
 *
 * Shaped exactly like `draw`'s return so `advance` can take either without
 * caring which it got, and `drawn` is passed straight back untouched: a retry
 * is not a card off the deck, so reading one must not move the deck on. That is
 * the whole reason the two are separate functions rather than one with a flag.
 *
 * Due is `history.length`, not a clock. The retry has to land the same number
 * of *rounds* later however long they took, and a room paused for an hour
 * between two of them should not come back to find the retry expired. It is
 * also the only counter here a tick cannot move on its own, which keeps this
 * decidable without an rng along with everything else. See point 6.
 *
 * Null when nothing is due, or when the rank has no question any more. When the
 * options cannot be built it falls back to `say` for everybody rather than to
 * no retry at all: asking the hard version of a word you missed beats not
 * asking it.
 */
export function redue(
  state: VocabState,
  lang: VocabLang,
  mode: VocabMode,
  now: number,
): { round: VocabRound; drawn: number } | null {
  const due = state.retry.find((item) => state.history.length >= item.at);
  if (due === undefined) return null;

  const question = vocabQuestion(lang, mode, due.rank);
  if (question === null) return null;

  const wanted = state.scores.map((_, seat) => retryAsks(levelOf(state, seat)));
  const options = wanted.some(choosing)
    ? vocabOptions(lang, mode, due.rank, MODE_CAP[mode], state.deck)
    : [];
  const asks: VocabAsk[] = options.length === 0 ? wanted.map(() => 'say') : wanted;
  return { round: roundFrom(question, now, asks, options, true), drawn: state.drawn };
}

/**
 * Settle the game, naming a winner only where there is one.
 *
 * A shared lead leaves `winner` null, the honest answer and the one the copy
 * is written for. It can only happen when a game runs out of deck, since
 * reaching `TARGET` is reaching it first and one round hands out one point, so
 * it is rare and not worth inventing a tie-break for.
 */
export function finish(state: VocabState): VocabState {
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
export function advance(state: VocabState, now: number): VocabState {
  const put: VocabState = state.round === null
    ? state
    : { ...state, history: [...state.history, state.round], round: null };

  if (put.lang === null) return finish(put);
  if (put.scores.some((score) => score >= TARGET)) return finish(put);

  // A word the table missed comes before a word it has not met. Checked ahead
  // of the deck rather than spliced into it, because the deck is filtered by
  // `draw` against every clue already asked, and a retry is by definition one
  // of those: putting it in the deck would mean teaching that filter about an
  // exception, and a filter with an exception in it is how the answer gets
  // broadcast twice. See `RETRY_AFTER`.
  const again = redue(put, put.lang, put.mode, now);
  const next = again ?? draw(put, put.lang, put.mode, now);
  if (next === null) return finish(put);

  return {
    ...put,
    phase: 'asking',
    round: next.round,
    drawn: next.drawn,
    retry: again === null ? put.retry : put.retry.filter((due) => due.rank !== again.round.answer?.rank),
    // The longest window in the room, not a fixed thirty: a table where
    // everybody has said they are fluent gets fifteen-second rounds, which is
    // the game running at the speed the people in it actually play.
    deadline: roundDeadline(put, next.round, now),
  };
}

/**
 * The retry queue after a round settles: unchanged, or one longer.
 *
 * A clue joins it when **nobody** got it, and the test is deliberately every
 * seat rather than a majority or the seat that is behind. One person at the
 * table knowing the word means the word got said, got revealed next to its
 * meaning, and got beaten by somebody in the room, which is the version of
 * learning this game is built around (point 5). The round worth asking again is
 * the one where the whole table drew a blank.
 *
 * A timeout counts as missing it, and that is a judgement call worth writing
 * down. `record` refuses to grade a timeout at all, on the grounds that a
 * locked phone is not a wrong answer; here the question is different and much
 * cheaper to get wrong in the generous direction. Nobody typed the word, so
 * nobody demonstrated they had it, and the cost of asking again is one round
 * out of a game that has plenty. It also keeps the rule readable on the board:
 * the reveal said nobody had it, and the clue comes back.
 *
 * Never twice. See `RETRY_AFTER` for why a table stuck on one word should not
 * be asked it forever.
 */
export function requeue(
  state: VocabState,
  round: VocabRound,
  tries: readonly VocabTry[],
): VocabRetry[] {
  if (round.retry) return state.retry;
  const rank = round.answer?.rank ?? 0;
  if (rank === 0) return state.retry;
  if (tries.some((attempt) => attempt.how === 'right')) return state.retry;
  // Filed against the round that is about to join `history`, hence the plus
  // one: `settle` has not put it away yet, `advance` will.
  return [...state.retry, { rank, at: state.history.length + 1 + RETRY_AFTER }];
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
export function settle(state: VocabState, round: VocabRound, now: number): VocabState {
  const tries = [...round.tries];
  for (let seat = 0; seat < state.scores.length; seat++) {
    if (tryOf(round, seat) !== null) continue;
    tries.push({
      seat,
      how: 'timeout',
      said: '',
      ask: askIn(round, seat),
      ms: windowMs(state, seat),
      points: 0,
      // A seat that bought a hint and then let its window close still spent
      // the hint, and the review should say so. It scaled nothing, a timeout
      // scoring zero either way, but "hinted and still did not get it" is the
      // most useful line this screen can print about a word.
      hinted: boughtHint(round, seat),
    });
  }

  const scores = state.scores.slice();
  for (const attempt of tries) scores[attempt.seat] += attempt.points;

  return {
    ...state,
    phase: 'reveal',
    round: { ...round, tries },
    scores,
    retry: requeue(state, round, tries),
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
export function tookUntil(round: VocabRound, state: VocabState, seat: number, now: number): number {
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
export function recordTry(state: VocabState, round: VocabRound, attempt: VocabTry, now: number): VocabState {
  const after: VocabRound = { ...round, tries: [...round.tries, attempt] };
  if (everyoneDone(state, after)) return settle(state, after, now);
  return { ...state, round: after, deadline: roundDeadline(state, after, now) };
}

/** One seat's attempt at the clue, scored. */
export function attemptOf(
  state: VocabState,
  round: VocabRound,
  seat: number,
  how: VocabHow,
  said: string,
  now: number,
): VocabTry {
  const ms = tookUntil(round, state, seat, now);
  const rank = round.answer?.rank ?? 0;
  const ask = askIn(round, seat);
  const hinted = boughtHint(round, seat);
  return {
    seat,
    how,
    said,
    ask,
    ms,
    hinted,
    points: how === 'right' ? roundPoints(state, seat, rank, ms, ask, hinted) : 0,
  };
}

/**
 * Whether `seat` has a hint it *paid* for on this round.
 *
 * The distinction the whole free hint turns on, and the reason this is a
 * function rather than `hintOf(...) !== null` written out five times. A
 * beginner's hint arrives on the round like any other so the board can draw it
 * and a reconnecting seat gets it back, but it spent no allowance and it must
 * not halve the points (see `FREE_HINT_MS`). Everything that prices or reports
 * a hint asks this; only the board, which is drawing it, asks `hintOf`.
 */
export function boughtHint(round: VocabRound, seat: number): boolean {
  const hint = hintOf(round, seat);
  return hint !== null && !hint.free;
}

/** Deal the first clue, with the settings the host chose. */
/**
 * Put the words this table owes a review to the front of the deck.
 *
 * The loop closing: the ledger decides what the game asks next, so a round of
 * Vocab Race stops being a random walk through a frequency list and becomes
 * the review somebody was due. Everything after this is unchanged — the same
 * draw, the same clue, the same scoring.
 *
 * **Here rather than in `setup`, because the deck is dealt before the language
 * is known.** Point 6 shuffles ranks 1..1000 at setup so that every later draw
 * needs no randomness; but rank 42 is a different word in Polish and in
 * Japanese, so a deck front-loaded for one is meaningless for the other. The
 * host choosing settles it, and this runs once, there.
 *
 * **A stable partition, not a sort, and it uses no rng at all.** The deck is
 * already shuffled; this only moves a subset forward, keeping the shuffled
 * order inside each half. So the game stays exactly as decidable-without-
 * randomness as it was, and two people who are due nothing get the deck they
 * would have got anyway.
 *
 * **The union across seats, never per seat.** This is a race: the clue has to
 * be identical for everybody or it is not one. A room of a learner and a
 * native speaker therefore draws the learner's due words, which is the right
 * answer anyway, since those are the words that room exists to practise.
 */
export function studied(state: VocabState, lang: VocabLang): number[] {
  const keys = state.study[lang] ?? [];
  if (keys.length === 0) return state.deck;
  const due = vocabRanksFor(lang, keys);
  if (due.size === 0) return state.deck;
  return [...state.deck.filter((rank) => due.has(rank)), ...state.deck.filter((rank) => !due.has(rank))];
}

export function beginPlay(state: VocabState, lang: VocabLang, mode: VocabMode, now: number): VocabState {
  return advance({ ...state, lang, mode, deck: studied(state, lang) }, now);
}

export function isLang(value: unknown): value is VocabLang {
  return typeof value === 'string' && (VOCAB_LANGS as readonly string[]).includes(value);
}

export function isMode(value: unknown): value is VocabMode {
  return typeof value === 'string' && (VOCAB_MODES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is VocabLevel {
  return typeof value === 'string' && (VOCAB_LEVELS as readonly string[]).includes(value);
}

/**
 * The hint a beginner is owed on a round they have to type, as a list of none
 * or one so it can be spread into `hints`.
 *
 * None for anybody who is picking (there is nothing to hint at), anybody who
 * already has a hint, and any seat that did not say it was just starting.
 * None either for a seat with no round to look at, which is a client asking
 * about somebody else's view. See `FREE_HINT_MS` for why it goes out with a
 * time on it rather than being held back until that time.
 */
export function freeHint(state: VocabState, round: VocabRound, seat: number): VocabHint[] {
  if (!autoHinted(state, seat)) return [];
  if (askIn(round, seat) !== 'say') return [];
  if (hintOf(round, seat) !== null) return [];
  const word = round.answer?.word ?? '';
  if (word === '') return [];
  return [{ seat, at: round.began + FREE_HINT_MS, free: true, shown: maskWord(word) }];
}
