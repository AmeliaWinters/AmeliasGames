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

/**
 * Which shelf of the lobby a game stands on.
 *
 * Thirteen cards in manifest order is one flat grid, and thirteen is where a
 * flat grid stops being scanned and starts being read: nothing about the
 * fourth row tells you whether the thing you want is in it. Three shelves, so
 * the answer to "what kind of evening is this" is one heading rather than a
 * lap of the whole screen.
 *
 * The three are the real split in what is here -- something you spell,
 * something you throw, something you place -- and they are also what the card
 * hues now encode, one arc of the wheel to a shelf. See the `--card` family in
 * `palette.css`.
 *
 * A game that is honestly two of these takes the one it is *played* like:
 * Wheel of Fortune has a wheel on it and is a word game, and Backgammon has a
 * board on it and is a dice game.
 */
export type ShelfId = 'words' | 'dice' | 'board';

export interface GameEntry {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  shelf: ShelfId;
  /**
   * Roughly how long a game runs, in minutes, for the line under the blurb.
   *
   * The second question a group asks after "what shall we play" is "how long
   * is it", and the card had no answer: the seat pips say who can play and
   * nothing said what it costs. A whole number of minutes, shown as "~15 min",
   * because a range would be two numbers to read where the tilde already says
   * the honest thing.
   *
   * These are estimates, and they are the one field here nobody can check
   * against the code -- a reducer knows its rules, not how long two people
   * take over them. Timed games are the exception and are exact by
   * construction: Word Hunt's round is its clock.
   */
  minutes: number;
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
    shelf: 'board', minutes: 5,
    blurb: 'Drop a disc. The stack decides the rest.',
  },
  backgammon: {
    id: 'backgammon', name: 'Backgammon', minPlayers: 2, maxPlayers: 2,
    shelf: 'dice', minutes: 20,
    blurb: 'Race your checkers home, hit theirs.',
  },
  wheel: {
    id: 'wheel', name: 'Wheel of Fortune', minPlayers: 2, maxPlayers: 4,
    shelf: 'words', minutes: 10,
    blurb: 'Spin it, buy a vowel, dodge Bankrupt.',
  },
  wordle: {
    id: 'wordle', name: 'Word Duel', minPlayers: 2, maxPlayers: 8,
    shelf: 'words', minutes: 5,
    blurb: 'Five letters, everyone guesses at once.',
  },
  liarsdice: {
    id: 'liarsdice', name: "Liar's Dice", minPlayers: 2, maxPlayers: 4,
    shelf: 'dice', minutes: 10,
    blurb: 'Raise the bid, or call them a liar.',
  },
  battleship: {
    id: 'battleship', name: 'Battleships', minPlayers: 2, maxPlayers: 2,
    shelf: 'board', minutes: 10,
    blurb: 'Hide five ships, find theirs first.',
  },
  yahtzee: {
    id: 'yahtzee', name: 'Yahtzee', minPlayers: 2, maxPlayers: 4,
    shelf: 'dice', minutes: 15,
    blurb: 'Three rolls a turn, thirteen boxes.',
  },
  wordhunt: {
    id: 'wordhunt', name: 'Word Hunt', minPlayers: 2, maxPlayers: 4,
    shelf: 'words', minutes: 3,
    blurb: 'Trace words before the clock runs out.',
  },
  morris: {
    id: 'morris', name: "Nine Men's Morris", minPlayers: 2, maxPlayers: 2,
    shelf: 'board', minutes: 10,
    blurb: 'Three in a row takes one of theirs.',
  },
  ultimate: {
    id: 'ultimate', name: 'Ultimate Tic-Tac-Toe', minPlayers: 2, maxPlayers: 2,
    shelf: 'board', minutes: 10,
    blurb: 'Your move picks their next board.',
  },
  letterpress: {
    id: 'letterpress', name: 'Letterpress', minPlayers: 2, maxPlayers: 2,
    shelf: 'words', minutes: 15,
    blurb: 'Spell words, steal their tiles.',
  },
  wordchain: {
    id: 'wordchain', name: 'Word Chain', minPlayers: 2, maxPlayers: 2,
    shelf: 'words', minutes: 5,
    blurb: 'Every word starts where the last ended.',
  },
  drill: {
    id: 'drill', name: 'Drill', minPlayers: 1, maxPlayers: 1,
    shelf: 'words', minutes: 3,
    blurb: 'Alone, against the words you owe.',
  },
  vocab: {
    id: 'vocab', name: 'Vocab Race', minPlayers: 2, maxPlayers: 8,
    shelf: 'words', minutes: 5,
    blurb: 'See the clue, race them to the word.',
  },
  ghost: {
    id: 'ghost', name: 'Superghost', minPlayers: 2, maxPlayers: 2,
    shelf: 'words', minutes: 10,
    blurb: 'Grow it either end. Finish a word, lose.',
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
    shelf: game.shelf,
    minutes: game.minutes,
    blurb: game.blurb,
  }));
}

/**
 * The shelves, in the order the lobby stands them in.
 *
 * Words first because six of the thirteen are word games and the two most
 * played are among them; board last because those are the ones people already
 * know the name of and can find by looking for it.
 *
 * The label is the heading over the shelf and the accessible name of the
 * section under it, which is why there is one string and not two.
 */
export const SHELVES: { id: ShelfId; label: string }[] = [
  { id: 'words', label: 'Word games' },
  { id: 'dice', label: 'Dice and nerve' },
  { id: 'board', label: 'Board and grid' },
];

/**
 * The shelves with their games on them, manifest order preserved within each.
 *
 * `skip` is the game already standing on its own above the shelves -- the one
 * you played last. It comes out here rather than in the lobby so that the
 * count in a shelf's heading and the cards under it can never disagree, which
 * they did for exactly as long as the two were worked out in different places.
 */
export function shelvedGames(skip?: string): { id: ShelfId; label: string; games: GameEntry[] }[] {
  const games = gameList().filter((game) => game.id !== skip);
  return SHELVES.map((shelf) => ({
    ...shelf,
    games: games.filter((game) => game.shelf === shelf.id),
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
