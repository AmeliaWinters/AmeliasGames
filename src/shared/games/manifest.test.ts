import { describe, it, expect } from 'vitest';
import { GAMES, manifestIsComplete } from './index.js';
import { GAME_MANIFEST, SHELVES, clampSeats, gameEntry, gameList, shelvedGames } from './manifest.js';

describe('the manifest', () => {
  it('agrees with every definition it names', () => {
    // The lobby sizes its table from the manifest while the room sizes itself
    // from the definition. A disagreement is a room that can never fill.
    expect(manifestIsComplete()).toBe(true);
  });

  it('names every registered game, and no others', () => {
    expect(new Set(gameList().map((g) => g.id))).toEqual(new Set(Object.keys(GAMES)));
  });

  /**
   * One, not two. The floor was two for as long as every game needed somebody
   * else, and Drill is the case that was always allowed by the engine and
   * never taken: `canStart` is `short() === 0`, and `canSeat` and `clampSeats`
   * both handle a minimum of one. A solo review is a real thing to want on a
   * Tuesday, and the alternative to letting a game say so is a second way to
   * run one.
   */
  it('offers a seat range that makes sense', () => {
    for (const game of gameList()) {
      expect(game.minPlayers, game.id).toBeGreaterThanOrEqual(1);
      expect(game.maxPlayers, game.id).toBeGreaterThanOrEqual(game.minPlayers);
      expect(game.name.length, game.id).toBeGreaterThan(0);
    }
  });

  it('finds a game by id and shrugs at one it does not have', () => {
    expect(gameEntry(GAME_MANIFEST.wheel.id)?.maxPlayers).toBe(4);
    expect(gameEntry('chess')).toBeUndefined();
  });

  /**
   * The blurbs, held to the two lines the lobby reserves for them.
   *
   * `picker.css` gives every card the same height by reserving a fixed number
   * of lines for the name and a fixed number for the blurb -- which is the
   * only thing making the grid even, since three of the thirteen names wrap
   * and ten do not. A blurb that runs to one line more than the reserve does
   * not overflow its own card; it pushes its whole grid row taller than the
   * row above it, and the unevenness reads as the bug it is two rows further
   * down, nowhere near the sentence that caused it.
   *
   * That failure is measurable and was shipped twice in one afternoon while
   * this screen was being built, so it is pinned here rather than left to
   * somebody re-measuring a phone. 42 characters is the budget at 375px; the
   * narrowest phone gets a third line reserved for it in the stylesheet, so
   * this is the number that has to hold.
   */
  it('gives every game a blurb that fits the card', () => {
    const BUDGET = 42;
    for (const game of gameList()) {
      expect(game.blurb.length, `${game.id}: "${game.blurb}"`).toBeGreaterThan(0);
      expect(
        game.blurb.length,
        `${game.id}: "${game.blurb}" is ${game.blurb.length} characters; the card ` +
          `reserves two lines, which is about ${BUDGET}. A longer one makes its ` +
          'whole grid row taller than its neighbours.',
      ).toBeLessThanOrEqual(BUDGET);
      // A sentence, because it is read as one beneath a name in caps.
      expect(game.blurb, game.id).toMatch(/^[A-Z].*\.$/s);
    }
  });


  /**
   * The shelves, held to covering the shelf exactly once.
   *
   * The lobby draws three sections and a tally over each, and both come from
   * `shelvedGames`. A game on a shelf nobody stands is a game that has quietly
   * left the lobby -- it still has a card, a hue and a motif, and no screen
   * shows it. That is invisible from the code and obvious to the one person
   * who went looking for Yahtzee.
   */
  it('stands every game on exactly one shelf that the lobby draws', () => {
    const shelved = shelvedGames().flatMap((shelf) => shelf.games.map((game) => game.id));
    expect(shelved.sort()).toEqual(gameList().map((game) => game.id).sort());
    expect(new Set(shelved).size).toBe(shelved.length);
    for (const game of gameList()) {
      expect(SHELVES.map((shelf) => shelf.id), game.id).toContain(game.shelf);
    }
  });

  it('leaves no shelf empty, so no heading stands over nothing', () => {
    for (const shelf of shelvedGames()) {
      expect(shelf.games.length, shelf.label).toBeGreaterThan(0);
    }
  });

  /**
   * The featured game comes out of the shelves in here rather than in the
   * lobby, which is the whole reason a tally can be trusted: the heading counts
   * the same array the cards under it are drawn from.
   */
  it('takes the featured game off its shelf and out of the count', () => {
    const before = shelvedGames();
    const after = shelvedGames(GAME_MANIFEST.wheel.id);
    const shelf = (list: typeof before, id: string) => list.find((s) => s.id === id)!;
    expect(shelf(after, 'words').games.length).toBe(shelf(before, 'words').games.length - 1);
    expect(shelf(after, 'words').games.map((g) => g.id)).not.toContain('wheel');
    // And nothing else moves: a game leaving one shelf is not a game joining
    // another.
    expect(shelf(after, 'dice').games).toEqual(shelf(before, 'dice').games);
  });

  /**
   * The length estimates. Nothing here can check whether "~15 min" is true --
   * a reducer knows its rules, not how long two people take over them -- so
   * this checks the two things that are checkable: that it is a whole number
   * of minutes, and that it is inside the range this line was written for.
   *
   * The ceiling matters more than it looks. The card prints "~120 min" in the
   * same 0.7rem slot as "~5 min", and a game that honestly runs two hours is
   * one this lobby is not describing properly with a tilde and a number.
   */
  it('gives every game a length somebody could read off the card', () => {
    for (const game of gameList()) {
      expect(Number.isInteger(game.minutes), `${game.id}: ${game.minutes}`).toBe(true);
      expect(game.minutes, game.id).toBeGreaterThanOrEqual(1);
      expect(game.minutes, game.id).toBeLessThanOrEqual(60);
    }
  });

  it('says something different on every card', () => {
    // The line exists because "2 players" was true of nine of them. Two games
    // sharing a sentence would be the same failure with more words.
    const blurbs = gameList().map((g) => g.blurb);
    expect(new Set(blurbs).size).toBe(blurbs.length);
  });
});

/**
 * `canAct` is what every control on every board is now gated on, so the ways
 * it can be wrong are ways a player is locked out of their own game, or shown
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
      if (!game.isOver(state)) return; // untimed, and the seat check below still applies
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
      // Either exactly one seat is on and it is the one `turn` names, or
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
