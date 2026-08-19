/** Wire format shared by client and server. */

/**
 * Bumped whenever a message shape changes incompatibly. A tab left open across
 * a deploy reconnects with whatever shape it was built with, so the server
 * checks this and asks that client to refresh rather than misreading it.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Why a request failed, so the client can choose its own framing. The message
 * is still the thing shown; this only decides how it is introduced.
 */
export type ErrorKind =
  /** No room with that code — expired, swept, or never existed. */
  | 'no-room'
  /** The room exists but both seats are taken. */
  | 'full'
  /** Client and server disagree about the wire format. */
  | 'protocol'
  /** Understood, but refused: not your turn, illegal move, wrong game. */
  | 'rejected';

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
      /** PROTOCOL_VERSION as of the build this client came from. */
      v: number;
      playerId: string;
      name: string;
      /** Always set: the client picks the code when starting a game, so the
       *  room can be addressed before the socket opens. */
      code: string;
      /** True when this client expects to be opening a brand-new room. */
      create: boolean;
      gameId: string;
      /**
       * How many seats to lay out, for the games that play a range. Read only
       * when this client is the one creating the room — everyone joining
       * afterwards gets the table that is already there — and clamped to what
       * the game supports, so it is a request rather than an instruction.
       */
      players?: number;
    }
  | { t: 'move'; move: unknown }
  | { t: 'rematch' };

export type ServerMessage =
  | { t: 'welcome'; seat: number; room: RoomView }
  | { t: 'room'; room: RoomView }
  | { t: 'error'; message: string; kind: ErrorKind };
