import { useEffect, useRef, useState } from "react";
// The manifest, not the registry: the lobby needs ids and names, and importing
// the registry here would pull every reducer into the client bundle.
import {
  DEFAULT_GAME_ID,
  canSeat,
  gameEntry,
  gameList,
  type GameEntry,
} from "../shared/games/manifest.js";
import { CODE_LENGTH, isRoomCode, makeRoomCode, normalizeRoomCode } from "../shared/roomCode.js";
// Runtime, not type-only: the card motif and the board are drawn from the same
// geometry as the rules. `morrisDisplay.js` imports nothing, so the reducer
// does not follow it in — the same bargain wheelDisplay and battleshipDisplay
// already make.
import { pointAt, pointXY } from "../shared/games/morrisDisplay.js";
// Which board draws which game, and the state types that go with them, live in
// `boards.ts` — where the compiler checks the pairing. Nothing here needs to
// know: this file's business with a game is its name and its motif.
import { boardFor } from "./games/boards.js";
import { Die } from "./games/Die.js";
import { WEDGE_COUNT, sectorPath } from "./games/wheelGeometry.js";
import { inviteUrl, loadLastGame, loadName, saveLastGame, saveName, useRoom } from "./net.js";
import type { ErrorKind, RoomView } from "../shared/protocol.js";
import {
  applyChannel,
  applyPalette,
  loadPalette,
  otherPalette,
  PALETTES,
  savePalette,
  type Palette,
} from "./palette.js";
import { applySound, loadSound } from "./feel.js";
import { play, primeSfx, useTableSounds } from "./sfx.js";
import { Toaster, useToasts, type Toasts } from "./toast.js";

/**
 * A name in two parts, so the channel colour can land on the second half.
 *
 * Splitting at the last space is what makes "Rebellia Games" and "Wheel of
 * Fortune" read the way they should without a lookup table to keep in step
 * with the manifest. A one-word name has no second half, so it takes the
 * accent whole — which is the same rule, not an exception to it.
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
 * What the top bar is called: the brand, and the game when a game is open.
 *
 * In a room this used to be the game's name *instead of* the brand, so the
 * one screen a player spends the whole evening on never said what they were
 * playing on. Both now, stacked — brand small above, game at full size below.
 *
 * Stacked rather than run together on one line, because inline the two of them
 * compete for a phone's width against a room code and a sound button, and the
 * brand wins by being first: "REBELLIA GAMES · WORD D…" says the half you
 * already knew and cuts the half you are actually playing. Vertically they
 * both fit inside the 44px the tap target reserves anyway, so the bar is no
 * taller for having gained a line.
 *
 * The accent stays on the most specific thing on the bar, which is why it
 * moves to the game's name as soon as there is one.
 */
function TopMark({ gameName }: { gameName?: string }) {
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
 * What the tab says before a room is open.
 *
 * Read off the document rather than written out again: `index.html` sets a
 * title built for a search result, and a second copy of it here would be a
 * second copy to keep in step. Captured at module load, which is before
 * anything below has had a chance to change it.
 */
const LOBBY_TITLE = typeof document === "undefined" ? "" : document.title;

/** N bare pieces, for the motifs the stylesheet lays out and colours itself. */
function pieces(count: number) {
  return Array.from({ length: count }, (_, i) => <i key={i} />);
}

/**
 * Word Hunt's own test grid, with CRANE across the top of it.
 *
 * Lifted from `wordHunt.test.ts`, which traces exactly this word through
 * exactly these letters — so the word on the card is one the game agrees is
 * there, rather than five letters that look like one.
 */
const WORD_HUNT_TILES = ["C", "R", "A", "N", "S", "E", "T", "E"];

/**
 * The top two rows of a Letterpress board, mid-game.
 *
 * Scrambled on purpose, unlike Word Hunt's row above. Adjacency means nothing
 * in this game -- a word is built from any tiles anywhere -- so letters lying
 * in a row that spelled something would be advertising a rule it does not
 * have. Which tile belongs to whom, and which one is locked, is in the
 * `.art-letterpress` block; the position it shows is written down there too.
 */
const LETTERPRESS_TILES = [
  "E", "K", "R", "A", "O",
  "T", "N", "I", "S", "H",
  "W", "E", "D", "L", "U",
];

/**
 * Three links of an English chain: MILK, KIWI, ICEBERG.
 *
 * Checked against the game's own list rather than chosen for their shapes --
 * `chainLookup('en', …)` finds all three -- and each one starts on the letter
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
 * is drawn — a literal here would be the one colour in the app that could not
 * follow the palette.
 */
function WheelArc() {
  return (
    <svg viewBox="0 0 220 88">
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
 * angles and the spoke between them, which is a shape no other card here has
 * and the one thing about this board people misremember — the corners have no
 * spokes, only the midpoints of the edges do.
 *
 * Laid out against the 218 x 87 well at 34 units to a board unit, with the
 * outer corner at (20, 18). Points come from `pointXY`, which is the reducer's
 * own geometry, so the men stand exactly where the rules say the points are.
 *
 * The position: two men each in the corner being shown, no mill among them.
 * The rest of both hands is off the card, which is the point of a crop.
 */
const MORRIS_UNIT = 34;
/** Where board (0, 0) — the centre of the board — falls in the well. */
const MORRIS_CENTRE = { x: 20 + 3 * MORRIS_UNIT, y: 18 + 3 * MORRIS_UNIT };

function morrisAt(point: number): { cx: number; cy: number } {
  const { x, y } = pointXY(point);
  return { cx: MORRIS_CENTRE.x + x * MORRIS_UNIT, cy: MORRIS_CENTRE.y + y * MORRIS_UNIT };
}

function MorrisCorner() {
  const men: Array<[number, 0 | 1]> = [
    [pointAt(0, 0), 0],
    [pointAt(1, 1), 0],
    [pointAt(0, 1), 1],
    [pointAt(1, 2), 1],
  ];
  const empty = [pointAt(0, 2), pointAt(1, 0), pointAt(2, 0), pointAt(2, 1)];
  return (
    <svg viewBox="0 0 218 87">
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
function CardArt({ gameId }: { gameId: string }) {
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
      return [3, 1, 5, 2, 4].map((value, i) => <Die key={i} value={value} label="" />);
    // Your hand, and a hand that is somebody else's business.
    case "liarsdice":
      return (
        <>
          <span>
            {[4, 2, 6, 4, 3].map((value, i) => (
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
      return LETTERPRESS_TILES.map((letter, i) => <i key={i}>{letter}</i>);
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
    // A game the manifest knows and this file does not. An empty well reads as
    // a card with no picture, which is better than a card with a wrong one.
    default:
      return null;
  }
}

/**
 * This page, addressed to a room — path, query, then the code.
 *
 * The order is the whole of it. Written as `#${code}${location.search}` the
 * query lands *after* the hash, and everything after a hash is the fragment:
 * a player who arrived at `?as=b` — or at a link a chat app had decorated
 * with a tracking parameter, which is most links — got a fragment reading
 * `ABCD?as=b`. Nothing broke on the spot, because the code had already been
 * set in state. It broke on the next reload, where `codeFromHash` no longer
 * recognised four letters, `brokenHashCode` did, and somebody sitting in a
 * game was shown "that link doesn't look complete" and dropped at the setup
 * screen.
 */
function roomUrl(code: string): string {
  return `${location.pathname}${location.search}#${code}`;
}

function codeFromHash(): string | null {
  const raw = location.hash.slice(1).toUpperCase();
  return isRoomCode(raw) ? raw : null;
}

/**
 * A hash that is present but unusable — a link truncated by a chat app, or
 * mangled in the paste. Silently dropping it leaves someone staring at the
 * setup screen wondering why their friend's link did nothing.
 */
function brokenHashCode(): string | null {
  const raw = location.hash.slice(1);
  if (raw.length === 0 || isRoomCode(raw.toUpperCase())) return null;
  // Whatever is in the fragment is somebody else's typing, and it can be any
  // length at all. A toast that quotes it has to quote a readable amount of
  // it: past a couple of codes' worth the quotation is no longer helping the
  // player recognise their own broken link, it is just filling the toast.
  return raw.length > 12 ? `${raw.slice(0, 12)}…` : raw;
}

/** The toast a broken invite link raises, quoting the part that went wrong. */
function brokenLinkMessage(fragment: string): string {
  return (
    `"${fragment}" is not a room code — they are ${CODE_LENGTH} letters. ` +
    "Ask for the link again, or type the code below."
  );
}

/**
 * Whether a failed join deserves the whole screen.
 *
 * Only one kind does. A wrong code, a full table and a game already dealt are
 * all *moments*: the player is one keystroke from trying again, and taking
 * over the screen to say so put a heading and a "Back to the start" button in
 * front of a typo. Those come back as toasts over the setup screen now.
 *
 * A protocol mismatch is not a moment. This bundle cannot talk to that server
 * until it is reloaded, so every retry fails the same way, and a notice that
 * fades after five seconds would leave the player looking at a form that
 * cannot work. That one keeps its screen, and its reload button.
 */
function needsWholeScreen(kind: ErrorKind | null): boolean {
  return kind === "protocol";
}

/**
 * How many can play, as a figure rather than a sentence.
 *
 * It used to read "2 players", which nine of the thirteen cards said — so the
 * smallest type in the lobby was spending itself thirteen times on the least
 * interesting fact available, and the card's own line now carries what the
 * game actually is. A bare figure at the end of the name is what is left, and
 * it is the better shape for the question it answers: somebody looking for a
 * game four people can play is comparing thirteen numbers down a column, not
 * reading thirteen sentences to find the digit in each one.
 *
 * The word is gone from the card, so it is put back for anyone listening to
 * it rather than looking — see `seatLabel`.
 */
function seatSummary(table: GameEntry): string {
  return table.minPlayers === table.maxPlayers
    ? `${table.minPlayers}`
    : `${table.minPlayers}–${table.maxPlayers}`;
}

/** The same range, said out loud, for the card's accessible name. */
function seatLabel(table: GameEntry): string {
  return table.minPlayers === table.maxPlayers
    ? `${table.minPlayers} players`
    : `${table.minPlayers} to ${table.maxPlayers} players`;
}

/**
 * The palette, and the switch that changes it.
 *
 * Opening is a guess -- your last choice, or your system's preference -- so
 * mounting paints without recording. Pressing the switch is the choice, and is
 * the only thing that writes it down.
 */
function usePalette(): [Palette, () => void] {
  const [palette, setPalette] = useState<Palette>(loadPalette);
  useEffect(() => applyPalette(palette), [palette]);
  return [
    palette,
    () =>
      setPalette((current) => {
        const next = otherPalette(current);
        savePalette(next);
        return next;
      }),
  ];
}

/**
 * Whether the app makes a noise, remembered like the palette is.
 *
 * Off until asked for. A game that is silent is missing half of itself, and a
 * page that makes a noise the first time you open it on a bus is a page you
 * close — so the switch sits beside the palette switch in the lobby and in the
 * top bar in a room, where it is found rather than buried, and the first sound
 * anyone hears is one they asked for.
 *
 * One switch covers everything: the synthesised dice read the same preference
 * `applySound` writes, and `primeSfx` can only build an audio graph once that
 * preference is on. Turning it off does not need to reach the cues at all.
 */
function useSound(): [boolean, () => void] {
  const [sound, setSound] = useState<boolean>(loadSound);
  useEffect(() => {
    applySound(sound);
    // Order matters: nothing can load until the preference is on. The cue is
    // the switch answering — see `primeSfx`.
    if (sound) primeSfx("tap");
  }, [sound]);
  return [sound, () => setSound((on) => !on)];
}

/**
 * The channel colour, set on the root rather than passed down.
 *
 * The room's own game id wins where there is a room: the lobby's pick is only
 * a preference until the server seats you, and joining someone else's link
 * lands you in a game you never picked.
 */
function useChannel(gameId: string): void {
  useEffect(() => {
    applyChannel(gameId);
  }, [gameId]);
}

/**
 * The toasts outlive the screen they were raised on -- a failed join drops
 * the player back to the setup screen, and the toast saying why has to
 * survive that swap -- so the stack is owned out here, above every screen,
 * and rendered once beside whichever one is showing.
 */
export function App() {
  const toasts = useToasts();
  return (
    <>
      <AppScreens toasts={toasts} />
      <Toaster toasts={toasts.toasts} onDismiss={toasts.dismiss} />
    </>
  );
}

function AppScreens({ toasts }: { toasts: Toasts }) {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState<string | null>(codeFromHash);
  const [intent, setIntent] = useState<"idle" | "play">(codeFromHash() ? "play" : "idle");
  const [create, setCreate] = useState(false);
  /*
    The game the lobby opens on, and the one it draws at twice the size.

    Checked against the manifest rather than trusted, because this is a string
    a browser has been holding since the last visit: a game that has since been
    removed would otherwise put an unknown id into `useRoom`, which is a room
    the server will refuse to build. An id nobody recognises is the same
    situation as a first visit, and gets the same answer.
  */
  const [gameId, setGameId] = useState(() => {
    const last = loadLastGame();
    return last && gameEntry(last) ? last : DEFAULT_GAME_ID;
  });
  const [copied, setCopied] = useState(false);
  const [palette, swapPalette] = usePalette();
  const [sound, toggleSound] = useSound();
  const { push } = toasts;

  // Arriving on a broken link. It reads as an event and not as a state of the
  // form, which is why it is a toast: the remedy -- type the code -- is the
  // screen underneath, and a notice pinned above it was competing with the
  // field it was pointing at.
  useEffect(() => {
    const broken = brokenHashCode();
    if (broken) push(brokenLinkMessage(broken));
  }, [push]);

  useEffect(() => {
    const onHash = () => {
      const next = codeFromHash();
      setCode(next);
      setCreate(false);
      const broken = brokenHashCode();
      if (broken) push(brokenLinkMessage(broken));
      // Without the else, a hash edited to something unusable leaves us with
      // no code, no socket, and no route back to the setup screen.
      setIntent(next ? "play" : "idle");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [push]);

  const {
    room,
    seat,
    status,
    error,
    errorKind,
    errorSeq,
    sendMove,
    requestRematch,
    switchGame,
    startGame,
    dismissError,
  } = useRoom({
      active: intent === "play" && Boolean(name),
      name,
      code,
      create,
      gameId,
    });

  useChannel(room?.gameId ?? gameId);
  useTableSounds(room, seat, errorSeq);

  // What the lobby will open on next time. Written from the room rather than
  // from the pick, so a game somebody else chose still counts as the game you
  // played — arriving on a link is how half the games here start.
  const playing = room?.gameId;
  useEffect(() => {
    if (playing) saveLastGame(playing);
  }, [playing]);

  // The tab, which is the other place the two names are read together — and
  // the one `index.html` cannot write, because it can only ever say what was
  // true before a room was opened.
  const openGame = room?.gameName;
  useEffect(() => {
    document.title = openGame ? `Rebellia Games · ${openGame}` : LOBBY_TITLE;
  }, [openGame]);

  // One way out of a room, shared by the wordmark and the recovery screens, so
  // the hash, the socket and the setup screen can never fall out of step.
  const goHome = () => {
    dismissError();
    history.replaceState(null, "", location.pathname + location.search);
    setCode(null);
    setCreate(false);
    setIntent("idle");
  };

  /*
    Every refusal the server sends becomes one toast, exactly once.

    Keyed on `errorSeq` and not on the message, because two identical
    refusals are two events -- see `useRoom`. `push` and `dismissError` are
    stable, so the effect runs when, and only when, a refusal arrives.

    The second half is the part that used to be a whole screen. A join that
    failed left us retrying a room that was never going to accept us, behind
    a card whose only control was a way back; now the toast carries the
    reason and we take the way back ourselves, which also stops the retry
    loop. `!room` is what distinguishes a *join* failing from a move being
    refused inside a room we are already sitting in.
  */
  useEffect(() => {
    if (errorSeq === 0 || !error) return;
    push(error, errorKind);
    if (!room && !needsWholeScreen(errorKind)) goHome();
    // `error`, `errorKind` and `room` are read at the moment a refusal lands,
    // not watched -- `errorSeq` is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorSeq, push]);

  // Copying the invite is one behaviour with two faces: the code in the
  // topbar, and -- while the room is still filling -- the big code that
  // replaces it. Only ever one of them is on screen, and they must not drift
  // apart, because the confirmation state is shared between them.
  const copyInvite = (roomCode: string) => {
    navigator.clipboard?.writeText(inviteUrl(roomCode));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const swapLabel = PALETTES[otherPalette(palette)].label;

  // The room writes one status for the whole table, so before the deal it
  // names the host: "Ready — Amelia can start whenever you are". Read by
  // everyone else that is exactly right. Read by Amelia it is her own name in
  // the third person, in her own room, telling her about herself.
  //
  // The room cannot fix this — it does not write per-seat — and it should not
  // start, because one status per room is what makes it cheap to broadcast.
  // The client knows which seat it is, so the second person is put back here.
  const statusLine =
    room?.waiting && seat === 0 && room.canStart
      ? "Ready when you are — everyone's here."
      : room?.status;

  if (!name || intent === "idle") {
    return (
      <Setup
        initialName={name}
        pendingCode={code}
        swapLabel={swapLabel}
        onSwapPalette={swapPalette}
        sound={sound}
        onToggleSound={toggleSound}
        lastGameId={gameId}
        onStart={(chosenName, joinCode, chosenGame) => {
          saveName(chosenName);
          setName(chosenName);
          // Null when joining: that room already knows what it is playing, and
          // guessing here would only be a guess the server then corrects.
          if (chosenGame) setGameId(chosenGame);
          // The client picks the code for a new game so the room is
          // addressable from the very first request.
          const target = joinCode ?? makeRoomCode();
          setCreate(joinCode === null);
          setCode(target);
          history.replaceState(null, "", roomUrl(target));
          setIntent("play");
        }}
      />
    );
  }

  // This seat is being played somewhere else. Retrying would take it back off
  // whichever tab has it, which would take it back off us — so we stop, and
  // make continuing here an explicit choice.
  if (status === "superseded") {
    return (
      <main className="app setup">
        <h1 className="wordmark">Playing in another window</h1>
        <p className="tagline">
          You opened this game somewhere else, so this window stopped to stay out of its way.
        </p>
        <button className="primary" onClick={() => location.reload()}>
          Play here instead
        </button>
      </main>
    );
  }

  // The one refusal that is a state rather than a moment. Everything else that
  // can go wrong with a join is a toast over the setup screen, which the
  // effect above sends us back to; this bundle cannot talk to this server at
  // all, so there is nothing behind a toast worth looking at, and "back to the
  // start" would only re-send the same stale hello and fail the same way. The
  // screen asks for a refresh, and the button has to actually be one.
  if (!room && error && needsWholeScreen(errorKind)) {
    return (
      <main className="app setup">
        <h1 className="wordmark">Time for a refresh</h1>
        <p className="tagline">{error}</p>
        <button className="primary" onClick={() => location.reload()}>
          Refresh the page
        </button>
      </main>
    );
  }

  // One source for the connection wording, so the banner and the status line
  // can never disagree — and "connecting" is never dressed up as "reconnecting"
  // to someone who has not been connected yet.
  const connectionNote =
    status === "open" ? null : room ? "Reconnecting…" : "Connecting…";

  return (
    <main className="app">
      <header className="topbar">
        <h1>
          <button type="button" className="home" onClick={goHome} title="Back to the start">
            <TopMark gameName={room?.gameName} />
          </button>
        </h1>
        <div className="room-meta">
          {/* Not while the room is still filling. Down there the code is the
              whole screen -- the thing you read down a phone -- and the same
              four letters twice on one screen reads as two different codes
              for a moment before it reads as one. */}
          {room && !room.waiting && (
            <button
              className="code"
              title="Copy the invite link"
              /* The visible label is the code, which says what this *is* and
                 not what pressing it does. On a mouse the title covers that;
                 on a phone nothing does, and this is the one control the
                 whole waiting state depends on. Both names keep the visible
                 text inside them, so speaking the label still matches what is
                 on screen. */
              aria-label={copied ? "Invite link copied" : `Copy the invite link, room ${room.code}`}
              onClick={() => copyInvite(room.code)}
            >
              {copied ? "Copied" : room.code}
            </button>
          )}
          <SoundButton on={sound} onToggle={toggleSound} />
          {/* Glanceable rather than read, but a colour alone is not available
              to everyone, and a bare title is available to almost nobody --
              not to a screen reader, and not to a finger. `role="img"` names
              it on demand without announcing itself: the banner and the
              status line already say when the connection drops, and a third
              voice saying it would be the same news three times. */}
          <span
            className={`dot ${status}`}
            role="img"
            aria-label={connectionNote ?? "Connected"}
            title={connectionNote ?? "Connected"}
          />
        </div>
      </header>

      {connectionNote && <div className="banner">{connectionNote}</div>}

      {room && (
        <div className="players">
          {room.players.map((p) => (
            <div
              key={p.seat}
              className={[
                "player",
                `p${p.seat}`,
                room.turn === p.seat && !room.waiting ? "active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="chip" />
              <span className="who">{p.name || "Empty seat"}</span>
              {p.seat === seat && <span className="note">you</span>}
              {p.name && !p.connected && <span className="note">away</span>}
            </div>
          ))}
        </div>
      )}

      {/* Announced, not just shown: whose turn it is changes without the
          player touching anything, and a turn-based game can sit for hours.
          The live region stays mounted when the game ends — moving the same
          sentence into the result block below would announce it twice, so the
          result borrows it and this hides. */}
      <p className="status" role="status" aria-live="polite">
        {room?.over ? "" : (statusLine ?? connectionNote ?? "")}
      </p>

      {room?.over && (
        <div className="result">
          <p className="who">{room.status}</p>
        </div>
      )}

      {/* No board until the game is dealt. Before that there is no state to
          draw, and a board improvised out of nothing would be showing the
          player a game that does not exist yet. */}
      {room && !room.waiting ? (
        <GameBoard room={room} seat={seat} sendMove={sendMove} />
      ) : (
        <div className="board placeholder" />
      )}

      {room?.waiting && (
        <>
          {/* The code is the only job on this screen, so it is also the
              control: the thing you read out is the thing you press to send.
              It used to be a plain box sitting next to a copy button in the
              corner, which made the code look like a label rather than the
              one thing worth acting on. */}
          <button type="button" className="bigcode" onClick={() => copyInvite(room.code)}>
            <span className="label">{copied ? "Link copied" : "Room code"}</span>
            <span className="value">{room.code}</span>
            <span className="act">Tap to copy the invite link</span>
          </button>
          <p className="hint">
            Send the link, or read the code out. Whoever turns up gets a seat —
            up to {room.capacity} for {room.gameName}.
          </p>
          {/*
            Somebody has to say when everyone is here, because the room no
            longer knows how many to expect. It is the player who opened it:
            seat 0. Everyone else is told what is being waited for rather than
            being shown a button that would only be refused.
          */}
          {seat === 0 ? (
            <button className="primary" disabled={!room.canStart} onClick={startGame}>
              {room.canStart
                ? `Start with ${room.players.length}`
                : /*
                     Not "waiting for <game>'s minimum": two of the nine games
                     are named with a possessive already, and "Nine Men's
                     Morris's minimum" is a sentence nobody should have to
                     read. The plain version says the same thing and says it
                     the same way for every game.
                  */
                  "Waiting for more players"}
            </button>
          ) : null}
          {/*
            No hint here for anyone but seat 0. It used to say "<host> can
            start whenever you are ready." directly beneath a status line
            already reading "Ready — <host> can start whenever you are": the
            same sentence twice, in two wordings, and — both being polite live
            regions — announced twice as well.
          */}
        </>
      )}

      {room?.over && (
        <>
          <button className="primary" onClick={requestRematch}>
            Play again
          </button>
          <NextGame room={room} onPick={switchGame} />
        </>
      )}
    </main>
  );
}

/**
 * The end of a game is the one moment a room can change what it is playing:
 * everybody is here, nobody is mid-turn, and the alternative is swapping links
 * to reassemble the same people around a different board.
 *
 * Only games that seat exactly this table are offered. The seats are already
 * taken, so a two-handed game in a four-handed room would have to drop two
 * people — better not to offer it than to explain that afterwards. Nothing is
 * shown at all when that leaves no alternatives, rather than an empty shelf.
 */
function NextGame({ room, onPick }: { room: RoomView; onPick(gameId: string): void }) {
  const others = gameList().filter(
    (game) => game.id !== room.gameId && canSeat(game, room.players.length),
  );
  if (others.length === 0) return null;

  return (
    <section className="next-game" aria-labelledby="next-game-heading">
      <h2 id="next-game-heading">Or play something else</h2>
      <div className="games">
        {others.map((game) => (
          <button
            key={game.id}
            className="game"
            data-game={game.id}
            onClick={() => onPick(game.id)}
          >
            <span className="name">{game.name}</span>
          </button>
        ))}
      </div>
      <p className="hint">Same room, same players — the code stays the same.</p>
    </section>
  );
}

/**
 * The board for whatever this room is playing.
 *
 * There is no per-game branching left here: `boardFor` looks the component up
 * in a table the compiler has already checked, so adding a game touches that
 * table and this file not at all. What used to be here was a ten-case switch
 * in which every case cast `room.state` to a game's state type by hand, with
 * nothing checking that the case label and the cast agreed.
 */
function GameBoard({
  room,
  seat,
  sendMove,
}: {
  room: RoomView;
  seat: number | null;
  sendMove(move: unknown): void;
}) {
  // No state means the game is not dealt; no board means this build has never
  // heard of the game — an old tab against a newer server. Neither is a dead
  // end: the status line above still reads.
  const Board = boardFor(room.gameId);
  if (!room.state || !Board) return <div className="board placeholder" />;

  return (
    <Board
      state={room.state as never}
      seat={seat}
      names={room.players.map((p) => p.name)}
      canAct={room.canAct}
      now={room.now}
      onMove={sendMove}
    />
  );
}

/**
 * The sound switch, as an icon, for the top bar.
 *
 * The lobby spells the preference out in words because there is room for words
 * there. In a room there is not, so it becomes a speaker -- with the state in
 * `aria-pressed` and in the label, because "is that speaker crossed out?" is a
 * question a 16px glyph should never be the only answer to.
 */
function SoundButton({ on, onToggle }: { on: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className="mute"
      aria-pressed={on}
      aria-label={`Sound ${on ? "on" : "off"}`}
      title={on ? "Turn sound off" : "Turn sound on"}
      onClick={onToggle}
    >
      {/* One speaker, drawn once: only the waves change, so the two states
          cannot drift apart in size or alignment. */}
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path className="cone" d="M2 6h2.4L7.5 3.2v9.6L4.4 10H2z" />
        {on ? (
          <>
            <path d="M9.9 5.7a3 3 0 0 1 0 4.6" />
            <path d="M11.9 3.8a6 6 0 0 1 0 8.4" />
          </>
        ) : (
          <path d="M10.3 6.3l3.4 3.4M13.7 6.3l-3.4 3.4" />
        )}
      </svg>
    </button>
  );
}

/**
 * One game on the shelf: its table, mid-play, with a way to sit down at it.
 *
 * A button rather than a radio, and that is the whole change to this screen.
 * The card used to pick a game which a button 957px further down then started
 * — so the label that named your choice ("Start Connect Four") was read at the
 * one moment your choice had scrolled off the top. Pressing the table you want
 * is one act instead of two, and it removes the only control on the screen
 * that had to be hunted for.
 *
 * What that costs is the confirmation step, and the answer to a mis-tap is
 * that a room is free: nothing is spent, nobody is told, and the wordmark is
 * the way back. What it saves is the `.picked` state, the Start button, and
 * the two of them having to agree about which game they meant.
 *
 * Every card is its own tab stop, which is what a list of buttons is. No
 * roving tabindex and no `aria-checked`: there is nothing selected here any
 * more, so there is no selection to model.
 */
function TableCard({
  table,
  featured,
  onStart,
}: {
  table: GameEntry;
  featured?: boolean;
  onStart(gameId: string): void;
}) {
  return (
    <button
      className={featured ? "game featured" : "game"}
      data-game={table.id}
      onClick={() => onStart(table.id)}
    >
      <CardArt gameId={table.id} />
      {/* The figure is for the eye, which is comparing it down a column of
          thirteen. The words are for anyone listening, who is not. */}
      <span className="count" aria-hidden="true">
        {seatSummary(table)}
      </span>
      <span className="name">{table.name}</span>
      <span className="sr-only">{seatLabel(table)}</span>
      <span className="blurb">{table.blurb}</span>
      {featured && <span className="resume">Last played</span>}
    </button>
  );
}

function Setup({
  initialName,
  pendingCode,
  swapLabel,
  onSwapPalette,
  sound,
  onToggleSound,
  lastGameId,
  onStart,
}: {
  initialName: string;
  pendingCode: string | null;
  swapLabel: string;
  onSwapPalette(): void;
  sound: boolean;
  onToggleSound(): void;
  lastGameId: string;
  onStart(name: string, code: string | null, gameId: string | null): void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(pendingCode ?? "");
  const nameField = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();

  /*
    The shelf, with the game you last sat down to on top of it.

    Thirteen cards in manifest order gave the art nothing to be bigger than:
    two columns, seven rows, every card the size of every other, and Connect
    Four preselected forever however long it had been since anyone played it.
    One card at twice the size is the whole of the hierarchy this screen needs,
    and "the one you played last" is the only ranking the app can honestly
    claim to know.

    Falling back to the head of the list covers a first visit and a stored id
    from a game that has since been removed — both of which are "no game on
    top", and neither of which is worth an empty frame.
  */
  const tables = gameList();
  const featured = tables.find((game) => game.id === lastGameId) ?? tables[0];
  const rest = tables.filter((game) => game.id !== featured.id);

  // A table cannot be sat down at anonymously, and the field that fixes that
  // is one screen up. Sending the cursor there says so faster than a message
  // would, and it is the same remedy either way.
  const start = (gameId: string) => {
    if (!trimmed) {
      nameField.current?.focus();
      return;
    }
    play("tap");
    onStart(trimmed, null, gameId);
  };

  return (
    <main className="app setup">
      {/* Two wrappers that do nothing at phone width but stack, and become the
          two columns of the desktop layout — see the `@media` block in
          `base.css`. Real flex columns rather than `display: contents`, so the
          spacing inside them does not depend on a property the oldest WebView
          this ships to may not have. */}
      <div className="setup-intro">
        <h1 className="wordmark">
          <Wordmark name="Rebellia Games" />
        </h1>
        <p className="tagline">Two to eight players, one link. No ads, no accounts.</p>

        <label>
          Your name
          <input
            ref={nameField}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Amelia"
            maxLength={20}
            autoFocus
          />
        </label>

        {/* The code, immediately under the name, and above the thirteen cards
          rather than below them.

          Everyone who arrives here with a code in their hand is the second
          player: someone read it out, or sent a link that did not open. They
          are not choosing a game -- their game was chosen for them -- so every
          card between the name field and this row was a card they had to
          scroll past to answer a question they had already answered. Measured
          at 375px it was 1395px down a 1636px page: a full screen and most of
          another, to reach the one control they came for.

          Starting a game keeps the whole run below, in the order it was in.
          The two are one field apart, so nobody hunting the other one has far
          to look. */}
        <div className="joinbar">
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
              placeholder="ABCD"
              className="code-input"
              maxLength={CODE_LENGTH}
              aria-describedby="code-hint"
            />
          </label>
          <button
            disabled={!trimmed || code.length !== CODE_LENGTH}
            onClick={() => onStart(trimmed, code, null)}
          >
            Join
          </button>
        </div>
        <p className="hint" id="code-hint">
          {CODE_LENGTH} letters, from the link or read out to you.
        </p>
      </div>

      {/* The divider is the shelf's heading rather than a rule with words in
          it, so the label the eye reads and the label a screen reader
          announces are the same string. */}
      <section className="setup-tables" aria-labelledby="tables-heading">
        <h2 className="divider" id="tables-heading">
          <span>or pick a table</span>
        </h2>

        <div className="games">
          <TableCard table={featured} featured onStart={start} />
          {rest.map((game) => (
            <TableCard key={game.id} table={game} onStart={start} />
          ))}
        </div>
      </section>

      <div className="preferences">
        <button className="swap" onClick={onSwapPalette}>
          {swapLabel}
        </button>
        <button
          className="swap"
          aria-pressed={sound}
          onClick={onToggleSound}
        >
          Sound {sound ? "on" : "off"}
        </button>
      </div>
    </main>
  );
}
