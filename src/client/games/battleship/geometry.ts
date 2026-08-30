/**
 * Where a square is, and which squares a ship would cover.
 *
 * The one place on this board that does arithmetic on coordinates. Both seas
 * and the harbour all ask the same three questions -- is this the same square,
 * which squares would this ship fill, what is under the finger -- and a second
 * copy of any of them drifts, which on a ten by ten grid means a ghost that
 * lands one square off the ship it is previewing.
 *
 * `cellUnder` reads the DOM because there is no other honest source: the grid's
 * tracks are the browser's arithmetic, not ours, and hit-testing them by hand
 * would be reimplementing a layout we did not do.
 */
import { BOARD_SIZE, shipClass } from "../../../shared/games/battleshipDisplay.js";
import type { ShipKind } from "../../../shared/games/battleshipDisplay.js";

export const ROWS = Array.from({ length: BOARD_SIZE }, (_, i) => i);

export type Cell = [number, number];

/** Where the ship in hand would land, and whether she may. */
export interface Preview {
  kind: ShipKind;
  size: number;
  row: number;
  col: number;
  horizontal: boolean;
  ok: boolean;
}

export function sameCell(a: Cell | null, b: Cell | null): boolean {
  return a !== null && b !== null && a[0] === b[0] && a[1] === b[1];
}

/** Every square a ship would take if it were dropped here. */
export function ghostCells(kind: ShipKind, row: number, col: number, horizontal: boolean): Cell[] {
  const size = shipClass(kind)?.size ?? 0;
  return Array.from({ length: size }, (_, i) =>
    horizontal ? [row, col + i] : [row + i, col],
  );
}

/** Clamped to the board, so a cursor walked off the edge stops at it. */
export function step([row, col]: Cell, dr: number, dc: number): Cell {
  return [
    Math.min(BOARD_SIZE - 1, Math.max(0, row + dr)),
    Math.min(BOARD_SIZE - 1, Math.max(0, col + dc)),
  ];
}

export const ARROWS: Record<string, [number, number]> = {
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
export function cellUnder(x: number, y: number): Cell | null {
  const found = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
  if (!found) return null;
  const row = Number(found.dataset.row);
  const col = Number(found.dataset.col);
  return Number.isInteger(row) && Number.isInteger(col) ? [row, col] : null;
}

export interface Pointer {
  onDown(cell: Cell): void;
  onMoveTo(cell: Cell): void;
  onUp(): void;
}
