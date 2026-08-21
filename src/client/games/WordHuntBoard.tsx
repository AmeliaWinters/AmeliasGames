import { useEffect, useRef, useState } from "react";
// Values from wordHuntDisplay.js, which reaches no further than wordleDisplay.js
// — the board must never pull the reducer (and the word list with it) into the
// client bundle. The types below are type-only, so they are erased.
import {
  GRID_SIZE,
  HIDDEN,
  WORD_LENGTH,
  canAct,
  canExtend,
  scoreOf,
  spell,
} from "../../shared/games/wordHuntDisplay.js";
import type { WhMove, WhState } from "../../shared/games/wordHuntDisplay.js";

interface Props {
  state: WhState;
  seat: number | null;
  names: string[];
  onMove(move: WhMove): void;
}

/**
 * Note the absence of `myTurn`. Everyone hunts the same grid at the same time,
 * so `room.turn` says nothing about whether *you* may drag — `canAct` does.
 *
 * The one interaction here is tracing a word, and it has to work three ways:
 * dragging a finger, dragging a mouse, and tapping cell by cell. They are the
 * same gesture underneath — cells are appended to a path, and the word is sent
 * the moment the path is long enough — so tapping is not a lesser fallback but
 * the same move made slowly, which is also what makes the grid usable from a
 * keyboard.
 */

/** The cell under a point, for touch: pointerenter does not fire mid-drag. */
function cellUnder(x: number, y: number): number | null {
  const element = document.elementFromPoint(x, y);
  const cell = element?.closest<HTMLElement>("[data-cell]");
  if (!cell) return null;
  const index = Number(cell.dataset.cell);
  return Number.isInteger(index) ? index : null;
}

export function WordHuntBoard({ state, seat, names, onMove }: Props) {
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

  const mine = seat !== null;
  const myMove = mine && canAct(state, seat);
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

  /**
   * Add a cell, and send the word the moment there is one. Submitting on the
   * fifth letter rather than on release is what lets tapping and dragging be
   * the same gesture — and it costs nothing, because five letters is the only
   * length there is.
   */
  function extend(cell: number) {
    if (!myMove) return;
    setPath((current) => {
      // Back onto the previous cell undoes the last step, which is how every
      // trace-a-word game lets you correct a slip without starting over.
      if (current.length >= 2 && cell === current[current.length - 2]) {
        return current.slice(0, -1);
      }
      if (!canExtend(current, cell)) return current;

      const next = current.concat(cell);
      if (next.length === WORD_LENGTH) {
        onMove({ type: "found", path: next });
        return [];
      }
      return next;
    });
  }

  const word = spell(state.grid, path);

  return (
    <div className="board wh-board">
      <div className="wh-scores" role="list" aria-label="Words found">
        {state.found.map((words, side) => (
          <span
            className={side === seat ? "wh-score mine" : "wh-score"}
            role="listitem"
            key={side}
          >
            <span className="wh-who">{nameFor(side)}</span>
            <span className="wh-tally">{scoreOf(state, side)}</span>
            {state.done[side] && !over && <span className="wh-flag">done</span>}
          </span>
        ))}
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
          dragging.current = false;
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
            The letters so far, in a box that is always there. A word that
            appeared and vanished would move the grid up and down under a
            finger that is mid-trace.
          */}
          <p className="wh-draft" aria-live="polite">
            {word || "Trace a five-letter word"}
          </p>
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
          You are done. Waiting for the others to finish.
        </p>
      )}

      {/*
        Your own words while the game runs; everyone's once it ends. An
        opponent's arrive as HIDDEN until then — you can watch the count climb,
        which is the tension, without being handed the words themselves.
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
                    <li key={`${found}-${i}`}>{found === HIDDEN ? "•••••" : found}</li>
                  ))}
                </ul>
              )}
            </section>
          ),
        )}
      </div>

      {over && state.solutions.length > 0 && (
        <details className="wh-key">
          <summary>
            Everything that was in there ({state.solutions.length})
          </summary>
          <ul>
            {state.solutions.map((found) => (
              <li key={found}>{found}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
