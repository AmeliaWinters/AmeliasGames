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
  /** The room exists but every seat at its table is taken. */
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
  /** True while the room is still short of the table size it was opened for. */
  waiting: boolean;
  /**
   * The server's clock when this view was built, in epoch milliseconds.
   *
   * Only a timed game needs it, and it needs it badly: a deadline is a server
   * timestamp, and a device whose clock is minutes out would otherwise show a
   * countdown that disagrees with the game it is counting down. Measuring the
   * gap against this instead makes the clock skew cancel out.
   */
  now: number;
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
  | { t: 'rematch' }
  /**
   * Play something else with the people already here, once the current game
   * is over. The room, its code and its seats all survive — only the reducer
   * changes — so nobody has to swap links to move from Connect Four to
   * Yahtzee.
   *
   * The table size is not negotiable here: it was settled when the room was
   * opened and the same players are still in their seats, so a game that
   * cannot seat exactly this many is refused rather than quietly dropping
   * somebody.
   */
  | { t: 'switch'; gameId: string };

export type ServerMessage =
  | { t: 'welcome'; seat: number; room: RoomView }
  | { t: 'room'; room: RoomView }
  | { t: 'error'; message: string; kind: ErrorKind };
