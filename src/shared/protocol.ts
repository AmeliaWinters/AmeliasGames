/** Wire format shared by client and server. */

export interface PlayerView {
  seat: number;
  name: string;
  connected: boolean;
}

export interface RoomView {
  code: string;
  gameId: string;
  gameName: string;
  players: PlayerView[];
  /** Already passed through the game's `view()` for the receiving seat. */
  state: unknown;
  turn: number | null;
  status: string;
  over: boolean;
  /** True while we're still short of minPlayers. */
  waiting: boolean;
}

export type ClientMessage =
  | {
      t: 'hello';
      playerId: string;
      name: string;
      /** Always set: the client picks the code when starting a game, so the
       *  room can be addressed before the socket opens. */
      code: string;
      /** True when this client expects to be opening a brand-new room. */
      create: boolean;
      gameId: string;
    }
  | { t: 'move'; move: unknown }
  | { t: 'rematch' };

export type ServerMessage =
  | { t: 'welcome'; seat: number; room: RoomView }
  | { t: 'room'; room: RoomView }
  | { t: 'error'; message: string };
