/**
 * The parts of Word Chain the board is allowed to know.
 *
 * Same boundary as `wordleDisplay.ts` and `wordHuntDisplay.ts`, and for the
 * same reason, only more so: this game's three word lists are the second
 * largest thing in the repo after `words.ts`, and they exist to validate a
 * move, which happens on the server. One convenience import in
 * `WordChainBoard.tsx` would put thirty thousand Polish inflections and twelve
 * thousand Japanese entries on the phone of everyone who opens the lobby.
 * `bundle.test.ts` holds that line.
 *
 * The only thing it imports is another leaf that imports nothing itself. The
 * rule is not "no imports" but "nothing that reaches a reducer".
 *
 * There is deliberately no folding or letter logic here. The board never needs
 * to work out what a word must start with, because the server puts the answer
 * in `required`, which is also what stops the board and the reducer ever
 * disagreeing about whose turn it is to say a word beginning with A.
 *
 * `wordChain.ts` re-exports everything here, so the reducer and its tests still
 * import from one place.
 */

export { clockCall, formatClock } from '../clock.js';

export type ChainLang = 'en' | 'pl' | 'ja';

export const LANGS: readonly ChainLang[] = ['en', 'pl', 'ja'];

/**
 * How the chain links one word to the next.
 *
 * `loose` links on the folded letter, which is the only thing that works
 * across languages: a Polish word ending in `ś` has to hand an English or
 * Japanese player something they can answer, and it hands them an `s`.
 *
 * `strict` links on the letter as written, accents and all, and is what a game
 * gets when both players chose the same language: nobody to strand, so no
 * reason to flatten it. A Polish setting in practice, since English and
 * Japanese have no accented forms between them.
 */
export type ChainMode = 'loose' | 'strict';

/** What to call each language, and what to call a word in it. */
export const LANG_NAME: Record<ChainLang, string> = {
  en: 'English',
  pl: 'Polish',
  ja: 'Japanese',
};

/**
 * How many words each language's list holds.
 *
 * Here so the end-of-game stats can say where a word sat *within its own
 * language*, the only comparable thing to say about it: English holds fifty
 * thousand words and Japanese twelve, so `#4,000` is ordinary in one and
 * obscure in the other, and a table putting the two players' mean ranks side by
 * side would report the size of the lists rather than how they played.
 *
 * Three integers rather than a count taken from the lists, because the board
 * needs them and the board must never reach a word list (see the note at the
 * top of this file). `wordChain.test.ts` holds them against `chainListSizes()`,
 * so a rebuild that changes a list fails there rather than quietly skewing a
 * percentage.
 */
export const LIST_SIZE: Record<ChainLang, number> = { en: 50_003, pl: 62_669, ja: 12_000 };

/**
 * The shortest word the game will take, in every language.
 *
 * Three, not two, and for the same reason in all three: two-letter words are
 * function words. Polish `to`, `na`, `za`; Japanese single mora like `no` and
 * `ga`; English `of`, `an`. They are the commonest words in each language, so
 * an unbounded chain becomes two players trading particles. The lists are built
 * to this limit too, so a word this short is not merely refused, it is not in
 * the dictionary at all. The constant is here for the copy that explains the
 * refusal.
 */
export const MIN_LENGTH = 3;

/**
 * The fewest unsaid words a letter has to have behind it before the game will
 * hand it to anybody.
 *
 * "There is one" and "you could think of one" are different questions. The
 * lists come from subtitle corpora, so the thinnest letters are answerable
 * only by whatever proper nouns wandered in: Polish X is *Xavier* and nothing
 * else, Polish Y is four American place names, Polish V is fourteen Dutch
 * surnames, English X is three. Being handed one of those is losing to the
 * dictionary rather than to your own vocabulary, which is not a game.
 *
 * Per language, because the three lists are not the same size and are not
 * distributed the same way. Sorted, the whole-list counts below two hundred
 * run
 *
 *     ja L 0   ja Q 0   ja X 0   pl X 1   ja V 2   en X 3   pl Q 3
 *     pl Y 4   pl V 14  | en Z 50  en Q 93 | ja W 103  en Y 109
 *     ja E 152  ja U 156  ja Z 167  pl E 189
 *
 * English sits at forty, which clears its one dead letter and keeps Z (50) and
 * Q (93). Thin, but *zebra* and *question* are words anybody can find, and a
 * bar high enough to take them would be the game refusing letters on the
 * player's behalf. Polish and Japanese sit at a hundred: comfortable in Polish,
 * where the next letter up is E at 189, and deliberate rather than comfortable
 * in Japanese, where W at 103 clears it by three words. If a rebuild moves
 * Japanese W, this number is the thing to look at, and `wordChain.test.ts`
 * fails loudly rather than quietly dropping the letter.
 *
 * It is a floor on what is *left*, not on the letter, so it tightens as a long
 * game eats a thin one: English Z starts at fifty and stops being handable once
 * eleven Z words have been said. That is right, since the last few words
 * starting with Z are no easier to find than the only one.
 *
 * It does the second half of its job in `strict` mode, where it is the whole of
 * "given they're possible": five of the nine Polish accented letters (ą, ę, ń,
 * ó, ź) begin no Polish word at all, so a word ending in one of them is
 * refused, while ł, ś and ż, which begin hundreds, are handed over happily.
 */
export const MIN_ANSWERS: Record<ChainLang, number> = { en: 40, pl: 100, ja: 100 };

/**
 * How long a player has to produce a word, and how long the two of them have
 * to choose their languages.
 *
 * A minute is the whole game: running out of it is the only way to lose, so
 * this number is not a stall-breaker bolted onto the rules the way Word Duel's
 * is, it *is* the rule. Sixty seconds is long enough that a word you know will
 * surface and short enough that one you don't will not.
 *
 * It is the *opening* minute, not every minute: the clock tightens as the
 * chain grows, so a turn's real allowance is `turnMsFor(said)` and nothing but
 * setup should reach for this constant on its own.
 *
 * Setup gets the same minute for a duller reason: a player who never picks a
 * language would otherwise hang the room forever. Nobody loses to it, see
 * `expire` in the reducer, which defaults the undecided to English and starts
 * the game rather than ending it.
 */
export const TURN_MS = 60 * 1000;

/**
 * How many words the chain grows by before the answer gets a second shorter,
 * and how much shorter.
 *
 * Every word, and a whole second: the chain is what the pace is tied to, and
 * tying it this tightly is what makes a long game feel like one. The minute is
 * halved by word thirty and gone by word fifty-five, so a chain that runs past
 * fifty is being played in five-second turns by two people who have stopped
 * having time to think.
 *
 * It used to be a second every three words, which put the floor at a hundred
 * and fifty and meant almost nobody ever played against it. Now a game of any
 * length finishes.
 */
export const TURN_STEP_WORDS = 1;
export const TURN_STEP_MS = 1000;

/**
 * The floor the minute never goes under.
 *
 * Five seconds is enough to type a word that is already in your head and not
 * much more, which is the ending the ramp is walking towards: past here the
 * game has stopped asking what you know and started asking what you can reach
 * for. Reached at 55 words (see `turnMsFor`), which two good players will hit
 * in most games, so unlike most floors this one gets played against rather than
 * staying theoretical.
 *
 * It is a floor on the *clock* and not on the game: nothing else changes down
 * here, and a five-second turn is still a turn you can win, since a
 * three-letter word scores three points and three points is sometimes the
 * difference.
 */
export const MIN_TURN_MS = 5 * 1000;

/**
 * How long a player gets to answer, given how many words are already chained.
 *
 * A pure function of the chain length rather than a countdown kept on the
 * state, so that every turn's allowance can be recovered afterwards from
 * nothing but the word's place in the chain: the end screen has to say a word
 * arrived "with four seconds left", and by then the deadline it beat is long
 * overwritten. `said` is the number of words *behind* the player, so the
 * opener and the two answers after it get the full minute and the fourth word
 * is the first one to feel it.
 *
 * Setup does not use this; the language menu always gets the full minute. See
 * `TURN_MS`.
 */
export function turnMsFor(said: number): number {
  const steps = Math.floor(Math.max(0, said) / TURN_STEP_WORDS);
  return Math.max(MIN_TURN_MS, TURN_MS - steps * TURN_STEP_MS);
}

/**
 * How much of the language a seat says they have, chosen once during setup.
 *
 * Word Chain's clock is the same for everybody and stays that way: a level
 * here buys **help finding a word**, not time and not points. A minute of
 * failing to think of anything is what this game is built around (see the note
 * at the top of `wordChain.ts`), and that minute teaches a fluent player
 * something and teaches somebody three weeks in nothing at all: they are not
 * failing to retrieve a word, they have not got one to retrieve. So a beginner
 * is walked towards the word the reveal was going to show them anyway, a step
 * at a time, while there is still a turn left to use it in.
 *
 * Three bands rather than a slider, and the same three the vocabulary game
 * asks for, worded the same way, because a player who has answered this
 * question on one setup screen should recognise it on the other. They are
 * separate types on purpose: this one decides a hint ladder and `VocabLevel`
 * decides which way a question is asked, and a shared union would be one
 * import away from a change to one game quietly retuning the other.
 */
export type ChainLevel = 'new' | 'some' | 'fluent';

export const CHAIN_LEVELS: readonly ChainLevel[] = ['new', 'some', 'fluent'];

export const LEVEL_NAME: Record<ChainLevel, string> = {
  new: 'Just starting',
  some: 'Getting there',
  fluent: 'I speak it',
};

/**
 * The level a seat plays at when nobody said otherwise.
 *
 * The middle band, so a seat that never touched the control, and a game
 * restored from before this existed, play the game much as it played before:
 * the `some` ladder does not open until thirty-five seconds, by which point
 * most turns are over.
 */
export const CHAIN_DEFAULT_LEVEL: ChainLevel = 'some';

/**
 * When each hint arrives, in milliseconds from the start of the seat's turn.
 *
 * Twenty and forty for a beginner. Twenty is long enough that anybody who had
 * the word has already typed it, and it leaves forty seconds of a full minute
 * to use what the hint hands over, which is the whole point: a hint that lands
 * with three seconds left is a spoiler, not a hint. The second rung exists
 * because a meaning on its own is often not enough in a language you cannot
 * yet spell in.
 *
 * Thirty-five and fifty for the middle band: the same ladder, late enough that
 * it only ever fires on a turn that was already going badly. Nothing at all
 * for a fluent seat, who came for the reveal, and for whom an answer at twenty
 * seconds would be the game playing the turn for them.
 *
 * Read against the allowance *that turn* had rather than against the minute,
 * so the ladder simply stops firing as the chain grows and the clock shrinks
 * past it (see `turnMsFor`). A five-second turn near the end of a long chain
 * gets no hints at any level, which is right: there is no time to spend on one.
 */
export const HINT_AT: Record<ChainLevel, readonly number[]> = {
  new: [20 * 1000, 40 * 1000],
  some: [35 * 1000, 50 * 1000],
  fluent: [],
};

/** What `seat` said they were, defaulting for a seat that never said. */
export function levelOf(state: WcState, seat: number): ChainLevel {
  return state.levels?.[seat] ?? CHAIN_DEFAULT_LEVEL;
}

/**
 * The word the seat on the clock is being walked towards, and nothing about
 * how far along they are: see `hintsFor` for that.
 *
 * The *same* word `revealFor` would show them had the minute gone: same
 * language, same cooldowns, same review list. That is deliberate. The hint and
 * the reveal are one claim, "this is what you could have said", and a game that
 * hinted at one word and then revealed another would read as the game changing
 * its mind about the answer.
 *
 * Recomputed by the server whenever a seat is handed the clock, and blanked for
 * the other seat by `view`. Null for a fluent seat, for a seat whose language
 * has nothing behind the letter, and throughout setup.
 */
export interface ChainHint {
  /** Whose turn this belongs to. Never anybody else's, see `view`. */
  seat: number;
  /** The word itself, as written. Never sent whole to the screen: see `chainHintSteps`. */
  word: string;
  /** Its meaning, or '' where the list has none. English has none at all. */
  gloss: string;
}

/** One rung of the ladder: what it says, and what kind of help it is. */
export interface ChainHintStep {
  kind: 'meaning' | 'shape';
  text: string;
}

/**
 * A word with everything but its first two letters taken out: `lozko` as
 * `lo___`, and the accented `lozko` as it is written, `lo` plus three blanks.
 *
 * Two letters rather than one because one of them is the letter the chain just
 * asked for, which the player is already staring at: a hint that repeats the
 * question is not a hint. The blanks are the other half of it, length being the
 * cue that most often finishes the retrieval on its own.
 *
 * Counted in code points, like `wordPoints`, so a five-letter Polish word masks
 * to three blanks and not to five.
 */
export function maskWord(word: string): string {
  const letters = [...word];
  return letters.slice(0, 2).join('') + '_'.repeat(Math.max(0, letters.length - 2));
}

/**
 * The rungs of the ladder for a hint, in the order they are handed over.
 *
 * Meaning first, shape second: the meaning is the cue that lets a player
 * produce the word themselves, which is the retrieval worth having, and the
 * shape is the fallback for when it did not.
 *
 * A rung with nothing to say is not offered rather than padded out, which in
 * practice means **English gets one hint and it is the shape one**: the English
 * list carries no glosses (see `commonestStarting`), so there is no meaning to
 * show. Better than a first rung that says nothing, and better than pushing the
 * shape hint out to forty seconds for the player the ladder exists to help.
 */
export function chainHintSteps(hint: ChainHint): ChainHintStep[] {
  const steps: ChainHintStep[] = [];
  if (hint.gloss) steps.push({ kind: 'meaning', text: hint.gloss });
  steps.push({ kind: 'shape', text: maskWord(hint.word) });
  return steps;
}

/**
 * Which rungs `seat` has earned as of `now`, oldest first.
 *
 * Empty for everybody but the seat on the clock, which is also the only seat
 * holding a hint at all. Time is read back off the deadline rather than kept as
 * a start time, the same bargain `tookUntil` makes in the reducer: the deadline
 * is the number the whole game already agrees on, and a second field recording
 * when the turn began could drift from it.
 */
export function hintsFor(state: WcState, seat: number, now: number): ChainHintStep[] {
  const hint = state.hint;
  if (!hint || hint.seat !== seat || state.deadline === null) return [];
  if (state.phase !== 'playing' && state.phase !== 'chase') return [];
  const gone = turnMsFor(state.chain.length) - Math.max(0, state.deadline - now);
  const at = HINT_AT[levelOf(state, seat)];
  return chainHintSteps(hint).filter((_step, i) => at[i] !== undefined && gone >= at[i]);
}

/**
 * What a word is worth: a point a letter.
 *
 * The one rule the players can do arithmetic on mid-turn, which is the whole
 * reason it is not a curve. A seven-letter word is worth seven, a three-letter
 * word is worth three, and a player who is four points behind knows exactly
 * what they are looking for. Anything superlinear, letters squared or a bonus
 * past six, says the same thing about which words are better and says it in a
 * number nobody can check while a five-second clock is running.
 *
 * Counted in code points, so `żółty` is five letters and not eight. The score
 * is taken from `word` rather than `key`, because `key` is the folded form
 * and folding drops the very letters this is meant to be counting.
 *
 * Note what this does to the chase: the two seats have said the same number of
 * words when one of them falls out, give or take one, so the scores are close
 * and the chase is decided by a couple of good words rather than by a second
 * game. Deliberate, see `ChainMiss`.
 */
export function wordPoints(word: string): number {
  return [...word].length;
}

/** One word in the chain, as the board should draw it. */
export interface ChainLink {
  /**
   * The word as it should be *read*: Polish with its diacritics back on,
   * Japanese in romaji, English as typed. Not what the game compares, see
   * `key`.
   */
  word: string;
  /**
   * The folded form the game actually reasons about: lower case, ASCII, Polish
   * diacritics flattened, Japanese romanisation variants collapsed. It is on
   * the wire because the board underlines the letter that carries to the next
   * word, and that letter is this string's last one, not `word`'s: `ręką` hands
   * on an `a`.
   */
  key: string;
  lang: ChainLang;
  /** Who said it. */
  seat: number;
  /** English meaning, or empty when the list has none for this word. */
  gloss: string;
  /**
   * Japanese in its own script, so the romaji is not the only thing a learner
   * ever sees. Empty for the other two languages.
   */
  script: string;
  /**
   * The dictionary form, when the word played was an inflection of it: Polish
   * `jestem` carries `być`. Empty when the word is already its own lemma, and
   * for the languages where the distinction does not arise.
   */
  lemma: string;
  /**
   * How long the player took over it, in milliseconds, out of the minute they
   * had. Zero on the reveal, which nobody played.
   *
   * Recorded rather than derived, because it cannot be recovered later: the
   * clock is a single `deadline` the next word overwrites, so a turn not
   * measured as it ends is gone. It is most of what the end-of-game stats are
   * made of: a mean answer time is the one number here about the players rather
   * than about the words they happened to know.
   */
  ms: number;
  /**
   * Where the word sits in its language's frequency list, commonest first and
   * counting from one: `#742` under the word on the board, which is how a
   * player finds out the word they reached for is the four hundredth commonest
   * thing anyone says.
   *
   * On the wire because the board has no list to look it up in, and a rank
   * within a language rather than across them: the Japanese list holds twelve
   * thousand words to English's twenty-five, so the same number is rarer in
   * English. The board shows the language beside it, as much as a bare number
   * can honestly carry.
   */
  rank: number;
  /**
   * Whether a hint was on the screen when this word was typed.
   *
   * Recorded rather than derived, for the same reason as `ms`: it is a fact
   * about the moment the word was said, and the clock it would have to be
   * recovered from is a single `deadline` the next word overwrites.
   *
   * It exists because `record` grades the chain afterwards and has no other
   * way to tell a word somebody knew from a word the ladder handed them. A
   * hinted word banked as `produced` promotes the card up the Leitner ladder
   * past `HINTED_CEILING`, and `answerFor` deliberately hints at a word the
   * seat already owes a review on, so it is exactly the card that must not be
   * promoted on a hint. Vocab Race has always graded this `hinted`; this is
   * the field that lets Word Chain agree with it.
   *
   * Optional because a room stored before it existed has links without it, and
   * absent reads the same as false: an old snapshot grades as it always did.
   */
  hinted?: boolean;
}

/**
 * Fewer answers than this behind a letter and handing it over costs the full
 * `MAX_LOCK` turns. At or above it, handing it over is free.
 *
 * Counted the way `MIN_ANSWERS` is, and against the same number: words in the
 * *answering* seat's language that start with the letter and are still unsaid.
 * The two bars are the same rule at two strengths. Under `MIN_ANSWERS` the
 * word is refused outright, because the next player would be losing to the
 * dictionary; between there and here it is allowed but you may not do it again
 * for a while, because the next player can answer it but not five times over.
 *
 * One number for all three languages, which is a real cost: the Japanese list
 * is a third the size of the English one, so five hundred catches most of its
 * alphabet where it catches three letters of English. Chosen anyway, because
 * "five hundred words" is a claim about how much room the other player has and
 * that does not change with which list they drew from.
 */
export const THIN_START = 500;

/** The longest an ending is ever out of reach, in the seat's own turns. */
export const MAX_LOCK = 5;

/**
 * How long handing a letter over locks it, given how many words the seat who
 * has to answer it can still start with. See `countStarting`.
 *
 * Flat: under `THIN_START` it is the full five of your own turns, at or above
 * it there is no lock at all. No ramp, because the rule has to be sayable at
 * the moment it bites ("you just did that, not again for five") and a sliding
 * price is a number the player has to be told rather than one they already
 * know.
 *
 * The count that decides it is the one this ending is *worth taxing* for. An
 * earlier version priced it off `countEnding`, how many words end on the
 * letter, which measured the wrong side of the exchange and made the rule a
 * no-op in exactly the case it was written for: 3,987 English words end in
 * *-y* and only 228 begin with one, so ending on Y -- the classic way to hand
 * somebody nothing -- was free, every time, forever. The harm is to whoever
 * has to start on the letter, so the pool that is counted is theirs.
 *
 * It replaced a per-seat ladder before that, which charged one turn for the
 * first *-y*, two for the second and up with no ceiling. The ladder was fair
 * and nobody could track it: every letter carried its own private count,
 * invisible until a word was refused. The pool in front of a letter is a fact
 * about the list rather than about your history with it, so both players see
 * the same number and the board can price a word before it is submitted.
 */
export function lockTurns(startsLeft: number): number {
  return startsLeft < THIN_START ? MAX_LOCK : 0;
}

/**
 * One letter a seat may not end a word on yet, and when it comes back.
 *
 * Ending a word puts that letter out of *your* reach for a few of your turns,
 * priced by how many words in your language still end on it: see `lockTurns`
 * for the price and why it is that and not a ladder. Only letters that cost
 * something are stored, so an entry here is always a lock that was real when
 * it was written.
 *
 * Per seat and per letter. Your own ending is what is charged, not the
 * chain's: your opponent's fondness for Y is their problem, and taxing you for
 * it would feel arbitrary from the inside.
 */
export interface LetterCooldown {
  /**
   * The letter as the chain links on it: folded in a `loose` game, accented in
   * a `strict` one, exactly like `required`. The board shows it as it stands
   * and never has to fold anything.
   */
  letter: string;
  /**
   * The seat's own word count at which the letter frees up: locked while
   * `saidBy(state, seat) < until`. Counted in the seat's *own* turns rather
   * than the chain's, so "locked for two turns" means two chances to say a
   * word, not two words going past on the screen.
   *
   * Stored as a deadline rather than a countdown for the same reason the clock
   * is: nothing has to remember to decrement it, and a state restored from a
   * snapshot cannot come back with the tick already spent.
   */
  until: number;
}

/**
 * The folded lemmas `seat` is due to review in `lang`. Empty when there are
 * none, when the list is not this seat's to see, or when the state predates
 * study lists entirely.
 *
 * That last case is the reason this is a function rather than two subscripts.
 * `study` is a required field on a state the server deals, but a room restored
 * from storage may have been dealt before the field existed, and the shape of
 * a persisted state is what `SNAPSHOT_VERSION` covers. A bump deletes every
 * live room on deploy, and it would be buying nothing here: the *meaning* of
 * everything already stored is unchanged, and a chain that comes back without
 * a study list simply reveals what it would have revealed before, which is the
 * game as it played last week. So the absent case is read rather than
 * versioned away, and it is read in one place.
 */
export function studyFor(state: WcState, seat: number, lang: ChainLang): readonly string[] {
  return state.study?.[seat]?.[lang] ?? [];
}

/** How many words `seat` has contributed to the chain. */
export function saidBy(state: WcState, seat: number): number {
  return state.chain.reduce((n, link) => (link.seat === seat ? n + 1 : n), 0);
}

/**
 * What `seat` has scored: a point for every letter of every word they said.
 *
 * Read off the chain rather than kept as a running total on the state, for the
 * same reason the turn's allowance is read off `chain.length`: the chain is
 * the record of the game, and a second copy of a number derivable from it is a
 * second thing that can disagree with it. It is also what makes the chase
 * honest, since the target is recomputed from the chain every time anybody
 * asks and there is no stored score to go stale while the chaser plays on.
 */
export function scoreFor(state: WcState, seat: number): number {
  return state.chain.reduce((n, link) => (link.seat === seat ? n + wordPoints(link.word) : n), 0);
}

/** One locked letter, as the board draws it. */
export interface ActiveCooldown {
  letter: string;
  /** How many of this seat's turns it stays locked, including this one. */
  turns: number;
}

/**
 * The letters `seat` may not end on right now, soonest back first.
 *
 * Empty when the seat's cooldowns have been redacted, see `view` in the
 * reducer, which shows a seat only its own. Deliberately indistinguishable from
 * having none: a player who could tell the difference would know their opponent
 * was carrying a lock without knowing which, which is worse than knowing
 * nothing.
 */
export function lockedFor(state: WcState, seat: number): ActiveCooldown[] {
  const said = saidBy(state, seat);
  return (state.cooldowns[seat] ?? [])
    .flatMap((cool) =>
      cool.until > said ? [{ letter: cool.letter, turns: cool.until - said }] : [],
    )
    .sort((a, b) => a.turns - b.turns || a.letter.localeCompare(b.letter));
}


/**
 * `chase` is the phase that stops a lost minute from being the end of it.
 *
 * When a seat's clock goes they are out of the chain, but their score stands,
 * and the other player carries the chain on alone until they have beaten it.
 * See `ChainMiss` for why, and `isFinished` for what ends it.
 */
export type WcPhase = 'setup' | 'playing' | 'chase' | 'over';

/**
 * A minute somebody lost, and the word they could have said.
 *
 * There are at most two of these and they are the shape of the whole endgame.
 * The first is the seat that fell out of the chain: the clock beat them, or
 * they said so themselves. That used to end the game. It no longer does,
 * because losing a minute is not losing the game: their points are on the
 * board, and the other player has to actually go past them.
 *
 * So the game goes to `chase`. The seat still in it answers the letter their
 * opponent could not, alone, under the same shrinking clock and the same
 * cooldowns, until their score is *strictly* higher, which wins it, or until
 * their own minute goes, which is the second miss and the end. A chaser who
 * runs out level has not beaten anything, so the seat that fell out first takes
 * the tie. The one asymmetry in the rule, and the right way round: they set the
 * target, and a target you drew with is a target you did not beat.
 *
 * The chase is skipped when there is nothing to chase, meaning the survivor was
 * already ahead when the first minute went, because a player cannot beat a
 * score they have already beaten and making them say one more word for it would
 * be the game asking for a formality.
 *
 * Each miss keeps its own reveal, so both are on the end screen. The reveal is
 * the reason to play this game at all, and a chase that ends in a second
 * reveal must not overwrite the first: two players who each lost a minute have
 * each got a word to learn out of it.
 */
export interface ChainMiss {
  /** Whose minute it was. */
  seat: number;
  /** Whether they said so themselves rather than running the clock down. */
  gaveUp: boolean;
  /**
   * The commonest word in their language that would have worked, filtered by
   * their own cooldowns. Null in the vanishingly rare case there is none.
   */
  reveal: ChainLink | null;
}

/** The seat that fell out of the chain first, or null while both are in it. */
export function stoppedSeat(state: WcState): number | null {
  return state.misses[0]?.seat ?? null;
}

/**
 * What the seat still playing has to pass, or null when nobody is chasing.
 *
 * Not stored on the miss, though it would fit there: the seat that fell out
 * says no more words, so `scoreFor` on the chain already answers this and
 * cannot drift from it. See `scoreFor`.
 */
export function targetScore(state: WcState): number | null {
  const stopped = stoppedSeat(state);
  return stopped === null ? null : scoreFor(state, stopped);
}

/**
 * Whether `seat` has done enough to win outright: strictly past the target.
 *
 * Strictly, because the target was set by somebody who lost a minute over it
 * and a draw does not take that back. It is asked of the state *after* a word
 * is appended, which is why it takes a seat rather than reading `at`.
 */
export function hasBeaten(state: WcState, seat: number): boolean {
  const target = targetScore(state);
  return target !== null && scoreFor(state, seat) > target;
}

/**
 * The folded lemmas one seat is due to review, by language.
 *
 * All three languages rather than the one they are playing, because a seat
 * picks its language *during* the setup phase and the state is dealt before
 * that: there is no language to filter by at the moment this arrives. See
 * `WcState.study`.
 *
 * Structurally the `StudyLists` of `profile.ts`, and spelled out here
 * instead of imported for the reason that file spells out its own languages
 * rather than importing this one: a display module may not reach a reducer,
 * a profile outlives the games that fill it, and the two lists are held
 * against each other by `profile.test.ts`.
 */
export type ChainStudy = Partial<Record<ChainLang, string[]>>;

export interface WcState {
  phase: WcPhase;
  /** Each seat's language, or null while they are still choosing. */
  langs: (ChainLang | null)[];
  /**
   * How much of the language each seat says they have, in seat order. See
   * `ChainLevel`, and `HINT_AT` for the whole of what it buys.
   *
   * Public, like `langs`: it decides when hints land on somebody's screen and
   * a player is entitled to know why their opponent got one. Optional on the
   * type for one reason only, a room stored before this field existed, which
   * `levelOf` reads as the default band.
   */
  levels?: ChainLevel[];
  /**
   * How the chain links, decided once when play begins and never after: two
   * players who chose the same language get `strict`, everyone else `loose`.
   *
   * Derivable from `langs`, and stored anyway, because the board has to say
   * which game it is before the first word is played and the two must never
   * disagree about it mid-chain. `false` throughout setup.
   */
  strict: boolean;
  /** Oldest first. The last link is the one being answered. */
  chain: ChainLink[];
  /**
   * Each seat's ending-letter cooldowns, in seat order. See `LetterCooldown`.
   *
   * A seat is only ever sent its own: `view` in the reducer blanks the other,
   * and an empty list is what "none" and "not shown to you" both look like.
   * Kept on the state rather than derived from `chain` because in a `strict`
   * game the letter a word hands on is the last of its *accented* key, and only
   * the folded `key` is on the wire. Deriving it on the board would have `coś`
   * charged against `s`.
   */
  cooldowns: LetterCooldown[][];
  /**
   * The folded lemmas each seat is due to review, in seat order, as their
   * profile stood when the game was dealt. Empty for a guest, for anybody with
   * nothing due, and for every room whose adapter could not reach a profile
   * store.
   *
   * Read in exactly one place, `revealFor` in the reducer, where it decides
   * *which* word a player who lost a minute is shown: the commonest one they
   * already owe a review on, rather than the commonest one full stop. It
   * changes nothing else about the game and it is not a rule: a state with
   * this empty is the game as it played before the ledger existed.
   *
   * A seat is only ever sent its own, and by the same argument the cooldowns
   * are: `view` blanks the other, and an empty list is what "nothing due" and
   * "not shown to you" both look like. It is the player's own vocabulary, and
   * an opponent who could read it would know which words to spend the chain
   * walking towards.
   */
  study: ChainStudy[];
  /** The seat the game is waiting on. Meaningless once `phase` is `over`. */
  at: number;
  /**
   * The letter the next word must start with, or '' for the opening word,
   * which is free. Computed by the server from the last link so nothing else
   * has to know how folding works, and in a `strict` game it can be an accented
   * one, `ł` or `ś` or `ż`, which the board shows as it stands.
   */
  required: string;
  /**
   * How many words the seat on the clock could still legally say: unsaid words
   * in their language starting with `required`, or the whole of their language
   * before the first word. Null while nobody is on the clock.
   *
   * The server counts it because only the server has the lists. The board shows
   * the number and never derives it, the same bargain as `required`. Symmetric
   * information: both players see the same count, and it is the count for
   * whoever is thinking, not for whoever is reading it.
   */
  available: number | null;
  /**
   * The word the seat on the clock is being walked towards, or null when
   * nobody is being walked anywhere. See `ChainHint`.
   *
   * Recomputed by the server every time the clock changes hands, because it is
   * an answer to *this* letter and stale by the next word. Sent only to the
   * seat it belongs to (`view` blanks it), which is a stronger rule than the
   * one on `cooldowns`: this is the answer to the turn in progress, and an
   * opponent who could read it would know the letter their rival was about to
   * hand back.
   */
  hint: ChainHint | null;
  /** When the current minute runs out, or null before the game is on a clock. */
  deadline: number | null;
  /**
   * The seat that lost, or null until the game is over.
   *
   * Which is later than it used to be. Losing a minute puts a seat out of the
   * chain and into `misses`; losing the *game* takes the chase as well, so
   * this stays null right through it. Set once, when `phase` becomes `over`,
   * and always the seat with the lower score. See `ChainMiss` for the tie.
   */
  loser: number | null;
  /**
   * The minutes that went, oldest first: at most one during `chase`, at most
   * two ever. Empty while both players are still in the chain.
   *
   * Both are kept, and both are shown, because each carries the word its owner
   * could have said and that reveal is the reason the lists are ordered by
   * frequency at all. A player who lost a minute has a word to learn out of
   * it, whether or not they went on to win the game.
   */
  misses: ChainMiss[];
}

export type WcMove =
  | { type: 'lang'; lang: ChainLang }
  /** Setup only, and in practice before `lang`: see the reducer's `level` branch. */
  | { type: 'level'; level: ChainLevel }
  | { type: 'say'; word: string }
  /** Only from the seat on the clock, and only once play has started. */
  | { type: 'give-up' };

export function isFinished(state: WcState): boolean {
  return state.phase === 'over';
}

/**
 * The miss belonging to `seat`, if they lost a minute at some point.
 *
 * The board asks this rather than indexing `misses`, because that array is
 * chronological and what the screen wants is "did this player miss, and what
 * were they shown": two different questions a `[0]` would quietly conflate.
 */
export function missFor(state: WcState, seat: number): ChainMiss | null {
  return state.misses.find((miss) => miss.seat === seat) ?? null;
}

/** Whether the clock has run out as of `now`. False when there is no clock. */
export function outOfTime(state: WcState, now: number | undefined): boolean {
  return state.deadline !== null && now !== undefined && now >= state.deadline;
}

/** How much of the minute is left, for the countdown. */
export function msLeftFor(state: WcState, now: number): number {
  return state.deadline === null ? 0 : Math.max(0, state.deadline - now);
}

/**
 * Whether `seat` may act right now.
 *
 * Written out rather than aliased to `turn(state) === seat`, because this game
 * is only *sometimes* strictly alternating and the contract has to be honest
 * about which kind it is. During setup both players choose at once and neither
 * is waiting on the other, so two seats can act; once play starts exactly one
 * can. `turn` reports a single seat throughout, which is why it is a hint for
 * the status line and this is the predicate every control is gated on.
 */
export function canAct(state: WcState, seat: number, now?: number): boolean {
  if (seat < 0 || seat >= state.langs.length) return false;
  if (state.phase === 'setup') return state.langs[seat] === null;
  if (state.phase === 'over') return false;
  // `chase` falls through to the same answer as `playing`: exactly one seat is
  // on the clock, and `at` is it. That it is now the same seat every turn is
  // the chase's business and not this predicate's.
  return state.at === seat && !outOfTime(state, now);
}

/**
 * How one seat played, averaged over the words they said.
 *
 * Averages rather than totals throughout, because the two seats do not get the
 * same number of turns (the loser has had one more than the winner) and a total
 * would make "went second" look like a difference in play.
 */
export interface SeatStat {
  seat: number;
  lang: ChainLang | null;
  /** How many words this seat contributed. Zero seats are not worth drawing. */
  said: number;
  /** Mean length in letters, counted in code points so `ż` is one letter. */
  letters: number;
  /**
   * What they scored: a point a letter, totalled. See `wordPoints`.
   *
   * The one total in a table of averages, and it has to be, because it is the
   * thing the game was decided on. The averages beside it are there so a seat
   * that got fewer turns is not read as having played worse; this one is the
   * result and is not being averaged away.
   */
  points: number;
  /**
   * Mean position in the seat's own list, as a fraction: 0.04 is "top 4% of
   * the language". Comparable between seats in a way a mean rank is not, see
   * `LIST_SIZE`. Lower is commoner, so a *higher* number is the rarer player.
   */
  percentile: number;
  /** Mean time taken, in milliseconds out of the minute. */
  ms: number;
}

/** A single word worth pointing at, and where in the chain it was. */
export interface ChainHighlight {
  link: ChainLink;
  /** Which word of the chain it was, counting from one. */
  turn: number;
}

export interface ChainStats {
  /** One per seat, in seat order, including seats that never said anything. */
  seats: SeatStat[];
  /** The word left latest: the one that nearly ran the clock out. */
  closest: ChainHighlight | null;
  /** The word furthest down its own language's list. */
  rarest: ChainHighlight | null;
  /** The word with the most letters, which is the same as the most points. */
  longest: ChainHighlight | null;
}

/** Where a word sits in its own list, as a fraction. Lower is commoner. */
function depth(link: ChainLink): number {
  return link.rank / LIST_SIZE[link.lang];
}

/**
 * What the chain says about the two of them, worked out at the end.
 *
 * Pure, and here rather than in the board, because it is easy to get quietly
 * wrong: a mean over the wrong denominator, a "rarest" that is really "rarest
 * in the biggest list", none of it visible by looking at the screen.
 * `wordChain.test.ts` holds it.
 *
 * Every superlative keeps the *earliest* word on a tie, so the same chain
 * always reports the same moment. Two words of six letters is not a reason for
 * the end screen to pick one at random.
 */
export function chainStats(state: WcState): ChainStats {
  const seats: SeatStat[] = state.langs.map((lang, seat) => {
    const said = state.chain.filter((link) => link.seat === seat);
    const mean = (of: (link: ChainLink) => number): number =>
      said.length === 0 ? 0 : said.reduce((total, link) => total + of(link), 0) / said.length;
    return {
      seat,
      lang,
      said: said.length,
      // The same number, meant twice: a word's length is its score, so the
      // mean of it is how they played and the sum of it is how they did.
      letters: mean((link) => wordPoints(link.word)),
      points: scoreFor(state, seat),
      percentile: mean(depth),
      ms: mean((link) => link.ms),
    };
  });

  let closest: ChainHighlight | null = null;
  let rarest: ChainHighlight | null = null;
  let longest: ChainHighlight | null = null;
  state.chain.forEach((link, i) => {
    const here = { link, turn: i + 1 };
    if (closest === null || link.ms > closest.link.ms) closest = here;
    if (rarest === null || depth(link) > depth(rarest.link)) rarest = here;
    if (longest === null || wordPoints(link.word) > wordPoints(longest.link.word)) longest = here;
  });

  return { seats, closest, rarest, longest };
}

/** Every word already said, folded, so a repeat can be spotted in one lookup. */
export function usedKeys(state: WcState): Set<string> {
  return new Set(state.chain.map((link) => link.key));
}
