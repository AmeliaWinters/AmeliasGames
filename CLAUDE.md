# Working in this repo

`README.md` explains what the project *is* — the one-brain-two-transports
architecture, why every game is a pure reducer, how the dice and the wheel
decide what they decide. Read it before changing anything in `src/shared/`.

This file is the other thing: how to **verify** work here, and the traps that
have cost real time. It is short on purpose.

```
npm run dev          app on :5173, game server on :8787
npm test             rules + server + bundle tests
npm run typecheck    all four tsconfigs
npm run render:throw draw a dice throw to preview/*.png  (see below)
```

## Verifying visual work

**Measure at a phone width first.** Nearly every visual bug reported here has
been a phone bug, and several of them invert on a desktop viewport. A die slot
measured 58 × 58 at 1280px and 19.8 × **44** at 375px — the same CSS, because
`button { min-height: 44px }` beats `aspect-ratio` only once the element is
under 44px. Checking the wide case first produced a confident wrong answer.
Reproduce at 320, 375 and 390 before forming a theory.

**The in-app Browser pane cannot show you moving pixels.** It runs as a hidden
document: `requestAnimationFrame` never fires, `setTimeout` is clamped to about
a second, and `computer` actions and screenshots both time out after 30s with
"the pane is not displayed, so the page is not compositing frames". `read_page`,
`find`, `navigate` and `javascript_tool` all work. So:

- **Layout, colour and contrast** — measure, don't look. `getBoundingClientRect`
  for geometry, `getComputedStyle` for colour, a WCAG ratio computed in-page for
  contrast. Stricter than looking, and it works.
- **Anything that moves** — render it. See below.
- `form_input` does not work on React-controlled fields; it sets the DOM
  property without the event React listens for. Use the native setter and
  dispatch `input`/`change` yourself. Plain `element.click()` on a button is fine.

**Ask for the pane rather than routing around it.** "Display the pane and retry"
is a request for one human action, and it is cheaper than an afternoon of
workarounds.

## Looking at the dice without a browser

```
npm run render:throw            # current constants
npm run render:throw -- --old   # the same seed, before the last retune
```

`dice.ts` is pure, seeded and dependency-free, so it runs in Node; the browser's
only contribution is `perspective: 900px` about the tray's centre.
`scripts/render-throw.ts` runs the real simulation, projects it the same way,
and writes contact sheets to `preview/` — one panel per sampled frame, time left
to right. Read the PNG.

This is worth the trouble because measurement has already been confidently
wrong here. A retune moved every number the right way — travel up three
quarters, wall contacts doubled — while the dice were using a fifth of the tray
and dying in the corner they started beside. One sheet made it obvious.

Where a visual property turns out to be measurable, **pin it in a test** rather
than relying on someone re-rendering. `dice.test.ts` → "a throw uses the tray it
is thrown into" is the worked example, thresholds and all.

## Traps

**A file written by a script may not reach the dev server.** Vite's watcher
sometimes misses writes made by a Node script: it keeps serving the previous
module, no HMR, and reloading does not help because the staleness is
server-side. Touch the file and confirm with `curl` before believing anything
the browser shows:

```bash
curl -s http://localhost:5173/src/client/styles.css | grep -c 'the-thing-you-just-added'
```

Touching anything under `src/shared/` or `src/server/` restarts `tsx watch`,
which drops every in-memory room — test rooms have to be recreated.

**Two version constants, and they mean different things.** `SNAPSHOT_VERSION`
in `src/shared/room.ts` covers the *shape and meaning* of persisted state;
`PROTOCOL_VERSION` covers wire messages. Meaning counts as shape: a stored
`Toss` is the throw the boards re-run, not a record of the faces, so changing
the simulation or a die's size makes an old one land somewhere new and needs the
bump. Adding an optional field to `RoomView` does not.

**Check `git status` before committing.** This tree often has more than one
author working in it at once.

## House style

Comments here say *why*, not what, and several of them are the only record of a
bug that has already been shipped once. Match that register — a change that
removes the reasoning and leaves the code is a net loss.

New game? `src/shared/games/*.ts` is a pure reducer with no I/O and no
randomness it did not receive; the manifest, the display module and the reducer
are separate on purpose, and `bundle.test.ts` enforces the part that matters.
Four places, and the compiler names three of them if you miss one: the reducer,
a line in `manifest.ts`, an entry in `GAMES`, and an entry in `boards.ts` —
which also wants the game's state and move types, so a board paired with the
wrong game's state does not compile.

Two predicates, and they are not interchangeable. `turn` is a hint for the
status line; `canAct(state, seat)` is whether that seat may move, it is what
every control on every board is gated on, and the server sends its answer as
`RoomView.canAct`. A strictly alternating game implements it as
`turn(state) === seat` and that is the whole of it — but write it, because four
of the ten games are not alternating and the contract has to be honest about
which kind this one is.
