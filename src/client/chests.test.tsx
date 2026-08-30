// @vitest-environment jsdom
/**
 * The chest press, and the beat it now has.
 *
 * The screen already had tests for nothing: it was the one purchase in this
 * app with no coverage of what a press looks like, which is how it ended up
 * being the cheap-feeling half of a pair of hundred-GP spends. The pull dialog
 * has `waifuRoll.test.tsx` for exactly this, and this file is its twin.
 *
 * Three things, and none of them is the picture:
 *
 *  1. The press spins, in the slot the answer is about to take. A chest that
 *     answers in 5ms used to show a border pulse for one frame.
 *  2. The spin cycles. It walks parts of the set being opened, so the wait is
 *     an answer to "what is in here" -- and it is the one part of this that no
 *     stylesheet test can hold, because it is a JavaScript ticker.
 *  3. The answer replaces it, wearing the shared stagger. `roll-panel` and
 *     `roll-land` are the classes the gacha's reveal wears too, and the two
 *     drifting apart is the bug this whole change is about.
 *
 * Timers are fake because the spin is a real 1.7 seconds. `chestApi` is
 * stubbed rather than `fetch`: the signing needs an account, and this file is
 * about the screen.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Chests } from './Chests.js';
import { SETS } from './avatar/manifest.js';
import { CHEST_COST } from '../shared/chest.js';
import type { ProfileView } from '../shared/profile.js';
import type { ChestOpened } from './chestApi.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const opened = vi.hoisted(() => vi.fn());

vi.mock('./chestApi.js', () => ({
  mintNonce: () => 'AABBCC',
  openChest: (...args: unknown[]) => opened(...args),
}));

const set = SETS[0];

const profile = {
  spendable: CHEST_COST * 4,
} as ProfileView;

const answer: ChestOpened = {
  drop: set.parts[0].id,
  granted: [],
  refusal: null,
  repeat: false,
  owned: [set.parts[0].id],
  profile,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  /* jsdom has no `matchMedia`, and `wantsStillness` guards on the function
     existing -- so without this the spin is skipped as if somebody had asked
     for less motion, and every assertion below would pass by drawing nothing.
     Answering "no" here is answering the question the spin actually asks. */
  vi.stubGlobal('matchMedia', () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  opened.mockReset();
  vi.useRealTimers();
});

function draw(): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <Chests
        profile={profile}
        owned={[]}
        claimed={[]}
        focus={null}
        onOpened={() => {}}
        onBack={() => {}}
        onEquip={() => {}}
        onOpenWaifu={() => {}}
        onRolled={() => {}}
      />,
    );
  });
  return host;
}

/** The first card's own open button. The gacha's card leads the grid. */
function openFirstChest(where: HTMLElement): void {
  const card = where.querySelectorAll('.chest-card')[1] as HTMLElement;
  const button = card.querySelector('.chest-open') as HTMLButtonElement;
  act(() => button.click());
}

describe('opening a chest', () => {
  it('spins through the set while the request is out, then lands the drop', async () => {
    vi.useFakeTimers();
    // Instant, which is the case the spin exists for: without a floor the
    // press has no beat at all and the item is simply there.
    opened.mockResolvedValue({ ok: true, result: answer });

    const where = draw();
    openFirstChest(where);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(opened).toHaveBeenCalledTimes(1);
    const spin = where.querySelector('.chest-spin');
    expect(spin, 'the press produced no spin').not.toBeNull();
    expect(spin!.querySelector('.roll-art-spin'), 'the spin does not move').not.toBeNull();

    // And it is cycling. This is the half no stylesheet test can hold: the
    // pictures are a change of markup, and CSS cannot walk a list.
    const first = spin!.innerHTML;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(where.querySelector('.chest-spin')!.innerHTML).not.toBe(first);
  });

  it('replaces the spin with the reveal, in the stagger the gacha uses', async () => {
    vi.useFakeTimers();
    opened.mockResolvedValue({ ok: true, result: answer });

    const where = draw();
    openFirstChest(where);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(where.querySelector('.chest-spin'), 'the spin outlived the answer').toBeNull();
    /* The classes are `roll.css`'s, and they are the ones `waifuRoll.test.tsx`
       asserts on the pull. Two hundred-GP presses paced by one file is the
       whole point; asserting the class names is how that survives somebody
       tidying one of the two screens. */
    expect(where.querySelector('.chest-reveal.roll-panel')).not.toBeNull();
    expect(where.querySelector('.chest-drop-art.roll-land')).not.toBeNull();
    expect(where.querySelector('.chest-drop-name.roll-say')).not.toBeNull();
  });

  it('says a refusal at once, with none of the theatre', async () => {
    vi.useFakeTimers();
    // A refusal is the answer to a question, not a present, and `applyChest`
    // refuses before it charges. Pacing it like a drop would be dressing up a
    // no.
    opened.mockResolvedValue({
      ok: true,
      result: { ...answer, drop: null, refusal: 'too-poor' as const },
    });

    const where = draw();
    openFirstChest(where);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(where.textContent).toContain('Nothing was taken');
    expect(where.querySelector('.chest-reveal.roll-panel'), 'a refusal is staged').toBeNull();
  });
});
