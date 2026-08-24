/**
 * Ids, names and seat counts — deliberately importing no reducer.
 *
 * The lobby needs to list the games and know how many can play, but nothing
 * more. If it reached for the definitions to get their names, every reducer
 * (and `applyMove` with them) would be pulled into the client bundle for the
 * sake of two strings. Keeping the manifest reducer-free is what lets the
 * bundler drop the move logic from a build that only ever renders the state
 * the server sends.
 *
 * This is the single source for every field on it: the definitions read their
 * `id`, `name` and seat range from here rather than restating them, and
 * `manifestIsComplete()` in `index.ts` holds any that don't to account.
 */
export interface GameEntry {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
}

export const GAME_MANIFEST = {
  connect4: { id: 'connect4', name: 'Connect Four', minPlayers: 2, maxPlayers: 2 },
  backgammon: { id: 'backgammon', name: 'Backgammon', minPlayers: 2, maxPlayers: 2 },
  wheel: { id: 'wheel', name: 'Wheel of Fortune', minPlayers: 2, maxPlayers: 4 },
  wordle: { id: 'wordle', name: 'Word Duel', minPlayers: 2, maxPlayers: 8 },
  liarsdice: { id: 'liarsdice', name: "Liar's Dice", minPlayers: 2, maxPlayers: 4 },
  battleship: { id: 'battleship', name: 'Battleships', minPlayers: 2, maxPlayers: 2 },
  yahtzee: { id: 'yahtzee', name: 'Yahtzee', minPlayers: 2, maxPlayers: 4 },
  wordhunt: { id: 'wordhunt', name: 'Word Hunt', minPlayers: 2, maxPlayers: 4 },
  morris: { id: 'morris', name: "Nine Men's Morris", minPlayers: 2, maxPlayers: 2 },
  ultimate: { id: 'ultimate', name: 'Ultimate Tic-Tac-Toe', minPlayers: 2, maxPlayers: 2 },
  letterpress: { id: 'letterpress', name: 'Letterpress', minPlayers: 2, maxPlayers: 2 },
  wordchain: { id: 'wordchain', name: 'Word Chain', minPlayers: 2, maxPlayers: 2 },
} as const;

export const DEFAULT_GAME_ID: string = GAME_MANIFEST.connect4.id;

/** The games offered in the lobby, in the order they are shown. */
export function gameList(): GameEntry[] {
  return Object.values(GAME_MANIFEST).map((game) => ({
    id: game.id,
    name: game.name,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
  }));
}

export function gameEntry(id: string): GameEntry | undefined {
  return gameList().find((game) => game.id === id);
}

/** Anything that knows how many can play — a manifest entry or a definition. */
export interface SeatRange {
  minPlayers: number;
  maxPlayers: number;
}

/**
 * Whether a game will seat exactly this many players. Used when an existing
 * room changes game: the seats are already taken, so the only games on offer
 * are the ones that play at the table that is already sitting there.
 *
 * Shared for the same reason `clampSeats` is — the client filters the list it
 * offers and the room checks the request, and a disagreement is a button that
 * always fails.
 */
export function canSeat(range: SeatRange, count: number): boolean {
  return count >= range.minPlayers && count <= range.maxPlayers;
}

/**
 * How many seats to lay out, given what a client asked for. Lives here so the
 * room (which holds a definition) and the lobby (which holds only the
 * manifest) clamp identically — the two must agree or the lobby offers a table
 * the room will not build.
 *
 * Nonsense falls back to the smallest table the game allows, which is the
 * friendliest failure: a room waiting on more players than will ever turn up
 * is a room nobody can play in.
 */
export function clampSeats(range: SeatRange, requested: number | undefined): number {
  const asked = Math.trunc(Number(requested));
  if (!Number.isFinite(asked) || asked <= 0) return range.minPlayers;
  return Math.min(Math.max(asked, range.minPlayers), range.maxPlayers);
}
