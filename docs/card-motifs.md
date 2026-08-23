# Card motifs

The picture on a game's card in the lobby. Ten of them, one per game, in
`.art` / `.art-{id}` — `CardArt` in `src/client/App.tsx` and the "Card motifs"
block in `src/client/styles.css`.

This document is the register. Read it before adding an eleventh.

---

## What a motif is

A crop of that game's own table, mid-play.

Not an illustration of the game, not a logo, not an icon. The pieces the game
is actually made of, drawn the way its board draws them, framed as if the card
were a window onto a table someone is playing at.

The distinction is load-bearing, and it is where the first version of these
went wrong. Those were emblems: a small, complete, centred specimen of each
game — twelve discs in the middle of a wide empty well, three dice adrift in a
box forty times their area. Nothing filled its frame, so nothing read as a
game. Liar's Dice covered about 3% of its own card.

---

## The five rules

**1. A crop, not an emblem.**
Every motif bleeds off at least two edges of the well. Pieces are sized so the
composition is *bigger* than the frame and gets cut by it. A motif that fits
neatly inside its well with air around it has failed this rule, however
handsome it is.

**2. One silhouette per game.**
No two cards may share a dominant shape. The register below is the list of
what is taken. This is the rule that stops the lobby drifting back towards
eight variations on "coloured squares", which is what it had become: five of
the eight motifs were small rounded rectangles, and Wheel of Fortune's had no
wheel in it at all.

**3. The moment shown must be legal.**
A position the game can actually reach, mid-play rather than at setup. Gravity
applies to Connect Four; a hit lands on a ship and a miss on empty sea; five
dice show a hand the sheet has a box for. The old Connect Four motif lit its
cells by `nth-child` down a column-flow grid and floated two discs in mid-air
over empty ones — decoration wearing a game's clothes. Read every finished
motif back as a position before shipping it.

**4. Pieces, not artwork.**
The Android build ships offline with no image assets, so there is nothing to
draw with but CSS and inline SVG — but the reason is not only the constraint. A
disc grid says "Connect Four" more honestly than a picture of one would. Where
the board has already decided how something looks, copy that decision rather
than inventing a second one. Word Hunt's traced word is filled tiles, not a
line drawn over them, because filled tiles are what a player sees under their
own finger.

**5. Every shape carries itself, in both palettes.**
Colour comes from tokens; a literal is a bug. Any token added must exist in
both palette blocks. Every shape must clear **3:1 against whatever is actually
behind it** — which in a motif is `--board`, with nothing brighter on top to
lift it. That is what `--motif-off` is for. Compute the ratios; do not eyeball
them. The measured table is at the foot of this page.

---

## The register: which game owns which shape

| Game | Owns | Told apart by |
|---|---|---|
| Connect Four | Circles in a grid | The only round pieces in a grid |
| Backgammon | Opposed triangles across a bar | The only triangles; the only bar |
| Wheel of Fortune | A radial arc | The only curve |
| Word Duel | Rows of unlettered marks | Marks without letters; rows, not a square |
| Word Hunt | A lettered grid with a traced path | The only letters |
| Nine Men's Morris | Nested right angles with men on the lines | The only drawn board; the only right-angle line work |
| Ultimate Tic-Tac-Toe | Crosses and noughts in a grid of grids | The only diagonal strokes; the only grid drawn inside another grid |
| Battleships | A fine, dense grid with dot-misses | Cell density; the dot mark |
| Yahtzee | Five dice, spaced and face-up on a tray | Face-up, tidy, tray |
| Liar's Dice | Crowded dice, half of them face-down | Overlap and concealment, no tray |

Ultimate is the fourth motif to be a grid and the reason the register exists.
It is separated from all three of the others twice over: its marks are strokes
rather than filled cells — the only diagonals on any card — and its grid is two
grids, a thin hash inside a thick one, which no other board has. A crop of it
showing only filled squares would be Word Duel.

Word Duel, Word Hunt and Battleships are the three that used to collide. They
are now separated on three axes at once — letters or none, rows or a square
grid, and cell density: Battleships shows ten cells across where Word Hunt
shows four.

Backgammon's points are narrow and long. The board draws a point at 1:5; the
motif gets to 1:3, which is as close as a well two and a half times wider than
it is tall allows, and the difference between that and the 1:1.8 it started at
is the difference between a backgammon board and bunting. It shows **twelve
points across — six, the bar, six** — because that is how many there are between
one side of a real board and the other. A crop showing seven would be inventing
a point.

Yahtzee and Liar's Dice are both dice and cannot be told apart by their pieces,
so they are told apart by composition alone. Yahtzee's five are spaced,
face-up and on a tray, because everyone can see them and the sheet wants them
counted. Liar's Dice is two crowded hands, one of them entirely face-down, cut
off at the bottom — there is more of that table than the card is showing you,
which is the game.

---

## The frame

The well is **5:2** — about 218 × 87 units on a phone.

```css
.art {
  --m: 1px;
  aspect-ratio: 5 / 2;
  flex: none;
  position: relative;
  overflow: hidden;
  display: grid;
}
```

Three of those lines are not optional:

- **`aspect-ratio`, and no `min-height`.** An unreset `min-height` wins against
  `aspect-ratio`; this project has shipped that bug once already. Delete it,
  do not set it to zero.
- **`flex: none`.** `.game` is a column flex container by way of the base
  `label` rule, and a flex item is shrunk out of its ratio without this.
- **`overflow: hidden`.** This is the crop. Rule 1 does not exist without it.

**Sizes are multiples of `--m`, never literals.** `--m` is a length, so
`calc(30 * var(--m))` reads as "thirty units" and comes out as 30px at phone
size. All nine motifs therefore rescale by changing one number rather than
nine blocks. A literal `30px` in a motif is a bug even though it renders
identically today. Morris is the exception that proves the rule: it is drawn in
an SVG whose viewBox is the well's own 218 x 87, so its units *are* the same
units, measured from the same box.

The compositions are laid out against a 218 × 87 box. A well two and a half
times wider than it is tall will not hold a square board, and no motif should
try: Word Hunt shows four columns and a bit under two rows of a sixteen-tile
grid, and is better for it.

---

## Medium

**CSS by default. SVG only where CSS cannot be honest.**

Seven motifs are CSS: bare `<i>` elements laid out and coloured by `nth-child`
in the stylesheet, with `CardArt` emitting nothing but a count. Keep it that
way. The count-plus-a-CSS-block contract is why these are cheap to change.

Two are SVG, and in both cases the shape is the whole reason.

**Wheel of Fortune.** The CSS route to a pie slice is a `conic-gradient`, and
there are no gradients in this stylesheet. An arc gets a path. It draws its
wedges with `sectorPath` from `src/client/games/wheelGeometry.ts`, which the
board imports too, so the lobby and the table cut their wedges the same way.

**Ultimate Tic-Tac-Toe.** Not a count, and not really its own drawing either:
the card emits the board's own markup — `.ut-small`, `.ut-cell`, `.ut-mark` —
and inherits the board's own CSS, so a cross on the card is cut by the same
rule as a cross on the table and the hash rules are the same gaps. This is rule
4 taken to its end: where the board has already decided how something looks,
copy the decision rather than inventing a second one. The price is written into
the hazards below — `.ut-*` class names now appear inside `.art`, and a change
to a cell lands on the card too. It imports nothing from `src/shared/`, so
`bundle.test.ts` is untroubled.

**Nine Men's Morris.** Line work with pieces standing *on* the lines. CSS can
draw three nested boxes easily enough, but every man would then need a
hand-written percentage to stand at — a second set of coordinates for points
the rules have already placed, and the first thing to drift when the board
changes. The SVG reads `pointXY` from `morrisDisplay.ts`, the reducer's own
geometry, so a man on the card is standing where the game says his point is.
That module imports nothing, which is what keeps it on the right side of
`bundle.test.ts`.

Inside SVG, **fills come from classes, never from `fill="#…"` attributes** — a
literal there would be the one colour in the app that could not follow the
palette. This is how `WheelBoard` already draws itself.

Four motifs need structure rather than a count, and that is the bar for
leaving the count contract: the Wheel needs paths, Morris needs points at
coordinates, Word Hunt needs its letters, and Yahtzee and Liar's Dice use the
real `Die` component so their faces are the six the rest of the app draws. `Die` scales entirely off `--die` and is already
in the main bundle — App.tsx imports every board statically — so reusing it
costs nothing and replaced a fake pip that read as a small hole at thirteen
units.

**Faces must vary, and must land unsorted.** Yahtzee shows a large straight
(`3,1,5,2,4`) — the one scoring hand that is five different faces — rather than
a full house, because five dice showing the same two numbers read as a repeated
graphic rather than a throw. Liar's Dice shows a pair among five. Neither is
sorted; dice do not land in order.

---

## Sanctioned exceptions

Recorded here so they stop being re-litigated at every review.

- **Battleships' miss dot is a `radial-gradient`**, and it is the one gradient
  in the stylesheet. It is a hard stop at 22%/23% — a dot, not a fade — and the
  board draws its own misses exactly the same way. A shot that found nothing
  differs from one that found a ship in *shape* as well as colour.
- **Dice are cream with dark pips in both palettes.** These are the only
  colours in the file that do not come from a token, because they are the
  colour of the object rather than of the app. Six literals over three rules,
  and the count is written out here because it used to say "four literals in
  the `.pips` block" and someone checking the claim would have found two: the
  face and the pip in `.pips`, the two cube shades in `.cube-face`, and the
  held-die edge twice in `.die-hold.held`. Motifs inherit this by using `Die`.
- **Battleships' unhit ship is `--motif-off`, not `--point-light`.** The board
  paints a ship `--point-light`, which is a pale slab against the sea it sits
  in and only 1.8:1 against `--board`. A motif has no sea under it, so the ship
  takes the unlit colour instead. Rule 5 outranks rule 4 when they disagree.
- **The Yahtzee tray's edge is `--motif-off`, not a rule colour.** `--tray`
  sits about 1.2:1 from `--board` in both palettes and even `--rule-hi` only
  reaches 1.6:1, so an edge drawn the way the panels draw theirs would leave
  the tray a slab nobody can see.
- **`--motif-off` is no longer only a motif colour.** The Morris board is line
  work drawn straight onto `--board` with nothing over it — the same problem a
  motif has, on a real table — so the board itself takes the token as well.
  Its comment in `styles.css` says so; the name is historical.
- **Morris's men are ringed in `--board`, like Backgammon's checkers**, and for
  a second reason on top of that one: a man stands *on* a line, and both seat
  colours sit within 2:1 of `--motif-off` in one palette or the other. The ring
  is what separates the piece from the road it is standing on.

### The one measured compromise

`--motif-off` on `--tray` is **2.76:1 in daylight** — the Yahtzee tray edge
seen from *inside* the tray. Its outer side against `--board` is 3.33:1, and
that is the boundary that defines the shape. Accepted knowingly. Everything
else clears 3:1 in both palettes.

---

## Adding the next game's motif

1. **Claim a shape.** Check the register. If the silhouette you want is taken,
   either find another or make the case in this file for why two games can
   share one. Do not skip this — it is the step that decays first.
2. **Compose a legal moment.** Write down the position and check it against the
   rules of the game. Prefer mid-play to setup.
3. **Choose the medium.** CSS unless the shape genuinely cannot be drawn
   honestly without a path. Reuse `Die`, `sectorPath`, or the board's own
   `clip-path` where one exists.
4. **Lay it out against 218 × 87 in `--m` units**, sized so it overflows the
   well on at least two edges.
5. **Add the case to `motif()` in `App.tsx`** — a count if it can be, structure
   only if it must be, the board's own classes if the board has already drawn
   this shape — and an `.art-{id}` block in the "Card motifs" section of
   `styles.css`.
6. **Measure the contrast** of every shape against what is behind it, in both
   palettes. Not text contrast; 3:1 non-text.
7. **Read it back as a position.** Then look at it next to the other nine and
   check it does not read as one of them.

The accent stripe and the card frame are not part of this: the accent comes
from the channel map, and adding a game means adding it there too — see below.

---

## Known hazards

- **The channel accent map is written three times** and nothing tests that the
  copies agree: `:root[data-game=…]` at the top of `styles.css`, `.game[data-game=…]`
  in the game-picker block, and `CHANNELS` in `src/client/palette.ts`. A new
  game needs all three.
- **`.next-game` reuses `.game`** and renders no motif at all. Card-level
  changes land on the end-of-game screen; `.art` changes do not.
- **Class names are global and unprefixed** in one stylesheet of ~3,400 lines.
  `.art`, `.game`, `.name`, `.meta` and `.stripe` are all generic. This project
  has already shipped two collisions of exactly that kind — the second was in
  these motifs. **`.art i` and `.pips i` have identical specificity**, and `.art`
  sits later in the file, so `display: block` beat `display: none` and every die
  in the lobby turned on all six of its pip slots: every face showed a six, with
  the slots that face has no `grid-area` rule for scattered wherever
  auto-placement dropped them. The rule is `.art > i`, because a motif's own
  pieces are always direct children and a die's pips never are. **Any new
  descendant selector under `.art` must be checked against the board CSS it will
  now also match.**
- **Ultimate's motif *is* the board.** It renders `.ut-small` / `.ut-cell` /
  `.ut-mark` and takes its cross, its nought and its two hash gaps from the
  Ultimate block at the foot of `styles.css`. Deliberate, and the sharpest form
  of the hazard above: a change to a cell there changes the card. The
  `.art-ultimate` block holds the frame and nothing else.
- **Backgammon's motif and the board share two `clip-path` polygons.** They are
  the same shape in the same viewBox units as `PointOutline` in
  `BackgammonBoard.tsx`. If either changes, both do.
- **`.seats` is dead CSS.** It styles `.games.seats .game` as a chip for a
  seat-count picker that nothing renders.
- **`bundle.test.ts` is watching.** A motif may not import a runtime binding
  from `src/shared/games/` beyond the manifest and the `*Display.ts` modules.
  `wheelGeometry.ts` lives in `src/client/games/` for this reason.

---

## Measured contrast

Every pairing where two things actually touch, against `--board` unless
otherwise stated. Cells separated by a gap are judged against the gap, not
against each other.

| Pairing | Stage | Daylight |
|---|---|---|
| Unlit edge / board (`--motif-off`) | 3.91 | 3.33 |
| Connect Four ember disc | 5.37 | 3.78 |
| Connect Four ice disc | 8.29 | 3.65 |
| Backgammon gold point | 10.32 | 3.65 |
| Backgammon checker ring / point | 3.91 | 3.33 |
| Backgammon bar edge / board | 3.91 | 3.33 |
| Backgammon checker / its ring | 5.37 / 8.29 | 3.78 / 3.65 |
| Wheel spoke / wedge | 4.72 | 4.13 |
| Wheel cash wedge | 10.00 | 4.53 |
| Wheel pointer | 14.71 | 14.14 |
| Word Duel hit / near tile | 10.04 / 10.32 | 4.04 / 3.65 |
| Battleships ship | 3.91 | 3.33 |
| Battleships hit | 5.37 | 3.78 |
| Battleships miss dot | 5.12 | 4.64 |
| Yahtzee tray edge / board | 3.91 | 3.33 |
| Yahtzee tray edge / tray | 4.72 | **2.76** |
| Word Hunt traced tile | 10.04 | 4.04 |
| Word Hunt letter on trace | 11.83 | 5.24 |
| Morris line / board | 3.91 | 3.33 |
| Morris empty point / board | 3.91 | 3.33 |
| Morris man / its ring of board | 5.37 / 8.29 | 3.78 / 3.65 |
| Ultimate cross (`--seat-0`) | 5.37 | 3.78 |
| Ultimate nought (`--seat-1`) | 8.29 | 3.65 |
| Ultimate hash / board | 3.91 | 3.33 |
| Ultimate dead mark / board | 3.91 | 3.33 |

Backgammon checkers get a two-unit ring of `--board` because every seat colour
sits within 2:1 of `--motif-off` in one palette or the other. A checker is on a
*point*, not on the board, so the ring is what separates it from what it stands
on — which is also the gap a real checker leaves around itself.
