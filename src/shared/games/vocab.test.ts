import { describe, expect, it } from 'vitest';
import {
  DECK_DEPTH,
  DEFAULT_LEVEL,
  HINT_ALLOWANCE,
  HINT_SCALE,
  HOST,
  LEVEL_ASKS,
  MODE_CAP,
  PHRASE_COUNT,
  PHRASE_RARITY,
  PICK_OPTIONS,
  PICK_SCALE,
  RARITY_STEP,
  REVEAL_MS,
  ROUND_MS,
  SETUP_MS,
  SPEED_BONUS,
  TARGET,
  VOCAB_LANGS,
  VOCAB_LEVELS,
  askFor,
  askIn,
  canAct,
  canHint,
  everyoneDone,
  firstRight,
  hintOf,
  hintsLeft,
  maskWord,
  rightTries,
  roundPoints,
  tryOf,
  vocab,
  vocabStats,
  windowLeft,
  windowMs,
  type VocabLang,
  type VocabLevel,
  type VocabMode,
  type VocabMove,
  type VocabState,
  type VocabTry,
} from './vocab.js';
import { vocabOptions, vocabPoolSize, vocabQuestion } from './vocabDictionary.js';
import type { StudyLists } from '../profile.js';
import { phraseCount, phraseKeys } from './vocabPhrases.js';
import type { VocabQuestion } from './vocabDictionary.js';
import { chainLookup, fold } from './chainDictionary.js';

const rng = () => 0.5;

/** A shuffle that leaves the ranks in order, so a test can name the clue it wants. */
const inOrder = () => 0;

/** A room at the moment every seat filled: setup, clock armed. */
function opened(seats = 2, now = 1_000, shuffle = rng): VocabState {
  const state = vocab.setup(seats, shuffle, now);
  return vocab.start?.(state, now) ?? state;
}

/** Settings chosen and the first clue dealt. */
function playing(
  lang: VocabLang,
  mode: VocabMode = 'normal',
  seats = 2,
  now = 1_000,
  shuffle = rng,
): VocabState {
  let state = opened(seats, now, shuffle);
  state = accept(state, { type: 'settings', lang, mode }, HOST, now);
  return accept(state, { type: 'begin' }, HOST, now);
}

function accept(state: VocabState, move: VocabMove, seat: number, now: number): VocabState {
  const result = vocab.applyMove(state, move, seat, rng, now);
  if (!result.ok) throw new Error(`refused: ${result.error}`);
  return result.state;
}

function refuse(state: VocabState, move: VocabMove, seat: number, now = 2_000): string {
  const result = vocab.applyMove(state, move, seat, rng, now);
  if (result.ok) throw new Error('that move was allowed');
  return result.error;
}

/** The word the clue on the table is pointing at. Server-side knowledge. */
function answerOf(state: VocabState): string {
  const word = state.round?.answer?.word;
  if (word === undefined) throw new Error('no answer on the state');
  return word;
}

/**
 * A word in `lang` that is *not* an answer to the clue on the table.
 *
 * Read out of the dictionary rather than hard-coded, because `accepts` is
 * deliberately wide -- every word in the language filed under any of the clue's
 * senses -- and a hand-picked "obviously wrong" word could turn out to be a
 * synonym the index knows about and quietly stop testing the thing it names.
 */
function wrongWord(state: VocabState, lang: VocabLang): string {
  const question = vocabQuestion(lang, state.mode, state.round?.answer?.rank ?? 0);
  if (question === null) throw new Error('no question on the state');
  for (let rank = 1; rank <= DECK_DEPTH; rank++) {
    const other = vocabQuestion(lang, state.mode, rank);
    if (other === null) continue;
    const entry = chainLookup(lang, other.word);
    if (entry && !question.accepts.has(entry.key)) return other.word;
  }
  throw new Error('every word in the language answers this clue');
}

/**
 * Run the clock forward until the round on the table is number `n`, counting
 * from zero, by letting every round before it time out unanswered.
 *
 * Needed because which way round a clue is asked is a function of how many have
 * been filed (see `askFor`), so a test about recognition rounds has to get to
 * one, and the only way forward through this game is the clock.
 */
function atRound(state: VocabState, n: number, from = 1_000): { state: VocabState; now: number } {
  let now = from;
  while (state.history.length < n && state.phase !== 'over') {
    now += ROUND_MS;
    state = tick(state, now);
    now += REVEAL_MS;
    state = tick(state, now);
  }
  if (state.history.length !== n) throw new Error(`never reached round ${n}`);
  return { state, now };
}

/**
 * The first round a seat at `DEFAULT_LEVEL` is asked the other way round.
 *
 * Read off the cycle rather than written down, so a retuned `LEVEL_ASKS` moves
 * the tests that need a recognition round with it instead of leaving them
 * quietly asserting about a `say`.
 */
const SOME_PICK = LEVEL_ASKS.some.indexOf('pick');

/** Drive the clock the way `RoomEngine.tick` does, once. */
function tick(state: VocabState, now: number): VocabState {
  return vocab.expire?.(state, now) ?? state;
}

/**
 * The window every seat gets. `ROUND_MS` for everybody, at every level: what a
 * level buys is the question, not the clock. Kept as a name rather than
 * inlined so the tests that turn on "your own window" still say so.
 */
const DEFAULT_WINDOW = ROUND_MS;

/** What one seat did with the clue on the table. Throws rather than returning
 * null, so a test that meant to assert on a try fails where it went wrong. */
function attempt(state: VocabState, seat: number): VocabTry {
  const found = tryOf(state.round, seat);
  if (found === null) throw new Error(`seat ${seat} has not finished this round`);
  return found;
}

/** A room where every seat has declared before the first clue is dealt. */
function levelled(
  levels: VocabLevel[],
  lang: VocabLang = 'pl',
  mode: VocabMode = 'normal',
  now = 1_000,
  shuffle = rng,
): VocabState {
  let state = opened(levels.length, now, shuffle);
  levels.forEach((level, seat) => {
    state = accept(state, { type: 'level', level }, seat, now);
  });
  state = accept(state, { type: 'settings', lang, mode }, HOST, now);
  return accept(state, { type: 'begin' }, HOST, now);
}

/**
 * What a right answer pays on an ordinary round: produced, and unhinted.
 *
 * A wrapper rather than `'say', false` repeated at fourteen call sites, because
 * every test in "what a round pays" is about the other three terms. The two
 * discounts have tests of their own.
 */
function paid(state: VocabState, seat: number, rank: number, ms: number): number {
  return roundPoints(state, seat, rank, ms, 'say', false);
}

/**
 * The move that answers the clue on the table, whichever way round it is asked.
 *
 * Server-side knowledge either way: on a `say` round it reads the word off the
 * state, on a `pick` round it finds the correct option by matching the clue.
 * Every test that plays past round two needs this, because a seat at the
 * default level gets a `pick` every third round and a `guess` is refused on
 * one. Which seat is asked matters now: on a mixed table the same round is a
 * `pick` for one seat and a `say` for the one beside it.
 */
function rightMove(state: VocabState, seat = 0): VocabMove {
  const round = state.round;
  if (round === null) throw new Error('no round on the state');
  if (askIn(round, seat) === 'say') return { type: 'guess', word: answerOf(state) };
  const option = round.options.indexOf(round.clue);
  if (option < 0) throw new Error('the right answer is not among the options');
  return { type: 'choose', option };
}

/** Everyone but `seat` gives up, which is the quickest way to settle a round. */
function othersPass(state: VocabState, seat: number, now: number): VocabState {
  let after = state;
  for (let other = 0; other < state.scores.length; other++) {
    if (other === seat || tryOf(after.round, other) !== null) continue;
    after = accept(after, { type: 'pass' }, other, now);
  }
  return after;
}

describe('setting the room up', () => {
  it('waits for the host, and lets nobody else touch the settings', () => {
    const state = opened(4);
    expect(state.phase).toBe('setup');
    expect(state.lang).toBeNull();

    for (let seat = 1; seat < 4; seat++) {
      // Setup is open to the whole table -- every seat has its own level to
      // set -- so `canAct` is true here and the host rule lives in the moves
      // it actually governs.
      expect(canAct(state, seat)).toBe(true);
      expect(refuse(state, { type: 'settings', lang: 'ja', mode: 'hard' }, seat)).toBe(
        'Only the seat that opened the room chooses that.',
      );
      expect(refuse(state, { type: 'begin' }, seat)).toBe(
        'Only the seat that opened the room chooses that.',
      );
    }
    expect(canAct(state, HOST)).toBe(true);
  });

  it('will not deal until a language is chosen', () => {
    const state = opened();
    expect(refuse(state, { type: 'begin' }, HOST)).toBe('Choose a language first.');
  });

  it('refuses a language and a difficulty it has never heard of', () => {
    const state = opened();
    expect(refuse(state, { type: 'settings', lang: 'en' as VocabLang, mode: 'normal' }, HOST)).toBe(
      '"en" is not one of the languages.',
    );
    expect(refuse(state, { type: 'settings', lang: 'pl', mode: 'easy' as VocabMode }, HOST)).toBe(
      '"easy" is not one of the difficulties.',
    );
  });

  /**
   * English is the language the clues are written in, so it cannot be one of
   * the languages you learn -- see `VocabLang`. This holds the decision at the
   * only place it is enforced, since `en` is a perfectly good `ChainLang` and
   * the dictionary underneath would happily accept it.
   */
  it('offers Polish and Japanese, and not English', () => {
    expect([...VOCAB_LANGS]).toEqual(['pl', 'ja']);
  });

  it('starts nobody on a clock until the room is full, then gives them the setup minute', () => {
    const dealt = vocab.setup(2, rng, 1_000);
    expect(dealt.deadline).toBeNull();
    expect(vocab.start?.(dealt, 5_000)?.deadline).toBe(5_000 + SETUP_MS);
  });

  /** Idempotent: a player reconnecting fills the room again and must not reset it. */
  it('does not restart a setup clock that is already running', () => {
    const state = opened(2, 1_000);
    expect(vocab.start?.(state, 9_000)).toBeNull();
  });

  /**
   * Nobody loses to the setup clock. A host who wandered off before choosing
   * would otherwise strand up to seven other people on a menu.
   */
  it('deals Polish on normal if the host never chooses', () => {
    const state = tick(opened(3, 1_000), 1_000 + SETUP_MS);
    expect(state.phase).toBe('asking');
    expect(state.lang).toBe('pl');
    expect(state.mode).toBe('normal');
    expect(state.round).not.toBeNull();
  });

  it('keeps a language the host did choose when the clock beats them to start', () => {
    let state = opened(2, 1_000);
    state = accept(state, { type: 'settings', lang: 'ja', mode: 'hard' }, HOST, 1_000);
    state = tick(state, 1_000 + SETUP_MS);
    expect(state.lang).toBe('ja');
    expect(state.mode).toBe('hard');
  });
});

describe('the deck', () => {
  it('is every rank a game could ask about, shuffled', () => {
    const deck = vocab.setup(2, rng, 0).deck;
    expect(deck.length).toBe(DECK_DEPTH);
    expect([...deck].sort((a, b) => a - b)).toEqual(
      Array.from({ length: DECK_DEPTH }, (_, i) => i + 1),
    );
  });

  /**
   * The whole reason the deck is dealt at `setup` rather than a round at a
   * time: `expire` drives every round after the first and is handed no rng, so
   * a game that drew from one there could not advance on a clock at all.
   */
  it('is dealt before the language is known, and never redrawn', () => {
    const state = playing('pl', 'hard');
    expect(state.deck.length).toBe(DECK_DEPTH);
    const after = tick(tick(state, 1_000 + ROUND_MS), 1_000 + ROUND_MS + REVEAL_MS);
    expect(after.deck).toEqual(state.deck);
  });

  it('never asks past the difficulty it was set to', () => {
    for (const lang of VOCAB_LANGS) {
      let state = playing(lang, 'normal', 2, 1_000, inOrder);
      let now = 1_000;
      for (let round = 0; round < 12; round++) {
        expect(state.round?.answer?.rank).toBeLessThanOrEqual(MODE_CAP.normal);
        now += ROUND_MS;
        state = tick(state, now);
        now += REVEAL_MS;
        state = tick(state, now);
        if (state.phase === 'over') break;
      }
    }
  });

  it('never asks the same clue twice in a game', () => {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    let now = 1_000;
    const seen: string[] = [];
    while (state.phase !== 'over' && seen.length < 30) {
      if (state.phase === 'asking' && state.round) seen.push(state.round.clue);
      now += ROUND_MS;
      state = tick(state, now);
      now += REVEAL_MS;
      state = tick(state, now);
    }
    expect(seen.length).toBeGreaterThan(10);
    expect(new Set(seen).size).toBe(seen.length);
  });

  /**
   * The clue is the most-read string in the game, and the lists capitalise on
   * purpose. A blanket lower-casing while building it shipped "i know" to a
   * screen four people were staring at; this holds the fix at the two places
   * the data actually carries case.
   */
  it('keeps the capitals the word lists put there', () => {
    const clues = (lang: 'pl' | 'ja', cap: number): string[] =>
      Array.from({ length: cap }, (_, i) => vocabQuestion(lang, 'hard', i + 1)?.clue ?? '');

    const polish = clues('pl', MODE_CAP.normal);
    // `wiem` is glossed `I know`, and the pronoun has to survive.
    expect(polish).toContain('I know');
    expect(polish.filter((clue) => /i/.test(clue))).toEqual([]);
    // `pan` is glossed `sir, Mr, gentleman`.
    expect(polish.some((clue) => clue.includes('Mr'))).toBe(true);
  });

  /**
   * Both languages have to hold enough cluable words at both depths for a game
   * to five to be playable without running the deck out. These are the numbers
   * measured when the game was written; a rebuild of `chainWords.ts` that moved
   * them should fail here rather than quietly shorten a game.
   */
  it('has enough clues at both depths in both languages', () => {
    expect(vocabPoolSize('pl', 'normal', MODE_CAP.normal)).toBeGreaterThanOrEqual(80);
    expect(vocabPoolSize('ja', 'normal', MODE_CAP.normal)).toBeGreaterThanOrEqual(80);
    expect(vocabPoolSize('pl', 'hard', MODE_CAP.hard)).toBeGreaterThanOrEqual(800);
    expect(vocabPoolSize('ja', 'hard', MODE_CAP.hard)).toBeGreaterThanOrEqual(800);
  });
});

describe('answering', () => {
  it('scores the right word, and leaves the round open for everybody else', () => {
    const state = playing('pl');
    const word = answerOf(state);
    const after = accept(state, { type: 'guess', word }, 1, 6_000);

    // Still asking. This is the line the whole design turns on: seat 1 has
    // answered and seat 0 has lost nothing by being second to it.
    expect(after.phase).toBe('asking');
    expect(after.scores).toEqual([0, 0]);
    expect(attempt(after, 1).how).toBe('right');
    expect(attempt(after, 1).ms).toBe(5_000);
    expect(attempt(after, 1).points).toBeGreaterThan(0);
    expect(canAct(after, 0, 6_000)).toBe(true);
    expect(canAct(after, 1, 6_000)).toBe(false);

    // Nothing is banked until the round settles, and the round settles when
    // the last seat is done.
    const settled = accept(after, { type: 'pass' }, 0, 7_000);
    expect(settled.phase).toBe('reveal');
    expect(settled.scores).toEqual([0, attempt(after, 1).points]);
    expect(settled.deadline).toBe(7_000 + REVEAL_MS);
  });

  /**
   * The bug this game was reported for, as a test: the expert types the word
   * two seconds in, and the learner -- who does know it, and needs ten seconds
   * to spell it -- used to be looking at the reveal by then.
   */
  it('lets a slower player answer a clue somebody has already got right', () => {
    const state = levelled(['fluent', 'new']);
    const word = answerOf(state);

    const fast = accept(state, { type: 'guess', word }, 0, 3_000);
    expect(fast.phase).toBe('asking');
    // Ten seconds later. The clue is still on the table and the box is open.
    expect(canAct(fast, 1, 13_000)).toBe(true);
    const slow = accept(fast, { type: 'guess', word }, 1, 13_000);

    expect(slow.phase).toBe('reveal');
    expect(attempt(slow, 0).how).toBe('right');
    expect(attempt(slow, 1).how).toBe('right');
    // And the slow answer is worth more than the fast one, which is the point
    // of the handicap rather than an accident of these numbers.
    expect(attempt(slow, 1).points).toBeGreaterThan(attempt(slow, 0).points);
    expect(firstRight(slow.round!)?.seat).toBe(0);
    expect(rightTries(slow.round!).map((a) => a.seat)).toEqual([0, 1]);
  });

  /**
   * The fold is the reason a phone keyboard is enough to play this in Polish.
   * `chainLookup` does the finding, and the board shows the accented spelling
   * back -- which is the moment the spelling is taught rather than demanded.
   */
  it('takes a Polish word typed without its accents, and records what was typed', () => {
    let state = playing('pl', 'hard', 2, 1_000, inOrder);
    // Walk to a clue whose answer actually carries an accent; the top of the
    // list is mostly unaccented, so an unconditional test here would pass
    // without ever exercising the fold.
    let now = 1_000;
    while (!/[ąćęłńóśźż]/.test(answerOf(state))) {
      now += ROUND_MS;
      state = tick(state, now);
      now += REVEAL_MS;
      state = tick(state, now);
      if (state.phase === 'over') throw new Error('no accented answer in the deck');
    }

    const accented = answerOf(state);
    const flattened = accented
      .replace(/[ąćęłńóśźż]/g, (c) => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' })[c] ?? c);
    expect(flattened).not.toBe(accented);

    const after = accept(state, { type: 'guess', word: flattened }, 0, now + 1_000);
    expect(attempt(after, 0).how).toBe('right');
    // The canonical spelling is what the reveal shows; `said` keeps the truth
    // about what the player actually reached for.
    expect(after.round?.answer?.word).toBe(accented);
    expect(attempt(after, 0).said).toBe(accented);
  });

  /**
   * A synonym is a right answer. `accepts` is every word in the language filed
   * under any of the clue's senses, and marking a learner wrong for knowing a
   * second word for "small" is the most discouraging thing this game could do.
   */
  it('takes any word in the language that means the same thing', () => {
    const state = playing('pl', 'hard', 2, 1_000, inOrder);
    const question = vocabQuestion('pl', state.mode, state.round?.answer?.rank ?? 0);
    expect(question).not.toBeNull();
    expect(question!.accepts.size).toBeGreaterThan(1);

    // Some other word the index files under this clue's meaning.
    const target = chainLookup('pl', question!.word)?.key;
    const other = [...question!.accepts].find((key) => key !== target);
    expect(other).toBeDefined();
    const after = accept(state, { type: 'guess', word: other! }, 1, 3_000);
    expect(attempt(after, 1).how).toBe('right');
  });

  /**
   * The two ways to be wrong, and they cost differently. See point 2 on the
   * reducer: a real word with the wrong meaning is a guess, and a word the list
   * has never heard of is nearly always a typo.
   */
  it('ends the round for the seat that guessed a real word with the wrong meaning', () => {
    const state = playing('pl', 'normal', 3);
    const wrong = wrongWord(state, 'pl');
    const after = accept(state, { type: 'guess', word: wrong }, 1, 3_000);

    expect(after.phase).toBe('asking');
    expect(attempt(after, 1).how).toBe('wrong');
    expect(attempt(after, 1).points).toBe(0);
    expect(attempt(after, 1).said).toBe(wrong);
    expect(after.scores).toEqual([0, 0, 0]);
    // Two seats are still in, so the clock has not moved.
    expect(after.deadline).toBe(state.deadline);
    expect(canAct(after, 1, 3_000)).toBe(false);
    expect(canAct(after, 0, 3_000)).toBe(true);
    expect(refuse(after, { type: 'guess', word: answerOf(after) }, 1, 3_500)).toBe('Not your move.');
  });

  it('costs nothing to type a word the list has never heard of', () => {
    const state = playing('pl');
    expect(refuse(state, { type: 'guess', word: 'qqqqzzz' }, 1)).toBe(
      '"qqqqzzz" is not in the Polish list.',
    );
    // Refused means refused: the state never moved, so the seat is still in.
    expect(state.round?.tries).toEqual([]);
    expect(canAct(state, 1, 2_000)).toBe(true);
  });

  it('refuses an empty guess without ending anybody, and refuses a move it has never heard of', () => {
    const state = playing('pl');
    expect(refuse(state, { type: 'guess', word: '   ' }, 1)).toBe('Type a word.');
    expect(refuse(state, { type: 'nonsense' } as unknown as VocabMove, 1)).toBe('No such move.');
  });

  it('lets everyone but the seats already finished race the same clue', () => {
    const state = playing('ja', 'normal', 4);
    for (let seat = 0; seat < 4; seat++) expect(canAct(state, seat, 2_000)).toBe(true);
    // Nobody outside the table, whatever they send.
    expect(canAct(state, 4, 2_000)).toBe(false);
    expect(canAct(state, -1, 2_000)).toBe(false);
  });

  it('takes a Japanese answer typed in a different romanisation', () => {
    let state = playing('ja', 'hard', 2, 1_000, inOrder);
    let now = 1_000;
    // A word with a long vowel in it, which is where the romanisations differ.
    while (!answerOf(state).includes('ou')) {
      now += ROUND_MS;
      state = tick(state, now);
      now += REVEAL_MS;
      state = tick(state, now);
      if (state.phase === 'over') throw new Error('no long-vowel answer in the deck');
    }
    const canonical = answerOf(state);
    const after = accept(state, { type: 'guess', word: canonical.replace(/ou/g, 'o') }, 0, now + 500);
    expect(attempt(after, 0).how).toBe('right');
    expect(after.round?.answer?.word).toBe(canonical);
  });
});

/**
 * The reason this game exists in the shape it does. See point 7 on the
 * reducer: somebody learning Polish sits down with somebody who grew up
 * speaking it, and without all of this the second one answers every clue
 * before the first has finished reading it.
 */
describe('the handicap', () => {
  it('lets every seat declare its own, and nobody declare for anybody else', () => {
    let state = opened(3);
    expect(state.levels).toEqual([DEFAULT_LEVEL, DEFAULT_LEVEL, DEFAULT_LEVEL]);

    state = accept(state, { type: 'level', level: 'fluent' }, 2, 1_000);
    // The move carries no seat, so seat 2 declaring can only ever have moved
    // seat 2 -- which is the whole reason it carries none.
    expect(state.levels).toEqual([DEFAULT_LEVEL, DEFAULT_LEVEL, 'fluent']);
    // And it is not the host's to set: every seat owns this one.
    state = accept(state, { type: 'level', level: 'new' }, 1, 1_000);
    expect(state.levels).toEqual([DEFAULT_LEVEL, 'new', 'fluent']);
  });

  it('refuses a level it has never heard of, and one declared after the first clue', () => {
    expect(refuse(opened(), { type: 'level', level: 'native' as VocabLevel }, 1)).toBe(
      '"native" is not one of the levels.',
    );
    expect(refuse(playing('pl'), { type: 'level', level: 'new' }, 1)).toBe(
      'Levels are set before the first clue.',
    );
  });

  it('gives every level the same clock and the same points', () => {
    const state = levelled(['new', 'some', 'fluent']);
    // The handicap moved off the clock and the scoreline entirely: what a
    // level buys is the mix of questions, and nothing else. This is the test
    // that fails if somebody reintroduces a multiplier.
    VOCAB_LEVELS.forEach((_, seat) => expect(windowMs(state, seat)).toBe(ROUND_MS));
    expect(windowMs(state, 9)).toBe(0);

    const rank = state.round!.answer!.rank;
    const paidAt = VOCAB_LEVELS.map((_, seat) =>
      roundPoints(state, seat, rank, 4_000, 'say', false),
    );
    expect(new Set(paidAt).size).toBe(1);
  });

  /**
   * The old handicap opened the expert's box six seconds late, which cost one
   * player six dead seconds a round. Nothing waits now.
   */
  it('holds nobody back at the start of a round, whatever they declared', () => {
    const state = levelled(['fluent', 'new', 'some']);
    const began = state.round!.began;
    for (let seat = 0; seat < 3; seat++) expect(canAct(state, seat, began)).toBe(true);
  });

  it('runs every box to the same edge and closes it there', () => {
    const state = levelled(['fluent', 'new']);
    const began = state.round!.began;

    const edge = began + ROUND_MS;
    for (const seat of [0, 1]) {
      expect(windowLeft(state, seat, edge - 1)).toBe(1);
      expect(canAct(state, seat, edge - 1)).toBe(true);
      expect(windowLeft(state, seat, edge)).toBe(0);
      expect(canAct(state, seat, edge)).toBe(false);
    }
    expect(refuse(state, { type: 'guess', word: answerOf(state) }, 0, edge + 1_000)).toBe(
      'Not your move.',
    );
  });

  it('ends the round on the last window still open, not on the longest one', () => {
    const state = levelled(['fluent', 'new']);
    const began = state.round!.began;
    expect(state.deadline).toBe(began + ROUND_MS);

    // Equal windows, so the deadline only moves when a seat *finishes*. The
    // learner answers early and the expert is the last one still typing, so
    // the round runs to the expert's edge -- and would have run to the
    // learner's had they swapped.
    const after = accept(state, rightMove(state, 1), 1, began + 4_000);
    expect(after.phase).toBe('asking');
    expect(after.deadline).toBe(began + ROUND_MS);

    // And the moment the expert is done too, with no clock left to wait on.
    const done = accept(after, { type: 'pass' }, 0, began + 5_000);
    expect(done.phase).toBe('reveal');
  });

  it('settles the moment the last seat is done, however each of them got there', () => {
    let state = levelled(['some', 'some', 'some']);
    const began = state.round!.began;

    state = accept(state, { type: 'pass' }, 0, began + 1_000);
    expect(everyoneDone(state, state.round!)).toBe(false);
    expect(state.phase).toBe('asking');

    state = accept(state, { type: 'guess', word: wrongWord(state, 'pl') }, 1, began + 2_000);
    expect(state.phase).toBe('asking');

    // Three different endings, one settled round.
    state = accept(state, { type: 'pass' }, 2, began + 3_000);
    expect(everyoneDone(state, state.round!)).toBe(true);
    expect(state.phase).toBe('reveal');
    expect(state.deadline).toBe(began + 3_000 + REVEAL_MS);
    expect(state.round?.tries.map((a) => a.how)).toEqual(['gave-up', 'wrong', 'gave-up']);
  });

  it('records giving up as costing nothing, and only once', () => {
    const state = levelled(['some', 'some']);
    const after = accept(state, { type: 'pass' }, 1, 2_000);
    expect(attempt(after, 1)).toEqual({
      seat: 1,
      how: 'gave-up',
      said: '',
      ask: 'say',
      ms: 1_000,
      points: 0,
      hinted: false,
    });
    expect(canAct(after, 1, 2_000)).toBe(false);
    expect(refuse(after, { type: 'pass' }, 1, 2_500)).toBe('Not your move.');
    // Nor during the reveal, when there is nothing left to give up on.
    expect(refuse(tick(playing('pl'), 1_000 + DEFAULT_WINDOW), { type: 'pass' }, 1)).toBe(
      'Not your move.',
    );
  });

  it('writes the seats that never answered in as timeouts when the round settles', () => {
    const state = levelled(['fluent', 'new']);
    const settled = tick(state, state.deadline!);

    expect(settled.phase).toBe('reveal');
    expect(settled.round?.tries.map((a) => a.how)).toEqual(['timeout', 'timeout']);
    // Filled in at each seat's own window rather than the round's. The same
    // number for both today; still read per seat, because the round's deadline
    // and a seat's window are different clocks.
    expect(settled.round?.tries.map((a) => a.ms)).toEqual([ROUND_MS, ROUND_MS]);
    expect(settled.scores).toEqual([0, 0]);
  });

  it('reports no window outside a running round, or without a clock to read', () => {
    const state = levelled(['fluent', 'new']);
    expect(windowLeft(state, 0, undefined)).toBe(0);
    expect(windowLeft({ ...state, phase: 'reveal' }, 0, state.round!.began)).toBe(0);
    // A caller with no clock is asking a question this cannot answer, and
    // refusing every move is a worse wrong answer than allowing them -- the
    // server always passes its own.
    expect(canAct(state, 0)).toBe(true);
  });
});

/**
 * What a round pays, which is where the fluent speaker is actually held back.
 * The window alone would not have done it: fifteen seconds is more than they
 * need, so it costs them almost nothing.
 */
describe('what a round pays', () => {
  it('pays a step more for each decade deeper the word sits', () => {
    const state = levelled(['new', 'new']);
    // Same seat, same speed -- pinned at the buzzer, where the speed term is
    // exactly one -- so the only thing moving here is the rank.
    const buzzer = windowMs(state, 0);
    expect(paid(state, 0, 5, buzzer)).toBe(RARITY_STEP);
    expect(paid(state, 0, 50, buzzer)).toBe(RARITY_STEP * 2);
    expect(paid(state, 0, 500, buzzer)).toBe(RARITY_STEP * 3);
    expect(paid(state, 0, 1_000, buzzer)).toBe(RARITY_STEP * 4);
  });

  it('doubles a word answered instantly and pays the rarity alone at the buzzer', () => {
    const state = levelled(['new', 'new']);
    const window = windowMs(state, 0);
    expect(paid(state, 0, 50, 0)).toBe(RARITY_STEP * 2 * (1 + SPEED_BONUS));
    expect(paid(state, 0, window / 2, 50)).toBeGreaterThan(0);
    expect(paid(state, 0, 50, window)).toBe(RARITY_STEP * 2);
  });

  /**
   * The headline, and the thing this whole design turns on now: the handicap
   * is in the *question*, so the arithmetic is the same for everybody and it
   * is the beginner's three-in-four `pick` rounds that cost them half. An
   * expert handed a `pick` would pay exactly the same half.
   */
  it('scales by the question asked and never by who is asking', () => {
    const state = levelled(['new', 'some', 'fluent']);
    const cold = VOCAB_LEVELS.map((_, seat) => roundPoints(state, seat, 50, 3_000, 'say', false));
    const chosen = VOCAB_LEVELS.map((_, seat) =>
      roundPoints(state, seat, 50, 3_000, 'pick', false),
    );
    expect(new Set(cold).size).toBe(1);
    expect(new Set(chosen).size).toBe(1);
    expect(chosen[0]).toBe(Math.round(cold[0] * PICK_SCALE));
  });

  /**
   * What replaced "a slow learner outscores a fast expert": the expert is six
   * times faster on the same clue and does outscore them, on a round they both
   * typed -- and the learner takes it back on the three rounds in four they
   * were asked the other way and the expert was not. The gap is earned per
   * round rather than applied to a person.
   */
  it('pays the faster answer more when the question was the same one', () => {
    const state = levelled(['fluent', 'new']);
    const expert = paid(state, 0, 50, 2_000);
    const learner = paid(state, 1, 50, 12_000);
    expect(learner).toBeGreaterThan(0);
    expect(expert).toBeGreaterThan(learner);
  });

  it('measures speed against your own window, the same one for everybody', () => {
    const state = levelled(['fluent', 'new']);
    // Both seats exactly half way through their own window, which is now the
    // same window. Nothing at all is left between them.
    const expert = paid(state, 0, 5, windowMs(state, 0) / 2);
    const learner = paid(state, 1, 5, windowMs(state, 1) / 2);
    expect(learner).toBe(Math.round(RARITY_STEP * (1 + SPEED_BONUS / 2)));
    expect(expert).toBe(learner);
  });

  it('never scores a right answer at nothing', () => {
    const state = levelled(['fluent', 'new']);
    // The cheapest this game can pay: the commonest word in the language,
    // chosen from four, hinted, at the very edge of the window. A right answer
    // worth zero would read as a bug, and a learner would believe it.
    expect(roundPoints(state, 0, 1, windowMs(state, 0), 'pick', true)).toBeGreaterThanOrEqual(1);
    expect(paid(state, 0, 1, 999_999)).toBeGreaterThanOrEqual(1);
  });

  it('pays nothing for being wrong, giving up, or running out', () => {
    let state = levelled(['some', 'some', 'some']);
    state = accept(state, { type: 'guess', word: wrongWord(state, 'pl') }, 0, 2_000);
    state = accept(state, { type: 'pass' }, 1, 3_000);
    state = tick(state, state.deadline!);

    expect(state.phase).toBe('reveal');
    expect(state.round?.tries.map((a) => a.points)).toEqual([0, 0, 0]);
    expect(state.scores).toEqual([0, 0, 0]);
  });

  it('banks every seat that scored, not just the first one', () => {
    const state = levelled(['fluent', 'fluent', 'fluent']);
    const word = answerOf(state);
    let after = accept(state, { type: 'guess', word }, 0, 3_000);
    after = accept(after, { type: 'guess', word }, 2, 9_000);
    after = accept(after, { type: 'pass' }, 1, 10_000);

    expect(after.phase).toBe('reveal');
    const first = attempt(after, 0);
    const third = attempt(after, 2);
    expect(after.scores).toEqual([first.points, 0, third.points]);
    // Later is worth less, but it is never worth nothing -- which is the
    // difference between this and the game it replaced, where the seat that
    // was second to the word got no round at all.
    expect(third.points).toBeGreaterThan(0);
    expect(third.points).toBeLessThan(first.points);
  });
});

describe('asking it the other way round', () => {
  /**
   * The densities are the handicap, so they are the thing to pin: a beginner
   * mostly recognising, the middle mostly producing, somebody fluent producing
   * every round. If a cycle is retuned this should be the test that says so.
   */
  it('mixes the two directions by level, and never picks for somebody fluent', () => {
    const counted = VOCAB_LEVELS.map((level) => {
      const cycle = LEVEL_ASKS[level];
      const picks = cycle.filter((ask) => ask === 'pick').length;
      return picks / cycle.length;
    });
    // Monotonic and in the order the buttons are drawn: further down the list
    // is less choosing and more typing.
    expect(counted).toEqual([...counted].sort((a, b) => b - a));
    expect(LEVEL_ASKS.fluent).toEqual(['say']);
    expect(counted[0]).toBeGreaterThan(0.5);

    // And the cycle is what `askFor` reads, at every offset including the wrap.
    for (const level of VOCAB_LEVELS) {
      const cycle = LEVEL_ASKS[level];
      for (let i = 0; i < cycle.length * 2 + 1; i++) {
        expect(askFor(level, i)).toBe(cycle[i % cycle.length]);
      }
    }
  });

  it('opens on the question each level was promised', () => {
    // A beginner's first round is one they can answer; everybody else opens on
    // the game the setup screen has just described.
    expect(askFor('new', 0)).toBe('pick');
    expect(askFor('some', 0)).toBe('say');
    expect(askFor('fluent', 0)).toBe('say');
  });

  it('deals the rhythm it promises, with no rng anywhere near it', () => {
    let { state } = atRound(playing('pl', 'hard', 2, 1_000, inOrder), 0);
    const dealt: string[] = [];
    for (let i = 0; i < 6; i++) {
      dealt.push(askIn(state.round, 0));
      state = atRound(state, i + 1).state;
    }
    // `playing` leaves everybody at the default level, so this is `some`.
    expect(dealt).toEqual(['say', 'say', 'pick', 'say', 'say', 'pick']);
  });

  /**
   * One word, two questions, and this is the rule that keeps it a race: the
   * clue is drawn once and the options are drawn once, so the beginner
   * choosing and the expert typing are answering the same thing.
   */
  it('asks one round two ways on a mixed table', () => {
    const state = levelled(['new', 'fluent'], 'pl', 'hard');
    expect(state.round?.asks).toEqual(['pick', 'say']);
    expect(state.round?.options).toHaveLength(PICK_OPTIONS);
    expect(state.round?.options).toContain(state.round?.clue);

    // Each seat's own move, and neither may make the other's.
    expect(refuse(state, { type: 'choose', option: 0 }, 1)).toBe('This one is typed, not chosen.');
    expect(refuse(state, { type: 'guess', word: answerOf(state) }, 0)).toBe(
      'Choose one of the meanings instead.',
    );
  });

  it('offers four meanings when somebody is picking and none when nobody is', () => {
    // A table of experts: nobody picks, so there is nothing to draw.
    const none = levelled(['fluent', 'fluent'], 'pl', 'hard');
    expect(none.round?.asks).toEqual(['say', 'say']);
    expect(none.round?.options).toEqual([]);

    const state = levelled(['new', 'new'], 'pl', 'hard');
    expect(state.round?.asks).toEqual(['pick', 'pick']);
    expect(state.round?.options).toHaveLength(PICK_OPTIONS);
    expect(state.round?.options).toContain(state.round?.clue);
    expect(new Set(state.round?.options).size).toBe(PICK_OPTIONS);
  });

  /**
   * The one that would ruin the feature if it were wrong.
   *
   * `accepts` is deliberately wide -- every word in the language filed under any
   * of a clue's senses -- so that a learner who knows a synonym is not marked
   * wrong. Pointed the other way it becomes a trap: an option that the answer
   * *also* means is a second correct answer, and the player who reads the
   * question carefully is the one who loses the round to it.
   *
   * Checked over every cluable word in the top hundred rather than a sample,
   * because the collisions are exactly where nobody would think to look: the
   * function words, which is most of a top hundred.
   */
  it('never offers a meaning the answer would also have satisfied', () => {
    const order = Array.from({ length: DECK_DEPTH }, (_, i) => i + 1);
    const cap = MODE_CAP.normal;

    const byClue = new Map<string, VocabQuestion>();
    for (let rank = 1; rank <= cap; rank++) {
      const question = vocabQuestion('pl', 'normal', rank);
      if (question !== null) byClue.set(question.clue, question);
    }

    let checked = 0;
    for (let rank = 1; rank <= cap; rank++) {
      const question = vocabQuestion('pl', 'normal', rank);
      if (question === null) continue;
      const options = vocabOptions('pl', 'normal', rank, cap, order);
      expect(options).toHaveLength(PICK_OPTIONS);
      expect(options).toContain(question.clue);

      for (const option of options) {
        if (option === question.clue) continue;
        const other = byClue.get(option);
        expect(other).toBeDefined();
        const shared = [...(other?.accepts ?? [])].filter((key) =>
          question.accepts.has(key),
        );
        expect(shared).toEqual([]);
      }
      checked++;
    }
    // The floor `vocab.test.ts` already holds for the cluable pool. A guard
    // that quietly stopped finding options would otherwise pass this test by
    // never entering the loop.
    expect(checked).toBeGreaterThanOrEqual(80);
  });

  it('does not put the right answer in the same place every time', () => {
    const order = Array.from({ length: DECK_DEPTH }, (_, i) => i + 1);
    const places = new Set<number>();
    for (let rank = 1; rank <= MODE_CAP.normal; rank++) {
      const question = vocabQuestion('pl', 'normal', rank);
      if (question === null) continue;
      places.add(vocabOptions('pl', 'normal', rank, MODE_CAP.normal, order).indexOf(question.clue));
    }
    expect([...places].sort()).toEqual([0, 1, 2, 3]);
  });

  it('scores the meaning that matches and ends the round for one that does not', () => {
    const { state, now } = atRound(levelled(['new', 'new'], 'pl', 'hard'), 0);
    const round = state.round;
    if (!round) throw new Error('no round');
    const right = round.options.indexOf(round.clue);
    const wrong = (right + 1) % PICK_OPTIONS;

    const after = accept(state, { type: 'choose', option: right }, 0, now + 1_000);
    expect(attempt(after, 0).how).toBe('right');
    expect(attempt(after, 0).said).toBe(round.clue);
    expect(attempt(after, 0).points).toBeGreaterThan(0);
    // And the round stays open for everybody else, exactly as a say round does.
    expect(after.phase).toBe('asking');
    expect(canAct(after, 1, now + 1_000)).toBe(true);

    const missed = accept(after, { type: 'choose', option: wrong }, 1, now + 2_000);
    expect(attempt(missed, 1).how).toBe('wrong');
    expect(attempt(missed, 1).points).toBe(0);
  });

  it('refuses an option that is not one of the four', () => {
    const { state, now } = atRound(playing('pl', 'hard', 2, 1_000, inOrder), SOME_PICK);
    expect(refuse(state, { type: 'choose', option: PICK_OPTIONS }, 0, now + 1)).toBe(
      'That is not one of the meanings on offer.',
    );
    expect(refuse(state, { type: 'choose', option: -1 }, 0, now + 1)).toBe(
      'That is not one of the meanings on offer.',
    );
    expect(refuse(state, { type: 'choose', option: 1.5 }, 0, now + 1)).toBe(
      'That is not one of the meanings on offer.',
    );
  });

  it('takes only the move the round is asking for', () => {
    const say = playing('pl', 'hard', 2, 1_000, inOrder);
    expect(refuse(say, { type: 'choose', option: 0 }, 0)).toBe(
      'This one is typed, not chosen.',
    );

    const { state, now } = atRound(say, SOME_PICK);
    expect(refuse(state, { type: 'guess', word: answerOf(state) }, 0, now + 1)).toBe(
      'Choose one of the meanings instead.',
    );
  });

  /**
   * The redaction turns over on a pick round and this is the test that says so.
   * The clue is the correct option, so it is the half that has to go; the word
   * is the question, so it is the half that has to stay. Getting it backwards
   * either puts the answer on every screen or asks nothing at all.
   */
  it('sends the word and holds back the clue, which is the other way round', () => {
    const { state } = atRound(playing('pl', 'hard', 2, 1_000, inOrder), SOME_PICK);
    const seen = vocab.view?.(state, 1);
    expect(askIn(seen?.round ?? null, 1)).toBe('pick');
    expect(seen?.round?.clue).toBe('');
    expect(seen?.round?.answer?.word).toBe(answerOf(state));
    expect(seen?.round?.options).toEqual(state.round?.options);
    // The lemma and the rank are the only things the reveal has left to say, so
    // they wait for it even though the word itself has gone out.
    expect(seen?.round?.answer?.rank).toBe(0);
    expect(seen?.round?.answer?.lemma).toBe('');
  });

  it('pays half for a meaning chosen rather than a word produced', () => {
    const state = levelled(['new', 'new']);
    const buzzer = windowMs(state, 0);
    expect(roundPoints(state, 0, 50, buzzer, 'pick', false)).toBe(
      Math.round(RARITY_STEP * 2 * PICK_SCALE),
    );
    expect(roundPoints(state, 0, 50, buzzer, 'pick', false)).toBeLessThan(
      roundPoints(state, 0, 50, buzzer, 'say', false),
    );
  });
});

describe('hints', () => {
  it('shows the first letter and the length, and nothing else', () => {
    expect(maskWord('zolty')).toBe('z _ _ _ _');
    expect(maskWord('a')).toBe('a');
    expect(maskWord('')).toBe('');
    // A diacritic is the one letter it is, not the two code units it might be.
    expect(maskWord('żółty')).toBe('ż _ _ _ _');
    // Every word's first letter, not the phrase's, which is the difference
    // between a hint and a rectangle. See `maskWord`.
    expect(maskWord('do jutra')).toBe('d _   j _ _ _ _');
  });

  it('starts every seat with three and spends them one at a time', () => {
    let state = levelled(['fluent', 'fluent']);
    expect(state.hints).toEqual([HINT_ALLOWANCE, HINT_ALLOWANCE]);
    expect(canHint(state, 0, 2_000)).toBe(true);

    state = accept(state, { type: 'hint' }, 0, 2_000);
    expect(hintsLeft(state, 0)).toBe(HINT_ALLOWANCE - 1);
    // One seat spending does not spend anybody else's.
    expect(hintsLeft(state, 1)).toBe(HINT_ALLOWANCE);
  });

  it('runs out, and says so', () => {
    let state = levelled(['new', 'new'], 'pl', 'hard');
    let now = 1_000;
    for (let spent = 0; spent < HINT_ALLOWANCE; spent++) {
      // Skip the recognition rounds, which have nothing to hint at.
      while (state.round?.ask !== 'say') ({ state, now } = atRound(state, state.history.length + 1));
      state = accept(state, { type: 'hint' }, 0, now + 1_000);
      ({ state, now } = atRound(state, state.history.length + 1));
    }
    while (state.round?.ask !== 'say') ({ state, now } = atRound(state, state.history.length + 1));

    expect(hintsLeft(state, 0)).toBe(0);
    expect(canHint(state, 0, now + 1_000)).toBe(false);
    expect(refuse(state, { type: 'hint' }, 0, now + 1_000)).toBe('You have no hints left.');
    // And the seat that spent none still has all three.
    expect(hintsLeft(state, 1)).toBe(HINT_ALLOWANCE);
  });

  /**
   * The property the whole mechanic rests on: it buys information and leaves
   * you playing. A hint that filed a try would settle the round the moment the
   * last seat asked for one, which is the opposite of what it is for.
   */
  it('does not end the round, file a try, or move the deadline', () => {
    const state = levelled(['fluent', 'fluent']);
    const after = accept(state, { type: 'hint' }, 0, 2_000);

    expect(after.phase).toBe('asking');
    expect(after.deadline).toBe(state.deadline);
    expect(tryOf(after.round, 0)).toBeNull();
    expect(canAct(after, 0, 2_000)).toBe(true);
    expect(everyoneDone(after, after.round!)).toBe(false);
  });

  it('goes only to the seat that paid for it, though the fact of it is public', () => {
    const state = accept(levelled(['fluent', 'fluent']), { type: 'hint' }, 0, 2_000);
    const word = answerOf(state);

    const mine = vocab.view?.(state, 0);
    const bought = { seat: 0, at: 2_000, free: false };
    expect(mine?.round?.hints).toEqual([{ ...bought, shown: maskWord(word) }]);

    const theirs = vocab.view?.(state, 1);
    expect(theirs?.round?.hints).toEqual([{ ...bought, shown: '' }]);

    // A spectator is nobody's seat, so a spectator is told nothing either.
    expect(vocab.view?.(state, -1).round?.hints).toEqual([{ ...bought, shown: '' }]);
  });

  it('is one to a round', () => {
    const state = accept(levelled(['fluent', 'fluent']), { type: 'hint' }, 0, 2_000);
    expect(canHint(state, 0, 2_500)).toBe(false);
    expect(refuse(state, { type: 'hint' }, 0, 2_500)).toBe(
      'You have already had your hint on this one.',
    );
    // And it did not cost a second one.
    expect(hintsLeft(state, 0)).toBe(HINT_ALLOWANCE - 1);
  });

  it('is not for sale on a round where the word is already on the screen', () => {
    const { state, now } = atRound(levelled(['new', 'new'], 'pl', 'hard'), 0);
    expect(askIn(state.round, 0)).toBe('pick');
    expect(canHint(state, 0, now + 1_000)).toBe(false);
    expect(refuse(state, { type: 'hint' }, 0, now + 1_000)).toBe(
      'The word is already on the screen.',
    );
    expect(hintsLeft(state, 0)).toBe(HINT_ALLOWANCE);
  });

  it('halves what the answer then pays', () => {
    const state = levelled(['fluent', 'fluent']);
    const buzzer = windowMs(state, 0);
    expect(roundPoints(state, 0, 50, buzzer, 'say', true)).toBe(
      Math.round(RARITY_STEP * 2 * HINT_SCALE),
    );

    // End to end, through the move rather than the arithmetic.
    const hinted = accept(state, { type: 'hint' }, 0, 2_000);
    const answered = accept(hinted, { type: 'guess', word: answerOf(hinted) }, 0, 3_000);
    const cold = accept(state, { type: 'guess', word: answerOf(state) }, 1, 3_000);

    expect(attempt(answered, 0).hinted).toBe(true);
    expect(attempt(answered, 0).points).toBeGreaterThan(0);
    expect(attempt(cold, 1).hinted).toBe(false);
    expect(attempt(answered, 0).points).toBeLessThan(attempt(cold, 1).points);
  });

  it('never prices a right answer down to nothing, however much is stacked on it', () => {
    const state = levelled(['fluent', 'new']);
    // The cheapest question this game can ask, answered the cheapest way: the
    // commonest word, chosen not typed, hinted, at the buzzer. It prices out
    // below one and still has to pay one.
    expect(roundPoints(state, 0, 1, windowMs(state, 0), 'pick', true)).toBe(1);
  });

  it('remembers a hint the window then ran out on', () => {
    const state = levelled(['fluent', 'fluent']);
    const hinted = accept(state, { type: 'hint' }, 0, 2_000);
    const settled = tick(hinted, hinted.deadline!);

    expect(settled.phase).toBe('reveal');
    expect(attempt(settled, 0).how).toBe('timeout');
    // Spent and wasted, which is the most useful line the review can print
    // about a word: hinted, and still not got.
    expect(attempt(settled, 0).hinted).toBe(true);
    expect(attempt(settled, 0).points).toBe(0);
    expect(vocabStats(settled).seats[0].hinted).toBe(1);
  });

  it('is refused during the reveal and after the game, like every other move', () => {
    const revealing = tick(playing('pl'), 1_000 + DEFAULT_WINDOW);
    expect(revealing.phase).toBe('reveal');
    expect(canHint(revealing, 0, 2_000)).toBe(false);
    expect(refuse(revealing, { type: 'hint' }, 0)).toBe('Not your move.');
  });

  it('leaves the hint on the round for a seat that reconnects to it', () => {
    const state = accept(levelled(['fluent', 'fluent']), { type: 'hint' }, 0, 2_000);
    // The same view built twice is the same view: nothing about a hint is
    // consumed by being looked at, which is what a reconnect depends on.
    expect(vocab.view?.(state, 0).round?.hints).toEqual(
      vocab.view?.(state, 0).round?.hints,
    );
    expect(hintOf(state.round, 0)?.shown).toBe(maskWord(answerOf(state)));
    expect(hintOf(state.round, 1)).toBeNull();
  });

  /**
   * The beginner's free one. It is not a move, not on the state, and not a
   * discount: it is a floor under the one round in four they have to type.
   */
  describe('the free one', () => {
    it('is not on the state, and turns up in the view with a time on it', () => {
      const state = levelled(['new', 'fluent'], 'pl', 'hard');
      // The reducer knows nothing about it, which is the whole design: it
      // costs no allowance and prices no points, so nothing on the server has
      // a reason to hold it.
      expect(state.round?.hints).toEqual([]);

      // The beginner is picking on round one, so there is nothing to hint at
      // yet. Their typed round is where it appears.
      let { state: typing, now } = atRound(state, LEVEL_ASKS.new.indexOf('say'));
      expect(askIn(typing.round, 0)).toBe('say');

      const seen = vocab.view?.(typing, 0);
      expect(seen?.round?.hints).toEqual([
        {
          seat: 0,
          at: typing.round!.began + FREE_HINT_MS,
          free: true,
          shown: maskWord(typing.round!.answer!.word),
        },
      ]);
      expect(hintsLeft(typing, 0)).toBe(HINT_ALLOWANCE);
      expect(now).toBeGreaterThan(0);
    });

    it('goes to nobody else, whatever their level or their question', () => {
      const state = levelled(['new', 'fluent'], 'pl', 'hard');
      const { state: typing } = atRound(state, LEVEL_ASKS.new.indexOf('say'));

      // The expert is typing the same word and is not given anything.
      expect(vocab.view?.(typing, 1).round?.hints).toEqual([]);
      // Nor is the beginner, on the rounds they are choosing rather than
      // typing: the word is already the largest thing on their screen.
      expect(askIn(state.round, 0)).toBe('pick');
      expect(vocab.view?.(state, 0).round?.hints).toEqual([]);
      // Nor is a spectator, who has no level and no round of their own.
      expect(vocab.view?.(typing, -1).round?.hints).toEqual([]);
    });

    it('costs the answer nothing, unlike one that was bought', () => {
      const { state } = atRound(
        levelled(['new', 'new'], 'pl', 'hard'),
        LEVEL_ASKS.new.indexOf('say'),
      );
      const began = state.round!.began;
      const after = accept(state, { type: 'guess', word: answerOf(state) }, 0, began + 9_000);

      expect(attempt(after, 0).how).toBe('right');
      // Not hinted, so nothing halved it, and the allowance is untouched.
      expect(attempt(after, 0).hinted).toBe(false);
      expect(hintsLeft(after, 0)).toBe(HINT_ALLOWANCE);
      expect(attempt(after, 0).points).toBe(
        roundPoints(state, 0, state.round!.answer!.rank, 9_000, 'say', false),
      );
    });

    it('is not also for sale, so nobody pays for what they are about to be given', () => {
      const { state } = atRound(
        levelled(['new', 'new'], 'pl', 'hard'),
        LEVEL_ASKS.new.indexOf('say'),
      );
      expect(canHint(state, 0, state.round!.began + 1_000)).toBe(false);
      expect(refuse(state, { type: 'hint' }, 0, state.round!.began + 1_000)).toBe(
        'Your hint is free on this one. It arrives in a moment.',
      );
      expect(hintsLeft(state, 0)).toBe(HINT_ALLOWANCE);
    });

    it('arrives well inside the round, with time left to use it', () => {
      // The point of five rather than fifteen: the hint is only worth having
      // if there is round left to spend it in.
      expect(FREE_HINT_MS).toBeLessThan(ROUND_MS / 2);
    });
  });
});

describe('the clock', () => {
  it('closes a round nobody answered, with nobody scoring', () => {
    const state = playing('pl', 'normal', 3);
    const clue = state.round?.clue;
    const after = tick(state, 1_000 + DEFAULT_WINDOW);

    expect(after.phase).toBe('reveal');
    expect(firstRight(after.round!)).toBeNull();
    expect(after.round?.clue).toBe(clue);
    expect(after.scores).toEqual([0, 0, 0]);
    // Everyone who never acted is written in, so the review has no holes.
    expect(after.round?.tries.map((a) => a.how)).toEqual(['timeout', 'timeout', 'timeout']);
    expect(after.deadline).toBe(1_000 + DEFAULT_WINDOW + REVEAL_MS);
  });

  it('lets nobody act during the reveal', () => {
    const state = tick(playing('pl', 'normal', 3), 1_000 + ROUND_MS);
    for (let seat = 0; seat < 3; seat++) expect(canAct(state, seat)).toBe(false);
    expect(refuse(state, { type: 'guess', word: answerOf(state) }, 0)).toBe('Not your move.');
  });

  it('turns a finished reveal into the next clue, and files the old one', () => {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    const first = state.round?.clue;
    state = tick(state, 1_000 + ROUND_MS);
    state = tick(state, 1_000 + ROUND_MS + REVEAL_MS);

    expect(state.phase).toBe('asking');
    expect(state.history.length).toBe(1);
    expect(state.history[0].clue).toBe(first);
    expect(firstRight(state.history[0])).toBeNull();
    expect(state.round?.clue).not.toBe(first);
  });

  it('does nothing before its deadline, and nothing at all once the game is over', () => {
    const state = playing('pl');
    expect(vocab.expire?.(state, 1_000 + DEFAULT_WINDOW - 1)).toBeNull();
    const over: VocabState = { ...state, phase: 'over', deadline: null };
    expect(vocab.expire?.(over, 9_999_999)).toBeNull();
  });

  /**
   * A room woken late -- an alarm that slipped, a dev server that was asleep --
   * gets a fresh clue rather than a burned run of them. This is a game for
   * learning vocabulary, and spending it while nobody is watching is the one
   * thing it must not do.
   */
  it('measures the next round from now, not from the deadline it missed', () => {
    const state = tick(playing('pl'), 1_000 + DEFAULT_WINDOW);
    const late = 1_000 + DEFAULT_WINDOW + REVEAL_MS + 600_000;
    const after = tick(state, late);
    expect(after.phase).toBe('asking');
    expect(after.deadline).toBe(late + DEFAULT_WINDOW);
    // One round spent, not the eleven the missed ten minutes would have paid for.
    expect(after.history.length).toBe(1);
  });

  /**
   * The game only keeps moving because both adapters re-arm on `deadline()`
   * after every tick. This walks a whole game through nothing but the clock,
   * which is what a room with everybody watching and nobody typing really does.
   */
  it('plays a whole game out on the clock alone', () => {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    let now = 1_000;
    for (let step = 0; step < 400 && state.phase !== 'over'; step++) {
      const deadline = state.deadline;
      expect(deadline).not.toBeNull();
      now = deadline! + 1;
      state = tick(state, now);
    }
    expect(state.phase).toBe('over');
    // Nobody typed anything, so nobody scored and the deck is what ran out.
    expect(state.scores).toEqual([0, 0]);
    expect(state.winner).toBeNull();
    expect(state.deadline).toBeNull();
    expect(state.history.length).toBeGreaterThan(50);
  });
});

describe('winning', () => {
  /**
   * Play up to `n` rounds where `seat` answers correctly a second in and
   * everybody else gives up, which is the shortest legal route to a settled
   * round now that one right answer no longer ends it.
   */
  function race(state: VocabState, seat: number, n: number, from = 2_000): { state: VocabState; now: number } {
    let now = from;
    for (let i = 0; i < n && state.phase !== 'over'; i++) {
      state = accept(state, rightMove(state, seat), seat, now);
      state = othersPass(state, seat, now);
      now += REVEAL_MS;
      state = tick(state, now);
      now += 1_000;
    }
    return { state, now };
  }

  it('ends the moment somebody reaches the target, after the reveal', () => {
    const start = playing('pl', 'hard', 2, 1_000, inOrder);
    const { state } = race(start, 0, 200);

    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(state.scores[0]).toBeGreaterThanOrEqual(TARGET);
    expect(state.scores[1]).toBe(0);
    expect(vocab.isOver(state)).toBe(true);
    expect(vocab.turn(state)).toBeNull();
    // A hundred points is a dozen-odd rounds rather than a hundred of them --
    // the target is priced against `roundPoints`, not against a round.
    expect(state.history.length).toBeLessThan(30);
  });

  it('shows the last answer before it ends rather than cutting to the result', () => {
    let state = playing('pl', 'hard', 2, 1_000, inOrder);
    let now = 2_000;
    for (let step = 0; step < 200 && state.scores[0] < TARGET; step++) {
      state = accept(state, rightMove(state), 0, now);
      state = othersPass(state, 0, now);
      if (state.scores[0] >= TARGET) break;
      now += REVEAL_MS;
      state = tick(state, now);
      now += 1_000;
    }

    expect(state.scores[0]).toBeGreaterThanOrEqual(TARGET);
    // Still the reveal: the winning word is on the screen with its meaning
    // under it, which is the whole reason to have played.
    expect(state.phase).toBe('reveal');
    expect(state.round?.answer).not.toBeNull();
    expect(tick(state, now + REVEAL_MS).phase).toBe('over');
  });

  it('reports a shared lead as a tie rather than inventing a tie-break', () => {
    const state: VocabState = {
      ...playing('pl'),
      phase: 'reveal',
      scores: [2, 2],
      round: null,
      deck: [],
      drawn: DECK_DEPTH,
      deadline: 5_000,
    };
    const after = tick(state, 5_000);
    expect(after.phase).toBe('over');
    expect(after.winner).toBeNull();
    expect(vocab.status(after, ['Ala', 'Bo'])).toBe('Game over. Ala and Bo tie.');
  });
});

describe('what each client is told', () => {
  /**
   * The deck is the rest of the game in order. The word lists are downloadable
   * by anybody, so a deck in devtools is a game already won -- the same secret
   * Wheel of Fortune's puzzle bank is, in a different shape.
   */
  it('never sends the deck to anyone', () => {
    const state = playing('pl', 'normal', 4);
    for (let seat = 0; seat < 4; seat++) {
      expect(vocab.view?.(state, seat).deck).toEqual([]);
    }
  });

  it('hides the answer while the round is being raced, from every seat', () => {
    const state = playing('pl', 'normal', 4);
    for (let seat = 0; seat < 4; seat++) {
      const view = vocab.view?.(state, seat);
      expect(view?.round?.answer).toBeNull();
      // The clue is the question, and it is meant to be read.
      expect(view?.round?.clue).toBe(state.round?.clue);
    }
  });

  /**
   * The second secret on a running round, and it arrived with the redesign:
   * a right answer's `said` *is* the answer, and `points` is a function of the
   * rank -- so a live one would narrow the frequency band for the seats still
   * typing. Who has finished, and how it went for them, stays public: it is
   * most of what the tension is made of.
   */
  it('blanks what a finished seat said and scored while others are still racing', () => {
    const state = levelled(['some', 'some', 'some']);
    const word = answerOf(state);
    const after = accept(state, { type: 'guess', word }, 0, 3_000);
    expect(attempt(after, 0).points).toBeGreaterThan(0);

    for (let seat = 0; seat < 3; seat++) {
      const seen = vocab.view?.(after, seat).round?.tries[0];
      expect(seen?.seat).toBe(0);
      expect(seen?.how).toBe('right');
      expect(seen?.ms).toBe(2_000);
      expect(seen?.said).toBe('');
      expect(seen?.points).toBe(0);
    }
  });

  it('stops hiding it the moment the round settles, and keeps it in the history', () => {
    let state = playing('pl');
    const word = answerOf(state);
    state = accept(state, { type: 'guess', word }, 0, 3_000);
    // Still redacted -- seat 1 has not finished, so the round has not settled.
    expect(vocab.view?.(state, 1).round?.answer).toBeNull();

    state = accept(state, { type: 'pass' }, 1, 3_500);
    expect(state.phase).toBe('reveal');
    expect(vocab.view?.(state, 1).round?.answer?.word).toBe(word);
    expect(vocab.view?.(state, 1).round?.tries[0].said).toBe(word);
    expect(vocab.view?.(state, 1).round?.tries[0].points).toBeGreaterThan(0);

    state = tick(state, 3_500 + REVEAL_MS);
    expect(vocab.view?.(state, 1).history[0].answer?.word).toBe(word);
  });

  /**
   * `status` is rendered above every board including during a round, so the
   * secret reaching it would put it on the screen of everyone racing for it.
   * This is the one place that could leak without `view` being touched at all.
   *
   * Which half is the secret depends on which way the round is asked, and that
   * is the whole reason this loop runs long enough to meet both: on a `say`
   * round the word is the secret and the clue is the question, and on a `pick`
   * round they swap. A line that named the answer either way round would be the
   * same bug wearing two faces.
   */
  it('never puts the secret in the status line while it is still being raced', () => {
    let state = playing('pl', 'hard', 2, 1_000, inOrder);
    let now = 1_000;
    let saw = { say: 0, pick: 0 };
    for (let round = 0; round < 20 && state.phase === 'asking'; round++) {
      const line = vocab.status(state, ['Ala', 'Bo']);
      const clue = state.round?.clue ?? '';
      // Pinned whole rather than searched for the secret, and that is the
      // stronger test as well as the only workable one: `mnie` is clued "me",
      // and "me" is a substring of the word "mean" in the line that is supposed
      // to be safe. Saying exactly what the line is leaves nothing to hide in.
      if (state.round?.ask === 'pick') {
        saw.pick++;
        expect(line).toBe(`What does “${answerOf(state)}” mean?`);
      } else {
        saw.say++;
        expect(line).toBe(`Say the Polish for “${clue}”.`);
      }
      now += ROUND_MS;
      state = tick(state, now);
      now += REVEAL_MS;
      state = tick(state, now);
    }
    // The loop is only worth anything if it met both kinds.
    expect(saw.say).toBeGreaterThan(0);
    expect(saw.pick).toBeGreaterThan(0);
  });

  it('says the answer out loud once the round is settled', () => {
    const state = tick(playing('pl'), 1_000 + DEFAULT_WINDOW);
    expect(vocab.status(state, ['Ala', 'Bo'])).toBe(`Nobody had it: ${answerOf(state)}.`);
  });

  it('names who is holding things up during setup, and what they have picked', () => {
    let state = opened(2);
    expect(vocab.status(state, ['Ala', 'Bo'])).toBe('Waiting for Ala to choose a language.');
    state = accept(state, { type: 'settings', lang: 'ja', mode: 'hard' }, HOST, 1_000);
    expect(vocab.status(state, ['Ala', 'Bo'])).toBe(
      'Japanese, top 1,000. Waiting for Ala to start.',
    );
    expect(vocab.turn(state)).toBe(HOST);
  });
});

describe('the reckoning at the end', () => {
  it('counts what each seat got right, got wrong and passed, and how fast they were', () => {
    let state = playing('pl', 'hard', 3, 1_000, inOrder);
    // Seat 2 guesses wrong, seat 0 has it five seconds in, seat 1 gives up.
    state = accept(state, { type: 'guess', word: wrongWord(state, 'pl') }, 2, 2_000);
    state = accept(state, { type: 'guess', word: answerOf(state) }, 0, 6_000);
    state = accept(state, { type: 'pass' }, 1, 7_000);
    expect(state.phase).toBe('reveal');

    const points = attempt(state, 0).points;
    expect(points).toBeGreaterThan(0);
    const stats = vocabStats(state);
    expect(stats.seats[0]).toEqual(
      { seat: 0, won: 1, missed: 0, gaveUp: 0, timedOut: 0, hinted: 0, points, ms: 5_000 },
    );
    expect(stats.seats[1]).toEqual(
      { seat: 1, won: 0, missed: 0, gaveUp: 1, timedOut: 0, hinted: 0, points: 0, ms: 0 },
    );
    expect(stats.seats[2]).toEqual(
      { seat: 2, won: 0, missed: 1, gaveUp: 0, timedOut: 0, hinted: 0, points: 0, ms: 0 },
    );
    expect(stats.quickest?.attempt.seat).toBe(0);
    expect(stats.missedByAll).toEqual([]);
  });

  it('collects the rounds nobody took', () => {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    const first = state.round?.clue;
    state = tick(state, 1_000 + DEFAULT_WINDOW);

    const stats = vocabStats(state);
    expect(stats.missedByAll.map((round) => round.clue)).toEqual([first]);
    expect(stats.quickest).toBeNull();
  });
});

describe('the contract', () => {
  it('seats two to eight', () => {
    expect(vocab.minPlayers).toBe(2);
    expect(vocab.maxPlayers).toBe(8);
    expect(vocab.setup(8, rng, 0).scores).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  /**
   * `turn` is a hint for the status line and nothing else -- there is no such
   * thing as whose turn it is in a race. It names whoever is furthest behind,
   * which is the only seat the game could be said to be waiting on.
   */
  it('answers turn with the seat furthest behind, and never gates anything on it', () => {
    const state: VocabState = { ...playing('pl', 'normal', 3), scores: [2, 0, 1] };
    expect(vocab.turn(state)).toBe(1);
    // Every seat may act, including the two that are not the "turn". Nobody is
    // ever made to wait for a round to open -- the handicap is how long your
    // window lasts and what it pays, which has its own tests.
    for (let seat = 0; seat < 3; seat++) expect(canAct(state, seat, 1_001)).toBe(true);
  });

  it('reports its own deadline, so the adapters can arm a timer on it', () => {
    const state = playing('pl');
    expect(vocab.deadline?.(state)).toBe(state.deadline);
    expect(vocab.deadline?.({ ...state, deadline: null })).toBeNull();
  });

  it('never lets a seat act once its clock has run out', () => {
    const state = playing('pl');
    expect(canAct(state, 0, 1_000 + DEFAULT_WINDOW - 1)).toBe(true);
    expect(canAct(state, 0, 1_000 + DEFAULT_WINDOW)).toBe(false);
  });
});

/**
 * What the clues hand the ledger.
 *
 * This game already grades its own questions along the two axes a scheduler
 * needs, and for reasons of its own: `PICK_SCALE` halves a recognition round,
 * `HINT_SCALE` halves a hinted answer. The only thing `record` has to get
 * right is not throwing those distinctions away.
 */
describe('what it records', () => {
  const outcome = (state: VocabState, seat: number) =>
    vocab.record?.(state, state.scores.length)?.seats.find((s) => s.seat === seat);

  /** One `say` round, answered correctly by seat 0 and passed by seat 1. */
  function answered(now = 2_000): VocabState {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    const word = answerOf(state);
    state = accept(state, { type: 'guess', word }, 0, now);
    return accept(state, { type: 'pass' }, 1, now);
  }

  it('names the game and answers for every seat', () => {
    const rec = vocab.record?.(answered(), 2);
    expect(rec?.gameId).toBe('vocab');
    expect(rec?.seats.map((s) => s.seat)).toEqual([0, 1]);
  });

  it('grades a typed answer as production, and reads speed against your own window', () => {
    // Two seconds out of twenty-two is comfortably inside the fast fraction.
    const said = outcome(answered(1_000 + 2_000), 0)?.learned[0];
    expect(said?.grade).toBe('produced-fast');
    expect(said?.lang).toBe('pl');

    // The same answer, arriving late in the same window.
    const slow = outcome(answered(1_000 + 20_000), 0)?.learned[0];
    expect(slow?.grade).toBe('produced');
  });

  it('keeps giving up apart from being wrong', () => {
    expect(outcome(answered(), 1)?.learned[0].grade).toBe('gave-up');

    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    state = accept(state, { type: 'guess', word: wrongWord(state, 'pl') }, 1, 2_000);
    expect(outcome(state, 1)?.learned[0].grade).toBe('wrong');
  });

  /**
   * The seat that sat there is a phone that locked or somebody who put the
   * game down. Grading it as failure would let one distracted evening bury a
   * hundred words they actually know, so it produces no row at all.
   */
  it('produces nothing whatever for a seat that timed out', () => {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    state = tick(state, 1_000 + ROUND_MS);
    expect(state.round?.tries.every((t) => t.how === 'timeout')).toBe(true);
    expect(outcome(state, 0)?.learned).toEqual([]);
    expect(outcome(state, 1)?.learned).toEqual([]);
  });

  it('grades a recognition round as recognition, not production', () => {
    const first = playing('pl', 'normal', 2, 1_000, inOrder);
    const { state: at, now } = atRound(first, SOME_PICK);
    expect(askIn(at.round, 0)).toBe('pick');

    const right = at.round?.options.indexOf(at.round.clue) ?? -1;
    const state = accept(at, { type: 'choose', option: right }, 0, now + 1_000);
    // Answered in one second flat, and still not production: choosing one
    // meaning of four is a one-in-four guess at worst.
    expect(outcome(state, 0)?.learned.at(-1)?.grade).toBe('recognised');
  });

  it('grades a hinted answer as hinted, which is neither production nor a miss', () => {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    state = accept(state, { type: 'hint' }, 0, 2_000);
    state = accept(state, { type: 'guess', word: answerOf(state) }, 0, 3_000);
    expect(outcome(state, 0)?.learned[0].grade).toBe('hinted');
  });

  it('files a word under its folded lemma rather than the form asked about', () => {
    const state = answered();
    const answer = state.history[0]?.answer ?? state.round?.answer;
    const said = outcome(state, 0)?.learned[0];
    expect(said?.key).toBe(fold(answer?.lemma || answer?.word || ''));
    expect(said?.word).toBe(answer?.word);
  });

  /**
   * The clue is the English meaning, which is exactly what a gloss is. The
   * ledger cannot look one up -- the client has no dictionary and never may --
   * so it has to arrive on the record.
   */
  it('carries the clue as the gloss, and the rank beside it', () => {
    const said = outcome(answered(), 0)?.learned[0];
    expect(said?.gloss).toBeTruthy();
    expect(said?.rank).toBeGreaterThan(0);
  });

  it('reads every round of a finished game, not only the last', () => {
    const first = playing('pl', 'normal', 2, 1_000, inOrder);
    const { state } = atRound(first, 3);
    // Three rounds went past unanswered, so nothing was learned -- but the
    // record still walks all of them rather than stopping at the newest.
    expect(state.history).toHaveLength(3);
    expect(outcome(state, 0)?.learned).toEqual([]);
  });

  it('reports a shared lead as a draw for everybody', () => {
    const state: VocabState = { ...answered(), phase: 'over', winner: null };
    expect(vocab.record?.(state, 2)?.seats.every((s) => s.result === 'drew')).toBe(true);
  });
});

/**
 * A phrase game with the deck unshuffled, so a test can name the phrase it
 * wants: rank `n` is the nth entry in `vocabPhrases.ts`.
 */
function phrasing(lang: VocabLang, rank: number): VocabState {
  let state = playing(lang, 'phrases', 2, 1_000, inOrder);
  while (state.round !== null && state.round.answer?.rank !== rank) {
    if (state.history.length > PHRASE_COUNT) throw new Error('never dealt that phrase');
    state = vocab.expire?.(state, state.deadline ?? 0) ?? state;
    state = vocab.expire?.(state, state.deadline ?? 0) ?? state;
  }
  return state;
}

/**
 * The third mode, which is a different corpus rather than a deeper slice of
 * the same one.
 *
 * What is worth testing here is not the phrases themselves -- they are
 * hand-written and a test can only repeat them -- but the three joints where
 * the new list meets machinery built for the old one: the cap that is a list
 * length rather than a depth, the marking that has no dictionary to appeal to,
 * and the rank that no longer means frequency.
 */
describe('everyday phrases', () => {
  /**
   * The one number that spans the boundary. `MODE_CAP.phrases` is a rank cap
   * used by the reducer, which may not reach the phrase list; the list is the
   * thing that decides how many ranks there are. Nothing but this test keeps
   * them in step, and a phrase added without the constant would silently
   * become a phrase the game never asks.
   */
  it('caps the deck at exactly as many phrases as there are', () => {
    expect(PHRASE_COUNT).toBe(phraseCount());
    expect(MODE_CAP.phrases).toBe(PHRASE_COUNT);
    expect(DECK_DEPTH).toBeGreaterThanOrEqual(PHRASE_COUNT);
  });

  it('has every phrase in both languages, and Japanese in its own script', () => {
    for (const lang of VOCAB_LANGS) {
      for (let rank = 1; rank <= PHRASE_COUNT; rank++) {
        const question = vocabQuestion(lang, 'phrases', rank);
        expect(question, `${lang} #${rank}`).not.toBeNull();
        expect(question!.clue.length).toBeGreaterThan(0);
        // Romaji and Polish only, because that is what the box takes.
        expect(question!.word, `${lang} #${rank}`).toMatch(/^[a-ząćęłńóśźż ,'?-]+$/);
        expect(question!.script.length > 0, `${lang} #${rank}`).toBe(lang === 'ja');
      }
    }
    // Nothing past the end, which is what makes `draw`'s null branch the
    // ordinary way a phrase game runs out of deck.
    expect(vocabQuestion('pl', 'phrases', PHRASE_COUNT + 1)).toBeNull();
    expect(vocabPoolSize('ja', 'phrases', MODE_CAP.phrases)).toBe(PHRASE_COUNT);
  });

  /**
   * `draw` skips a clue it has already asked, so two phrases sharing an
   * English sentence would quietly shorten every game by one round.
   */
  it('asks each English sentence once', () => {
    const clues = Array.from(
      { length: PHRASE_COUNT },
      (_, i) => vocabQuestion('pl', 'phrases', i + 1)?.clue ?? '',
    );
    expect(new Set(clues).size).toBe(PHRASE_COUNT);
  });

  /** The forgiveness, listed. Each of these is a way somebody really types it. */
  it.each([
    ['jestem głodny', 'the phrase as it is written'],
    ['jestem głodna', 'the other gender of the adjective'],
    ['jestem glodna', 'no accents, which a phone keyboard has not got'],
    ['Jestem Głodny!', 'capitals and punctuation'],
    ['  jestem głodny  ', 'the spaces around it'],
  ])('marks %s right (%s)', (typed) => {
    const state = phrasing('pl', 14);
    expect(state.round?.clue).toBe("I'm hungry");
    const after = accept(state, { type: 'guess', word: typed }, 0, 2_000);
    expect(tryOf(after.round, 0)?.how).toBe('right');
  });

  it('takes Japanese in romaji, loosely spelled, or in its own script', () => {
    for (const typed of ['nemui', 'nemui desu', 'NEMUI', '眠い']) {
      const state = phrasing('ja', 17);
      expect(state.round?.clue).toBe("I'm sleepy");
      const after = accept(state, { type: 'guess', word: typed }, 0, 2_000);
      expect(tryOf(after.round, 0)?.how, typed).toBe('right');
    }
  });

  /**
   * The rule that is genuinely different from word mode, and the reason it is
   * different is worth keeping in front of whoever changes it: there is no
   * list a phrase could be absent from, so "not in the Polish list" is not an
   * answer this mode can give. A wrong phrase is wrong. See `applyMove`.
   */
  it('marks a wrong phrase wrong rather than refusing it', () => {
    const state = phrasing('pl', 14);
    const after = accept(state, { type: 'guess', word: 'dobranoc' }, 0, 2_000);
    expect(tryOf(after.round, 0)?.how).toBe('wrong');
    // And so is something that is not Polish at all, which in word mode would
    // have been handed back as a typo rather than counted against the seat.
    const other = accept(phrasing('pl', 14), { type: 'guess', word: 'qqq zzz' }, 0, 2_000);
    expect(tryOf(other.round, 0)?.how).toBe('wrong');
  });

  it('does not let one phrase answer another', () => {
    const keys = (rank: number): ReadonlySet<string> =>
      vocabQuestion('pl', 'phrases', rank)!.accepts;
    for (const key of phraseKeys('dzień dobry', 'pl')) {
      // "Good morning" is that phrase and "Hello" lists it as a second way of
      // saying itself, both true, so this checks the keys are shared where the
      // data says so and nowhere else.
      expect(keys(2).has(key)).toBe(true);
      expect(keys(14).has(key)).toBe(false);
    }
  });

  /**
   * The same unanswerable-question hazard `vocabOptions` was written against,
   * and phrases make it likelier rather than less: several of them share an
   * accepted form outright (*wakarimasen* answers both "I don't understand"
   * and "I don't know"), so a round offering both would be a round with two
   * right answers on the screen.
   */
  it('never offers two meanings the same phrase would satisfy', () => {
    const order = Array.from({ length: DECK_DEPTH }, (_, i) => i + 1);
    const byClue = new Map<string, VocabQuestion>();
    for (let rank = 1; rank <= PHRASE_COUNT; rank++) {
      const question = vocabQuestion('ja', 'phrases', rank);
      if (question !== null) byClue.set(question.clue, question);
    }
    for (let rank = 1; rank <= PHRASE_COUNT; rank++) {
      const question = vocabQuestion('ja', 'phrases', rank)!;
      const options = vocabOptions('ja', 'phrases', rank, PHRASE_COUNT, order);
      expect(options, question.clue).toHaveLength(PICK_OPTIONS);
      expect(options).toContain(question.clue);
      for (const option of options) {
        if (option === question.clue) continue;
        const other = byClue.get(option)!;
        const shared = [...other.accepts].filter((key) => question.accepts.has(key));
        expect(shared, `${question.clue} / ${option}`).toEqual([]);
      }
    }
  });

  /**
   * A phrase's rank is where it was written down, so paying by decade would
   * pay the first nine phrases half what the rest get for no reason anybody
   * could name. See `PHRASE_RARITY`.
   */
  it('pays the same for every phrase, whatever its place in the list', () => {
    const state = playing('pl', 'phrases', 2, 1_000, inOrder);
    const flat = (rank: number): number =>
      roundPoints(state, 0, rank, LEVEL_WINDOW_MS[DEFAULT_LEVEL], 'say', false);
    expect(flat(1)).toBe(flat(PHRASE_COUNT));
    expect(flat(1)).toBe(Math.round(PHRASE_RARITY * LEVEL_SCALE[DEFAULT_LEVEL]));
    // Word mode is untouched: there the decade is the whole point.
    const words = playing('pl', 'hard', 2, 1_000, inOrder);
    expect(roundPoints(words, 0, 900, LEVEL_WINDOW_MS[DEFAULT_LEVEL], 'say', false)).toBeGreaterThan(
      roundPoints(words, 0, 5, LEVEL_WINDOW_MS[DEFAULT_LEVEL], 'say', false),
    );
  });

  it('plays a phrase game through the clock like any other', () => {
    let state = playing('pl', 'phrases', 2, 1_000);
    expect(state.phase).toBe('asking');
    for (let round = 0; round < 6; round++) {
      const before = state.history.length;
      state = vocab.expire?.(state, state.deadline ?? 0) ?? state;
      expect(state.phase).toBe('reveal');
      state = vocab.expire?.(state, state.deadline ?? 0) ?? state;
      expect(state.phase).toBe('asking');
      expect(state.history).toHaveLength(before + 1);
      expect(state.round?.answer?.rank).toBeLessThanOrEqual(PHRASE_COUNT);
    }
  });
});

/**
 * The loop closing: the ledger decides what the game asks next.
 *
 * The rule that constrains the whole feature is that this is a *race*, so the
 * clue has to be identical for every seat. That is why the bias is a union
 * across the table and never a per-seat deck, and it is the first thing to
 * check if any of this is ever changed.
 */
describe('dealing around what the table is due', () => {
  /** The folded study key for the word at `rank`, the way the ledger files it. */
  function studyKeyAt(lang: VocabLang, mode: VocabMode, rank: number): string {
    const question = vocabQuestion(lang, mode, rank);
    if (question === null) throw new Error(`no question at rank ${rank}`);
    return fold(question.lemma || question.word);
  }

  /** A game begun with `study` handed to `setup`, the way the room hands it. */
  function begunWith(study: StudyLists[], lang: VocabLang = 'pl', mode: VocabMode = 'normal') {
    let state = vocab.setup(2, inOrder, 1_000, study);
    state = vocab.start?.(state, 1_000) ?? state;
    state = accept(state, { type: 'settings', lang, mode }, HOST, 1_000);
    return accept(state, { type: 'begin' }, HOST, 1_000);
  }

  it('asks a due word first, rather than wherever the shuffle put it', () => {
    // A word well down the deck, which an unbiased deal would reach late.
    const wanted = 60;
    const key = studyKeyAt('pl', 'normal', wanted);
    const state = begunWith([{ pl: [key] }, {}]);
    expect(state.round?.answer?.rank).toBe(wanted);
  });

  it('changes nothing at all for a table that is due nothing', () => {
    const plain = begunWith([{}, {}]);
    const guests = begunWith([]);
    expect(plain.round?.answer?.rank).toBe(guests.round?.answer?.rank);
    expect(plain.deck).toEqual(guests.deck);
  });

  /**
   * The fairness constraint, stated as a test. Two seats due different words
   * still get one deck, so neither is being asked a different question.
   */
  it('merges the seats rather than dealing anybody their own deck', () => {
    const mine = studyKeyAt('pl', 'normal', 40);
    const theirs = studyKeyAt('pl', 'normal', 70);
    const state = begunWith([{ pl: [mine] }, { pl: [theirs] }]);

    // Both are somewhere in the front of the one shared deck.
    const front = state.deck.slice(0, 2);
    expect(front).toContain(40);
    expect(front).toContain(70);
  });

  it('ignores a study list for a language nobody chose', () => {
    const key = studyKeyAt('pl', 'normal', 60);
    // A Polish list, a Japanese game: rank 60 means a different word in each,
    // so a deck front-loaded for one is meaningless for the other.
    const state = begunWith([{ pl: [key] }], 'ja');
    const plain = begunWith([], 'ja');
    expect(state.deck).toEqual(plain.deck);
  });

  it('keeps the whole deck, reordered rather than filtered', () => {
    const key = studyKeyAt('pl', 'normal', 60);
    const biased = begunWith([{ pl: [key] }]);
    const plain = begunWith([]);
    // A game must not run short of clues because somebody had a short list.
    expect(biased.deck).toHaveLength(plain.deck.length);
    expect([...biased.deck].sort((a, b) => a - b)).toEqual([...plain.deck].sort((a, b) => a - b));
  });

  it('survives a study key the language has never heard of', () => {
    const state = begunWith([{ pl: ['notarealpolishword', ''] }]);
    expect(state.phase).toBe('asking');
    expect(state.round?.answer?.rank).toBeGreaterThan(0);
  });

  /**
   * The deck is the rest of the game in order and this is what ordered it, so
   * a client holding it beside a downloadable word list would know much of
   * what is coming. It is also several people's vocabulary.
   */
  it('never sends the study list to a client', () => {
    const key = studyKeyAt('pl', 'normal', 60);
    const state = begunWith([{ pl: [key] }]);
    for (const seat of [0, 1]) {
      expect(vocab.view?.(state, seat).study).toEqual({});
      expect(vocab.view?.(state, seat).deck).toEqual([]);
    }
  });

  it('plays a game dealt before the ledger existed', () => {
    // A restored snapshot has no `study` at all, which is the game exactly as
    // it was: no bump was taken for this field, so it has to be survivable.
    const state = begunWith([]);
    const old = { ...state, study: undefined as unknown as StudyLists };
    expect(() => vocab.applyMove(old, { type: 'pass' }, 0, rng, 2_000)).not.toThrow();
  });
});
