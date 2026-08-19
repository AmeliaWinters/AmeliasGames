import { describe, expect, it } from 'vitest';
import { WORDS, WORD_LENGTH, WORD_SOURCE, isWord } from './words.js';

/**
 * The list is edited by pasting lines in, so the thing worth testing is that a
 * paste cannot quietly go wrong: a four-letter typo would otherwise be
 * filtered out silently and simply never be guessable.
 */
describe('the word list', () => {
  const tokens = WORD_SOURCE.split(/\s+/).filter(Boolean);

  it('holds nothing but five lower-case letters', () => {
    const wrong = tokens.filter((word) => !/^[a-z]{5}$/.test(word));
    expect(wrong).toEqual([]);
  });

  it('keeps every token it was given', () => {
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens).size).toBe(WORDS.size);
  });

  it('is big enough that guessing does not feel like fighting the dictionary', () => {
    expect(WORDS.size).toBeGreaterThan(15000);
  });

  it('agrees with WORD_LENGTH', () => {
    for (const word of WORDS) expect(word).toHaveLength(WORD_LENGTH);
  });

  it('is stored upper case, which is how the reducer works', () => {
    for (const word of WORDS) expect(word).toBe(word.toUpperCase());
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
  });

  it('allows the slang and profanity the list deliberately includes', () => {
    for (const word of ['janky', 'legit', 'bitch', 'fucks', 'cocks', 'pussy', 'porno']) {
      expect(isWord(word)).toBe(true);
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
