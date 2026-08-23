import type { GameDefinition } from '../types.js';
import { GAME_MANIFEST } from './manifest.js';
import { connect4 } from './connect4.js';
import { backgammon } from './backgammon.js';
import { wheel } from './wheel.js';
import { wordle } from './wordle.js';
import { liarsDice } from './liarsDice.js';
import { battleship } from './battleship.js';
import { yahtzee } from './yahtzee.js';
import { wordHunt } from './wordHunt.js';
import { morris } from './morris.js';
import { ultimate } from './ultimate.js';
import { letterpress } from './letterpress.js';

/**
 * Adding a game means writing one reducer, listing it in `manifest.ts`, and
 * adding it here. The server and the lobby are entirely game-agnostic; only
 * the board component is per-game.
 *
 * Importing this module pulls in every reducer, which is right on the server
 * and wasteful in the client — the lobby should import `manifest.js` instead.
 */
export const GAMES: Record<string, GameDefinition<any, any>> = {
  [connect4.id]: connect4,
  [backgammon.id]: backgammon,
  [wheel.id]: wheel,
  [wordle.id]: wordle,
  [liarsDice.id]: liarsDice,
  [battleship.id]: battleship,
  [yahtzee.id]: yahtzee,
  [wordHunt.id]: wordHunt,
  [morris.id]: morris,
  [ultimate.id]: ultimate,
  [letterpress.id]: letterpress,
};

export { DEFAULT_GAME_ID, GAME_MANIFEST, canSeat, clampSeats, gameEntry, gameList } from './manifest.js';
export type { GameEntry, SeatRange } from './manifest.js';

export function getGame(id: string): GameDefinition<any, any> | undefined {
  return GAMES[id];
}

/**
 * Every id the manifest promises must resolve to a definition, and must agree
 * with it about the seat range. The lobby sizes its table from the manifest
 * while the room sizes itself from the definition, so a disagreement is a room
 * that can never fill.
 */
export function manifestIsComplete(): boolean {
  return Object.values(GAME_MANIFEST).every((entry) => {
    const game = GAMES[entry.id];
    return (
      game !== undefined &&
      game.minPlayers === entry.minPlayers &&
      game.maxPlayers === entry.maxPlayers
    );
  });
}
