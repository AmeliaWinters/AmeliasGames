// @vitest-environment jsdom
/**
 * The boundary is the code that runs once everything else has already failed,
 * which makes it the most likely to be wrong and the least likely to be
 * exercised. `boards.test.tsx` asserts that no board throws; this one asserts
 * what happens on the day one does anyway.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary.js';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  // React logs a caught error itself and the boundary logs it again on
  // purpose. Neither is a failure and both make the run unreadable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** Throws while `broken` says to, so a retry can be made to succeed or fail. */
function Boom({ broken }: { broken: () => boolean }) {
  if (broken()) throw new Error('board went bang');
  return createElement('p', null, 'the board');
}

function draw(broken: () => boolean) {
  act(() => root.render(createElement(ErrorBoundary, null, createElement(Boom, { broken }))));
}

/** The button with this exact label, or undefined. Labels are the contract. */
function button(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

it('draws its children when nothing throws', () => {
  draw(() => false);
  expect(host.textContent).toContain('the board');
});

it('catches a throw instead of unmounting to nothing', () => {
  draw(() => true);
  expect(host.textContent).not.toContain('the board');
  // The white page is the bug being fixed, so the assertion is that something
  // is on screen and that it is something the player can act on.
  expect(host.textContent).toContain('That went sideways');
  expect(button('Try again')).toBeTruthy();
});

it('comes back when the retry succeeds', () => {
  let broken = true;
  draw(() => broken);
  broken = false;
  act(() => button('Try again')!.click());
  expect(host.textContent).toContain('the board');
});

/**
 * The loop this is really for. A board that throws on the state it was sent
 * throws again on the same state, so an unconditional "Try again" is a button
 * that does nothing forever and the player never finds the way out.
 */
it('stops offering a retry once it is clearly not transient', () => {
  draw(() => true);
  act(() => button('Try again')!.click());
  act(() => button('Try again')!.click());

  expect(button('Try again')).toBeUndefined();
  expect(button('Back to the games')).toBeTruthy();
});
