import { describe, expect, it } from 'vitest';
import {
  GHOST_KEY_ROWS,
  GHOST_WORD,
  MAX_LETTERS,
  MIN_WORD,
  canAct,
  ghost,
  ghostAlphabet,
  grown,
  openerOf,
  revealNow,
  spelled,
  type GhostLang,
  type GhostMove,
  type GhostSide,
  type GhostState,
} from './ghost.js';
import {
  ghostAlive,
  ghostCommonest,
  ghostLeft,
  ghostListSizes,
  ghostOuts,
  ghostWord,
} from './ghostDictionary.js';

const rng = () => 0.5;

/** A table that has settled on a language and started. */
function playing(lang: GhostLang = 'en'): GhostState {
  let state = ghost.setup(2, rng);
  state = apply(state, { type: 'lang', lang }, 0);
  return apply(state, { type: 'begin' }, 0);
}

/** Apply a move that is expected to be legal, and say so loudly when it is not. */
function apply(state: GhostState, move: GhostMove, seat: number): GhostState {
  const result = ghost.applyMove(state, move, seat, rng);
  if (!result.ok) throw new Error(`refused ${JSON.stringify(move)}: ${result.error}`);
  return result.state;
}

/** Play a run of letters onto one end, alternating seats from whoever is on. */
function run(state: GhostState, letters: string, side: GhostSide = 'end'): GhostState {
  for (const letter of letters) {
    state = apply(state, { type: 'play', side, letter }, state.at);
  }
  return state;
}

describe('the Superghost dictionary', () => {
  it('holds nothing shorter than a word can be finished on', () => {
    // The rule "you cannot lose on a short word" is enforced by what went into
    // the list rather than by a length check at the call site, so this is where
    // it has to hold. A two-letter word in here would leave a fragment alive
    // with nothing reachable behind it.
    for (const lang of ['en', 'pl'] as const) {
      expect(ghostWord(lang, 'by')).toBeNull();
      const short = 'abc'.slice(0, MIN_WORD - 1);
      expect(ghostWord(lang, short)).toBeNull();
    }
  });

  it('answers on substrings, not prefixes, which is the whole variant', () => {
    // `tion` starts nothing and sits inside a great many words. A prefix index
    // would call this dead.
    expect(ghostAlive('en', 'tion')).toBe(true);
    expect(ghostLeft('en', 'tion')).toBeGreaterThan(10);
  });

  it('says a fragment no word contains is dead', () => {
    expect(ghostAlive('en', 'qxz')).toBe(false);
    expect(ghostLeft('en', 'qxz')).toBe(0);
    expect(ghostCommonest('en', 'qxz')).toBeNull();
  });

  it('narrows as the fragment grows, and never widens', () => {
    // The property the cache is built on: every word containing `stan` contains
    // `sta`, so growing the fragment at either end can only take words away. A
    // cache that narrowed from the wrong parent would show up as a count going
    // up.
    let last = ghostLeft('en', 's');
    for (const fragment of ['st', 'sta', 'stan']) {
      const now = ghostLeft('en', fragment);
      expect(now, fragment).toBeLessThanOrEqual(last);
      last = now;
    }
    // And from the other end, which is the half a prefix index cannot do.
    expect(ghostLeft('en', 'tan')).toBeGreaterThanOrEqual(ghostLeft('en', 'stan'));
  });

  it('keeps Polish accents apart, unlike Word Chain', () => {
    // The one place this dictionary deliberately disagrees with
    // `chainDictionary.ts`. Folding here would teach the single thing about
    // Polish spelling a learner most needs to get right, backwards.
    const accented = ghostCommonest('pl', 'ż');
    expect(accented?.word).toMatch(/ż/);
    expect(ghostAlphabet('pl')).toContain('ż');
    expect(ghostAlphabet('en')).not.toContain('ż');
  });

  it('offers only outs that neither die nor finish a word', () => {
    const outs = ghostOuts('en', 'sta');
    expect(outs.length).toBeGreaterThan(0);
    for (const out of outs) {
      const next = grown('sta', out.side, out.letter);
      expect(ghostAlive('en', next), next).toBe(true);
      expect(ghostWord('en', next), next).toBeNull();
    }
  });

  it('has both lists', () => {
    const sizes = ghostListSizes();
    expect(sizes.en).toBeGreaterThan(1000);
    expect(sizes.pl).toBeGreaterThan(1000);
  });
});

describe('Superghost', () => {
  it('starts in setup with Polish already chosen, so a table can just play', () => {
    const state = ghost.setup(2, rng);
    expect(state.phase).toBe('setup');
    expect(state.lang).toBe('pl');
    expect(state.letters).toEqual([0, 0]);
    // Both seats choose at once, so neither waits on the other.
    expect(canAct(state, 0)).toBe(true);
    expect(canAct(state, 1)).toBe(true);
  });

  it('lets either seat set the language, and nobody after the game starts', () => {
    let state = ghost.setup(2, rng);
    state = apply(state, { type: 'lang', lang: 'en' }, 1);
    expect(state.lang).toBe('en');
    state = apply(state, { type: 'begin' }, 0);
    expect(ghost.applyMove(state, { type: 'lang', lang: 'pl' }, 0, rng).ok).toBe(false);
  });

  it('alternates on the fragment once play starts', () => {
    let state = playing();
    expect(state.at).toBe(0);
    expect(canAct(state, 1)).toBe(false);
    state = apply(state, { type: 'play', side: 'end', letter: 's' }, 0);
    expect(state.at).toBe(1);
    expect(state.fragment).toBe('s');
  });

  it('grows at either end, which is the rule Ghost does not have', () => {
    let state = playing();
    state = apply(state, { type: 'play', side: 'end', letter: 't' }, 0);
    state = apply(state, { type: 'play', side: 'start', letter: 's' }, 1);
    expect(state.fragment).toBe('st');
    state = apply(state, { type: 'play', side: 'end', letter: 'a' }, 0);
    expect(state.fragment).toBe('sta');
  });

  it('refuses a letter that is not on the keyboard, and only that', () => {
    const state = playing();
    expect(ghost.applyMove(state, { type: 'play', side: 'end', letter: '7' }, 0, rng).ok).toBe(
      false,
    );
    expect(
      ghost.applyMove(state, { type: 'play', side: 'end', letter: 'ż' }, 0, rng).ok,
      'no accented letters on the English keyboard',
    ).toBe(false);
    // Case is folded rather than refused: two boards saying the same thing.
    expect(ghost.applyMove(state, { type: 'play', side: 'end', letter: 'S' }, 0, rng).ok).toBe(
      true,
    );
  });

  it('plays a dead letter rather than refusing it, and ends the round on it', () => {
    // The rule the whole game is shaped by. Refusing it would make the game
    // unlosable and hand the player the dictionary a keystroke at a time.
    let state = playing();
    state = run(state, 'qx');
    expect(state.phase).toBe('round');
    const reveal = revealNow(state)!;
    expect(reveal.reason).toBe('dead-end');
    // Seat 1 played the second letter, so seat 1 wears it.
    expect(reveal.seat).toBe(1);
    expect(state.letters).toEqual([0, 1]);
    expect(spelled(state, 1)).toBe('G');
    // And the reveal is about the position they threw away, not the dead one.
    expect(reveal.fragment).toBe('qx');
    expect(reveal.word).not.toBe('');
    expect(reveal.played).toEqual({ side: 'end', letter: 'x' });
  });

  it('ends the round on the player who finishes a word', () => {
    let state = playing();
    // `sta` is not a word and `stan` is, so the fourth letter loses.
    state = run(state, 'stan');
    expect(state.phase).toBe('round');
    const reveal = revealNow(state)!;
    expect(reveal.reason).toBe('completed');
    expect(reveal.word).toBe('stan');
    expect(reveal.fragment).toBe('stan');
    // Seat 1 played the fourth letter.
    expect(reveal.seat).toBe(1);
    // The question does not arise on a completed word: they had somewhere to go.
    expect(reveal.outs).toEqual([]);
  });

  it('lets a short word through, so nobody loses on the second letter', () => {
    let state = playing();
    // `so` and `son` are both English words and neither is four letters, so
    // the fragment sails past both. Ghost's "two letters or less" rule, made
    // Superghost's by the floor the index was built to.
    state = run(state, 'so');
    expect(state.phase).toBe('playing');
    state = run(state, 'n');
    expect(state.phase).toBe('playing');
    expect(state.fragment).toBe('son');
    expect(MIN_WORD).toBe(4);
  });

  it('counts what is left, and it only ever falls within a round', () => {
    let state = playing();
    const counts: number[] = [state.left];
    for (const letter of 'sta') {
      state = apply(state, { type: 'play', side: 'end', letter }, state.at);
      counts.push(state.left);
    }
    expect(counts[0]).toBeGreaterThan(0);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `after ${i} letters`).toBeLessThanOrEqual(counts[i - 1]);
    }
  });

  it('takes a give-up as a lost round and shows what was there', () => {
    let state = playing();
    state = run(state, 'st');
    state = apply(state, { type: 'give-up' }, state.at);
    const reveal = revealNow(state)!;
    expect(reveal.reason).toBe('gave-up');
    expect(reveal.seat).toBe(0);
    expect(reveal.played).toBeNull();
    // A give-up from a live position is a player folding a hand they had, and
    // the reveal is what says so.
    expect(reveal.outs.length).toBeGreaterThan(0);
    expect(reveal.word).not.toBe('');
  });

  it('opens the next round from an empty fragment, alternating who starts', () => {
    let state = playing();
    expect(state.at).toBe(openerOf(0));
    state = run(state, 'qx');
    state = apply(state, { type: 'next' }, 1);
    expect(state.phase).toBe('playing');
    expect(state.fragment).toBe('');
    expect(state.round).toBe(1);
    expect(state.at).toBe(openerOf(1));
    expect(state.at).toBe(1);
    // The reveal comes off the screen but stays in the record.
    expect(revealNow(state)).toBeNull();
    expect(state.reveals).toHaveLength(1);
  });

  it('is over when one seat has spelled the whole of GHOST', () => {
    let state = playing();
    for (let round = 0; round < MAX_LETTERS; round++) {
      // The opener alternates, so losing five rounds to the same seat means
      // waiting for seat 0 to be on the fragment rather than playing it out.
      if (state.at !== 0) state = apply(state, { type: 'play', side: 'end', letter: 's' }, 1);
      state = apply(state, { type: 'give-up' }, 0);
      expect(revealNow(state)!.seat).toBe(0);
      if (round < MAX_LETTERS - 1) state = apply(state, { type: 'next' }, 0);
    }
    expect(state.phase).toBe('over');
    expect(ghost.isOver(state)).toBe(true);
    expect(state.loser).not.toBeNull();
    expect(spelled(state, state.loser!)).toBe(GHOST_WORD);
    expect(ghost.winner(state)).toBe(state.loser === 0 ? 1 : 0);
    // Nothing moves once it is over, from either seat.
    expect(canAct(state, 0)).toBe(false);
    expect(canAct(state, 1)).toBe(false);
    expect(ghost.applyMove(state, { type: 'next' }, 0, rng).ok).toBe(false);
  });

  it('files every revealed word against both seats, the loser as shown', () => {
    let state = playing('pl');
    state = run(state, 'ni');
    state = apply(state, { type: 'give-up' }, state.at);
    const givenUp = revealNow(state)!;
    state = apply(state, { type: 'next' }, 0);
    state = run(state, 'qx');

    const record = ghost.record!(state, 2);
    expect(record.gameId).toBe('ghost');
    expect(record.seats).toHaveLength(2);
    for (const outcome of record.seats) {
      expect(outcome.learned).toHaveLength(2);
      for (const learned of outcome.learned) {
        expect(learned.lang).toBe('pl');
        // The folded lemma, so six inflections of one verb are one row.
        expect(learned.key).not.toBe('');
        expect(learned.ms).toBe(0);
      }
    }
    const shown = record.seats[givenUp.seat].learned[0];
    expect(shown.grade).toBe('shown');
    expect(record.seats[givenUp.seat === 0 ? 1 : 0].learned[0].grade).toBe('seen');
  });

  it('is pure: applying a move leaves the state it was given alone', () => {
    const before = playing();
    const snapshot = JSON.parse(JSON.stringify(before));
    apply(before, { type: 'play', side: 'end', letter: 's' }, 0);
    apply(before, { type: 'give-up' }, 0);
    expect(before).toEqual(snapshot);
  });

  it('gives every letter of every keyboard row somewhere to be played', () => {
    // Not a rule about the game, a check on the two constants: a keyboard with
    // a letter the reducer would refuse is a key that does nothing when tapped,
    // and the board draws every key live because every key is legal.
    for (const lang of ['en', 'pl'] as const) {
      const alphabet = ghostAlphabet(lang);
      for (const row of GHOST_KEY_ROWS[lang]) {
        for (const letter of row.toLowerCase()) {
          expect(alphabet, `${lang} ${letter}`).toContain(letter);
          const state = playing(lang);
          expect(
            ghost.applyMove(state, { type: 'play', side: 'end', letter }, 0, rng).ok,
            `${lang} ${letter}`,
          ).toBe(true);
        }
      }
    }
  });

  it('says whose turn it is, and stops saying it between rounds', () => {
    let state = ghost.setup(2, rng);
    expect(ghost.turn(state)).toBeNull();
    state = apply(state, { type: 'begin' }, 0);
    expect(ghost.turn(state)).toBe(0);
    state = run(state, 'qx');
    expect(ghost.turn(state)).toBeNull();
    expect(ghost.status(state, ['Ala', 'Bo'])).toContain('Bo');
  });
});
