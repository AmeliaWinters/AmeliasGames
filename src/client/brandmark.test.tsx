// @vitest-environment jsdom
/**
 * The one thing about the brand that a stylesheet cannot state.
 *
 * `controls.css` sizes the mark `height: 3em; width: auto`, and its comment
 * has always said the width follows the image's own 1076x438. It does, once
 * the PNG has decoded. Before that, `width: auto` on an image of unknown size
 * is zero, and the mark is the first item in the top bar's flex row and the
 * largest thing on the first screen, so every cold load laid the bar out at
 * the wrong width and shunted it sideways when the bytes landed. A layout
 * shift, on the element most likely to be the LCP, on the screen everybody
 * arrives at.
 *
 * Pinned here rather than left to the CSS comment because nothing else in the
 * repo would notice it going away: `boards.test.tsx` presses the mark's
 * neighbours and passes either way, and the shift is invisible on the fast
 * local load every test does. Both images, because only one of the pair is
 * drawn per palette and the untested one is the one that would rot.
 */
import { beforeAll, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandMark } from './art.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

it('gives the brandmark its aspect ratio before the image loads', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(BrandMark));
  });

  const logos = [...host.querySelectorAll('img.logo')];
  expect(logos).toHaveLength(2);
  for (const logo of logos) {
    // The file's own dimensions. Not a round number and not a guess: a wrong
    // ratio is worse than none, because the bar would settle to a width it had
    // confidently reserved space for and shift anyway.
    expect(logo.getAttribute('width')).toBe('1076');
    expect(logo.getAttribute('height')).toBe('438');
  }

  act(() => root.unmount());
  host.remove();
});
