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
import { Connect4Board } from "./games/Connect4Board.js";
import { BackgammonBoard, BackgammonStatus } from "./games/BackgammonBoard.js";
import { WheelBoard } from "./games/WheelBoard.js";
import { WordleBoard } from "./games/WordleBoard.js";
import { inviteUrl, loadName, saveName, useRoom } from "./net.js";
import type { ErrorKind, RoomView } from "../shared/protocol.js";
import {
  applyPalette,
  loadPalette,
  otherPalette,
  PALETTES,
  type Palette,
} from "./palette.js";

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
        <h1>{room?.gameName ?? "Amelia's Games"}</h1>
        <div className="room-meta">
          <button className="swap" onClick={swapPalette}>
            {swapLabel}
          </button>
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
          player touching anything, and a turn-based game can sit for hours. */}
      <p className="status" role="status" aria-live="polite">
        {room?.status ?? connectionNote ?? ""}
      </p>

      {room ? (
        <GameBoard room={room} seat={seat} myTurn={myTurn} sendMove={sendMove} />
      ) : (
        <div className="board placeholder" />
      )}

      {room?.waiting && (
        <p className="hint">
          Send the link, or read out the code{" "}
          <span className="said-code">{room.code}</span>.
        </p>
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
      <h1 className="wordmark">Amelia's Games</h1>
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
          <label key={game.id} className={game.id === gameId ? "game picked" : "game"}>
            <input
              type="radio"
              name="game"
              value={game.id}
              checked={game.id === gameId}
              onChange={() => onPickGame(game.id)}
            />
            {game.name}
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

      <button className="primary" disabled={!trimmed} onClick={() => onStart(trimmed, null)}>
        Start a new game
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
