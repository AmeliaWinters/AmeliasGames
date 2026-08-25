/**
 * The parts of Battleships the board may know. See the boundary note in
 * `types.ts`. Everything here is shape, geometry or a pure predicate over
 * state the client already holds, so none of it reveals anything new.
 *
 * What this file must never grow is knowledge of a hidden fleet: redaction
 * lives in `view()`, and every helper copes with a ship it cannot see.
 */

/** Ten by ten, lettered A-J down and numbered 1-10 across. */
export const BOARD_SIZE = 10;

export type ShipKind = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';

export interface ShipClass {
  kind: ShipKind;
  name: string;
  size: number;
}

/**
 * The standard five, longest first, which is also the order they are easiest
 * to place in, since the carrier is the one that runs out of room.
 */
export const FLEET: readonly ShipClass[] = [
  { kind: 'carrier', name: 'Carrier', size: 5 },
  { kind: 'battleship', name: 'Battleship', size: 4 },
  { kind: 'cruiser', name: 'Cruiser', size: 3 },
  { kind: 'submarine', name: 'Submarine', size: 3 },
  { kind: 'destroyer', name: 'Destroyer', size: 2 },
] as const;

/**
 * Where a ship sits, and which of its cells have been hit.
 *
 * `hits` is indexed along the ship from its bow at (row, col), so its length
 * still says how big she is once `view()` has blanked both her position and
 * her damage. Which ship a hit belonged to is a secret until she sinks, and
 * `hits` is where that secret would otherwise leak.
 */
export interface Ship {
  kind: ShipKind;
  row: number;
  col: number;
  horizontal: boolean;
  hits: boolean[];
}

/**
 * What `view()` puts where an enemy ship's position used to be. A sentinel
 * rather than dropping the ship from the fleet, because "they have five ships
 * placed" and "they are still setting out" are different things to the player
 * waiting on them, and a fleet with holes in it would make the readiness check
 * below a lie.
 *
 * Off the board by construction, so it can never collide with a real square.
 */
export const HIDDEN_AT = -1;

export interface Shot {
  row: number;
  col: number;
  hit: boolean;
  /** The class sunk by this shot, if it was the one that finished her off. */
  sunk: ShipKind | null;
}

export interface BsState {
  /**
   * `placing` while either admiral is still setting out, `firing` once both
   * fleets are down, `over` when one is entirely sunk. There is no phase in
   * which one player is shooting and the other is still placing: the first
   * shot would be at an empty sea.
   */
  phase: 'placing' | 'firing' | 'over';
  /** `fleets[s]` is what seat `s` owns: the fleet their opponent is hunting. */
  fleets: Ship[][];
  /** `shots[s]` is what seat `s` has fired AT their opponent. */
  shots: Shot[][];
  /** Whose shot it is. Meaningless during `placing`, where both players act. */
  turn: 0 | 1;
  winner: number | null;
}

export type BsMove =
  | { type: 'place'; kind: ShipKind; row: number; col: number; horizontal: boolean }
  | { type: 'unplace'; kind: ShipKind }
  | { type: 'scatter' }
  | { type: 'fire'; row: number; col: number };

/** The seat across the table. Two-player only, so this is the whole story. */
export function opponentOf(seat: number): number {
  return seat === 0 ? 1 : 0;
}

export function shipClass(kind: ShipKind): ShipClass | undefined {
  return FLEET.find((ship) => ship.kind === kind);
}

/** A ship whose position this client is not entitled to know. */
export function isHidden(ship: Ship): boolean {
  return ship.row === HIDDEN_AT || ship.col === HIDDEN_AT;
}

export function isSunk(ship: Ship): boolean {
  return ship.hits.length > 0 && ship.hits.every(Boolean);
}

/** Every square a ship occupies, bow first. Empty for a hidden one. */
export function shipCells(ship: Ship): Array<[number, number]> {
  if (isHidden(ship)) return [];
  return ship.hits.map((_, i) =>
    ship.horizontal
      ? ([ship.row, ship.col + i] as [number, number])
      : ([ship.row + i, ship.col] as [number, number]),
  );
}

/** The ship lying on a square, or null. Hidden ships lie nowhere. */
export function shipAt(fleet: Ship[], row: number, col: number): Ship | null {
  for (const ship of fleet) {
    if (shipCells(ship).some(([r, c]) => r === row && c === col)) return ship;
  }
  return null;
}

export function shotAt(shots: Shot[], row: number, col: number): Shot | null {
  return shots.find((shot) => shot.row === row && shot.col === col) ?? null;
}

/** A fleet is ready when every class in it is on the water. */
export function fleetReady(fleet: Ship[]): boolean {
  return FLEET.every((cls) => fleet.some((ship) => ship.kind === cls.kind));
}

/** The classes still waiting to be placed, in the order they are offered. */
export function unplaced(fleet: Ship[]): ShipClass[] {
  return FLEET.filter((cls) => !fleet.some((ship) => ship.kind === cls.kind));
}

/** Ships still afloat. What the enemy has left to find. */
export function afloat(fleet: Ship[]): Ship[] {
  return fleet.filter((ship) => !isSunk(ship));
}

/**
 * Why a ship cannot go there, or null if it can: the single arbiter of a
 * legal placement, so the reducer's answer and the board's hover preview can
 * never disagree. The reason is specific because "invalid" tells a player
 * nothing about whether to rotate or to move.
 */
export function placementError(
  fleet: Ship[],
  kind: ShipKind,
  row: number,
  col: number,
  horizontal: boolean,
): string | null {
  const cls = shipClass(kind);
  if (!cls) return 'No such ship.';
  if (fleet.some((ship) => ship.kind === cls.kind)) return `Your ${cls.name} is already out.`;
  if (!Number.isInteger(row) || !Number.isInteger(col)) return 'That is not a square.';

  const cells: Array<[number, number]> = Array.from({ length: cls.size }, (_, i) =>
    horizontal ? [row, col + i] : [row + i, col],
  );
  if (cells.some(([r, c]) => r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE)) {
    return `The ${cls.name} would hang off the board.`;
  }
  // Touching is allowed, as it is in the boxed game; overlapping is not.
  if (cells.some(([r, c]) => shipAt(fleet, r, c) !== null)) {
    return `The ${cls.name} would sit on another ship.`;
  }
  return null;
}

/** A1-style name for a square, for labels and for the shot log. */
export function squareName(row: number, col: number): string {
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

/**
 * Whether `seat` may move right now: the only question the UI should ask.
 *
 * Placing is free-simultaneous, so `room.turn` says nothing about whether you
 * personally may set a ship down; once firing starts it says everything, and a
 * player who has just hit still holds it. One predicate covering both is what
 * keeps that difference out of the board component.
 */
export function canAct(state: BsState, seat: number): boolean {
  if (seat !== 0 && seat !== 1) return false;
  if (state.phase === 'placing') return !fleetReady(state.fleets[seat]);
  if (state.phase === 'firing') return state.turn === seat;
  return false;
}

/** A shot, with the seat that fired it and where it fell in the whole game. */
export interface LoggedShot extends Shot {
  seat: number;
  /** 1-based, counting both seats: what the log prints down its left edge. */
  ordinal: number;
}

/**
 * Every shot of the game in the order it was fired, from the two per-seat
 * logs the state actually keeps.
 *
 * Nothing records that order, and nothing needs to: it is implied. Seat 0
 * fires first, a hit keeps the guns and a miss hands them over, so replaying
 * that one rule over the two lists reconstructs the sequence exactly. This is
 * the same rule `fire` applies, so if the two ever disagree the log is wrong,
 * which is why `battleship.test.ts` walks a played game through both.
 *
 * Derived rather than stored on purpose. A `history` array on `BsState` would
 * be a second account of what happened, free to drift from the first, and it
 * would have to be redacted in `view()` like everything else. This needs no
 * redaction because it reveals nothing the two shot logs did not already say.
 *
 * A malformed pair of lists (one longer than the alternation can explain,
 * which the server cannot produce but a replayed old snapshot might) ends the
 * walk rather than looping. Whatever is left over is dropped, because a short
 * log is readable and a hanging one is not.
 */
export function shotLog(shots: Shot[][]): LoggedShot[] {
  const taken = [0, 0];
  const total = (shots[0]?.length ?? 0) + (shots[1]?.length ?? 0);
  const log: LoggedShot[] = [];
  let seat = 0;
  for (let n = 0; n < total; n++) {
    const shot = shots[seat]?.[taken[seat]];
    if (!shot) break;
    taken[seat]++;
    log.push({ ...shot, seat, ordinal: n + 1 });
    if (!shot.hit) seat = opponentOf(seat);
  }
  return log;
}
