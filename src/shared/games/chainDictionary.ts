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
import type { ChainLang } from './wordChainDisplay.js';

export interface ChainEntry {
  /** The word as it should be read — Polish accented, Japanese in romaji. */
  word: string;
  /** `word` folded: what the chain links on and compares. */
  key: string;
  gloss: string;
  script: string;
  lemma: string;
}

/**
 * Polish diacritics, flattened.
 *
 * Not decoration: the accented letters are not on a phone keyboard, so a game
 * that insisted on them would be unplayable on the device it is mostly played
 * on. Typing `zolty` finds the word, and the board shows it back as **żółty** —
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
 * rewrote more than this would make the chain's one rule unpredictable — `sou`
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

/**
 * Romaji, normalised hard enough that the three ways to spell a Japanese word
 * stop being two ways to lose: `shi`/`si`, `tsu`/`tu`, `chi`/`ti`, `fu`/`hu`,
 * `ji`/`zi`, and long vowels however they are written. `koohii`, `kohii` and
 * `kohi` all arrive here as the same string.
 *
 * Only ever used to *find* an entry. The entry's own `key` is what the chain
 * then links on, so a player who types a long vowel still hands the next
 * player the letter the canonical spelling ends with.
 */
function jaLoose(word: string): string {
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
  /** Frequency order, commonest first — what the reveal reads. */
  ordered: Record<ChainLang, ChainEntry[]>;
  byKey: Record<ChainLang, Map<string, ChainEntry>>;
  /** Japanese only; see `jaLoose`. */
  loose: Map<string, ChainEntry>;
}

let lists: Lists | null = null;

/** First wins, and the source is frequency-ordered, so a clash keeps the commoner word. */
function add(into: Map<string, ChainEntry>, ordered: ChainEntry[], entry: ChainEntry): boolean {
  if (entry.key.length < MIN_LENGTH || into.has(entry.key)) return false;
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
    if (word) add(byKey.en, ordered.en, { word, key: fold(word), gloss: '', script: '', lemma: '' });
  }
  for (const line of PL_SOURCE.split('\n')) {
    const [word, lemma = '', gloss = ''] = line.trim().split('|');
    if (word) add(byKey.pl, ordered.pl, { word, key: fold(word), gloss, script: '', lemma });
  }
  for (const line of JA_SOURCE.split('\n')) {
    const [romaji, kana = '', kanji = '', gloss = ''] = line.trim().split('|');
    if (!romaji) continue;
    const entry: ChainEntry = {
      word: romaji,
      key: fold(romaji),
      gloss,
      // Kanji where there is one, kana otherwise: the board shows a single line
      // of Japanese under the romaji, and the kanji teaches more.
      script: kanji || kana,
      lemma: '',
    };
    if (add(byKey.ja, ordered.ja, entry)) {
      const key = jaLoose(romaji);
      if (!loose.has(key)) loose.set(key, entry);
    }
  }
  lists = { ordered, byKey, loose };
  return lists;
}

/** Here for the test that holds the laziness — see `words.ts`, same idea. */
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
 * have anything at all to say to this?" — the check that stops a Japanese
 * player being handed an L, which no Japanese word begins with.
 *
 * A linear scan of a frequency-ordered list, which is the whole trick: the
 * first match *is* the commonest match, so there is nothing to sort and no
 * second index to keep true.
 *
 * Glossed words win over unglossed ones of the same letter, because the reveal
 * is the teaching moment and a word shown without its meaning wastes it. Only
 * a preference: English carries no glosses at all, and a thin letter in Polish
 * would rather give up an untranslated word than nothing.
 */
export function commonestStarting(
  lang: ChainLang,
  letter: string,
  used: ReadonlySet<string>,
): ChainEntry | null {
  const l = lists ?? build();
  const first = fold(letter).slice(0, 1);
  let fallback: ChainEntry | null = null;
  for (const entry of l.ordered[lang]) {
    if (used.has(entry.key)) continue;
    if (first !== '' && !entry.key.startsWith(first)) continue;
    if (entry.gloss) return entry;
    fallback ??= entry;
  }
  return fallback;
}

/** How many words each language contributes — for the tests that hold the sizes. */
export function chainListSizes(): Record<ChainLang, number> {
  const l = lists ?? build();
  return { en: l.ordered.en.length, pl: l.ordered.pl.length, ja: l.ordered.ja.length };
}
