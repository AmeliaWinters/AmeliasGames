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
already banked. Rounds rotate who opens, so taking one does not compound into
the first spin of the next.

Three things about a turn are worth stating, because they are what the game
turns on:

- **You get three guesses to a turn.** A consonant that is not there, a vowel
  that is not there and a wrong stab at the phrase all cost one; the turn moves
  on at the third. Under one-and-out, calling a letter you were not sure of
  cost you the turn, so the game quietly rewarded not guessing — a strange
  thing for a guessing game to do. Bankrupt and Lose a Turn still end a turn
  outright: those are the wheel's doing, not a guess.
- **Everyone banks what they won**, not only whoever solved it. That money was
  won letter by letter and it is theirs. Losing it because somebody else spotted
  the phrase first made every round a write-off from second place. Bankrupt is
  now the only thing that takes a round's money away, which is what keeps it
  frightening.
- **Solving pays $2,000**, on top of whatever the round already won. With
  everyone keeping their money, spotting the phrase has to be the thing that
  decides a game — otherwise the winner is whoever happened to spin the biggest
  numbers.

The wheel is a wheel: twenty-four wedges the board draws and spins, coming to
rest on the one the server picked. The server is the only thing here holding an
rng, so it sends back the index it landed on and the board animates *to* it —
watching the wheel and then being told a different number is the one thing that
would make the whole game feel rigged. Two spins running can land on the same
wedge, which is why `spins` counts upwards: without it the wheel would sit
still on the second one and read as broken.

It is the game that proves out `view()`. The phrase lives in `state.answer` on
the server and is masked on the way out to every client, letter by letter, as
letters are called — because the client is *sent* the state, so an answer that
reaches it is an answer anyone can read out of devtools. Masking preserves
length and punctuation, since knowing the shape of the phrase is the game.

The two hundred-odd puzzles are the other half of the same problem: masking the
current answer achieves nothing if the browser is holding the list it came
from, since the shape would pick it out. They stay out of the bundle because
nothing in the client's import graph reaches the reducer — the board takes
only types and display helpers, and the lobby reads `manifest.js` rather than
the registry. That is load-bearing rather than incidental, and worth a
`grep` of `dist/` after any change to those imports.

**Word Duel** — two players, head-to-head Wordle. Each sets a five-letter word
for the other, then both hunt the word they were given. Six guesses; fewer
guesses wins, the same count is a draw, and solving does not end the game —
your opponent still plays out the guesses they have left. Its word list is
`DUEL_WORDS`: the five-letter half of the shared dictionary, about sixteen
thousand words from dwyl/english-words plus a short hand-kept list of slang the
dictionary predates. Split out as its own set rather than filtered at the call
site, so a game played at one length cannot quietly start taking another. It is raw and
unfiltered, slurs included -- a deliberate choice. A hand-written list was
tried first and was not fit for purpose: it was missing `below`, `being` and
`alias`, and a word game that rejects real words is one people argue with.

It is the game that breaks the turn model. Play is *free-simultaneous*: nobody
waits, so `GameDefinition.turn` — which assumes one active seat — reports
whoever is furthest behind purely to give the status line something to say.
The reducer never consults it, and neither does the board. Whether a player may
act is `canAct(state, seat)`, and that distinction is the whole reason
`wordleDisplay.ts` exists.

Both players' guesses and marks are open, which costs nothing and is worth
saying why: you are each guessing the *other's* word, so their attempts on
yours tell you only what you could already mark yourself. `view()` hides
exactly one thing — the word your opponent set for you — and stops hiding it
once you have solved it or the game is over. The word list is server-only for
size rather than secrecy: it is the largest thing in the repo, moves are
validated on the server, and one convenience import in the board would put a
dictionary on every phone that opens the lobby. `bundle.test.ts` holds that
line.

**Yahtzee** — two to four players, thirteen rounds, highest total wins. Roll
five dice, keep what you like, roll the rest up to twice more, then write the
hand into one of your thirteen boxes. Every box takes one hand and no more,
which is the game: a hand that fits nowhere useful still has to go somewhere.

The full rules, including the two most implementations quietly drop:

- **the Yahtzee bonus** — a second Yahtzee is worth 100 on top of whatever box
  it fills, but only to a player whose Yahtzee box actually scored 50;
- **the joker rules** — which constrain the *choice*, not only the score. A
  Yahtzee rolled once that box is filled goes in its own upper box if that is
  open, otherwise in any open lower box (where full house and the straights
  pay face value, since five of a kind cannot form them), and only with the
  lower section full may it cross off an upper box.

The two are deliberately separate: crossing Yahtzee off for zero still puts
you under the joker rules, it just earns you nothing for being there.

`legalCategories` is therefore part of the rules rather than a convenience.
The board greys out the boxes it excludes and `applyMove` refuses them, from
the same function, so a hand-rolled client gains nothing by ignoring the grey.
The scoring table lives in `yahtzeeDisplay.ts` because the board needs it: a
player picking a box is shown what the hand is worth in each one, and thirteen
sums in your head on a phone is a worse game than the one on the box.

**Liar's Dice** — two to four players, five dice each, last player holding any
wins. Everyone rolls behind their hand; round the table you either raise the
bid — "four 3s" claims four 3s on the *whole table*, not in your hand — or call
it. The dice come up, the face is counted, and whoever was wrong loses a die.
Losing a die also hands you the next round, which is the merciful rule: the
initiative goes to whoever is furthest behind.

There are two calls, and the difference between them is the difference between
the two ways a bid can be wrong:

- **liar** says the bid is too high, and is settled by "at least" — a bid stands
  the moment the count *reaches* it, so "four 3s" against exactly four 3s costs
  the caller rather than splitting a tie;
- **spot on** says the count is the bid to the die. Right, and you take a die
  *back* — never past the five you started with — and nobody pays anything,
  which makes it the one move in the game that costs no one. Wrong, and you lose
  one like anybody else.

Spot on is why the last player to be dragged into a bid is worth watching rather
than worth pitying, and it is the only call that can be right while the bidder
is also right.

The round's bidding stays on the board as a run rather than as whatever was said
last, because that is most of what a call is reasoned from — who climbed eagerly
and who was dragged — and it survives the call, so the reveal can be read
against the bidding that led to it.

Ones are not wild. The Perudo variant everyone half-remembers from a film
counts them for every face, which turns the arithmetic into a game of its own;
this one counts what it says on the die, so a first-time player can be told the
whole of the rules in a sentence and still be counting correctly on their
first call.

It is the second game to lean on `view()`, and it leans harder than the Wheel:
there is not one secret but one per seat. Every hand but your own is replaced
with `HIDDEN_FACE` dice — not a face, so a hand that reaches the wrong client
cannot be counted even by accident, and a counting bug shows up as a zero
rather than as a plausible wrong answer. The *lengths* survive the redaction,
because how many dice each player is holding is public and is most of what any
bid is reasoned from.

Hands go public exactly once, in the `Showdown` a call produces. It is a
snapshot rather than a flag, which is what lets the board keep showing the
table as it stood — every hand face up, the dice that counted marked — while
the next round is already dealt behind it.

**Battleships** — two players, five ships each, ten by ten. Set out your fleet,
then take one shot each until one fleet is gone. Touching is allowed and
overlapping is not, exactly as in the boxed game.

The two halves behave quite differently, and everything about this game follows
from that. **Placing is free-simultaneous**: both admirals set out at once and
neither waits on the other. **Firing strictly alternates**, one shot each, hit
or miss — the "another go after a hit" variant is a real way to play and
deliberately not this one, because a lucky opening run can end the game before
the other player has fired a shot. `room.turn` is therefore wrong about placing
and right about firing, so nothing asks it: `canAct` is the single predicate
that covers both, and the board takes no `myTurn` at all.

`view()` keeps the one secret. Every shot either player has fired is already
drawn on both boards, so all that is redacted is where the enemy ships *are* —
and a ship that has gone down is revealed outright, since the hits that sank
her already spelled out her position. Ships keep their damage but lose their
coordinates, which is what lets the board tell "ready" from "still setting out"
without being told anything it should not know.

**Word Hunt** — two to four players, one 4x4 grid, everybody hunting it at
once, **two minutes on the clock**. Trace a word through touching letters —
diagonals included, never the same cell twice — and it is yours. Biggest score
wins, and the same grid is there for everybody, so nobody is racing anyone to
a particular word.

The clock is the server's, and it starts when the last player sits down rather
than when the room is opened — a round started at setup would tick away while
the second player was still opening the link, and could be over before they
arrived. The board holds the grid shut until then and shows a full 2:00.

Three things enforce it, and only the first two decide anything:

- The reducer refuses a word that arrives after the whistle, so a client with a
  slow connection or a doctored clock cannot sneak one in.
- `RoomEngine.tick()` settles the round when the deadline passes, and both
  adapters arm a timer on `deadline()` — a `setTimeout` in the dev server, a
  Durable Object alarm in the worker. That is what makes the round end on time
  with nobody watching, which a reducer alone cannot do: a game nobody is
  playing gets no moves to notice the time in.
- The board counts down, and does not decide anything at all. Every state
  message carries the server's clock, so the countdown measures the gap between
  the two rather than trusting the device's own — a phone that is minutes out
  would otherwise show a timer that disagrees with the game it is counting.

Words run from three letters to eight, and length is the whole of the scoring:
100, 400, 800, 1400, 1800, 2200. It climbs faster than length does on purpose,
and those are the numbers the version everyone has already played on a phone
uses — a player who knows them should not have to learn new ones. Two threes
losing to one five is the game working.

The dictionary is the one Word Duel validates against, cut to the same range:
every three- to eight-letter entry in dwyl/english-words, slang, dialect and
profanity included. Word Duel takes `DUEL_WORDS`, the five-letter subset and
nothing else, so a game played at one length cannot start accepting another by
accident. `words.test.ts` also holds the list's two ends against Word Hunt's,
because the board draws paths to those limits and a dictionary that disagreed
would mean traces a player can draw and the server will never take.

The grid is dealt rather than drawn. Five real words are planted along real
paths first and the gaps filled from a vowel-heavy bag afterwards, and the
whole grid is thrown away and redealt until it holds fifteen words of six
letters or more. The measure is long words rather than any words, deliberately:
three-letter words are dense enough on any sixteen letters that counting them
measures nothing, and a grid with three hundred of them and nothing longer
plays like a typing exercise.

Like Word Duel it is free-simultaneous — `canAct`, never `turn` — and
`wordHuntDisplay.ts` exists for the same reason `wordleDisplay.ts` does: the
board has to know whether the letters under a dragging finger form a legal
path, and routing that through the reducer would put the whole dictionary on
every phone that opens the lobby. `bundle.test.ts` holds that line, and it
matters more here than it did: the list is a megabyte.

`view()` hides one thing: the words other people have already found, since a
list of their words is a list of yours for the copying. They are masked rather
than dropped, and the mask is as long as the word it stands for — length is
what a word is worth, so the *score* survives redaction while the word does
not. Watching an opponent's total climb while you are stuck is most of the
tension. The answer key at the end is not redacted but uncomputed: `solve()`
runs when the last player stops, so there is never a complete list of the
grid's words sitting in the state for a `view()` bug to leak.

Tracing works by drag or by tap and they are the same gesture underneath —
cells are appended to a path, and lifting a finger submits, as does the button
the tapping player presses, which is the one a keyboard reaches. There is no
length at which a trace can submit itself, so something has to say "that is the
word". A trace too short to be a word is dropped in silence rather than
refused: it is nearly always a tap on the way to somewhere else, and an error
for that is the app telling the player off for touching it.

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

**"Wait for the other player" is not the same rule for every game.** The room
turns every move away until each seat it laid out is taken, which is right for
every game where a move is a turn — and wrong for Battleships, where setting
out your fleet is private, simultaneous, and precisely what there is to do
while the invite goes unanswered. The effect was that every single tap during
placing came back as a red error banner, so the game read as completely broken:
you could not put a ship down until your opponent happened to arrive.

The fix is a game-level opt-out, `allowsEarlyMove`, rather than a special case
in the room: the room still owns the rule, and Battleships names the three
moves it does not apply to. Firing is not among them, and could not be anyway —
`fire` refuses during `placing`, and the phase cannot leave `placing` until
both fleets are down.

The same question has a different answer one game over. Word Hunt is
free-simultaneous too, but its round is a race, so it wants no early moves at
all — and its clock starts when the room fills for exactly the same reason.
The generalisation to resist is "simultaneous games should accept early moves";
the real one is that only the game knows.

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

All eight games are complete and tested end to end on both transports. Chess is
the intended next game, as a pure-rules exercise; Wheel of Fortune has since
taken Hearts' job of proving out `view()`, and Battleships is the second game
to lean on it.

Live at https://amelias-games.anonylunt.workers.dev and shipping as a
sideloadable Android APK, with 224 tests — including forty full random games
of backgammon played to completion with checker-conservation checked on every
move, and a hundred and twenty random Wheel of Fortune matches across tables
of two, three and four.

Not done yet: no PWA manifest, so the browser version won't install to the home
screen with its own icon (the APK covers that need for now). The app also uses
Capacitor's default launcher icon.
