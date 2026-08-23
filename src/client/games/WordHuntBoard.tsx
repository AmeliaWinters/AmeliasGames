import { useEffect, useRef, useState } from "react";
// Values from wordHuntDisplay.js, which imports nothing — the board must never
// pull the reducer (and the word list with it) into the client bundle. The
// types below are type-only, so they are erased and carry no runtime import.
import {
  GRID_SIZE,
  MIN_WORD,
  canExtend,
  clockCall,
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
import { useServerNow } from "../clock.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<WhState, WhMove>;

/** Under this much left, the clock starts shouting about it. */
const URGENT_MS = 20 * 1000;

/**
 * The one interaction here is tracing a word, and it has to work three ways:
 * dragging a finger, dragging a mouse, and tapping cell by cell. They are the
 * same gesture underneath — cells are appended to a path — and they end the
 * same way too: lifting a finger submits, and so does the button the tapping
 * player presses, which is also the one a keyboard reaches. Words run from
 * three letters to eight, so there is no length at which a trace can submit
 * itself; something has to say "that is the word", and that is the lift.
 */

/**
 * How near a cell's centre a finger has to be for that cell to count, as a
 * fraction of the cell.
 *
 * Well under half, and that is the whole of the fix for tracing diagonals with
 * a thumb. Treating a cell's own box as its hit area tiles the grid with no
 * space in between, so a finger cutting the corner from one letter to the one
 * diagonally beyond it clips whichever orthogonal neighbour it passes nearest
 * and drags a letter nobody asked for into the middle of the word. At 0.42 the
 * live areas are circles that sit clear of the edges: the straight line between
 * two diagonal neighbours passes 0.71 of a cell from either of the two cells
 * beside it, so it misses both, while a finger heading for an orthogonal
 * neighbour still walks through the middle of it.
 */
const HIT_RADIUS = 0.42;

/** Where the grid is on the screen. Measured once, when a trace starts. */
interface Reach {
  /** Cell centres in client coordinates, indexed by cell. */
  centres: { x: number; y: number }[];
  /** How near a centre counts as being on it. */
  radius: number;
  /** How finely to walk a pointer move — see `trace`. */
  step: number;
}

function measure(container: HTMLElement): Reach | null {
  const centres: { x: number; y: number }[] = [];
  let size = 0;
  for (const cell of container.querySelectorAll<HTMLElement>("[data-cell]")) {
    const index = Number(cell.dataset.cell);
    if (!Number.isInteger(index)) continue;
    const box = cell.getBoundingClientRect();
    centres[index] = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    size = Math.max(size, box.width, box.height);
  }
  return size > 0 ? { centres, radius: size * HIT_RADIUS, step: size / 4 } : null;
}

/**
 * The cell a point is on: the nearest centre, if the point is near enough to
 * it. `anywhere` drops the distance test, which is right for the press that
 * starts a trace — a finger landing in the gutter between two letters plainly
 * meant one of them — and wrong for every sample after it, where the whole
 * point is that most of the grid is not on any letter.
 */
function cellNear(reach: Reach, x: number, y: number, anywhere = false): number | null {
  let best = -1;
  let nearest = Infinity;
  for (let index = 0; index < reach.centres.length; index += 1) {
    const centre = reach.centres[index];
    if (!centre) continue;
    const distance = Math.hypot(centre.x - x, centre.y - y);
    if (distance < nearest) {
      nearest = distance;
      best = index;
    }
  }
  if (best === -1) return null;
  return anywhere || nearest <= reach.radius ? best : null;
}

/** How long after a drag a click is still that drag's parting shot. */
const CLICK_AFTER_DRAG_MS = 400;

export function WordHuntBoard({ state, seat, names, canAct, now, onMove }: Props) {
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
  /** Where the grid was when this trace began, and where the finger last was. */
  const reach = useRef<Reach | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  /*
    When a drag last ended, or 0. A drag across more than one cell ends with a
    click on whichever letter it finished on, and without this that click would
    start a fresh tap-built word out of the last letter of the word just taken.
    Cleared by the next press as well as by time, so a keypress arriving long
    after a drag is never mistaken for its tail.
  */
  const dragEnded = useRef(0);

  const clock = useServerNow(now, state.phase === "play");
  const left = msLeft(state, clock);
  const mine = seat !== null;
  const started = hasStarted(state);
  // Two clocks, deliberately. `canAct` is the server's answer, true as of the
  // message that carried it; `left` is this device counting down from it. The
  // grid closes the moment the countdown reads zero rather than a round-trip
  // later — the server has already stopped taking words by then, and a grid
  // that still accepts traces is promising something it cannot deliver. It is
  // shut before the off for the same reason.
  const myMove = mine && started && canAct && left > 0;
  const over = state.phase === "over";

  // A half-drawn word means nothing once the game has moved on underneath it.
  useEffect(() => {
    if (!myMove) {
      setPath([]);
      dragging.current = false;
      reach.current = null;
      last.current = null;
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
   * Walk the finger from where it last was to where it is now, picking up
   * every cell on the way.
   *
   * Sampling only the point each event reports drops letters whenever the
   * finger outruns the grid, and a flick easily covers a whole cell between
   * two moves. On a diagonal that is worse than a dropped letter: the cell
   * jumped is the one joining the two ends of the step, so the trace refuses
   * to grow at all and the word dies under the thumb.
   */
  function trace(x: number, y: number) {
    const here = reach.current;
    if (!here) return;
    const from = last.current ?? { x, y };
    const dx = x - from.x;
    const dy = y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / here.step));
    for (let i = 1; i <= steps; i += 1) {
      const cell = cellNear(here, from.x + (dx * i) / steps, from.y + (dy * i) / steps);
      if (cell !== null) extend(cell);
    }
    last.current = { x, y };
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
            "clock",
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
          <span className="clock-face">{left === 0 ? "Time" : formatClock(left)}</span>
          <span className="clock-note">
            {!started ? "on the whistle" : left === 0 ? "pencils down" : "left"}
          </span>
          {/* The announcement the clock above cannot make without reading
              itself out four times a second. `clockCall` changes only on
              crossing a mark, so this speaks at a minute, thirty, ten and
              time — and stays silent in between. */}
          <span className="sr-only" aria-live="polite">
            {clockCall(left, started)}
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
          const here = measure(event.currentTarget);
          if (!here) return;
          const cell = cellNear(here, event.clientX, event.clientY, true);
          if (cell === null) return;
          // Capture on the container, so a finger that leaves the grid and
          // comes back is still the same trace.
          grid.current?.setPointerCapture(event.pointerId);
          reach.current = here;
          last.current = { x: event.clientX, y: event.clientY };
          dragging.current = true;
          dragEnded.current = 0;
          setPath([]);
          extend(cell);
        }}
        onPointerMove={(event) => {
          if (!dragging.current) return;
          trace(event.clientX, event.clientY);
        }}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          reach.current = null;
          last.current = null;
          // A one-cell drag is a tap, and the click it ends with is how a
          // tapped word gets built. Anything longer was a trace, and its
          // click is noise.
          dragEnded.current = path.length > 1 ? Date.now() : 0;
          submit();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          reach.current = null;
          last.current = null;
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
              className={step === -1 ? "wh-cell surface" : "wh-cell surface picked"}
              disabled={!myMove}
              // The pointer path above handles the drag; this is the tap and
              // the keypress, which land as a click either way — except for
              // the click a finished drag leaves behind, which is neither.
              onClick={() => {
                if (Date.now() - dragEnded.current < CLICK_AFTER_DRAG_MS) {
                  dragEnded.current = 0;
                  return;
                }
                extend(cell);
              }}
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
