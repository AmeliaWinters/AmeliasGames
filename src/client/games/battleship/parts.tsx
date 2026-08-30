/**
 * The three things drawn on or beside a sea: the hulls laid over it, the sea
 * itself, and what is left of a fleet.
 *
 * `Sea` is the load-bearing one and its own comment explains why four separate
 * jobs live inside it. The other two are pure pictures of state.
 *
 * None of these know whose turn it is. The board decides that and passes down
 * `cellClass` and a `Pointer`, which is what lets the same grid be your own
 * water during placing and the enemy's during the game.
 */
import { useEffect, useRef, useState } from "react";
import { FLEET, isHidden, isSunk } from "../../../shared/games/battleshipDisplay.js";
import type { Ship, ShipKind } from "../../../shared/games/battleshipDisplay.js";

import { ARROWS, ROWS, cellUnder, sameCell, step } from "./geometry.js";
import type { Cell, Pointer, Preview } from "./geometry.js";

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
export function Hulls({
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
export function Sea({
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
export function Roster({
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
