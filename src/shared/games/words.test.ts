import { describe, expect, it, vi } from 'vitest';
import {
  duelWords,
  MAX_WORD_LENGTH,
  MIN_WORD_LENGTH,
  allWords,
  WORD_LENGTH,
  WORD_SOURCE,
  isDuelWord,
  isWord,
} from './words.js';
import { MAX_WORD, MIN_WORD } from './wordHuntDisplay.js';

/**
 * The list is imported wholesale and edited by pasting lines in, so the thing
 * worth testing is that neither can quietly go wrong: a token that is too
 * short or too long is filtered out silently and simply never playable.
 */
describe('the word list', () => {
  const tokens = WORD_SOURCE.split(/\s+/).filter(Boolean);

  /**
   * The dictionary costs about 34ms to build and eight of the ten games never
   * open one, so it is built on first use rather than at import. That saving
   * is invisible — nothing fails if it goes away — which is exactly why it is
   * worth a test: one `const WORDS = allWords()` at the top of any module and
   * every cold start pays for a hundred and fifty thousand words again.
   */
  it('is not built merely because a module imported it', async () => {
    vi.resetModules();
    const words = await import('./words.js');
    expect(words.dictionaryIsBuilt()).toBe(false);

    // Importing the registry pulls in every reducer, Word Duel and Word Hunt
    // among them. Still nothing should have asked for a word.
    await import('./index.js');
    expect(words.dictionaryIsBuilt(), 'the registry opened the dictionary').toBe(false);

    words.isWord('CRANE');
    expect(words.dictionaryIsBuilt()).toBe(true);
  });

  it('holds nothing but lower-case letters, at the lengths it claims', () => {
    const pattern = new RegExp(`^[a-z]{${MIN_WORD_LENGTH},${MAX_WORD_LENGTH}}$`);
    const wrong = tokens.filter((word) => !pattern.test(word));
    expect(wrong).toEqual([]);
  });

  it('keeps every token it was given', () => {
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens).size).toBe(allWords().size);
  });

  it('is big enough that playing does not feel like fighting the dictionary', () => {
    expect(allWords().size).toBeGreaterThan(100000);
    expect(duelWords().size).toBeGreaterThan(15000);
  });

  it('holds every length between its two ends', () => {
    const lengths = new Set([...allWords()].map((word) => word.length));
    for (let n = MIN_WORD_LENGTH; n <= MAX_WORD_LENGTH; n++) {
      expect(lengths.has(n), `${n}-letter words`).toBe(true);
    }
  });

  /**
   * The board draws paths to Word Hunt's limits and the server validates
   * against the dictionary's. If those two ever disagree, the player can draw
   * traces the list was never going to take — or is stopped from drawing words
   * that are sitting right there in it.
   */
  it('spans exactly the lengths Word Hunt lets a player trace', () => {
    expect(MIN_WORD_LENGTH).toBe(MIN_WORD);
    expect(MAX_WORD_LENGTH).toBe(MAX_WORD);
  });

  it('gives Word Duel the one length it plays at', () => {
    for (const word of duelWords()) expect(word).toHaveLength(WORD_LENGTH);
    expect(isDuelWord('crane')).toBe(true);
    // A real word, and still not one Word Duel can be asked to take.
    expect(isWord('cranes')).toBe(true);
    expect(isDuelWord('cranes')).toBe(false);
  });

  it('is stored upper case, which is how the reducer works', () => {
    for (const word of allWords()) expect(word).toBe(word.toUpperCase());
  });
});

describe('isWord', () => {
  it('does not care how the player typed it', () => {
    expect(isWord('crane')).toBe(true);
    expect(isWord('CRANE')).toBe(true);
    expect(isWord('CrAnE')).toBe(true);
  });

  it('turns away things that are not on the list', () => {
    expect(isWord('zzzzz')).toBe(false);
    expect(isWord('')).toBe(false);
    // Real words, but outside the range the list was cut to.
    expect(isWord('ox')).toBe(false);
    expect(isWord('splendidly')).toBe(false);
  });

  it('takes the short words Word Hunt is played with', () => {
    for (const word of ['cat', 'dog', 'axe', 'oxen', 'tries', 'strand', 'trances']) {
      expect(isWord(word), `${word} should be a word`).toBe(true);
    }
  });

  it('allows the slang and profanity the list deliberately includes', () => {
    for (const word of ['janky', 'legit', 'bitch', 'fucks', 'cocks', 'pussy', 'porno']) {
      expect(isWord(word)).toBe(true);
    }
  });

  /**
   * The imported dictionary is old enough to predate a lot of ordinary
   * vocabulary — brand names people use as words. `xanax` was the one
   * reported, and it was not being filtered: it simply was not there.
   */
  it('knows the brand names people use as ordinary words', () => {
    for (const word of ['xanax', 'prozac', 'botox', 'tylenol', 'google', 'tiktok', 'vape']) {
      expect(isWord(word), `${word} should be a word`).toBe(true);
    }
  });

  /**
   * The list this replaced was hand-written and full of holes — it was missing
   * `below`, `being` and `alias`, which is what a word game must never do. The
   * words below are the ones that were actually reported; the plain English in
   * the second row is there because those were the embarrassing ones.
   */
  it('knows the ordinary words a hand-written list kept missing', () => {
    const reported = ['trans', 'porno', 'alias', 'cocks', 'pussy'];
    const ordinary = ['below', 'being', 'begin', 'abide', 'beach', 'aisle', 'amuse'];
    for (const word of [...reported, ...ordinary]) {
      expect(isWord(word), `${word} should be a word`).toBe(true);
    }
  });
});
