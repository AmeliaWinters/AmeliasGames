// Type-only, so it is erased: this file stays free of the registry it names.
// It is here for the one property worth keeping, that "wheel" below has to be
// a game the manifest actually offers.
import type { GameId } from "./boards.js";

/**
 * Games whose board draws the players itself, so the shell does not draw them
 * too.
 *
 * The shell's strip is chip, name, "you", "away". The Wheel's purses are chip,
 * name, and the two totals that *are* the score of that game, which made the
 * top of a Wheel table two rows of the same four names, one carrying the money
 * and one carrying nothing the other could not. At four players that is a
 * hundred and forty pixels of duplicate on a phone, and the duplicate is why
 * the keyboard was below the fold.
 *
 * A set rather than a flag on the board component, because the shell has to
 * answer this *before* it has a board: the strip is drawn above the point where
 * a game is dealt, an undealt room has no board at all, and since `boards.ts`
 * went lazy the board is not even a module the shell has loaded. That is why
 * this is its own file rather than a third export from `boards.ts`: the shell
 * asks this question on the lobby's first paint, and reaching into the board
 * registry to ask it would pull the registry, and its fifteen import thunks,
 * back into the entry chunk that the lazy split exists to empty.
 */
const OWNS_SEATS: ReadonlySet<string> = new Set<GameId>(["wheel"]);

/** Whether this game's board draws its own seat strip. See `OWNS_SEATS`. */
export function ownsSeats(gameId: string): boolean {
  return OWNS_SEATS.has(gameId);
}
