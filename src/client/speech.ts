/**
 * Saying a word out loud, for the one game that needs it.
 *
 * Vocab Race is a language game that, until `hear` rounds existed, never made a
 * sound: every question was an English gloss and a spelling, and for Japanese
 * the spelling was romaji, which is a way of writing a sound nobody writing
 * Japanese uses. This module is what a `hear` round is made of.
 *
 * **The browser's own voices, and nothing shipped.** `speechSynthesis` has
 * Polish and Japanese on every platform this app runs on, and the alternative
 * is recorded audio for a thousand words in two languages, which is both a
 * corpus nobody has and megabytes the worker bundle has no room for (see
 * `scripts/build-wordchain.ts`). The cost of the free option is that the voice
 * is whatever the device has, and on some devices that is nothing at all --
 * which is why `canSpeak` exists and why every caller has to have an answer for
 * false.
 *
 * **Nothing here throws.** Speech synthesis is the flakiest API in the browser:
 * it is missing in some webviews, present but voiceless in others, and on
 * Android it can go silent after a backgrounded tab without ever reporting an
 * error. A game round must not depend on any of that going right, so every
 * entry point degrades to doing nothing and says so through `canSpeak` rather
 * than through an exception.
 */
import { useEffect, useState } from 'react';

import type { VocabLang } from '../shared/games/vocabDisplay.js';

/**
 * The BCP-47 tag to ask for, per language.
 *
 * Regional rather than bare (`pl-PL`, not `pl`), because that is what the
 * voices are actually tagged with and a bare match is a prefix match anyway:
 * `startsWith('pl')` finds `pl-PL` and nothing else, since no other language
 * tag starts with those two letters followed by a hyphen. Japanese is `ja-JP`
 * for the same reason.
 */
const VOICE_LANG: Record<VocabLang, string> = {
  pl: 'pl-PL',
  ja: 'ja-JP',
};

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

/**
 * A voice for `lang`, or null.
 *
 * Prefix-matched on the two-letter half, because a device may have `pl-PL`,
 * `pl_PL` or plain `pl` depending on how its speech engine names things, and a
 * learner does not care which of those is installed. Local voices win over
 * network ones: a network voice on a phone with no signal is silence with a
 * delay in front of it, and the round has thirty seconds.
 */
export function voiceFor(lang: VocabLang): SpeechSynthesisVoice | null {
  const engine = synth();
  if (engine === null) return null;
  let voices: SpeechSynthesisVoice[];
  try {
    voices = engine.getVoices();
  } catch {
    return null;
  }
  const want = VOICE_LANG[lang].slice(0, 2);
  const matches = voices.filter((voice) => voice.lang.slice(0, 2).toLowerCase() === want);
  return matches.find((voice) => voice.localService) ?? matches[0] ?? null;
}

/**
 * Say a word, cancelling anything already being said.
 *
 * The cancel is not tidiness. A player who presses replay twice would otherwise
 * queue two utterances and hear the word said twice in a row with a gap, which
 * on a listening round reads as two different words. Only ever one thing being
 * spoken at a time.
 *
 * Returns whether it got as far as asking. False means the caller should be
 * drawing the word instead.
 */
export function speak(text: string, lang: VocabLang): boolean {
  const engine = synth();
  const voice = voiceFor(lang);
  if (engine === null || voice === null || text === '') return false;
  try {
    engine.cancel();
    const said = new SpeechSynthesisUtterance(text);
    said.voice = voice;
    said.lang = voice.lang;
    // A shade under natural pace. These are single words heard once by somebody
    // who has never heard them before, and the default rate is tuned for
    // sentences read by somebody who already speaks the language.
    said.rate = 0.9;
    engine.speak(said);
    return true;
  } catch {
    return false;
  }
}

/** Stop whatever is being said. Safe to call when nothing is. */
export function hush(): void {
  try {
    synth()?.cancel();
  } catch {
    // Nothing to do about it and nothing worth telling anybody.
  }
}

/**
 * Whether this device can speak `lang`, as state, because the answer changes.
 *
 * `getVoices()` is empty on first call in every Chromium browser and fills in
 * asynchronously, announcing itself through `voiceschanged`. A component that
 * asked once at mount would decide a phone with perfectly good Polish had none,
 * and would decide it exactly once, at the moment the answer is always no. So
 * this is a hook with a subscription rather than a function, and the board
 * re-renders into the audio question when the voices land.
 *
 * The listener is on `speechSynthesis`, which is a singleton, so several boards
 * asking at once is several listeners on one object and each cleans up its own.
 */
export function useCanSpeak(lang: VocabLang): boolean {
  const [can, setCan] = useState(() => voiceFor(lang) !== null);

  useEffect(() => {
    const engine = synth();
    if (engine === null) return;
    const check = () => setCan(voiceFor(lang) !== null);
    check();
    engine.addEventListener('voiceschanged', check);
    return () => engine.removeEventListener('voiceschanged', check);
  }, [lang]);

  return can;
}
