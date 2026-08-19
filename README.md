# Amelia's Games

Multiplayer board games for phones. No ads, no accounts, no app store.

Open a room, send a friend the link, play. Runs in any mobile browser and
installs to the home screen.

## Running it

```
npm install
npm run dev
```

- App: http://localhost:5173
- Game server: ws://localhost:8787 (Vite proxies `/ws` to it, so the browser
  only ever talks to one origin — which is what makes LAN and tunnel testing
  painless)

`npm test` runs the rules and server tests. `npm run typecheck` checks types.

### Playing with friends before deploying

Vite listens on the LAN, so phones on your wifi can hit `http://<your-ip>:5173`
directly. A tunnel (`cloudflared tunnel --url http://localhost:5173`) reaches
friends elsewhere — but only while your computer is on. For anything permanent,
deploy (below).

### Testing both sides on one machine

Two tabs share `localStorage`, so they'd claim the same seat. Add `?as=b` to
the second tab to give it a separate identity:

```
http://localhost:5173/#ABCD          <- player 1
http://localhost:5173/?as=b#ABCD     <- player 2
```

## How it's put together

```
src/shared/    rules, room engine, wire format  (imported by EVERYTHING)
src/server/    Node dev server      — thin adapter over RoomEngine
src/worker/    Cloudflare Worker    — thin adapter over RoomEngine (production)
src/client/    React UI
```

There are two transports and one brain. `RoomEngine` in
`src/shared/room.ts` owns seating, turns, reconnection and rules; the Node
server and the Durable Object are both just sockets bolted to it. That's why
local dev can stay a fast `ws` server while production runs on Workers without
the two drifting apart.

**`src/shared/games/*.ts` is the important part.** Each game is a pure reducer
with no I/O, no framework, no randomness it didn't receive:

```ts
applyMove(state, move, seat) => { ok: true, state } | { ok: false, error }
```

That single constraint is what makes everything else easy:

- Rules are testable in milliseconds with no browser and no network.
- The **server runs the same reducer** and its answer is final, so a
  hand-rolled client can't cheat (see `src/server/server.test.ts`).
- The server never learns any game's rules, so it never changes.

The server holds room state in memory, keyed by a 4-character code, and
broadcasts after every accepted move. Players are identified by a persistent
`playerId`, so a dropped connection reclaims its seat and gets the current
state pushed back — a locked phone screen is a non-event.

## The games

**Connect Four** — two players, open information, no randomness.

**Backgammon** — the full rules: blocked points, hitting and the bar, bearing
off (exact rolls, and larger rolls only from the furthest point), gammons and
backgammons. Including the two rules casual implementations usually drop:

- you must play as many dice as you can, so a move that strands a die you
  could otherwise have used is rejected;
- if only one of two dice can be played, it has to be the higher one.

Both are enforced by searching the move tree for the longest playable sequence,
so the engine will refuse a move that *looks* legal in isolation.

Not implemented: the doubling cube.

Backgammon needs dice, which is why `GameDefinition` takes an `Rng`. It only
ever runs on the server — the client renders the state it is sent and never
applies moves locally, so nobody can re-roll until they like the answer.

**Wheel of Fortune** — two to four players, three rounds, most money wins.
Spin and name a consonant, buy a vowel for $250 out of what you have won this
round, or solve. Bankrupt takes the round's money but never what you have
already banked; solving pays at least $500. Rounds rotate who opens, so taking
one does not compound into the first spin of the next.

It is the game that proves out `view()`. The phrase lives in `state.answer` on
the server and is masked on the way out to every client, letter by letter, as
letters are called — because the client is *sent* the state, so an answer that
reaches it is an answer anyone can read out of devtools. Masking preserves
length and punctuation, since knowing the shape of the phrase is the game.

The forty-seven puzzles are the other half of the same problem: masking the
current answer achieves nothing if the browser is holding the list it came
from, since the shape would pick it out. They stay out of the bundle because
nothing in the client's import graph reaches the reducer — the board takes
only types and display helpers, and the lobby reads `manifest.js` rather than
the registry. That is load-bearing rather than incidental, and worth a
`grep` of `dist/` after any change to those imports.

## Adding a game

1. Add it to `src/shared/games/manifest.ts` — id, name, and how many can play.
   The manifest deliberately imports no reducer, which is what lets the lobby
   list the games without pulling every rule into the browser.
2. Write `src/shared/games/<name>.ts` implementing `GameDefinition`, reading
   its id, name and seat range back from the manifest. Take the `rng` argument
   if the game needs chance; ignore it otherwise.
3. Write its tests. Do this before touching any UI — it's the cheap place to
   get rules right.
4. Register it in `src/shared/games/index.ts`.
5. Add a case to `GameBoard` in `App.tsx` and a board component in
   `src/client/games/`.

The lobby, rooms, join links, reconnection, turn handling and rematch are all
game-agnostic and come for free.

**Player counts are per room, not per game.** A game declares a range
(`minPlayers`–`maxPlayers`); whoever opens the room picks a number inside it,
and that is fixed for the room's life. `setup(playerCount, rng)` is told which
it got, seats are sized to it, and a rematch replays at the same table. Games
with no range never show the picker. Write the reducer for the count it is
handed rather than for two — Wheel of Fortune's turn walks `% seats`, and its
`bank` is as long as there are players.

For hidden-information games (Hearts, poker), implement the optional
`view(state, seat)` to redact state per player. The server already calls it
before sending — that's why each player gets their own payload rather than a
shared broadcast. Wheel of Fortune is the worked example, and its tests
include the assertion worth copying: that the redaction is *applied by the
room*, not merely available to be.

## Design

Two palettes, one design. Only colour changes between them; type, layout and
motion are shared. The switch is in the header and remembers your choice.

| | Plum & Rose (default) | Paper & Ink |
|---|---|---|
| Ground | `#f9eef1` blush | `#f4efe6` warm stock |
| Ink | `#32172b` aubergine | `#1a1714` near-black |
| Counters | `#c42a62` raspberry / `#5e3a87` violet | `#c6432e` vermilion / `#1b6b72` teal |
| Body text contrast | 14.3:1 ink, 7.0:1 muted | 15.6:1 ink, 6.7:1 muted |

**Type** is a three-role pairing — Georgia (falling back to Noto Serif on
Android) for headings, the system sans for body, monospace for room codes.
All system stacks on purpose: the APK has to work with no network, so nothing
may be fetched at runtime.

**Layout** is one primitive repeated: a hairline-ruled panel at 3px radius.
The board is the only thing given real room.

**Motion** is three animations, each carrying information — a counter falling
so you can see where it landed, a ring closing on the winning line, and a
puzzle tile turning over as a letter is revealed. On the winning counter the
first two run in sequence. The third earns its place the same way: one called
letter can land in four places at once, and without it you are left comparing
the board to your memory of it. Everything decorative was deleted, and
`prefers-reduced-motion` disables all three.

**Seat colours** run to four, because Wheel of Fortune seats up to four. The
third and fourth are teal and burnt amber in Plum & Rose, violet and bronze in
Paper & Ink. Every chip sits beside a name, so at those table sizes colour
reinforces identity rather than carrying it alone — which is not true of the
Connect Four board, and is why the counters there also differ by ring.

This was built against `anti-slop-design-guide.md`. The previous build tripped
four of the sixteen patterns — indigo accent, dark-by-default, all-caps labels,
undifferentiated sans — plus missing metadata. It now trips none.

`public/og.png` and the Android launcher icons are generated, not hand-drawn:

```
node scripts/make-og.mjs      # link preview, from a real winning position
node scripts/make-icons.mjs   # launcher icons at every density, plus the favicon
```

Both use `scripts/png.mjs`, a small raster with a hand-rolled PNG encoder, so
the images come from the same palette as the app with no image dependency to
install. The launcher icon is a two-by-two of counters — the smallest fragment
of a board that still reads as one at 48px. minSdkVersion is 24, so it ships
both as an adaptive icon (API 26+) and as pre-baked legacy PNGs.

### Colour-blindness

Raspberry and violet sit closer in hue than the Paper & Ink pairing, so Plum &
Rose is the weaker of the two for red-green colour blindness. If that ever
matters, either switch palettes or cool the violet toward indigo; the counters
also differ in luminance, which carries most of the distinction.

## The Android app

The APK is a Capacitor shell: the UI ships inside the app, and only the game
socket goes over the network to the deployed worker. **It still needs the
worker deployed** — the APK replaces the browser, not the server.

```
npm run apk
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

It reads `VITE_SERVER_ORIGIN` from `.env.android`, which must point at your
deployed worker. The web build deliberately ignores that file (it's loaded only
by `--mode android`), so the site keeps talking to whatever origin served it.

Installing: copy the APK to the phone and open it, accepting the "install from
unknown sources" prompt. Both phones install the same file. It's debug-signed,
which is fine for sideloading between friends but is not a Play Store
artifact — and later builds install over the top as long as the debug keystore
doesn't change.

Requires Android Studio's SDK; the build uses its bundled JDK. If Gradle can't
find the SDK, check `android/local.properties`.

## Deploying

Production is Cloudflare Workers with **one Durable Object per room**, which
means the games are always on and your own machine can be switched off.

```
npx wrangler login     # once — opens your browser
npm run deploy
```

That builds the client and ships both it and the worker. You get a
`https://amelias-games.<your-subdomain>.workers.dev` URL; send that to friends.
Redeploying is the same one command.

Why this shape:

- `idFromName(code)` guarantees **one instance worldwide per room code**, so
  every player in a game hits the same authoritative object. No locking, no
  database, no race conditions.
- Sockets are accepted with `state.acceptWebSocket()`, which opts into
  **hibernation**: a room with nobody moving is evicted from memory and costs
  nothing, then wakes on the next message. Turn-based games are idle almost all
  the time, so this is most of why it's free.
- Room state is written to `state.storage`, so games survive eviction and
  redeploys — unlike the in-memory Node dev server.
- The worker serves the built client too, so the app and the socket share one
  origin and `/ws` needs no CORS or extra config.

The `[[migrations]]` block uses `new_sqlite_classes`, not `new_classes` —
SQLite-backed Durable Objects are the ones included on the free plan.

To exercise the real Workers runtime locally before deploying:

```
npm run preview:worker
```

### Free alternatives

If you'd rather not use Cloudflare, `src/server/index.ts` is an ordinary Node
process and will run on any always-on box — an Oracle Cloud Always Free VM, or
a Raspberry Pi at home. You'd want to add persistence; the Durable Object gets
it for free.

## Code review agents

Six specialist reviewers live in `.claude/agents/`. Invoke one from Claude Code
with the Agent tool, or just describe the change and let it delegate:

| Agent | Covers |
|---|---|
| `ui-reviewer` | Palette tokens, contrast, both palettes, layout, motion discipline, the anti-slop rules |
| `ux-reviewer` | Every UI state, turn-based affordances, touch targets, accessibility, copy |
| `infra-reviewer` | The shared/server/worker boundaries, Durable Object correctness, protocol, deploy |
| `dry-reviewer` | Duplication, adapter drift, dead code, abstractions that stopped paying |
| `security-reviewer` | The trust boundary, hostile clients, fairness of the dice, secrets |
| `game-rules-reviewer` | Reducer purity, rule correctness, determinism, property-test coverage |

Run the panel with `/review`, which lives in `.claude/commands/review.md`:

```
/review                    the working diff, routed to the agents it touches
/review all                the whole repository
/review main...HEAD        a specific range
/review security-reviewer  force one agent
```

It routes by which files changed, spawns the relevant agents in parallel, and
merges their findings into one report grouped by severity. Agents can also be
invoked directly by describing a change — the `description` on each is written
for that.

They are read-only by design: they report, they do not edit. Each one is
written around this project's real invariants and the bugs it has actually
shipped — the hibernation trap, the disabled-button dimming, sticky `:hover` on
touch — so they check for recurrences rather than reciting generic advice.

## Bugs worth remembering

**Disabling a button dims everything inside it.** Board columns are `<button>`
elements, so a blanket `button:disabled { opacity: .45 }` washed out every
counter on the board whenever it wasn't your turn — and completely, once the
game ended. Unplayable is a statement about interaction, not legibility. The
same trap applies to backgammon points, which are buttons too.

**`:hover` sticks on a touchscreen.** The column hover preview stayed latched
on after a tap, leaving a grey stripe down the board for the rest of the turn.
Hover styles now sit behind `@media (hover: hover)`.

Both were invisible in the accessibility tree and in every computed-style
check. They were only found by looking at a screenshot of the running app.

**Durable Objects hibernate, and that erases your instance fields.** The first
build kept the `RoomEngine` in a plain `this.engine` property and only loaded
it from storage on join. That works right up until the room goes idle: the
object is evicted, the sockets stay alive, and the next move arrives at a fresh
instance where `this.engine` is null — so a perfectly legitimate player gets
told "Join a room first."

Turn-based games are idle almost all the time, so this would have hit within
minutes of real play. It survived every local test because `wrangler dev`
didn't idle long enough to evict. It was caught by running the actual APK
against the actual deployment.

The rule: in a Durable Object, treat every in-memory field as empty at the top
of every handler. Load from storage, don't assume.

## Status

Connect Four, Backgammon and Wheel of Fortune are all complete and tested end
to end on both transports. Chess is the intended next game, as a pure-rules
exercise; Wheel of Fortune has since taken Hearts' job of proving out `view()`.

Live at https://amelias-games.anonylunt.workers.dev and shipping as a
sideloadable Android APK, with 224 tests — including forty full random games
of backgammon played to completion with checker-conservation checked on every
move, and a hundred and twenty random Wheel of Fortune matches across tables
of two, three and four.

Not done yet: no PWA manifest, so the browser version won't install to the home
screen with its own icon (the APK covers that need for now). The app also uses
Capacitor's default launcher icon.
