/**
 * The three word lists, indexed for the two questions Word Chain asks:
 * "is this a word, and what does it mean?" and "what is the commonest word
 * starting with A that nobody has said?"
 *
 * The data is in `chainWords.ts`, which is generated; this is the hand-written
 * half and the only place that knows how a typed word is reduced to something
 * comparable. Both are server-only. `bundle.test.ts` holds that line.
 *
 * Built lazily, for the reason `words.ts` is: importing this module costs
 * nothing until a game actually needs a dictionary, and most rooms are playing
 * Connect Four.
 */
import { EN_SOURCE, JA_SOURCE, PL_SOURCE } from './chainWords.js';
import { MIN_LENGTH } from './wordChainDisplay.js';
import type { ChainLang, ChainMode } from './wordChainDisplay.js';

export interface ChainEntry {
  /** The word as it should be read: Polish accented, Japanese in romaji. */
  word: string;
  /** `word` folded: what the chain compares, and what it links on in a
   * cross-language game. */
  key: string;
  /**
   * `word` folded only as far as case and punctuation, Polish diacritics kept.
   * What the chain links on when both players are in the same language.
   *
   * Identical to `key` for English and Japanese, which have no accented forms
   * between them: strict chaining is a Polish feature and nothing else, and
   * this field being the same string twice everywhere else is the cheapest
   * possible way to say so.
   */
  strict: string;
  gloss: string;
  script: string;
  lemma: string;
  /**
   * Where the word sits in its language's frequency order, commonest first and
   * counting from one.
   *
   * The lists were always ordered by frequency; this writes the order down so
   * a word can carry it to the board and say how common it is. Rank within a
   * list, not across them: the Japanese list is half the size of the other two,
   * so `#900` is rarer in English than in Japanese, and the board says which
   * language it is ranking.
   */
  rank: number;
}

/**
 * Polish diacritics, flattened.
 *
 * Not decoration: the accented letters are not on a phone keyboard, so a game
 * that insisted on them would be unplayable on the device it is mostly played
 * on. Typing `zolty` finds the word and the board shows it back as **żółty**,
 * which is the moment the spelling is taught rather than demanded.
 *
 * It also decides what a word hands on. `ręką` ends in an accented letter that
 * almost no Polish word begins with; folded, it hands on an `a`, which is a
 * letter the next player can actually answer.
 */
const PL_FOLD: Record<string, string> = {
  'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
  'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z',
};

/**
 * What both a stored word and a typed guess are reduced to before they meet.
 *
 * Deliberately shallow: lower case, accents off, anything that is not a letter
 * dropped. It stays close to what the player can see, because its last
 * character is the letter the next word must start with, and a fold that
 * rewrote more than this would make the chain's one rule unpredictable: `sou`
 * has to hand on a `u`, because `sou` is what is on the screen.
 *
 * The looser matching Japanese needs lives in `jaLoose`, which is a lookup aid
 * and never decides a letter.
 */
export function fold(word: string): string {
  return word
    .toLowerCase()
    .replace(/[ąćęłńóśźż]/g, (c) => PL_FOLD[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

/** The nine Polish letters that survive `foldStrict` and die in `fold`. */
const PL_LETTERS = 'ąćęłńóśźż';

/**
 * `fold`, stopping short of the accents.
 *
 * The other half of the same bargain. `fold` exists because a phone keyboard
 * has no `ż` on it and a game that demanded one would be unplayable; this
 * exists because when both players are in Polish, refusing to notice the
 * accent throws away the most Polish thing about the language. A chain that
 * links `ł` to `ł` asks for *łatwo* after *był*, and the whole family of words
 * beginning `ś` (*świat*, *światło*, *śmierć*) becomes a letter you can be
 * handed rather than a spelling detail the game flattens away.
 *
 * Still only ever compared against a *stored* word, never against what was
 * typed: `chainLookup` finds the entry from the folded form, so `swiatlo`
 * still finds **światło** and the accent is checked on the entry the list
 * holds. The player is never asked to type a letter their keyboard lacks.
 */
export function foldStrict(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFC')
    .replace(new RegExp(`[^a-z${PL_LETTERS}]`, 'g'), '');
}

/** Shared, because the common case passes no cooldowns and allocating a set per call would be a set per keystroke. */
const EMPTY: ReadonlySet<string> = new Set();

/** The form the chain links on, which depends on who is playing. */
export function chainKey(entry: ChainEntry, mode: ChainMode): string {
  return mode === 'strict' ? entry.strict : entry.key;
}

/** A required letter, reduced the same way the keys it is matched against were. */
export function foldLetter(letter: string, mode: ChainMode): string {
  return (mode === 'strict' ? foldStrict(letter) : fold(letter)).slice(0, 1);
}

/**
 * Romaji, normalised hard enough that the three ways to spell a Japanese word
 * stop being two ways to lose: `shi`/`si`, `tsu`/`tu`, `chi`/`ti`, `fu`/`hu`,
 * `ji`/`zi`, and long vowels however they are written. `koohii`, `kohii` and
 * `kohi` all arrive here as the same string.
 *
 * Only ever used to *find* an entry. The entry's own `key` is what the chain
 * then links on, so a player who types a long vowel still hands the next
 * player the letter the canonical spelling ends with.
 *
 * Exported for Vocab Race's phrase deck, which needs the same forgiveness over
 * a whole sentence and has no entry to look up: see `keysOf` in
 * `vocabPhrases.ts`. Still never decides a letter.
 */
export function jaLoose(word: string): string {
  return fold(word)
    .replace(/sh/g, 's')
    .replace(/ch/g, 't')
    .replace(/ts/g, 't')
    .replace(/j([auo])/g, 'zy$1')
    .replace(/j/g, 'z')
    .replace(/f/g, 'h')
    .replace(/ou/g, 'o')
    .replace(/(.)\1+/g, '$1');
}

interface Lists {
  /** Frequency order, commonest first: what the reveal reads. */
  ordered: Record<ChainLang, ChainEntry[]>;
  byKey: Record<ChainLang, Map<string, ChainEntry>>;
  /** Japanese only; see `jaLoose`. */
  loose: Map<string, ChainEntry>;
}

let lists: Lists | null = null;

/** First wins, and the source is frequency-ordered, so a clash keeps the commoner word. */
function add(into: Map<string, ChainEntry>, ordered: ChainEntry[], entry: ChainEntry): boolean {
  if (entry.key.length < MIN_LENGTH || into.has(entry.key)) return false;
  // Rank is the position it lands in, which is only knowable here: the source
  // is frequency-ordered but holds words this list drops (too short, or a
  // second inflection folding onto a key already taken) so the source line
  // number and the rank drift apart within the first hundred words.
  entry.rank = ordered.length + 1;
  into.set(entry.key, entry);
  ordered.push(entry);
  return true;
}

function build(): Lists {
  const ordered: Record<ChainLang, ChainEntry[]> = { en: [], pl: [], ja: [] };
  const byKey: Record<ChainLang, Map<string, ChainEntry>> = {
    en: new Map(), pl: new Map(), ja: new Map(),
  };
  const loose = new Map<string, ChainEntry>();

  for (const word of EN_SOURCE.split(/\s+/)) {
    if (!word) continue;
    const key = fold(word);
    const entry = { word, key, strict: key, gloss: '', script: '', lemma: '', rank: 0 };
    add(byKey.en, ordered.en, entry);
  }
  for (const line of PL_SOURCE.split('\n')) {
    const [word, lemma = '', gloss = ''] = line.trim().split('|');
    if (!word) continue;
    const entry = { word, key: fold(word), strict: foldStrict(word), gloss, script: '', lemma, rank: 0 };
    add(byKey.pl, ordered.pl, entry);
  }
  for (const line of JA_SOURCE.split('\n')) {
    const [romaji, kana = '', kanji = '', gloss = ''] = line.trim().split('|');
    if (!romaji) continue;
    const key = fold(romaji);
    const entry: ChainEntry = {
      word: romaji,
      key,
      // Romaji has no accented forms, so the two keys are the same string.
      strict: key,
      gloss,
      // Kanji where there is one, kana otherwise: the board shows a single line
      // of Japanese under the romaji, and the kanji teaches more.
      script: kanji || kana,
      lemma: '',
      rank: 0,
    };
    if (add(byKey.ja, ordered.ja, entry)) {
      const key = jaLoose(romaji);
      if (!loose.has(key)) loose.set(key, entry);
    }
  }
  lists = { ordered, byKey, loose };
  return lists;
}

/** Here for the test that holds the laziness. See `words.ts`, same idea. */
export function chainDictionaryIsBuilt(): boolean {
  return lists !== null;
}

/** The entry for a word as a player typed it, or null if no list has such a word. */
export function chainLookup(lang: ChainLang, typed: string): ChainEntry | null {
  const l = lists ?? build();
  const hit = l.byKey[lang].get(fold(typed));
  if (hit) return hit;
  return lang === 'ja' ? l.loose.get(jaLoose(typed)) ?? null : null;
}

/**
 * The commonest word in `lang` that starts with `letter` and is not in `used`.
 *
 * Two jobs, and they want the same scan. It is the word revealed to a player
 * whose minute ran out, and it is how the reducer answers "does the opponent
 * have anything at all to say to this?", the check that stops a Japanese player
 * being handed an L, which no Japanese word begins with.
 *
 * A linear scan of a frequency-ordered list, which is the whole trick: the
 * first match *is* the commonest match, so there is nothing to sort and no
 * second index to keep true.
 *
 * Glossed words win over unglossed ones of the same letter, because the reveal
 * is the teaching moment and a word shown without its meaning wastes it. Only
 * a preference: English carries no glosses at all, and a thin letter in Polish
 * would rather give up an untranslated word than nothing.
 *
 * `blockedEndings` drops words the asker could not legally have said because
 * of a cooldown on the letter they end in. The reveal is the whole point of
 * losing, and showing a player a word the game would have refused is worse than
 * showing them nothing.
 *
 * `due` is the folded lemmas this player is already scheduled to review, and it
 * outranks frequency. A player who has met a word before, been graded on it and
 * come back round to it is in a quite different position from one meeting a
 * word cold: the reveal is the app's best teaching moment (see `record` in
 * `wordChain.ts`) and spending it on a word already in their ledger is what
 * turns two unconnected games into one course. Frequency still orders the
 * choice *within* the due words, so what comes back is the commonest word they
 * owe a review on, not an arbitrary one.
 *
 * Matched on the folded **lemma**, because that is what the ledger files a row
 * under: Polish keeps `jestem` and `być` apart on the board and together in a
 * profile, and matching `entry.key` here would miss every inflection of every
 * word anybody has ever learned. See `linkLearned` in `wordChain.ts`, which is
 * the other half of the same rule.
 */
export function commonestStarting(
  lang: ChainLang,
  letter: string,
  used: ReadonlySet<string>,
  mode: ChainMode = 'loose',
  blockedEndings: ReadonlySet<string> = EMPTY,
  due: ReadonlySet<string> = EMPTY,
): ChainEntry | null {
  const l = lists ?? build();
  const first = foldLetter(letter, mode);
  // Three ranks, best first, and one scan: a word they owe a review on and can
  // be shown the meaning of, then any glossed word, then anything at all.
  // English carries no glosses, so the last of these is not a corner case.
  let glossed: ChainEntry | null = null;
  let fallback: ChainEntry | null = null;
  for (const entry of l.ordered[lang]) {
    // `used` is folded whatever the mode: a word already said is already said,
    // and its accents have nothing to do with it.
    if (used.has(entry.key)) continue;
    if (first !== '' && !chainKey(entry, mode).startsWith(first)) continue;
    // Unlike `used`, this is matched on the *mode's* key: a cooldown on `ś` in
    // a strict game must not swallow every word ending in a plain `s`.
    if (blockedEndings.size > 0 && blockedEndings.has(chainKey(entry, mode).slice(-1))) continue;
    if (entry.gloss) {
      // Nothing to look for means the first glossed word is the answer, and
      // the scan stops here exactly as it always did. With a due set the scan
      // has to run the letter out before it can say there was no due word in
      // it, which is one pass over one language, once, on a lost minute.
      if (due.size === 0) return entry;
      if (due.has(fold(entry.lemma || entry.word))) return entry;
      glossed ??= entry;
    }
    fallback ??= entry;
  }
  return glossed ?? fallback;
}

/**
 * How many words in `lang` start with `letter` and have not been said.
 *
 * The number the board shows a player while they are thinking ("412 words
 * left") and the number the reducer gates on, so a letter with four obscure
 * answers behind it is never handed to anybody. Same scan as
 * `commonestStarting`, counted rather than stopped at the first hit; an empty
 * `letter` counts the whole language, which is what an opening word may choose
 * from.
 *
 * Every word counts the same here, however rare. It is a count of what is
 * legal, not an estimate of what a player will think of, and a number that
 * quietly discounted the long tail would disagree with the list the reveal
 * reads from.
 */
export function countStarting(
  lang: ChainLang,
  letter: string,
  used: ReadonlySet<string>,
  mode: ChainMode = 'loose',
): number {
  const l = lists ?? build();
  const first = foldLetter(letter, mode);
  let n = 0;
  for (const entry of l.ordered[lang]) {
    if (used.has(entry.key)) continue;
    if (first !== '' && !chainKey(entry, mode).startsWith(first)) continue;
    n++;
  }
  return n;
}

/** How many words each language contributes, for the tests that hold the sizes. */
export function chainListSizes(): Record<ChainLang, number> {
  const l = lists ?? build();
  return { en: l.ordered.en.length, pl: l.ordered.pl.length, ja: l.ordered.ja.length };
}

/**
 * A language's whole list, commonest first: the same array
 * `commonestStarting` scans, handed out read-only.
 *
 * Vocab Race needs the list by *rank* rather than by letter: it asks "what is
 * the hundredth commonest Polish word, and what does it mean", which is a
 * question neither lookup above answers. Exposing the array rather than a
 * `nth()` accessor is deliberate: the clue index it builds is a single pass
 * over the whole thing, and an accessor called sixty thousand times to hand
 * back the elements of an array already sitting here would be a worse version
 * of the same thing.
 *
 * Read-only because it is the live array. `add` writes `rank` onto entries as
 * it fills it, and a caller that spliced this would silently renumber a list
 * two games are reading.
 */
export function chainRanked(lang: ChainLang): readonly ChainEntry[] {
  return (lists ?? build()).ordered[lang];
}
