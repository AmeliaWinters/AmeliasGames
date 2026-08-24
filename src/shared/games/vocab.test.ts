import { describe, expect, it } from 'vitest';
import {
  DECK_DEPTH,
  HOST,
  MODE_CAP,
  REVEAL_MS,
  ROUND_MS,
  SETUP_MS,
  TARGET,
  VOCAB_LANGS,
  canAct,
  vocab,
  vocabStats,
  type VocabLang,
  type VocabMode,
  type VocabMove,
  type VocabState,
} from './vocab.js';
import { vocabPoolSize, vocabQuestion } from './vocabDictionary.js';
import { chainLookup } from './chainDictionary.js';

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
  const question = vocabQuestion(lang, state.round?.answer?.rank ?? 0);
  if (question === null) throw new Error('no question on the state');
  for (let rank = 1; rank <= DECK_DEPTH; rank++) {
    const other = vocabQuestion(lang, rank);
    if (other === null) continue;
    const entry = chainLookup(lang, other.word);
    if (entry && !question.accepts.has(entry.key)) return other.word;
  }
  throw new Error('every word in the language answers this clue');
}

/** Drive the clock the way `RoomEngine.tick` does, once. */
function tick(state: VocabState, now: number): VocabState {
  return vocab.expire?.(state, now) ?? state;
}

describe('setting the room up', () => {
  it('waits for the host, and lets nobody else touch the settings', () => {
    const state = opened(4);
    expect(state.phase).toBe('setup');
    expect(state.lang).toBeNull();

    for (let seat = 1; seat < 4; seat++) {
      expect(canAct(state, seat)).toBe(false);
      expect(refuse(state, { type: 'settings', lang: 'ja', mode: 'hard' }, seat)).toBe(
        'Not your move.',
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
      Array.from({ length: cap }, (_, i) => vocabQuestion(lang, i + 1)?.clue ?? '');

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
    expect(vocabPoolSize('pl', MODE_CAP.normal)).toBeGreaterThanOrEqual(80);
    expect(vocabPoolSize('ja', MODE_CAP.normal)).toBeGreaterThanOrEqual(80);
    expect(vocabPoolSize('pl', MODE_CAP.hard)).toBeGreaterThanOrEqual(800);
    expect(vocabPoolSize('ja', MODE_CAP.hard)).toBeGreaterThanOrEqual(800);
  });
});

describe('answering', () => {
  it('takes the point for the right word and holds the answer up', () => {
    const state = playing('pl');
    const word = answerOf(state);
    const after = accept(state, { type: 'guess', word }, 1, 6_000);

    expect(after.phase).toBe('reveal');
    expect(after.scores).toEqual([0, 1]);
    expect(after.round?.winner).toBe(1);
    expect(after.round?.ms).toBe(5_000);
    expect(after.deadline).toBe(6_000 + REVEAL_MS);
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
    expect(after.round?.winner).toBe(0);
    // The canonical spelling is what the reveal shows; `said` keeps the truth
    // about what the player actually reached for.
    expect(after.round?.answer?.word).toBe(accented);
    expect(after.round?.said).toBe(accented);
  });

  /**
   * A synonym is a right answer. `accepts` is every word in the language filed
   * under any of the clue's senses, and marking a learner wrong for knowing a
   * second word for "small" is the most discouraging thing this game could do.
   */
  it('takes any word in the language that means the same thing', () => {
    const state = playing('pl', 'hard', 2, 1_000, inOrder);
    const question = vocabQuestion('pl', state.round?.answer?.rank ?? 0);
    expect(question).not.toBeNull();
    expect(question!.accepts.size).toBeGreaterThan(1);

    // Some other word the index files under this clue's meaning.
    const target = chainLookup('pl', question!.word)?.key;
    const other = [...question!.accepts].find((key) => key !== target);
    expect(other).toBeDefined();
    const after = accept(state, { type: 'guess', word: other! }, 1, 3_000);
    expect(after.round?.winner).toBe(1);
  });

  /**
   * The two ways to be wrong, and they cost differently. See point 2 on the
   * reducer: a real word with the wrong meaning is a guess, and a word the list
   * has never heard of is nearly always a typo.
   */
  it('puts a seat out of the round for a real word with the wrong meaning', () => {
    const state = playing('pl');
    const after = accept(state, { type: 'guess', word: wrongWord(state, 'pl') }, 1, 3_000);

    expect(after.phase).toBe('asking');
    expect(after.round?.missed).toEqual([1]);
    expect(after.scores).toEqual([0, 0]);
    // The clock is untouched: being out of a round does not shorten it.
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
    expect(state.round?.missed).toEqual([]);
    expect(canAct(state, 1, 2_000)).toBe(true);
  });

  it('refuses an empty guess without ending anybody, and refuses a move it has never heard of', () => {
    const state = playing('pl');
    expect(refuse(state, { type: 'guess', word: '   ' }, 1)).toBe('Type a word.');
    expect(refuse(state, { type: 'nonsense' } as unknown as VocabMove, 1)).toBe('No such move.');
  });

  it('lets everyone but the seats already out race the same clue', () => {
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
    expect(after.round?.winner).toBe(0);
    expect(after.round?.answer?.word).toBe(canonical);
  });
});

describe('the clock', () => {
  it('closes a round nobody answered, with nobody scoring', () => {
    const state = playing('pl', 'normal', 3);
    const clue = state.round?.clue;
    const after = tick(state, 1_000 + ROUND_MS);

    expect(after.phase).toBe('reveal');
    expect(after.round?.winner).toBeNull();
    expect(after.round?.clue).toBe(clue);
    expect(after.scores).toEqual([0, 0, 0]);
    expect(after.deadline).toBe(1_000 + ROUND_MS + REVEAL_MS);
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
    expect(state.history[0].winner).toBeNull();
    expect(state.round?.clue).not.toBe(first);
  });

  it('does nothing before its deadline, and nothing at all once the game is over', () => {
    const state = playing('pl');
    expect(vocab.expire?.(state, 1_000 + ROUND_MS - 1)).toBeNull();
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
    const state = tick(playing('pl'), 1_000 + ROUND_MS);
    const late = 1_000 + ROUND_MS + REVEAL_MS + 600_000;
    const after = tick(state, late);
    expect(after.phase).toBe('asking');
    expect(after.deadline).toBe(late + ROUND_MS);
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
  /** Take `n` rounds for `seat`, answering each clue correctly the moment it lands. */
  function race(state: VocabState, seat: number, n: number, from = 2_000): { state: VocabState; now: number } {
    let now = from;
    for (let i = 0; i < n; i++) {
      state = accept(state, { type: 'guess', word: answerOf(state) }, seat, now);
      now += REVEAL_MS;
      state = tick(state, now);
      now += 1_000;
    }
    return { state, now };
  }

  it('ends the moment somebody has five, after the reveal', () => {
    const start = playing('pl', 'hard', 2, 1_000, inOrder);
    const { state } = race(start, 0, TARGET);

    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(state.scores).toEqual([TARGET, 0]);
    expect(vocab.isOver(state)).toBe(true);
    expect(vocab.turn(state)).toBeNull();
    expect(state.history.length).toBe(TARGET);
  });

  it('shows the last answer before it ends rather than cutting to the result', () => {
    const start = playing('pl', 'hard', 2, 1_000, inOrder);
    let { state, now } = race(start, 0, TARGET - 1);
    state = accept(state, { type: 'guess', word: answerOf(state) }, 0, now);

    expect(state.scores[0]).toBe(TARGET);
    // Still the reveal: the fifth word is on the screen with its meaning under
    // it, which is the whole reason to have played.
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

  it('stops hiding it the moment the round settles, and keeps it in the history', () => {
    let state = playing('pl');
    const word = answerOf(state);
    state = accept(state, { type: 'guess', word }, 0, 3_000);
    expect(vocab.view?.(state, 1).round?.answer?.word).toBe(word);

    state = tick(state, 3_000 + REVEAL_MS);
    expect(vocab.view?.(state, 1).history[0].answer?.word).toBe(word);
  });

  /**
   * `status` is rendered above every board including during a round, so an
   * answer reaching it would put the answer on the screen of everyone racing
   * for it. This is the one place that could leak it without `view` being
   * touched at all.
   */
  it('never puts the answer in the status line while it is still being raced', () => {
    let state = playing('pl', 'hard', 2, 1_000, inOrder);
    let now = 1_000;
    for (let round = 0; round < 20 && state.phase === 'asking'; round++) {
      const line = vocab.status(state, ['Ala', 'Bo']);
      expect(line).not.toContain(answerOf(state));
      expect(line).toContain(state.round?.clue ?? '');
      now += ROUND_MS;
      state = tick(state, now);
      now += REVEAL_MS;
      state = tick(state, now);
    }
  });

  it('says the answer out loud once the round is settled', () => {
    const state = tick(playing('pl'), 1_000 + ROUND_MS);
    expect(vocab.status(state, ['Ala', 'Bo'])).toBe(`Nobody had it: ${answerOf(state)}.`);
  });

  it('names who is holding things up during setup, and what they have picked', () => {
    let state = opened(2);
    expect(vocab.status(state, ['Ala', 'Bo'])).toBe('Waiting for Ala to choose a language.');
    state = accept(state, { type: 'settings', lang: 'ja', mode: 'hard' }, HOST, 1_000);
    expect(vocab.status(state, ['Ala', 'Bo'])).toBe(
      'Japanese, top 1000. Waiting for Ala to start.',
    );
    expect(vocab.turn(state)).toBe(HOST);
  });
});

describe('the reckoning at the end', () => {
  it('counts what each seat took, what they got wrong, and how fast they were', () => {
    let state = playing('pl', 'hard', 3, 1_000, inOrder);
    // Seat 2 guesses wrong, seat 0 takes it five seconds in.
    state = accept(state, { type: 'guess', word: wrongWord(state, 'pl') }, 2, 2_000);
    state = accept(state, { type: 'guess', word: answerOf(state) }, 0, 6_000);

    const stats = vocabStats(state);
    expect(stats.seats[0]).toEqual({ seat: 0, won: 1, missed: 0, ms: 5_000 });
    expect(stats.seats[1]).toEqual({ seat: 1, won: 0, missed: 0, ms: 0 });
    expect(stats.seats[2]).toEqual({ seat: 2, won: 0, missed: 1, ms: 0 });
    expect(stats.quickest?.round.winner).toBe(0);
    expect(stats.missedByAll).toEqual([]);
  });

  it('collects the rounds nobody took', () => {
    let state = playing('pl', 'normal', 2, 1_000, inOrder);
    const first = state.round?.clue;
    state = tick(state, 1_000 + ROUND_MS);

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
    // Every seat may act, including the two that are not the "turn".
    for (let seat = 0; seat < 3; seat++) expect(canAct(state, seat, 2_000)).toBe(true);
  });

  it('reports its own deadline, so the adapters can arm a timer on it', () => {
    const state = playing('pl');
    expect(vocab.deadline?.(state)).toBe(state.deadline);
    expect(vocab.deadline?.({ ...state, deadline: null })).toBeNull();
  });

  it('never lets a seat act once its clock has run out', () => {
    const state = playing('pl');
    expect(canAct(state, 0, 1_000 + ROUND_MS - 1)).toBe(true);
    expect(canAct(state, 0, 1_000 + ROUND_MS)).toBe(false);
  });
});
