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
