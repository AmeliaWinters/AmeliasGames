// @vitest-environment jsdom
/**
 * Every board, drawn in every state its game can reach, and prodded.
 *
 * The reducers are the best-covered code here and the boards were the worst,
 * which is the wrong way round: a reducer that is wrong is caught by one of two
 * thousand rules tests, and a board that is wrong is caught by somebody on a
 * phone, mid-game, and reported as a white screen. Nothing in this file knows
 * anything about any particular game. It asks three questions of all thirteen:
 *
 *  1. Does it draw at all, in every phase, at both ends of its seat range, from
 *     every seat and from no seat? A board that throws is the white screen.
 *  2. With `canAct` false, is there anything on it that still sends a move?
 *  3. Is there anything on it that sends a move *for a seat that has none*?
 *
 * Two and three are asked by clicking, not by reading class names. A control
 * that is visually greyed and still wired up is exactly the bug this is for,
 * and only the click can tell the difference. `onMove` is the contract, so
 * "did anything call `onMove`" is the whole question -- boards may guard the
 * handler, guard with `disabled`, or not render the control at all, and all
 * three are correct answers.
 *
 * See `boardFixtures.ts` for where the states come from and why none of them is
 * written by hand.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Suspense, act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GAMES } from '../../shared/games/index.js';
import { boardFor, preloadAllBoards } from './boards.js';
import { fixturesFor, playableIds, type Fixture } from './boardFixtures.js';
import type { BoardProps } from './boards.js';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(async () => {
  // Without it every render logs "the current testing environment is not
  // configured to support act(...)", and the warning is telling the truth:
  // effects would not be flushed and half these boards do their measuring in
  // one.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  /*
    jsdom has no layout and no animation, and several boards ask for both on
    mount. Stubbed rather than mocked away, because what is being tested is
    that the board survives an environment that answers "nothing" to every
    measurement -- which is also what a real browser answers for one frame, on
    a slow phone, before the first layout. Two boards have shipped a crash in
    exactly that window.
  */
  if (!globalThis.matchMedia) {
    globalThis.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof globalThis.matchMedia;
  }
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // jsdom has no scrolling, so it has no `scrollIntoView`, and three boards
  // keep the newest row in view with one. An absent method is not the same
  // failure as a broken board and must not read as one here.
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= (() => {}) as never;

  // A canvas board (the dice tray) asks for a context. jsdom returns null
  // without one of these and null is the honest answer here, so the board is
  // being held to coping with it.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;

  /*
    Every board is a `lazy` chunk now, and a lazy component's first render
    suspends until the module loader answers -- which, under vite-node, is real
    async work and not a microtask. Fetching all fifteen once here is what lets
    `draw` below stay a bounded flush instead of a race: by the time anything
    renders, every `import()` a thunk makes is a cache hit that settles on the
    next tick.
  */
  await preloadAllBoards();
});

/** Mounted roots, torn down after each test so no board keeps a timer alive. */
const mounted: Array<{ root: Root; host: HTMLElement }> = [];

afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

interface Rendered {
  host: HTMLElement;
  /** Every move the board sent, in order. */
  moves: unknown[];
}

/**
 * Draw one board, once.
 *
 * `seat` may be null and that is not an edge case: a spectator socket has no
 * seat, and "a board must not assume it has one" is written on `BoardProps`
 * rather than enforced anywhere. Here it is enforced.
 *
 * Async because every board is a `lazy` chunk now, and a lazy component
 * suspends on its first render however fast the import resolves. So this draws
 * through the same `Suspense` boundary `screens/Room.tsx` puts around it and
 * flushes with an async `act`, which is what settles the import and mounts the
 * real board. Nothing below asks a weaker question than it did when this was
 * synchronous: `prodEverything` still runs against a fully mounted board, and
 * the two things that would quietly hollow this file out -- a board that never
 * arrives, or a fallback being prodded instead of a board -- both fail, the
 * first on the "drew nothing at all" count and the second on the "gives a seat
 * that can act something to press" total.
 */
async function draw(
  gameId: string,
  fixture: Fixture,
  seat: number | null,
): Promise<Rendered> {
  const def = GAMES[gameId];
  const Board = boardFor(gameId) as ComponentType<BoardProps<unknown, unknown>> | null;
  if (!Board) throw new Error(`${gameId} is in GAMES with no board in boards.ts`);

  // What the socket would have delivered: the state as this seat is entitled
  // to see it, and the server's own answer to whether it may move.
  const state = seat !== null && def.view ? def.view(fixture.state, seat) : fixture.state;
  const canAct = seat !== null && def.canAct(fixture.state, seat, fixture.now);

  const moves: unknown[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });

  const tree = createElement(
    Suspense,
    // A fallback that draws nothing, deliberately: if a chunk ever failed to
    // settle, a board left showing its fallback has to look like the empty box
    // "drew nothing at all" already fails on, rather than like something.
    { fallback: null },
    createElement(Board, {
      state,
      seat,
      names: Array.from({ length: fixture.seats }, (_, i) => `Player ${i + 1}`),
      canAct,
      connected: Array.from({ length: fixture.seats }, () => true),
      now: fixture.now,
      onMove: (move: unknown) => moves.push(move),
    }),
  );

  await act(async () => {
    root.render(tree);
  });

  return { host, moves };
}

/**
 * Press everything pressable, and type into everything typable.
 *
 * `disabled` elements are skipped for the reason a finger skips them: the
 * browser will not dispatch a click to one either, so clicking it here would
 * be testing jsdom rather than the board. Everything else on the board is fair
 * game, which is the point -- a control the board *left enabled* is a control
 * a player can reach.
 */
function prodEverything(host: HTMLElement): void {
  /*
    Several passes, re-reading the board each time, because a control here may
    only exist once another has been pressed, and because the two confirm
    idioms in this app want opposite things from a prodder.

    Battleships fires on a *second* press of the same square: the first aims,
    since a shot cannot be taken back and costs the turn. Pressing every square
    once moved the crosshair a hundred times and fired nothing.

    Backgammon is the other way round. A press picks a checker up and a press
    on the same point puts it down again; the move is a press on one point and
    then a press on a *different* one. Pressing everything twice picked every
    checker up and set it back down, and the board that had just been proved
    playable stopped being so.

    So: single presses, then double presses, then single again. Neither order
    alone is enough and there is no third idiom to guess at.
  */
  for (const presses of [1, 2, 1]) prodOnce(host, presses);
}

function prodOnce(host: HTMLElement, presses: number): void {
  const controls = [
    ...host.querySelectorAll<HTMLButtonElement>('button'),
    ...host.querySelectorAll<HTMLElement>('[role="button"]'),
  ];
  for (const control of controls) {
    if ((control as HTMLButtonElement).disabled) continue;
    if (control.getAttribute('aria-disabled') === 'true') continue;
    for (let press = 0; press < presses; press++) {
      if ((control as HTMLButtonElement).disabled) break;
      act(() => {
        control.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }
  }

  // The word games send on Enter as well as on the button, and the button is
  // usually the half that is disabled properly.
  for (const field of host.querySelectorAll<HTMLInputElement>('input')) {
    if (field.disabled || field.readOnly) continue;
    act(() => {
      // React listens for the event, not the property, so the native setter is
      // the only way to make a controlled field believe it was typed into.
      // This is the same trick `CLAUDE.md` records for the preview pane.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'CAT');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    act(() => {
      field.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }
}

/** Every game with a board, and everything reachable in it. */
const CASES: Array<[string, Fixture[]]> = playableIds().map((id) => [id, fixturesFor(id)]);

describe('every game in GAMES', () => {
  it('has a board, so a dealt room is never a blank screen', () => {
    const missing = Object.keys(GAMES).filter((id) => boardFor(id) === null);
    expect(
      missing,
      `${missing.join(', ')} can be dealt by the server and drawn by nothing. ` +
        'Add an entry to BOARDS in boards.ts.',
    ).toEqual([]);
  });

  it('is walked into more than its opening position', () => {
    // Guards the guard. A proposer that stopped proposing anything legal would
    // leave a game with one fixture, and every test below it would pass
    // against the setup screen alone and say nothing.
    for (const [id, fixtures] of CASES) {
      expect(fixtures.length, `${id} never got past setup`).toBeGreaterThan(1);
      expect(
        fixtures.some((f) => f.name.endsWith(': over')),
        `${id} never reached a finished game, so its endgame screen is undrawn`,
      ).toBe(true);
    }
  });
});

describe.each(CASES)('%s', (gameId, fixtures) => {
  const seatsOf = (fixture: Fixture): Array<number | null> => [
    ...Array.from({ length: fixture.seats }, (_, i) => i),
    null, // the spectator
  ];

  it('draws in every state it can reach, from every seat and from none', async () => {
    for (const fixture of fixtures) {
      for (const seat of seatsOf(fixture)) {
        // The same question as before -- does drawing this throw -- asked of a
        // promise, because drawing is async now. A board that throws on mount
        // rejects here and fails with its own error, which is what
        // `.not.toThrow()` was for.
        await expect(
          draw(gameId, fixture, seat),
          `${fixture.name}, seat ${seat}`,
        ).resolves.toBeTruthy();
      }
    }
  });

  it('draws something, rather than drawing nothing without complaining', async () => {
    /*
      A board that renders `null` throws nothing and sails through the test
      above, and "the game did not appear" is the report this whole file exists
      to make impossible.

      Elements and not text: Connect Four's board is forty-two empty spans and
      seven aria-labelled buttons, and it carries no text at all. Counting
      characters called that an empty box, which says something about the
      assertion rather than about the board.
    */
    for (const fixture of fixtures) {
      const { host } = await draw(gameId, fixture, 0);
      expect(
        host.querySelectorAll('*').length,
        `${fixture.name} drew nothing at all`,
      ).toBeGreaterThan(0);
    }
  });

  it('sends no move from a seat the server says cannot act', async () => {
    for (const fixture of fixtures) {
      const def = GAMES[gameId];
      for (let seat = 0; seat < fixture.seats; seat++) {
        if (def.canAct(fixture.state, seat, fixture.now)) continue;
        const { host, moves } = await draw(gameId, fixture, seat);
        prodEverything(host);
        expect(
          moves,
          `${fixture.name}: seat ${seat} cannot act, and pressing every live ` +
            `control on its board sent ${moves.length} move(s): ` +
            `${JSON.stringify(moves.slice(0, 3))}. Gate them on \`canAct\`.`,
        ).toEqual([]);
      }
    }
  });

  it('sends no move from a socket with no seat at all', async () => {
    /*
      The spectator, and the one of these three that has actually bitten. A
      board gating on `canAct` alone is correct for a seated player and wrong
      for a watcher, because `canAct` arrives false for both and several boards
      then reached for `seat` to decide what to draw. `seat` is null here, and a
      board that indexes an array with it draws somebody else's hand.
    */
    for (const fixture of fixtures) {
      const { host, moves } = await draw(gameId, fixture, null);
      prodEverything(host);
      expect(
        moves,
        `${fixture.name}: a socket with no seat sent ${JSON.stringify(moves.slice(0, 3))}`,
      ).toEqual([]);
    }
  });

  it('sends no move once the game is over', async () => {
    // The one state where every seat is finished, and the one where a board is
    // most likely to have been written as "draw the final position" with the
    // controls left in place above it.
    for (const fixture of fixtures.filter((f) => f.name.endsWith(': over'))) {
      for (let seat = 0; seat < fixture.seats; seat++) {
        const { host, moves } = await draw(gameId, fixture, seat);
        prodEverything(host);
        expect(
          moves,
          `${fixture.name}: seat ${seat} could still move after the game ended`,
        ).toEqual([]);
      }
    }
  });

  it('gives a seat that can act something to press', async () => {
    /*
      The other half of the bargain, and the reason the three tests above are
      not satisfied by a board that renders nothing at all. Aggregated over the
      whole walk rather than asserted per state, because "this seat may act"
      does not mean "on this screen": Battleships' firing phase gives the seat
      on the clock a grid and the other seat a wait, and both are `canAct` in
      the phases where placing is simultaneous.
    */
    const def = GAMES[gameId];
    let sent = 0;
    for (const fixture of fixtures) {
      for (let seat = 0; seat < fixture.seats; seat++) {
        if (!def.canAct(fixture.state, seat, fixture.now)) continue;
        const { host, moves } = await draw(gameId, fixture, seat);
        prodEverything(host);
        sent += moves.length;
      }
    }
    expect(
      sent,
      'no control anywhere on this board sent a move, in any state, from any ' +
        'seat entitled to make one. Either the board is unplayable or the ' +
        'tests above are passing vacuously.',
    ).toBeGreaterThan(0);
  });
});
