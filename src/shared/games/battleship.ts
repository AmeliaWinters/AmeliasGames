import type { GameDefinition, MoveResult, Rng } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { pick } from './random.js';
import {
  BOARD_SIZE,
  FLEET,
  HIDDEN_AT,
  afloat,
  canAct,
  fleetReady,
  isSunk,
  opponentOf,
  placementError,
  shipAt,
  shipClass,
  shotAt,
  squareName,
  unplaced,
} from './battleshipDisplay.js';

import type { BsMove, BsState, Ship, ShipKind, Shot } from './battleshipDisplay.js';

// Re-exported so the reducer, its tests and the board all name these in one
// place, exactly as Word Duel does.
export {
  BOARD_SIZE,
  FLEET,
  HIDDEN_AT,
  afloat,
  canAct,
  fleetReady,
  isHidden,
  isSunk,
  opponentOf,
  placementError,
  shipAt,
  shipCells,
  shipClass,
  shotAt,
  squareName,
  unplaced,
} from './battleshipDisplay.js';
export type { BsMove, BsState, Ship, ShipClass, ShipKind, Shot } from './battleshipDisplay.js';

/**
 * Battleships, in two halves that behave quite differently.
 *
 * 1. **Placing is free-simultaneous.** Both admirals set out at once and
 *    neither waits on the other, so `turn` reports whoever is still working
 *    purely as a hint for the status line — `applyMove` never consults it
 *    while placing. Anything deciding whether a player may act must ask
 *    `canAct`.
 *
 * 2. **A hit earns another shot.** The guns pass on a miss and only on a miss,
 *    which is how the game is played on paper: finding a ship and then walking
 *    along her is the whole hunt, and a turn that ended at the first hit would
 *    throw that away. It does mean a hot streak can finish things quickly —
 *    that is the game, not a bug in it.
 *
 * The secret is the fleet: where it is, and which ship a hit landed on. A shot
 * report says hit, miss, or sunk and nothing more, exactly as it does across a
 * table. `view()` is the only thing keeping any of it — every other function
 * here is written as though positions were public, because on the server they
 * are.
 */

function emptyState(): BsState {
  return {
    phase: 'placing',
    fleets: [[], []],
    shots: [[], []],
    turn: 0,
    winner: null,
  };
}

function isOver(state: BsState): boolean {
  return state.phase === 'over';
}

/** A fresh ship of a class, undamaged, indexed bow to stern. */
function makeShip(kind: ShipKind, row: number, col: number, horizontal: boolean): Ship {
  const size = shipClass(kind)?.size ?? 0;
  return { kind, row, col, horizontal, hits: Array<boolean>(size).fill(false) };
}

/**
 * Both fleets down means the shooting starts. Seat 0 fires first, which is a
 * real advantage in this game — and the same advantage seat 0 has in every
 * other game here, so it stays where players expect to find it.
 */
function sail(state: BsState): BsState {
  if (state.phase !== 'placing') return state;
  if (!state.fleets.every(fleetReady)) return state;
  return { ...state, phase: 'firing', turn: 0 };
}

function place(
  state: BsState,
  move: Extract<BsMove, { type: 'place' }>,
  seat: number,
): MoveResult<BsState> {
  if (state.phase !== 'placing') {
    return { ok: false, error: 'The fleets have sailed — no moving them now.' };
  }
  const fleet = state.fleets[seat];
  const why = placementError(fleet, move.kind, move.row, move.col, Boolean(move.horizontal));
  if (why) return { ok: false, error: why };

  const fleets = state.fleets.slice();
  fleets[seat] = fleet.concat(makeShip(move.kind, move.row, move.col, Boolean(move.horizontal)));
  return { ok: true, state: sail({ ...state, fleets }) };
}

function unplace(state: BsState, kind: ShipKind, seat: number): MoveResult<BsState> {
  if (state.phase !== 'placing') {
    return { ok: false, error: 'The fleets have sailed — no moving them now.' };
  }
  const fleet = state.fleets[seat];
  if (!fleet.some((ship) => ship.kind === kind)) {
    return { ok: false, error: 'That ship is not out yet.' };
  }
  const fleets = state.fleets.slice();
  fleets[seat] = fleet.filter((ship) => ship.kind !== kind);
  return { ok: true, state: { ...state, fleets } };
}

/**
 * Fill whatever is left of a fleet at random — the "just deal me a board"
 * button, and the reason this game takes an rng at all.
 *
 * Rejection sampling with a bounded number of tries rather than a clever
 * search: five ships on a hundred squares is roomy enough that a legal spot
 * turns up almost at once, and a reducer that could loop forever is a worse
 * trade than one that occasionally gives up. Giving up leaves the fleet
 * part-placed, which the player can see and finish by hand.
 */
function scatterInto(fleet: Ship[], rng: Rng): Ship[] {
  const placed = fleet.slice();
  for (const cls of unplaced(placed)) {
    for (let attempt = 0; attempt < 200; attempt++) {
      // `pick` rather than arithmetic on `rng()` directly: it is the one place
      // that guards an rng returning exactly 1 or NaN, and a column 10 here
      // would be a ship placed off the board.
      const horizontal = pick(rng, 2) === 0;
      const row = pick(rng, BOARD_SIZE);
      const col = pick(rng, BOARD_SIZE);
      if (placementError(placed, cls.kind, row, col, horizontal) === null) {
        placed.push(makeShip(cls.kind, row, col, horizontal));
        break;
      }
    }
  }
  return placed;
}

function scatter(state: BsState, seat: number, rng: Rng): MoveResult<BsState> {
  if (state.phase !== 'placing') {
    return { ok: false, error: 'The fleets have sailed — no moving them now.' };
  }
  const fleets = state.fleets.slice();
  fleets[seat] = scatterInto(state.fleets[seat], rng);
  return { ok: true, state: sail({ ...state, fleets }) };
}

function fire(state: BsState, row: number, col: number, seat: number): MoveResult<BsState> {
  if (state.phase === 'placing') return { ok: false, error: 'Both fleets are still setting out.' };
  if (state.phase === 'over') return { ok: false, error: 'The game is already over.' };
  if (state.turn !== seat) return { ok: false, error: 'It is not your turn.' };
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return { ok: false, error: 'That is not a square.' };
  }
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    return { ok: false, error: 'That square is off the board.' };
  }
  if (shotAt(state.shots[seat], row, col) !== null) {
    return { ok: false, error: `You have already fired at ${squareName(row, col)}.` };
  }

  const them = opponentOf(seat);
  const target = shipAt(state.fleets[them], row, col);

  // Damage is recorded on the ship rather than counted out of the shot log, so
  // "is she sunk" stays a question about the ship and not a search.
  const fleets = state.fleets.slice();
  let sunk: ShipKind | null = null;
  if (target) {
    const index = target.horizontal ? col - target.col : row - target.row;
    const hits = target.hits.slice();
    hits[index] = true;
    const damaged: Ship = { ...target, hits };
    fleets[them] = state.fleets[them].map((ship) => (ship === target ? damaged : ship));
    if (isSunk(damaged)) sunk = damaged.kind;
  }

  const shots = state.shots.slice();
  const shot: Shot = { row, col, hit: target !== null, sunk };
  shots[seat] = state.shots[seat].concat(shot);

  const won = afloat(fleets[them]).length === 0;
  return {
    ok: true,
    state: {
      ...state,
      fleets,
      shots,
      // A hit earns another shot; only a miss hands the guns over.
      turn: (target ? seat : them) as 0 | 1,
      phase: won ? 'over' : 'firing',
      winner: won ? seat : null,
    },
  };
}

export const battleship: GameDefinition<BsState, BsMove> = {
  id: GAME_MANIFEST.battleship.id,
  name: GAME_MANIFEST.battleship.name,
  minPlayers: 2,
  maxPlayers: 2,

  // Both fleets come from the players, so there is nothing to deal at setup.
  setup(): BsState {
    return emptyState();
  },

  applyMove(state, move, seat, rng): MoveResult<BsState> {
    if (seat !== 0 && seat !== 1) return { ok: false, error: 'You are not playing.' };
    if (!move || typeof move !== 'object') return { ok: false, error: 'Unknown move.' };

    switch (move.type) {
      case 'place':
        return place(state, move, seat);
      case 'unplace':
        return unplace(state, move.kind, seat);
      case 'scatter':
        return scatter(state, seat, rng);
      case 'fire':
        return fire(state, move.row, move.col, seat);
      default:
        return { ok: false, error: 'Unknown move.' };
    }
  },

  /*
   * There was an `allowsEarlyMove` here, letting a fleet be placed while the
   * room was still short an admiral — placing is private, simultaneous, and
   * most of the waiting, and the room used to refuse every move until the
   * invite was answered.
   *
   * Open seating removed the need for it: a room is dealt only once the people
   * in it say they are all here, so there is no longer any such thing as a
   * game in progress that is still waiting for somebody.
   */

  /**
   * While firing this is the whole truth. While placing it is a hint for the
   * status line only — see the note at the top of this file. Ties go to seat 0
   * so this stays a pure function of the state.
   */
  turn(state) {
    if (isOver(state)) return null;
    if (state.phase === 'firing') return state.turn;
    if (canAct(state, 0)) return 0;
    if (canAct(state, 1)) return 1;
    return null;
  },

  isOver,

  status(state, names) {
    const nameFor = (seat: number) => names[seat] ?? `Player ${seat + 1}`;

    if (state.phase === 'placing') {
      const waiting = [0, 1].filter((seat) => !fleetReady(state.fleets[seat]));
      if (waiting.length === 2) return 'Both fleets are putting to sea';
      return `Waiting for ${nameFor(waiting[0])} to finish placing`;
    }

    if (state.phase === 'over') {
      const winner = state.winner ?? 0;
      const shots = state.shots[winner].length;
      return `${nameFor(winner)} sinks the fleet in ${shots} shots`;
    }

    // The last shot is the news. Finding it takes a moment's care now that a
    // hit keeps the guns: the player to fire only ever gets them back off a
    // miss, so their own last shot being a hit means they are mid-streak and
    // that shot is the most recent one on the water. Otherwise the news is the
    // miss that handed them the guns.
    const streak = state.shots[state.turn].at(-1);
    const last = streak?.hit ? streak : state.shots[opponentOf(state.turn)].at(-1);
    // Hit, miss, or the name of a ship that has gone down — the three things
    // called out across a table, and never which ship a mere hit landed on.
    const report = !last
      ? ''
      : last.sunk
        ? ` — the ${shipClass(last.sunk)?.name} is sunk`
        : last.hit
          ? ' — a hit'
          : ' — a miss';
    return `${nameFor(state.turn)} to fire${streak?.hit ? ' again' : ''}${report}`;
  },

  /**
   * The secret: where the enemy ships are, and which of them a hit landed on.
   *
   * The second half matters as much as the first. You know perfectly well
   * which squares you have hit — you fired at them and watched — but on paper
   * nobody tells you that two of those hits were the same cruiser. Working
   * that out is the game. So an enemy ship that is still afloat is sent with
   * her position blanked *and* her damage wiped: everything the board draws
   * about your shots it draws from your own shot log.
   *
   * A ship that has gone down is revealed outright, damage and all: her
   * position is exactly what the hits that sank her already spelled out, and
   * drawing the wreck is the payoff for finding her. The fleet keeps its
   * length either way, so the board can tell "ready" from "still setting out"
   * without being told where anything is.
   *
   * Once the game is over the whole sea is shown, so the loser finds out where
   * that last destroyer was hiding.
   */
  view(state, seat) {
    if (state.phase === 'over') return state;
    return {
      ...state,
      fleets: state.fleets.map((fleet, index) =>
        index === seat
          ? fleet
          : fleet.map((ship) =>
              isSunk(ship)
                ? ship
                : {
                    ...ship,
                    row: HIDDEN_AT,
                    col: HIDDEN_AT,
                    // Length, not damage: the board needs her size to draw a
                    // roster row, and must not learn where she has been hit.
                    hits: ship.hits.map(() => false),
                  },
            ),
      ),
    };
  },
};

/** Squares a whole fleet covers. Exported for the tests that count them. */
export const FLEET_SQUARES = FLEET.reduce((total, cls) => total + cls.size, 0);
