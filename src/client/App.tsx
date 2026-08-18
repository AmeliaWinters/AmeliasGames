import { useEffect, useState } from "react";
import { DEFAULT_GAME_ID, gameList } from "../shared/games/index.js";
import { makeRoomCode } from "../shared/room.js";
import type { C4State } from "../shared/games/connect4.js";
import type { BgState } from "../shared/games/backgammon.js";
import { Connect4Board } from "./games/Connect4Board.js";
import { BackgammonBoard, BackgammonStatus } from "./games/BackgammonBoard.js";
import { inviteUrl, loadName, saveName, useRoom } from "./net.js";
import {
  applyPalette,
  loadPalette,
  otherPalette,
  PALETTES,
  type Palette,
} from "./palette.js";

function codeFromHash(): string | null {
  const raw = location.hash.slice(1).toUpperCase();
  return /^[A-Z0-9]{4}$/.test(raw) ? raw : null;
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
  const [copied, setCopied] = useState(false);
  const [palette, swapPalette] = usePalette();

  useEffect(() => {
    const onHash = () => {
      const next = codeFromHash();
      setCode(next);
      setCreate(false);
      if (next) setIntent("play");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const { room, seat, status, error, sendMove, requestRematch, dismissError } = useRoom({
    active: intent === "play" && Boolean(name),
    name,
    code,
    create,
    gameId,
  });

  const swapLabel = PALETTES[otherPalette(palette)].label;

  if (!name || intent === "idle") {
    return (
      <Setup
        initialName={name}
        pendingCode={code}
        swapLabel={swapLabel}
        onSwapPalette={swapPalette}
        gameId={gameId}
        onPickGame={setGameId}
        onStart={(chosenName, joinCode) => {
          saveName(chosenName);
          setName(chosenName);
          // The client picks the code for a new game so the room is
          // addressable from the very first request.
          const target = joinCode ?? makeRoomCode();
          setCreate(joinCode === null);
          setCode(target);
          history.replaceState(null, "", `#${target}${location.search}`);
          setIntent("play");
        }}
      />
    );
  }

  // A code that no longer exists (server restart, expired room) would
  // otherwise leave us retrying a dead room forever.
  if (!room && error) {
    return (
      <main className="app setup">
        <h1 className="wordmark">That game has gone</h1>
        <p className="tagline">{error}</p>
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
      </main>
    );
  }

  const state = room?.gameId === "connect4" ? (room.state as C4State) : undefined;
  const myTurn = room !== null && seat !== null && room.turn === seat && !room.waiting;

  return (
    <main className="app">
      <header className="topbar">
        <h1>{room?.gameName ?? "Connect Four"}</h1>
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
          <span
            className={`dot ${status}`}
            title={status === "open" ? "Connected" : "Reconnecting"}
          />
        </div>
      </header>

      {error && (
        <div className="banner error" onClick={dismissError} role="alert">
          <span>{error}</span>
          <span className="dismiss">Dismiss</span>
        </div>
      )}

      {status !== "open" && <div className="banner">Reconnecting…</div>}

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

      <p className="status">{room?.status ?? "Connecting…"}</p>

      {room?.gameId === "backgammon" && room.state ? (
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
      ) : state ? (
        <Connect4Board
          state={state}
          myTurn={myTurn}
          onDrop={(col) => sendMove({ type: "drop", col })}
        />
      ) : (
        <div className="board placeholder" />
      )}

      {room?.waiting && (
        <p className="hint">
          Send them the link, or read out the code{" "}
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

function Setup({
  initialName,
  pendingCode,
  swapLabel,
  onSwapPalette,
  gameId,
  onPickGame,
  onStart,
}: {
  initialName: string;
  pendingCode: string | null;
  swapLabel: string;
  onSwapPalette(): void;
  gameId: string;
  onPickGame(id: string): void;
  onStart(name: string, code: string | null): void;
}) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(pendingCode ?? "");
  const trimmed = name.trim();

  return (
    <main className="app setup">
      <h1 className="wordmark">Amelia's Games</h1>
      <p className="tagline">Two players, one link. No ads, no accounts.</p>

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
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
          placeholder="ABCD"
          className="code-input"
        />
      </label>

      <button disabled={!trimmed || code.length !== 4} onClick={() => onStart(trimmed, code)}>
        Join game
      </button>

      <button className="swap" onClick={onSwapPalette}>
        {swapLabel}
      </button>
    </main>
  );
}
