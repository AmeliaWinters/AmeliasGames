import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  FLEET,
  FLEET_SQUARES,
  afloat,
  battleship,
  canAct,
  fleetReady,
  isHidden,
  isSunk,
  placementError,
  shipCells,
  shotLog,
  squareName,
  unplaced,
} from './battleship.js';
import type { BsMove, BsState, Ship } from './battleship.js';
import type { Rng } from '../types.js';

/** Randomness is only ever consulted by `scatter`, so everything else gets this. */
const noRng: Rng = () => {
  throw new Error('this move must not use randomness');
};

/** A deterministic stand-in, so a scattered fleet is the same fleet every run. */
function seeded(seed: number): Rng {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

function fresh(): BsState {
  return battleship.setup(2, noRng);
}

function play(state: BsState, move: BsMove, seat: number, rng = noRng): BsState {
  const result = battleship.applyMove(state, move, seat, rng);
  if (!result.ok) throw new Error(`move rejected: ${result.error}`);
  return result.state;
}

function refuse(state: BsState, move: unknown, seat: number, rng = noRng): string {
  const result = battleship.applyMove(state, move as BsMove, seat, rng);
  if (result.ok) throw new Error('expected the move to be rejected');
  return result.error;
}

/**
 * A fleet in five tidy rows, so every test below can name a square and know
 * exactly what is under it: row 0 carrier (A1-A5), row 2 battleship (C1-C4),
 * row 4 cruiser, row 6 submarine, row 8 destroyer. Nothing reaches past column
 * 4, so the right-hand columns are open water for the shots that only need to
 * miss.
 */
const ROWS: Array<[number, number]> = [
  [0, 0],
  [2, 0],
  [4, 0],
  [6, 0],
  [8, 0],
];

function laidOut(state: BsState, seat: number): BsState {
  let next = state;
  FLEET.forEach((cls, i) => {
    const [row, col] = ROWS[i];
    next = play(next, { type: 'place', kind: cls.kind, row, col, horizontal: true }, seat);
  });
  return next;
}

/** Both fleets down, seat 0 to fire. */
function firing(): BsState {
  return laidOut(laidOut(fresh(), 0), 1);
}

/** Every square of a seat's fleet, for the tests that sink one wholesale. */
function fleetCells(state: BsState, seat: number): Array<[number, number]> {
  return state.fleets[seat].flatMap(shipCells);
}

describe('setting out', () => {
  it('starts with two empty seas and nobody ready', () => {
    const state = fresh();
    expect(state.phase).toBe('placing');
    expect(state.fleets).toEqual([[], []]);
    expect(state.shots).toEqual([[], []]);
    expect(fleetReady(state.fleets[0])).toBe(false);
    expect(unplaced(state.fleets[0]).length).toBe(FLEET.length);
  });

  it('lets both players place at once, neither waiting on the other', () => {
    let state = fresh();
    state = play(state, { type: 'place', kind: 'carrier', row: 0, col: 0, horizontal: true }, 1);
    state = play(state, { type: 'place', kind: 'carrier', row: 0, col: 0, horizontal: true }, 0);
    // Seat 1 moved first and seat 0 was not blocked by it: placing is
    // free-simultaneous, and `turn` never gates it.
    expect(state.fleets[0].length).toBe(1);
    expect(state.fleets[1].length).toBe(1);
    expect(canAct(state, 0)).toBe(true);
    expect(canAct(state, 1)).toBe(true);
  });

  it('refuses a ship that hangs off the board', () => {
    const state = fresh();
    expect(
      refuse(state, { type: 'place', kind: 'carrier', row: 0, col: 6, horizontal: true }, 0),
    ).toMatch(/hang off/);
    expect(
      refuse(state, { type: 'place', kind: 'carrier', row: 6, col: 0, horizontal: false }, 0),
    ).toMatch(/hang off/);
  });

  it('refuses a ship that would sit on another', () => {
    const state = play(
      fresh(),
      { type: 'place', kind: 'carrier', row: 0, col: 0, horizontal: true },
      0,
    );
    expect(
      refuse(state, { type: 'place', kind: 'cruiser', row: 0, col: 4, horizontal: false }, 0),
    ).toMatch(/on another ship/);
  });

  it('allows ships to touch, as they may in the boxed game', () => {
    let state = play(
      fresh(),
      { type: 'place', kind: 'carrier', row: 0, col: 0, horizontal: true },
      0,
    );
    state = play(state, { type: 'place', kind: 'cruiser', row: 1, col: 0, horizontal: true }, 0);
    expect(state.fleets[0].length).toBe(2);
  });

  it('refuses a second ship of the same class, and takes one back', () => {
    let state = play(
      fresh(),
      { type: 'place', kind: 'cruiser', row: 0, col: 0, horizontal: true },
      0,
    );
    expect(
      refuse(state, { type: 'place', kind: 'cruiser', row: 5, col: 0, horizontal: true }, 0),
    ).toMatch(/already out/);
    state = play(state, { type: 'unplace', kind: 'cruiser' }, 0);
    expect(state.fleets[0]).toEqual([]);
    expect(refuse(state, { type: 'unplace', kind: 'cruiser' }, 0)).toMatch(/not out yet/);
  });

  it('starts firing only once both fleets are down', () => {
    const half = laidOut(fresh(), 0);
    expect(half.phase).toBe('placing');
    expect(canAct(half, 0)).toBe(false);
    expect(refuse(half, { type: 'fire', row: 0, col: 0 }, 0)).toMatch(/still setting out/);

    const both = laidOut(half, 1);
    expect(both.phase).toBe('firing');
    expect(both.turn).toBe(0);
    expect(battleship.turn(both)).toBe(0);
  });

  it('will not move a ship once the fleets have sailed', () => {
    const state = firing();
    expect(refuse(state, { type: 'unplace', kind: 'cruiser' }, 0)).toMatch(/sailed/);
    expect(
      refuse(state, { type: 'place', kind: 'carrier', row: 9, col: 0, horizontal: true }, 0),
    ).toMatch(/sailed/);
  });
});

describe('scattering a fleet', () => {
  it('fills the fleet legally, and repeats exactly for the same rng', () => {
    const a = play(fresh(), { type: 'scatter' }, 0, seeded(7));
    const b = play(fresh(), { type: 'scatter' }, 0, seeded(7));
    expect(a.fleets[0]).toEqual(b.fleets[0]);
    expect(fleetReady(a.fleets[0])).toBe(true);

    const cells = fleetCells(a, 0).map(([r, c]) => `${r},${c}`);
    // No square used twice, and every one of them on the board.
    expect(new Set(cells).size).toBe(FLEET_SQUARES);
    for (const [r, c] of fleetCells(a, 0)) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(BOARD_SIZE);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(BOARD_SIZE);
    }
  });

  it('leaves ships already placed exactly where they were', () => {
    const one = play(
      fresh(),
      { type: 'place', kind: 'destroyer', row: 9, col: 8, horizontal: true },
      0,
    );
    const full = play(one, { type: 'scatter' }, 0, seeded(3));
    expect(full.fleets[0][0]).toEqual(one.fleets[0][0]);
    expect(fleetReady(full.fleets[0])).toBe(true);
  });

  it('produces a legal board from any rng, however badly it behaves', () => {
    for (const rng of [() => 0, () => 0.999999, seeded(1), seeded(99)]) {
      const state = play(fresh(), { type: 'scatter' }, 0, rng);
      // A pathological rng may fail to seat every ship, but never an illegal
      // one, and the fleet it does seat has to be playable by hand from there.
      const cells = fleetCells(state, 0).map(([r, c]) => `${r},${c}`);
      expect(new Set(cells).size).toBe(cells.length);
      for (const ship of state.fleets[0]) {
        const rest = state.fleets[0].filter((other) => other !== ship);
        expect(placementError(rest, ship.kind, ship.row, ship.col, ship.horizontal)).toBeNull();
      }
    }
  });
});

describe('firing', () => {
  it('keeps the guns on a hit and hands them over on a miss', () => {
    let state = firing();
    state = play(state, { type: 'fire', row: 0, col: 0 }, 0);
    expect(state.shots[0][0].hit).toBe(true);
    expect(state.turn).toBe(0);

    // Walking along the carrier: every hit buys another shot.
    state = play(state, { type: 'fire', row: 0, col: 1 }, 0);
    expect(state.turn).toBe(0);
    expect(refuse(state, { type: 'fire', row: 9, col: 9 }, 1)).toMatch(/not your turn/);

    state = play(state, { type: 'fire', row: 9, col: 9 }, 0);
    expect(state.shots[0].at(-1)?.hit).toBe(false);
    expect(state.turn).toBe(1);
  });

  it('gives another shot for the hit that sinks a ship, and for the first hit of a game', () => {
    let state = firing();
    // The destroyer is two long at I1-I2: hit, sink, and still holding the guns.
    state = play(state, { type: 'fire', row: 8, col: 0 }, 0);
    state = play(state, { type: 'fire', row: 8, col: 1 }, 0);
    expect(state.shots[0].at(-1)?.sunk).toBe('destroyer');
    expect(state.turn).toBe(0);
  });

  it('refuses a shot out of turn, off the board, or at a square already fired at', () => {
    let state = firing();
    expect(refuse(state, { type: 'fire', row: 0, col: 0 }, 1)).toMatch(/not your turn/);
    expect(refuse(state, { type: 'fire', row: -1, col: 0 }, 0)).toMatch(/off the board/);
    expect(refuse(state, { type: 'fire', row: 0, col: BOARD_SIZE }, 0)).toMatch(/off the board/);
    expect(refuse(state, { type: 'fire', row: 1.5, col: 0 }, 0)).toMatch(/not a square/);

    state = play(state, { type: 'fire', row: 9, col: 9 }, 0);
    state = play(state, { type: 'fire', row: 9, col: 9 }, 1);
    expect(refuse(state, { type: 'fire', row: 9, col: 9 }, 0)).toMatch(/already fired at A?9?/);
    // Both fired at the same square, and both shots stand: the two boards are
    // separate seas.
    expect(state.shots[0]).toHaveLength(1);
    expect(state.shots[1]).toHaveLength(1);
  });

  it('reports a sinking on the shot that finishes her', () => {
    let state = firing();
    // The destroyer is two long at I1-I2.
    state = play(state, { type: 'fire', row: 8, col: 0 }, 0);
    expect(state.shots[0].at(-1)?.sunk).toBeNull();
    state = play(state, { type: 'fire', row: 8, col: 1 }, 0);

    const shot = state.shots[0].at(-1);
    expect(shot?.hit).toBe(true);
    expect(shot?.sunk).toBe('destroyer');
    const destroyer = state.fleets[1].find((ship) => ship.kind === 'destroyer') as Ship;
    expect(isSunk(destroyer)).toBe(true);
    expect(afloat(state.fleets[1])).toHaveLength(FLEET.length - 1);
    expect(state.phase).toBe('firing');
  });

  it('ends the moment the last ship goes down, and not before', () => {
    let state = firing();
    // Seventeen hits in a row, and seat 1 never gets the guns at all: the
    // price of a rule that rewards finding a ship.
    for (const [row, col] of fleetCells(state, 1)) {
      expect(battleship.isOver(state)).toBe(false);
      state = play(state, { type: 'fire', row, col }, 0);
    }

    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(state.shots[0]).toHaveLength(FLEET_SQUARES);
    expect(battleship.turn(state)).toBeNull();
    expect(canAct(state, 0)).toBe(false);
    expect(refuse(state, { type: 'fire', row: 9, col: 9 }, 1)).toMatch(/already over/);
    expect(battleship.status(state, ['Amelia', 'Sam'])).toBe(
      `Amelia sinks the fleet in ${FLEET_SQUARES} shots`,
    );
  });

  it('never mutates the state it was given', () => {
    const before = firing();
    const snapshot = JSON.stringify(before);
    play(before, { type: 'fire', row: 0, col: 0 }, 0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('shrugs at a move it does not know', () => {
    const state = firing();
    for (const move of [null, undefined, 'fire', { type: 'nuke' }, {}]) {
      expect(refuse(state, move, 0)).toMatch(/Unknown move/);
    }
    expect(refuse(state, { type: 'fire', row: 0, col: 0 }, 5)).toMatch(/not playing/);
  });
});

describe('what a player is shown', () => {
  const view = (state: BsState, seat: number) => battleship.view!(state, seat);

  it('hides where the enemy fleet is, while still saying how big it is', () => {
    const state = firing();
    const seen = view(state, 0);

    expect(seen.fleets[0]).toEqual(state.fleets[0]);
    expect(seen.fleets[1]).toHaveLength(FLEET.length);
    expect(seen.fleets[1].every(isHidden)).toBe(true);
    // The strongest form of the claim: no enemy square appears anywhere in
    // what is sent, so there is nothing to read out of the payload.
    expect(seen.fleets[1].flatMap(shipCells)).toEqual([]);
    expect(fleetReady(seen.fleets[1])).toBe(true);
  });

  it('tells "ready" apart from "still setting out"', () => {
    const half = laidOut(fresh(), 1);
    expect(fleetReady(view(half, 0).fleets[1])).toBe(true);
    expect(fleetReady(view(fresh(), 0).fleets[1])).toBe(false);
  });

  it('hides which enemy ship a hit landed on, until she goes down', () => {
    let state = firing();
    // One hit on the carrier at A1, which leaves her afloat.
    state = play(state, { type: 'fire', row: 0, col: 0 }, 0);
    const carrier = view(state, 0).fleets[1].find((ship) => ship.kind === 'carrier') as Ship;
    expect(carrier.hits).toEqual([false, false, false, false, false]);
    expect(isHidden(carrier)).toBe(true);
    // The shooter's own record of the shot is untouched: they know the square
    // was a hit, just not whose it was.
    expect(state.shots[0].at(-1)).toMatchObject({ row: 0, col: 0, hit: true, sunk: null });
    // And seat 1's own view of her own fleet is the truth, damage and all.
    expect(view(state, 1).fleets[1]).toEqual(state.fleets[1]);
  });

  it('shows the wreck of a ship that has been sunk', () => {
    let state = firing();
    state = play(state, { type: 'fire', row: 8, col: 0 }, 0);
    state = play(state, { type: 'fire', row: 8, col: 1 }, 0);

    const seen = view(state, 0);
    const destroyer = seen.fleets[1].find((ship) => ship.kind === 'destroyer') as Ship;
    expect(isHidden(destroyer)).toBe(false);
    expect(shipCells(destroyer)).toEqual([
      [8, 0],
      [8, 1],
    ]);
    // Her neighbours keep their secret.
    expect(seen.fleets[1].filter(isHidden)).toHaveLength(FLEET.length - 1);
  });

  it('opens the whole sea once the game is over', () => {
    let state = firing();
    for (const [row, col] of fleetCells(state, 1)) {
      state = play(state, { type: 'fire', row, col }, 0);
    }
    expect(view(state, 1)).toEqual(state);
  });
});

describe('the status line', () => {
  const names = ['Amelia', 'Sam'];

  it('names whoever is still placing', () => {
    expect(battleship.status(fresh(), names)).toMatch(/Both fleets/);
    expect(battleship.status(laidOut(fresh(), 0), names)).toBe(
      'Waiting for Sam to finish placing',
    );
  });

  it('reads back the last shot without saying which ship it found', () => {
    let state = firing();
    expect(battleship.status(state, names)).toBe('Amelia to fire');

    state = play(state, { type: 'fire', row: 9, col: 9 }, 0);
    expect(battleship.status(state, names)).toBe('Sam to fire, a miss');

    // Sam finds Amelia's carrier at A1 and keeps the guns.
    state = play(state, { type: 'fire', row: 0, col: 0 }, 1);
    expect(battleship.status(state, names)).toBe('Sam to fire again, a hit');

    // A ship going down is the one thing called out by name.
    state = play(state, { type: 'fire', row: 8, col: 0 }, 1);
    state = play(state, { type: 'fire', row: 8, col: 1 }, 1);
    expect(battleship.status(state, names)).toBe('Sam to fire again, and the Destroyer is sunk');

    // A miss hands them back, and the news is that miss rather than Sam's
    // earlier hits, which the line has already reported.
    state = play(state, { type: 'fire', row: 9, col: 9 }, 1);
    expect(battleship.status(state, names)).toBe('Amelia to fire, a miss');
  });

  it('falls back to seat numbers when nobody has a name', () => {
    expect(battleship.status(fresh(), [])).toMatch(/Both fleets/);
    expect(battleship.status(laidOut(fresh(), 1), [])).toBe(
      'Waiting for Player 1 to finish placing',
    );
  });
});

describe('naming a square', () => {
  it('reads across and down the way the board is labelled', () => {
    expect(squareName(0, 0)).toBe('A1');
    expect(squareName(9, 9)).toBe('J10');
    expect(squareName(2, 4)).toBe('C5');
  });
});

describe('the shot log', () => {
  it('reconstructs the order shots were fired in, streaks and all', () => {
    // Played through the reducer rather than hand-built, so the log is checked
    // against the turn order `fire` actually produced and not against a second
    // guess at the same rule. Seat 0 hits twice (keeping the guns), misses,
    // then seat 1 misses, and it comes back round.
    let state = firing();
    state = play(state, { type: 'fire', row: 0, col: 0 }, 0); // hit
    state = play(state, { type: 'fire', row: 0, col: 1 }, 0); // hit
    state = play(state, { type: 'fire', row: 9, col: 9 }, 0); // miss, guns pass
    state = play(state, { type: 'fire', row: 9, col: 8 }, 1); // miss, guns back
    state = play(state, { type: 'fire', row: 2, col: 0 }, 0); // hit

    expect(shotLog(state.shots).map((shot) => [shot.ordinal, shot.seat, shot.hit])).toEqual([
      [1, 0, true],
      [2, 0, true],
      [3, 0, false],
      [4, 1, false],
      [5, 0, true],
      // Seat 0 still holds the guns, so there is nothing of seat 1's after it.
    ]);
  });

  it('names the square and the ship a shot sank, in the log as on the board', () => {
    let state = firing();
    // The destroyer is two long, at I1-I2, so two shots finish her.
    state = play(state, { type: 'fire', row: 8, col: 0 }, 0);
    state = play(state, { type: 'fire', row: 8, col: 1 }, 0);
    const log = shotLog(state.shots);
    expect(log).toHaveLength(2);
    expect(squareName(log[1].row, log[1].col)).toBe('I2');
    expect(log[1].sunk).toBe('destroyer');
  });

  it('is empty before a shot is fired, and stops rather than looping on a log it cannot explain', () => {
    expect(shotLog(firing().shots)).toEqual([]);
    // Seat 1 cannot have fired before seat 0 did. The server will not produce
    // this; a snapshot from an older simulation might, and a viewer that hangs
    // on it would be worse than one that shows a short log.
    const impossible = [[], [{ row: 0, col: 0, hit: false, sunk: null }]];
    expect(shotLog(impossible)).toEqual([]);
  });
});
