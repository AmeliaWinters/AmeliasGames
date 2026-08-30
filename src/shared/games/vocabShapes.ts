/**
 * What a Vocab Race round, try, hint, answer and state are made of.
 *
 * The shapes and nothing else, plus the two counts that only make sense beside
 * the shape they bound (`RETRY_AFTER`, `ALSO_SHOWN`). Split off
 * `vocabDisplay.ts` so that the question "what is on a round?" is answered by
 * one screenful rather than by scrolling past the scoring table.
 *
 * `VocabState` is persisted, so anything added here is a snapshot question --
 * see `SNAPSHOT_VERSION` in `room.ts` before changing a field's meaning.
 *
 * Re-exported from `vocabDisplay.ts` along with the rules; import from there.
 */
import type { StudyLists } from '../profile.js';
import type { VocabAsk, VocabLang, VocabLevel, VocabMode } from './vocabRules.js';

export type VocabPhase = 'setup' | 'asking' | 'reveal' | 'over';

/**
 * A clue the table missed, and the round it is allowed back at.
 *
 * See `RETRY_AFTER` for the timing and `settle` in the reducer for what puts
 * one here.
 */
export interface VocabRetry {
  /** The rank to ask again. The clue is rebuilt from it, so nothing is stored twice. */
  rank: number;
  /** The `history.length` at which it becomes eligible. */
  at: number;
}

/**
 * How many rounds later a missed clue comes back.
 *
 * Five, and the number is doing two jobs at once.
 *
 * **A word nobody got is the most valuable word in the game and the deck used
 * to throw it away.** The clue everybody missed is, by definition, the one the
 * table did not know, and the old behaviour was to show it for six seconds and
 * never mention it again. Between sessions the ledger handles that; within a
 * session, "tomorrow" is the wrong interval for a word you missed ninety
 * seconds ago, and there was nothing else.
 *
 * **Five rounds is far enough that it is a recall and not an echo.** One or two
 * would be answered off the reveal that is still on the screen behind the
 * player's eyes, which tests nothing and teaches nothing. Five is about ninety
 * seconds of other words, which is long enough that getting it right means
 * something and short enough that it is still the same sitting. It is the first
 * rung of the Leitner ladder in `review.ts` scaled down to fit inside one game.
 *
 * **It comes back as a choosing round, not a typed one.** Recognition before
 * production is the direction the ladder already believes in, and asking a
 * table to type a word they collectively could not reach twenty seconds ago is
 * asking the same question again and expecting a different answer. See
 * `retryAsks`.
 *
 * **Once only.** A round already marked `retry` is never requeued, whatever
 * happens on it. Without that a table stuck on one hard word would be asked it
 * every five rounds until the deck ran out, which is a game that gets worse the
 * worse you are doing at it.
 */
export const RETRY_AFTER = 5;

/**
 * Which way round a retried clue is asked of a seat.
 *
 * `say` only for a seat that says it is fluent, and choosing for everybody
 * else. This is the one place an ask is a function of level alone rather than
 * of level and round number, and that is the point: `LEVEL_ASKS` is a rhythm,
 * and this is an intervention.
 *
 * The fluent exception is the same argument `LEVEL_ASKS` makes: four English
 * meanings under a printed word is not a question for somebody who grew up with
 * the language, and a retry that hands them a free point is not a review, it is
 * an apology. They get the word to type, again.
 *
 * A `hear` rather than a `pick` for everybody else, when the round can be heard
 * at all: the word has already been on the screen once in this game, spelled
 * out on the reveal, so printing it again is asking the eye a question the eye
 * has answered. Asking the ear is the part that is still open.
 */
export function retryAsks(level: VocabLevel): VocabAsk {
  return level === 'fluent' ? 'say' : 'hear';
}

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
   * The dictionary form, when the word asked about was an inflection of it:
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
  /**
   * Other words in the language that would also have been accepted, commonest
   * first, at most `ALSO_SHOWN`.
   *
   * This is `accepts` made visible, and it is the only thing on the reveal that
   * the game already knew and never said. Point 3 in the reducer spends real
   * complexity being generous about synonyms -- `accepts` is every word filed
   * under any of the clue's senses -- and before this the only way a player
   * ever found that out was by accidentally typing one. A learner who answered
   * "small" with the wrong word for small was told they were wrong and shown
   * one right answer, when the game was holding three.
   *
   * Built in `vocabDictionary`, where the sense index is, and empty in phrase
   * mode, where there is no list of words to be a synonym in. Inflections of
   * the answer's own lemma are filtered out there too: `być` listing `jestem`
   * as an alternative is the dictionary talking to itself.
   *
   * **Redacted with `lemma` and `rank` on a choosing round**, and it has to be:
   * these are words meaning the same thing as the answer, so on a `pick` they
   * would narrow four options to one, and on a `hear` they would put the
   * spelling on screen and answer the question outright.
   */
  also: VocabAlso[];
}

/** One of the other words a clue would have taken. See `VocabAnswer.also`. */
export interface VocabAlso {
  /** As it should be read: Polish with its diacritics, Japanese in romaji. */
  word: string;
  /** Japanese in its own script. Empty for Polish. */
  script: string;
}

/**
 * How many alternatives the reveal prints.
 *
 * Three. The reveal is six seconds long and already carries the word, its
 * script, its rank and a payout line, and a common Polish adjective can have
 * twenty acceptable synonyms: printing them all would bury the answer under a
 * thesaurus. Three is enough to make the point that the game was generous and
 * few enough to read in the time available.
 */
export const ALSO_SHOWN = 3;

/**
 * How a seat's round ended. Everything but `right` scores nothing.
 *
 * `wrong` and `gave-up` are kept apart because they are different admissions
 * and the review is worth reading: a player who guessed and was wrong reached
 * for something, and a player who gave up knew they had nothing. `timeout` is
 * neither. It is the seat that sat there, filled in by the game rather than by
 * the player, at the moment the round settles.
 */
export type VocabHow = 'right' | 'wrong' | 'gave-up' | 'timeout';

/**
 * A hint one seat bought, and what it was shown.
 *
 * Filed on the round rather than counted on the state, because both halves are
 * read: the reveal and the end-of-game review both want to say which answers
 * were hinted, and a seat that reconnects mid-round needs the hint it already
 * paid for back on its screen.
 *
 * The two fields are secret to different degrees, and `view()` in the reducer
 * is where that is enforced. **That** a seat has taken a hint is public, the
 * same category as `how` on a running round: it is a true thing about how hard
 * the table is finding the word, and hiding it would make the payout at the end
 * of the round unreadable. **What** the hint said is private to the seat that
 * bought it, and has to be, or one player's three hints would be the whole
 * table's.
 */
export interface VocabHint {
  seat: number;
  /**
   * When it may be shown, as a server clock. `round.began` for one that was
   * bought, later for the beginner's free one. See `FREE_HINT_MS` for why the
   * board holds it rather than the server withholding it.
   */
  at: number;
  /**
   * Whether it was given rather than bought. A free one spent no allowance and
   * scales no points, so the try it belongs to is not `hinted`. Read by the
   * board, which must not offer to sell what it is about to give away.
   */
  free: boolean;
  /**
   * The word with everything but its first letter held back.
   *
   * **Blanked for every seat but its own.** See `maskWord`, and `view()` in
   * the reducer.
   */
  shown: string;
}

/**
 * What one seat did with one clue.
 *
 * A round holds one of these per seat rather than a single winner, and that is
 * the whole shape of the redesign: being beaten to a word no longer ends your
 * round, so everyone at the table has an answer of their own and a score for
 * it. The old `winner`/`said`/`ms` trio described a race with exactly one
 * result; this describes what each person actually got out of the word.
 */
export interface VocabTry {
  seat: number;
  how: VocabHow;
  /**
   * Which way round this seat was asked. On the try because it is per seat and
   * because it is what the points were priced against: the review, the stats
   * and `record`'s grading all want to know whether a word was produced or
   * recognised, and a settled round holds both kinds at once.
   */
  ask: VocabAsk;
  /**
   * What they typed, as they typed it: `zolty` for **żółty**. Empty for a seat
   * that gave up or ran out of window.
   *
   * **Redacted while the round is running**, along with `points`: a correct
   * `said` is the answer, and handing it to the seats still racing would end
   * the game. See `view()` in the reducer.
   */
  said: string;
  /** When it landed, in milliseconds after the clue went up. */
  ms: number;
  /**
   * What it scored. Zero for everything but a right answer.
   *
   * **Redacted to zero while the round is running.** Points are a function of
   * the word's rank, so a live one would narrow the answer's frequency band
   * for everybody else still typing. Read this only from a settled round.
   */
  points: number;
  /**
   * Whether they bought a hint before answering.
   *
   * On the try rather than inferred from the round's `hints`, because it is
   * what the points were priced against and the two must not be able to drift:
   * a seat that hinted and then ran out of window is still a hinted round in
   * the review, and its zero was never scaled by anything.
   */
  hinted: boolean;
}

/** One clue, from the moment it is asked to the moment the last seat is done. */
export interface VocabRound {
  /**
   * The clue: what the word means, in English, as the list gives it.
   *
   * On a `say` round this is the question, and the only thing on this object
   * during `asking`. On a `pick` round it is the *answer* -- it is the option
   * that is correct -- so it is the field that gets redacted and the word that
   * gets sent instead. Which way round it goes is `ask`, and `view()` in the
   * reducer is where both cases are handled.
   */
  clue: string;
  /**
   * Which direction this round is asked in, per seat, in seat order. See
   * `VocabAsk` and `LEVEL_ASKS`.
   *
   * Stored rather than recomputed from `levels` at every read. Levels cannot
   * change once the game starts, so the two could not drift today, but this is
   * the field a settled round in `history` is read back through months later
   * and it should say what was actually asked rather than what a constant would
   * say now. It is also what `view()` branches on, and a redaction that depends
   * on a recomputation is one bad refactor from broadcasting the answer.
   */
  asks: VocabAsk[];
  /**
   * The four meanings offered to whoever is picking, in the order they are
   * drawn. Empty on a round nobody picks.
   *
   * The correct one is `clue`, and it is in here somewhere, which is exactly
   * why `clue` cannot go out on the wire while the round is running: a board
   * holding both would be holding the answer. So a choice names an *index* into
   * this array and the reducer does the comparing. See `vocabOptions` for where
   * the other three come from and why none of them can be a synonym.
   */
  options: string[];
  /** Null for the whole of `asking`, on every client. The server always has it. */
  answer: VocabAnswer | null;
  /**
   * Who has a hint on this clue, and what it says. At most one per seat, and
   * never for a seat that is picking, where there is nothing to hint at. Most
   * are bought; a beginner's is given. See `VocabHint`.
   */
  hints: VocabHint[];
  /**
   * When the clue went up, as a server clock.
   *
   * On the state rather than read back out of `deadline`, which is how every
   * other time in this game used to be derived. That worked while the deadline
   * was fixed at `began + ROUND_MS`; it cannot survive seats having windows of
   * different lengths, because the round's deadline now *moves*: it is whatever
   * is left of the slowest seat still typing, and it comes in every time
   * somebody finishes. See `roundDeadline`. With a moving deadline there is no
   * fixed offset to subtract, so the start is recorded.
   */
  began: number;
  /**
   * What each seat did, in the order they did it. At most one per seat.
   *
   * Both the record and the gate: a seat with a try here is done for this
   * round, however it went. See `canAct`. Seats that never acted are filled in
   * as `timeout` when the round settles, so a settled round always holds exactly
   * one try per seat and the review never has a hole in it.
   */
  tries: VocabTry[];
  /**
   * Whether this clue is coming round a second time because the table missed
   * it. See `RETRY_AFTER`.
   *
   * Read three ways and they are all worth having: the board says so above the
   * clue, so a second showing is recognisably a second chance rather than the
   * game repeating itself; `settle` reads it to make sure a word is only ever
   * requeued once; and `draw` reads it to know that this one clue is allowed
   * past the already-asked filter.
   */
  retry: boolean;
}

export interface VocabState {
  phase: VocabPhase;
  /** Null until the host chooses. One language for the room, not per seat. */
  lang: VocabLang | null;
  mode: VocabMode;
  /** One per seat, in seat order. */
  scores: number[];
  /**
   * What each seat says it already knows, in seat order. Set by that seat and
   * nobody else, during setup only. See `LEVEL_ASKS` for what it buys.
   *
   * Public, deliberately. It decides what question a rival is looking at, so
   * hiding it would make the round unreadable: a player who answered in two
   * seconds was either quick or was choosing from four, and the table should
   * be able to tell which.
   */
  levels: VocabLevel[];
  /**
   * How many hints each seat has left, in seat order. See `HINT_ALLOWANCE`.
   *
   * On the state rather than counted out of the history, because it is the one
   * number in this game that spans it: a level is declared once and a score is
   * a running total, but an allowance is a thing you spend, and the whole point
   * of it is that a player can see what they have left before deciding to use
   * one. Public, for the same reason `levels` is -- an opponent hoarding three
   * of them is part of the game being read.
   */
  hints: number[];
  /** The clue on the table, being asked or just revealed. Null during setup. */
  round: VocabRound | null;
  /** Settled rounds, oldest first: the review at the end reads this. */
  history: VocabRound[];
  /**
   * The ranks this game will ask about, shuffled, dealt once at setup.
   *
   * **Redacted to an empty array by `view()`**, and it has to be: it is the
   * whole rest of the game in order, and a client holding it alongside a copy
   * of the word list, which anyone can download, would know every answer before
   * it was asked. The same secret Wheel of Fortune's puzzle bank is, in a
   * different shape.
   */
  deck: number[];
  /**
   * The words this table is due to review, merged across seats, one list per
   * language. Empty for a room of guests and for anybody with nothing due.
   *
   * Read in exactly one place, `studied` in the reducer, where it decides the
   * *order* the deck is asked in once the host has chosen a language. It
   * changes no rule: the same clues, the same scoring, the same draw. A state
   * with this empty is the game exactly as it played before the ledger
   * existed.
   *
   * **Redacted to `{}` by `view()`**, along with the deck it reorders. It is
   * nobody's business on a client — the board never needs it — and a table's
   * merged study list is still several people's vocabulary.
   */
  study: StudyLists;
  /** How far into the deck the game has read. Harmless on its own. */
  drawn: number;
  /**
   * Clues nobody got, waiting to be asked again. See `RETRY_AFTER`.
   *
   * **Redacted to an empty array by `view()`**, for the same reason the deck
   * is: it is a list of questions this game is about to ask, and a client
   * holding it beside a downloadable word list is a client that knows what is
   * coming. It leaks slightly worse than the deck does, in fact, since every
   * rank on it is one the table has already seen the answer to.
   *
   * A list rather than a single pending rank because two rounds can be missed
   * before either comes back round, and dropping one on the floor would make
   * the feature depend on how badly the table was doing.
   */
  retry: VocabRetry[];
  /** What the current phase ends at. Null only before the room is full. */
  deadline: number | null;
  /**
   * The seat that won, or null. Null throughout play, and still null after a
   * game that ran out of deck with the lead shared. See `advance`.
   */
  winner: number | null;
}

export type VocabMove =
  /** Host only, during setup. Either half may be changed as often as they like. */
  | { type: 'settings'; lang: VocabLang; mode: VocabMode }
  /** Host only: deal the first clue. */
  | { type: 'begin' }
  /**
   * Any seat, during setup, about itself. There is no seat field: a player may
   * only ever declare their own, and a move that could name a seat would be a
   * move one player could use to hold another.
   */
  | { type: 'level'; level: VocabLevel }
  /** Any seat, during a `say` round: type the word. */
  | { type: 'guess'; word: string }
  /**
   * Any seat, during a `pick` round: take the option at this index.
   *
   * An index into `round.options` rather than the meaning itself, and that is
   * a rule about secrecy rather than about convenience: the correct option is
   * `round.clue`, which is redacted while the round runs, so a board cannot
   * name the right answer even to say it is choosing it. The reducer holds both
   * halves and does the comparing.
   */
  | { type: 'choose'; option: number }
  /**
   * Any seat, during a `say` round: spend one of my three and show me the
   * shape of the word.
   *
   * The only move in this game that does not end the seat's round -- it buys
   * information and leaves you typing, which is what makes it a decision
   * rather than a slower way of giving up. Costs half the points if the answer
   * then lands. See `canHint` and `HINT_SCALE`.
   */
  | { type: 'hint' }
  /**
   * Any seat, during a round: I have nothing, move on.
   *
   * It exists because a round no longer ends when somebody wins it. The seat
   * that knows it does not know the word used to be carried along by whoever
   * did; now it would sit and watch its own window run down, so it needs a way
   * to say so, and the round ends the moment the last seat is done, which makes
   * giving up the thing that keeps the game moving rather than a forfeit.
   */
  | { type: 'pass' };
