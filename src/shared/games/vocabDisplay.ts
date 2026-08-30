/**
 * The parts of Vocab Race the board is allowed to know.
 *
 * Same boundary as `wordChainDisplay.ts`, and it is load-bearing for the same
 * reason: this game reads Word Chain's three word lists, which are the second
 * largest thing in the repo, and it reads them only to draw a clue and mark an
 * answer, both of which happen on the server. One convenience import in
 * `VocabBoard.tsx` would put sixty thousand Polish inflections on the phone of
 * everyone who opens the lobby. `bundle.test.ts` already holds that line for
 * `chainWords.ts` however it is reached, so this game inherits the guard rather
 * than needing a new one.
 *
 * There is a second reason here that Word Chain does not have: the answer to
 * the clue on the screen is a secret. A board that could reach the dictionary
 * could resolve the clue itself, and the race would be over. The board is sent
 * the clue and nothing else until the round is settled, see `view()` in the
 * reducer.
 *
 * The only things it imports are `../clock.js`, which imports nothing itself.
 */

export { clockCall, formatClock } from '../clock.js';

// `review.js` is a leaf -- no dictionary on the path -- so a display module may
// reach it. See `gradeOf` at the foot of this file.
import { wasFast, type Grade } from '../review.js';

/*
  The rules and the shapes are their own files now; this one is the derivations
  and the door. Re-exported rather than re-homed because the comment above is
  the reason this module exists, and it holds for all three: one import path
  means one boundary to keep honest, and every board and the reducer already
  name this file.
*/
export * from './vocabRules.js';
export * from './vocabShapes.js';

import {
  DEFAULT_LEVEL,
  HINT_SCALE,
  LEVEL_SCALE,
  PHRASE_RARITY,
  RARITY_STEP,
  ROUND_MS,
  SPEED_BONUS,
  askScale,
  choosing,
  isPhrases,
} from './vocabRules.js';
import type { VocabAsk, VocabLevel } from './vocabRules.js';
import type {
  VocabHint,
  VocabHow,
  VocabRound,
  VocabState,
  VocabTry,
} from './vocabShapes.js';

/**
 * Whether `seat` is the kind of seat the free hint is for.
 *
 * Level and direction only, no clock: `view()` has no `now` (see the
 * `GameDefinition` signature), so the server sends the hint down with an `at`
 * on it and the board holds it until the clock reaches it. That does mean a
 * seat's own board holds its own hint five seconds early. It is worth it: the
 * alternative is a clock in `view` or a timer move in the reducer, and what
 * leaks is one player's first letter to that one player, on a round the game
 * has already decided to give it to them, worth the same points either way.
 */
export function autoHinted(state: VocabState, seat: number): boolean {
  return levelOf(state, seat) === 'new';
}

/** What a seat's declared level multiplies a right answer by. See `LEVEL_SCALE`. */
export function levelScale(state: VocabState, seat: number): number {
  return LEVEL_SCALE[levelOf(state, seat)];
}

export function isFinished(state: VocabState): boolean {
  return state.phase === 'over';
}

/** Whether the phase's clock has run out as of `now`. False when there is none. */
export function outOfTime(state: VocabState, now: number | undefined): boolean {
  return state.deadline !== null && now !== undefined && now >= state.deadline;
}

/** How much of the phase is left, for the countdown. */
export function msLeftFor(state: VocabState, now: number): number {
  return state.deadline === null ? 0 : Math.max(0, state.deadline - now);
}

/** What `seat` says it knows, defaulted for a seat that never declared. */
export function levelOf(state: VocabState, seat: number): VocabLevel {
  return state.levels[seat] ?? DEFAULT_LEVEL;
}

/**
 * How long `seat` has to answer, counted from the clue going up.
 *
 * The same thirty seconds for everybody, which is the point: a level buys the
 * *question* now, not the clock (see `LEVEL_ASKS`). Kept as a function of the
 * seat rather than flattened to `ROUND_MS` at every call site because the
 * machinery around it -- `windowLeft`, `roundDeadline`, the speed term in
 * `roundPoints` -- is per seat regardless, since seats finish at different
 * times, and a per-seat window is the shape that survived being wrong once.
 *
 * Zero for a seat that is not in this game, which `roundDeadline` relies on.
 */
export function windowMs(state: VocabState, seat: number): number {
  if (seat < 0 || seat >= state.scores.length) return 0;
  return ROUND_MS;
}

/**
 * Which way round `round` was asked of `seat`. `say` for a seat the round has
 * never heard of, which is the safe way to be wrong: a seat wrongly given a
 * blank box can still answer, where one wrongly given four meanings would be
 * shown a clue that is supposed to be the secret.
 */
export function askIn(round: VocabRound | null, seat: number): VocabAsk {
  return round?.asks[seat] ?? 'say';
}

/** Which way round the clue on the table is being asked of `seat`. */
export function askOf(state: VocabState, seat: number): VocabAsk {
  return askIn(state.round, seat);
}

/** The try `seat` has already had this round, or null if it is still in. */
export function tryOf(round: VocabRound | null, seat: number): VocabTry | null {
  return round?.tries.find((attempt) => attempt.seat === seat) ?? null;
}

/**
 * How much of `seat`'s own window is left, as of `now`. Zero once it is spent.
 *
 * This is the number the board counts down beside the box, and it is not the
 * round clock: on a mixed table they run out at different times, and the seat
 * that needs to know how long it has is the one whose window is shortest.
 *
 * Zero without a `now`, which matches `outOfTime`: a caller with no clock is
 * asking a question this cannot answer. Every caller that matters has one. The
 * server passes its own into `canAct`, and the board recomputes against the
 * ticking clock, because a window closes between state messages with no message
 * to announce it.
 */
export function windowLeft(state: VocabState, seat: number, now: number | undefined): number {
  if (now === undefined || state.phase !== 'asking' || state.round === null) return 0;
  return Math.max(0, state.round.began + windowMs(state, seat) - now);
}

/**
 * When the round on the table should close.
 *
 * The last window still open and no later. With every window the same length
 * that reduces to "when everybody's thirty seconds are up", but the shape is
 * what matters: every seat that finishes pulls this in, and the round ends the
 * moment the last one does. That is what makes "give up" worth pressing -- it
 * is the fastest way to the next word -- and it is the only thing keeping a
 * table of four off a dead clock.
 *
 * `now` when everybody is done, meaning settle immediately. A round with nothing
 * left to wait for should not sit on the screen at all.
 */
export function roundDeadline(state: VocabState, round: VocabRound, now: number): number {
  let last = 0;
  for (let seat = 0; seat < state.scores.length; seat++) {
    if (tryOf(round, seat) !== null) continue;
    last = Math.max(last, windowMs(state, seat));
  }
  if (last === 0) return now;
  return Math.min(round.began + ROUND_MS, round.began + last);
}

/** Whether every seat has finished with the clue on the table. */
export function everyoneDone(state: VocabState, round: VocabRound): boolean {
  return state.scores.every((_, seat) => tryOf(round, seat) !== null);
}

/**
 * The seat that got there first, or null if nobody did.
 *
 * The nearest thing this game still has to a winner of a round, and only a
 * headline: it earns no more than the points the answer was worth, and on a
 * mixed table it is routinely *not* the seat that scored most, the result the
 * whole design is arranged to produce.
 */
export function firstRight(round: VocabRound): VocabTry | null {
  return round.tries.reduce<VocabTry | null>(
    (best, attempt) =>
      attempt.how !== 'right' || (best !== null && best.ms <= attempt.ms) ? best : attempt,
    null,
  );
}

/** Everyone who got it right this round, earliest first. */
export function rightTries(round: VocabRound): VocabTry[] {
  return round.tries.filter((attempt) => attempt.how === 'right').sort((a, b) => a.ms - b.ms);
}

/**
 * An answer with everything but its initials held back: `z _ _ _ _`.
 *
 * Spaced rather than run together, because the length is half the hint and
 * nobody reads `z____` as four correctly at a glance. Anything that is not a
 * letter is shown as itself: the lists carry a few hyphenated and spaced
 * entries, and masking those would make the shape of the word a second puzzle
 * on top of the first.
 *
 * The first letter of *each* word rather than of the whole string, which only
 * matters in phrase mode and matters a lot there. `z _ _ _ _ _ _   _ _   _ _ _ _`
 * is not a hint, it is a rectangle: the thing that resolves a sentence on the
 * tip of the tongue is the shape of its words, and a four-word phrase given one
 * letter is being charged half its points for the length alone. On a
 * single-word answer this is the same string it always was.
 *
 * Built from the romaji `word` rather than the `script`, because romaji is what
 * the box takes and a hint you cannot act on is not a hint. Split by code
 * point, so a Polish diacritic counts as the one letter it is.
 */
export function maskWord(word: string): string {
  let opening = true;
  return [...word]
    .map((ch) => {
      const letter = /\p{L}/u.test(ch);
      if (!letter) {
        opening = true;
        return ch;
      }
      if (opening) {
        opening = false;
        return ch;
      }
      return '_';
    })
    .join(' ');
}

/** The hint `seat` has bought this round, or null if it has not. */
export function hintOf(round: VocabRound | null, seat: number): VocabHint | null {
  return round?.hints.find((hint) => hint.seat === seat) ?? null;
}

/** How many `seat` has left. Zero for a seat that is not in this game. */
export function hintsLeft(state: VocabState, seat: number): number {
  return state.hints[seat] ?? 0;
}

/**
 * Whether `seat` may buy a hint on the clue in front of it.
 *
 * Everything `canAct` wants, and three things more: there has to be an
 * allowance left, this seat must not already have a hint this round (a second
 * would only re-show the first), and this seat has to be *typing*. That last
 * one is the rule worth naming -- the first letter of a word already printed
 * on the screen is not information, and selling it would be charging somebody
 * half their points for nothing. It is per seat now, because the round is: on
 * a mixed table one seat is picking and the seat beside it is typing.
 *
 * A beginner is refused too, and not because they may not have one. They are
 * about to be *given* one (`FREE_HINT_MS`), and a shop that sells at half
 * price what it hands out free five seconds later is a trap rather than a
 * choice. Their three stay unspent, which is the honest reading of an
 * allowance they were never asked to draw on.
 *
 * Deliberately *not* folded into `canAct`. They answer different questions and
 * the board needs both at once: a seat that may hint is by definition still
 * able to answer, so the two controls are live together and gated separately.
 */
export function canHint(state: VocabState, seat: number, now?: number): boolean {
  if (!canAct(state, seat, now)) return false;
  if (state.phase !== 'asking' || state.round === null) return false;
  if (askIn(state.round, seat) !== 'say') return false;
  if (autoHinted(state, seat)) return false;
  if (hintsLeft(state, seat) <= 0) return false;
  return hintOf(state.round, seat) === null;
}

/**
 * What a right answer is worth: how rare the word is, times how early it
 * landed in your own window, times what your level scores.
 *
 * The three terms are the three things this game is trying to reward, and the
 * order they are argued in matters:
 *
 * - **rarity** is the point of playing. A game that paid the same for `and` as
 *   for a word you had to reach for would be a typing test;
 * - **speed** is what stops the round being a stroll for whoever is not being
 *   raced. It is measured against the player's own window, which is the same
 *   thirty seconds for everybody;
 * - **which way round it was asked** (`PICK_SCALE`), because choosing a
 *   meaning from four is not producing a word from nothing. Most of the
 *   handicap is still here, in the question rather than in the player: a
 *   beginner scores half on the three rounds in four they are handed the
 *   easier one, and an expert who somehow drew a `pick` would be paid exactly
 *   the same half;
 * - **what level the seat declared** (`LEVEL_SCALE`), which halves a fluent
 *   seat. The one term aimed at the player rather than the question, and the
 *   only place a handicap of that shape survives -- read it there before
 *   moving it;
 * - **whether they bought a hint** (`HINT_SCALE`), which is the price of the
 *   decision the hint exists to create. A hint that was *given* rather than
 *   bought is not priced at all: see `FREE_HINT_MS`.
 *
 * All five are multiplied rather than added, so nothing here can be gamed by
 * stacking: a hinted answer on a recognition round is a quarter of what the
 * same word would have paid typed cold, which is the honest ratio.
 *
 * Rounded to a whole number, and never below one: a right answer that scored
 * nothing would read as a bug, and the seat that answered a very common word
 * at the very edge of its window has still answered it. A common word, hinted,
 * picked and late prices out below one and still pays it.
 */
export function roundPoints(
  state: VocabState,
  seat: number,
  rank: number,
  ms: number,
  ask: VocabAsk,
  hinted: boolean,
): number {
  const decade = rank < 1 ? 0 : Math.floor(Math.log10(rank));
  const rarity = isPhrases(state.mode) ? PHRASE_RARITY : RARITY_STEP * (decade + 1);
  const window = windowMs(state, seat);
  const left = window === 0 ? 0 : Math.max(0, Math.min(1, (window - ms) / window));
  const scaled =
    rarity *
    (1 + SPEED_BONUS * left) *
    askScale(ask) *
    levelScale(state, seat) *
    (hinted ? HINT_SCALE : 1);
  return Math.max(1, Math.round(scaled));
}

/**
 * Whether `seat` may act right now.
 *
 * Written out rather than aliased to `turn(state) === seat`, because this game
 * is never strictly alternating and the contract has to be honest about which
 * kind it is. During a round every seat that has not already missed may act at
 * once, which is what a race is, and `turn` reports a single seat throughout,
 * which is why it is a hint for the status line and this is the predicate every
 * control on the board is gated on.
 *
 * Three quite different answers hide in here:
 *
 * - **setup** is everybody, because every seat has one control there, its own
 *   level. The language and the difficulty are still the host's alone, and
 *   `applyMove` enforces that, since it is a rule about two of the three setup
 *   moves rather than about the phase;
 * - **asking** is everybody who has not finished this round and still has
 *   window left. Crucially that includes seats somebody has *already beaten*,
 *   since a right answer no longer closes the round, and this predicate is
 *   where that promise is kept. It does not care which way round the seat was
 *   asked: a `pick` and a `say` are both answers to the same clue;
 * - **reveal** is nobody, which is the point of it. The answer is on the
 *   screen, so a guess taken during the reveal would be a guess at nothing.
 */
export function canAct(state: VocabState, seat: number, now?: number): boolean {
  if (seat < 0 || seat >= state.scores.length) return false;
  if (state.phase === 'setup') return true;
  if (state.phase !== 'asking') return false;
  if (state.round === null) return false;
  if (outOfTime(state, now)) return false;
  // A window that has run out is still checked separately from the round's
  // clock. They are the same length today, but the round's deadline moves in
  // as seats finish (see `roundDeadline`) and this one does not.
  if (now !== undefined && windowLeft(state, seat, now) === 0) return false;
  return tryOf(state.round, seat) === null;
}

/** The best score on the table. Zero for a game nobody has scored in. */
export function leadScore(state: VocabState): number {
  return state.scores.reduce((best, score) => Math.max(best, score), 0);
}

/** Every seat on the best score: one normally, more on a shared lead. */
export function leaders(state: VocabState): number[] {
  const best = leadScore(state);
  return state.scores.flatMap((score, seat) => (score === best ? [seat] : []));
}

/** How one seat played, over the rounds that were actually asked. */
export interface VocabSeatStat {
  seat: number;
  /** Rounds they got right. No longer the same as their score, see `points`. */
  won: number;
  /**
   * Rounds they answered wrong. The interesting half of the pair: a player who
   * got four right and none wrong was never really reaching, and one who got
   * four and was wrong nine times was the reason everyone else was hurrying.
   */
  missed: number;
  /**
   * Rounds they gave up on, and rounds their window closed on. Kept apart
   * because the first is a judgement and the second is usually a seat that had
   * wandered off.
   */
  gaveUp: number;
  timedOut: number;
  /**
   * Rounds they spent a hint on. Worth a line of its own at the end because it
   * is the only number here that reflects a *choice* rather than a result: a
   * player who won on three hints and one who won on none played differently,
   * and the scoreline alone cannot tell you which.
   */
  hinted: number;
  /**
   * What they scored, which is the number beside their name. Worth showing
   * next to `won` precisely because they come apart: the whole design is that
   * six right answers from an expert can be fewer points than four from a
   * learner.
   */
  points: number;
  /**
   * Mean time to a right answer, in milliseconds. Zero for a seat that never
   * got one, which is not a fast player and the board must not draw it as one.
   */
  ms: number;
}

export interface VocabStats {
  /** One per seat, in seat order, including seats that never scored. */
  seats: VocabSeatStat[];
  /** The fastest right answer of the game, whose it was, and which round. */
  quickest: { round: VocabRound; attempt: VocabTry; at: number } | null;
  /**
   * The rounds nobody took. The review list worth reading twice: these are the
   * words the whole table did not know, the closest this game comes to telling
   * you what to study.
   */
  missedByAll: VocabRound[];
}

/**
 * The end-of-game reckoning, computed from the history rather than tallied as
 * the game runs.
 *
 * Derived, so nothing on the state can drift out of step with the rounds it
 * describes, and the board is the only thing that ever wants it, which is why
 * it lives on this side of the boundary.
 */
export function vocabStats(state: VocabState): VocabStats {
  const rounds = state.round === null ? state.history : [...state.history, state.round];
  const settled = rounds.filter((round) => round.answer !== null);

  const seats: VocabSeatStat[] = state.scores.map((_, seat) => {
    const mine = settled.flatMap((round) => {
      const attempt = tryOf(round, seat);
      return attempt === null ? [] : [attempt];
    });
    const right = mine.filter((attempt) => attempt.how === 'right');
    const count = (how: VocabHow): number => mine.filter((a) => a.how === how).length;
    return {
      seat,
      won: right.length,
      missed: count('wrong'),
      gaveUp: count('gave-up'),
      timedOut: count('timeout'),
      hinted: mine.filter((attempt) => attempt.hinted).length,
      points: right.reduce((total, attempt) => total + attempt.points, 0),
      ms: right.length === 0
        ? 0
        : right.reduce((total, attempt) => total + attempt.ms, 0) / right.length,
    };
  });

  let quickest: { round: VocabRound; attempt: VocabTry; at: number } | null = null;
  settled.forEach((round, i) => {
    for (const attempt of round.tries) {
      if (attempt.how !== 'right') continue;
      if (quickest === null || attempt.ms < quickest.attempt.ms) {
        quickest = { round, attempt, at: i + 1 };
      }
    }
  });

  return {
    seats,
    quickest,
    missedByAll: settled.filter((round) => !round.tries.some((a) => a.how === 'right')),
  };
}

/**
 * One try, as a grade. See `record` in `vocab.ts` for the argument behind each
 * row.
 *
 * `timeout` never reaches here: `record` drops it before asking, because the
 * answer would have to be "nothing" and a grade that means "do not grade this"
 * is a grade every caller has to remember to check for.
 *
 * **Here rather than in the reducer, and that is load-bearing.** The board
 * prices its own answer for the "+7 XP" that rises off it, and it must use
 * this function rather than a second opinion -- a client-side grader would
 * drift the first time the hint rule changed, and the drift would show up as
 * a number on the screen disagreeing with the number on the end screen. But a
 * board cannot import `vocab.ts`: the reducer reaches the dictionary, and
 * `bundle.test.ts` builds the real bundle and fails over exactly that. It
 * caught this one on the way in. So the grader lives in the display module,
 * which is the half both sides are allowed to hold, and the reducer imports it
 * from here.
 *
 * See `xpPop.tsx` for the one thing the board still has to estimate, which is
 * the rung and not the grade.
 */
export function gradeOf(attempt: VocabTry, ask: VocabAsk, window: number): Grade {
  if (attempt.how === 'wrong') return 'wrong';
  if (attempt.how === 'gave-up') return 'gave-up';
  if (choosing(ask)) return 'recognised';
  if (attempt.hinted) return 'hinted';
  return wasFast(attempt.ms, window) ? 'produced-fast' : 'produced';
}
