/**
 * The parts of Vocab Race the board is allowed to know.
 *
 * Same boundary as `wordChainDisplay.ts`, and it is load-bearing for the same
 * reason: this game reads Word Chain's three word lists, which are the second
 * largest thing in the repo, and it reads them only to draw a clue and mark an
 * answer — both of which happen on the server. One convenience import in
 * `VocabBoard.tsx` would put sixty thousand Polish inflections on the phone of
 * everyone who opens the lobby. `bundle.test.ts` already holds that line for
 * `chainWords.ts` however it is reached, so this game inherits the guard
 * rather than needing a new one.
 *
 * There is a second reason here that Word Chain does not have: the answer to
 * the clue on the screen is a secret. A board that could reach the dictionary
 * could resolve the clue itself, and the race would be over. What the board is
 * sent is the clue and nothing else until the round is settled — see `view()`
 * in the reducer.
 *
 * The only things it imports are `../clock.js`, which imports nothing itself.
 */

export { clockCall, formatClock } from '../clock.js';

/**
 * The two languages you can learn.
 *
 * English is missing on purpose and it is the one real cut in this game. The
 * clue is an English meaning, so learning English would mean cluing an English
 * word with an English description — and there are no English descriptions in
 * the data. The frequency list is bare words. Worse, its top hundred is
 * `you the and that what this for have your was not are don`: function words,
 * inflections and the orphaned halves of contractions, which no dictionary
 * defines and no clue can point at. A learner's English round would have been
 * a worse game built on data that does not exist, so English stays the
 * language the clues are written in.
 */
export type VocabLang = 'pl' | 'ja';

export const VOCAB_LANGS: readonly VocabLang[] = ['pl', 'ja'];

export const VOCAB_LANG_NAME: Record<VocabLang, string> = {
  pl: 'Polish',
  ja: 'Japanese',
};

/**
 * How deep into the frequency list the clues are drawn from.
 *
 * The lists are ordered commonest first, so a difficulty here is just a depth:
 * normal asks only about the hundred words a language uses most, hard opens it
 * to the first thousand. That is a real difference rather than a labelled one —
 * the top hundred of any language is the vocabulary you cannot avoid knowing,
 * and the words between five hundred and a thousand are the ones a learner is
 * actually in the middle of.
 *
 * One setting for the room rather than one per player. A race decides who was
 * first, and two players racing at different depths are not racing.
 */
export type VocabMode = 'normal' | 'hard';

export const VOCAB_MODES: readonly VocabMode[] = ['normal', 'hard'];

export const MODE_CAP: Record<VocabMode, number> = { normal: 100, hard: 1000 };

export const MODE_NAME: Record<VocabMode, string> = { normal: 'Normal', hard: 'Hard' };

/**
 * How many rounds a player has to take to win.
 *
 * Five, because it is the number that survives eight players. A race hands out
 * one point a round however many are playing, so a target scaled to the table
 * would make a full room a marathon; five keeps the shortest possible game at
 * five rounds and the longest realistic one under thirty, which is the length
 * of a bus journey rather than an evening.
 */
export const TARGET = 5;

/**
 * How long a round is open before nobody gets it.
 *
 * Thirty seconds is well past the point where the answer is going to arrive.
 * Either the word is in your head — in which case this is a typing contest and
 * it is decided in three seconds — or it is not, and no amount of staring
 * produces it. The clock is here to end a round nobody can answer, not to
 * apply pressure; the pressure is the other players.
 */
export const ROUND_MS = 30 * 1000;

/**
 * How long the answer stays on the screen before the next clue.
 *
 * This is the entire point of the game and the reason it is a phase of its own
 * rather than a line above the next clue. Being wrong, or being beaten, is the
 * moment the word sticks — and a round that rolled straight into the next one
 * would spend that moment showing you something else to read. Six seconds is
 * long enough to read a word, its script and its meaning without being long
 * enough to want to skip.
 */
export const REVEAL_MS = 6 * 1000;

/**
 * How long the host has to choose a language and press start.
 *
 * Generous, because up to eight people may still be arriving, and nobody loses
 * to it: a setup clock that runs out picks Polish on normal and deals, which
 * is a game starting rather than a room ending. See `expire` in the reducer.
 */
export const SETUP_MS = 90 * 1000;

/**
 * The seat that sets the room up.
 *
 * Zero, which is whoever opened the room — the same seat `RoomEngine.start`
 * already requires to deal the game. Making it a room-wide setting meant
 * somebody had to own it, and eight people fighting over a language menu is
 * worse than one person choosing.
 */
export const HOST = 0;

/**
 * The deepest rank any deck reaches, which is hard mode's cap.
 *
 * The deck is dealt once, at setup, as a shuffled run of ranks — *before* the
 * language and the difficulty are known, because the only place this game is
 * handed an rng is `setup` and `applyMove`, and neither `expire` nor the tick
 * that drives the reveal into the next round has one. Dealing the deepest
 * possible deck up front and filtering it against the cap when a round is
 * drawn is what makes every later round decidable with no randomness at all.
 */
export const DECK_DEPTH = MODE_CAP.hard;

export type VocabPhase = 'setup' | 'asking' | 'reveal' | 'over';

/** The word a clue was pointing at, as the board should draw it. */
export interface VocabAnswer {
  /** As it should be read: Polish with its diacritics, Japanese in romaji. */
  word: string;
  /**
   * Japanese in its own script, so romaji is not the only thing a learner ever
   * sees. Empty for Polish.
   */
  script: string;
  /**
   * The dictionary form, when the word asked about was an inflection of it —
   * Polish `jestem` carries `być`. Empty when the word is already its own
   * lemma, and always for Japanese.
   */
  lemma: string;
  /**
   * Where it sits in its language's frequency list, commonest first. On the
   * wire because the board has no list to look it up in, and it is the one
   * number that says how much the clue was worth knowing: `#12` is a word you
   * cannot get through a sentence without, `#870` is one you are learning.
   */
  rank: number;
}

/** One clue, from the moment it is asked to the moment it is answered. */
export interface VocabRound {
  /**
   * The clue: what the word means, in English, as the list gives it.
   *
   * The only thing on this object during `asking` — everything below it is
   * either the answer or a record of how the round went, and the answer is
   * what the race is for. See `view()` in the reducer.
   */
  clue: string;
  /** Null for the whole of `asking`, on every client. The server always has it. */
  answer: VocabAnswer | null;
  /** Seat that took the point, or null if the clock beat everybody. */
  winner: number | null;
  /**
   * What the winner actually typed, as they typed it.
   *
   * Kept because it is often not the answer: `zolty` takes the point for
   * **żółty** and `kohii` for `koohii`, and a review screen that showed only
   * the canonical spelling would hide the moment a player got there without
   * the accents. Empty when nobody won.
   */
  said: string;
  /** How long the winner took, in milliseconds out of `ROUND_MS`. */
  ms: number;
  /**
   * Seats that guessed a real word with the wrong meaning, in the order they
   * did it. They are out for the rest of the round — see `canAct` — so this is
   * both the record and the gate.
   */
  missed: number[];
}

export interface VocabState {
  phase: VocabPhase;
  /** Null until the host chooses. One language for the room, not per seat. */
  lang: VocabLang | null;
  mode: VocabMode;
  /** One per seat, in seat order. */
  scores: number[];
  /** The clue on the table, being asked or just revealed. Null during setup. */
  round: VocabRound | null;
  /** Settled rounds, oldest first — the review at the end reads this. */
  history: VocabRound[];
  /**
   * The ranks this game will ask about, shuffled, dealt once at setup.
   *
   * **Redacted to an empty array by `view()`**, and it has to be: it is the
   * whole rest of the game in order, and a client holding it alongside a copy
   * of the word list — which anyone can download — would know every answer
   * before it was asked. It is the same secret Wheel of Fortune's puzzle bank
   * is, in a different shape.
   */
  deck: number[];
  /** How far into the deck the game has read. Harmless on its own. */
  drawn: number;
  /** What the current phase ends at. Null only before the room is full. */
  deadline: number | null;
  /**
   * The seat that won, or null. Null throughout play, and still null after a
   * game that ran out of deck with the lead shared — see `advance`.
   */
  winner: number | null;
}

export type VocabMove =
  /** Host only, during setup. Either half may be changed as often as they like. */
  | { type: 'settings'; lang: VocabLang; mode: VocabMode }
  /** Host only: deal the first clue. */
  | { type: 'begin' }
  | { type: 'guess'; word: string };

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

/**
 * Whether `seat` may act right now.
 *
 * Written out rather than aliased to `turn(state) === seat`, because this game
 * is never strictly alternating and the contract has to be honest about which
 * kind it is. During a round every seat that has not already missed may act at
 * once — that is what a race is — and `turn` reports a single seat throughout,
 * which is why it is a hint for the status line and this is the predicate
 * every control on the board is gated on.
 *
 * Three quite different answers hide in here:
 *
 * - **setup** is the host's alone, so that a language is chosen rather than
 *   argued over;
 * - **asking** is everybody who is still in the round;
 * - **reveal** is nobody, which is the point of it. The answer is on the
 *   screen, so a guess taken during the reveal would be a guess at nothing.
 */
export function canAct(state: VocabState, seat: number, now?: number): boolean {
  if (seat < 0 || seat >= state.scores.length) return false;
  if (state.phase === 'setup') return seat === HOST;
  if (state.phase !== 'asking') return false;
  if (outOfTime(state, now)) return false;
  return state.round !== null && !state.round.missed.includes(seat);
}

/** The best score on the table. Zero for a game nobody has scored in. */
export function leadScore(state: VocabState): number {
  return state.scores.reduce((best, score) => Math.max(best, score), 0);
}

/** Every seat on the best score — one of them normally, more on a shared lead. */
export function leaders(state: VocabState): number[] {
  const best = leadScore(state);
  return state.scores.flatMap((score, seat) => (score === best ? [seat] : []));
}

/** How one seat played, over the rounds that were actually asked. */
export interface VocabSeatStat {
  seat: number;
  /** Rounds taken. The same number as their score, and the reason to read on. */
  won: number;
  /**
   * Rounds they answered wrong. The interesting half of the pair: a player who
   * took four and missed none was never really in a race, and one who took
   * four and missed nine was the reason everyone else was hurrying.
   */
  missed: number;
  /**
   * Mean time to a right answer, in milliseconds. Zero for a seat that never
   * took a round, which is not a fast player and the board must not draw it as
   * one.
   */
  ms: number;
}

export interface VocabStats {
  /** One per seat, in seat order, including seats that never scored. */
  seats: VocabSeatStat[];
  /** The fastest right answer of the game, and which round it was. */
  quickest: { round: VocabRound; at: number } | null;
  /**
   * The rounds nobody took. The review list worth reading twice — these are
   * the words the whole table did not know, which is the closest this game
   * comes to telling you what to study.
   */
  missedByAll: VocabRound[];
}

/**
 * The end-of-game reckoning, computed from the history rather than tallied as
 * the game runs.
 *
 * Derived, so there is nothing on the state that can drift out of step with
 * the rounds it is meant to describe — and the board is the only thing that
 * ever wants it, which is why it lives on this side of the boundary.
 */
export function vocabStats(state: VocabState): VocabStats {
  const rounds = state.round === null ? state.history : [...state.history, state.round];
  const settled = rounds.filter((round) => round.answer !== null);

  const seats: VocabSeatStat[] = state.scores.map((_, seat) => {
    const taken = settled.filter((round) => round.winner === seat);
    return {
      seat,
      won: taken.length,
      missed: settled.filter((round) => round.missed.includes(seat)).length,
      ms: taken.length === 0
        ? 0
        : taken.reduce((total, round) => total + round.ms, 0) / taken.length,
    };
  });

  let quickest: { round: VocabRound; at: number } | null = null;
  settled.forEach((round, i) => {
    if (round.winner === null) return;
    if (quickest === null || round.ms < quickest.round.ms) quickest = { round, at: i + 1 };
  });

  return {
    seats,
    quickest,
    missedByAll: settled.filter((round) => round.winner === null),
  };
}
