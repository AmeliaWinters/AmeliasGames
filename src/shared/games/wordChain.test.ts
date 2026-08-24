import { describe, expect, it } from 'vitest';
import {
  LANG_NAME,
  LIST_SIZE,
  MIN_ANSWERS,
  MIN_LENGTH,
  MIN_TURN_MS,
  TURN_MS,
  TURN_STEP_MS,
  TURN_STEP_WORDS,
  canAct,
  chainStats,
  turnMsFor,
  wordChain,
  type ChainLang,
  type WcMove,
  type WcState,
} from './wordChain.js';
import {
  chainListSizes,
  chainLookup,
  commonestStarting,
  countStarting,
  fold,
  foldStrict,
} from './chainDictionary.js';

const rng = () => 0.5;

/** A room at the moment both seats filled: setup, clock armed. */
function opened(now = 1_000): WcState {
  const state = wordChain.setup(2, rng, now);
  return wordChain.start?.(state, now) ?? state;
}

/** Both players decided, so the game is on its first word. */
function playing(a: ChainLang, b: ChainLang, now = 1_000): WcState {
  let state = opened(now);
  for (const [seat, lang] of [[0, a], [1, b]] as const) {
    const result = wordChain.applyMove(state, { type: 'lang', lang }, seat, rng, now);
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  return state;
}

function say(state: WcState, word: string, now = 2_000): WcState {
  const result = wordChain.applyMove(state, { type: 'say', word }, state.at, rng, now);
  if (!result.ok) throw new Error(`${word} was refused: ${result.error}`);
  return result.state;
}

function refuse(state: WcState, move: WcMove, seat = state.at, now = 2_000): string {
  const result = wordChain.applyMove(state, move, seat, rng, now);
  if (result.ok) throw new Error('that move was allowed');
  return result.error;
}

/**
 * A chain of `n` words that were never played, for reaching the far end of the
 * ramp without saying a hundred and fifty real ones.
 *
 * The keys carry a hyphen, which no folded key ever does -- every one of them
 * is letters -- so nothing in this filler can collide with a word a test then
 * plays and turn it into an "already been said".
 */
function padded(n: number): WcState['chain'] {
  return Array.from({ length: n }, (_, i) => ({
    word: `pad${i}`,
    key: `pad-${i}`,
    lang: 'en' as ChainLang,
    seat: i % 2,
    gloss: '',
    script: '',
    lemma: '',
    ms: 0,
    rank: i + 1,
  }));
}

describe('choosing languages', () => {
  it('lets both seats act at once, which is why canAct is not turn', () => {
    const state = opened();
    expect(canAct(state, 0)).toBe(true);
    expect(canAct(state, 1)).toBe(true);
    // `turn` can only name one of them, and says so in its own comment.
    expect(wordChain.turn(state)).toBe(0);
  });

  it('waits for both before anyone may say a word', () => {
    const half = wordChain.applyMove(opened(), { type: 'lang', lang: 'pl' }, 0, rng, 1_000);
    expect(half.ok).toBe(true);
    if (!half.ok) return;
    expect(half.state.phase).toBe('setup');
    expect(canAct(half.state, 0)).toBe(false);
    expect(canAct(half.state, 1)).toBe(true);
  });

  it('starts the first minute the moment the second seat decides', () => {
    const state = playing('en', 'pl', 5_000);
    expect(state.phase).toBe('playing');
    expect(state.at).toBe(0);
    expect(state.required).toBe('');
    expect(state.deadline).toBe(5_000 + TURN_MS);
  });

  /**
   * The one place in this game where a clock running out does not end it. A
   * player who wandered off before choosing should not hand their opponent a
   * win, and a room stuck on a menu forever is worse than either.
   */
  it('gives English to whoever never chose, and plays on', () => {
    let state = opened(0);
    const half = wordChain.applyMove(state, { type: 'lang', lang: 'ja' }, 1, rng, 0);
    if (!half.ok) throw new Error(half.error);
    state = half.state;

    const settled = wordChain.expire?.(state, TURN_MS) ?? null;
    expect(settled).not.toBeNull();
    expect(settled?.phase).toBe('playing');
    expect(settled?.langs).toEqual(['en', 'ja']);
    expect(settled?.loser).toBeNull();
  });
});

describe('the chain', () => {
  it('takes any word to open, then links on the last letter', () => {
    let state = playing('en', 'en');
    state = say(state, 'apple');
    expect(state.chain[0]?.word).toBe('apple');
    expect(state.required).toBe('e');
    expect(state.at).toBe(1);

    expect(refuse(state, { type: 'say', word: 'apple' })).toMatch(/already been said/);
    expect(refuse(state, { type: 'say', word: 'water' })).toMatch(/start with E/);

    state = say(state, 'every');
    expect(state.required).toBe('y');
    expect(state.at).toBe(0);
  });

  it('crosses languages, which is the whole point of it', () => {
    let state = playing('pl', 'ja');
    state = say(state, 'woda');
    expect(state.chain[0]?.lang).toBe('pl');
    expect(state.required).toBe('a');
    state = say(state, 'arigatou');
    expect(state.chain[1]?.lang).toBe('ja');
    expect(state.chain[1]?.script).not.toBe('');
  });

  it('refuses anything shorter than the limit before it looks it up', () => {
    const state = playing('en', 'en');
    expect(refuse(state, { type: 'say', word: 'an' })).toMatch(
      new RegExp(`at least ${MIN_LENGTH} letters`),
    );
  });

  it('names the language when a word is not in the list', () => {
    const state = playing('pl', 'en');
    expect(refuse(state, { type: 'say', word: 'qwertyuiop' })).toContain(LANG_NAME.pl);
  });

  /**
   * A refusal has to be survivable: the lists hold common words only and will
   * not have everything a player knows, so the cost of being turned down is
   * the seconds it took, not the game.
   */
  it('leaves the clock exactly where it was when it turns a word down', () => {
    const state = playing('en', 'en', 1_000);
    const before = state.deadline;
    const result = wordChain.applyMove(state, { type: 'say', word: 'zzzzz' }, 0, rng, 30_000);
    expect(result.ok).toBe(false);
    expect(state.deadline).toBe(before);
  });

  it('gives each player a fresh minute when they answer', () => {
    const state = say(playing('en', 'en', 1_000), 'apple', 20_000);
    expect(state.deadline).toBe(20_000 + TURN_MS);
  });

  it('only lets the seat whose turn it is say anything', () => {
    const state = playing('en', 'en');
    expect(canAct(state, 0)).toBe(true);
    expect(canAct(state, 1)).toBe(false);
    expect(refuse(state, { type: 'say', word: 'apple' }, 1)).toBe('Not your move.');
  });
});

/**
 * Typing is the part of this game a phone makes hard, and both of these are
 * the difference between playable and not: the Polish accented letters are not
 * on an English keyboard, and there is more than one way to spell a Japanese
 * word in Latin script.
 */
describe('what a player is allowed to type', () => {
  it('takes Polish without its accents, and shows the word back with them', () => {
    const state = say(playing('pl', 'en'), 'zolty');
    expect(state.chain[0]?.word).toBe('żółty');
    expect(state.chain[0]?.gloss).toBe('yellow');
  });

  it('folds an accented ending to the letter the next player can answer', () => {
    // The Polish word for hand ends in an accented letter that virtually no
    // Polish word begins with. Folded it hands on an `a`, which is answerable.
    expect(fold('ręką')).toBe('reka');
    const state = say(playing('pl', 'en'), 'ręką');
    expect(state.required).toBe('a');
  });

  it('takes the long vowel of a Japanese word however it is spelled', () => {
    const canonical = chainLookup('ja', 'koohii');
    expect(canonical).not.toBeNull();
    expect(chainLookup('ja', 'kohii')).toBe(canonical);
    expect(chainLookup('ja', 'kohi')).toBe(canonical);
  });

  /**
   * Real shiritori links kana and loses on a final `n`. This game links the
   * romaji letters instead, because a kana gives an English or Polish player
   * nothing to answer — see the header of `wordChain.ts`.
   */
  it('links Japanese on its romaji letters, not on kana', () => {
    const state = say(playing('ja', 'en'), 'sakura');
    expect(state.required).toBe('a');
  });
});

/**
 * No Japanese word begins with L, Q or X. Without this rule a player could be
 * handed a letter their language cannot answer and lose to the dictionary
 * rather than to their own vocabulary, which is not a game.
 */
describe('a word that leaves nothing to answer', () => {
  it('is refused, and says whose language it would have stranded', () => {
    const state = playing('en', 'ja');
    const stranding = ['well', 'small', 'call', 'tell', 'until'].find(
      (word) => fold(word).endsWith('l') && chainLookup('en', word),
    );
    expect(stranding).toBeDefined();
    const error = refuse(state, { type: 'say', word: stranding as string });
    expect(error).toContain(LANG_NAME.ja);
    expect(error).toContain('L');
  });

  it('allows the same word when the opponent plays a language that has one', () => {
    const state = say(playing('en', 'pl'), 'well');
    expect(state.required).toBe('l');
    expect(commonestStarting('pl', 'l', new Set())).not.toBeNull();
  });
});

describe('running out of time', () => {
  it('ends the game, names the loser, and reveals a word they could have said', () => {
    const state = say(playing('en', 'pl', 0), 'apple', 0);
    expect(state.at).toBe(1);

    const settled = wordChain.expire?.(state, TURN_MS) ?? null;
    expect(settled).not.toBeNull();
    expect(settled?.phase).toBe('over');
    expect(settled?.loser).toBe(1);
    expect(wordChain.isOver(settled as WcState)).toBe(true);

    // The reveal is the reason the lists are frequency-ordered at all.
    const reveal = settled?.reveal;
    expect(reveal?.lang).toBe('pl');
    expect(reveal?.key.startsWith('e')).toBe(true);
    expect(reveal?.gloss).not.toBe('');
    expect(wordChain.turn(settled as WcState)).toBeNull();
  });

  it('never reveals a word that has already been said', () => {
    const opening = commonestStarting('en', 'e', new Set());
    expect(opening).not.toBeNull();
    const used = new Set([opening?.key as string]);
    expect(commonestStarting('en', 'e', used)?.key).not.toBe(opening?.key);
  });

  it('refuses a word that arrives after the whistle', () => {
    const state = playing('en', 'en', 0);
    expect(refuse(state, { type: 'say', word: 'apple' }, 0, TURN_MS + 1)).toBe('Not your move.');
  });

  it('is the only way to lose — nobody is out before the clock says so', () => {
    const state = say(playing('en', 'en', 0), 'apple', 0);
    expect(wordChain.expire?.(state, TURN_MS - 1) ?? null).toBeNull();
    expect(state.loser).toBeNull();
  });
});

/**
 * The lists cost bytes on every cold start of the worker and exist to be
 * *common* words, so both ends are worth pinning: too small and a player's
 * ordinary vocabulary is refused, too large and the game is paying for words
 * nobody will ever type.
 */
describe('the word lists', () => {
  const sizes = chainListSizes();

  it('holds a usable vocabulary in each language', () => {
    expect(sizes.en).toBeGreaterThan(20_000);
    expect(sizes.pl).toBeGreaterThan(20_000);
    expect(sizes.ja).toBeGreaterThan(10_000);
    for (const n of Object.values(sizes)) expect(n).toBeLessThan(35_000);
  });

  it('has no word shorter than the limit, in any language', () => {
    for (const lang of ['en', 'pl', 'ja'] as ChainLang[]) {
      const used = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const entry = commonestStarting(lang, '', used);
        if (!entry) break;
        expect(entry.key.length).toBeGreaterThanOrEqual(MIN_LENGTH);
        used.add(entry.key);
      }
    }
  });

  /**
   * Every letter the game can hand a player has to be answerable, or the
   * refusal above is doing its work against an empty list on the other side
   * and somebody is stuck with no legal move at all. English and Polish answer
   * everything; Japanese has three letters it cannot, which is precisely what
   * `leavesNothing` exists to keep off the board.
   */
  it('leaves English and Polish an answer to every letter', () => {
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      expect(commonestStarting('en', letter, new Set())).not.toBeNull();
      expect(commonestStarting('pl', letter, new Set())).not.toBeNull();
    }
  });

  it('has exactly the three letters Japanese cannot start a word with', () => {
    const dead = [...'abcdefghijklmnopqrstuvwxyz'].filter(
      (letter) => commonestStarting('ja', letter, new Set()) === null,
    );
    expect(dead).toEqual(['l', 'q', 'x']);
  });

  it('glosses every Japanese word, since the script alone teaches nobody', () => {
    const used = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const entry = commonestStarting('ja', '', used);
      if (!entry) break;
      expect(entry.gloss).not.toBe('');
      expect(entry.script).not.toBe('');
      used.add(entry.key);
    }
  });
});

/**
 * The rank a word carries to the board, which is the whole of "how common is
 * this?" as far as the client is concerned — it has no list to ask.
 */
describe('how common a word is', () => {
  it('travels with every word played', () => {
    const state = say(playing('en', 'pl'), 'apple');
    expect(state.chain[0].rank).toBeGreaterThan(0);
    expect(state.chain[0].rank).toBeLessThanOrEqual(chainListSizes().en);
  });

  it('starts at one, on the commonest word each language has', () => {
    for (const lang of ['en', 'pl', 'ja'] as ChainLang[]) {
      expect(commonestStarting(lang, '', new Set())?.rank).toBe(1);
    }
  });

  /**
   * A rank read off the source line number would be wrong and would look
   * right: the sources are frequency-ordered but hold words the list drops —
   * too short, or an inflection folding onto a key already taken — and the two
   * numbers part company inside the first hundred words, then drift further
   * the longer the list runs. Every rank in range and every rank distinct is
   * what says it was counted where the words actually landed.
   */
  it('is a distinct position in its own list, not a line number', () => {
    for (const lang of ['en', 'pl', 'ja'] as ChainLang[]) {
      const used = new Set<string>();
      const ranks = new Set<number>();
      for (let i = 0; i < 400; i++) {
        const entry = commonestStarting(lang, '', used);
        if (!entry) break;
        expect(entry.rank).toBeGreaterThan(0);
        expect(entry.rank).toBeLessThanOrEqual(chainListSizes()[lang]);
        ranks.add(entry.rank);
        used.add(entry.key);
      }
      expect(ranks.size).toBe(used.size);
    }
  });

  it('comes with the revealed word too, which is shown the same way', () => {
    const state = say(playing('en', 'pl', 0), 'apple', 0);
    expect((wordChain.expire?.(state, TURN_MS) ?? null)?.reveal?.rank).toBeGreaterThan(0);
  });
});

/**
 * The count the board shows whoever is thinking. It is the same number the
 * gate is measured against, which is the point of computing it in one place.
 */
describe('how many words are left', () => {
  it('opens with the whole of the first language', () => {
    expect(playing('en', 'pl').available).toBe(chainListSizes().en);
  });

  it('counts the letter just handed over, in the language that has to answer it', () => {
    const state = say(playing('en', 'pl'), 'apple');
    expect(state.required).toBe('e');
    expect(state.available).toBe(countStarting('pl', 'e', new Set(['apple'])));
  });

  it('falls by one as the letter is eaten', () => {
    // `else` both answers an E and hands back an E, so it is a word taken out
    // of the very count it was drawn from — which is the only clean way to
    // watch the number move without changing letter or language underneath it.
    const first = say(playing('en', 'en'), 'apple');
    expect(first.required).toBe('e');
    const second = say(first, 'else');
    expect(second.required).toBe('e');
    expect(second.available).toBe((first.available ?? 0) - 1);
  });

  it('belongs to nobody once the game is over', () => {
    const state = say(playing('en', 'pl', 0), 'apple', 0);
    expect(wordChain.expire?.(state, TURN_MS)?.available).toBeNull();
    const given = wordChain.applyMove(state, { type: 'give-up' }, 1, rng, 1_000);
    expect(given.ok && given.state.available).toBeNull();
  });
});

/**
 * The gate, at its real height. Zero was never the right bar: the lists come
 * out of subtitle corpora, so the thinnest letters are answerable only by
 * whatever proper nouns wandered in, and being handed *Xavier* is losing to
 * the dictionary as surely as being handed nothing.
 */
describe('a letter with hardly anything behind it', () => {
  const none = new Set<string>();

  it('is refused even though the language technically has a word for it', () => {
    // Polish Y is four American place names. `commonestStarting` finds one,
    // which is exactly why the gate reads the count and not the existence.
    expect(commonestStarting('pl', 'y', none)).not.toBeNull();
    expect(countStarting('pl', 'y', none)).toBeLessThan(MIN_ANSWERS.pl);

    const stranding = ['they', 'may', 'day', 'okay'].find(
      (word) => fold(word).endsWith('y') && chainLookup('en', word),
    );
    expect(stranding).toBeDefined();
    const error = refuse(playing('en', 'pl'), { type: 'say', word: stranding as string });
    expect(error).toContain(LANG_NAME.pl);
    expect(error).toContain('Y');
  });

  /**
   * The letters each bar takes off the board, measured rather than remembered.
   * If a rebuild of the lists moves one of these, `MIN_ANSWERS` wants
   * re-reading and not just re-running — its comment quotes this distribution
   * and the gaps the two numbers sit in.
   */
  it('is exactly the letters the two floors were chosen around', () => {
    const thin = (lang: ChainLang): string =>
      [...'abcdefghijklmnopqrstuvwxyz']
        .filter((letter) => countStarting(lang, letter, none) < MIN_ANSWERS[lang])
        .join('');
    expect(thin('en')).toBe('x');
    expect(thin('pl')).toBe('qvxy');
    expect(thin('ja')).toBe('lqvx');
  });

  /**
   * English is set low on purpose so that Z and Q survive it. They are thin —
   * fifty and ninety-three — but *zebra* and *question* are words anybody can
   * find, and a bar high enough to take them would be the game refusing
   * letters on the player's behalf.
   */
  it('keeps English Q and Z, which are thin and perfectly playable', () => {
    for (const letter of 'qz') {
      expect(countStarting('en', letter, none)).toBeGreaterThanOrEqual(MIN_ANSWERS.en);
    }
    // `quiz` ends in a Z, so it is the word that proves the letter is handable.
    expect(say(playing('en', 'en'), 'quiz').required).toBe('z');
  });

  /**
   * The tightest of the three, named because it is the one a rebuild could
   * break without anybody noticing: Japanese W clears its floor by three
   * words. If this fails, the Japanese floor is what to look at — not this
   * test.
   */
  it('keeps Japanese W, which clears its floor by three words', () => {
    expect(countStarting('ja', 'w', none)).toBeGreaterThanOrEqual(MIN_ANSWERS.ja);
  });

  it('lets every ordinary letter through in both alphabetic languages', () => {
    for (const lang of ['en', 'pl'] as ChainLang[]) {
      for (const letter of 'abcdefghijklmnoprstuw') {
        expect(countStarting(lang, letter, none)).toBeGreaterThanOrEqual(MIN_ANSWERS[lang]);
      }
    }
  });
});

/**
 * Two players in the same language get their accents back. See point 4 in the
 * reducer: there is nobody to strand, so there is no reason to flatten the
 * most characteristic letters in the language.
 */
describe('a same-language chain', () => {
  const none = new Set<string>();

  it('is strict when the languages match and loose when they do not', () => {
    expect(playing('pl', 'pl').strict).toBe(true);
    expect(playing('pl', 'en').strict).toBe(false);
    expect(playing('en', 'pl').strict).toBe(false);
  });

  it('is decided once, and is false throughout setup', () => {
    expect(opened().strict).toBe(false);
    const half = wordChain.applyMove(opened(), { type: 'lang', lang: 'pl' }, 0, rng, 1_000);
    expect(half.ok && half.state.strict).toBe(false);
  });

  /**
   * The whole point of it, in one word. `coś` ends in `ś`, and a strict chain
   * asks for a word that starts with one — of which Polish has hundreds,
   * *świat* and *światło* among them.
   */
  it('carries the accent to the next word instead of flattening it', () => {
    const state = say(playing('pl', 'pl'), 'coś');
    expect(state.required).toBe('ś');
    expect(say(state, 'świat').chain[1].word).toBe('świat');
  });

  it('takes the accented word typed without its accents, which is the bargain', () => {
    // The rule is checked on the stored word, never on what was typed, so a
    // phone keyboard is enough to play a strict Polish chain.
    const state = say(playing('pl', 'pl'), 'coś');
    expect(say(state, 'swiatlo').chain[1].word).toBe('światło');
  });

  it('refuses a plain S where an accented one was asked for', () => {
    const state = say(playing('pl', 'pl'), 'coś');
    expect(refuse(state, { type: 'say', word: 'sen' })).toContain('Ś');
  });

  it('flattens the same word back to an s when the opponent is elsewhere', () => {
    const state = say(playing('pl', 'en'), 'coś');
    expect(state.required).toBe('s');
    // And the plain S is now the right answer, because an English player has
    // no other kind.
    expect(say(state, 'some').chain[1].word).toBe('some');
  });

  /**
   * "Given they're possible", which is not a separate rule — it is the same
   * `MIN_ANSWERS` gate that keeps a Japanese player off an L. Five of the nine
   * accented letters begin no Polish word at all, so a word ending in one is
   * refused; the three that begin hundreds are handed over happily.
   */
  it('hands over the accented letters that have words behind them', () => {
    for (const letter of 'łśż') {
      expect(countStarting('pl', letter, none, 'strict')).toBeGreaterThanOrEqual(MIN_ANSWERS.pl);
    }
  });

  it('refuses a word ending in an accent no Polish word begins with', () => {
    for (const letter of 'ąęńóź') {
      expect(countStarting('pl', letter, none, 'strict')).toBeLessThan(MIN_ANSWERS.pl);
    }
    // `się` is the second commonest word in the language and ends in `ę`,
    // which begins none of them — so a strict chain will not take it, and says
    // why rather than merely refusing.
    const error = refuse(playing('pl', 'pl'), { type: 'say', word: 'się' });
    expect(error).toContain(LANG_NAME.pl);
    expect(error).toContain('Ę');
    // The same word in a cross-language game is fine: it hands on an `e`.
    expect(say(playing('pl', 'en'), 'się').required).toBe('e');
  });

  /**
   * English and Japanese have no accented forms between them, so the two modes
   * are the same game there. Worth pinning: it is the reason strict mode could
   * be turned on for every same-language pairing rather than only for Polish.
   */
  it('changes nothing at all in English or Japanese', () => {
    for (const lang of ['en', 'ja'] as ChainLang[]) {
      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        expect(countStarting(lang, letter, none, 'strict')).toBe(
          countStarting(lang, letter, none),
        );
      }
    }
  });

  it('folds case and punctuation but keeps every Polish letter', () => {
    expect(foldStrict('Światło!')).toBe('światło');
    expect(fold('Światło!')).toBe('swiatlo');
  });
});

/**
 * Losing on purpose. The reveal is the reason to play, so a player who already
 * knows the minute is gone should be able to reach it without spending the
 * rest of the minute — it is the same ending, and it says so.
 */
describe('giving up', () => {
  /** A game where seat 1 is on the clock, answering an E in Polish. */
  const onTheSpot = (): WcState => say(playing('en', 'pl', 0), 'apple', 0);

  it('ends the game against whoever pressed it, and reveals the word', () => {
    const state = onTheSpot();
    expect(state.at).toBe(1);

    const result = wordChain.applyMove(state, { type: 'give-up' }, 1, rng, 1_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.phase).toBe('over');
    expect(result.state.loser).toBe(1);
    expect(result.state.gaveUp).toBe(true);
    expect(result.state.deadline).toBeNull();
    expect(wordChain.isOver(result.state)).toBe(true);
    expect(result.state.reveal?.lang).toBe('pl');
    expect(result.state.reveal?.key.startsWith('e')).toBe(true);
  });

  it('reveals what the clock would have, because it is the same ending', () => {
    const state = onTheSpot();
    const given = wordChain.applyMove(state, { type: 'give-up' }, 1, rng, 1_000);
    const timed = wordChain.expire?.(state, TURN_MS) ?? null;
    if (!given.ok) throw new Error(given.error);
    expect(given.state.reveal?.word).toBe(timed?.reveal?.word);
    // The one thing that tells the two apart, and only the copy reads it.
    expect(given.state.gaveUp).toBe(true);
    expect(timed?.gaveUp).toBe(false);
  });

  it('says so, rather than blaming a clock that still had time on it', () => {
    const given = wordChain.applyMove(onTheSpot(), { type: 'give-up' }, 1, rng, 1_000);
    if (!given.ok) throw new Error(given.error);
    const line = wordChain.status(given.state, ['Ada', 'Bo']);
    expect(line).toContain('Bo gave up');
    expect(line).toContain('Ada wins');
    expect(line).not.toContain('time');
  });

  it('is not a way to make the other player lose', () => {
    expect(refuse(onTheSpot(), { type: 'give-up' }, 0)).toBe('Not your move.');
  });

  /**
   * Setup is the one phase where `canAct` lets both seats through, so the move
   * would be accepted there without this — and a player who does not want to
   * pick a language is already handled by `expire`, which gives them English
   * rather than a loss.
   */
  it('is refused before the game has started', () => {
    expect(refuse(opened(), { type: 'give-up' }, 0, 1_000)).toBe('The game has not started.');
  });

  it('cannot be pressed twice, or after the whistle', () => {
    const given = wordChain.applyMove(onTheSpot(), { type: 'give-up' }, 1, rng, 1_000);
    if (!given.ok) throw new Error(given.error);
    expect(refuse(given.state, { type: 'give-up' }, 1, 2_000)).toBe('Not your move.');
    expect(canAct(given.state, 0)).toBe(false);
    expect(canAct(given.state, 1)).toBe(false);
    expect(wordChain.expire?.(given.state, TURN_MS * 9) ?? null).toBeNull();
  });
});

/**
 * How long each word took, which is the one thing about a game of this that
 * cannot be reconstructed afterwards: the clock is a single `deadline` that
 * every accepted word overwrites, so a turn not measured as it ends is gone.
 */
describe('the time a word took', () => {
  it('is the part of the minute that had gone when it was said', () => {
    const start = 1_000;
    const state = say(playing('en', 'pl', start), 'apple', start + 12_000);
    expect(state.chain[0].ms).toBe(12_000);
  });

  it('is measured from the turn, not from the game', () => {
    const start = 1_000;
    const first = say(playing('en', 'pl', start), 'apple', start + 12_000);
    // The second player's minute began when the first word landed, so a word
    // said four seconds later took four seconds and not sixteen.
    const second = say(first, 'efekt', start + 16_000);
    expect(second.chain[1].ms).toBe(4_000);
  });

  /**
   * A refusal costs seconds and leaves the clock alone, so the time a word
   * took includes every wrong guess before it. That is the honest number: the
   * minute is what the player spent, not what the accepted word cost them.
   */
  it('includes the time spent on words that were refused', () => {
    const start = 1_000;
    let state = playing('en', 'pl', start);
    refuse(state, { type: 'say', word: 'qqqqq' }, 0, start + 8_000);
    state = say(state, 'apple', start + 20_000);
    expect(state.chain[0].ms).toBe(20_000);
  });

  it('never lands outside the minute, whatever clock it is handed', () => {
    const start = 1_000;
    // A clock behind the one the deadline was set from -- restored rooms and
    // adapters both make this possible, and a negative would poison every
    // average built on it.
    const early = say(playing('en', 'pl', start), 'apple', start - 5_000);
    expect(early.chain[0].ms).toBe(0);
  });

  it('is zero on the reveal, which nobody played', () => {
    const state = say(playing('en', 'pl', 0), 'apple', 0);
    expect((wordChain.expire?.(state, TURN_MS) ?? null)?.reveal?.ms).toBe(0);
  });
});

/**
 * The clock tightening as the chain grows. Two players who can both keep going
 * forever have to be stopped by something, and this is it.
 */
describe('the shrinking minute', () => {
  it('gives the whole minute away until the chain has three words', () => {
    for (let said = 0; said < TURN_STEP_WORDS; said += 1) {
      expect(turnMsFor(said)).toBe(TURN_MS);
    }
    expect(turnMsFor(TURN_STEP_WORDS)).toBe(TURN_MS - TURN_STEP_MS);
  });

  it('takes a second off every three words, and then stops taking', () => {
    expect(turnMsFor(3 * TURN_STEP_WORDS)).toBe(TURN_MS - 3 * TURN_STEP_MS);
    // A word that is part-way through a step buys nothing yet, which is the
    // off-by-one this whole ramp is most likely to get wrong.
    expect(turnMsFor(3 * TURN_STEP_WORDS + 1)).toBe(TURN_MS - 3 * TURN_STEP_MS);

    // The floor, and one step before it, so a mistake in either direction
    // shows up as a number rather than as a game nobody can play.
    const lastStep = ((TURN_MS - MIN_TURN_MS) / TURN_STEP_MS) * TURN_STEP_WORDS;
    expect(lastStep).toBe(150);
    expect(turnMsFor(lastStep - TURN_STEP_WORDS)).toBe(MIN_TURN_MS + TURN_STEP_MS);
    expect(turnMsFor(lastStep)).toBe(MIN_TURN_MS);
    expect(turnMsFor(lastStep + 10_000)).toBe(MIN_TURN_MS);
  });

  it('never goes under the floor, or negative, however long the chain', () => {
    for (const said of [0, 1, 7, 300, 5_000, 1e9]) {
      expect(turnMsFor(said)).toBeGreaterThanOrEqual(MIN_TURN_MS);
      expect(turnMsFor(said)).toBeLessThanOrEqual(TURN_MS);
    }
  });

  it('hands the fourth word a shorter clock than the first three', () => {
    const start = 1_000;
    let state = playing('en', 'en', start);
    let at = start;
    // Six real words, each answered the instant it is asked for, so the only
    // thing moving between the deadlines is the length of the chain.
    for (const word of ['apple', 'every', 'yellow', 'water', 'red', 'door']) {
      at += 1_000;
      state = say(state, word, at);
      expect(state.deadline).toBe(at + turnMsFor(state.chain.length));
      // Two steps down over six words, and the second and third words of each
      // step cost nothing -- the assertion above is generic, this is the shape
      // of the thing it is generic over.
      const steps = Math.floor(state.chain.length / TURN_STEP_WORDS);
      expect(state.deadline).toBe(at + TURN_MS - steps * TURN_STEP_MS);
    }
    expect(state.deadline).toBe(at + TURN_MS - 2 * TURN_STEP_MS);
  });

  /**
   * The clock is still the losing condition, and it is the shortened one that
   * has to fire -- a game that tightens the deadline but expires on the old
   * minute has not tightened anything.
   */
  it('ends the game on the shortened clock, not on the minute', () => {
    const start = 0;
    let state = playing('en', 'en', start);
    // A chain long enough to have lost a third of the minute, said instantly
    // so the deadline below is the whole of what the seat was given.
    const had = turnMsFor(60);
    expect(had).toBe(TURN_MS - 20 * TURN_STEP_MS);
    state = { ...state, chain: padded(60), deadline: start + had };
    expect(wordChain.expire?.(state, start + had - 1) ?? null).toBeNull();
    expect((wordChain.expire?.(state, start + had) ?? null)?.phase).toBe('over');
  });

  it('measures a word against the clock it was actually given', () => {
    const start = 0;
    let state = playing('en', 'en', start);
    state = { ...state, chain: padded(60), deadline: start + turnMsFor(60) };
    // Nine seconds into a forty-second turn. Measured against the minute it
    // would read as twenty-nine, and every average on the end screen would be
    // wrong by the whole of the ramp for the rest of the game.
    state = say(state, 'apple', start + 9_000);
    expect(state.chain[state.chain.length - 1].ms).toBe(9_000);
  });

  it('still gives setup the full minute, since nobody can lose it', () => {
    const state = opened(7_000);
    expect(state.deadline).toBe(7_000 + TURN_MS);
  });
});

/**
 * The end-of-game stats. Worth pinning rather than eyeballing: a mean over the
 * wrong denominator and a "rarest" that is really "rarest in the biggest list"
 * both look perfectly reasonable on the screen.
 */
describe('the end-of-game stats', () => {
  it('holds the list sizes the board divides by', () => {
    // The board may not reach a word list, so it carries three integers
    // instead. If a rebuild moves a list, this is where it is caught -- every
    // percentage on the end screen is quietly wrong otherwise.
    expect(LIST_SIZE).toEqual(chainListSizes());
  });

  it('averages each seat over its own words, not over the chain', () => {
    const start = 1_000;
    let state = say(playing('en', 'pl', start), 'apple', start + 10_000);
    state = say(state, 'efekt', start + 10_000 + 20_000);
    const stats = chainStats(state);
    expect(stats.seats.map((s) => s.said)).toEqual([1, 1]);
    expect(stats.seats[0].ms).toBe(10_000);
    expect(stats.seats[1].ms).toBe(20_000);
    expect(stats.seats[0].letters).toBe(5);
  });

  it('counts a letter as a letter, however many bytes it took', () => {
    // `żółty` is five letters and eight UTF-16 code units. A mean word length
    // measured in `.length` would report Polish as the wordier language.
    const state = say(playing('pl', 'en'), 'zolty');
    expect(state.chain[0].word).toBe('żółty');
    expect(chainStats(state).seats[0].letters).toBe(5);
  });

  it('measures how common a word was against its own language', () => {
    const state = say(playing('en', 'pl'), 'apple');
    const link = state.chain[0];
    expect(chainStats(state).seats[0].percentile).toBeCloseTo(link.rank / LIST_SIZE.en, 10);
  });

  /**
   * The comparison the percentile exists to make honest. The Japanese list is
   * half the size of the English one, so the same rank is a much rarer word in
   * English -- a table of mean ranks would say the opposite.
   */
  it('does not call the smaller list the rarer vocabulary', () => {
    expect(LIST_SIZE.ja).toBeLessThan(LIST_SIZE.en);
    const fake: WcState = {
      ...playing('en', 'ja'),
      chain: [
        { word: 'a', key: 'a', lang: 'en', seat: 0, gloss: '', script: '', lemma: '', rank: 6_000, ms: 0 },
        { word: 'b', key: 'b', lang: 'ja', seat: 1, gloss: '', script: '', lemma: '', rank: 6_000, ms: 0 },
      ],
    };
    const stats = chainStats(fake);
    expect(stats.seats[1].percentile).toBeGreaterThan(stats.seats[0].percentile);
    expect(stats.rarest?.link.lang).toBe('ja');
  });

  it('picks the slowest word, the rarest and the longest, and says where each was', () => {
    const start = 1_000;
    let state = say(playing('en', 'en', start), 'apple', start + 5_000);
    state = say(state, 'elephant', start + 5_000 + 50_000);
    const stats = chainStats(state);
    expect(stats.closest?.turn).toBe(2);
    expect(stats.closest?.link.word).toBe('elephant');
    expect(stats.longest?.link.word).toBe('elephant');
    expect(stats.rarest?.link.rank).toBe(
      Math.max(...state.chain.map((link) => link.rank)),
    );
  });

  it('keeps the earlier word when two tie, so the same chain always reads the same', () => {
    const start = 1_000;
    let state = say(playing('en', 'en', start), 'apple', start + 5_000);
    state = say(state, 'eagle', start + 5_000 + 5_000);
    // Both five letters, both five seconds.
    expect(state.chain[0].ms).toBe(state.chain[1].ms);
    const stats = chainStats(state);
    expect(stats.closest?.turn).toBe(1);
    expect(stats.longest?.turn).toBe(1);
  });

  it('has a row for a seat that never said anything, and it is empty rather than wrong', () => {
    const state = playing('en', 'pl');
    const stats = chainStats(state);
    expect(stats.seats).toHaveLength(2);
    expect(stats.seats[0].said).toBe(0);
    expect(stats.seats[0].letters).toBe(0);
    expect(stats.seats[0].percentile).toBe(0);
    expect(stats.closest).toBeNull();
  });
});
