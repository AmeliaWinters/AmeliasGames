// @vitest-environment jsdom
/**
 * The one thing a listening round must never do.
 *
 * A `hear` round's whole question is that the word arrives as a sound. Draw the
 * spelling anywhere on that screen and the round silently becomes a `pick`,
 * which is a question this seat could have been asked anyway, at three quarters
 * of the points instead of half. Nothing about that would look broken: the
 * board would render, the options would work, the game would score, and the
 * feature would simply not exist.
 *
 * `boards.test.tsx` cannot catch it. jsdom has no `speechSynthesis`, so every
 * board it draws is already on the no-voice fallback path, which is the branch
 * that is *supposed* to print the word. So the leak lives exactly where the
 * general test cannot look, and this file stubs a voice in to go and look.
 *
 * Both directions are held, because the fallback is half the design: with a
 * voice, no spelling anywhere; without one, the word drawn, since a phone that
 * cannot say `żółty` has to be able to ask about it somehow.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { VocabBoard } from './VocabBoard.js';
import {
  HOST,
  askIn,
  vocab,
  type VocabLevel,
  type VocabMove,
  type VocabState,
} from '../../shared/games/vocab.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** A voice list, or none, installed as the browser's. */
function withVoices(langs: string[]): void {
  const voices = langs.map((lang) => ({
    lang,
    name: `test ${lang}`,
    localService: true,
    default: true,
    voiceURI: `test-${lang}`,
  })) as SpeechSynthesisVoice[];

  const said: string[] = [];
  (globalThis as { spoken?: string[] }).spoken = said;
  globalThis.speechSynthesis = {
    getVoices: () => voices,
    speak: (utterance: SpeechSynthesisUtterance) => said.push(utterance.text),
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
  } as unknown as SpeechSynthesis;

  // jsdom has no constructor for these either, and `speak` reads `.text`.
  globalThis.SpeechSynthesisUtterance = class {
    text: string;
    lang = '';
    voice: SpeechSynthesisVoice | null = null;
    rate = 1;
    constructor(text: string) {
      this.text = text;
    }
  } as unknown as typeof SpeechSynthesisUtterance;
}

const spoken = (): string[] => (globalThis as { spoken?: string[] }).spoken ?? [];

/** A room at the first clue, with the levels named, and no rng in the deck. */
function playing(levels: VocabLevel[]): VocabState {
  const step = (state: VocabState, move: VocabMove, seat: number): VocabState => {
    const result = vocab.applyMove(state, move, seat, () => 0, 1_000);
    if (!result.ok) throw new Error(result.error);
    return result.state;
  };
  let state = vocab.setup(levels.length, () => 0, 1_000);
  state = vocab.start?.(state, 1_000) ?? state;
  levels.forEach((level, seat) => {
    state = step(state, { type: 'level', level }, seat);
  });
  state = step(state, { type: 'settings', lang: 'pl', mode: 'hard' }, HOST);
  return step(state, { type: 'begin' }, HOST);
}

/** Walk the clock to the first round asked of `seat` as a `hear`. */
function atHearing(state: VocabState, seat: number): VocabState {
  for (let i = 0; i < 12; i++) {
    if (state.phase === 'asking' && askIn(state.round, seat) === 'hear') return state;
    const next = vocab.expire?.(state, (state.deadline ?? 0) + 1);
    if (!next) throw new Error('the clock stopped');
    state = next;
  }
  throw new Error('never reached a listening round');
}

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root && host) {
    const [r, h] = [root, host];
    act(() => r.unmount());
    h.remove();
  }
  root = null;
  host = null;
});

/** Draw a board as `seat` sees it, through `view` like the real client. */
function draw(state: VocabState, seat: number): string {
  const seen = (vocab.view?.(state, seat) ?? state) as VocabState;
  host = document.createElement('div');
  document.body.append(host);
  const created = createRoot(host);
  root = created;
  act(() => {
    created.render(
      createElement(VocabBoard, {
        state: seen,
        seat,
        names: ['Ala', 'Bo'],
        canAct: true,
        connected: [true, true],
        now: seen.round?.began ?? 1_000,
        onMove: () => {},
      }),
    );
  });
  return host.textContent ?? '';
}

describe('a listening round', () => {
  it('says the word and never writes it down', () => {
    withVoices(['pl-PL', 'en-GB']);
    const state = atHearing(playing(['some', 'some']), 0);
    const word = state.round?.answer?.word ?? '';
    expect(word).not.toBe('');

    const text = draw(state, 0);

    // The question was asked out loud, once, by itself.
    expect(spoken()).toEqual([word]);
    // And the spelling is nowhere on the screen, in either case. That is the
    // whole assertion: a `hear` round that draws the word is a `pick` round
    // wearing a speaker, and nothing about it would look broken.
    expect(text).not.toContain(word);
    expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    // The four meanings are still there, one of them the right one. It is a
    // `pick` in every respect except which sense the question arrives through.
    for (const option of state.round?.options ?? []) expect(text).toContain(option);
    expect(state.round?.options).toContain(state.round?.clue);
  });

  it('writes it down on a device that cannot say it', () => {
    // A phone with voices, but none for Polish. This is the fallback, and it is
    // a plain recognition round: the word is drawn, the player reads it, and
    // the question is one they could have been asked anyway.
    withVoices(['en-GB', 'ja-JP']);
    const state = atHearing(playing(['some', 'some']), 0);
    const word = state.round?.answer?.word ?? '';

    const text = draw(state, 0);

    expect(spoken()).toEqual([]);
    expect(text).toContain(word);
    for (const option of state.round?.options ?? []) expect(text).toContain(option);
  });

  it('says the answer on the reveal, whichever way the round was asked', () => {
    withVoices(['pl-PL']);
    let state = atHearing(playing(['some', 'some']), 0);
    const word = state.round?.answer?.word ?? '';
    state = vocab.expire?.(state, (state.deadline ?? 0) + 1) as VocabState;
    expect(state.phase).toBe('reveal');

    const text = draw(state, 0);
    // Now it is both said and shown: the reveal is the moment the spelling is
    // taught rather than demanded.
    expect(spoken()).toEqual([word]);
    expect(text).toContain(word);
  });
});
