import { useCallback, useEffect, useRef, useState } from "react";
import {
  BOARD_SIZE,
  FLEET,
  fleetReady,
  opponentOf,
  placementError,
  shipAt,
  shipClass,
  squareName,
  unplaced,
} from "../../../shared/games/battleshipDisplay.js";
import type { BsMove, BsState, Ship, ShipKind } from "../../../shared/games/battleshipDisplay.js";

import { ghostCells } from "./geometry.js";
import type { Cell, Preview } from "./geometry.js";
import { Sea } from "./parts.js";

/**
 * Placing: your own sea, a ship in hand, and somewhere to put it.
 *
 * A whole screen rather than a component of one, and the only part of this game
 * with a drag in it. It owns the ship in hand and the ghost under the finger;
 * everything it commits goes through `onMove`, so the reducer stays the only
 * thing that decides whether a placement is legal -- `placementError` is asked
 * here so the answer can be *said* before the move is sent, not so it can be
 * decided twice.
 */
export function Harbour({
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
