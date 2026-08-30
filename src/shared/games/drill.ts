import type { GameDefinition, MoveResult, Rng } from '../types.js';
import type { Learned, SeatOutcome } from '../harvest.js';
import type { Grade } from '../review.js';
import { wasFast } from '../review.js';
import type { StudyLists } from '../profile.js';
import { GAME_MANIFEST } from './manifest.js';
import { named } from '../refusal.js';
import { chainLookup, fold } from './chainDictionary.js';
import { vocabQuestion, vocabRanksFor } from './vocabDictionary.js';
import {
  CARD_MS,
  DRILL_CARDS,
  DRILL_LANGS,
  REVEAL_MS,
  SETUP_MS,
  canAct,
  isFinished,
  outOfTime,
  tally,
} from './drillDisplay.js';
import type { DrillCard, DrillHow, DrillLang, DrillMove, DrillState } from './drillDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, while only this file ever reaches the word lists.
export {
  CARD_MS,
  DRILL_CARDS,
  DRILL_LANGS,
  DRILL_LANG_NAME,
  REVEAL_MS,
  SETUP_MS,
  canAct,
  clockCall,
  formatClock,
  isFinished,
  msLeftFor,
  outOfTime,
  progress,
  tally,
} from './drillDisplay.js';
export type {
  DrillCard,
  DrillHow,
  DrillLang,
  DrillMove,
  DrillPhase,
  DrillState,
  DrillTally,
} from './drillDisplay.js';

/**
 * Practice, alone, against the words you owe a review on.
 *
 * The one game here that is not a game. Everything else on the shelf needs
 * somebody else; this needs a Tuesday evening and a phone. It exists because a
 * spaced-repetition ledger that can only be fed by getting a friend online is
 * a ledger that goes stale, and the whole account system is worth exactly as
 * much as the reviews that actually happen.
 *
 * Five things are worth knowing before changing anything:
 *
 * 1. **It seats one, and that is the only genuinely new thing about it.**
 *    `RoomEngine` already allowed it: `canStart` is `short() === 0`, `canSeat`
 *    and `clampSeats` both handle a minimum of one, and `start` requires seat
 *    zero, which a solo player is. So this gets the room, the socket, the
 *    reconnection, the timed-game machinery, the Android build and the whole
 *    test harness without any of them being told about it. It is a little odd
 *    that a private review opens a Durable Object and mints a four-letter room
 *    code, and that oddity is the price of not building a second way to run a
 *    game. The code is harmless: nobody is given it.
 *
 * 2. **The queue is reviews first, then filler.** `study` arrives from the
 *    player's own profile (see `GameDefinition.setup`), is turned into ranks by
 *    `vocabRanksFor`, and those go to the front. Behind them, the top of the
 *    frequency list, so that a brand-new account with nothing due still gets a
 *    full session rather than an empty one — which is the case *every* account
 *    is in on the day it is made, and the worst possible first impression.
 *
 * 3. **It is dealt once, at setup, before the language is known**, exactly as
 *    Vocab Race's deck is and for the same reason: `setup` and `applyMove` are
 *    the only places this game is handed an rng, and the card-to-card
 *    progression runs through `expire`, which is not. Unlike Vocab Race there
 *    is nothing to shuffle — a review queue in due-date order is the order it
 *    should be asked in — so `setup` takes no rng at all and the language is
 *    settled before any of it matters. See `queueFor`.
 *
 * 4. **A wrong answer is not a failure state.** It settles the card, shows the
 *    word, and moves on. There is no score, no streak inside the session and
 *    nothing to lose: the ledger is what is keeping count, and it counts a
 *    miss as a word to ask again tomorrow rather than as a mark against
 *    anybody. `tally` is for the end screen and nothing reads it.
 *
 * 5. **An abandoned session still files what it got.** `record` walks `done`,
 *    which is every card already settled, so quitting after four cards banks
 *    four reviews. That is the opposite of how a game usually treats a
 *    forfeit, and it is right here for the same reason the whole thing is
 *    short: the alternative is a person who reviewed four words being told
 *    they reviewed none.
 */

const SEATS = 1;

/**
 * The queue: everything due, then the commonest words to fill the rest.
 *
 * Deduplicated across the two halves, because the filler is drawn from the top
 * of the same list the review words came from and a word both due and common
 * would otherwise be asked twice in one session — which reads as the game
 * having lost track rather than as emphasis.
 *
 * The filler is the front of the frequency list rather than a random sample of
 * it, and that is deliberate: somebody with nothing due is somebody new, and
 * the hundred commonest words in a language are exactly where a learner should
 * be starting. It is also stable, so two sessions in a row do not ask the same
 * twelve words: `drawn` is not reset, but a *new* session takes the same front
 * of the list. The rng that solves that is handed to `applyMove`, which is
 * where the language is chosen and therefore where the queue is built.
 */
function queueFor(lang: DrillLang, study: StudyLists, rng: Rng): number[] {
  const due = [...vocabRanksFor(lang, study[lang] ?? [])].sort((a, b) => a - b);
  const seen = new Set(due);

  // Enough to survive the roughly one word in fifteen whose gloss has nothing
  // printable left in it, which `draw` deals past.
  const want = DRILL_CARDS * 3;
  const filler: number[] = [];
  // A window rather than the first N, so two sessions on the same empty
  // profile are not the same twelve words. Bounded well inside the top
  // thousand, which is the pool `vocabQuestion` has anything to say about.
  const from = 1 + Math.floor(rng() * 200);
  for (let rank = from; filler.length < want && rank <= 1000; rank++) {
    if (!seen.has(rank)) filler.push(rank);
  }

  return [...due, ...filler];
}

function cardFrom(
  lang: DrillLang,
  rank: number,
  review: boolean,
  now: number,
): DrillCard | null {
  // 'hard' is the widest pool: the top thousand rather than the top hundred.
  // A review queue is not a difficulty setting and must be able to ask about
  // any word the ledger holds.
  const question = vocabQuestion(lang, 'hard', rank);
  if (question === null) return null;
  return {
    clue: question.clue,
    word: question.word,
    script: question.script,
    lemma: question.lemma,
    rank: question.rank,
    review,
    how: null,
    said: '',
    ms: 0,
    began: now,
  };
}

/**
 * The next card, reading forward from `drawn`.
 *
 * Null means the session is out of cards, which ends it. Two things disqualify
 * a rank and neither is an error: the word there may have no printable gloss
 * (about one in fifteen), or its clue may be one this session has already
 * asked. The second matters more here than in Vocab Race, because a review
 * queue is drawn from one person's own vocabulary and Polish files a lemma and
 * its inflections separately with the same gloss on both.
 */
function draw(state: DrillState, lang: DrillLang, now: number): { card: DrillCard; drawn: number } | null {
  if (state.done.length >= DRILL_CARDS) return null;
  const asked = new Set(state.done.map((card) => card.clue));
  const dueCount = new Set(vocabRanksFor(lang, state.study[lang] ?? [])).size;

  for (let i = state.drawn; i < state.queue.length; i++) {
    const rank = state.queue[i];
    const card = cardFrom(lang, rank, i < dueCount, now);
    if (card === null || asked.has(card.clue)) continue;
    return { card, drawn: i + 1 };
  }
  return null;
}

/** Put the card away and deal the next, or end the session. */
function advance(state: DrillState, now: number): DrillState {
  const put: DrillState =
    state.card === null ? state : { ...state, done: [...state.done, state.card], card: null };

  if (put.lang === null) return { ...put, phase: 'over', deadline: null };
  const next = draw(put, put.lang, now);
  if (next === null) return { ...put, phase: 'over', deadline: null };

  return { ...put, phase: 'asking', card: next.card, drawn: next.drawn, deadline: now + CARD_MS };
}

/** Settle the card on the table and hold the answer up. */
function settle(state: DrillState, how: DrillHow, said: string, now: number): DrillState {
  if (state.card === null) return state;
  return {
    ...state,
    phase: 'reveal',
    card: { ...state.card, how, said, ms: Math.max(0, now - state.card.began) },
    deadline: now + REVEAL_MS,
  };
}

/** Whether what was typed means what the clue asked for. */
function isRight(lang: DrillLang, card: DrillCard, typed: string): boolean {
  const question = vocabQuestion(lang, 'hard', card.rank);
  if (question === null) return false;
  const entry = chainLookup(lang, typed);
  return entry !== null && question.accepts.has(entry.key);
}

function begin(state: DrillState, lang: DrillLang, rng: Rng, now: number): DrillState {
  return advance({ ...state, lang, queue: queueFor(lang, state.study, rng) }, now);
}

/** Whichever language this player owes the most reviews on. See `expire`. */
function busiest(study: StudyLists): DrillLang {
  let best: DrillLang = 'pl';
  let most = -1;
  for (const lang of DRILL_LANGS) {
    const n = study[lang]?.length ?? 0;
    if (n > most) {
      most = n;
      best = lang;
    }
  }
  return best;
}

function isLang(value: unknown): value is DrillLang {
  return DRILL_LANGS.includes(value as DrillLang);
}

export const drill: GameDefinition<DrillState, DrillMove> = {
  ...GAME_MANIFEST.drill,

  setup(_playerCount, _rng, _now, study): DrillState {
    return {
      phase: 'setup',
      // Null rather than a default, so the menu can tell "has not chosen" from
      // "chose Polish".
      lang: null,
      // Dealt once the language is known, which is the first move. See point 3.
      queue: [],
      drawn: 0,
      card: null,
      done: [],
      // Null until the room says it is filled, which for one seat is at once.
      deadline: null,
      study: { ...study?.[0] },
    };
  },

  start(state, now) {
    if (state.phase !== 'setup' || state.deadline !== null) return null;
    return { ...state, deadline: now + SETUP_MS };
  },

  deadline(state) {
    return state.deadline;
  },

  applyMove(state, move, seat, rng: Rng, now = Date.now()): MoveResult<DrillState> {
    if (seat !== 0) return { ok: false, error: 'Not your session.' };
    if (state.phase === 'over') return { ok: false, error: 'This session is over.' };

    if (move?.type === 'lang') {
      if (state.phase !== 'setup') return { ok: false, error: 'Already under way.' };
      if (!isLang(move.lang)) {
        return { ok: false, error: `There is no language called ${named(move.lang)}.` };
      }
      return { ok: true, state: begin(state, move.lang, rng, now) };
    }

    if (state.phase !== 'asking' || state.card === null || state.lang === null) {
      return { ok: false, error: 'Nothing to answer yet.' };
    }
    // The clock decides, not the scheduler: a move arriving after the whistle
    // meets a card that is already gone rather than one still open because no
    // timer happened to have fired.
    if (outOfTime(state, now)) return { ok: false, error: 'That card has gone.' };

    if (move.type === 'pass') {
      return { ok: true, state: settle(state, 'gave-up', '', now) };
    }

    if (move.type === 'say') {
      const typed = String(move.word ?? '').trim();
      if (!typed) return { ok: false, error: 'Type the word.' };
      const right = isRight(state.lang, state.card, typed);
      return { ok: true, state: settle(state, right ? 'right' : 'wrong', typed, now) };
    }

    return { ok: false, error: 'That is not a move in this game.' };
  },

  /**
   * The clock, which is what drives this game forward.
   *
   * Three things end on it and they are checked in order: the setup menu picks
   * a language rather than ending the session (nobody should lose a review to
   * a menu), an open card times out, and a reveal rolls into the next card.
   * The last is not a timeout at all — it is the ordinary way this game
   * advances, and it runs through here because `expire` is the only hook that
   * fires without anybody pressing anything.
   */
  expire(state, now) {
    if (state.phase === 'over') return null;
    if (!outOfTime(state, now)) return null;

    if (state.phase === 'setup') {
      // Whichever language they owe the most on, which is the choice they were
      // most likely about to make. A session starting is better than a room
      // held open on a menu forever.
      return begin(state, busiest(state.study), Math.random, now);
    }
    // Settled, *not* advanced. A card nobody answered still gets its reveal,
    // and it is the reveal that matters most: a word you could not produce at
    // all is the one you are most likely to remember being shown. Settling
    // arms the reveal clock, so the next tick is what moves on.
    if (state.phase === 'asking') return settle(state, 'timeout', '', now);
    return advance(state, now);
  },

  turn(state) {
    return state.phase === 'over' ? null : 0;
  },

  canAct,

  isOver: isFinished,

  // Played alone, so there is nobody to beat. Null is the honest answer and
  // the end screen falls back to the tally, which is what a drill is for.
  winner() {
    return null;
  },

  status(state) {
    if (state.phase === 'over') {
      const counted = tally(state);
      if (state.done.length === 0) return 'Nothing reviewed.';
      return `${counted.right} of ${state.done.length} right.`;
    }
    if (state.phase === 'setup') return 'Pick a language.';
    const n = state.done.length + 1;
    return state.phase === 'reveal'
      ? `Card ${n}: ${state.card?.how === 'right' ? 'right' : 'the answer'}.`
      : `Card ${n} of ${DRILL_CARDS}.`;
  },

  /**
   * The answer is a secret while the card is open, and nothing else here is.
   *
   * The **queue** is the rest of the session in order and never goes to a
   * client at all; the **study list** is what put it in that order and is this
   * player's own vocabulary; and the **card**, during `asking`, is stripped to
   * its clue. Settled cards keep everything, because the reveal is the point
   * and the end screen reads them.
   */
  view(state) {
    const bare = { ...state, queue: [], study: {} };
    if (state.phase !== 'asking' || state.card === null) return bare;
    return {
      ...bare,
      card: { ...state.card, word: '', script: '', lemma: '', rank: 0 },
    };
  },

  /**
   * What the session taught, one entry per settled card.
   *
   * Walks `done` rather than requiring the session to have finished, so a
   * player who quits after four cards banks four reviews. See point 5.
   *
   * The grades are the ones `vocab.ts` uses and for the same reasons, minus
   * the two this game does not have: there are no recognition cards and no
   * hints here, so every right answer is production. `timeout` produces
   * nothing at all — it is the card nobody was in front of, and grading it as
   * a failure would let one abandoned session bury a dozen words somebody
   * knows.
   */
  record(state) {
    const learned: Learned[] = [];
    if (state.lang !== null) {
      // `done` plus the card on the table, when that card has been answered.
      // A settled card does not move into `done` until the reveal is over, so
      // walking `done` alone loses the last answer of every session that ends
      // during one — which is most of them, since the reveal is exactly where
      // somebody who has finished is looking when they close the tab.
      const cards =
        state.card !== null && state.card.how !== null ? [...state.done, state.card] : state.done;
      for (const card of cards) {
        if (card.how === null || card.how === 'timeout') continue;
        learned.push({
          lang: state.lang,
          key: fold(card.lemma || card.word),
          word: card.word,
          script: card.script,
          lemma: card.lemma,
          gloss: card.clue,
          rank: card.rank,
          grade: gradeOf(card),
          ms: card.ms,
        });
      }
    }

    // No result. Nobody won a review, and the room's own synthesised record
    // would have said the same thing — this one says it while carrying the
    // words, which is the only reason it exists.
    const seats: SeatOutcome[] = [{ seat: 0, result: null, learned }];
    return { gameId: drill.id, seats };
  },
};

function gradeOf(card: DrillCard): Grade {
  if (card.how === 'wrong') return 'wrong';
  if (card.how === 'gave-up') return 'gave-up';
  return wasFast(card.ms, CARD_MS) ? 'produced-fast' : 'produced';
}

export const DRILL_SEATS = SEATS;
