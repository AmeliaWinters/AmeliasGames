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

import type { StudyLists } from '../profile.js';

/**
 * The two languages you can learn.
 *
 * English is missing on purpose and it is the one real cut in this game. The
 * clue is an English meaning, so learning English would mean cluing an English
 * word with an English description, and there are no English descriptions in
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
 * to the first thousand. A real difference rather than a labelled one: the top
 * hundred of any language is the vocabulary you cannot avoid knowing, and the
 * words between five hundred and a thousand are the ones a learner is actually
 * in the middle of.
 *
 * One setting for the room rather than one per player. A race decides who was
 * first, and two players racing at different depths are not racing.
 */
export type VocabMode = 'normal' | 'hard' | 'phrases';

export const VOCAB_MODES: readonly VocabMode[] = ['normal', 'hard', 'phrases'];

/**
 * How many phrases the phrase deck holds. See `vocabPhrases.ts`.
 *
 * Here rather than there because it is a cap on a deck dealt before the
 * language is known, so the reducer needs it and the reducer may not reach the
 * data. `vocab.test.ts` pins the two together, which is the only thing keeping
 * this number honest.
 */
export const PHRASE_COUNT = 45;

/**
 * How deep into the list a mode reads. A rank cap, and for `phrases` a cap
 * over a different list entirely.
 *
 * The one place the three modes stop being the same kind of thing: `normal`
 * and `hard` are depths into one frequency-ordered corpus, where `phrases` is
 * a corpus of its own with forty-five entries in it. Everything downstream
 * still just filters the dealt deck against this number, which is why the
 * third mode cost the reducer one parameter rather than a second code path.
 */
export const MODE_CAP: Record<VocabMode, number> = {
  normal: 100,
  hard: 1000,
  phrases: PHRASE_COUNT,
};

export const MODE_NAME: Record<VocabMode, string> = {
  normal: 'Normal',
  hard: 'Hard',
  phrases: 'Phrases',
};

/**
 * What the room is playing, in three words, wherever the setting is repeated
 * back: the setup screen, the round header, the status line, the review.
 *
 * A string rather than the `top ${MODE_CAP[mode]}` those four places used to
 * build for themselves, because that sentence is only true of two of the three
 * modes now. "Top 45" would be a lie about a list that is not ordered by
 * frequency at all, and the one thing every one of those lines is for is
 * telling a player what they are about to be asked.
 */
export const MODE_LABEL: Record<VocabMode, string> = {
  normal: 'top 100',
  hard: 'top 1,000',
  phrases: 'everyday phrases',
};

/**
 * Whether a mode asks for whole sentences rather than single words.
 *
 * One predicate rather than `mode === 'phrases'` scattered over three files,
 * and the name is the question each of those places is actually asking: it
 * decides which corpus a clue is drawn from, what a typed answer is checked
 * against, whether a rarity rank means anything, and whether the board draws
 * one.
 */
export function isPhrases(mode: VocabMode): boolean {
  return mode === 'phrases';
}

/**
 * How many points a player has to bank to win.
 *
 * A hundred, and the number is chosen against `roundPoints` rather than picked
 * for roundness: a typical right answer on normal is worth eight to fifteen,
 * so this is a game of ten to fifteen rounds for whoever is winning it and
 * rather more for whoever is not. That is the same twenty minutes the old
 * first-to-five was, spent on three times as many words.
 *
 * A total rather than a count of rounds, because a round no longer hands out
 * one point to one person: everybody still in it scores, and what they score is
 * the whole balance of this game. See `roundPoints`.
 */
export const TARGET = 100;

/**
 * The longest a round can be open, which is also the beginner's whole window.
 *
 * Thirty seconds is well past the point where the answer is going to arrive.
 * Either the word is in your head, in which case this is a typing contest
 * decided in three seconds, or it is not, and no amount of staring produces
 * it.
 *
 * A round rarely runs the full thirty, and that is deliberate: it ends the
 * moment every seat is done, and a seat is done when it has answered, been
 * wrong, given up, or run out of the window its level allows. Somebody who
 * knows they do not know it presses "give up" and the table moves on. The
 * clock is the backstop for the seat that just sits there, see `roundDeadline`.
 */
export const ROUND_MS = 30 * 1000;

/**
 * How long the answer stays on the screen before the next clue.
 *
 * This is the entire point of the game and the reason it is a phase of its own
 * rather than a line above the next clue. Being wrong, or being beaten, is the
 * moment the word sticks, and a round that rolled straight into the next one
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
 * Zero, whoever opened the room, the same seat `RoomEngine.start` already
 * requires to deal the game. Making it a room-wide setting meant somebody had
 * to own it, and eight people fighting over a language menu is worse than one
 * person choosing.
 */
export const HOST = 0;

/**
 * How much of the language a seat says it already has.
 *
 * Self-declared, per seat, and the only per-seat setting in a game that is
 * otherwise one language and one difficulty for the room, because it is not a
 * setting about the *question*, which has to stay identical for a race to mean
 * anything. It is a setting about when you are allowed to answer it.
 *
 * The problem it exists for is the one that made this game unplayable in a
 * mixed room: a fluent speaker and someone three weeks in are not racing, they
 * are watching one person type. The fluent player has the word before the clue
 * has finished rendering, so every round used to end before the learner had
 * read it, and five rounds later the learner had seen ten words and answered
 * none. A game that hands the beginner nothing is not a hard game, it is a
 * demonstration.
 *
 * **The fix is not a head start, and it used to be.** Holding the fluent
 * player's box shut for six seconds worked, in the sense that the learner got a
 * look at the clue, but it bought that by giving one player six seconds of
 * nothing to do every round, and it still ended the round the instant the
 * expert typed, so the learner half way through spelling it got the same
 * nothing as before, only later. What replaced it costs nobody a dead second:
 * the round stays open for everybody, so being beaten to a word no longer means
 * being shut out of it, and a level buys two things instead, how long your own
 * window is and what your answers are worth. The expert answers first, out of a
 * shorter window, for half the points. The learner answers slowly, out of the
 * full thirty, for all of them.
 *
 * Three bands rather than a slider: the honest answer is coarse, and a number
 * invites haggling over half-seconds in a room of eight people trying to
 * start.
 */
export type VocabLevel = 'new' | 'some' | 'fluent';

export const VOCAB_LEVELS: readonly VocabLevel[] = ['new', 'some', 'fluent'];

export const LEVEL_NAME: Record<VocabLevel, string> = {
  new: 'Just starting',
  some: 'Getting there',
  fluent: 'I speak it',
};

/**
 * How long a seat's own window is open, counted from the clue going up.
 *
 * The first half of the handicap, and it is a deadline rather than a delay:
 * everybody may type from the first millisecond, the expert simply has less of
 * the round to do it in. Nobody ever sits watching a dead box.
 *
 * Calibrated against what the two players are actually doing. Somebody who
 * knows the word is typing it (read the clue, type four letters, about two
 * seconds) so fifteen is not a constraint they will often feel, and it is not
 * meant to be: it is the point past which they have plainly forgotten it and
 * the learner should have the table to themselves. Somebody learning has to
 * recall the word and then spell it in an orthography they are not fluent in,
 * eight to ten seconds *when they know it*, and that is the case worth
 * protecting. Thirty leaves them room to be slow and still arrive.
 */
export const LEVEL_WINDOW_MS: Record<VocabLevel, number> = {
  new: ROUND_MS,
  some: 22 * 1000,
  fluent: 15 * 1000,
};

/**
 * What a seat's right answers are worth, as a fraction.
 *
 * The second half of the handicap, and the half that does the real work. A
 * shorter window alone would not have been enough: fifteen seconds is still
 * more than a fluent speaker needs, so it costs them almost nothing and the
 * learner goes on losing every exchange. Halving the points is what makes a
 * slow right answer from somebody three weeks in worth more than a fast one
 * from somebody who grew up with the language, the entire thing this game was
 * failing to do.
 *
 * It reads harsher than it plays, because speed multiplies too: an expert
 * answering in two seconds of fifteen keeps most of the speed bonus and lands
 * around 0.9 of a word's rarity against the learner's 1.6. Roughly two rounds of
 * theirs to three of the learner's: a real gap, and one the expert closes every
 * time the learner does not know the word at all and scores nothing.
 */
export const LEVEL_SCALE: Record<VocabLevel, number> = {
  new: 1,
  some: 0.75,
  fluent: 0.5,
};

/**
 * What a seat starts at before anybody says otherwise.
 *
 * The middle, not the bottom. A room where nobody touches this is a room of
 * people roughly matched, and the middle treats them all identically, same
 * window and same scale, so the handicap only shows up once somebody says they
 * are different. A default of `new` would make the setting a thing you must
 * remember to claim, and the person who forgets is the one it was for.
 */
export const DEFAULT_LEVEL: VocabLevel = 'some';

/**
 * What a word is worth before speed and level are applied: five points per
 * decade of its frequency rank.
 *
 * Rank 1-9 scores 5, the rest of the top hundred 10, the rest of the top
 * thousand 15. Logarithmic because word frequency is: the gap between the 5th
 * commonest word and the 50th is the same *kind* of gap as between the 50th and
 * the 500th, and a linear scale would make the top hundred, which is all of
 * normal mode, worth indistinguishably little.
 *
 * The bands are coarse on purpose. This number is announced to the table at
 * the end of every round, and "10 for a top-hundred word" is a rule somebody
 * can hold in their head, where `9.4` is a number they can only take on trust.
 */
export const RARITY_STEP = 5;

/**
 * What a phrase is worth, since it has no frequency to be rare by.
 *
 * A phrase's `rank` is its position in a hand-written list, so running it
 * through the decades would pay 5 for the first nine phrases and 10 for the
 * rest, a difference that means nothing: *dzień dobry* is not four times
 * commoner than *ile to kosztuje?*, it was just written down earlier. A flat
 * rate is the honest reading of a list that has no order to speak of.
 *
 * Ten, which is what the top hundred pays, because that is the comparison a
 * player will make. A phrase is more to type and more to remember than a word
 * from the top hundred, and rather less than one from the deep end of hard, so
 * it sits where it sits. Speed, level, `pick` and hints all still multiply.
 */
export const PHRASE_RARITY = RARITY_STEP * 2;

/**
 * The most speed can multiply a word's rarity by.
 *
 * Two, running down to one as your own window closes: an instant answer is
 * worth double, an answer landing as your box shuts is worth the rarity alone.
 * Measured against *your* window rather than the round's, so the bonus is not a
 * second handicap: the expert's two seconds out of fifteen and the learner's
 * four out of thirty both read as "answered early", which is the thing being
 * rewarded. See `roundPoints`.
 */
export const SPEED_BONUS = 1;

/**
 * What a recognition round is worth against a production one.
 *
 * Half, because it is half the question. Choosing "to sleep" from four options
 * is a one-in-four guess at worst and a flicker of recall at best, where
 * typing the word from the meaning alone is the thing this game exists to
 * teach. Paying both the same would make the easy round the efficient one and
 * quietly turn a vocabulary game into a tapping game.
 *
 * It is not meant to make a `pick` round feel like a punishment, and it does
 * not: rarity and speed still multiply, so a quick answer on a rare word still
 * lands ahead of a slow one on a common word either way round. What the half
 * buys is that nobody wins a game on the easy third of it.
 */
export const PICK_SCALE = 0.5;

/**
 * How many hints a seat gets for a whole game.
 *
 * Three, and they do not come back, which is the entire mechanic: a hint is
 * worth having, so the decision is *when*, and a decision is the thing a round
 * of this game did not previously contain. Before this there were two things a
 * player could do with a clue they did not know -- stare at it, or press "I
 * don't know it" -- and neither of them is playing. Three across a fifteen-round
 * game is few enough that spending one is a real call and enough that nobody
 * hoards all three to the end.
 *
 * A hint shows the first letter and the length, and that pairing is chosen for
 * what it does to memory rather than for how much it gives away. First letter
 * plus length is the cue that resolves a word already on the tip of the
 * tongue, so a hinted round is one where the player did the retrieval
 * themselves and arrived -- which is what makes a word stick -- rather than
 * reading it off the reveal, which is not.
 */
export const HINT_ALLOWANCE = 3;

/**
 * What spending one costs: half, the same shape as the level scale.
 *
 * A hinted answer has to be plainly worth having and plainly worth less than
 * the same answer unhinted, or the choice is not a choice. Half does both, and
 * it stacks with everything else multiplicatively, so it never turns a right
 * answer into nothing -- `roundPoints` floors at one.
 */
export const HINT_SCALE = 0.5;

/**
 * The deepest rank any deck reaches, which is hard mode's cap.
 *
 * The deck is dealt once, at setup, as a shuffled run of ranks, *before* the
 * language and the difficulty are known, because the only place this game is
 * handed an rng is `setup` and `applyMove` and neither `expire` nor the tick
 * that drives the reveal into the next round has one. Dealing the deepest
 * possible deck up front and filtering it against the cap when a round is drawn
 * is what makes every later round decidable with no randomness at all.
 */
export const DECK_DEPTH = Math.max(MODE_CAP.hard, MODE_CAP.phrases);

/**
 * Which way round a clue is asked.
 *
 * `say` is the game as it was: an English meaning goes up and you type the
 * word. That is *production*, the hard direction, and it is the direction
 * worth practising -- but it is also the one where a learner who cannot reach
 * the word has nothing to do at all. A blank box for fifteen seconds is not a
 * question, it is a wait, and a game whose every round is that has one
 * exercise in it repeated until somebody reaches a hundred.
 *
 * `pick` is the other direction: the word goes up, in its own script where it
 * has one, and four English meanings are offered. *Recognition*, which is
 * where somebody three weeks in actually lives, and a round they can always
 * play even on a word they could not have produced.
 *
 * Both are the same shared clue, the same word asked of the whole table at
 * once, because that is the rule this game is built on and the one that killed
 * per-player languages and per-seat depth before it. Nothing here is per seat.
 */
export type VocabAsk = 'say' | 'pick';

/**
 * How often the question turns around: every third round is a `pick`.
 *
 * Third rather than second, because production is what the game is for and
 * recognition is the breather. It has to be a rhythm rather than a coin toss:
 * the round-to-round progression runs through `expire`, which is never handed
 * an rng (see `DECK_DEPTH`), so which kind of round comes next has to be a
 * function of how many have already been asked and nothing else.
 *
 * Round one is therefore always a `say`, which is the game the setup screen
 * has just described.
 */
export const PICK_EVERY = 3;

/**
 * How many meanings a `pick` round offers.
 *
 * Four: one right and three wrong, which puts a blind guess at one in four.
 * That is the number the half-points in `PICK_SCALE` is priced against, so the
 * two move together -- six options would be a harder question worth more, and
 * three would be worth less than the round costs to sit through.
 *
 * It is also as many as fits. The options are English glosses of common words
 * and several of them run to three or four words, so four rows of readable type
 * is what a phone has room for under a word held large enough to read.
 */
export const PICK_OPTIONS = 4;

/** Which way round the round at `index` is asked, counting from zero. */
export function askAt(index: number): VocabAsk {
  return (index + 1) % PICK_EVERY === 0 ? 'pick' : 'say';
}

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
}

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
  /** Which direction this round is asked in. See `VocabAsk`. */
  ask: VocabAsk;
  /**
   * The four meanings offered on a `pick` round, in the order they are drawn.
   * Empty on a `say` round.
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
   * Who has bought a hint on this clue, and what they were shown. At most one
   * per seat, and empty on a `pick` round, where there is nothing to hint at.
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
   * nobody else, during setup only. See `holdMs` for what it buys.
   *
   * Public, deliberately. It decides when a rival may start typing, so hiding
   * it would make the pauses in a round unreadable: a player watching an
   * opponent sit still for six seconds should know that is the handicap and
   * not a slow connection.
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
 * Absolute rather than relative to the table, which is the opposite of how the
 * old hold worked and is the simpler rule: your window is your window, and a
 * room of four fluent speakers is one where everybody gets fifteen seconds and
 * everything is worth half. Still a fair game between them, because a handicap
 * applied identically to everyone cancels out of the result. There is nothing
 * to normalise.
 */
export function windowMs(state: VocabState, seat: number): number {
  if (seat < 0 || seat >= state.scores.length) return 0;
  return LEVEL_WINDOW_MS[levelOf(state, seat)];
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
 * The last window still open and no later, so a round ends the moment the
 * slowest seat still typing runs out rather than always burning the full thirty
 * seconds because one beginner is in the room. Every seat that finishes pulls
 * this in, which is what makes "give up" worth pressing: it is the fastest way
 * to the next word.
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
 * allowance left, this seat must not already have hinted this round (a second
 * would only re-show the first), and the round has to be a `say`. That last one
 * is the rule worth naming -- the first letter of a word already printed on the
 * screen is not information, and selling it would be charging somebody half
 * their points for nothing.
 *
 * Deliberately *not* folded into `canAct`. They answer different questions and
 * the board needs both at once: a seat that may hint is by definition still
 * able to answer, so the two controls are live together and gated separately.
 */
export function canHint(state: VocabState, seat: number, now?: number): boolean {
  if (!canAct(state, seat, now)) return false;
  if (state.phase !== 'asking' || state.round === null) return false;
  if (state.round.ask !== 'say') return false;
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
 *   raced. It is measured against the player's *own* window, so it is not the
 *   handicap applied twice;
 * - **level** is the handicap, and it is applied last so it scales everything
 *   the round could have been worth rather than some fixed part of it.
 *
 * Two more terms multiply on the end of those three, and both are discounts
 * for a question that was easier than the full one:
 *
 * - **which way round it was asked** (`PICK_SCALE`), because choosing a meaning
 *   from four is not producing a word from nothing;
 * - **whether they bought a hint** (`HINT_SCALE`), which is the price of the
 *   decision the hint exists to create.
 *
 * All five are multiplied rather than added, so nothing here can be gamed by
 * stacking: a hinted answer on a recognition round is a quarter of what the
 * same word would have paid typed cold, which is the honest ratio.
 *
 * Rounded to a whole number, and never below one: a right answer that scored
 * nothing would read as a bug, and the seat that answered a very common word
 * at the very edge of a halved window has still answered it. That floor is
 * doing more work now than it was -- a common word, hinted, picked, late, in a
 * fluent seat's window prices out below one and still pays it.
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
    LEVEL_SCALE[levelOf(state, seat)] *
    (ask === 'pick' ? PICK_SCALE : 1) *
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
 *   where that promise is kept;
 * - **reveal** is nobody, which is the point of it. The answer is on the
 *   screen, so a guess taken during the reveal would be a guess at nothing.
 */
export function canAct(state: VocabState, seat: number, now?: number): boolean {
  if (seat < 0 || seat >= state.scores.length) return false;
  if (state.phase === 'setup') return true;
  if (state.phase !== 'asking') return false;
  if (state.round === null) return false;
  if (outOfTime(state, now)) return false;
  // A window that has run out is checked separately from the round's clock:
  // on a mixed table the expert's closes first, and it closes for them alone.
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
