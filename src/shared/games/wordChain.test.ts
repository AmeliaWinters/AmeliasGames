import { describe, expect, it } from 'vitest';
import {
  LANG_NAME,
  MIN_LENGTH,
  TURN_MS,
  canAct,
  wordChain,
  type ChainLang,
  type WcMove,
  type WcState,
} from './wordChain.js';
import { chainListSizes, chainLookup, commonestStarting, fold } from './chainDictionary.js';

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
