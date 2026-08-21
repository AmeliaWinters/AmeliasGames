import { useEffect, useState } from "react";
// The manifest, not the registry: the lobby needs ids and names, and importing
// the registry here would pull every reducer into the client bundle.
import {
  DEFAULT_GAME_ID,
  clampSeats,
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
import { Connect4Board } from "./games/Connect4Board.js";
import { BackgammonBoard, BackgammonStatus } from "./games/BackgammonBoard.js";
import { WheelBoard } from "./games/WheelBoard.js";
import { WordleBoard } from "./games/WordleBoard.js";
import { YahtzeeBoard } from "./games/YahtzeeBoard.js";
import { BattleshipBoard } from "./games/BattleshipBoard.js";
import { LiarsDiceBoard } from "./games/LiarsDiceBoard.js";
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

/**
 * A name in two parts, so the channel colour can land on the second half.
 *
 * Splitting at the last space is what makes "Amelia's Games" and "Wheel of
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
 * The motif on a game's card: its own pieces, in CSS, rather than artwork.
 * Only the Wheel's tiles carry text — the rest are coloured by nth-child in
 * the stylesheet, so this is a count and nothing more.
 */
function CardArt({ gameId }: { gameId: string }) {
  if (gameId === "wheel") {
    return (
      <span className="art art-wheel" aria-hidden="true">
        <i>W</i>
        <i />
        <i>E</i>
        <i />
      </span>
    );
  }
  const pieces =
    gameId === "connect4"
      ? 12
      : gameId === "backgammon"
        ? 6
        : gameId === "battleship"
          ? 9
          : gameId === "liarsdice"
            ? 3
            : 5;
  return (
    <span className={`art art-${gameId}`} aria-hidden="true">
      {Array.from({ length: pieces }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
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
  if (kind === "protocol") return "Time for a refresh";
  return "Couldn't join that game";
}

/** The card's second line: how many can play, in as few words as it takes. */
function seatSummary(table: GameEntry): string {
  return table.minPlayers === table.maxPlayers
    ? `${table.minPlayers} players`
    : `${table.minPlayers}–${table.maxPlayers} players`;
}

/** Every table size a game will seat, smallest first. */
function seatOptions(table: GameEntry): number[] {
  return Array.from(
    { length: table.maxPlayers - table.minPlayers + 1 },
    (_, i) => table.minPlayers + i,
  );
}

function usePalette(): [Palette, () => void] {
  const [palette, setPalette] = useState<Palette>(loadPalette);
  useEffect(() => applyPalette(palette), [palette]);
  return [palette, () => setPalette((current) => otherPalette(current))];
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
  // A preference rather than a setting: it is remembered while you look at
  // other games, and clamped to whatever the one you settle on can seat, so
  // there is no stale value to keep in step with the picker.
  const [preferredSeats, setPreferredSeats] = useState(2);
  const [copied, setCopied] = useState(false);
  const [linkProblem, setLinkProblem] = useState(hashIsBroken);
  const [palette, swapPalette] = usePalette();

  const table = gameEntry(gameId);
  const seats = table ? clampSeats(table, preferredSeats) : preferredSeats;

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

  const { room, seat, status, error, errorKind, sendMove, requestRematch, dismissError } = useRoom({
    active: intent === "play" && Boolean(name),
    name,
    code,
    create,
    gameId,
    players: seats,
  });

  useChannel(room?.gameId ?? gameId);

  const swapLabel = PALETTES[otherPalette(palette)].label;

  if (!name || intent === "idle") {
    return (
      <Setup
        initialName={name}
        pendingCode={code}
        linkProblem={linkProblem}
        swapLabel={swapLabel}
        onSwapPalette={swapPalette}
        gameId={gameId}
        onPickGame={setGameId}
        table={table}
        seats={seats}
        onPickSeats={setPreferredSeats}
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
            onClick={() => {
              dismissError();
              history.replaceState(null, "", location.pathname + location.search);
              setCode(null);
              setCreate(false);
              setIntent("idle");
            }}
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
          <Wordmark name={room?.gameName ?? "Amelia's Games"} />
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

      {room ? (
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
            Send the link, or read the code out. The game starts the moment they
            arrive.
          </p>
        </>
      )}

      {room?.over && (
        <button className="primary" onClick={requestRematch}>
          Play again
        </button>
      )}
    </main>
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
      return (
        <>
          <BackgammonBoard
            state={room.state as BgState}
            seat={seat}
            myTurn={myTurn}
            onMove={sendMove}
          />
          <BackgammonStatus
            state={room.state as BgState}
            seat={seat}
            myTurn={myTurn}
            onRoll={() => sendMove({ type: "roll" })}
            onPass={() => sendMove({ type: "pass" })}
          />
        </>
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
  gameId,
  onPickGame,
  table,
  seats,
  onPickSeats,
  onStart,
}: {
  initialName: string;
  pendingCode: string | null;
  linkProblem: boolean;
  swapLabel: string;
  onSwapPalette(): void;
  gameId: string;
  onPickGame(id: string): void;
  table: GameEntry | undefined;
  seats: number;
  onPickSeats(count: number): void;
  onStart(name: string, code: string | null): void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(pendingCode ?? "");
  const trimmed = name.trim();

  return (
    <main className="app setup">
      <h1 className="wordmark">
        <Wordmark name="Amelia's Games" />
      </h1>
      <p className="tagline">Two to four players, one link. No ads, no accounts.</p>

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

      {/* Only for the games that play a range — a picker offering one choice
          is a decision the player does not have. */}
      {table && table.maxPlayers > table.minPlayers && (
        <fieldset className="games seats">
          <legend>Players</legend>
          {seatOptions(table).map((count) => (
            <label key={count} className={count === seats ? "game picked" : "game"}>
              <input
                type="radio"
                name="players"
                value={count}
                checked={count === seats}
                onChange={() => onPickSeats(count)}
              />
              {count}
            </label>
          ))}
        </fieldset>
      )}

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
          placeholder="ABCDEF"
          className="code-input"
          maxLength={CODE_LENGTH}
          aria-describedby="code-hint"
        />
      </label>
      <p className="hint" id="code-hint">
        {CODE_LENGTH} letters and numbers, from the link or read out to you.
      </p>

      <button
        disabled={!trimmed || code.length !== CODE_LENGTH}
        onClick={() => onStart(trimmed, code)}
      >
        Join game
      </button>

      <button className="swap" onClick={onSwapPalette}>
        {swapLabel}
      </button>
    </main>
  );
}
