/**
 * The numbers Vocab Race is tuned by: the languages, the three difficulties,
 * the clocks, the three self-reported levels and everything a right answer is
 * multiplied by.
 *
 * Split off `vocabDisplay.ts` because this is the file you read to find out
 * what the game *is*, and it was buried under four hundred lines of shapes and
 * a hundred derivations. Nothing in here takes a `VocabState`: these are the
 * rules, not questions about a game in progress. Two that looked like
 * constants and were not -- `autoHinted` and `levelScale`, both of which ask a
 * state what level a seat is -- stayed behind with the derivations.
 *
 * Everything here is still re-exported from `vocabDisplay.ts`, which is the
 * name every board and the reducer import. That is deliberate: the boundary
 * comment there is load-bearing (the word lists must not reach the browser)
 * and it is worth having one door rather than three.
 */
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
export const PHRASE_COUNT = 130;

/**
 * How deep into the list a mode reads. A rank cap, and for `phrases` a cap
 * over a different list entirely.
 *
 * The one place the three modes stop being the same kind of thing: `normal`
 * and `hard` are depths into one frequency-ordered corpus, where `phrases` is
 * a corpus of its own with a hundred and thirty entries in it. Everything downstream
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
 * nothing as before, only later. What replaced *that* was a shorter window and
 * halved points for the fluent seat, and it worked on the scoreline while being
 * a bad deal to be on either end of: the expert was told their answers were
 * worth less for being right, the learner was told theirs counted double for
 * being slow, and the two of them were answering the same question with
 * different arithmetic behind it. A handicap you can read off a multiplier is
 * one nobody believes they earned.
 *
 * **So a level buys the question, and, since 2026-08-29, half the points on
 * top of it** (`LEVEL_SCALE`). The clock half of the old handicap is still
 * gone and is not coming back: every seat gets the same thirty seconds. What a
 * level mostly decides
 * is how often the word comes at you as four meanings to choose between
 * (`pick`) and how often as a blank box (`say`). A beginner is mostly
 * recognising and occasionally producing; somebody fluent is producing every
 * round -- a `pick` is half the points (`PICK_SCALE`) and much the easier
 * question, so most of the handicap still arrives as a *thing on your screen*
 * rather than as a discount applied to you, and it is the thing the game is
 * teaching either way. See `LEVEL_ASKS`. The declared discount rides on top
 * because questions alone were not closing the gap; `LEVEL_SCALE` carries that
 * argument.
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
 * What mix of questions a seat gets, as a cycle read by round number.
 *
 * Most of the handicap, and the reason `LEVEL_WINDOW_MS` is gone
 * (`LEVEL_SCALE` came back; the clock did not). Cycled rather than sampled because the
 * round-to-round progression runs through `expire`, which is never handed an
 * rng (see `DECK_DEPTH`), so which kind of question a seat gets has to be a
 * function of how many rounds have been filed and nothing else.
 *
 * The densities are the argument:
 *
 * - **new** is half recognition, a quarter listening, a quarter production.
 *   Recognition is where somebody three weeks in actually lives, and a blank
 *   box they cannot fill is not a question, it is a wait. The one `say` is the
 *   point: a beginner who never types never learns to produce, and one round in
 *   four is often enough to be worth reaching for and rare enough not to be a
 *   wall.
 * - **some** is two production rounds and a listening one. Production is the
 *   game, with a breather in it, and this is the rhythm the whole table used to
 *   get, which is why it is the default.
 * - **fluent** is production and listening, no `pick` at all. Offering four
 *   English meanings under a *printed* word to somebody who grew up with the
 *   language is not a question. Offering them under a *spoken* one still is,
 *   which is the only reason this level has a choosing round at all.
 *
 * **Every level hears the language, and that is the point of `hear` being here
 * rather than bolted onto the beginner cycle.** Before it, a player could win
 * this game without the words ever having had a sound: everything was glosses
 * and spelling, and for Japanese the spelling was romaji, which is a way of
 * writing a sound nobody writes that way. A learner who can only read is half
 * taught.
 *
 * They start on different feet on purpose. A beginner's first round is a
 * `pick`, so the first thing they ever see is a question they can answer;
 * everybody else opens on a `say`, which is the game the setup screen has just
 * described. Nobody opens on a `hear`, because the first round is the one
 * where a table finds out whether the audio works at all, and finding that out
 * on a question that has been silently redrawn (see `HEAR_SCALE`) is worse than
 * finding it out on round three.
 */
export const LEVEL_ASKS: Record<VocabLevel, readonly VocabAsk[]> = {
  new: ['pick', 'hear', 'say', 'pick'],
  some: ['say', 'say', 'hear'],
  fluent: ['say', 'say', 'hear'],
};

/** Which way round the round at `index` is asked of a seat at `level`. */
export function askFor(level: VocabLevel, index: number): VocabAsk {
  const cycle = LEVEL_ASKS[level];
  return cycle[index % cycle.length];
}

/**
 * How long after the clue goes up a beginner is shown the hint they did not
 * buy.
 *
 * Five seconds, and only on a `say` round for a seat that said it was just
 * starting. That seat gets one typed round in four (see `LEVEL_ASKS`), and it
 * is the round most likely to be five seconds of staring followed by a pass --
 * which teaches nothing and is the exact failure the `pick` rounds exist to
 * prevent. First letter plus length is the cue that resolves a word on the tip
 * of the tongue, so handing it over turns a dead round into a retrieval the
 * player completes themselves.
 *
 * **Free means free**: it costs no allowance and it does not scale the points.
 * A discount would make the beginner's one typed round in four worth half,
 * which is the multiplier this design just finished removing. It is a floor
 * under the round, not a purchase, so `hinted` stays false and
 * `HINT_ALLOWANCE` is untouched.
 *
 * Five rather than ten because the round is thirty seconds long and the point
 * is to leave time to *use* it. Somebody who knows the word has already typed
 * it by five and never sees this.
 */
export const FREE_HINT_MS = 5 * 1000;


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
 * What a listening round is worth: three quarters.
 *
 * Between the two on purpose, because the question is between the two. A
 * `hear` round offers the same four meanings a `pick` does, so the floor is the
 * same one-in-four guess and it cannot be worth a full production round. But
 * the thing being asked is harder in the way that matters: the word arrives as
 * a sound with no spelling under it, so recognising it means having heard it
 * before rather than having read it, and a learner who can match `koohii` to
 * "coffee" on the page may have no idea at all what it sounds like.
 *
 * Three quarters rather than a full point also keeps the ordering honest for a
 * fluent seat, whose cycle is two `say`s and a `hear`: their listening round is
 * genuinely the easy one of the three and should not pay like the hard ones.
 *
 * **A `hear` the board could not speak still pays three quarters**, and that is
 * deliberate. A device with no voice for the language draws the word instead,
 * which makes it a plain `pick` worth `PICK_SCALE`, and pricing that difference
 * would mean the server scoring a round by what a client claimed its speech
 * engine could do. The overpay is one eighth of one round on a phone that could
 * not ask the question properly; the alternative is a scoring rule a client can
 * lie to. See the board's `speak`.
 */
export const HEAR_SCALE = 0.75;

/**
 * What a seat that declared itself fluent multiplies a right answer by: half.
 *
 * Asked for directly, and it puts back a term this design had removed on the
 * argument that a handicap you can read off a multiplier is one nobody
 * believes they earned. That argument is still in `VocabLevel` and still
 * true of the *old* shape, which halved the expert and shortened their clock
 * as well; what is here is only the points half of it, on top of `LEVEL_ASKS`
 * rather than instead of it. The expert still gets thirty seconds and still
 * gets the harder question -- what changes is only what the harder question
 * pays them.
 *
 * It is a scale on the seat rather than on the question, which is exactly what
 * `roundPoints` says the other three terms are not, so it is the one term here
 * a player can feel aimed at them. That is the trade: a fluent speaker and
 * somebody three weeks in were still finishing a hundred-point game a long way
 * apart on questions alone, and a scoreline nobody can stay in is worse than a
 * multiplier they can see.
 *
 * Only the fluent band. `some` pays full, because the middle seat is the one
 * this could quietly punish for honesty -- somebody who says "getting there"
 * should never wish they had said "just starting".
 */
export const LEVEL_SCALE: Record<VocabLevel, number> = {
  new: 1,
  some: 1,
  fluent: 0.5,
};


/** What an ask multiplies a right answer by. See `PICK_SCALE` and `HEAR_SCALE`. */
export function askScale(ask: VocabAsk): number {
  if (ask === 'hear') return HEAR_SCALE;
  return ask === 'pick' ? PICK_SCALE : 1;
}

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
 * Both are the same shared clue -- the same word, drawn once, asked of the
 * whole table at once -- and that is the rule this game is built on, the one
 * that killed per-player languages and per-seat depth before it. **Which way
 * round it is asked is the one thing that is per seat**, and it is the
 * exception that keeps the rule: the word does not change, only the shape of
 * the box you answer it in, so a beginner picking and an expert typing are
 * still racing on the same clue and their scores are still comparable. A
 * per-seat *word* would not be a race at all.
 */
export type VocabAsk = 'say' | 'pick' | 'hear';

/**
 * Whether an ask is answered by choosing a meaning rather than typing a word.
 *
 * `pick` and `hear` are the same question wearing two faces: four English
 * meanings, one of them right, answered by index. They differ only in what the
 * board draws above the options, the word printed or the word spoken, and that
 * is a display concern from top to bottom. Everything in the reducer that used
 * to test `ask === 'pick'` means *this* instead, and the two that genuinely
 * mean printed-word-only (the redaction of `word` in `view`, and the copy)
 * still say `pick`.
 *
 * A function rather than an inline `||` because getting it wrong in one of the
 * five places is a silent leak or a silent refusal, and neither shows up as a
 * type error.
 */
export function choosing(ask: VocabAsk): boolean {
  return ask === 'pick' || ask === 'hear';
}

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
