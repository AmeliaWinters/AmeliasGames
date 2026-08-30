/**
 * The two word lists, indexed for the four questions Superghost asks: is this
 * fragment still inside some word, how many, is it a word already, and what
 * word was the position heading for.
 *
 * The data is `chainWords.ts`, generated and shared with Word Chain; this is
 * the hand-written half. Both are server-only, and `bundle.test.ts` holds that
 * line for the same run of Polish source it already checks Word Chain with.
 *
 * Built lazily, like `words.ts` and `chainDictionary.ts`: importing this costs
 * nothing until a room actually deals a game of it, and most rooms are playing
 * Connect Four.
 *
 * Two ways this index is not the one Word Chain uses, both load bearing.
 *
 * **Substrings, not prefixes.** Superghost grows the fragment at either end, so
 * the question is never "what starts with this" but "what contains this", and
 * no trie answers that in one shape. What is here instead is a filter over a
 * frequency-ordered array, narrowed from the position before it: every word
 * containing `stan` contains `sta` and `tan`, so the matches for a fragment are
 * always a subset of the matches for the fragment one letter shorter, at either
 * end. A round therefore costs one full scan on its first letter and a scan of
 * a shrinking list after that.
 *
 * **Polish keeps its accents.** Word Chain folds `ż` to `z` because a player
 * there is typing a word on a phone keyboard that has no `ż` on it. This game
 * draws its own keyboard, so there is nothing to fold around, and folding would
 * throw away the one thing a Polish learner most needs to get right. Only the
 * key filed in the ledger is folded, and that happens in the reducer, where
 * Word Chain does it too.
 */
import { EN_SOURCE, PL_SOURCE } from './chainWords.js';
import { fold, foldStrict } from './chainDictionary.js';
import { MIN_WORD, ghostAlphabet } from './ghostDisplay.js';
import type { GhostLang, GhostOut } from './ghostDisplay.js';

export interface GhostEntry {
  /** The word as it should be read: Polish accented, English as listed. */
  word: string;
  /** What the fragment is compared against. Lower case, letters only. */
  key: string;
  gloss: string;
  lemma: string;
  /** Position in its language's frequency order, commonest first, from one. */
  rank: number;
}

interface Lists {
  /** Frequency order, commonest first: what the reveal reads down. */
  ordered: Record<GhostLang, GhostEntry[]>;
  byKey: Record<GhostLang, Map<string, GhostEntry>>;
}

let lists: Lists | null = null;

/**
 * Nothing shorter than `MIN_WORD` goes in, and that is a rule rather than a
 * tidy-up.
 *
 * A fragment counts as alive if some word contains it, so a two-letter word in
 * the list would keep `by` standing as a position with nothing behind it: alive
 * by the index's own answer, and unfinishable by the rule that says a word has
 * to be four letters to count. The board would show "1 word left" and no legal
 * move would exist. Filtering at the source is what keeps "alive" and "there is
 * still something to reach" the same claim.
 */
function add(into: Map<string, GhostEntry>, ordered: GhostEntry[], entry: GhostEntry): void {
  if (entry.key.length < MIN_WORD || into.has(entry.key)) return;
  // The position it lands in, which is only knowable here: the source is
  // frequency-ordered but holds words this list drops, so the line number and
  // the rank come apart inside the first hundred.
  entry.rank = ordered.length + 1;
  into.set(entry.key, entry);
  ordered.push(entry);
}

function build(): Lists {
  const ordered: Record<GhostLang, GhostEntry[]> = { en: [], pl: [] };
  const byKey: Record<GhostLang, Map<string, GhostEntry>> = { en: new Map(), pl: new Map() };

  for (const word of EN_SOURCE.split(/\s+/)) {
    if (!word) continue;
    add(byKey.en, ordered.en, { word, key: fold(word), gloss: '', lemma: '', rank: 0 });
  }
  for (const line of PL_SOURCE.split('\n')) {
    const [word, lemma = '', gloss = ''] = line.trim().split('|');
    if (!word) continue;
    // `foldStrict`, so `ż` survives. See the note at the top.
    add(byKey.pl, ordered.pl, { word, key: foldStrict(word), gloss, lemma, rank: 0 });
  }

  lists = { ordered, byKey };
  return lists;
}

/** Here for the test that holds the laziness. Same idea as `words.ts`. */
export function ghostDictionaryIsBuilt(): boolean {
  return lists !== null;
}

/**
 * The matches for a fragment, memoised, narrowed from the position before it.
 *
 * The cache is derived data and nothing else: every entry is a pure function of
 * the fragment and the list, so a cleared cache changes how long a move takes
 * and not what it decides. That is what lets a pure reducer sit on top of it,
 * the same bargain the lazy build already makes.
 *
 * Cleared whole rather than evicted one at a time. A fragment is at most a
 * dozen letters and a room plays five rounds, so the cache is small and short
 * lived; a least-recently-used list would be more machinery than the thing it
 * manages. The ceiling is there so a long-lived server cannot accumulate one
 * entry per fragment anybody has ever built.
 */
const CACHE_MAX = 4096;
const cache = new Map<string, readonly GhostEntry[]>();

function matches(lang: GhostLang, fragment: string): readonly GhostEntry[] {
  const l = lists ?? build();
  if (!fragment) return l.ordered[lang];

  const at = `${lang}:${fragment}`;
  const hit = cache.get(at);
  if (hit) return hit;

  // Either parent will do: a word containing `stan` contains `sta` and `tan`
  // both, so either one's matches are a superset of this one's. Whichever the
  // game happens to have passed through is already here.
  const parent =
    cache.get(`${lang}:${fragment.slice(1)}`) ??
    cache.get(`${lang}:${fragment.slice(0, -1)}`) ??
    l.ordered[lang];

  const found = parent.filter((entry) => entry.key.includes(fragment));
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(at, found);
  return found;
}

/** How many words still contain the fragment. The number under the board. */
export function ghostLeft(lang: GhostLang, fragment: string): number {
  return matches(lang, fragment).length;
}

/** Whether the fragment is still inside some word. A false here loses the round. */
export function ghostAlive(lang: GhostLang, fragment: string): boolean {
  return matches(lang, fragment).length > 0;
}

/**
 * The fragment as a finished word, or null.
 *
 * Only ever a word of `MIN_WORD` letters or more, because the index holds
 * nothing shorter. That is the rule "you cannot lose on a short word" and it is
 * enforced by what went into the list rather than by a length check here, so
 * there is one place to change it.
 */
export function ghostWord(lang: GhostLang, fragment: string): GhostEntry | null {
  const l = lists ?? build();
  return l.byKey[lang].get(fragment) ?? null;
}

/**
 * The commonest word containing the fragment, or null if nothing does.
 *
 * A linear read of a frequency-ordered list, which is the whole trick: the
 * first match is the commonest match, so there is nothing to sort and no second
 * index to keep true. Same bargain `commonestStarting` makes in
 * `chainDictionary.ts`.
 *
 * A glossed word wins over an unglossed one, because this is the reveal and a
 * word shown without its meaning wastes the one moment a player is guaranteed
 * to read one. Only a preference, and it only ever costs a few places: English
 * carries no glosses at all, so it takes the first match and stops.
 */
export function ghostCommonest(lang: GhostLang, fragment: string): GhostEntry | null {
  const found = matches(lang, fragment);
  if (found.length === 0) return null;
  return found.find((entry) => entry.gloss !== '') ?? found[0];
}

/**
 * Every letter that would have kept this position alive without finishing a
 * word, at either end.
 *
 * Both conditions, because a letter that keeps the fragment inside some word
 * and happens to complete one is not an escape, it is the other way of losing.
 *
 * One pass over the matches, reading the letters that sit either side of the
 * fragment inside them, rather than seventy calls to `ghostAlive`. The obvious
 * version costs a scan per candidate letter per side and measured about 100ms
 * on an early Polish fragment, which is a tenth of a second of server CPU spent
 * to draw a hint. This is the same answer for one scan, because a letter keeps
 * the fragment alive exactly when some word already has it there.
 */
export function ghostOuts(lang: GhostLang, fragment: string): GhostOut[] {
  if (!fragment) return [];
  const alphabet = ghostAlphabet(lang);
  const before = new Set<string>();
  const after = new Set<string>();

  for (const entry of matches(lang, fragment)) {
    // Every occurrence, not the first: `ana` sits twice in `banana` and the
    // letters around the two are not the same pair.
    for (let at = entry.key.indexOf(fragment); at !== -1; at = entry.key.indexOf(fragment, at + 1)) {
      if (at > 0) before.add(entry.key[at - 1]);
      const end = at + fragment.length;
      if (end < entry.key.length) after.add(entry.key[end]);
    }
  }

  const out: GhostOut[] = [];
  for (const letter of alphabet) {
    if (before.has(letter) && !ghostWord(lang, letter + fragment)) {
      out.push({ side: 'start', letter });
    }
  }
  for (const letter of alphabet) {
    if (after.has(letter) && !ghostWord(lang, fragment + letter)) {
      out.push({ side: 'end', letter });
    }
  }
  return out;
}

/** How many playable words each language has. For the tests and the setup copy. */
export function ghostListSizes(): Record<GhostLang, number> {
  const l = lists ?? build();
  return { en: l.ordered.en.length, pl: l.ordered.pl.length };
}
