import type { GameDefinition } from '../types.js';
import { connect4 } from './connect4.js';
import { backgammon } from './backgammon.js';

/**
 * Adding a game means writing one reducer and adding it here. The server and
 * the lobby are entirely game-agnostic; only the board component is per-game.
 */
export const GAMES: Record<string, GameDefinition<any, any>> = {
  [connect4.id]: connect4,
  [backgammon.id]: backgammon,
};

export const DEFAULT_GAME_ID = connect4.id;

export function getGame(id: string): GameDefinition<any, any> | undefined {
  return GAMES[id];
}

/** The games offered in the lobby, in the order they are shown. */
export function gameList(): Array<{ id: string; name: string }> {
  return Object.values(GAMES).map((game) => ({ id: game.id, name: game.name }));
}
