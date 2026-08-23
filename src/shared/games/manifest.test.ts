import { describe, it, expect } from 'vitest';
import { GAMES, manifestIsComplete } from './index.js';
import { GAME_MANIFEST, clampSeats, gameEntry, gameList } from './manifest.js';

describe('the manifest', () => {
  it('agrees with every definition it names', () => {
    // The lobby sizes its table from the manifest while the room sizes itself
    // from the definition. A disagreement is a room that can never fill.
    expect(manifestIsComplete()).toBe(true);
  });

  it('names every registered game, and no others', () => {
    expect(new Set(gameList().map((g) => g.id))).toEqual(new Set(Object.keys(GAMES)));
  });

  it('offers a seat range that makes sense', () => {
    for (const game of gameList()) {
      expect(game.minPlayers, game.id).toBeGreaterThanOrEqual(2);
      expect(game.maxPlayers, game.id).toBeGreaterThanOrEqual(game.minPlayers);
      expect(game.name.length, game.id).toBeGreaterThan(0);
    }
  });

  it('finds a game by id and shrugs at one it does not have', () => {
    expect(gameEntry(GAME_MANIFEST.wheel.id)?.maxPlayers).toBe(4);
    expect(gameEntry('chess')).toBeUndefined();
  });
});

/**
 * `canAct` is what every control on every board is now gated on, so the ways
 * it can be wrong are ways a player is locked out of their own game — or shown
 * a button the server will refuse. These hold the parts that are true of all
 * ten regardless of how they are played.
 */
describe('canAct, across every game', () => {
  const seeded = (): (() => number) => {
    // Fixed so a failure names a state somebody can get back to.
    let n = 12345;
    return () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  };

  for (const [id, game] of Object.entries(GAMES)) {
    it(`${id}: refuses every seat once the game is over`, () => {
      const rng = seeded();
      const now = 1_700_000_000_000;
      let state = game.setup(game.minPlayers, rng, now);
      // Run the clock out rather than playing to a finish: every game that can
      // end on time ends here, and the ones that cannot are unchanged by it.
      state = game.expire?.(game.start?.(state, now) ?? state, now + 60 * 60 * 1000) ?? state;
      if (!game.isOver(state)) return; // untimed — the seat check below still applies
      for (let seat = 0; seat < game.maxPlayers; seat++) {
        expect(game.canAct(state, seat, now), `seat ${seat}`).toBe(false);
      }
    });

    it(`${id}: refuses a seat that is not at the table`, () => {
      const rng = seeded();
      const now = 1_700_000_000_000;
      const state = game.start?.(game.setup(game.minPlayers, rng, now), now) ??
        game.setup(game.minPlayers, rng, now);
      // -1 is the view built for a socket with no seat, and `maxPlayers` is one
      // past the last real one. Neither is a player, and a game that says yes
      // to either is a game a spectator can play.
      for (const seat of [-1, game.maxPlayers, 99]) {
        expect(game.canAct(state, seat, now), `seat ${seat}`).toBe(false);
      }
    });

    it(`${id}: never lets a seat act that turn says is not playing, unless the game is simultaneous`, () => {
      const rng = seeded();
      const now = 1_700_000_000_000;
      const state = game.start?.(game.setup(game.minPlayers, rng, now), now) ??
        game.setup(game.minPlayers, rng, now);
      const acting = [];
      for (let seat = 0; seat < game.minPlayers; seat++) {
        if (game.canAct(state, seat, now)) acting.push(seat);
      }
      // Either exactly one seat is on, and it is the one `turn` names — or
      // several are, which is what free-simultaneous means and is why `turn`
      // is documented as a hint rather than a gate.
      if (acting.length === 1) expect(acting[0]).toBe(game.turn(state));
      else expect(acting.length).toBeGreaterThan(1);
    });
  }
});

describe('clamping a table', () => {
  const range = { minPlayers: 2, maxPlayers: 4 };

  it('honours a count the game can seat', () => {
    expect(clampSeats(range, 2)).toBe(2);
    expect(clampSeats(range, 3)).toBe(3);
    expect(clampSeats(range, 4)).toBe(4);
  });

  it('pulls a count that is out of range back into it', () => {
    expect(clampSeats(range, 1)).toBe(2);
    expect(clampSeats(range, 99)).toBe(4);
  });

  it('falls back to the smallest table on anything it cannot read', () => {
    // A room waiting on more players than will ever turn up is a room nobody
    // can play in, so nonsense fails toward "playable".
    for (const bad of [undefined, NaN, 0, -3, Infinity]) {
      expect(clampSeats(range, bad as number), String(bad)).toBe(2);
    }
  });

  it('leaves a fixed-size game fixed whatever it is asked for', () => {
    const two = { minPlayers: 2, maxPlayers: 2 };
    for (const asked of [undefined, 1, 2, 4, 99]) {
      expect(clampSeats(two, asked as number)).toBe(2);
    }
  });
});
