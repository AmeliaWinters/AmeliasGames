import {
  DEALS,
  letterpressDeal,
  liarsDeal,
  morrisDeal,
  yahtzeeDeal,
} from "./cardDeal";
// Runtime, not type-only: the card motif and the board are drawn from the same
// geometry as the rules. `morrisDisplay.js` imports nothing, so the reducer
// does not follow it in, the same bargain wheelDisplay and battleshipDisplay
// already make.
import { pointAt, pointXY } from "../shared/games/morrisDisplay.js";
import { Die } from "./games/Die.js";
import { WEDGE_COUNT, sectorPath } from "./games/wheelGeometry.js";

/*
 * Everything this app draws that is not a board.
 *
 * The wordmark and the thirteen lobby-card motifs. All of
 * it is static: no state, no props beyond a game id, nothing that reads the
 * room. It lived in `App.tsx` until that file was four hundred lines of
 * artwork wrapped around eight hundred lines of shell, and the artwork was
 * what anyone scrolling past had to scroll past.
 *
 * Three things leave here -- `TopMark`, `BrandMark`, `CardArt` -- and the rest
 * is the machinery behind them.
 */


/**
 * A name in two parts, so the channel colour can land on the second half.
 *
 * Splitting at the last space is what makes "Rebellia Games" and "Wheel of
 * Fortune" read the way they should without a lookup table to keep in step with
 * the manifest. A one-word name has no second half, so it takes the accent
 * whole, which is the same rule and not an exception to it.
 */
function splitMark(name: string): [string, string] {
  const cut = name.lastIndexOf(" ");
  return cut === -1 ? ["", name] : [name.slice(0, cut + 1), name.slice(cut + 1)];
}

function Wordmark({ name }: { name: string }) {
  const [head, tail] = splitMark(name);
  return (
    <>
      {head}
      <span className="tail">{tail}</span>
    </>
  );
}

/**
 * The brand: the supplied wordmark, figure, squares and all.
 *
 * One image rather than a glyph plus type, because the lockup is now artwork
 * with its own spacing between the figure and the letterforms, and rebuilding
 * that in flexbox would drift from the file the moment either is retouched.
 *
 * Two files, and only because the ink moves. The wordmark is drawn in near
 * black, which is invisible on stage's ground, so `logo-stage.png` is the same
 * PNG with its one ink entry swapped for the light one; the five signal
 * squares are identical in both. Swapped by CSS on `data-palette` rather than
 * by React, so the switch does not wait on a render.
 *
 * Height in `em` off the bar's font-size, so the bar still has one number to
 * tune, and the width follows the image's own 1076x438 -- which is on the tag
 * as `width`/`height` rather than left to the file, because `width: auto` off
 * an undecoded image is zero. The mark is the first thing in the top bar and
 * the largest thing on the first screen, so everything beside it was being
 * laid out at the wrong width and shunted sideways when the PNG landed: a
 * layout shift on every cold load, and on the element most likely to be the
 * LCP. The attributes give the ratio before a byte of it arrives; the CSS
 * still decides the size.
 */
export function BrandMark() {
  return (
    <span className="brandmark">
      <img className="logo daylight" src="/logo.png" alt="Rebellia Games" width={1076} height={438} />
      <img className="logo stage" src="/logo-stage.png" alt="" aria-hidden="true" width={1076} height={438} />
    </span>
  );
}

/**
 * What the top bar is called: the brand, and the game when a game is open.
 *
 * In a room this used to be the game's name *instead of* the brand, so the one
 * screen a player spends the whole evening on never said what they were playing
 * on. Both now, stacked: brand small above, game at full size below.
 *
 * Stacked rather than run together, because inline the two compete for a
 * phone's width against a room code and a sound button, and the brand wins by
 * being first. "REBELLIA GAMES - WORD D..." says the half you already knew and
 * cuts the half you are actually playing. Vertically they both fit inside the
 * 44px the tap target reserves anyway, so the bar is no taller for the line.
 *
 * The accent stays on the most specific thing on the bar, which is why it
 * moves to the game's name as soon as there is one.
 */
export function TopMark({ gameName }: { gameName?: string }) {
  return (
    <>
      {gameName !== undefined && <span className="brand">Rebellia Games</span>}
      <span className="playing">
        <Wordmark name={gameName ?? "Rebellia Games"} />
      </span>
    </>
  );
}

/**
 * Which shelf this visit gets.
 *
 * Drawn once at module load rather than per render, which is the whole of what
 * makes this safe: the four dealt motifs are read on every re-render of the
 * lobby, and a deal taken inside `motif()` would reshuffle the dice under
 * anyone who typed a letter into the name field. One integer, fixed for as
 * long as the tab is open, and a different one next time.
 *
 * See `cardDeal.ts` for what is dealt and why the other nine are not.
 */
const DEAL = Math.floor(Math.random() * DEALS);

/** N bare pieces, for the motifs the stylesheet lays out and colours itself. */
function pieces(count: number) {
  return Array.from({ length: count }, (_, i) => <i key={i} />);
}

/**
 * Word Hunt's own test grid, with CRANE across the top of it.
 *
 * Lifted from `wordHunt.test.ts`, which traces exactly this word through
 * exactly these letters, so the word on the card is one the game agrees is
 * there rather than five letters that look like one.
 */
const WORD_HUNT_TILES = ["C", "R", "A", "N", "S", "E", "T", "E"];

/**
 * Three links of an English chain: MILK, KIWI, ICEBERG.
 *
 * Checked against the game's own list rather than chosen for their shapes --
 * `chainLookup('en', ...)` finds all three -- and each one starts on the letter
 * the one above it ended with, which is the whole rule. The stagger in the
 * `.art-wordchain` block is what draws that: every word begins in the column
 * its parent's last letter is standing in, so the joint is one column of two
 * letters rather than a claim in a caption.
 *
 * Letters are separate elements because the joint has to line up to the
 * column. They are bare glyphs on the board -- no cell, no outline -- which is
 * also what keeps this from being a third lettered grid; see the register.
 */
const CHAIN_LINKS = ["MILK", "KIWI", "ICEBERG"];

/**
 * A Vocab Race reveal: the clue it asked, and the word that answers it.
 *
 * Real data, from `vocabQuestion('pl', 20)` -- the twentieth commonest Polish
 * word, which is what a game a few rounds deep is actually showing. Written
 * out rather than imported because the dictionary is a reducer-side module and
 * `bundle.test.ts` keeps the lobby out of it.
 */
const VOCAB_REVEAL = { clue: "only, just", word: "tylko" };

/**
 * A Superghost fragment with somewhere to go at both ends.
 *
 * `iłoś` is inside `miłość`, love, and the list has seven words containing it:
 * an `m` in front, a `c`, an `n` or a `ć` behind. So the two open slots on
 * either side of it are the position rather than a flourish. Written out rather
 * than imported for the reason Vocab Race's reveal is: the dictionary is a
 * reducer-side module and `bundle.test.ts` keeps the lobby out of it.
 */
const GHOST_FRAGMENT = "iłoś";
/* Drill's card. A different word from the Wheel's and from Vocab Race's, so
   the two green cards beside each other are not the same word twice. */
const DRILL_MOTIF = { clue: "already", word: "już" };

/**
 * The middle band of an Ultimate board, mid-game: boards 3, 4 and 5.
 *
 * Crosses have taken the left board on its left column and noughts the right
 * board on its middle row; the centre board is still being fought over. Seven
 * marks each, which is a position with noughts having just moved -- the other
 * six boards are off the card, and they are where the rest of both hands is.
 *
 * A crop cannot show that every move was sent where the rules send it, because
 * six of the nine boards are outside the frame. What it can show, and does, is
 * that no board holds a line it has not been credited with and that the two
 * counts are ones the turn order allows.
 */
type Mark = 0 | 1 | null;
const ULTIMATE_MOTIF: Array<{ marks: Mark[]; won: 0 | 1 | null; line: number[] }> = [
  { marks: [0, 1, null, 0, 1, null, 0, null, null], won: 0, line: [0, 3, 6] },
  { marks: [1, null, 0, null, 0, null, null, null, 1], won: null, line: [] },
  { marks: [0, null, null, 1, 1, 1, null, null, 0], won: 1, line: [3, 4, 5] },
];

/**
 * The top of the wheel, rising past the crop.
 *
 * The whole wheel is drawn and most of it falls outside the box: a circle in a
 * frame two and a half times wider than it is tall can only ever be an arc of
 * one. `sectorPath` is the board's, so the lobby and the table cut their wedges
 * the same way.
 *
 * Fills come from classes rather than attributes, which is how the wheel itself
 * is drawn. A literal here would be the one colour in the app that could not
 * follow the palette.
 */
function WheelArc() {
  return (
    <svg viewBox="0 0 220 88" preserveAspectRatio="xMidYMid slice">
      {/* The wheel is drawn about its own origin and moved to its centre, which
          sits a good way below the bottom edge. */}
      <g transform="translate(110 110)">
        {Array.from({ length: WEDGE_COUNT }, (_, i) => (
          <path
            key={i}
            className={i === 33 ? "wedge cash" : i === 2 ? "wedge lose" : "wedge"}
            d={sectorPath(i)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      <path className="pointer" d="M 110 19 L 101 0 L 119 0 Z" />
    </svg>
  );
}

/**
 * The top-left corner of a morris board, enlarged until it runs off three
 * edges of the well.
 *
 * The whole board is a square and the well is two and a half times wider than
 * it is tall, so a board that fitted would be a postage stamp with nine
 * invisible points along each side. A corner instead: three nested right
 * angles and the spoke between them: a shape no other card here has, and the
 * one thing about this board people misremember, since the corners have no
 * spokes and only the midpoints of the edges do.
 *
 * Laid out against the 218 x 87 well at 38 units to a board unit, with the
 * outer corner off the frame at (-6, -8).
 *
 * Both numbers moved once the shelf started drawing this card at three sizes.
 * At 34 units to a board unit the outer ring was 204 wide inside a 218 well,
 * so the corner this motif is named for sat *inside* the frame with a margin
 * of air above and to the left of it, while the board ran 129px off the
 * bottom: a board that has been cut off, which is the opposite of a crop. At
 * 38 the outer ring is 228 wide -- wider than the well it is in -- and the
 * corner is outside the frame, so what is left in the frame is the nest of
 * rings a Morris board is, cut on all four edges. Points come from `pointXY`, which is the reducer's
 * own geometry, so the men stand exactly where the rules say the points are.
 *
 * The position: two men each in the corner being shown, no mill among them.
 * The rest of both hands is off the card, which is the point of a crop.
 */
const MORRIS_UNIT = 38;
/** Where board (0, 0), the centre of the board, falls in the well. */
const MORRIS_CENTRE = { x: -6 + 3 * MORRIS_UNIT, y: -8 + 3 * MORRIS_UNIT };

function morrisAt(point: number): { cx: number; cy: number } {
  const { x, y } = pointXY(point);
  return { cx: MORRIS_CENTRE.x + x * MORRIS_UNIT, cy: MORRIS_CENTRE.y + y * MORRIS_UNIT };
}

function MorrisCorner() {
  const deal = morrisDeal(DEAL);
  const men: Array<[number, 0 | 1]> = deal.men.map(({ ring, spot, seat }) => [
    pointAt(ring, spot),
    seat,
  ]);
  const empty = deal.empty.map(({ ring, spot }) => pointAt(ring, spot));
  return (
    <svg viewBox="0 0 218 87" preserveAspectRatio="xMidYMid slice">
      {[3, 2, 1].map((reach) => (
        <rect
          key={reach}
          className="line"
          x={MORRIS_CENTRE.x - reach * MORRIS_UNIT}
          y={MORRIS_CENTRE.y - reach * MORRIS_UNIT}
          width={reach * 2 * MORRIS_UNIT}
          height={reach * 2 * MORRIS_UNIT}
        />
      ))}
      {[1, 3, 5, 7].map((spot) => {
        const from = morrisAt(pointAt(0, spot));
        const to = morrisAt(pointAt(2, spot));
        return (
          <line key={spot} className="line" x1={from.cx} y1={from.cy} x2={to.cx} y2={to.cy} />
        );
      })}
      {empty.map((point) => (
        <circle key={point} className="spot" r={7} {...morrisAt(point)} />
      ))}
      {men.map(([point, seat]) => (
        <g key={point} className={`man s${seat}`}>
          {/* The ring of board colour is the gap a real man leaves around
              himself, and it is also what separates him from the line he is
              standing on. Backgammon's checkers carry the same one. */}
          <circle r={13} {...morrisAt(point)} />
          {seat === 1 && <circle className="ring" r={10} {...morrisAt(point)} />}
        </g>
      ))}
    </svg>
  );
}

/**
 * The motif on a game's card: a crop of that game's own table, mid-play.
 *
 * Pieces rather than artwork, because the Android build ships offline with no
 * image assets and a disc grid says "Connect Four" more honestly than an
 * illustration would. A crop rather than an emblem, because the same pieces
 * shrunk to the middle of the well read as a specimen mounted on card instead
 * of a game being played.
 *
 * Most of these are a count and nothing more, laid out and coloured by
 * nth-child in the stylesheet. Six are not: the Wheel needs arcs, which CSS
 * cannot cut without a gradient; Morris needs its points at coordinates the
 * rules already hold; the two lettered grids need their letters, as do Word
 * Chain's three words and Vocab Race's clue and answer; and the two dice
 * games use the real `Die`, so their faces are the six the rest of the app
 * draws rather than a dot standing in for a pip.
 *
 * The rules all thirteen follow, and the register of which game owns which
 * shape, are in `docs/card-motifs.md`. Read it before adding a fourteenth.
 */
export function CardArt({ gameId }: { gameId: string }) {
  return (
    <span className={`art art-${gameId}`} aria-hidden="true">
      {motif(gameId)}
    </span>
  );
}

function motif(gameId: string) {
  switch (gameId) {
    // Seven columns and the bottom three rows, cropped on three edges. Ember
    // has a column of three standing and it is ice to play.
    case "connect4":
      return pieces(21);
    // Twelve points a side, opposed across the bar as they are on a board --
    // the bar itself is a pseudo-element, so these keep indices 1 to 24. The
    // <b>s are checkers: they sit over the triangles, which are clipped and
    // cannot hold anything.
    case "backgammon":
      return (
        <>
          {pieces(24)}
          <b />
          <b />
          <b />
          <b />
          <b />
        </>
      );
    case "wheel":
      return <WheelArc />;
    // A guess that has been marked and the empty row under it. No letters: the
    // marks are the game, and letters here would make this the third card with
    // writing on it.
    case "wordle":
      return pieces(10);
    // The top four rows of a ten-wide sea: a ship with two hits in it, and
    // three shots that found nothing.
    case "battleship":
      return pieces(40);
    // A large straight, landed in the order dice land in rather than sorted:
    // the one scoring hand that shows five different faces, which is what a
    // row of dice should look like.
    case "yahtzee":
      return yahtzeeDeal(DEAL).map((value, i) => <Die key={i} value={value} label="" />);
    // Your hand, and a hand that is somebody else's business.
    case "liarsdice":
      return (
        <>
          <span>
            {liarsDeal(DEAL).map((value, i) => (
              <Die key={i} value={value} label="" />
            ))}
          </span>
          <span>
            {Array.from({ length: 5 }, (_, i) => (
              <Die key={i} value={0} hidden label="" />
            ))}
          </span>
        </>
      );
    case "wordhunt":
      return WORD_HUNT_TILES.map((letter, i) => <i key={i}>{letter}</i>);
    // Fifteen tiles of a twenty-five-tile board, five across, with the third
    // row all but off the bottom: ice holds six, ember five, four are still
    // unclaimed. The K is surrounded on all three sides it has and is locked,
    // which is the game's one rule and the only square-cornered tile in the
    // lobby.
    case "letterpress":
      return letterpressDeal(DEAL).map((letter, i) => <i key={i}>{letter}</i>);
    // Three nested corners of the board and the spoke between them, with four
    // men standing on the points. The second motif that is not CSS, for the
    // same reason as the first: the shape is line work, and a stylesheet with
    // no gradients in it cannot draw a square with men sitting on its edge
    // without inventing a second set of coordinates for them.
    case "morris":
      return <MorrisCorner />;
    // Three of the nine boards, in the board's own markup and the board's own
    // CSS -- so the crosses on the card are cut the same way as the crosses on
    // the table, and the hash rules are the same gaps. Reuse rather than a
    // second drawing of the same shape, which is what rule 4 asks for; the
    // cost is that .ut-* class names now appear inside .art, and a change to
    // the board's cell lands here too.
    case "ultimate":
      return ULTIMATE_MOTIF.map(({ marks, won, line }, board) => (
        <span key={board} className={`ut-small ${won === null ? "live" : `settled won${won}`}`}>
          {marks.map((mark, spot) => (
            <i
              key={spot}
              className={`ut-cell${mark === null ? " empty" : ` m${mark}`}${
                line.includes(spot) ? " line" : ""
              }`}
            >
              <span className="ut-mark" />
            </i>
          ))}
        </span>
      ));
    // Three links of a chain, each starting in the column its parent's last
    // letter is standing in -- so the shared letter is one column of two
    // glyphs, and the rule is drawn rather than described. Bare letters, no
    // cells: the lobby already has two lettered grids and this is not a third.
    case "wordchain":
      return CHAIN_LINKS.map((word, link) => (
        <span key={link}>
          {[...word].map((letter, i) => (
            <i key={i}>{letter}</i>
          ))}
        </span>
      ));
    // The six seconds after a round: the clue, and the word that answers it,
    // inside the only full border the app draws around anything. Scores are
    // cut off above it -- there is a race going on over this card, and the
    // reveal is what everyone in it is looking at while it runs.
    // A card mid-review: the clue, the box you type into, and the two cards
    // behind it that are still to come. Drill's own table, cropped, which is
    // the rule `docs/card-motifs.md` is built on -- not an icon of studying.
    case "drill":
      return (
        <>
          <i />
          <i />
          <span>
            <b>{DRILL_MOTIF.clue}</b>
            <strong lang="pl">{DRILL_MOTIF.word}</strong>
          </span>
        </>
      );
    case "vocab":
      return (
        <>
          <span>
            <i />
            <i />
            <i />
          </span>
          <span>
            <b>{VOCAB_REVEAL.clue}</b>
            <strong lang="pl">{VOCAB_REVEAL.word}</strong>
          </span>
        </>
      );
    // The fragment mid-round, with both ends open. Two empty slots and four
    // letters, which is the whole rule drawn: `iłoś` is inside `miłość` and it
    // takes an `m` on the front or a `ć` on the back, so neither slot is a
    // decoration. Real data, checked against the game's own list rather than
    // chosen for its shape, and it is the one motif in the lobby carrying a
    // Polish diacritic, which is the other thing this game is for.
    case "ghost":
      return (
        <>
          <i className="open" />
          {[...GHOST_FRAGMENT].map((letter, i) => (
            <i key={i} lang="pl">
              {letter}
            </i>
          ))}
          <i className="open" />
        </>
      );
    // A game the manifest knows and this file does not. An empty well reads as
    // a card with no picture, which is better than a card with a wrong one.
    default:
      return null;
  }
}
