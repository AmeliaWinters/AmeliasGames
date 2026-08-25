import { useCallback, useEffect, useRef, useState } from "react";
// Values from battleshipDisplay.js, which imports nothing: the board must
// never pull the reducer in. The types below are type-only, so they carry no
// runtime import.
import {
  BOARD_SIZE,
  FLEET,
  afloat,
  fleetReady,
  isHidden,
  isSunk,
  opponentOf,
  placementError,
  shipAt,
  shipClass,
  shotAt,
  shotLog,
  squareName,
  unplaced,
} from "../../shared/games/battleshipDisplay.js";
import type {
  BsMove,
  BsState,
  Ship,
  ShipKind,
} from "../../shared/games/battleshipDisplay.js";
import { wantsStillness } from "../motion.js";
import { play } from "../sfx.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<BsState, BsMove>;

const ROWS = Array.from({ length: BOARD_SIZE }, (_, i) => i);

type Cell = [number, number];

/** Where the ship in hand would land, and whether she may. */
interface Preview {
  kind: ShipKind;
  size: number;
  row: number;
  col: number;
  horizontal: boolean;
  ok: boolean;
}

function sameCell(a: Cell | null, b: Cell | null): boolean {
  return a !== null && b !== null && a[0] === b[0] && a[1] === b[1];
}

/** Every square a ship would take if it were dropped here. */
function ghostCells(kind: ShipKind, row: number, col: number, horizontal: boolean): Cell[] {
  const size = shipClass(kind)?.size ?? 0;
  return Array.from({ length: size }, (_, i) =>
    horizontal ? [row, col + i] : [row + i, col],
  );
}

/** Clamped to the board, so a cursor walked off the edge stops at it. */
function step([row, col]: Cell, dr: number, dc: number): Cell {
  return [
    Math.min(BOARD_SIZE - 1, Math.max(0, row + dr)),
    Math.min(BOARD_SIZE - 1, Math.max(0, col + dc)),
  ];
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/**
 * Which square a screen point is over.
 *
 * Hit-tested rather than derived from the grid's own rectangle. The arithmetic
 * version has to know about the gaps between squares, the gaps between rows
 * and the coordinate gutters, and it is wrong by one square the moment any of
 * those change in the stylesheet. The DOM already knows where everything is.
 */
function cellUnder(x: number, y: number): Cell | null {
  const found = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
  if (!found) return null;
  const row = Number(found.dataset.row);
  const col = Number(found.dataset.col);
  return Number.isInteger(row) && Number.isInteger(col) ? [row, col] : null;
}

interface Pointer {
  onDown(cell: Cell): void;
  onMoveTo(cell: Cell): void;
  onUp(): void;
}

/**
 * The fleet on a sea, as hulls rather than as coloured squares.
 *
 * A second ten by ten grid laid over the first with the same tracks and the
 * same gap, so a ship is placed with `grid-row` and `grid-column` and nothing
 * here does pixel arithmetic. It is inert and `aria-hidden`: every square
 * underneath is still the button, still hit-tested, still what a screen reader
 * reads. The overlay is a picture of what those squares already say.
 *
 * Hidden ships draw nothing, which is the whole redaction story on this side:
 * `view()` blanks an enemy ship's position, `isHidden` says so, and a hull
 * with nowhere to be is simply not rendered.
 */
function Hulls({
  fleet,
  sinking,
  preview,
}: {
  fleet: Ship[];
  sinking: ShipKind | null;
  /** The ship in hand, where she would land. Drawn as a hull rather than as
   *  tinted squares, because three lit squares are three lit squares and the
   *  question being answered is "is that where I want the cruiser". */
  preview?: Preview | null;
}) {
  return (
    <>
      {preview && (
        <div
          className={`bs-hull ${preview.kind} ${preview.horizontal ? "h" : "v"} ghosting${
            preview.ok ? "" : " bad"
          }`}
          style={{
            gridRow: preview.horizontal
              ? preview.row + 1
              : `${preview.row + 1} / span ${preview.size}`,
            gridColumn: preview.horizontal
              ? `${preview.col + 1} / span ${preview.size}`
              : preview.col + 1,
          }}
        />
      )}
      {fleet
        .filter((ship) => !isHidden(ship))
        .map((ship) => {
          const size = ship.hits.length;
          return (
            <div
              key={ship.kind}
              className={[
                "bs-hull",
                ship.kind,
                ship.horizontal ? "h" : "v",
                isSunk(ship) ? "wreck" : "",
                ship.kind === sinking ? "going" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{
                gridRow: ship.horizontal
                  ? ship.row + 1
                  : `${ship.row + 1} / span ${size}`,
                gridColumn: ship.horizontal
                  ? `${ship.col + 1} / span ${size}`
                  : ship.col + 1,
              }}
            />
          );
        })}
    </>
  );
}

/**
 * The board's two grids are the same ten-by-ten thing seen from either side,
 * so they are one component. What differs is what a square knows about itself,
 * which the caller supplies as a class and a label.
 *
 * Four things live here rather than in either caller, because both callers
 * need all four and a second copy of any of them would drift:
 *
 * - **The coordinate gutters.** A1 talk is how the game is played out loud,
 *   and it is also how a square is named while it is being aimed at, which is
 *   the job below.
 * - **A roving cursor.** Two hundred squares on this screen, and every one of
 *   them used to be a tab stop, so reaching the far corner of the second sea by
 *   keyboard meant nearly two hundred presses. One stop per grid now, and the
 *   arrows walk it. `tabIndex={-1}` on the rest keeps them clickable and
 *   reachable, just not in the tab order.
 * - **Pointer tracking.** Dragging a ship and sweeping the guns both want "the
 *   square under the finger, continuously", which is one piece of geometry.
 * - **The overlay.** Hulls and the aim's crosshair are drawn on the same
 *   layer, because both are things laid over the squares rather than in them,
 *   and both want the grid's own tracks to sit on.
 */
function Sea({
  label,
  cellClass,
  cellLabel,
  onActivate,
  cursor,
  onCursor,
  playable,
  pointer,
  className,
  fleet,
  sinking,
  preview,
  aim,
  onRotate,
}: {
  label: string;
  cellClass(row: number, col: number): string;
  cellLabel(row: number, col: number): string;
  onActivate(row: number, col: number): void;
  /** The one square holding this grid's tab stop, or null for an inert grid. */
  cursor: Cell | null;
  onCursor?: (cell: Cell) => void;
  playable(row: number, col: number): boolean;
  pointer?: Pointer;
  className?: string;
  /** Whose hulls to draw over the water. Empty for a sea with nothing shown. */
  fleet: Ship[];
  sinking: ShipKind | null;
  preview?: Preview | null;
  /** Where the guns are pointed: lights both gutters and draws the crosshair. */
  aim?: Cell | null;
  /** A wheel over the water turns the ship in hand. Harbour only. */
  onRotate?: () => void;
}) {
  const grid = useRef<HTMLDivElement | null>(null);
  // Focus follows the cursor only when a key moved it, which is what `chase`
  // counts. Following it on every change would steal focus back from a mouse
  // mid-click, and would scroll the page around under a dragged ship.
  const [chase, setChase] = useState(0);

  useEffect(() => {
    if (chase === 0 || !cursor) return;
    grid.current
      ?.querySelector<HTMLElement>(`[data-row="${cursor[0]}"][data-col="${cursor[1]}"]`)
      ?.focus();
  }, [chase, cursor]);

  // Native, and not React's `onWheel`, for one reason: React attaches its
  // wheel listener at the root as passive, so `preventDefault` there is
  // ignored and the page scrolls out from under the board while the ship
  // turns. Scoped to the grid, so a wheel anywhere else on the page still
  // scrolls the page.
  useEffect(() => {
    const element = grid.current;
    if (!element || !onRotate) return;
    const turn = (event: WheelEvent) => {
      event.preventDefault();
      onRotate();
    };
    element.addEventListener("wheel", turn, { passive: false });
    return () => element.removeEventListener("wheel", turn);
  }, [onRotate]);

  function onKeyDown(event: React.KeyboardEvent) {
    const delta = ARROWS[event.key];
    if (!delta || !cursor || !onCursor) return;
    event.preventDefault();
    onCursor(step(cursor, delta[0], delta[1]));
    setChase((n) => n + 1);
  }

  // The crosshair is positioned in the overlay's own percentages rather than
  // beside the grid. Hung off the wrapper, whose left edge is the rank gutter,
  // the horizontal line ran straight through the rank letter and read as a
  // strikethrough on it.
  const centre = (index: number) => `${(index + 0.5) * 10}%`;

  return (
    <div className={`bs-sea${className ? ` ${className}` : ""}`}>
      <div className="bs-files" aria-hidden="true">
        <span />
        {ROWS.map((col) => (
          <span key={col} className={aim && aim[1] === col ? "lit" : undefined}>
            {col + 1}
          </span>
        ))}
      </div>
      <div className="bs-gridwrap">
        <div
          className="bs-grid"
          role="grid"
          aria-label={label}
          ref={grid}
          onKeyDown={onKeyDown}
          onPointerMove={(event) => {
            if (!pointer) return;
            const cell = cellUnder(event.clientX, event.clientY);
            if (cell) pointer.onMoveTo(cell);
          }}
          onPointerUp={() => pointer?.onUp()}
          onPointerCancel={() => pointer?.onUp()}
        >
          {ROWS.map((row) => (
            <div className="bs-sea-row" role="row" key={row}>
              <span
                className={`bs-rank${aim && aim[0] === row ? " lit" : ""}`}
                aria-hidden="true"
              >
                {String.fromCharCode(65 + row)}
              </span>
              {ROWS.map((col) => (
                <button
                  type="button"
                  role="gridcell"
                  key={col}
                  data-cell=""
                  data-row={row}
                  data-col={col}
                  className={`bs-cell surface ${cellClass(row, col)}`}
                  disabled={!playable(row, col)}
                  tabIndex={sameCell(cursor, [row, col]) ? 0 : -1}
                  aria-label={cellLabel(row, col)}
                  onClick={() => onActivate(row, col)}
                  onPointerDown={(event) => {
                    if (!pointer) return;
                    // Captured on the grid, not on the square: the finger
                    // leaves the square it started on within a few pixels of a
                    // drag, and the moves stop arriving the moment it does.
                    grid.current?.setPointerCapture(event.pointerId);
                    pointer.onDown([row, col]);
                  }}
                  onMouseEnter={() => onCursor?.([row, col])}
                  onFocus={() => onCursor?.([row, col])}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="bs-hulls" aria-hidden="true">
          <Hulls fleet={fleet} sinking={sinking} preview={preview} />
          {aim && (
            <>
              <div
                className="bs-cross h"
                style={{ left: 0, width: centre(aim[1]), top: centre(aim[0]) }}
              />
              <div
                className="bs-cross v"
                style={{
                  left: centre(aim[1]),
                  top: -9,
                  height: `calc(${centre(aim[0])} + 9px)`,
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What is left of a fleet, ship by ship. The count of sunk ships is the only
 * information a player really tracks between shots, and counting wrecks off
 * a grid of a hundred squares is exactly the chore a scoreboard exists to
 * spare them.
 *
 * The same hull as on the water, flooding red from the bow as she takes
 * damage, so the ship in the list and the ship on the sea are one ship. For an
 * enemy fleet the damage stays at nothing until she goes down and then fills
 * at once, because `view()` wipes the damage on anything still afloat: which
 * ship a hit belonged to is what the player is supposed to be working out.
 */
function Roster({
  fleet,
  label,
  sinking,
}: {
  fleet: Ship[];
  label: string;
  /** The class going down right now, so her row flashes in step with the
   *  wreck appearing on the grid rather than a frame ahead of it. */
  sinking: ShipKind | null;
}) {
  return (
    <ul className="bs-roster" aria-label={label}>
      {FLEET.map((cls) => {
        const ship = fleet.find((s) => s.kind === cls.kind);
        const sunk = ship !== undefined && isSunk(ship);
        const hits = ship?.hits.filter(Boolean).length ?? 0;
        return (
          <li
            key={cls.kind}
            className={["bs-ship", sunk ? "sunk" : "", cls.kind === sinking ? "going" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <span className="bs-ship-name">{cls.name}</span>
            <span
              className={`bs-glyph ${cls.kind}`}
              aria-hidden="true"
              style={{ "--dmg": `${(100 * hits) / cls.size}%` } as React.CSSProperties}
            />
            {/* The glyph is a picture and the strike-through is a colour, so
                the one word that carries all of it is said out loud too. */}
            <span className="sr-only">
              {sunk ? "sunk" : `${cls.size} squares, afloat`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Placing: your own sea, a ship in hand, and somewhere to put it. */
function Harbour({
  state,
  seat,
  themName,
  themHere,
  onMove,
}: {
  state: BsState;
  seat: number;
  themName: string;
  /** False while their seat is still empty, meaning they have not joined. */
  themHere: boolean;
  onMove(move: BsMove): void;
}) {
  const fleet = state.fleets[seat];
  const waiting = unplaced(fleet);
  const [horizontal, setHorizontal] = useState(true);
  const [holding, setHolding] = useState<ShipKind | null>(null);
  const [cursor, setCursor] = useState<Cell>([0, 0]);
  const [hover, setHover] = useState<Cell | null>(null);
  // How far along the ship the finger took hold of her. Grab a carrier by her
  // funnel and she should still be held by the funnel when she lands;
  // anchoring every drag at the bow makes a long ship jump forward under the
  // finger the moment it moves.
  const [grab, setGrab] = useState(0);
  // Two gestures, and they are not the same one.
  //
  // `carry` is a ship lifted off the board: she keeps the orientation and the
  // grab offset she had, and she follows the finger.
  //
  // `grow` is a ship drawn out of open water: the square you pressed is her
  // bow and it does not move, and the direction you drag is which way she
  // lies. That is the whole of the rotate control, for anyone who never finds
  // the buttons -- drag her across and she lies across, drag her down and she
  // stands. It replaced a button whose label named the state it was already
  // in, which meant half the people who pressed it turned the ship the wrong
  // way to find out what it did.
  const drag = useRef<"carry" | "grow" | null>(null);
  const anchor = useRef<Cell | null>(null);
  // Set on pointer-down and read by the click that follows it, because a
  // keyboard Enter reaches `onActivate` with no pointer sequence in front of
  // it and is the one activation that still has to commit the placement.
  const byPointer = useRef(false);

  // The ship in hand is whichever is selected, else the next one waiting, so
  // the common case (place them in order) needs no selecting at all and taking
  // a ship back puts that class straight back in hand.
  const inHand =
    holding !== null && waiting.some((cls) => cls.kind === holding)
      ? holding
      : (waiting[0]?.kind ?? null);

  useEffect(() => {
    if (inHand === null) setHover(null);
  }, [inHand]);

  const ready = fleetReady(fleet);
  const theyAreReady = fleetReady(state.fleets[opponentOf(seat)]);

  // Where the bow would sit, given where she is being held. Derived in one
  // place so the preview, the legality check and the move that gets sent can
  // never be looking at three different squares.
  const bow: Cell | null =
    hover === null
      ? null
      : horizontal
        ? [hover[0], hover[1] - grab]
        : [hover[0] - grab, hover[1]];
  const ghost =
    inHand !== null && bow !== null ? ghostCells(inHand, bow[0], bow[1], horizontal) : [];
  const ghostWhy =
    inHand !== null && bow !== null
      ? placementError(fleet, inHand, bow[0], bow[1], horizontal)
      : null;
  const ghostOk = inHand !== null && bow !== null && ghostWhy === null;
  // The hull under the finger, drawn only while every one of her squares is on
  // the board. Hung off the tenth column she would open implicit grid tracks in
  // the overlay and squash the ten real ones, which reads as the whole fleet
  // shifting sideways the moment a carrier is nudged past the edge.
  const preview: Preview | null =
    inHand !== null &&
    bow !== null &&
    ghost.every(([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE)
      ? {
          kind: inHand,
          size: shipClass(inHand)?.size ?? 0,
          row: bow[0],
          col: bow[1],
          horizontal,
          ok: ghostOk,
        }
      : null;

  const drop = useCallback(() => {
    if (inHand === null || bow === null || !ghostOk) return;
    onMove({ type: "place", kind: inHand, row: bow[0], col: bow[1], horizontal });
    setHover(null);
    setGrab(0);
  }, [inHand, bow, ghostOk, horizontal, onMove]);

  const rotate = useCallback(() => setHorizontal((current) => !current), []);

  function pickUp(cell: Cell, ship: Ship) {
    // Lifted, not deleted: she comes off the board and into the hand, held at
    // the square the finger is actually on, so the drag continues from where
    // it started instead of snapping her bow under the finger.
    onMove({ type: "unplace", kind: ship.kind });
    setHolding(ship.kind);
    setGrab(ship.horizontal ? cell[1] - ship.col : cell[0] - ship.row);
    setHorizontal(ship.horizontal);
    setHover(cell);
  }

  /**
   * A ship drawn out of the water, one pointer move at a time.
   *
   * The bow stays on the square the drag started, and the axis with the most
   * travel in it wins, so a wobble across a diagonal does not flip her back
   * and forth. Dragging up or left is the same ship the other way round, which
   * is what `grab` is for: hold her by the stern and the shared `bow`
   * derivation above puts the bow where it belongs, with no second opinion
   * about where the ship is.
   */
  function grow(cell: Cell) {
    const start = anchor.current;
    if (start === null || inHand === null) return;
    const dr = cell[0] - start[0];
    const dc = cell[1] - start[1];
    if (dr === 0 && dc === 0) return;
    const across = Math.abs(dc) >= Math.abs(dr);
    const backwards = across ? dc < 0 : dr < 0;
    const size = shipClass(inHand)?.size ?? 1;
    setHorizontal(across);
    setGrab(backwards ? size - 1 : 0);
    setHover(start);
  }

  function cellClass(row: number, col: number): string {
    const shadowed = ghost.some(([r, c]) => r === row && c === col);
    if (!shadowed) return "";
    return ghostOk ? "ghost" : "ghost bad";
  }

  function cellLabel(row: number, col: number): string {
    const ship = shipAt(fleet, row, col);
    const where = squareName(row, col);
    if (ship) return `${where}, your ${ship.kind}. Drag to move her, or tap to take her back`;
    if (inHand === null) return `${where}, empty`;
    return `${where}, place your ${inHand} here`;
  }

  return (
    <div
      className="board bs-board bs-harbour"
      // R turns whatever is in hand, mid-drag included: the one control a drag
      // cannot reach, because the finger holding the ship is the finger that
      // would have to press it.
      onKeyDown={(event) => {
        if (event.key === "r" || event.key === "R") rotate();
      }}
    >
      <p className="bs-brief">
        Press a square and drag her out: the way you drag is the way she lies.
        Tap a ship to take her back. <kbd>R</kbd>, the wheel or the buttons turn
        her; by keyboard, the arrows aim and <kbd>Enter</kbd> drops.
      </p>

      <div className="bs-hand">
        {FLEET.map((cls) => {
          const out = fleet.some((ship) => ship.kind === cls.kind);
          return (
            <button
              type="button"
              key={cls.kind}
              className={[
                "bs-pick",
                out ? "out" : "",
                !out && cls.kind === inHand ? "in-hand" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={out || ready}
              aria-pressed={!out && cls.kind === inHand}
              onClick={() => {
                setHolding(cls.kind);
                setGrab(0);
              }}
            >
              <span className={`bs-glyph ${cls.kind}`} aria-hidden="true" />
              {cls.name}
              <span className="bs-pick-size">{cls.size}</span>
            </button>
          );
        })}
      </div>

      <div className="bs-tools">
        <div className="bs-turn" role="group" aria-label="Which way she lies">
          <button
            type="button"
            className="bs-tool"
            disabled={ready}
            aria-pressed={horizontal}
            aria-label="Lying across"
            onClick={() => setHorizontal(true)}
          >
            <i className="across" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="bs-tool"
            disabled={ready}
            aria-pressed={!horizontal}
            aria-label="Standing upright"
            onClick={() => setHorizontal(false)}
          >
            <i className="upright" aria-hidden="true" />
          </button>
        </div>
        <span className="bs-hint">Or drag her the way you want her to lie.</span>
      </div>

      <Sea
        label="Your waters"
        className="bs-sea-wide"
        cellClass={cellClass}
        cellLabel={cellLabel}
        fleet={fleet}
        sinking={null}
        preview={preview}
        onRotate={ready ? undefined : rotate}
        playable={(row, col) => !ready && (shipAt(fleet, row, col) !== null || inHand !== null)}
        cursor={ready ? null : cursor}
        onCursor={(cell) => {
          setCursor(cell);
          // A cursor moved by key or by mouse aims the ship at the square
          // itself. Only a drag carries a grab offset, and only until it ends.
          if (!drag.current) setGrab(0);
          setHover(cell);
        }}
        pointer={{
          onDown: (cell) => {
            byPointer.current = true;
            const ship = shipAt(fleet, cell[0], cell[1]);
            if (ship) {
              drag.current = "carry";
              pickUp(cell, ship);
              return;
            }
            drag.current = "grow";
            anchor.current = cell;
            setGrab(0);
            setHover(cell);
          },
          onMoveTo: (cell) => {
            if (drag.current === "carry") {
              setCursor(cell);
              setHover(cell);
            } else if (drag.current === "grow") {
              setCursor(cell);
              grow(cell);
            }
          },
          onUp: () => {
            if (!drag.current) return;
            drag.current = null;
            anchor.current = null;
            drop();
          },
        }}
        onActivate={(row, col) => {
          // Read once and cleared, because every click has to clear it whether
          // or not it uses it, or the next Enter inherits a stale pointer.
          const tapped = byPointer.current;
          byPointer.current = false;

          const ship = shipAt(fleet, row, col);
          if (ship) {
            onMove({ type: "unplace", kind: ship.kind });
            setHolding(ship.kind);
            setGrab(0);
            return;
          }

          // A tap on water needs nothing here: the legal drop already happened
          // on release, and an illegal one is what the line under the board is
          // explaining. Enter is the other case. It never goes through the
          // pointer path at all, so without this the roving cursor could aim a
          // ship and preview her and never once let go of her -- while the
          // square it was sitting on announced "place your carrier here".
          if (!tapped) drop();
        }}
      />

      <p className="bs-waiting" aria-live="polite">
        {!ready && ghostWhy
          ? ghostWhy
          : ready
            ? !themHere
              ? "Fleet at sea. Send the code, and you can start the moment they arrive."
              : theyAreReady
                ? "Both fleets are at sea."
                : `Fleet at sea. Waiting for ${themName} to finish placing.`
            : themHere && theyAreReady
              ? `${themName} is ready and waiting.`
              : `${waiting.length} ${waiting.length === 1 ? "ship" : "ships"} still in harbour.`}
      </p>
    </div>
  );
}

/**
 * Every shot fired, heard by everyone watching: hull, water, or a ship going
 * down.
 *
 * Battleships opts out of the generic move sound in `sfx.ts` precisely so this
 * can exist: a shot has a result, and a wooden knock that says "somebody
 * moved" would be the wrong half of the news. Both seats are watched rather
 * than just yours, because a miss of theirs is the best thing that happens to
 * you all game.
 *
 * Counts, not identities: shots are only ever appended, so a longer list is a
 * new shot and its last entry is the one that was just fired. A rematch resets
 * the lists to empty, which is a shorter list and therefore silent.
 *
 * It returns the ship that has just gone down, because the sound and the
 * ceremony are the same event: deriving them separately is how the noise and
 * the banner end up a frame apart.
 */
function useShotSounds(state: BsState): ShipKind | null {
  const seen = useRef<number[] | null>(null);
  const [sinking, setSinking] = useState<ShipKind | null>(null);

  useEffect(() => {
    const counts = state.shots.map((shots) => shots.length);
    const before = seen.current;
    seen.current = counts;
    // A board opened mid-game already has shots on it. They are history, not
    // news, and firing all of them at once would be a barrage.
    if (!before || before.length !== counts.length) return;
    let sank: ShipKind | null = null;
    counts.forEach((count, index) => {
      if (count <= before[index]) return;
      const shot = state.shots[index][count - 1];
      if (shot.sunk) sank = shot.sunk;
      play(shot.hit ? "hit" : "miss");
    });
    if (!sank) return;
    // The same shell, pitched down. A ship going down is the biggest moment in
    // the game and it had no sound of its own; a second cue file for one event
    // is not worth its download when the rate control is right here.
    play("hit", 0.55);
    setSinking(sank);
  }, [state]);

  // The ceremony is a moment, not a state, so it clears itself and nothing
  // else has to remember to. Stillness keeps the banner and loses only the
  // movement, which the stylesheet hangs off the same class.
  useEffect(() => {
    if (sinking === null) return;
    const timer = setTimeout(() => setSinking(null), wantsStillness() ? 1600 : 2400);
    return () => clearTimeout(timer);
  }, [sinking]);

  return sinking;
}

export function BattleshipBoard({ state, seat, names, canAct, onMove }: Props) {
  const sinking = useShotSounds(state);
  const them = seat === null ? null : opponentOf(seat);
  const nameFor = (index: number | null) =>
    index === null ? "" : index === seat ? "You" : names[index] || `Player ${index + 1}`;

  // Where the guns are pointed, which is not the same as where they have
  // fired. A shot cannot be taken back and costs the turn that fired it, and
  // the squares are small, small enough on a phone that a thumb covers three of
  // them, so a press aims and a second press on the same square fires.
  //
  // What makes that safe without a confirm button under the board is that the
  // aim is drawn *outside* the grid as well as in it: the rank and the file
  // light in the gutters and a line runs out to them, so the square being
  // committed to is named where there is room to read it.
  const [aim, setAim] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell>([0, 0]);

  // Losing the guns is the moment a stale aim turns dangerous: it would still
  // be sitting there, armed, when the turn came back round.
  const armed = seat !== null && canAct;
  useEffect(() => {
    if (!armed) setAim(null);
  }, [armed]);

  if (state.phase === "placing") {
    // A spectator has no fleet to set out and no guns to fire; they get the
    // firing view below, with every square inert.
    if (seat === null) {
      return (
        <div className="board bs-board bs-harbour">
          <p className="bs-waiting">Both fleets are putting to sea.</p>
        </div>
      );
    }
    return (
      <Harbour
        state={state}
        seat={seat}
        themName={names[opponentOf(seat)] || "the other player"}
        themHere={Boolean(names[opponentOf(seat)])}
        onMove={onMove}
      />
    );
  }

  const mine = seat !== null;
  const myShot = mine && canAct;
  // Which shots are on which board: yours land in their waters, theirs in
  // yours. Getting this pair the wrong way round is the one mistake that
  // would make the whole screen quietly lie, so it is named once, here.
  const yourShots = mine ? state.shots[seat] : [];
  const theirShots = them === null ? [] : state.shots[them];
  const yourFleet = mine ? state.fleets[seat] : [];
  const theirFleet = them === null ? [] : state.fleets[them];
  const log = shotLog(state.shots);
  // The newest shot of the game, whoever fired it, ringed where it fell. Two
  // dozen red squares all look equally recent otherwise, and "where did they
  // just shoot" is the first question on coming back to the board.
  const latest = log.at(-1) ?? null;
  const isLatest = (row: number, col: number, firedBy: number) =>
    latest !== null && latest.seat === firedBy && latest.row === row && latest.col === col;

  function fireAt(cell: Cell) {
    if (!myShot) return;
    if (!sameCell(aim, cell)) {
      setAim(cell);
      return;
    }
    setAim(null);
    onMove({ type: "fire", row: cell[0], col: cell[1] });
  }

  function targetClass(row: number, col: number): string {
    const shot = shotAt(yourShots, row, col);
    return [
      shot ? (shot.hit ? "hit" : "miss") : "",
      sameCell(aim, [row, col]) ? "aimed" : "",
      seat !== null && isLatest(row, col, seat) ? "latest" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  // What the next tap does, in the one line that used to be a line and a
  // button. The square is named in full before it is committed to, which is
  // what the button was for.
  const orders = myShot ? (
    aim ? (
      <span>
        <b>Locked</b> on <span className="bs-coord">{squareName(aim[0], aim[1])}</span>, tap
        again to fire
      </span>
    ) : yourShots.at(-1)?.hit ? (
      // A hit keeps the guns, so a player mid-streak is told why they still
      // have them, or a second shot looks like a bug.
      <span>
        <b>A hit.</b> Fire again.
      </span>
    ) : (
      <span>
        <b>Your shot.</b> Pick a square.
      </span>
    )
  ) : (
    // Their last shot, which is the one thing the shot log was really for:
    // "where did they just go" is asked every turn, and it does not need a
    // scrolling panel under the board to answer.
    <span>
      {mine ? `${nameFor(them)} is firing` : "Watching"}
      {theirShots.length > 0 && (
        <>
          {", last shot "}
          <span className="bs-coord">
            {squareName(theirShots[theirShots.length - 1].row, theirShots[theirShots.length - 1].col)}
          </span>
          {theirShots[theirShots.length - 1].hit ? ", a hit" : ", a miss"}
        </>
      )}
    </span>
  );

  return (
    <div className="board bs-board">
      <div className="bs-seas">
        <section className="bs-panel">
          <h3 className="bs-panel-head">
            <span className="bs-who them">
              {them === null ? "Their waters" : `${nameFor(them)}'s waters`}
            </span>
            <span className="bs-count">{afloat(theirFleet).length} afloat</span>
          </h3>
          <Sea
            label={them === null ? "Their waters" : `${nameFor(them)}'s waters`}
            cellClass={targetClass}
            // A hull is only ever drawn here once `view()` has revealed her:
            // sunk, or the game is over. `Hulls` skips the hidden ones, so
            // handing it the whole fleet reveals nothing.
            fleet={theirFleet}
            sinking={sinking}
            aim={aim}
            cellLabel={(row, col) => {
              const shot = shotAt(yourShots, row, col);
              const where = squareName(row, col);
              if (!shot) {
                if (!myShot) return where;
                return sameCell(aim, [row, col])
                  ? `${where}, aimed. Press again to fire`
                  : `Aim at ${where}`;
              }
              if (shot.sunk) return `${where}, hit, and sank the ${shot.sunk}`;
              return `${where}, ${shot.hit ? "hit" : "miss"}`;
            }}
            playable={(row, col) => myShot && shotAt(yourShots, row, col) === null}
            cursor={myShot ? cursor : null}
            onCursor={(cell) => setCursor(cell)}
            onActivate={(row, col) => fireAt([row, col])}
          />
          {/* Over the sea rather than under it. A line in the flow had to hold
              its height all game so that its arrival did not shove everything
              below it down, which left an empty bar under the board for the
              whole game. Floating, it can simply not be there. */}
          {sinking && (
            <p className="bs-banner">The {shipClass(sinking)?.name} is sunk</p>
          )}
          <Roster fleet={theirFleet} label="Their fleet" sinking={sinking} />
        </section>

        <section className="bs-panel">
          <h3 className="bs-panel-head">
            <span className="bs-who">Your waters</span>
            <span className="bs-count">{afloat(yourFleet).length} afloat</span>
          </h3>
          <Sea
            label="Your waters"
            fleet={yourFleet}
            sinking={sinking}
            cellClass={(row, col) => {
              const shot = shotAt(theirShots, row, col);
              return [
                shot ? (shot.hit ? "hit" : "miss") : "",
                them !== null && isLatest(row, col, them) ? "latest" : "",
              ]
                .filter(Boolean)
                .join(" ");
            }}
            cellLabel={(row, col) => {
              const ship = shipAt(yourFleet, row, col);
              const shot = shotAt(theirShots, row, col);
              const where = squareName(row, col);
              if (ship && shot) return `${where}, your ${ship.kind}, hit`;
              if (ship) return `${where}, your ${ship.kind}`;
              if (shot) return `${where}, they missed`;
              return where;
            }}
            // Your own sea is a readout, not a control: every square is
            // disabled, so nothing here takes a tab stop from the guns.
            cursor={null}
            playable={() => false}
            onActivate={() => undefined}
          />
          <Roster fleet={yourFleet} label="Your fleet" sinking={sinking} />
        </section>
      </div>

      {/* Announced as well as drawn. A screen reader gets hit and miss from
          the cell it just fired at, and would otherwise never hear the one
          piece of news that is not attached to a square. The banner above is
          a picture of this line, and this is the line. */}
      <p className="sr-only" role="status" aria-live="assertive">
        {sinking ? `The ${shipClass(sinking)?.name} is sunk` : ""}
      </p>

      {state.phase === "firing" && (
        <p className={`bs-orders${myShot ? "" : " waiting"}`} aria-live="polite">
          {orders}
        </p>
      )}
    </div>
  );
}
