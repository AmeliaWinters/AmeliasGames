import { describe, expect, it } from 'vitest';
import {
  CARD_MS,
  DRILL_CARDS,
  REVEAL_MS,
  SETUP_MS,
  canAct,
  drill,
  tally,
  type DrillLang,
  type DrillState,
} from './drill.js';
import { vocabQuestion, vocabRanksFor } from './vocabDictionary.js';
import { fold } from './chainDictionary.js';
import type { StudyLists } from '../profile.js';

const rng = () => 0;

/** The folded study key for the word at `rank`, the way the ledger files it. */
function keyAt(lang: DrillLang, rank: number): string {
  const question = vocabQuestion(lang, 'hard', rank);
  if (question === null) throw new Error(`no question at rank ${rank}`);
  return fold(question.lemma || question.word);
}

/** The answer to the card on the table. Server-side knowledge. */
function answerOf(state: DrillState): string {
  const word = state.card?.word;
  if (word === undefined) throw new Error('no card on the table');
  return word;
}

/** A session opened with `study`, its clock armed. */
function opened(study: StudyLists = {}, now = 1_000): DrillState {
  const state = drill.setup(1, rng, now, [study]);
  return drill.start?.(state, now) ?? state;
}

/** ...and a language chosen, so a card is up. */
function asking(study: StudyLists = {}, lang: DrillLang = 'pl', now = 1_000): DrillState {
  return accept(opened(study, now), { type: 'lang', lang }, now);
}

function accept(state: DrillState, move: Parameters<typeof drill.applyMove>[1], now: number): DrillState {
  const result = drill.applyMove(state, move, 0, rng, now);
  if (!result.ok) throw new Error(`refused: ${result.error}`);
  return result.state;
}

function refuse(state: DrillState, move: Parameters<typeof drill.applyMove>[1], seat = 0, now = 2_000): string {
  const result = drill.applyMove(state, move, seat, rng, now);
  if (result.ok) throw new Error('that move was allowed');
  return result.error;
}

/** Drive the clock the way `RoomEngine.tick` does, once. */
function tick(state: DrillState, now: number): DrillState {
  return drill.expire?.(state, now) ?? state;
}

/** Answer the card, wait out the reveal, and land on the next one. */
function next(state: DrillState, word: string | null, now: number): { state: DrillState; now: number } {
  const answered = word === null ? accept(state, { type: 'pass' }, now) : accept(state, { type: 'say', word }, now);
  const after = now + REVEAL_MS;
  return { state: tick(answered, after), now: after };
}

describe('a session of one', () => {
  /**
   * The only genuinely new thing about this game. `RoomEngine` always allowed
   * it -- `canStart` is `short() === 0` -- and nothing had ever taken it up.
   */
  it('seats exactly one', () => {
    expect(drill.minPlayers).toBe(1);
    expect(drill.maxPlayers).toBe(1);
  });

  it('opens on a language menu, with a clock that nobody loses to', () => {
    const state = opened();
    expect(state.phase).toBe('setup');
    expect(state.lang).toBeNull();
    expect(state.deadline).toBe(1_000 + SETUP_MS);
    expect(canAct(state, 0, 1_000)).toBe(true);
  });

  it('lets nobody but the one seat act', () => {
    expect(refuse(opened(), { type: 'lang', lang: 'pl' }, 1)).toBe('Not your session.');
    expect(canAct(opened(), 1, 1_000)).toBe(false);
  });

  it('deals a card the moment a language is chosen', () => {
    const state = asking();
    expect(state.phase).toBe('asking');
    expect(state.card?.clue).toBeTruthy();
    expect(state.deadline).toBe(1_000 + CARD_MS);
  });

  it('refuses a language it has never heard of', () => {
    expect(refuse(opened(), { type: 'lang', lang: 'en' as DrillLang }, 0, 1_000)).toContain('language');
  });
});

describe('answering a card', () => {
  it('takes the word and says so', () => {
    const state = asking();
    const after = accept(state, { type: 'say', word: answerOf(state) }, 3_000);
    expect(after.phase).toBe('reveal');
    expect(after.card?.how).toBe('right');
    expect(after.card?.ms).toBe(2_000);
  });

  it('marks a wrong answer wrong and keeps what was typed', () => {
    const state = asking();
    const after = accept(state, { type: 'say', word: 'zzzzznotaword' }, 3_000);
    expect(after.card?.how).toBe('wrong');
    expect(after.card?.said).toBe('zzzzznotaword');
  });

  /**
   * Not a forfeit. It is how the session keeps moving, and the ledger scores
   * it one rung above a wrong guess -- knowing you do not know is worth about
   * a day.
   */
  it('takes "I do not know it" as its own answer', () => {
    const state = asking();
    const after = accept(state, { type: 'pass' }, 3_000);
    expect(after.card?.how).toBe('gave-up');
    expect(after.card?.said).toBe('');
  });

  it('refuses an empty answer rather than marking it wrong', () => {
    expect(refuse(asking(), { type: 'say', word: '   ' })).toBe('Type the word.');
  });

  /**
   * The clock decides, not the scheduler. A move arriving after the whistle
   * meets a card that is gone rather than one still open because no timer
   * happened to have fired.
   */
  it('refuses a move that arrives after the card timed out', () => {
    const state = asking();
    expect(refuse(state, { type: 'pass' }, 0, 1_000 + CARD_MS)).toBe('That card has gone.');
  });

  it('holds the answer up, then deals the next one', () => {
    const state = asking();
    const revealing = accept(state, { type: 'pass' }, 3_000);
    // Still revealing a moment before the reveal is up.
    expect(tick(revealing, 3_000 + REVEAL_MS - 1).phase).toBe('reveal');
    const on = tick(revealing, 3_000 + REVEAL_MS);
    expect(on.phase).toBe('asking');
    expect(on.done).toHaveLength(1);
    expect(on.card?.clue).not.toBe(revealing.card?.clue);
  });

  it('times a card out rather than leaving it open forever', () => {
    const state = asking();
    const out = tick(state, 1_000 + CARD_MS);
    expect(out.phase).toBe('reveal');
    expect(out.card?.how).toBe('timeout');
  });
});

describe('what it asks about', () => {
  /**
   * The whole reason this game exists: it is a review, so what it asks has to
   * come from what is owed.
   */
  it('asks a word you owe a review on first', () => {
    const wanted = 80;
    const state = asking({ pl: [keyAt('pl', wanted)] });
    expect(state.card?.rank).toBe(wanted);
    expect(state.card?.review).toBe(true);
  });

  it('works up the due list before it reaches anything else', () => {
    const due = [40, 80, 120].map((rank) => keyAt('pl', rank));
    let now = 1_000;
    let state = asking({ pl: due }, 'pl', now);
    const asked: number[] = [];
    for (let i = 0; i < 3; i++) {
      asked.push(state.card?.rank ?? -1);
      ({ state, now } = next(state, null, now + 500));
    }
    expect(asked.sort((a, b) => a - b)).toEqual([40, 80, 120]);
  });

  /**
   * The case *every* account is in on the day it is made, and the worst
   * possible first impression if it were an empty session.
   */
  it('still deals a full session for somebody with nothing due', () => {
    const state = asking();
    expect(state.phase).toBe('asking');
    expect(state.card?.clue).toBeTruthy();
    expect(state.card?.review).toBe(false);
  });

  it('never asks the same clue twice in one session', () => {
    let now = 1_000;
    let state = asking({}, 'pl', now);
    const clues: string[] = [];
    while (state.phase !== 'over' && clues.length < DRILL_CARDS + 2) {
      clues.push(state.card?.clue ?? '');
      ({ state, now } = next(state, null, now + 500));
    }
    expect(new Set(clues).size).toBe(clues.length);
  });

  it('ends after the full run of cards', () => {
    let now = 1_000;
    let state = asking({}, 'pl', now);
    for (let i = 0; i < DRILL_CARDS + 3 && state.phase !== 'over'; i++) {
      ({ state, now } = next(state, null, now + 500));
    }
    expect(state.phase).toBe('over');
    expect(state.done).toHaveLength(DRILL_CARDS);
    expect(drill.isOver(state)).toBe(true);
    expect(state.deadline).toBeNull();
  });

  it('survives a study key the language has never heard of', () => {
    const state = asking({ pl: ['notarealpolishword', ''] });
    expect(state.phase).toBe('asking');
    expect(state.card?.clue).toBeTruthy();
  });

  it('drills Japanese as well as Polish', () => {
    const state = asking({}, 'ja');
    expect(state.phase).toBe('asking');
    expect(state.card?.clue).toBeTruthy();
  });
});

describe('the menu clock', () => {
  /**
   * Nobody should lose a review to a menu. A session starting is better than
   * a room held open on one forever.
   */
  it('picks a language and deals rather than ending the session', () => {
    const state = opened({ ja: [keyAt('ja', 20)] });
    const on = tick(state, 1_000 + SETUP_MS);
    expect(on.phase).toBe('asking');
    // Whichever language they owe the most on, which is the choice they were
    // most likely about to make.
    expect(on.lang).toBe('ja');
  });

  it('picks something even for a profile with nothing due at all', () => {
    const on = tick(opened(), 1_000 + SETUP_MS);
    expect(on.phase).toBe('asking');
    expect(on.lang).not.toBeNull();
  });
});

describe('what a client is told', () => {
  /**
   * The answer is the secret, and it is the *only* secret: a settled card
   * keeps everything, because the reveal is the point and the end screen
   * reads it.
   */
  it('sends the clue and holds the answer back while the card is open', () => {
    const state = asking();
    const seen = drill.view?.(state, 0) ?? state;
    expect(seen.card?.clue).toBe(state.card?.clue);
    expect(seen.card?.word).toBe('');
    expect(seen.card?.lemma).toBe('');
    expect(seen.card?.rank).toBe(0);
  });

  it('hands the answer over the moment the card settles', () => {
    const state = accept(asking(), { type: 'pass' }, 3_000);
    expect(drill.view?.(state, 0).card?.word).toBe(answerOf(state));
  });

  /**
   * The queue is the rest of the session in order, and the study list is what
   * put it in that order. A client holding either beside a downloadable word
   * list would have finished the exercise.
   */
  it('never sends the queue or the study list', () => {
    const state = asking({ pl: [keyAt('pl', 80)] });
    for (const phase of [state, accept(state, { type: 'pass' }, 2_000)]) {
      expect(drill.view?.(phase, 0).queue).toEqual([]);
      expect(drill.view?.(phase, 0).study).toEqual({});
    }
  });
});

describe('what it records', () => {
  const learnedOf = (state: DrillState) => drill.record?.(state, 1)?.seats[0]?.learned ?? [];

  it('grades a right answer as production, and a fast one as fast', () => {
    let state = asking();
    const word = answerOf(state);
    state = accept(state, { type: 'say', word }, 3_000);
    expect(learnedOf(state)[0].grade).toBe('produced-fast');

    let slow = asking();
    slow = accept(slow, { type: 'say', word: answerOf(slow) }, 1_000 + 18_000);
    expect(learnedOf(slow)[0].grade).toBe('produced');
  });

  it('keeps giving up apart from being wrong', () => {
    const passed = accept(asking(), { type: 'pass' }, 3_000);
    expect(learnedOf(passed)[0].grade).toBe('gave-up');
    const wrong = accept(asking(), { type: 'say', word: 'zzzzznotaword' }, 3_000);
    expect(learnedOf(wrong)[0].grade).toBe('wrong');
  });

  /**
   * The card nobody was in front of. Grading it as a failure would let one
   * abandoned session bury a dozen words somebody knows.
   */
  it('records nothing at all for a card that timed out', () => {
    const out = tick(asking(), 1_000 + CARD_MS);
    const settled = tick(out, 1_000 + CARD_MS + REVEAL_MS);
    expect(settled.done[0].how).toBe('timeout');
    expect(learnedOf(settled)).toEqual([]);
  });

  /**
   * The opposite of how a game usually treats a forfeit, and right here for
   * the reason the whole session is short: a person who reviewed four words
   * must not be told they reviewed none.
   */
  it('banks the cards of a session that was abandoned half way', () => {
    let now = 1_000;
    let state = asking({}, 'pl', now);
    for (let i = 0; i < 4; i++) ({ state, now } = next(state, null, now + 500));
    expect(state.phase).toBe('asking');
    expect(learnedOf(state)).toHaveLength(4);
  });

  it('files a word under its folded lemma, and carries what the ledger draws', () => {
    const state = accept(asking(), { type: 'pass' }, 3_000);
    const row = learnedOf(state)[0];
    const card = state.card;
    expect(row.key).toBe(fold(card!.lemma || card!.word));
    expect(row.gloss).toBe(card!.clue);
    expect(row.rank).toBeGreaterThan(0);
    expect(row.lang).toBe('pl');
  });

  /** Nobody wins a review, and the record says so rather than inventing one. */
  it('reports no result', () => {
    const record = drill.record?.(accept(asking(), { type: 'pass' }, 3_000), 1);
    expect(record?.gameId).toBe('drill');
    expect(record?.seats[0].result).toBeNull();
  });
});

describe('the end screen', () => {
  it('counts how it went, and how much of it was owed', () => {
    const due = keyAt('pl', 80);
    let now = 1_000;
    let state = asking({ pl: [due] }, 'pl', now);

    // The first card is the review; answer it right.
    expect(state.card?.review).toBe(true);
    ({ state, now } = next(state, answerOf(state), now + 500));
    // The next two are filler; miss one and pass the other.
    ({ state, now } = next(state, 'zzzzznotaword', now + 500));
    ({ state, now } = next(state, null, now + 500));

    expect(tally(state)).toMatchObject({ right: 1, wrong: 1, passed: 1, reviewed: 1 });
  });

  it('says something sensible about a session nobody played', () => {
    const state = opened();
    expect(drill.status({ ...state, phase: 'over' }, ['Amelia'])).toBe('Nothing reviewed.');
  });
});

describe('the study index', () => {
  /**
   * The join between a profile and a deck, and the one thing that has to
   * agree across three files: the ledger folds `lemma || word`, and so must
   * this, or the index matches nothing and the whole feature is silently off.
   */
  it('finds the rank of a word by the key the ledger files it under', () => {
    const ranks = vocabRanksFor('pl', [keyAt('pl', 50)]);
    expect(ranks.has(50)).toBe(true);
  });

  it('answers empty for a key the language does not have', () => {
    expect(vocabRanksFor('pl', ['notarealpolishword']).size).toBe(0);
    expect(vocabRanksFor('pl', []).size).toBe(0);
  });
});
