# Accounts

Everything in this repo is currently ephemeral. A room is swept thirty minutes
after the last person leaves, and the only thing that outlives a game is a
`playerId` in `localStorage` that nothing has ever read back except to reclaim
a seat. That is the right design for Connect Four. It is the wrong design for
the two games this document is mostly about.

Word Chain and Vocab Race already produce, per turn, exactly the record a
spaced-repetition system is built out of: the word, its lemma, its language, its
frequency rank, its English gloss, its script, how long the player took, whether
they were asked to produce it or recognise it, whether they bought a hint, and,
best of all, whether they got there or were shown the answer. Then the room
hibernates and every bit of it is deleted.

**That is the thesis. The account system is not a feature bolted onto thirteen
games; it is a place to put what two of them are already computing and throwing
away.** Stats, XP, levels and streaks are scaffolding around that, and every
decision below is settled by asking which choice makes the vocabulary more
useful.

---

## What is already true

Five facts about this codebase decide most of the design, so they go first.

1. **Identity is a random UUID in `localStorage`** (`getPlayerId` in `net.ts`),
   never broadcast to anyone: `PlayerView` carries seat, name and connected,
   and no id. So it is already a bearer secret shared only with the server. It
   is not, however, portable, recoverable, or proof of anything.

2. **The server is the authority and the client is never trusted.** Moves are
   re-decided by the reducer server-side; Wheel of Fortune's puzzle bank and
   Vocab Race's deck are redacted by `view()`; `bundle.test.ts` builds the real
   client and greps the real output to prove no word list ever reaches a
   browser. A stats system that lets a client report its own results throws all
   of that away in one commit.

3. **Pure logic lives in `src/shared/`, I/O lives in the adapters.** `RoomEngine`
   and `session.ts` are shared verbatim by the Node dev server and the Durable
   Object; the split falls where the `await` does. Accounts must fall the same
   way or they will exist twice and drift, which is the exact failure
   `session.ts` was written to end.

4. **The client has no dictionary and may never have one.** `chainWords.ts` is
   82,000 lines and server-only. A profile screen listing your vocabulary
   therefore cannot look anything up: whatever it shows must have been written
   down at the moment it was learned. Same bargain `ChainLink.gloss` and
   `VocabRound.clue` already make.

5. **Rooms are disposable and profiles are not.** A `SNAPSHOT_VERSION` mismatch
   means *throw the room away*, and that is fine, being one game of Yahtzee.
   The same rule applied to a profile deletes a year of somebody's Polish. This
   asymmetry is the most important thing on this page and it gets its own
   section below.

## The promise on the tin

`index.html` currently ships this to every share card and search result:

> No adverts, no accounts, no app store.

That is not an obstacle, it is a specification. **Accounts must be optional, and
a room in which nobody has one must behave exactly as it does today.** A guest
sits down at a table with an account holder and only the account holder's ledger
moves. The line becomes "no account required", which is still true and still the
reason to use this rather than the alternatives.

It also settles a UX question before it is asked: no sign-up wall, no account
screen between the lobby and the game, and the room code stays the only thing
anybody has to send anybody.

---

## 1. What an account is

**A keypair and a name.** No email, no password, no recovery questions, no
third-party sign-in.

The reasoning is that the threat model here is nearly empty and the failure mode
is not. What does a thief get? Fake experience points in a game their victim
plays with four friends. What does the *owner* lose by being locked out? Every
word they have learned. So this is a system where **durability matters more than
secrecy**, which is the opposite of the usual bias, and the design should follow
the actual risk rather than the reflex.

- The client generates an Ed25519 keypair with WebCrypto on first use. The
  account id is a short hash of the public key, rendered in the same shape as a
  room code so it can be read aloud.
- `hello` carries the public key and a signature over a server nonce, so an id
  cannot be claimed by anyone who has merely seen it. (Phase 3; phase 1 ships
  on the existing bearer id and changes nothing about the storage shape.)
- **Recovery is a phrase, shown once and exportable at any time.** It is the
  private key. Losing it loses the account, and the profile screen should say so
  in those words rather than in the language of security.
- **A second device takes the recovery key**, and that is the whole of it.
  Paste it and that browser *is* the account.

  A pairing code was the plan here and it was cut on contact. Done properly it
  needs an account to hold *several* public keys, plus a third object keyed by
  the code to broker them, because the alternative (the server relaying a
  private key) is the one thing this design exists not to do. Importing the key
  covers the same need with no new surface, and the honest cost is that the key
  passes through wherever the player pastes it, so the screen has to say "put
  this somewhere private", not "message it to yourself". Multi-key accounts are
  the thing to build if pairing is wanted later; nothing here forecloses it.

  **The key is also drawn as a QR**, which is the same import path with a
  shorter road to it and no change to any of the above. It exists because the
  direction people actually go is desktop to phone, and the two ways of moving
  text that way are a clipboard and an inbox -- so the advice above was being
  ignored by the shape of the thing rather than by anybody's carelessness. A
  screen a foot from a camera carries the key through *less* than a paste
  does: no clipboard, no inbox, no chat app keeping a copy of the account.

  Two costs, both paid on the screen. The code is the account, so the panel
  says in those words that anybody who photographs it has your words. And
  reading one needs `BarcodeDetector` and a camera, which iOS Safari, older
  desktop browsers and any plain-http LAN address do not have -- so the paste
  box stays, `canScan()` decides whether the button appears at all, and
  offering nothing is a legitimate outcome rather than a bug.

  The encoder is the one bought dependency in the client. A QR is
  Reed-Solomon, eight masks and a placement order, and getting any of it subtly
  wrong yields a code that round-trips against your own reader and is refused
  by every phone in the house -- which is exactly what the Browser pane cannot
  show us. `qr.test.ts` pins the properties the screen depends on, including
  the module count the CSS is drawn for, instead of re-deriving the spec.

**Rejected: username and password.** Password storage on Workers means PBKDF2
(no argon2, no scrypt), reset means email, and email means an address, a sending
service, and a category of personal data this app does not currently hold at
all. It buys nothing a recovery phrase does not.

**Rejected: sign in with a provider.** The cheapest to build, and the only
option that puts a third party between two friends and a game of Connect Four.

## 2. Where it lives

**One Durable Object per account**, `PLAYERS.idFromName(accountId)`,
SQLite-backed, under a new `[[migrations]]` tag (a new class in the existing
`v1` tag is not a thing). Same shape as `GameRoom` and for the same reasons: one
authoritative instance worldwide, no locking, no database, and it costs nothing
while nobody is playing.

The dev server gets the other half of the pattern it already uses for rooms: an
in-process `Map`, optionally flushed to JSON under `.cache/` so a local profile
survives `tsx watch` restarting, which it does constantly, since touching
anything under `src/shared/` drops every room in the process.

**Leaderboards are rooms too.** A per-account object cannot answer "who is
ahead", so the temptation is D1 and a `SELECT`. Resist it: a league is a Durable
Object with a four-letter code you share with the people you actually play with,
and each member's profile pushes a summary into it at the end of a game. That
keeps the no-database property and the free tier, but the real argument is
social. A leaderboard scoped to five friends is the only leaderboard anyone in
this app wants. A global one would be gamed inside a week and would mean
something to nobody.

## 3. Who is allowed to write it

**The room writes the profile. The client never does.** At the end of a game the
room object holds the authoritative final state, and calls the player objects
directly through their stubs. A client that could post its own results could
post any results, and the interesting cheat is not "I won" but "I knew that
word", which corrupts the one thing this system exists to be accurate about.

This means `GameRoom` must take `env` in its constructor, where it currently
takes only `state`, and `worker.test.ts`'s hand-built state double needs an env
double beside it.

### Writing it exactly once

The part that will silently double somebody's XP if done casually. `tick()` runs
on every message, `broadcast()` runs on every state change, and a hibernating
object can be restored in the middle of anything.

- **Gate on a reservation, not on catching the moment.** The plan here was to
  capture `engine.isOver()` before the action and fire on `false -> true`. That
  works, and it gives exactly one attempt, so a room whose player object was
  briefly unreachable loses the game silently. What shipped instead is a
  `pending` key written at the deal and cleared only once every account has
  taken its results: safe to call as often as anything likes, and it **retries
  itself** on the next message or alarm.

  One consequence is worth writing down, because a test caught it and nothing
  else would have: the retry has to run on *any* message, not only an accepted
  action. The commonest message after a game ends is a **refused** move, from
  somebody tapping the board one more time, and that returns long before the
  dispatch.
- **Make the receiver idempotent.** Each harvest carries a key, `ABCD#3`: the
  room code and a count of games dealt in it. The player object records the keys
  it has applied and ignores a repeat. A rematch reuses the room code, which is
  exactly why the counter is there.
- **Write the profile first and the counter second.** A crash between them
  re-harvests under the same key and the receiver drops it. At-least-once
  delivery into an idempotent receiver, which is the only exactly-once anybody
  ever actually builds.
- **Keep the counter out of the snapshot.** `emptySince` is already stored under
  its own key rather than inside `RoomSnapshot`, and this is the same kind of
  thing: adapter bookkeeping, not game state. It also avoids a
  `SNAPSHOT_VERSION` bump, which would delete every live room on deploy for the
  sake of a number the reducers never see.

### How a game says what happened

An optional method on `GameDefinition`, beside `view?`, `start?`, `deadline?`
and `expire?`:

```ts
/**
 * What this game's finished state says about the people who played it.
 * Pure, like everything else on this contract. Omitted by games with nothing
 * to say beyond who won, which the room can see for itself.
 */
record?(state: S, seats: number): GameRecord;
```

Optional, so eleven games implement nothing and the two that matter implement
everything. On the contract rather than in a `switch` over game ids inside a
harvest module, because a `switch` is a fourteenth registration point that
nothing holds to account, and the compiler already catches the other eight.

`GameRecord` is per-seat and comes in two halves: what was **played** and what
was **learned** (section 4). Word Chain hands over its chain and its misses;
Vocab Race hands over its rounds.

A game that implements nothing still produces a record: every seat, played,
**result null**. That turned out to be load-bearing rather than tidy, and it was
found by writing the test. Eleven of the thirteen games implement no `record`,
so without it a profile would be completely dead for somebody who mostly plays
Backgammon, which is the exact failure the small per-game payment was put there
to prevent. The result is null rather than a guess because the room genuinely
cannot tell: the contract has `isOver` and a `status` string and nothing
anywhere that names a winner. Calling them all draws was the first version, and
it is a lie that compounds into a profile claiming two hundred drawn games of
Connect Four.

## 4. The ledger

The primary purpose. Everything above is plumbing for this.

### The entry

One row per word you have met, per language:

```ts
interface Known {
  lang: 'en' | 'pl' | 'ja';
  /** Folded lemma. The identity, see "one word, one row". */
  key: string;
  /** Denormalised at write time, because the client has no dictionary. */
  word: string; script: string; lemma: string; gloss: string; rank: number;
  /** In front of you, produced by you, and not. */
  seen: number; got: number; missed: number;
  /** Server clock, both. `dueAt` is what the whole thing is for. */
  lastAt: number; dueAt: number;
  /** Where it sits on the ladder, and the fastest you have ever produced it. */
  box: number; fastestMs: number;
}
```

**One word, one row, and the row is the lemma.** Polish files `jestem` and
`być` separately and the game plays them separately, which is right for the game
and wrong for the ledger: a learner who has played six inflections of one verb
has learned one verb, and a profile claiming six is lying to the person using it
to decide what to study. `ChainLink.lemma` and `VocabAnswer.lemma` exist
precisely for this and `fold()` gives the comparable form, so key on
`fold(lemma || word)` and keep the inflection actually played as a sighting on
the row.

**Denormalise the gloss, the script, the lemma and the rank.** About eighty
bytes a row, and the only reason the profile screen can render at all, since the
build fails if the client ever imports the list they came from. Same bargain as
putting `gloss` on `ChainLink`, and worth restating in the comment, because it
looks like redundant storage to anyone who has not hit the boundary.

### What counts as evidence

Both games test the hard direction, **production and not recognition**, and Vocab
Race has recently started grading its own questions by exactly that axis. The
ledger should read the same signals, for a different purpose: `roundPoints`
measures the contest, and the grade below measures the memory.

| Event | Where from | Grade |
|---|---|---|
| Said a word under the clock | `ChainLink` with your `seat` | strong |
| ...fast against your own allowance | `link.ms` vs `turnMsFor(said)` | strongest |
| Typed the word from a meaning | `VocabTry.how === 'right'`, `ask === 'say'` | strong |
| ...after buying a hint | `try.hinted` | real, but one notch down |
| Picked the meaning from four | `ask === 'pick'` | recognition only |
| Answered wrong | `how === 'wrong'` | back to the first box |
| Gave up | `how === 'gave-up'` | back to the second, and not the same thing |
| Ran out of window | `how === 'timeout'` | **not evidence at all** |
| Shown the word you could not find | `ChainMiss.reveal` | **introduce it** |
| Read the opponent's word | `ChainLink` with their `seat` | a sighting only |

Five of those rows are load-bearing and easy to get wrong:

- **A `pick` round must not advance a production item as far as a `say` round.**
  `PICK_SCALE` already halves its points and says why: choosing "to sleep" from
  four options is a one-in-four guess at worst and a flicker of recall at best.
  A ledger that treated the two alike would let the easy third of the game carry
  a word all the way up the ladder, and the word would then not come back until
  it had been forgotten. Recognition is enough to *hold* a box, not to climb
  one.

- **A hint is not a reveal, and the difference is the whole point.**
  `HINT_ALLOWANCE`'s comment makes the claim outright: first letter plus length
  resolves a word already on the tip of the tongue, so a hinted round is one
  where the player did the retrieval themselves and arrived. That is the thing
  that makes a word stick. So a hinted right answer advances the item, one notch
  behind an unhinted one, never down with a miss.

- **`timeout` must not be punished.** That is the seat that sat there: a phone
  that locked, someone who put the game down. Grading it as failure would let
  one distracted evening bury a hundred words you actually know. `VocabHow`
  keeps it distinct from `gave-up` for exactly this reason, and the ledger
  should honour a distinction the reducer went to the trouble of making.

- **The reveal is the best data in the app.** Word Chain's own comments say the
  reveal is the point of the game: a minute of failing to think of a word is
  when you are most likely to remember it. A revealed word is therefore
  *introduced* at the bottom of the ladder and scheduled for tomorrow, and that
  one behaviour is most of what turns Word Chain from a game into a course.

- **Reading is not knowing.** A word the opponent said in a language you are
  learning is a sighting: it bumps `seen`, never `got`, and never advances the
  box. Counting it would inflate every number on the profile, which matters
  because the profile's only job is to be worth trusting.

### Scheduling

A short Leitner ladder in `src/shared/review.ts`, pure, with `now` injected like
everything else here that touches a clock. Intervals of roughly 1, 3, 7, 16, 35
and 90 days; a right answer moves up one, a wrong answer returns to the first
box, a `gave-up` to the second. Nothing cleverer: the input is a handful of
words a session, and an ease-factor model tuned on twenty thousand daily reviews
has nothing to work with at this volume.

Store `dueAt` rather than an interval, for the same reason `LetterCooldown`
stores `until` rather than a countdown: nothing has to remember to decrement
it, and a profile restored from storage cannot come back with a tick already
spent.

## 5. XP, and what it must not reward

The request asks for experience points, and the trap is that XP is a statement
about what the app values, made in the loudest voice available.

**XP comes from words, not from winning.** If it came from winning, the fluent
parent playing Vocab Race farms it and the learner, the entire person this app
is for, is punished once more for being a beginner. That argument has already
been had inside the reducer and settled: `LEVEL_SCALE` halves a fluent speaker's
points and `LEVEL_WINDOW_MS` shortens their window, precisely so a slow right
answer from somebody three weeks in outscores a fast one from a native speaker.
**An XP curve that paid for wins would reverse that decision from outside the
reducer**, which is worse than never having made it, because the comments would
still claim otherwise.

- **A word pays, and a word recalled after five weeks pays most.** The first
  draft of this said a *new* word pays most, and building it showed that to be
  the wrong way round: paying most for new words rewards churning through
  vocabulary and never coming back, which is exactly how a language app makes
  its numbers go up while teaching nobody anything. So the payment rises with
  the rung reached, and the efficient way to earn is the thing that works.
- **A game pays a little.** Every finished game of anything pays a small flat
  amount, win or lose, with a small bonus for the win. That is what stops the
  profile feeling dead for somebody who mostly plays Backgammon, and it is
  deliberately too small to compete with a study session.
- **The ladder caps the farming.** An item already reviewed today is not due
  today, so it pays nothing today. No separate daily cap is needed and no
  anti-cheat is needed either: two tabs and `?as=b` can already drive both seats
  of anything, and the answer is not to detect it but to make it pointless. The
  only person you can cheat is the person whose vocabulary you are measuring.
  **The one place cheating hurts somebody else is a leaderboard, which is why
  leagues are opt-in and friend-scoped** (section 2).

**Levels** are a curve over total XP and want names rather than numbers, since a
number is a leaderboard with one entrant. The profile should lead with *words
known* and *words due*, the two figures that mean something, and carry the
level as the smaller number beside them.

**Streaks** work, are the most effective retention mechanic anybody has found,
and are also where these systems turn hostile. Count a day done at one completed
review, and **build the rest day in from the start**: one missed day a week
absorbed silently, no repair purchase, no notification implying failure. A
streak that punishes a bad week is a streak people quit over, and the person
quitting takes their Polish with them.

## 6. Closing the loop

A ledger that only records is a diary. The version worth building **chooses what
the game asks you next.**

### Vocab Race deals a deck it knows something about

`setup` shuffles ranks 1..1000 and every later draw filters that fixed order,
deliberately, so rounds advancing through `expire` need no randomness. The deck
is already redacted by `view()`, so anything put into it stays secret.

**What shipped is not `prime`.** `setup` was widened instead, to
`setup(playerCount, rng, now, study)`, and the room fills the fourth argument
from the profile store before it deals. That is simpler than a second hook and
it puts the study list where a game already builds its state. The argument the
optional method below was making still holds and is what the widening
preserves: the room does the fetching, and the reducer is handed the answer.

```ts
/**
 * Bias a freshly dealt game towards what these players need. Optional, pure,
 * and called by the room straight after `setup` when profiles are available.
 * A game without one is dealt exactly as it is today.
 */
prime?(state: S, tables: readonly DuePack[], rng: Rng): S | null;
```

`setup` keeps its signature and its purity, the other twelve games are
untouched, and a room where nobody has an account calls nothing.

**The fairness constraint is absolute and it shapes the whole feature: the clue
must be identical for every seat, because this is a race.** So the deck is
weighted by the *union* of what the table has due, never per seat. A room of a
learner and a native speaker draws the learner's due words, which is the right
answer anyway, since those are the words that room exists to practise.

### Word Chain is fed, and does feed back after all

This section used to say the opposite, and the reasoning is kept because it was
not wrong so much as outvoted. `commonestStarting` returns the commonest word
that would have worked, and bending it toward a review queue makes it
*sometimes* the commonest, with no way for the player to know which.

It reads from the ledger anyway now: `revealFor` prefers a word the player
already owes a review on, and falls back to the commonest when there is none.
What tipped it is that the reveal is the single most valuable event in the app
— a word you failed to produce, shown at the moment you are most likely to
remember it — and spending that on a word the player has never met, while one
they are actually studying was available, is spending it badly. The honesty
cost is real and is paid in the one place it can be: the word shown is always a
word that would have been legal, so the reveal never lies about the rules, only
about which of several legal answers it picked.

### Drill: practice without a second person

A learner needs to review on a Tuesday when nobody is online, and today every
game needs two people. The economical answer is not a new subsystem:
**`RoomEngine` already supports a one-seat game.** `canStart()` is
`short() === 0`, `canSeat` and `clampSeats` both handle `minPlayers: 1`, and
`start` requires seat 0, which a solo player is. So Drill is an ordinary
fourteenth game (a reducer, a manifest line, a `GAMES` entry, a board) that
draws its clues from your own due list through `prime`.

It inherits the room, the socket, the reconnection, the timed-game machinery,
the Android build and the whole test harness. It is a little odd that a solo
review session opens a Durable Object and mints a room code, and that oddity is
worth the exchange.

The "verify the lobby copy first" note was right and understated the bill.
Three things assumed two or more, and only one of them was copy:

- `manifest.test.ts` asserted `minPlayers >= 2` outright. Relaxed to one, with
  the reasoning written where the assertion is.
- `seatLabel` produced **"1 players"** for the accessible name of a card whose
  visible figure is only a numeral. Now "on your own".
- **The card hue ring was solved for exactly thirteen**, evenly spaced at
  360/13. A fourteenth cannot join that without re-solving all fourteen, which
  moves every card on the shelf. Drill halves the vocab-to-wordle gap instead
  and pays for the closeness on saturation, 0.34 against its neighbours' 0.62
  and 0.56, which is also the right colour for the quiet solo one. **The ring
  is no longer even, and a fifteenth game should re-space it rather than
  halving another gap.**

### The hook that brings someone back

**"18 words due" on the lobby.** One number, on the screen they already open.
That is the whole retention mechanic, and it is worth more than the XP, the
levels and the streak combined, because it is the only one of them that is about
the words.

---

## The shape of the code

| File | What lands there |
|---|---|
| `src/shared/profile.ts` | `Profile`, `Known`, `PROFILE_VERSION`, `migrate()`. **Imports nothing**, and the client renders from it. |
| `src/shared/review.ts` | The ladder. Pure, `now` injected. |
| `src/shared/account.ts` | Id derivation, key encoding, and `verifyClaim`. Shared so both adapters agree; async, which is why it is not in `session.ts`. |
| `src/shared/harvest.ts` | `GameRecord` -> profile delta. Pure, type-only imports of game states, so it stays a leaf. |
| `src/shared/types.ts` | `record?` and `prime?` on `GameDefinition`. |
| `src/shared/session.ts` | Reading an account off `hello`, the way it already reads a name. Both adapters inherit it. |
| `src/shared/protocol.ts` | `PROTOCOL_VERSION` 7 -> 8; account fields on `hello`; a profile request and reply. |
| `src/worker/player.ts` | The `Player` Durable Object, plus a new `[[migrations]]` tag in `wrangler.toml`. |
| `src/worker/index.ts` | `GameRoom` takes `env`; harvest on the over-transition; the `PLAYERS` binding. |
| `src/server/index.ts` | The same, against a `Map`. |
| `src/client/Profile.tsx` | The profile screen, and the account controls that are the only way to make one. |
| `src/client/profileCache.ts` | The last summary this browser was sent, so the lobby can draw one without a socket, and the two-summary subtraction behind the takings panel. |
| `src/client/styles/profile.css`, `styles/games/drill.css` | Imported by `styles/index.css`, appended rather than inserted, since the stylesheet is a directory and its order is its cascade. |
| `src/shared/games/drill*.ts`, `client/games/DrillBoard.tsx` | The fourteenth game. Reducer, display leaf, board, and entries in `manifest.ts`, `GAMES`, `boards.ts` (three), `palette.css`, `picker.css` and `App.tsx`'s motif. |
| `wordChain.ts`, `vocab.ts` | `record()`, and `prime()` for Vocab Race. |

**Do not send the whole ledger over the socket.** Five thousand words is about
600KB and it would go out on every hello. The profile *view* is counts, level,
streak, due total and the last twenty items; anything more is a second request
the profile screen makes when somebody actually opens it.

**Do not let `harvest.ts` reach a reducer.** It reads game states, and states
are plain data, so type-only imports keep it a leaf and type-only imports are
erased. If it ever gains a runtime import from `wordChain.ts` the word lists go
with it and `bundle.test.ts` fails the build. That is the guard working, but it
is cheaper to know now than to find out in a 120-second test.

## The third version constant

There are two today and they mean different things: `SNAPSHOT_VERSION` for
persisted shape and meaning, `PROTOCOL_VERSION` for the wire. This adds
`PROFILE_VERSION`, and **it is not like either of them.**

A version mismatch on a room snapshot means throw the room away:
`RoomEngine.restore` returns null and the adapter deletes it. Correct for a game
of Yahtzee, catastrophic for a profile: the same four lines, copied across,
silently delete a year of somebody's Polish on the deploy that adds a field.

**A profile is migrated forward, never discarded.**

- `migrate(profile)` is a ladder of one function per version, each doing one
  step, run on read.
- A test walks a fixture from every historical version to the current one, and a
  new version without a new fixture fails it.
- Version 2 is the first rung actually walked: `GameTally` grew `lost` and
  `last`, so the games panel could show a record and the last few results
  rather than two numbers. Neither is recoverable from a version 1 profile --
  losses were never counted and the individual games are not kept -- so the
  rung fills them empty and the counts carry on. Deriving `lost` from
  `played - won - drew` was the tempting shortcut and it is a lie about every
  game that names no winner.
- **Export ships before anything else does.** A JSON download from the profile
  screen, on day one, is the cheapest insurance available against every mistake
  in this document, including the one where Cloudflare's free tier changes its
  mind.

## Traps

**The `?as=b` two-tab trick becomes two accounts.** Correct, and it is how the
whole thing gets tested, but every key must carry the suffix the way
`ag.playerId`, `ag.name` and `ag.lastGame` already do, or one tab's study
session lands in the other tab's profile.

**A profile write must not wake a hibernating room.** Harvest on the
over-transition only; no periodic profile sync on the room's alarm. Idle rooms
costing nothing is most of why this app is free.

**Timed games end with nobody connected.** The alarm path settles a game whose
clock ran out in an empty room, and it must harvest too, or a Word Chain
abandoned near the end scores nothing for the player who won it.

**`now` is the server's clock.** `RoomView.now` exists because a device can be
minutes out. A `dueAt` computed against a phone's clock would let anybody review
tomorrow's words by changing the date and, far more likely, would quietly
corrupt the schedule of anyone whose clock is simply wrong.

**Two authors in this tree.** `git status` before committing; it is in CLAUDE.md
for a reason, and this branch of work touches files that move often.

## Phases

Each phase is shippable and leaves the tree green.

Phases 1 to 5 are built. What follows is the plan as it stands, amended where building it changed the design.

1. **The core, with no I/O.** `profile.ts`, `review.ts`, `harvest.ts`,
   `record()` on the two language games, and the tests. Nothing stored, nothing
   displayed, no behaviour changed. This is where the ledger design gets proven,
   and it is the only phase that has to be right.
2. **Storage and the write path.** `Player` DO, dev-server `Map`, the
   over-transition harvest, the idempotency key. No UI beyond something
   throwaway that dumps the profile as JSON.
3. **Identity.** Keypair, signed hello, recovery key, import on a second device, export.
4. **The screen.** Profile, per-game stats, the "what this game taught you"
   panel, the due prompt on the lobby.

   Two things moved. The due count is **not** in the lobby bar: three chips do
   not fit at 375px and the wordmark is what would have lost the characters, so
   it sits between the tagline and the shelf, where it is also allowed to be a
   sentence rather than a pill. And the takings panel is not per-game — it is
   the difference between two profile summaries, which needs no protocol
   message, cannot disagree with the profile it describes, and shows nothing at
   all to somebody who was away when the game was filed. See `earnedBetween`.
5. **The loop.** `prime()` on Vocab Race, then Drill as the fourteenth game.
6. **Leagues.** A shared code, a small leaderboard, opt-in.

One and two are plumbing; four and five are the product. If the work has to stop
somewhere, stopping after four leaves a working diary. Stopping after five
leaves something that teaches.

## Deliberately not here

- **Global leaderboards.** section 2 and section 5.
- **An SM-2 ease factor.** Not enough signal, and untunable at this volume.
- **Notifications and reminders.** The due badge is the reminder. A push
  notification needs the APK, a permission prompt, and a decision about how hard
  to chase somebody who has stopped playing, and the honest answer to that is
  "not at all".
- **Bending the Word Chain reveal.** section 6.
- **English as a learnable language.** `vocabDisplay.ts` sets out why the data
  does not exist for it, and nothing here changes that.
