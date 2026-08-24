/**
 * Word Chain's lists, indexed for the two questions Vocab Race asks: "what
 * does the Nth commonest Polish word mean?" and "does what this player typed
 * mean that?"
 *
 * No new data. The lists in `chainWords.ts` are frequency-ordered and carry an
 * English gloss on every Polish and Japanese entry, which is exactly a deck of
 * flashcards read from the other side — and the worker bundle is close enough
 * to its ceiling (see `scripts/build-wordchain.ts`) that a second copy of the
 * same vocabulary to support a second game would not have fitted. This module
 * is the hand-written half; `chainDictionary.ts` is where the lists are parsed
 * and where a typed word is reduced to something comparable.
 *
 * Server-only, and here it is a secret rather than a size: whoever can resolve
 * the clue has already won the round. `bundle.test.ts` holds the line for
 * `chainWords.ts` however it is reached, so importing this from a board would
 * fail there.
 *
 * Built lazily, for the same reason the chain dictionary is: most rooms are
 * playing Connect Four.
 */
import { chainRanked } from './chainDictionary.js';
import { DECK_DEPTH } from './vocabDisplay.js';
import type { VocabLang } from './vocabDisplay.js';

/**
 * How many senses a clue is allowed to carry.
 *
 * The glosses run from one word to five or six, and a clue listing all of them
 * stops being a question — `cały` glossed "all, entire, whole; whole, entire,
 * all" tells you the shape of the dictionary rather than the meaning of the
 * word. Three is enough to disambiguate a word with genuinely separate senses
 * and few enough that the clue still reads as a definition.
 */
const MAX_SENSES = 3;

/**
 * A sense of a word: what to print, and what to file it under.
 *
 * The two differ, and the difference matters in both directions. `być` is
 * glossed "to be", and *to be* is the clue a learner should read — the "to" is
 * how English marks an infinitive and dropping it makes the clue point at a
 * noun. But the same sense reached from the English side is "be", so the index
 * has to hold it stripped or a player who knows a synonym never matches.
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
 * the automatic glossing left behind — `tego=this`, the bare `-self` of a
 * reflexive marker, anything with a digit in it — and it drops single letters,
 * which are never a meaning and are usually the wreckage of a stripped
 * bracket. An entry with no fragment left is not cluable, and there is nothing
 * to be done about that but skip it.
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

/** A clue and the word it points at, ready to be dealt. */
export interface VocabQuestion {
  /** The English meaning, as the clue is printed. */
  clue: string;
  word: string;
  script: string;
  lemma: string;
  rank: number;
  /**
   * Every folded word in the language that means one of the same things —
   * including the word this clue was built from. This is what a guess is
   * marked against.
   */
  accepts: ReadonlySet<string>;
}

interface Deck {
  /** By rank, so `byRank[n]` is the question for the nth commonest word. */
  byRank: Map<number, VocabQuestion>;
}

const decks: Partial<Record<VocabLang, Deck>> = {};

/**
 * Index a whole language, then build the questions for the part of it this
 * game can reach.
 *
 * Two passes and they are not the same depth, which is the whole trick. The
 * *index* is built over every entry in the language — sixty-four thousand
 * Polish words — because it decides what counts as a right answer, and a
 * player who answers "small" with a rarer synonym than the one the clue was
 * cut from has answered the question. The *questions* are built only over the
 * first thousand ranks, because that is as deep as any difficulty asks.
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
    });
  }

  const deck = { byRank };
  decks[lang] = deck;
  return deck;
}

/**
 * The question for the word at `rank`, or null when that word cannot be clued.
 *
 * Null is ordinary rather than exceptional — roughly one Polish word in
 * fifteen inside the top thousand has a gloss with nothing printable left in
 * it. The caller deals past those; see `draw` in the reducer.
 */
export function vocabQuestion(lang: VocabLang, rank: number): VocabQuestion | null {
  return (decks[lang] ?? build(lang)).byRank.get(rank) ?? null;
}

/** How many of the first `cap` ranks can actually be asked — for the tests. */
export function vocabPoolSize(lang: VocabLang, cap: number): number {
  const deck = decks[lang] ?? build(lang);
  let n = 0;
  for (let rank = 1; rank <= cap; rank++) if (deck.byRank.has(rank)) n++;
  return n;
}

/** Here for the test that holds the laziness — see `chainDictionaryIsBuilt`. */
export function vocabDeckIsBuilt(lang: VocabLang): boolean {
  return decks[lang] !== undefined;
}
