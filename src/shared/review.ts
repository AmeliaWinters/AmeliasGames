/**
 * When a word comes back, and what knowing it is worth.
 *
 * Pure, `now` injected, and deliberately simple. The input is a handful of
 * words a session out of two games people play for fun, so an SM-2 ease factor
 * tuned on twenty thousand daily reviews has nothing here to work with: it
 * would be six more numbers on every row, all of them noise, and none of them
 * checkable by looking at the screen. A short Leitner ladder is the honest
 * amount of machinery for the amount of signal.
 *
 * The interesting part of this file is not the intervals, it is `Grade`. Both
 * language games already distinguish, in their own reducers and for their own
 * reasons, between producing a word and recognising it, between arriving with
 * a hint and being shown the answer, and between giving up and never answering
 * at all. Those distinctions cost the reducers real complexity and they are
 * exactly the distinctions a scheduler needs. This module's job is mostly to
 * not throw them away.
 */

/**
 * The ladder, in days.
 *
 * Roughly doubling, starting at one. The first three rungs are the ones that
 * do the work — a word met on Tuesday comes back Wednesday, Saturday, the
 * following weekend — and the last two exist so a word you plainly know stops
 * taking up a turn. Six rungs, because the seventh would be six months, and a
 * word nobody has asked about for six months is better re-met than reviewed.
 */
export const BOXES: readonly number[] = [1, 3, 7, 16, 35, 90];

const DAY_MS = 86_400_000;

/** The deepest rung. Named because three separate rules clamp to it. */
export const TOP_BOX = BOXES.length - 1;

/**
 * The deepest rung a hinted answer can reach.
 *
 * A hint is not a reveal and the difference is the whole reason hints exist:
 * `HINT_ALLOWANCE` in `vocabDisplay.ts` argues that first letter plus length
 * resolves a word already on the tip of the tongue, so a hinted round is one
 * where the player did the retrieval themselves and arrived — which is what
 * makes a word stick. So a hinted answer climbs.
 *
 * It just does not climb all the way. A word you still need a first letter for
 * has no business on a ninety-day interval, and the ceiling is what says so
 * without having to invent a second ladder. At three, a hinted word tops out
 * coming back every sixteen days, and one unhinted answer from there lets it go
 * deeper.
 */
export const HINTED_CEILING = 3;

/**
 * What one event says about one word.
 *
 * Deliberately named for what the player did rather than for what the
 * scheduler does about it, because the mapping from one to the other is the
 * thing most likely to be argued with later and it should be arguable in one
 * place (`schedule`) rather than baked into the names.
 */
export type Grade =
  /** Produced it: typed it from a meaning, or said it into the chain. */
  | 'produced'
  /** Produced it with time to spare, measured against their own allowance. */
  | 'produced-fast'
  /** Produced it, having bought a hint first. See `HINTED_CEILING`. */
  | 'hinted'
  /** Chose the right meaning out of four. Recognition, not production. */
  | 'recognised'
  /** Answered, and was wrong. */
  | 'wrong'
  /** Said they had nothing. Not the same admission as being wrong. */
  | 'gave-up'
  /** Was shown the word they could not find. Word Chain's reveal. */
  | 'shown'
  /**
   * Read it go past in somebody else's turn.
   *
   * The weakest signal in the set, and the only one that never creates a row:
   * see `applyGrade` in `harvest.ts`. Counting a word you watched an opponent
   * play as a word you have met would inflate every number on the profile, and
   * the profile's only job is to be worth trusting.
   */
  | 'seen';

/** Whether a grade is evidence the player could produce the word. */
export function isProduction(grade: Grade): boolean {
  return grade === 'produced' || grade === 'produced-fast' || grade === 'hinted';
}

/** Whether a grade is a failure to produce it. `seen` is neither. */
export function isMiss(grade: Grade): boolean {
  return grade === 'wrong' || grade === 'gave-up' || grade === 'shown';
}

/**
 * How much of your own allowance you have to beat for an answer to count as
 * fast.
 *
 * A fraction rather than a number of seconds, and that is the entire point.
 * The two games hand out very different allowances — Word Chain's minute
 * shrinks to five seconds as the chain grows, and Vocab Race gives a beginner
 * thirty seconds where somebody fluent gets fifteen — so a fixed threshold
 * would report "fast" as a fact about which game you were playing and how you
 * had declared yourself. Measured against your own window, an expert's four
 * seconds out of fifteen and a learner's nine out of thirty both read as what
 * they are: the word was there.
 *
 * Two fifths is where "I knew that" stops and "I worked that out" begins. It
 * buys nothing but a deeper rung, so being wrong about it is cheap.
 */
export const FAST_FRACTION = 0.4;

/** Whether an answer that took `ms` out of `allowanceMs` counts as fast. */
export function wasFast(ms: number, allowanceMs: number): boolean {
  return allowanceMs > 0 && ms > 0 && ms <= allowanceMs * FAST_FRACTION;
}

/** Where a word sits after an event, and when it comes back. */
export interface Placement {
  box: number;
  dueAt: number;
}

/** The rung a word lands on, ignoring when. Split out so `schedule` reads. */
function boxAfter(box: number, grade: Grade): number {
  switch (grade) {
    case 'produced':
    case 'produced-fast':
      return Math.min(box + 1, TOP_BOX);
    case 'hinted':
      // Climbs, but never past the ceiling. The outer `max` is what keeps a
      // word already deeper than the ceiling where it is rather than dragging
      // it back: arriving with a hint is not evidence *against* knowing
      // something, and demoting on it would make buying a hint a punishment,
      // which is the one thing the allowance is designed not to be.
      return Math.max(box, Math.min(box + 1, HINTED_CEILING));
    case 'recognised':
      // Holds. `PICK_SCALE` in `vocabDisplay.ts` already argues that choosing
      // one meaning out of four is a one-in-four guess at worst and a flicker
      // of recall at best. Letting it climb would let the easy third of the
      // game carry a word onto a long interval, and the word would then not
      // come back until it had been forgotten.
      return box;
    case 'wrong':
    case 'shown':
      return 0;
    case 'gave-up':
      // One rung above `wrong`, and this is the distinction `VocabHow` went to
      // the trouble of keeping. A player who guessed and missed had the wrong
      // word in their head; a player who said they had nothing had no word at
      // all, but they also did not confabulate one, and knowing you do not know
      // is worth about a day.
      return Math.min(box, 1);
    case 'seen':
      return box;
  }
}

/**
 * Where a word goes after an event.
 *
 * `null` means "this event says nothing" — the caller should not touch the
 * row's schedule at all. Only `seen` answers that way, and it matters that it
 * is a distinct answer rather than "stays where it is": a word merely watched
 * must not have its due date pushed out, or an evening of reading an
 * opponent's words would silently postpone every review the player had
 * earned.
 *
 * Note that `timeout` is not a grade and never reaches here. The seat that sat
 * there is a phone that locked or somebody who put the game down, and grading
 * it as failure would let one distracted evening bury a hundred words they
 * actually know. `harvest.ts` drops it before this is called, which is the
 * right place for it: it is not a bad answer, it is the absence of one.
 */
export function schedule(box: number, grade: Grade, now: number): Placement | null {
  if (grade === 'seen') return null;
  const next = boxAfter(Math.max(0, Math.min(box, TOP_BOX)), grade);
  return { box: next, dueAt: now + BOXES[next] * DAY_MS };
}

/**
 * What an event is worth in experience.
 *
 * **Paid for words, and only incidentally for games.** The argument is not
 * really about arithmetic. Vocab Race spends two of its constants
 * (`LEVEL_ASKS`, `LEVEL_SCALE`) making sure a fluent speaker cannot farm
 * a learner, having found out the hard way that a race between the two is not
 * a race. An XP curve that paid for winning would reverse that decision from
 * outside the reducer, and would do it silently, while the reducer's comments
 * went on claiming otherwise. So the number that gets shown to people is paid
 * for the thing the app is for.
 *
 * It pays by the rung reached rather than a flat rate, because recalling
 * something after five weeks is a harder thing than recalling it after a day,
 * and a curve that could not tell them apart would make the most valuable
 * review in the system worth the same as the cheapest.
 *
 * Nothing is paid for a miss. Not as a punishment — the ladder has already
 * done everything a miss deserves — but because paying for it would make the
 * fastest way to earn XP a game of typing rubbish into Vocab Race, and a
 * number that rewards that is a number nobody can respect.
 *
 * There is no daily cap and none is needed: a word reviewed today is not due
 * today, so it cannot pay twice. That is also the whole anti-cheat story.
 * Two tabs and `?as=b` can already drive both seats of anything, and the answer
 * is not to detect it but to make it pointless — the only person you can cheat
 * is the person whose vocabulary you are measuring.
 */
export function xpFor(grade: Grade, box: number): number {
  const rung = Math.max(0, Math.min(box, TOP_BOX));
  switch (grade) {
    case 'produced-fast':
      return 6 + 3 * rung;
    case 'produced':
      return 4 + 3 * rung;
    case 'hinted':
      // Half of what the same answer unhinted would have paid, rounded up so
      // it is never nothing. `HINT_SCALE` prices a hinted answer at half inside
      // the game; the same trade should read the same way outside it.
      return Math.ceil((4 + 3 * rung) / 2);
    case 'recognised':
      return 2;
    default:
      return 0;
  }
}

/**
 * What finishing a game is worth, before any words are counted.
 *
 * Small, and paid win or lose. It exists so that a profile does not look dead
 * to somebody who mostly plays Backgammon, and it is deliberately too small to
 * compete with a study session: three right answers on a middling rung outpay
 * winning four games. The win bonus is smaller still, and is there because a
 * result with no consequence at all reads as the app not having noticed.
 */
export const XP_PER_GAME = 5;
export const XP_PER_WIN = 5;

/**
 * What one finished game pays into the purse, in goth points.
 *
 * Every game pays this, including the eleven that teach nothing. The purse
 * used to be the non-English experience total, so a night of Backgammon bought
 * nothing at all; see `Profile.points` for why that stopped being the rule.
 */
export const POINTS_PER_GAME = 20;

/**
 * What a game that taught a language pays instead: five times as much.
 *
 * Five rather than something gentler because this multiplier is the entire
 * argument for opening Vocab Race instead of Connect Four, and a difference
 * people have to do arithmetic to notice is not one that changes what they
 * play.
 */
export const LANG_POINTS_MULTIPLIER = 5;

/**
 * The first game of any UTC day, on top of whatever that game paid.
 *
 * Large on purpose, and once. It is the number that makes coming back at all
 * the highest-value thing on the screen -- fifteen ordinary games, or three
 * language ones -- and it cannot be farmed by playing more, only by playing
 * again tomorrow. Checked against `Profile.playedDay`, which is a day of
 * *playing*: `streak` is a day of studying and deliberately does not move for
 * a game that taught nothing.
 */
export const POINTS_FIRST_GAME_OF_DAY = 300;

/**
 * What one finished game pays, before the daily bonus.
 *
 * `wordXp` is what the game's words earned for the language they were in, and
 * it is a **floor, not an addend**: a language game pays 100, or what its words
 * were worth if that was more. Adding the two would have made the target
 * meaningless -- 100 plus a good Vocab Race is nearer 160 -- and paying the
 * flat number alone would have made a careful game worth exactly as much as
 * one spent typing rubbish, which is the thing `xpFor` above refuses to do.
 *
 * `taught` is whether the game filed any word event at all, which is the same
 * test `applyRecord` uses to decide where the flat experience bonus goes. It
 * is per game rather than per player: watching an opponent's Polish go past is
 * still an evening of Polish.
 */
export function pointsFor(taught: boolean, wordXp: number): number {
  const base = taught ? POINTS_PER_GAME * LANG_POINTS_MULTIPLIER : POINTS_PER_GAME;
  return Math.max(base, Math.round(wordXp));
}

/**
 * The level a total buys, counting from one.
 *
 * Quadratic, so each level costs a little more than the last and the curve
 * never stops: level `n` begins at `LEVEL_STEP * n * (n - 1) / 2`, which is
 * 0, 60, 180, 360, 600 and so on. The first level arrives inside one good
 * game, which is the only part of the curve most people will judge it on, and
 * the tenth takes about a month of playing properly.
 *
 * Levels are a curve over a scoreboard and the profile should not lead with
 * them: *words known* and *words due* are the numbers that mean something, and
 * a level is a number that means something only next to somebody else's. See
 * the profile screen.
 */
export const LEVEL_STEP = 60;

export function levelFor(xp: number): number {
  // n such that STEP * n * (n - 1) / 2 <= xp, solved and floored.
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / LEVEL_STEP)) / 2));
}

/** The total at which `level` begins. `levelFor(xpForLevel(n)) === n`. */
export function xpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return (LEVEL_STEP * n * (n - 1)) / 2;
}

/**
 * Both ends of the bar for one total. What `profileView` is handed.
 *
 * It exists so that `profile.ts` can draw a level without importing this
 * module -- see the note at the top of `profile.ts`, which is about eighty
 * thousand Polish inflections and is not a style preference.
 *
 * The curve is unchanged by the move to per-language totals, which is a
 * decision rather than an oversight. Splitting the pool does slow the early
 * levels for somebody studying two languages at once, and the alternative was
 * to shrink `LEVEL_STEP` to compensate -- but that would quietly inflate the
 * levels of everybody studying one, which is nearly everybody, and levels that
 * jumped on the deploy that split them would look exactly like the bug this
 * was fixing.
 */
export function rankOf(xp: number): { level: number; levelAt: number; nextLevel: number } {
  const level = levelFor(xp);
  return { level, levelAt: xpForLevel(level), nextLevel: xpForLevel(level + 1) };
}

/**
 * Whether an answer counts towards a word's consecutive-correct run.
 *
 * Wider than `isProduction` and narrower than "not a miss", and both edges are
 * deliberate. A hinted answer counts, because the player retrieved the word
 * and a hint is a first letter rather than the answer -- `HINTED_CEILING` above
 * makes the same argument about the ladder. A recognised one counts too: the
 * run is a claim about ten answers in a row spread over months, and one lucky
 * pick out of four does not survive that, so excluding it would only punish
 * the players using the easier mode honestly.
 *
 * `seen` is neither correct nor incorrect and must not touch the run, for the
 * same reason it never creates a row: watching an opponent play a word is not
 * an answer.
 */
export function isCorrect(grade: Grade): boolean {
  return isProduction(grade) || grade === 'recognised';
}
