/**
 * Word Chain's lists, indexed for the two questions Vocab Race asks: "what
 * does the Nth commonest Polish word mean?" and "does what this player typed
 * mean that?"
 *
 * No new data. The lists in `chainWords.ts` are frequency-ordered and carry an
 * English gloss on every Polish and Japanese entry, which is exactly a deck of
 * flashcards read from the other side, and the worker bundle is close enough to
 * its ceiling (see `scripts/build-wordchain.ts`) that a second copy of the same
 * vocabulary would not have fitted. This module is the hand-written half;
 * `chainDictionary.ts` is where the lists are parsed and where a typed word is
 * reduced to something comparable.
 *
 * Server-only, and here it is a secret rather than a size: whoever can resolve
 * the clue has already won the round. `bundle.test.ts` holds the line for
 * `chainWords.ts` however it is reached, so importing this from a board would
 * fail there.
 *
 * Built lazily, for the same reason the chain dictionary is: most rooms are
 * playing Connect Four.
 */
import { chainRanked, fold } from './chainDictionary.js';
import type { ChainEntry } from './chainDictionary.js';
import { phraseDeck } from './vocabPhrases.js';
import { ALSO_SHOWN, DECK_DEPTH, PICK_OPTIONS, isPhrases } from './vocabDisplay.js';
import type { VocabAlso, VocabLang, VocabMode } from './vocabDisplay.js';

/**
 * How many senses a clue is allowed to carry.
 *
 * The glosses run from one word to five or six, and a clue listing all of them
 * stops being a question: `cały` glossed "all, entire, whole; whole, entire,
 * all" tells you the shape of the dictionary rather than the meaning of the
 * word. Three is enough to disambiguate genuinely separate senses and few
 * enough that the clue still reads as a definition.
 */
const MAX_SENSES = 3;

/**
 * A sense of a word: what to print, and what to file it under.
 *
 * The two differ, and the difference matters in both directions. `być` is
 * glossed "to be", and *to be* is the clue a learner should read, since "to"
 * is how English marks an infinitive and dropping it points the clue at a noun.
 * But the same sense reached from the English side is "be", so the index has to
 * hold it stripped or a player who knows a synonym never matches.
 */
interface Sense {
  show: string;
  key: string;
}

/**
 * Everything parenthesised, gone.
 *
 * The lists use brackets for three unrelated things and none of them belong in
 * a clue: a grammatical note (`house (gen.)`), a domain hint (`account (e.g.
 * bank)`) and a disambiguation (`star (actor, athlete, etc.)`). The first is
 * noise to anybody who is not already fluent, and the other two are the
 * dictionary talking to itself. Stripping all three is cruder than reading
 * them, and it is the right crudeness: a clue that keeps them reads as a
 * lexicographer's note and a learner cannot tell which brackets they were
 * supposed to ignore.
 */
const BRACKETED = /\([^)]*\)/g;

/** What English puts in front of a word that carries no meaning of its own. */
const LEADING = /^(?:to|a|an|the)\s+/;

/**
 * A gloss, split into the senses it is actually made of.
 *
 * Semicolons separate senses and commas separate near-synonyms within one, but
 * the lists are built from six sources and do not agree about that, so both
 * are cut the same way. It costs nothing here: every fragment becomes both a
 * printed sense and an index key, and a word filed under two halves of one
 * sense is a word two reasonable answers can reach.
 *
 * A fragment survives only if it is letters and spaces. That drops the debris
 * the automatic glossing left behind (`tego=this`, the bare `-self` of a
 * reflexive marker, anything with a digit in it) and it drops single letters,
 * which are never a meaning and usually the wreckage of a stripped bracket. An
 * entry with no fragment left is not cluable, and there is nothing to be done
 * about that but skip it.
 */
function senses(gloss: string): Sense[] {
  const out: Sense[] = [];
  for (const raw of gloss.split(/[;,]/)) {
    // Case is kept for `show` and dropped only for `key`. The lists capitalise
    // deliberately and the clue is the most-read string in the game: the
    // glosses hold `I know`, `sir, Mr, gentleman`, `alright, OK` and `TV
    // dinner`, and a blanket `toLowerCase()` here turned the first of those
    // into "i know" on a screen four people were staring at. Only the index
    // wants a flattened form, and only the index gets one.
    const show = raw.replace(BRACKETED, ' ').replace(/\s+/g, ' ').trim();
    if (!/^[a-z][a-z ]*$/i.test(show) || show.length < 2) continue;
    const key = show.toLowerCase().replace(LEADING, '').trim();
    if (key.length < 2) continue;
    if (out.some((sense) => sense.key === key)) continue;
    out.push({ show, key });
  }
  return out;
}

/**
 * The other words this clue would have taken, as the reveal should print them.
 *
 * Three filters, and the second is the one that took a while to see.
 *
 * **Not the answer itself**, which is in `accepts` by construction.
 *
 * **Not another form of the same word.** `accepts` is keyed on the word, and
 * Polish files a lemma and its inflections separately: the clue for `być` would
 * otherwise list `jest`, `jestem` and `są` as alternatives, which is not three
 * other things to say, it is the same verb conjugated at a learner who is
 * trying to work out what it means. Compared on `fold(lemma || word)`, the same
 * identity the ledger files a row under, so the two agree about what counts as
 * one word.
 *
 * **Not something rarer than the game would ever ask about.** Capped at
 * `DECK_DEPTH`, because `accepts` reaches the whole sixty-four thousand and an
 * alternative nobody will meet for two years is not a useful thing to be told
 * you could have said.
 *
 * Sorted rather than taken in `accepts` order, which is per sense and so is
 * only commonest-first *within* a sense: a word with three senses would offer
 * the commonest synonym of the first one and then two rare ones, rather than
 * the three commonest it has.
 */
function alternatives(
  entry: ChainEntry,
  accepts: ReadonlySet<string>,
  byKey: ReadonlyMap<string, ChainEntry>,
): VocabAlso[] {
  const self = fold(entry.lemma || entry.word);
  const found: ChainEntry[] = [];
  for (const key of accepts) {
    if (key === entry.key) continue;
    const other = byKey.get(key);
    if (other === undefined || other.rank > DECK_DEPTH) continue;
    if (fold(other.lemma || other.word) === self) continue;
    found.push(other);
  }
  found.sort((a, b) => a.rank - b.rank);
  return found
    .slice(0, ALSO_SHOWN)
    .map((other) => ({ word: other.word, script: other.script }));
}

/** A clue and the word it points at, ready to be dealt. */
export interface VocabQuestion {
  /** The English meaning, as the clue is printed. */
  clue: string;
  word: string;
  script: string;
  lemma: string;
  rank: number;
  /**
   * Every folded word in the language that means one of the same things,
   * including the word this clue was built from. This is what a guess is marked
   * against.
   */
  accepts: ReadonlySet<string>;
  /**
   * The same generosity, made printable: up to `ALSO_SHOWN` of those words, as
   * the reveal should draw them, commonest first.
   *
   * A separate field rather than something the board derives from `accepts`,
   * because `accepts` is folded keys and holds hundreds of them, while this is
   * three display forms with their scripts. See `VocabAnswer.also`.
   */
  also: readonly VocabAlso[];
}

interface Deck {
  /** By rank, so `byRank[n]` is the question for the nth commonest word. */
  byRank: Map<number, VocabQuestion>;
  /**
   * Folded lemma -> every rank that lemma is asked at.
   *
   * The index the ledger needs, and it points the opposite way to everything
   * else in here: a profile holds folded lemmas and knows nothing about ranks,
   * while a deck is ranks and knows nothing about anybody's vocabulary. This
   * is the one place the two meet.
   *
   * A list rather than a single rank, because Polish files a lemma and its
   * inflections separately and several of them can be cluable. All of them are
   * that lemma coming round again, which is exactly what a review wants.
   */
  byStudyKey: Map<string, number[]>;
}

const decks: Partial<Record<VocabLang, Deck>> = {};

/**
 * Index a whole language, then build the questions for the part of it this
 * game can reach.
 *
 * Two passes and they are not the same depth, which is the whole trick. The
 * *index* is built over every entry in the language, sixty-four thousand Polish
 * words, because it decides what counts as a right answer and a player who
 * answers "small" with a rarer synonym than the one the clue was cut from has
 * answered the question. The *questions* are built only over the first thousand
 * ranks, because that is as deep as any difficulty asks.
 *
 * So the game is strict about what it asks and generous about what it takes,
 * which is the right way round for something being played by people who are
 * still learning the words.
 */
function build(lang: VocabLang): Deck {
  const ranked = chainRanked(lang);

  // Sense key -> every word in the language filed under it. Built first and
  // over everything, because a question's `accepts` is a lookup into it.
  const bySense = new Map<string, string[]>();
  const parsed: (Sense[] | null)[] = ranked.map((entry) => {
    if (!entry.gloss) return null;
    const found = senses(entry.gloss);
    for (const sense of found) {
      const keys = bySense.get(sense.key);
      if (keys) keys.push(entry.key);
      else bySense.set(sense.key, [entry.key]);
    }
    return found.length > 0 ? found : null;
  });

  // Folded key -> the commonest entry filed under it, over the whole language.
  // Transient: it exists only to turn the keys in `accepts` into words a reveal
  // can print, and it is dropped when this function returns, because storing a
  // sixty-four-thousand-entry index to serve three strings a round would be
  // paying for the whole dictionary to answer a footnote. `ranked` is already
  // commonest first, so the first writer of a key wins and nothing sorts.
  const byKey = new Map<string, ChainEntry>();
  for (const entry of ranked) if (!byKey.has(entry.key)) byKey.set(entry.key, entry);

  const byRank = new Map<number, VocabQuestion>();
  for (let i = 0; i < ranked.length && i < DECK_DEPTH; i++) {
    const found = parsed[i];
    if (found === null) continue;
    const entry = ranked[i];
    const shown = found.slice(0, MAX_SENSES);
    const accepts = new Set<string>([entry.key]);
    // Every sense the word has, not only the ones printed: a clue trimmed to
    // three senses is still a clue to a word that has five, and refusing an
    // answer that matches the fourth would be refusing it for running out of
    // room on the screen.
    for (const sense of found) {
      for (const key of bySense.get(sense.key) ?? []) accepts.add(key);
    }
    byRank.set(entry.rank, {
      clue: shown.map((sense) => sense.show).join(', '),
      word: entry.word,
      script: entry.script,
      lemma: entry.lemma,
      rank: entry.rank,
      accepts,
      also: alternatives(entry, accepts, byKey),
    });
  }

  // Keyed the same way the ledger keys a row: `fold(lemma || word)`, and by
  // the same `fold`. Two different foldings would file the same word under two
  // names and the whole index would silently match nothing.
  const byStudyKey = new Map<string, number[]>();
  for (const question of byRank.values()) {
    const key = fold(question.lemma || question.word);
    if (!key) continue;
    const ranks = byStudyKey.get(key);
    if (ranks) ranks.push(question.rank);
    else byStudyKey.set(key, [question.rank]);
  }

  const deck = { byRank, byStudyKey };
  decks[lang] = deck;
  return deck;
}

/**
 * Every question a mode can ask, by rank.
 *
 * The one place the phrase corpus joins the frequency one, and it joins as a
 * map of the same shape rather than as a branch threaded through the three
 * functions below. A phrase and a word are the same thing to everything
 * downstream: a clue, an answer, and the set of things that count as typing it.
 */
function deckOf(lang: VocabLang, mode: VocabMode): ReadonlyMap<number, VocabQuestion> {
  if (isPhrases(mode)) return phraseDeck(lang);
  return (decks[lang] ?? build(lang)).byRank;
}

/**
 * The question at `rank`, or null when nothing there can be clued.
 *
 * Null is ordinary rather than exceptional: roughly one Polish word in fifteen
 * inside the top thousand has a gloss with nothing printable left in it. The
 * caller deals past those, see `draw` in the reducer. In phrase mode it means
 * only that the deck has dealt a rank past the end of a much shorter list.
 */
export function vocabQuestion(
  lang: VocabLang,
  mode: VocabMode,
  rank: number,
): VocabQuestion | null {
  return deckOf(lang, mode).get(rank) ?? null;
}

/**
 * The meanings a `pick` round offers: the right one, and three that are not.
 *
 * Everything about this function is arranged around two hazards.
 *
 * **A distractor must not be a right answer.** The whole design of this game is
 * generous about what it accepts -- `accepts` is every word in the language
 * filed under any of the clue's senses, so a learner who knows a synonym is not
 * marked wrong -- and that generosity turns into an unanswerable question the
 * moment it is pointed the other way. If the word on the screen means "small"
 * and one of the four options is "little", there is no correct answer to pick,
 * and the player who reads the question properly is the one who gets it wrong.
 * So a candidate is rejected when its `accepts` and the answer's share a single
 * word: two words that any one meaning reaches are near enough synonyms for
 * this to be unfair. Comparing the printed clues is not enough, because the
 * clue is three senses of a word that may have five.
 *
 * **It must be decidable without an rng.** Rounds advance through `expire`,
 * which is never handed one, so the options cannot be shuffled -- they have to
 * be *read* from something already fixed. That something is the deck, dealt
 * once at setup, and this walks it from the far end backwards. Backwards is
 * deliberate: reading forwards would draw the distractors from the words the
 * game is about to ask next, quietly telegraphing three of them, where the far
 * end of a thousand-card deck is ranks a fifteen-round game will never reach.
 *
 * Phrase mode reads the same way and keeps the same guarantee for a different
 * reason: only forty-five of the thousand dealt ranks are phrases at all, so
 * the qualifying ones are scattered the whole length of the deck and the far
 * end is no more the next few rounds than the near end is.
 *
 * The right answer is placed at `rank % PICK_OPTIONS`, which is fixed for a
 * given word and spread evenly across the four positions over a game. A fixed
 * position would be learnable in about three rounds.
 *
 * Returns an empty array when three clean distractors cannot be found, which
 * the caller reads as "ask this one the other way round" rather than as an
 * error. It is not expected to happen at either difficulty -- the top hundred
 * alone yields ninety-odd cluable words -- but a round with two options would
 * be a worse game than a round asked as a `say`, so the fallback is the honest
 * one.
 */
export function vocabOptions(
  lang: VocabLang,
  mode: VocabMode,
  rank: number,
  cap: number,
  order: readonly number[],
): string[] {
  const deck = deckOf(lang, mode);
  const answer = deck.get(rank);
  if (answer === undefined) return [];

  const wrong: string[] = [];
  const seen = new Set<string>([answer.clue]);
  for (let i = order.length - 1; i >= 0 && wrong.length < PICK_OPTIONS - 1; i--) {
    const other = order[i];
    if (other === rank || other > cap) continue;
    const question = deck.get(other);
    if (question === undefined || seen.has(question.clue)) continue;
    if (shareAnswer(answer, question)) continue;
    seen.add(question.clue);
    wrong.push(question.clue);
  }
  if (wrong.length < PICK_OPTIONS - 1) return [];

  const options = wrong.slice();
  options.splice(rank % PICK_OPTIONS, 0, answer.clue);
  return options;
}

/**
 * Whether any one word in the language answers both of these clues.
 *
 * The smaller set is walked, because these are wildly uneven: a function word's
 * `accepts` runs to hundreds of entries and a concrete noun's to two or three.
 */
function shareAnswer(a: VocabQuestion, b: VocabQuestion): boolean {
  const [small, large] = a.accepts.size <= b.accepts.size ? [a, b] : [b, a];
  for (const key of small.accepts) if (large.accepts.has(key)) return true;
  return false;
}

/** How many of the first `cap` ranks can actually be asked, for the tests. */
export function vocabPoolSize(lang: VocabLang, mode: VocabMode, cap: number): number {
  const deck = deckOf(lang, mode);
  let n = 0;
  for (let rank = 1; rank <= cap; rank++) if (deck.has(rank)) n++;
  return n;
}

/** Here for the test that holds the laziness. See `chainDictionaryIsBuilt`. */
export function vocabDeckIsBuilt(lang: VocabLang): boolean {
  return decks[lang] !== undefined;
}

/**
 * Which ranks in `lang` are the words behind these folded lemmas.
 *
 * The join between a profile and a deck: the ledger hands over what somebody
 * is due to review, and this says where in the frequency list those words
 * actually live so a deck can be dealt around them. Keys the language does not
 * have are simply absent from the answer, which is the ordinary case — a
 * learner's Polish list says nothing about a Japanese deck.
 *
 * A `Set`, because the caller is partitioning a thousand ranks against it and
 * the only question ever asked is membership.
 */
export function vocabRanksFor(lang: VocabLang, keys: readonly string[]): Set<number> {
  const { byStudyKey } = decks[lang] ?? build(lang);
  const out = new Set<number>();
  for (const key of keys) {
    for (const rank of byStudyKey.get(key) ?? []) out.add(rank);
  }
  return out;
}
