import { useEffect, useRef, useState } from "react";
// Values from wordHuntDisplay.js, which imports nothing — the board must never
// pull the reducer (and the word list with it) into the client bundle. The
// types below are type-only, so they are erased and carry no runtime import.
import {
  GRID_SIZE,
  MIN_WORD,
  canAct,
  canExtend,
  countOf,
  formatClock,
  hasStarted,
  isMasked,
  msLeft,
  scoreOf,
  spell,
  wordScore,
} from "../../shared/games/wordHuntDisplay.js";
import type { WhMove, WhState } from "../../shared/games/wordHuntDisplay.js";

interface Props {
  state: WhState;
  seat: number | null;
  names: string[];
  /** The server's clock as of this state — see `useCountdown`. */
  now: number;
  onMove(move: WhMove): void;
}

/** Under this much left, the clock starts shouting about it. */
const URGENT_MS = 20 * 1000;

/**
 * Milliseconds left, ticking, measured against the server's clock rather than
 * this device's.
 *
 * The deadline is a server timestamp, so counting down to it with a local
 * `Date.now()` shows the wrong number on any device whose clock is off — and
 * phones are off by minutes more often than you would hope. Every state
 * message carries the server's time, so the gap between the two clocks is
 * remeasured whenever one arrives and the skew cancels out.
 *
 * This only ever decides what the player *sees*. Whether a word counts is the
 * server's business, and it has already made up its mind by the time this runs.
 */
function useCountdown(state: WhState, serverNow: number): number {
  const skew = useRef(0);
  const [left, setLeft] = useState(() => msLeft(state, serverNow));

  useEffect(() => {
    skew.current = serverNow - Date.now();
  }, [serverNow]);

  useEffect(() => {
    const read = () => setLeft(msLeft(state, Date.now() + skew.current));
    read();
    if (state.phase !== "play") return;
    // Four times a second: fast enough that the seconds never visibly stick,
    // cheap enough not to matter.
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [state, serverNow]);

  return left;
}

/**
 * Note the absence of `myTurn`. Everyone hunts the same grid at the same time,
 * so `room.turn` says nothing about whether *you* may drag — `canAct` does.
 *
 * The one interaction here is tracing a word, and it has to work three ways:
 * dragging a finger, dragging a mouse, and tapping cell by cell. They are the
 * same gesture underneath — cells are appended to a path — and they end the
 * same way too: lifting a finger submits, and so does the button the tapping
 * player presses, which is also the one a keyboard reaches. Words run from
 * three letters to eight, so there is no length at which a trace can submit
 * itself; something has to say "that is the word", and that is the lift.
 */

/** The cell under a point, for touch: pointerenter does not fire mid-drag. */
function cellUnder(x: number, y: number): number | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest<HTMLElement>("[data-cell]");
  if (!cell) return null;
  const index = Number(cell.dataset.cell);
  return Number.isInteger(index) ? index : null;
}

export function WordHuntBoard({ state, seat, names, now, onMove }: Props) {
  const [path, setPath] = useState<number[]>([]);
  const grid = useRef<HTMLDivElement>(null);
  /*
    A ref rather than state, and that is not an optimisation. The first
    pointermove of a fast flick arrives in the same frame as the pointerdown
    that started it, before React has re-rendered with the new value — so a
    `dragging` held in state reads false in that handler and the trace loses
    its second letter. Nothing renders from this, so a ref is also honest
    about what it is.
  */
  const dragging = useRef(false);

  const left = useCountdown(state, now);
  const mine = seat !== null;
  const started = hasStarted(state);
  // The clock closes the grid the moment it reads zero, rather than a
  // round-trip later — the server has already stopped taking words by then,
  // and a grid that still accepts traces is a grid promising something it
  // cannot deliver. It is shut before the off for the same reason: the room
  // turns every move away until it is full, so a grid that took traces would
  // be answering each one with an error.
  const myMove = mine && started && canAct(state, seat) && left > 0;
  const over = state.phase === "over";

  // A half-drawn word means nothing once the game has moved on underneath it.
  useEffect(() => {
    if (!myMove) {
      setPath([]);
      dragging.current = false;
    }
  }, [myMove]);

  const nameFor = (index: number) =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;

  function extend(cell: number) {
    if (!myMove) return;
    setPath((current) => {
      // Back onto the previous cell undoes the last step, which is how every
      // trace-a-word game lets you correct a slip without starting over.
      if (current.length >= 2 && cell === current[current.length - 2]) {
        return current.slice(0, -1);
      }
      return canExtend(current, cell) ? current.concat(cell) : current;
    });
  }

  /**
   * Send the traced word, if it is long enough to be one. A trace too short to
   * be a word is dropped rather than refused: it is almost always a tap that
   * landed on the grid on the way to somewhere else, and an error for that
   * would be the app telling the player off for touching it.
   */
  function submit() {
    setPath((current) => {
      if (current.length >= MIN_WORD) onMove({ type: "found", path: current });
      return [];
    });
  }

  const word = spell(state.grid, path);
  const worth = word.length >= MIN_WORD ? wordScore(word) : 0;

  return (
    <div className="board wh-board">
      {!over && (
        <p
          className={[
            "wh-clock",
            started && left <= URGENT_MS ? "urgent" : "",
            started && left === 0 ? "done" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          // Announced at the half-minute rather than every tick: a countdown
          // read out four times a second is unusable with a screen reader on.
          role="timer"
          aria-live="off"
        >
          <span className="wh-clock-face">{left === 0 ? "Time" : formatClock(left)}</span>
          <span className="wh-clock-note">
            {!started ? "on the whistle" : left === 0 ? "pencils down" : "left"}
          </span>
        </p>
      )}

      <div className="wh-scores" role="list" aria-label="Scores">
        {state.found.map((words, side) => {
          const count = countOf(state, side);
          return (
            <span
              className={side === seat ? "wh-score mine" : "wh-score"}
              role="listitem"
              key={side}
            >
              <span className="wh-who">{nameFor(side)}</span>
              <span className="wh-tally">{scoreOf(state, side)}</span>
              <span className="wh-words">{count === 1 ? "1 word" : `${count} words`}</span>
              {state.done[side] && !over && <span className="wh-flag">done</span>}
            </span>
          );
        })}
      </div>

      {/*
        The grid is the game and it is open to everyone: the same sixteen
        letters, and the hunt is what you can see in them. A cell is a button
        so the whole thing is reachable by tab and space, not only by finger.
      */}
      <div
        className="wh-grid"
        ref={grid}
        style={{ ["--wh-size" as string]: GRID_SIZE }}
        onPointerDown={(event) => {
          if (!myMove) return;
          const cell = cellUnder(event.clientX, event.clientY);
          if (cell === null) return;
          // Capture on the container, so a finger that leaves the grid and
          // comes back is still the same trace.
          grid.current?.setPointerCapture(event.pointerId);
          dragging.current = true;
          setPath([]);
          extend(cell);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          const cell = cellUnder(event.clientX, event.clientY);
          if (cell !== null) extend(cell);
        }}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          submit();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setPath([]);
        }}
      >
        {state.grid.map((letter, cell) => {
          const step = path.indexOf(cell);
          return (
            <button
              type="button"
              key={cell}
              data-cell={cell}
              className={step === -1 ? "wh-cell" : "wh-cell picked"}
              disabled={!myMove}
              // The pointer path above handles the drag; this is the tap and
              // the keypress, which land as a click either way.
              onClick={() => extend(cell)}
              aria-label={
                step === -1
                  ? letter
                  : `${letter}, letter ${step + 1} of the word you are tracing`
              }
            >
              {letter}
            </button>
          );
        })}
      </div>

      {/* Gone once you have stopped, rather than sitting there greyed out:
          there is nothing left to trace, and the line below says so. */}
      {myMove && (
        <div className="wh-tray">
          {/*
            The letters so far and what they are worth, in a box that is always
            there. A line that appeared and vanished would shove the grid up and
            down under a finger that is mid-trace.
          */}
          <p className="wh-draft" aria-live="polite">
            {word || `Trace a word — ${MIN_WORD} letters or more`}
            {worth > 0 && <span className="wh-worth">{worth}</span>}
          </p>
          <button
            type="button"
            className="wh-take"
            disabled={path.length < MIN_WORD}
            onClick={submit}
          >
            Take it
          </button>
          <button
            type="button"
            className="wh-clear"
            disabled={path.length === 0}
            onClick={() => setPath([])}
          >
            Clear
          </button>
          <button
            type="button"
            className="wh-done"
            onClick={() => onMove({ type: "done" })}
          >
            I&apos;m done
          </button>
        </div>
      )}

      {mine && !myMove && !over && (
        <p className="wh-waiting" aria-live="polite">
          {!started
            ? "The clock starts when everyone is here."
            : left === 0
              ? "Time is up. Counting the scores…"
              : "You are done. Waiting for the others to finish."}
        </p>
      )}

      {/*
        Your own words while the game runs; everyone's once it ends. An
        opponent's arrive masked until then — as long as the word was, so you
        can watch their score climb, which is the tension, without being handed
        the words themselves.
      */}
      <div className="wh-lists">
        {state.found.map((words, side) =>
          side !== seat && !over ? null : (
            <section className="wh-list" key={side}>
              <h3 className="wh-list-head">{nameFor(side)}</h3>
              {words.length === 0 ? (
                <p className="wh-empty">Nothing yet.</p>
              ) : (
                <ul>
                  {words.map((found, i) => (
                    <li key={`${found}-${i}`}>
                      {isMasked(found) ? "•".repeat(found.length) : found}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ),
        )}
      </div>

      {over && state.solutions.length > 0 && <AnswerKey words={state.solutions} />}
    </div>
  );
}

/**
 * Everything that was in the grid, longest first — which is the order to read
 * it in, because the eight-letter word you walked straight past is the one
 * worth seeing, and alphabetical order buries it among three hundred threes.
 *
 * Folded away, because the first thing you want after a game is the score, not
 * an inventory of what you missed.
 */
function AnswerKey({ words }: { words: string[] }) {
  const sorted = [...words].sort((a, b) => b.length - a.length || a.localeCompare(b));

  return (
    <details className="wh-key">
      <summary>Everything that was in there ({words.length})</summary>
      <ul>
        {sorted.map((word) => (
          <li key={word}>{word}</li>
        ))}
      </ul>
    </details>
  );
}
