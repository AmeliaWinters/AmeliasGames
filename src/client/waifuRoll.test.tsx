// @vitest-environment jsdom
/**
 * The pull dialog, pressed.
 *
 * Three things are worth a test here and none of them is the picture.
 *
 *  1. It says what is in the pool and what it costs *before* anything is
 *     spent. That sentence is the whole reason this dialog exists rather than
 *     a button that charges a hundred and shows a face.
 *  2. Pressing Roll rolls. The control it replaces navigated instead, which is
 *     the bug this was written for, so "the press produced a pull" is the
 *     assertion that would have caught it.
 *  3. The spin has a floor and the reveal waits for it. A server that answers
 *     instantly must not flash one face and stop -- that reads as a broken
 *     button -- so the name must be absent partway through and present after.
 *
 * The timers are fake because that floor is a real 1.7 seconds. `waifuApi` is
 * stubbed rather than `fetch`, because the signing in `claimFor` needs an
 * account and this file is about the dialog, not about the key.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WaifuRoll } from './WaifuRoll.js';
import { ROLL_COST, roster } from '../shared/waifu.js';
import type { ProfileView } from '../shared/profile.js';
import type { Rolled } from './waifuApi.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const rolled = vi.hoisted(() => vi.fn());

vi.mock('./waifuApi.js', () => ({
  mintNonce: () => 'AABBCC',
  rollWaifu: (...args: unknown[]) => rolled(...args),
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  if (root && host) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
  rolled.mockReset();
});

/** A profile with enough to spend, since "can afford" is not what is on trial. */
function rich(): ProfileView {
  return { spendable: 1000, showcase: [], claimed: 0 } as unknown as ProfileView;
}

function draw(
  onRolled: (r: Rolled) => void = () => {},
  extra: { onClose?: () => void; profile?: ProfileView } = {},
): HTMLElement {
  host = document.createElement('div');
  document.body.append(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(
      <WaifuRoll
        profile={extra.profile ?? rich()}
        claimed={null}
        onRolled={onRolled}
        onOpenPolycule={() => {}}
        onClose={extra.onClose ?? (() => {})}
      />,
    );
  });
  return el;
}

/** A Tab, as the document sees it. The trap listens in the capture phase. */
function tab(shift = false): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }),
    );
  });
}

function press(host: HTMLElement, className: string): void {
  const button = host.querySelector<HTMLButtonElement>(`.${className}`);
  if (!button) throw new Error(`no .${className} on the dialog`);
  act(() => button.click());
}

describe('the pull dialog', () => {
  it('says what is in the pool and what it costs, before anything is spent', () => {
    const host = draw();
    const text = host.textContent ?? '';
    expect(text).toContain(String(ROLL_COST));
    expect(text).toContain(String(roster().length));
    expect(rolled).not.toHaveBeenCalled();
  });

  it('rolls on the press, and holds the face back for the length of the spin', async () => {
    vi.useFakeTimers();
    const pulled = roster()[3];
    const answer: Rolled = {
      pulled,
      duplicate: false,
      paid: ROLL_COST,
      refusal: null,
      repeat: false,
      claimed: [pulled.id],
      profile: rich(),
    };
    // Instant, which is the case the floor exists for.
    rolled.mockResolvedValue({ ok: true, result: answer });

    const kept = vi.fn();
    const host = draw(kept);
    press(host, 'gacha-roll');

    // Partway through: the request has been made and the answer is in hand,
    // and the dialog is still spinning rather than showing it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(rolled).toHaveBeenCalledTimes(1);
    /* The takeover is `position: fixed` over the whole page, so it is on
       `document` rather than inside the dialog's host. It is the same layer
       the chest lands in; see `chests.test.tsx`. */
    const stage = () => document.querySelector('.roll-theatre');
    expect(stage()?.getAttribute('data-at')).toBe('charging');
    expect(document.body.textContent).not.toContain(pulled.name);
    // And it is actually cycling faces. The spin is the one JavaScript
    // timeline in this app -- CSS cannot walk a list of portraits -- so it is
    // the one thing here no stylesheet test could hold.
    const face = stage()?.querySelector('img')?.getAttribute('src');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(stage()?.querySelector('img')?.getAttribute('src')).not.toBe(face);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stage()?.getAttribute('data-at')).toBe('landed');
    expect(document.body.textContent).toContain(pulled.name);
    expect(document.body.textContent).toContain(pulled.series);
    /* And the reveal wears the shared stagger rather than one of its own. The
       chest on the shop's grid is the same hundred GP and wears these exact
       classes; the two used to be paced separately, and separately is how they
       drifted. */
    expect(stage()!.querySelector('.roll-show.roll-panel')).not.toBeNull();
    expect(stage()!.querySelector('.roll-figure.roll-land')).not.toBeNull();
    expect(stage()!.querySelector('.gacha-name.roll-say')).not.toBeNull();
    // The caches upstream are fed by this and nothing else on this screen.
    expect(kept).toHaveBeenCalledWith(answer);
  });

  it('keeps Tab inside itself, which is what aria-modal promised', () => {
    /*
      The shop's grid stays mounted behind this dialog, so without a trap Tab
      off the last button landed on a chest card: pressable, and able to spend
      the very balance this dialog was open to spend. `aria-modal="true"` had
      been telling screen readers to ignore exactly the content a keyboard was
      about to walk into.

      Driven through `document` rather than through the buttons, because that
      is where the handler is and because the case that matters most is focus
      that has already got out -- which is unreachable by tabbing from inside.
    */
    const host = draw();
    const able = [...host.querySelectorAll<HTMLElement>('button')].filter(
      (el) => !el.hasAttribute('disabled'),
    );
    expect(able.length).toBeGreaterThan(1);
    const first = able[0];
    const last = able[able.length - 1];

    act(() => last.focus());
    tab();
    expect(document.activeElement).toBe(first);

    act(() => first.focus());
    tab(true);
    expect(document.activeElement).toBe(last);

    // And the way back in from outside, which is the state a stray click or a
    // browser's own chrome can leave the page in.
    const stray = document.createElement('button');
    document.body.append(stray);
    act(() => stray.focus());
    tab();
    expect(document.activeElement).toBe(first);
    stray.remove();
  });

  it('closes on Escape however focus got out of it', () => {
    // Escape used to be a handler on the dialog element, so it only fired
    // while focus was still inside -- which is to say, it stopped working in
    // exactly the situation somebody presses it.
    let closed = 0;
    draw(() => {}, { onClose: () => (closed += 1) });
    const stray = document.createElement('button');
    document.body.append(stray);
    act(() => stray.focus());
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closed).toBe(1);
    stray.remove();
  });

  it('offers a retry that reuses the nonce, so a failure cannot charge twice', async () => {
    vi.useFakeTimers();
    rolled.mockResolvedValue({ ok: false, error: 'offline' });
    const host = draw();
    press(host, 'gacha-roll');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    press(host, 'gacha-retry');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(rolled).toHaveBeenCalledTimes(2);
    expect(rolled.mock.calls[0][0]).toBe(rolled.mock.calls[1][0]);
  });
});
