import { useEffect, useState } from "react";
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
import type { C4State } from "../shared/games/connect4.js";
import type { BgState } from "../shared/games/backgammon.js";
import type { WofState } from "../shared/games/wheel.js";
// Type-only, so no reducer and no word list follow it into the bundle.
import type { WordleState } from "../shared/games/wordleDisplay.js";
import type { YState } from "../shared/games/yahtzeeDisplay.js";
import type { BsState } from "../shared/games/battleshipDisplay.js";
import type { LdState } from "../shared/games/liarsDiceDisplay.js";
import type { WhState } from "../shared/games/wordHuntDisplay.js";
import { Connect4Board } from "./games/Connect4Board.js";
import { BackgammonGame } from "./games/BackgammonBoard.js";
import { WheelBoard } from "./games/WheelBoard.js";
import { WordleBoard } from "./games/WordleBoard.js";
import { YahtzeeBoard } from "./games/YahtzeeBoard.js";
import { BattleshipBoard } from "./games/BattleshipBoard.js";
import { LiarsDiceBoard } from "./games/LiarsDiceBoard.js";
import { WordHuntBoard } from "./games/WordHuntBoard.js";
import { Die } from "./games/Die.js";
import { WEDGE_COUNT, sectorPath } from "./games/wheelGeometry.js";
import { inviteUrl, loadName, saveName, useRoom } from "./net.js";
import type { ErrorKind, RoomView } from "../shared/protocol.js";
import {
  applyChannel,
  applyPalette,
  loadPalette,
  otherPalette,
  PALETTES,
  type Palette,
} from "./palette.js";
import { applySound, loadSound } from "./feel.js";

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
            className={i === 22 ? "wedge cash" : i === 2 ? "wedge lose" : "wedge"}
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
 * The motif on a game's card: a crop of that game's own table, mid-play.
 *
 * Pieces rather than artwork, because the Android build ships offline with no
 * image assets and a disc grid says "Connect Four" more honestly than an
 * illustration would. A crop rather than an emblem, because the same pieces
 * shrunk to the middle of the well read as a specimen mounted on card instead
 * of a game being played.
 *
 * Most of these are a count and nothing more, laid out and coloured by
 * nth-child in the stylesheet. Three are not: the Wheel needs arcs, which CSS
 * cannot cut without a gradient; Word Hunt needs its letters; and the two dice
 * games use the real `Die`, so their faces are the six the rest of the app
 * draws rather than a dot standing in for a pip.
 *
 * The rules all eight follow, and the register of which game owns which shape,
 * are in `docs/card-motifs.md`. Read it before adding a ninth.
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
    // Ten points, opposed as they are on a board. The <b>s are checkers: they
    // sit over the triangles, which are clipped and cannot hold anything.
    case "backgammon":
      return (
        <>
          {pieces(20)}
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
    // A full house, as tidy as the sheet wants it.
    case "yahtzee":
      return [3, 3, 3, 5, 5].map((value, i) => <Die key={i} value={value} label="" />);
    // Your hand, and a hand that is somebody else's business.
    case "liarsdice":
      return (
        <>
          <span>
            {[4, 2, 4, 6, 4].map((value, i) => (
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
    // A game the manifest knows and this file does not. An empty well reads as
    // a card with no picture, which is better than a card with a wrong one.
    default:
      return null;
  }
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
function hashIsBroken(): boolean {
  const raw = location.hash.slice(1);
  return raw.length > 0 && !isRoomCode(raw.toUpperCase());
}

/** "Gone" is only right for one of these. */
function joinFailureHeading(kind: ErrorKind | null): string {
  if (kind === "no-room") return "That game has gone";
  if (kind === "full") return "That game is full";
  if (kind === "started") return "They have already started";
  if (kind === "protocol") return "Time for a refresh";
  return "Couldn't join that game";
}

/** The card's second line: how many can play, in as few words as it takes. */
function seatSummary(table: GameEntry): string {
  return table.minPlayers === table.maxPlayers
    ? `${table.minPlayers} players`
    : `${table.minPlayers}–${table.maxPlayers} players`;
}

function usePalette(): [Palette, () => void] {
  const [palette, setPalette] = useState<Palette>(loadPalette);
  useEffect(() => applyPalette(palette), [palette]);
  return [palette, () => setPalette((current) => otherPalette(current))];
}

/**
 * Whether the dice make a noise, remembered like the palette is.
 *
 * Off until asked for. A dice game that is silent is missing half of itself,
 * and a page that makes a noise the first time you open it on a bus is a page
 * you close — so the switch sits beside the palette switch, where it is found
 * rather than buried, and the first sound anyone hears is one they asked for.
 */
function useSound(): [boolean, () => void] {
  const [sound, setSound] = useState<boolean>(loadSound);
  useEffect(() => applySound(sound), [sound]);
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

export function App() {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState<string | null>(codeFromHash);
  const [intent, setIntent] = useState<"idle" | "play">(codeFromHash() ? "play" : "idle");
  const [create, setCreate] = useState(false);
  const [gameId, setGameId] = useState(DEFAULT_GAME_ID);
  const [copied, setCopied] = useState(false);
  const [linkProblem, setLinkProblem] = useState(hashIsBroken);
  const [palette, swapPalette] = usePalette();
  const [sound, toggleSound] = useSound();

  const table = gameEntry(gameId);

  useEffect(() => {
    const onHash = () => {
      const next = codeFromHash();
      setCode(next);
      setCreate(false);
      setLinkProblem(hashIsBroken());
      // Without the else, a hash edited to something unusable leaves us with
      // no code, no socket, and no route back to the setup screen.
      setIntent(next ? "play" : "idle");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const {
    room,
    seat,
    status,
    error,
    errorKind,
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

  // One way out of a room, shared by the wordmark and the recovery screens, so
  // the hash, the socket and the setup screen can never fall out of step.
  const goHome = () => {
    dismissError();
    history.replaceState(null, "", location.pathname + location.search);
    setCode(null);
    setCreate(false);
    setIntent("idle");
  };

  const swapLabel = PALETTES[otherPalette(palette)].label;

  if (!name || intent === "idle") {
    return (
      <Setup
        initialName={name}
        pendingCode={code}
        linkProblem={linkProblem}
        swapLabel={swapLabel}
        onSwapPalette={swapPalette}
        sound={sound}
        onToggleSound={toggleSound}
        gameId={gameId}
        onPickGame={setGameId}
        table={table}
        onStart={(chosenName, joinCode) => {
          saveName(chosenName);
          setName(chosenName);
          // The client picks the code for a new game so the room is
          // addressable from the very first request.
          const target = joinCode ?? makeRoomCode();
          setCreate(joinCode === null);
          setCode(target);
          setLinkProblem(false);
          history.replaceState(null, "", `#${target}${location.search}`);
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

  // A code that no longer exists (server restart, expired room) would
  // otherwise leave us retrying a dead room forever.
  if (!room && error) {
    return (
      <main className="app setup">
        <h1 className="wordmark">{joinFailureHeading(errorKind)}</h1>
        <p className="tagline">{error}</p>
        {/*
          A protocol error means this bundle is out of date, so going "back to
          the start" would only re-send the same stale hello and fail the same
          way. The screen asks for a refresh; the button has to actually be one.
        */}
        {errorKind === "protocol" ? (
          <button className="primary" onClick={() => location.reload()}>
            Refresh the page
          </button>
        ) : (
          <button
            className="primary"
            onClick={goHome}
          >
            Back to the start
          </button>
        )}
      </main>
    );
  }

  // One source for the connection wording, so the banner and the status line
  // can never disagree — and "connecting" is never dressed up as "reconnecting"
  // to someone who has not been connected yet.
  const connectionNote =
    status === "open" ? null : room ? "Reconnecting…" : "Connecting…";

  const myTurn = room !== null && seat !== null && room.turn === seat && !room.waiting;

  return (
    <main className="app">
      <header className="topbar">
        <h1>
          <button type="button" className="home" onClick={goHome} title="Back to the start">
            <Wordmark name={room?.gameName ?? "Rebellia Games"} />
          </button>
        </h1>
        <div className="room-meta">
          {room && (
            <button
              className="code"
              title="Copy the invite link"
              onClick={() => {
                navigator.clipboard?.writeText(inviteUrl(room.code));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : room.code}
            </button>
          )}
          <span className={`dot ${status}`} title={connectionNote ?? "Connected"} />
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button type="button" className="dismiss" onClick={dismissError}>
            Dismiss
          </button>
        </div>
      )}

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
        {room?.over ? "" : (room?.status ?? connectionNote ?? "")}
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
        <GameBoard room={room} seat={seat} myTurn={myTurn} sendMove={sendMove} />
      ) : (
        <div className="board placeholder" />
      )}

      {room?.waiting && (
        <>
          <div className="bigcode">
            <span className="label">Room code</span>
            <span className="value">{room.code}</span>
          </div>
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
                : `Waiting for ${room.gameName}'s minimum`}
            </button>
          ) : (
            <p className="hint" aria-live="polite">
              {room.canStart
                ? `${room.players[0]?.name || "The host"} can start whenever you are ready.`
                : "Waiting for more players."}
            </p>
          )}
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
            <span className="stripe" />
          </button>
        ))}
      </div>
      <p className="hint">Same room, same players — the code stays the same.</p>
    </section>
  );
}

/**
 * The one place that knows which board goes with which game. Everything above
 * it — the lobby, seating, reconnection, the rematch — is game-agnostic, so
 * adding a game adds a case here and nothing else.
 */
function GameBoard({
  room,
  seat,
  myTurn,
  sendMove,
}: {
  room: RoomView;
  seat: number | null;
  myTurn: boolean;
  sendMove(move: unknown): void;
}) {
  if (!room.state) return <div className="board placeholder" />;

  switch (room.gameId) {
    case "backgammon":
      // One component for board and controls: they share whether the dice
      // have stopped, and two copies of that could disagree.
      return (
        <BackgammonGame
          state={room.state as BgState}
          seat={seat}
          myTurn={myTurn}
          onMove={sendMove}
        />
      );
    case "wheel":
      return (
        <WheelBoard
          state={room.state as WofState}
          seat={seat}
          names={room.players.map((p) => p.name)}
          myTurn={myTurn}
          onMove={sendMove}
        />
      );
    case "wordle":
      // No `myTurn`: Word Duel is free-simultaneous, so whether this player
      // may type is a question only the board's own `canAct` can answer.
      return (
        <WordleBoard
          state={room.state as WordleState}
          seat={seat}
          names={room.players.map((p) => p.name)}
          now={room.now}
          onMove={sendMove}
        />
      );
    case "wordhunt":
      // No `myTurn`: everyone hunts the same grid at once, so only the
      // board's own `canAct` knows whether this player may still trace.
      return (
        <WordHuntBoard
          state={room.state as WhState}
          seat={seat}
          names={room.players.map((p) => p.name)}
          now={room.now}
          onMove={sendMove}
        />
      );
    case "battleship":
      // No `myTurn`: placing is free-simultaneous and firing alternates, so
      // only the board's own `canAct` is right in both halves of the game.
      return (
        <BattleshipBoard
          state={room.state as BsState}
          seat={seat}
          names={room.players.map((p) => p.name)}
          onMove={sendMove}
        />
      );
    case "yahtzee":
      return (
        <YahtzeeBoard
          state={room.state as YState}
          seat={seat}
          names={room.players.map((p) => p.name)}
          myTurn={myTurn}
          onMove={sendMove}
        />
      );
    case "liarsdice":
      return (
        <LiarsDiceBoard
          state={room.state as LdState}
          seat={seat}
          names={room.players.map((p) => p.name)}
          myTurn={myTurn}
          onMove={sendMove}
        />
      );
    case "connect4":
      return (
        <Connect4Board
          state={room.state as C4State}
          myTurn={myTurn}
          onDrop={(col) => sendMove({ type: "drop", col })}
        />
      );
    // A room for a game this build has no board for — an old tab against a
    // newer server. The status line still reads, so it is not a dead end.
    default:
      return <div className="board placeholder" />;
  }
}

function Setup({
  initialName,
  pendingCode,
  linkProblem,
  swapLabel,
  onSwapPalette,
  sound,
  onToggleSound,
  gameId,
  onPickGame,
  table,
  onStart,
}: {
  initialName: string;
  pendingCode: string | null;
  linkProblem: boolean;
  swapLabel: string;
  onSwapPalette(): void;
  sound: boolean;
  onToggleSound(): void;
  gameId: string;
  onPickGame(id: string): void;
  table: GameEntry | undefined;
  onStart(name: string, code: string | null): void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(pendingCode ?? "");
  const trimmed = name.trim();

  return (
    <main className="app setup">
      <h1 className="wordmark">
        <Wordmark name="Rebellia Games" />
      </h1>
      <p className="tagline">Two to eight players, one link. No ads, no accounts.</p>

      {linkProblem && (
        <p className="banner error" role="alert">
          That link doesn't look complete — ask for it again, or type the room code below.
        </p>
      )}

      <label>
        Your name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Amelia"
          maxLength={20}
          autoFocus
        />
      </label>

      <fieldset className="games">
        <legend>Game</legend>
        {gameList().map((game) => (
          <label
            key={game.id}
            className={game.id === gameId ? "game picked" : "game"}
            data-game={game.id}
          >
            <input
              type="radio"
              name="game"
              value={game.id}
              checked={game.id === gameId}
              onChange={() => onPickGame(game.id)}
            />
            <CardArt gameId={game.id} />
            <span className="name">{game.name}</span>
            <span className="meta">{seatSummary(game)}</span>
            <span className="stripe" />
          </label>
        ))}
      </fieldset>

      {/* Names the game you are about to start, so the card you picked and the
          button you press say the same thing. */}
      <button className="primary" disabled={!trimmed} onClick={() => onStart(trimmed, null)}>
        {table ? `Start ${table.name}` : "Start a new game"}
      </button>

      <div className="divider">
        <span>or join one</span>
      </div>

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
      <p className="hint" id="code-hint">
        {CODE_LENGTH} letters, from the link or read out to you.
      </p>

      <button
        disabled={!trimmed || code.length !== CODE_LENGTH}
        onClick={() => onStart(trimmed, code)}
      >
        Join game
      </button>

      <div className="preferences">
        <button className="swap" onClick={onSwapPalette}>
          {swapLabel}
        </button>
        <button
          className="swap"
          aria-pressed={sound}
          onClick={onToggleSound}
        >
          Dice sound {sound ? "on" : "off"}
        </button>
      </div>
    </main>
  );
}
