/**
 * Ids, names and seat counts, deliberately importing no reducer.
 *
 * The lobby lists the games and knows how many can play, and nothing more. If
 * it reached for the definitions to get their names, every reducer (and
 * `applyMove` with them) would land in the client bundle for the sake of two
 * strings. Keeping the manifest reducer-free is what lets the bundler drop the
 * move logic from a build that only renders the state the server sends.
 *
 * Single source for every field on it: the definitions read their `id`, `name`
 * and seat range from here rather than restating them, and
 * `manifestIsComplete()` in `index.ts` holds any that don't to account.
 */
export interface GameEntry {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /**
   * The card's second line: what this game is, in a sentence only it could
   * carry.
   *
   * It replaced "2 players", which nine of the thirteen cards said: the
   * smallest type on the lobby, spent thirteen times on the least interesting
   * fact available. The seat range is still there as a figure at the end of the
   * name, where thirteen of them line up as a column you can read down.
   *
   * Two load-bearing constraints. It has to name a rule this game has and its
   * neighbours do not, since "two players take turns" is true of most of the
   * shelf and tells nobody anything. And it has to fit two lines at card width,
   * about 42 characters: `picker.css` reserves exactly two, so a longer one
   * does not wrap onto a third and push its row taller than the one beside it.
   * A fourteenth game that overruns undoes that evenness for the whole grid.
   */
  blurb: string;
}

export const GAME_MANIFEST = {
  connect4: {
    id: 'connect4', name: 'Connect Four', minPlayers: 2, maxPlayers: 2,
    blurb: 'Drop a disc. The stack decides the rest.',
  },
  backgammon: {
    id: 'backgammon', name: 'Backgammon', minPlayers: 2, maxPlayers: 2,
    blurb: 'Race your checkers home, hit theirs.',
  },
  wheel: {
    id: 'wheel', name: 'Wheel of Fortune', minPlayers: 2, maxPlayers: 4,
    blurb: 'Spin it, buy a vowel, dodge Bankrupt.',
  },
  wordle: {
    id: 'wordle', name: 'Word Duel', minPlayers: 2, maxPlayers: 8,
    blurb: 'Five letters, everyone guesses at once.',
  },
  liarsdice: {
    id: 'liarsdice', name: "Liar's Dice", minPlayers: 2, maxPlayers: 4,
    blurb: 'Raise the bid, or call them a liar.',
  },
  battleship: {
    id: 'battleship', name: 'Battleships', minPlayers: 2, maxPlayers: 2,
    blurb: 'Hide five ships, find theirs first.',
  },
  yahtzee: {
    id: 'yahtzee', name: 'Yahtzee', minPlayers: 2, maxPlayers: 4,
    blurb: 'Three rolls a turn, thirteen boxes.',
  },
  wordhunt: {
    id: 'wordhunt', name: 'Word Hunt', minPlayers: 2, maxPlayers: 4,
    blurb: 'Trace words before the clock runs out.',
  },
  morris: {
    id: 'morris', name: "Nine Men's Morris", minPlayers: 2, maxPlayers: 2,
    blurb: 'Three in a row takes one of theirs.',
  },
  ultimate: {
    id: 'ultimate', name: 'Ultimate Tic-Tac-Toe', minPlayers: 2, maxPlayers: 2,
    blurb: 'Your move picks their next board.',
  },
  letterpress: {
    id: 'letterpress', name: 'Letterpress', minPlayers: 2, maxPlayers: 2,
    blurb: 'Spell words, steal their tiles.',
  },
  wordchain: {
    id: 'wordchain', name: 'Word Chain', minPlayers: 2, maxPlayers: 2,
    blurb: 'Every word starts where the last ended.',
  },
  vocab: {
    id: 'vocab', name: 'Vocab Race', minPlayers: 2, maxPlayers: 8,
    blurb: 'See the clue, race them to the word.',
  },
} as const;

export const DEFAULT_GAME_ID: string = GAME_MANIFEST.connect4.id;

/** The games offered in the lobby, in the order they are shown. */
export function gameList(): GameEntry[] {
  return Object.values(GAME_MANIFEST).map((game) => ({
    id: game.id,
    name: game.name,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
    blurb: game.blurb,
  }));
}

export function gameEntry(id: string): GameEntry | undefined {
  return gameList().find((game) => game.id === id);
}

/** Anything that knows how many can play: a manifest entry or a definition. */
export interface SeatRange {
  minPlayers: number;
  maxPlayers: number;
}

/**
 * Whether a game will seat exactly this many players. Used when an existing
 * room changes game: the seats are taken, so the only games on offer are the
 * ones that play at the table already sitting there.
 *
 * Shared for the same reason `clampSeats` is: the client filters the list it
 * offers and the room checks the request, and a disagreement is a button that
 * always fails.
 */
export function canSeat(range: SeatRange, count: number): boolean {
  return count >= range.minPlayers && count <= range.maxPlayers;
}

/**
 * How many seats to lay out, given what a client asked for. Lives here so the
 * room (which holds a definition) and the lobby (which holds only the manifest)
 * clamp identically, or the lobby offers a table the room will not build.
 *
 * Nonsense falls back to the smallest table the game allows, the friendliest
 * failure: a room waiting on more players than will ever turn up is a room
 * nobody can play in.
 */
export function clampSeats(range: SeatRange, requested: number | undefined): number {
  const asked = Math.trunc(Number(requested));
  if (!Number.isFinite(asked) || asked <= 0) return range.minPlayers;
  return Math.min(Math.max(asked, range.minPlayers), range.maxPlayers);
}
