import { describe, expect, it } from 'vitest';
import {
  CHAIN_DEFAULT_LEVEL,
  HINT_AT,
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
  THIN_START,
  MAX_LOCK,
  lockTurns,
  lockedFor,
  missFor,
  usedKeys,
  chainHintSteps,
  hintsFor,
  levelOf,
  maskWord,
  scoreFor,
  targetScore,
  turnMsFor,
  wordPoints,
  wordChain,
  type ChainLang,
  type ChainLevel,
  type WcMove,
  type WcState,
} from './wordChain.js';
import {
  chainListSizes,
  chainLookup,
  chainRanked,
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

/** Both players said what they were, then chose a language. */
function levelled(levels: [ChainLevel, ChainLevel], langs: [ChainLang, ChainLang]): WcState {
  let state = opened();
  for (const seat of [0, 1] as const) {
    const result = wordChain.applyMove(
      state,
      { type: 'level', level: levels[seat] },
      seat,
      rng,
      1_000,
    );
    if (!result.ok) throw new Error(result.error);
    state = result.state;
  }
  for (const seat of [0, 1] as const) {
    const result = wordChain.applyMove(state, { type: 'lang', lang: langs[seat] }, seat, rng, 1_000);
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

  it('gives each player a fresh clock when they answer', () => {
    const state = say(playing('en', 'en', 1_000), 'apple', 20_000);
    // A minute less the one word now on the chain -- the ramp starts biting
    // from the very first answer. See `turnMsFor`.
    expect(state.deadline).toBe(20_000 + turnMsFor(1));
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
   * nothing to answer. See the header of `wordChain.ts`.
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

/**
 * The reveal, when the player who lost the minute has a ledger.
 *
 * The one thing the study list changes, and the reason it exists: a player who
 * has met a word before and come back round to it learns more from being shown
 * *that* word than from being shown the commonest one on the letter. Everything
 * here is written against the list rather than against a word spelled out in
 * the test, because a rebuild of `chainWords.ts` moves every rank and a
 * hardcoded `elektryczny` would fail for the wrong reason. See
 * `commonestStarting`.
 */
describe('a reveal aimed at what you are due to review', () => {
  /** Both seats decided, seat 1 carrying `due` in Polish. */
  function withStudy(due: string[], now = 0): WcState {
    let state = wordChain.setup(2, rng, now, [{}, { pl: due }]);
    state = wordChain.start?.(state, now) ?? state;
    for (const [seat, lang] of [[0, 'en'], [1, 'pl']] as const) {
      const result = wordChain.applyMove(state, { type: 'lang', lang }, seat, rng, now);
      if (!result.ok) throw new Error(result.error);
      state = result.state;
    }
    return state;
  }

  /**
   * A glossed Polish word starting with `letter` that is *not* what the reveal
   * would pick on its own, with the folded lemma the ledger would file it
   * under.
   *
   * The lemma, not the key: a profile files `jestem` under `być`, so a study
   * list holding the played form would never match anything. `linkLearned` is
   * the other half of this rule and the two have to agree.
   */
  function deeper(letter: string): { key: string; due: string } {
    const first = commonestStarting('pl', letter, new Set());
    const found = chainRanked('pl').find(
      (entry) =>
        entry.key.startsWith(letter) && entry.gloss !== '' && entry.key !== first?.key,
    );
    if (!found) throw new Error(`no second glossed Polish word on ${letter}`);
    return { key: found.key, due: fold(found.lemma || found.word) };
  }

  it('shows the word they owe a review on rather than the commonest one', () => {
    const target = deeper('e');
    const state = say(withStudy([target.due]), 'apple', 0);
    const settled = wordChain.expire?.(state, TURN_MS) ?? null;
    expect(missFor(settled as WcState, 1)?.reveal?.key).toBe(target.key);
  });

  it('falls back to the commonest word when nothing due fits the letter', () => {
    // A key no folded key can be: every one of them is letters. So the list is
    // non-empty, which is the case worth covering -- an empty one takes a
    // different branch in `commonestStarting`.
    const plain = say(playing('en', 'pl', 0), 'apple', 0);
    const state = say(withStudy(['no-such-word']), 'apple', 0);
    expect(missFor(wordChain.expire?.(state, TURN_MS) as WcState, 1)?.reveal?.word).toBe(
      missFor(wordChain.expire?.(plain, TURN_MS) as WcState, 1)?.reveal?.word,
    );
  });

  it('reads only the list of the seat that lost the minute', () => {
    // Seat 0's ledger has nothing to do with seat 1's minute, and a reveal
    // that consulted it would be teaching the wrong player.
    const target = deeper('e');
    let state = wordChain.setup(2, rng, 0, [{ pl: [target.due] }, {}]);
    state = wordChain.start?.(state, 0) ?? state;
    for (const [seat, lang] of [[0, 'en'], [1, 'pl']] as const) {
      state = (wordChain.applyMove(state, { type: 'lang', lang }, seat, rng, 0) as
        { ok: true; state: WcState }).state;
    }
    const settled = wordChain.expire?.(say(state, 'apple', 0), TURN_MS) ?? null;
    expect(missFor(settled as WcState, 1)?.reveal?.key).not.toBe(target.key);
  });

  it('never offers a word already said, however overdue it is', () => {
    const target = deeper('e');
    const entry = chainLookup('pl', target.key);
    expect(entry).not.toBeNull();
    const used = new Set([target.key]);
    expect(commonestStarting('pl', 'e', used, 'loose', new Set(), new Set([target.due]))?.key)
      .not.toBe(target.key);
  });

  it('is a language at a time, so a key due in one cannot reach another', () => {
    // `fold` maps onto twenty-six letters, so Polish and English keys collide
    // as a matter of course. A flat set would show a Polish learner a word on
    // the strength of an English row.
    const target = deeper('e');
    const state = say(withStudy([]), 'apple', 0);
    const settledEn = wordChain.setup(2, rng, 0, [{}, { en: [target.due] }]);
    expect(settledEn.study[1].pl).toBeUndefined();
    expect(missFor(wordChain.expire?.(state, TURN_MS) as WcState, 1)?.reveal).not.toBeNull();
  });

  it("shows a seat its own list and nobody else's", () => {
    const state = withStudy(['zebra']);
    expect(wordChain.view?.(state, 1).study[1].pl).toEqual(['zebra']);
    expect(wordChain.view?.(state, 0).study[1]).toEqual({});
    // And its own is untouched, or a reconnecting player would lose it.
    expect(wordChain.view?.(state, 1).study[0]).toEqual({});
  });

  it('deals a game with no study list at all, which is every guest room', () => {
    const state = wordChain.setup(2, rng, 0);
    expect(state.study).toEqual([{}, {}]);
  });

  /**
   * A room dealt before this field existed and restored from storage since.
   * The field is required on anything the server deals, so this state cannot
   * arise any other way -- and it is not worth a `SNAPSHOT_VERSION` bump,
   * which would delete every live room to add a reveal preference. See
   * `studyFor`.
   */
  it('reveals as it always did for a state stored before study lists', () => {
    const fresh = say(playing('en', 'pl', 0), 'apple', 0);
    const { study: _dropped, ...older } = fresh;
    const stored = older as WcState;
    expect(stored.study).toBeUndefined();
    expect(() => wordChain.view?.(stored, 0)).not.toThrow();
    expect(missFor(wordChain.expire?.(stored, TURN_MS) as WcState, 1)?.reveal?.word).toBe(
      missFor(wordChain.expire?.(fresh, TURN_MS) as WcState, 1)?.reveal?.word,
    );
  });
});

describe('running out of time', () => {
  it('ends the game, names the loser, and reveals a word they could have said', () => {
    // Seat 1 has said nothing and seat 0 has five points on the board, so
    // there is nothing here for a chase to do. See `ChainMiss`.
    const state = say(playing('en', 'pl', 0), 'apple', 0);
    expect(state.at).toBe(1);

    const settled = wordChain.expire?.(state, TURN_MS) ?? null;
    expect(settled).not.toBeNull();
    expect(settled?.phase).toBe('over');
    expect(settled?.loser).toBe(1);
    expect(wordChain.isOver(settled as WcState)).toBe(true);

    // The reveal is the reason the lists are frequency-ordered at all.
    const reveal = missFor(settled as WcState, 1)?.reveal;
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

  it('is the only way out, and nobody misses before the clock says so', () => {
    const state = say(playing('en', 'en', 0), 'apple', 0);
    // The turn's own deadline, not the minute: the ramp has already taken a
    // second off it, and this is a test about the clock rather than about
    // which number the clock happens to be showing.
    expect(wordChain.expire?.(state, (state.deadline ?? 0) - 1) ?? null).toBeNull();
    expect(state.loser).toBeNull();
    expect(state.misses).toEqual([]);
  });
});

/**
 * The lists cost bytes on every cold start of the worker and exist to be
 * *common* words, so both ends are worth pinning: too small and a player's
 * ordinary vocabulary is refused, too large and the game is paying for words
 * nobody will ever type.
 *
 * Polish gets its own ceiling because it is built differently. English and
 * Japanese are a frequency list cut off at a round number; Polish is that plus
 * every dictionary headword PoliMorf agrees is a word, sorted to the bottom,
 * because film subtitles are a poor account of what a speaker knows and the
 * game was refusing `arbuz`. Those words cost almost nothing, being
 * alphabetical and so compressible, and the reveal never offers them, so the
 * ceiling that matters for them is the worker's rather than this one.
 */
describe('the word lists', () => {
  const sizes = chainListSizes();

  it('holds a usable vocabulary in each language', () => {
    expect(sizes.en).toBeGreaterThanOrEqual(50_000);
    expect(sizes.pl).toBeGreaterThan(20_000);
    expect(sizes.ja).toBeGreaterThan(10_000);
    // English is the widest of the three and the one with the most room to
    // grow, so its ceiling is the worker's rather than a linguistic judgement.
    // See the size budget in `scripts/build-wordchain.ts`.
    expect(sizes.en).toBeLessThan(60_000);
    expect(sizes.ja).toBeLessThan(35_000);
    expect(sizes.pl).toBeLessThan(70_000);
  });

  /**
   * The bug this pins: the Polish list was built from film subtitles, and
   * films do not talk about watermelons. `arbuz` appears in fifty thousand
   * words of dialogue exactly never, only `arbuza`, the genitive, at rank
   * 43,067, so the game refused the word every Polish learner knows, along
   * with the electrician, the giraffe and the raspberry. Two things fixed it:
   * a word's forms now pool their counts onto its lemma, and a dictionary
   * headword PoliMorf agrees is a word gets in on that alone.
   *
   * A sample rather than a rule, because there is no rule: the list is only as
   * good as the sources, and this is how anyone would notice it got worse.
   */
  it('knows the everyday words that films never mention', () => {
    const everyday = [
      'arbuz', 'elektryk', 'awantura', 'zyrafa', 'malina', 'ogorek',
      'truskawka', 'cebula', 'sliwka', 'ananas', 'hydraulik', 'listonosz',
      'marchewka', 'wiewiorka', 'pomidor', 'papuga', 'kanapka', 'dentysta',
    ];
    expect(everyday.filter((w) => chainLookup('pl', w) === null)).toEqual([]);
  });

  /**
   * The other half of the same change, and the half that can rot quietly.
   * Rolling counts onto lemmas is what pulls a verb's infinitive up to where
   * it belongs, and WikDict has an entry for almost no Polish perfective, so
   * the words the game shows most often arrived at the top *unglossed* until
   * `PL_OVERRIDE` was extended to cover them. A reveal without a meaning is a
   * teaching moment spent on nothing.
   */
  it('can say what it means, for the words it shows most', () => {
    const top = [];
    const used = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const entry = commonestStarting('pl', '', used);
      if (!entry) break;
      used.add(entry.key);
      top.push(entry);
    }
    expect(top).toHaveLength(200);
    expect(top.filter((e) => !e.gloss)).toEqual([]);
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
 * this?" as far as the client is concerned, since it has no list to ask.
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
   * right: the sources are frequency-ordered but hold words the list drops
   * (too short, or an inflection folding onto a key already taken) and the two
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
    const over = wordChain.expire?.(state, TURN_MS) ?? null;
    expect(missFor(over as WcState, 1)?.reveal?.rank).toBeGreaterThan(0);
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
    // of the very count it was drawn from, the only clean way to watch the
    // number move without changing letter or language underneath it.
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
   * re-reading and not just re-running; its comment quotes this distribution
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
   * English is set low on purpose so that Z and Q survive it. They are thin,
   * fifty and ninety-three, but *zebra* and *question* are words anybody can
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
   * words. If this fails, the Japanese floor is what to look at rather than
   * this test.
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
   * asks for a word that starts with one, of which Polish has hundreds,
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
   * "Given they're possible", which is not a separate rule but the same
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
    // which begins none of them, so a strict chain will not take it and says
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
 * rest of the minute. It is the same ending, and it says so.
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
    expect(missFor(result.state, 1)?.gaveUp).toBe(true);
    expect(result.state.deadline).toBeNull();
    expect(wordChain.isOver(result.state)).toBe(true);
    expect(missFor(result.state, 1)?.reveal?.lang).toBe('pl');
    expect(missFor(result.state, 1)?.reveal?.key.startsWith('e')).toBe(true);
  });

  it('reveals what the clock would have, because it is the same ending', () => {
    const state = onTheSpot();
    const given = wordChain.applyMove(state, { type: 'give-up' }, 1, rng, 1_000);
    const timed = wordChain.expire?.(state, TURN_MS) ?? null;
    if (!given.ok) throw new Error(given.error);
    expect(missFor(given.state, 1)?.reveal?.word).toBe(missFor(timed as WcState, 1)?.reveal?.word);
    // The one thing that tells the two apart, and only the copy reads it.
    expect(missFor(given.state, 1)?.gaveUp).toBe(true);
    expect(missFor(timed as WcState, 1)?.gaveUp).toBe(false);
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
   * would be accepted there without this, and a player who does not want to
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
    const over = wordChain.expire?.(state, TURN_MS) ?? null;
    expect(missFor(over as WcState, 1)?.reveal?.ms).toBe(0);
  });
});

/**
 * The clock tightening as the chain grows. Two players who can both keep going
 * forever have to be stopped by something, and this is it.
 */
describe('the shrinking minute', () => {
  it('gives the whole minute away only to the words before the first step', () => {
    for (let said = 0; said < TURN_STEP_WORDS; said += 1) {
      expect(turnMsFor(said)).toBe(TURN_MS);
    }
    expect(turnMsFor(TURN_STEP_WORDS)).toBe(TURN_MS - TURN_STEP_MS);
  });

  it('takes a second off every word, and then stops taking', () => {
    expect(turnMsFor(3 * TURN_STEP_WORDS)).toBe(TURN_MS - 3 * TURN_STEP_MS);
    // Every word costs, which is the whole of the rule now the step is one:
    // the next word down is a second cheaper and not the same price.
    expect(turnMsFor(4 * TURN_STEP_WORDS)).toBe(TURN_MS - 4 * TURN_STEP_MS);

    // The floor, and one step before it, so a mistake in either direction
    // shows up as a number rather than as a game nobody can play.
    const lastStep = ((TURN_MS - MIN_TURN_MS) / TURN_STEP_MS) * TURN_STEP_WORDS;
    // 55 words, which two players who are enjoying themselves will reach.
    expect(lastStep).toBe(55);
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

  it('hands every word a shorter clock than the one before it', () => {
    const start = 1_000;
    let state = playing('en', 'en', start);
    let at = start;
    // Six real words, each answered the instant it is asked for, so the only
    // thing moving between the deadlines is the length of the chain.
    // No two of one seat's words share an ending: this is a test about the
    // clock, and a cooldown refusal here would fail it for the wrong reason.
    for (const word of ['apple', 'every', 'yellow', 'water', 'red', 'dance']) {
      at += 1_000;
      state = say(state, word, at);
      expect(state.deadline).toBe(at + turnMsFor(state.chain.length));
      // Six steps down over six words -- the assertion above is generic, this
      // is the shape of the thing it is generic over.
      const steps = Math.floor(state.chain.length / TURN_STEP_WORDS);
      expect(state.deadline).toBe(at + TURN_MS - steps * TURN_STEP_MS);
    }
    expect(state.deadline).toBe(at + TURN_MS - 6 * TURN_STEP_MS);
  });

  /**
   * The clock is still the losing condition, and it is the shortened one that
   * has to fire -- a game that tightens the deadline but expires on the old
   * minute has not tightened anything.
   */
  it('takes a seat out on the shortened clock, not on the minute', () => {
    const start = 0;
    let state = playing('en', 'en', start);
    // A chain long enough to have lost a third of the minute, said instantly
    // so the deadline below is the whole of what the seat was given.
    const had = turnMsFor(20);
    expect(had).toBe(TURN_MS - 20 * TURN_STEP_MS);
    state = { ...state, chain: padded(20), deadline: start + had };
    expect(wordChain.expire?.(state, start + had - 1) ?? null).toBeNull();
    // The padding gives both seats the same score, so the minute costs the
    // chain rather than the game: a chase, and a miss on the record.
    const gone = wordChain.expire?.(state, start + had) ?? null;
    expect(gone?.phase).toBe('chase');
    expect(gone?.misses.length).toBe(1);
  });

  it('measures a word against the clock it was actually given', () => {
    const start = 0;
    let state = playing('en', 'en', start);
    state = { ...state, chain: padded(20), deadline: start + turnMsFor(20) };
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
/**
 * Handing a letter over puts it out of that seat's reach when the seat who has
 * to answer it has hardly anything to answer with: see `lockTurns`.
 *
 * The parts worth pinning are the ones a "simplification" would quietly move:
 * the price comes from the pool of words still *starting* with that letter in
 * the *answering* seat's language, not from the ending's own pool and not from
 * the seat's history with it, the wait is counted in the seat's own turns, a
 * free ending stores nothing at all, and the pool is the one the game's mode
 * links on.
 */
describe('a thin hand-off', () => {
  /** The letters the seat on the clock may not end on, and for how long. */
  const locks = (state: WcState): Record<string, number> =>
    Object.fromEntries(lockedFor(state, state.at).map((cool) => [cool.letter, cool.turns]));

  /** How long `seat` has left on one letter. Zero when it is theirs to use. */
  const wait = (state: WcState, seat: number, letter: string): number =>
    lockedFor(state, seat).find((cool) => cool.letter === letter)?.turns ?? 0;

  /** Play on from `state`, a chain already checked to be legal word by word. */
  const on = (state: WcState, ...words: string[]): WcState =>
    words.reduce((so_far, word) => say(so_far, word), state);

  const chain = (a: ChainLang, b: ChainLang, ...words: string[]): WcState =>
    on(playing(a, b), ...words);

  it('is a cliff at the bar and nothing either side of it', () => {
    // Flat, not a ramp. Held here rather than only in the reducer because a
    // slope through these points would satisfy the two ends and be a different
    // rule: the player is promised five turns, not "up to" five.
    expect(lockTurns(THIN_START)).toBe(0);
    expect(lockTurns(THIN_START + 5_000)).toBe(0);
    expect(lockTurns(THIN_START - 1)).toBe(MAX_LOCK);
    expect(lockTurns(0)).toBe(MAX_LOCK);
  });

  it('leaves a roomy letter free, however often it is handed over', () => {
    // Eighteen hundred English words start with E, so leaving somebody on an E
    // is not a thing anybody needs protecting from.
    const state = chain('en', 'en', 'apple', 'east', 'take', 'end', 'dark');
    expect(locks(state)).toEqual({});
    // Seat 0 has handed over an E twice and paid nothing either time.
    expect(wait(state, 0, 'e')).toBe(0);
    // And nothing is written down either: a row saying "this letter is fine"
    // is a row that can rot into a lock.
    expect(state.cooldowns[0]).toEqual([]);
  });

  it('locks a letter the next player is thin in', () => {
    // The case the rule exists for. Only 228 English words start with Y, so
    // ending on one leaves the other player almost nothing -- and under the
    // count this used to be priced on, the four thousand words that *end* in Y
    // made it free.
    let state = chain('en', 'en', 'play');
    expect(wait(state, 0, 'y')).toBe(5);
    expect(locks(state)).toEqual({});

    // Seat 0 again, and `sadly` starts with the required S. The lock is the
    // only thing refusing it, and it says how long.
    state = on(state, 'yes');
    expect(refuse(state, { type: 'say', word: 'sadly' })).toContain('5 more of your turns');
  });

  it('counts the wait in a seat own turns rather than the chain', () => {
    // Five of seat 0's turns is ten words of chain; a wait counted in chain
    // words would hand Y back halfway through.
    let state = chain('en', 'en', 'play', 'yes');
    expect(wait(state, 0, 'y')).toBe(5);
    state = on(state, 'sun', 'night');
    expect(wait(state, 0, 'y')).toBe(4);
    state = on(state, 'take', 'end', 'dark', 'king', 'green', 'note');
    expect(wait(state, 0, 'y')).toBe(1);
    state = on(state, 'east');
    expect(wait(state, 0, 'y')).toBe(0);
  });

  it('is only the seat that handed it over that pays', () => {
    const state = chain('en', 'en', 'play');
    // Seat 1's Y is untouched by seat 0 spending theirs. The rule is a tax on
    // what you did to them, and taxing you for what they did to you would be
    // arbitrary from the inside -- you cannot even see it.
    expect(locks(state)).toEqual({});
    expect(wait(on(state, 'yesterday'), 1, 'y')).toBe(5);
  });

  it('reads the pool of the player who has to answer, not the pool of the player who spoke', () => {
    // A thousand English words start with W and only a hundred Japanese ones,
    // so the same ending is free against an English opponent and the full five
    // turns against a Japanese one. This is the whole correction: the harm is
    // to whoever has to start on the letter, so it is their list that prices
    // it.
    expect(wait(chain('en', 'en', 'window'), 0, 'w')).toBe(0);
    expect(wait(chain('en', 'ja', 'window'), 0, 'w')).toBe(5);
  });

  it('counts the pool the game links on', () => {
    // `też` hands on a `ż` in a strict game and on a plain `z` in a loose one,
    // and those are two different letters with two different pools in front of
    // them. Both happen to be thin enough to charge, which is the point: what
    // is pinned here is *which letter is written down*, since a strict game
    // reading the folded key would put the lock on a letter it does not have.
    const strict = chain('pl', 'pl', 'też');
    expect(strict.strict).toBe(true);
    expect(lockedFor(strict, 0)).toEqual([{ letter: 'ż', turns: 5 }]);

    const loose = chain('pl', 'en', 'też');
    expect(loose.strict).toBe(false);
    expect(lockedFor(loose, 0)).toEqual([{ letter: 'z', turns: 5 }]);
  });

  it('goes out to the seat it belongs to and nobody else', () => {
    const state = say(playing('en', 'en'), 'apple');
    expect(wordChain.view?.(state, 0).cooldowns).toEqual([state.cooldowns[0], []]);
    expect(wordChain.view?.(state, 1).cooldowns).toEqual([[], state.cooldowns[1]]);
  });

  /**
   * The reveal is a claim about what the loser could have said, so it has to
   * be a word the game would in fact have taken from them.
   */
  it('is respected by the word the loser is shown', () => {
    const state = chain('en', 'en', 'play', 'yes');
    // Seat 0 is on the clock, owes an S word, and cannot end on Y -- which
    // rules out most of the commonest answers (`simply`, `sorry`, `story`),
    // exactly the words the reveal would otherwise be free to offer them.
    expect(wait(state, 0, 'y')).toBe(5);
    const over = wordChain.expire?.(state, (state.deadline ?? 0) + 1);
    expect(missFor(over as WcState, 0)?.reveal).not.toBeNull();
    expect(missFor(over as WcState, 0)?.reveal?.key.slice(-1)).not.toBe('y');
  });
});

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

/**
 * The score, which is the only thing this game is settled on now that a lost
 * minute no longer settles it. A point a letter and no other axis, because the
 * rule has to be one a player can check in their head while a five-second clock
 * runs, and a curve is not.
 */
describe('what a word is worth', () => {
  it('is a point a letter', () => {
    expect(wordPoints('cat')).toBe(3);
    expect(wordPoints('wonderful')).toBe(9);
    // Which is the whole of "the longer the word the more points": nine beats
    // three, and beats three threes by nothing at all.
    expect(wordPoints('wonderful')).toBeGreaterThan(wordPoints('cat'));
  });

  it('counts a letter as a letter, however many bytes it took', () => {
    // zolty is five letters and eight bytes of UTF-8, and a player who
    // reached for a Polish word should not be paid in code units for it.
    expect(wordPoints('żółty')).toBe(5);
  });

  it('adds up over the words one seat said and nobody else', () => {
    const state = say(say(playing('en', 'en'), 'apple'), 'every');
    expect(scoreFor(state, 0)).toBe(5);
    expect(scoreFor(state, 1)).toBe(5);
    // The stats say the same number, because they read the same function.
    expect(chainStats(state).seats.map((seat) => seat.points)).toEqual([5, 5]);
  });

  it('is nothing at all before anybody has said a word', () => {
    const state = playing('en', 'en');
    expect(scoreFor(state, 0)).toBe(0);
    expect(scoreFor(state, 1)).toBe(0);
  });
});

/**
 * The chase: what a lost minute costs, which is the chain and not the game.
 *
 * The seat that misses is out with whatever they scored, and the other player
 * carries the chain on alone until they are past it. Three endings live in
 * here and all three are easy to get subtly wrong: the chase that never runs
 * because the survivor was already ahead, the chase that is won mid-turn, and
 * the chase that runs out of time and hands it back to the seat that set the
 * target.
 */
describe('the chase', () => {
  /** Level at five points each, with seat 0 on the clock owing a Y. */
  const level = (): WcState => say(say(playing('en', 'en', 0), 'apple', 0), 'every', 0);

  /** The minute of whoever is on the clock, gone. */
  const clockOut = (state: WcState): WcState =>
    wordChain.expire?.(state, (state.deadline ?? 0) + 1) as WcState;

  it('carries on against the seat still in it, rather than ending the game', () => {
    const state = clockOut(level());
    expect(state.phase).toBe('chase');
    expect(wordChain.isOver(state)).toBe(false);
    expect(state.loser).toBeNull();
    // Seat 0 is out on five; seat 1 has the chain to themselves.
    expect(state.misses.map((miss) => miss.seat)).toEqual([0]);
    expect(targetScore(state)).toBe(5);
    expect(state.at).toBe(1);
    expect(canAct(state, 1)).toBe(true);
    expect(canAct(state, 0)).toBe(false);
    // Answering the very letter their opponent could not, on a clock that has
    // gone on shrinking with the chain.
    expect(state.required).toBe('y');
    expect(state.deadline).toBe((level().deadline ?? 0) + 1 + turnMsFor(state.chain.length));
  });

  it('still shows the seat that missed the word they could have said', () => {
    const state = clockOut(level());
    const miss = missFor(state, 0);
    expect(miss?.gaveUp).toBe(false);
    expect(miss?.reveal?.lang).toBe('en');
    expect(miss?.reveal?.key.startsWith('y')).toBe(true);
  });

  it('is not run at all when the seat still in it is already ahead', () => {
    // Seat 1 misses the opening answer, so seat 0 has five points to their
    // none. There is nothing to chase: they have already beaten it.
    const state = clockOut(say(playing('en', 'en', 0), 'apple', 0));
    expect(state.phase).toBe('over');
    expect(state.loser).toBe(1);
    expect(state.misses.length).toBe(1);
  });

  it('is won the moment the target is passed, mid-turn and not at the end of one', () => {
    const state = say(clockOut(level()), 'yellow');
    expect(scoreFor(state, 1)).toBe(11);
    expect(state.phase).toBe('over');
    expect(state.loser).toBe(0);
    expect(state.deadline).toBeNull();
    expect(state.available).toBeNull();
    // One miss, not two: the chaser never lost a minute.
    expect(state.misses.length).toBe(1);
  });

  it('has the chaser answering their own words while they are behind', () => {
    // Seat 0 out on fourteen, seat 1 chasing on seven, so one word is not
    // enough and the chain has to carry on round to the same player.
    let state = playing('en', 'en', 0);
    for (const word of ['wonderful', 'lot', 'table', 'even']) state = say(state, word, 0);
    expect(scoreFor(state, 0)).toBe(14);
    expect(scoreFor(state, 1)).toBe(7);

    state = clockOut(state);
    expect(state.phase).toBe('chase');
    expect(state.at).toBe(1);
    expect(state.required).toBe('n');

    state = say(state, 'nine', 0);
    // Eleven is not past fourteen, so the chase is still on and the letter
    // has carried to the only player left to answer it.
    expect(state.phase).toBe('chase');
    expect(state.at).toBe(1);
    expect(state.required).toBe('e');
    expect(scoreFor(state, 1)).toBe(11);

    state = say(state, 'eleven', 0);
    expect(scoreFor(state, 1)).toBe(17);
    expect(state.phase).toBe('over');
    expect(state.loser).toBe(0);
  });

  it('goes to the seat that set the target when the chaser runs out too', () => {
    const state = clockOut(clockOut(level()));
    expect(state.phase).toBe('over');
    // Level on five each, and level is not past it -- the chaser had the
    // chain to themselves and did not beat anything.
    expect(scoreFor(state, 0)).toBe(scoreFor(state, 1));
    expect(state.loser).toBe(1);
    // Both minutes went, and both are on the record with their own word: two
    // players who each lost one have each got something to learn.
    expect(state.misses.map((miss) => miss.seat)).toEqual([0, 1]);
    expect(state.misses.every((miss) => miss.reveal !== null)).toBe(true);
  });

  it('lets the chaser give up, which is the same admission it always was', () => {
    const chasing = clockOut(level());
    const given = wordChain.applyMove(chasing, { type: 'give-up' }, 1, rng, 0);
    if (!given.ok) throw new Error(given.error);
    expect(given.state.phase).toBe('over');
    expect(given.state.loser).toBe(1);
    expect(missFor(given.state, 1)?.gaveUp).toBe(true);
  });

  it('says what the chaser needs, since the verdict is otherwise baffling', () => {
    const chasing = clockOut(level());
    expect(wordChain.status(chasing, ['Ada', 'Bo'])).toBe(
      'Ada is out on 5. Bo needs 1 more point: an English word starting with Y.',
    );
    const won = say(chasing, 'yellow');
    // The player who ran out of time first can perfectly well have won, so
    // the score is said out loud rather than left to be inferred.
    expect(wordChain.status(won, ['Ada', 'Bo'])).toBe(
      'Ada ran out of time. Bo wins, 11 points to 5.',
    );
  });

  /**
   * The letter that would make a chase impossible. `tooThin` only ever looked
   * ahead to the *opponent's* language, so a letter that is perfectly fair to
   * hand across the table can be one the hander's own list cannot answer, and
   * in a chase the hander is the one who has to answer it.
   */
  it('opens free rather than on a letter the chaser could never answer', () => {
    // Polish words end in Y constantly and begin with it four times, all four
    // American place names. English has a hundred and nine, so handing a Y to
    // an English player is fair and handing it back is not.
    expect(countStarting('pl', 'y', new Set())).toBeLessThan(MIN_ANSWERS.pl);
    expect(countStarting('en', 'y', new Set())).toBeGreaterThan(MIN_ANSWERS.en);

    // Level at twelve each, with the English seat on the clock owing the Y
    // its Polish opponent just handed it. Level, because a chase only runs
    // when there is something left to chase.
    let state = playing('en', 'pl', 0);
    for (const word of ['wonderful', 'ludzie', 'egg', 'gotowy']) state = say(state, word, 0);
    expect(scoreFor(state, 0)).toBe(12);
    expect(scoreFor(state, 1)).toBe(12);
    expect(state.required).toBe('y');
    expect(state.at).toBe(0);

    const chasing = clockOut(state);
    expect(chasing.phase).toBe('chase');
    expect(chasing.at).toBe(1);
    expect(chasing.required).toBe('');
    // Free, and not free of everything: the whole Polish list is behind it,
    // which is what an opening word is offered too.
    expect(chasing.available).toBe(countStarting('pl', '', usedKeys(chasing)));
  });
});

/**
 * What the chain hands the ledger.
 *
 * The three events this game produces are not interchangeable and the whole
 * value of the account system rests on their staying apart: a word you said is
 * evidence, a word they said is not, and a word you were *shown* is the reason
 * to play at all.
 */
describe('what it records', () => {
  /** Seat 1 gives up answering an E in Polish, which ends the game. */
  function finished(): WcState {
    const state = say(playing('en', 'pl', 0), 'apple', 0);
    const result = wordChain.applyMove(state, { type: 'give-up' }, 1, rng, 1_000);
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }

  const outcome = (state: WcState, seat: number) =>
    wordChain.record?.(state, 2)?.seats.find((s) => s.seat === seat);

  it('names the game and answers for every seat', () => {
    const rec = wordChain.record?.(finished(), 2);
    expect(rec?.gameId).toBe('wordchain');
    expect(rec?.seats.map((s) => s.seat)).toEqual([0, 1]);
    expect(rec?.seats.map((s) => s.result)).toEqual(['won', 'lost']);
  });

  it('grades the word you said as production, and theirs as a sighting', () => {
    const state = finished();
    expect(outcome(state, 0)?.learned[0]).toMatchObject({ word: 'apple', lang: 'en' });
    expect(outcome(state, 0)?.learned[0].grade).toMatch(/^produced/);
    expect(outcome(state, 1)?.learned[0]).toMatchObject({ word: 'apple', grade: 'seen' });
  });

  /**
   * The bug this pins: a word the ladder spelled out banked as `produced`.
   *
   * It matters more than a wrong number on an end screen, because `answerFor`
   * deliberately hints at a word the seat already owes a review on. Graded as
   * production, the hint promotes exactly the card it was helping with, and
   * the ledger comes to believe the player knows a word they have never once
   * retrieved unaided. Vocab Race grades this `hinted`; both games write to
   * one ledger, so both have to call it the same thing.
   */
  it('grades a word the hint handed over as hinted, however fast it was typed', () => {
    const state = levelled(['new', 'new'], ['pl', 'pl']);
    const began = (state.deadline as number) - TURN_MS;
    const word = state.hint?.word as string;
    expect(word).toBeTruthy();

    // Both rungs are up: the meaning at twenty seconds, the shape at forty.
    expect(hintsFor(state, state.at, began + 41_000)).toHaveLength(2);
    const said = say(state, word, began + 41_000);
    const link = said.chain[said.chain.length - 1];
    expect(link.word).toBe(word);
    expect(link.hinted).toBe(true);

    const done = wordChain.applyMove(said, { type: 'give-up' }, 1 - said.chain[0].seat, rng, began + 42_000);
    if (!done.ok) throw new Error(done.error);
    const learned = wordChain
      .record?.(done.state, 2)
      ?.seats.find((s) => s.seat === link.seat)
      ?.learned.find((l) => l.word === word);
    expect(learned?.grade).toBe('hinted');
  });

  it('still calls it production when the word was said before any hint landed', () => {
    const state = levelled(['new', 'new'], ['pl', 'pl']);
    const began = (state.deadline as number) - TURN_MS;
    const word = state.hint?.word as string;

    // The same word, off the same ladder, typed before the first rung is due.
    // Knowing it is knowing it: the flag is about what was on the screen, not
    // about which word the game happened to pick.
    expect(hintsFor(state, state.at, began + 19_000)).toEqual([]);
    const said = say(state, word, began + 19_000);
    expect(said.chain[said.chain.length - 1].hinted).toBe(false);
  });

  /**
   * The reveal, which is the point of the game: a minute of failing to think
   * of a word is when you are most likely to remember it, so the word goes
   * into the ledger for the person who could not find it.
   */
  it('gives the loser the word they could not find, as shown', () => {
    const state = finished();
    const shown = outcome(state, 1)?.learned.filter((l) => l.grade === 'shown') ?? [];
    expect(shown).toHaveLength(1);
    expect(shown[0].lang).toBe('pl');
    expect(shown[0].word).toBe(missFor(state, 1)?.reveal?.word);
    // The winner reads the same reveal on the same end screen, but it is not
    // theirs to have failed at.
    expect(outcome(state, 0)?.learned.some((l) => l.grade === 'shown')).toBe(false);
  });

  it('files a word under its lemma, folded, rather than under the form played', () => {
    const state = finished();
    const said = outcome(state, 0)?.learned[0];
    const link = state.chain[0];
    expect(said?.key).toBe(fold(link.lemma || link.word));
    // `link.key` is the folded form of the word *as played*, which is what the
    // chain links on. Using it would file every inflection under its own row.
    expect(said?.word).toBe(link.word);
  });

  /**
   * Measured against `turnMsFor(i)` rather than `TURN_MS`, because the minute
   * shrinks a second a word: four seconds is fast at the start of a chain and
   * ordinary at word fifty-five, and the ledger must not report the difference
   * between those as a difference in the player.
   */
  it('reads speed against the allowance that turn actually had', () => {
    const early: WcState = {
      ...finished(),
      chain: [{ ...padded(1)[0], seat: 0, ms: 4_000, lang: 'en', word: 'apple', key: 'apple' }],
    };
    expect(outcome(early, 0)?.learned[0].grade).toBe('produced-fast');

    // The same four seconds, deep enough into a chain that the allowance has
    // fallen to the floor.
    const late: WcState = {
      ...early,
      chain: [
        ...padded(80),
        { ...padded(1)[0], seat: 0, ms: 4_000, lang: 'en', word: 'apple', key: 'apple' },
      ],
    };
    expect(turnMsFor(80)).toBe(MIN_TURN_MS);
    // Indexed by position in the chain, because `learned` carries the reveals
    // after it and `.at(-1)` would be one of those.
    expect(outcome(late, 0)?.learned[late.chain.length - 1].grade).toBe('produced');
  });

  it('carries the gloss and the rank, because the ledger cannot look them up', () => {
    const said = outcome(finished(), 0)?.learned[0];
    expect(said?.rank).toBeGreaterThan(0);
    // The client has no dictionary and never may, so every word has to arrive
    // carrying what the profile screen will draw.
    expect(typeof said?.gloss).toBe('string');
  });
});

/**
 * The hint ladder, which is the whole of what a level buys here. See
 * `ChainLevel` and `HINT_AT`: the clock and the scoring are the same for
 * everybody and stay that way, so every one of these is about *when* a word a
 * player could have said arrives on their screen.
 */
describe('what a level buys', () => {
  it('defaults both seats to the middle band, so an untouched control changes nothing', () => {
    const state = playing('pl', 'en');
    expect(levelOf(state, 0)).toBe(CHAIN_DEFAULT_LEVEL);
    expect(levelOf(state, 1)).toBe(CHAIN_DEFAULT_LEVEL);
  });

  it('reads the default out of a state that predates the field', () => {
    // A room restored from storage, where `levels` was never written. It has
    // to play, not throw, and it has to play the band the setup screen would
    // have defaulted it to.
    const { levels, ...older } = playing('pl', 'en');
    expect(levels).toBeDefined();
    expect(levelOf(older as WcState, 0)).toBe(CHAIN_DEFAULT_LEVEL);
  });

  it('refuses a level that is not one of the three', () => {
    const state = opened();
    expect(refuse(state, { type: 'level', level: 'expert' } as unknown as WcMove, 0, 1_000)).toMatch(
      /not one of the levels/,
    );
  });

  it('settles the level before the language, and not after', () => {
    let state = opened();
    const first = wordChain.applyMove(state, { type: 'level', level: 'new' }, 0, rng, 1_000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    // Choosing a language is what ends this seat's setup, so the level control
    // closes with it. `canAct` is the gate, which is what every control on the
    // board is drawn from.
    const chose = wordChain.applyMove(state, { type: 'lang', lang: 'pl' }, 0, rng, 1_000);
    expect(chose.ok).toBe(true);
    if (!chose.ok) return;
    expect(canAct(chose.state, 0)).toBe(false);
    expect(refuse(chose.state, { type: 'level', level: 'fluent' }, 0, 1_000)).toMatch(
      /Not your move/,
    );
    // And it survived the language: the seat is playing at what it said.
    expect(levelOf(chose.state, 0)).toBe('new');
  });

  it('walks a beginner towards the word at twenty seconds, and its shape at forty', () => {
    const state = levelled(['new', 'new'], ['pl', 'en']);
    expect(state.hint).not.toBeNull();
    const began = (state.deadline as number) - TURN_MS;

    expect(hintsFor(state, 0, began + 19_000)).toEqual([]);
    const [first] = hintsFor(state, 0, began + 20_000);
    expect(first?.kind).toBe('meaning');
    expect(first?.text).toBe(state.hint?.gloss);

    const both = hintsFor(state, 0, began + 40_000);
    expect(both.map((step) => step.kind)).toEqual(['meaning', 'shape']);
    // The masked word, and the promise the setup screen makes: first two
    // letters, then a blank a letter.
    expect(both[1]?.text).toBe(maskWord(state.hint?.word as string));
  });

  it('makes the middle band wait, and gives a fluent seat nothing at all', () => {
    const middle = levelled(['some', 'some'], ['pl', 'pl']);
    const began = (middle.deadline as number) - TURN_MS;
    expect(hintsFor(middle, 0, began + 20_000)).toEqual([]);
    expect(hintsFor(middle, 0, began + (HINT_AT.some[0] as number))).toHaveLength(1);

    // Nothing is even computed for a seat that cannot be shown one: a hint for
    // a fluent seat would be a scan of a whole language, every turn, for
    // something nobody ever sees.
    const fluent = levelled(['fluent', 'fluent'], ['pl', 'pl']);
    expect(fluent.hint).toBeNull();
    expect(hintsFor(fluent, 0, began + 59_000)).toEqual([]);
  });

  it('stops hinting once the turn is shorter than the ladder', () => {
    // The clock shrinks a second a word, so deep in a chain there is no time
    // to spend on a hint and none is given. See `turnMsFor`.
    const state = levelled(['new', 'new'], ['pl', 'pl']);
    const late: WcState = { ...state, chain: padded(80), deadline: 1_000 + MIN_TURN_MS };
    expect(turnMsFor(80)).toBe(MIN_TURN_MS);
    expect(hintsFor(late, late.at, 1_000 + MIN_TURN_MS)).toEqual([]);
  });

  it('hints at the very word it would have revealed', () => {
    const state = levelled(['new', 'new'], ['pl', 'pl']);
    const on = say(state, 'kot');
    // The seat now on the clock is being walked towards a word; run their
    // minute out and the reveal has to be that same word, or the game has
    // changed its mind about the answer between hinting and revealing.
    const hinted = on.hint?.word;
    expect(hinted).toBeTruthy();
    const gone = wordChain.expire?.(on, on.deadline as number);
    expect(missFor(gone as WcState, on.at)?.reveal?.word).toBe(hinted);
  });

  it('never shows a seat the word its opponent is hunting for', () => {
    const state = levelled(['new', 'new'], ['pl', 'pl']);
    expect(state.hint?.seat).toBe(state.at);
    // The waiting seat gets nothing: the hint is the answer to the turn in
    // progress, and with it the letter that turn is about to hand back.
    expect(wordChain.view?.(state, state.at)?.hint).not.toBeNull();
    expect(wordChain.view?.(state, 1 - state.at)?.hint).toBeNull();
    expect(hintsFor(state, 1 - state.at, (state.deadline as number))).toEqual([]);
  });

  it('gives English the shape and no meaning, the list having no glosses', () => {
    const state = levelled(['new', 'new'], ['en', 'en']);
    expect(state.hint?.gloss).toBe('');
    // One rung rather than a first rung that says nothing, and it is the shape
    // one, at the first of the two times. See `chainHintSteps`.
    const steps = chainHintSteps(state.hint as NonNullable<typeof state.hint>);
    expect(steps.map((step) => step.kind)).toEqual(['shape']);
    const began = (state.deadline as number) - TURN_MS;
    expect(hintsFor(state, 0, began + (HINT_AT.new[0] as number))).toHaveLength(1);
    expect(hintsFor(state, 0, began + 59_000)).toHaveLength(1);
  });

  it('masks a word to its first two letters and a blank a letter', () => {
    expect(maskWord('lozko')).toBe('lo___');
    // Code points, not UTF-16 units, so an accented Polish word is not padded
    // out with blanks it has not got.
    expect(maskWord('\u0142\u00f3\u017cko')).toBe('\u0142\u00f3___');
    expect([...maskWord('\u017c\u00f3\u0142ty')].length).toBe(5);
    expect(maskWord('an')).toBe('an');
  });
});
