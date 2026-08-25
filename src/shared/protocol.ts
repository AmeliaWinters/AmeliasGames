/** Wire format shared by client and server. */

/**
 * Bumped whenever a message shape changes incompatibly. A tab left open across
 * a deploy reconnects with whatever shape it was built with, so the server
 * checks this and asks that client to refresh rather than misreading it.
 *
 * Meaning counts, not just shape. `spin.velocity` kept its type and units at
 * 6 and changed what they *buy* (the wheel gained `FLICK_GAIN` and the speed
 * floor became a gate), and a stale bundle would have gone on timing the
 * animation off its own constants, drawing a journey a quarter longer than the
 * one the server resolved. The wheel is meant to be the same equation drawn.
 *
 * 7 is the same kind of thing one layer down. Vocab Race now asks every third
 * clue as a choice of four meanings, and on those rounds the server redacts the
 * *clue* and sends the word, the reverse of every other round. Nothing on the
 * wire changed type; a board built before it simply reads the field it always
 * read, finds it empty, and draws a text box under a question that is not there.
 * A tab left open across the deploy has to refresh rather than play that.
 */
export const PROTOCOL_VERSION = 7;

/**
 * Why a request failed, so the client can choose its own framing. The message
 * is still the thing shown; this only decides how it is introduced.
 */
export type ErrorKind =
  /** No room with that code: expired, swept, or never existed. */
  | 'no-room'
  /** The room exists but every seat at its table is taken. */
  | 'full'
  /**
   * The room exists and has room, but the game was already dealt. Distinct
   * from `full` because the remedy is different: nobody can make space, so
   * the only way in is the next game.
   */
  | 'started'
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
  /**
   * Already passed through the game's `view()` for the receiving seat, and
   * null while `waiting`. A room exists before its game is dealt, and there is
   * no state to send until somebody starts it.
   */
  state: unknown;
  /**
   * Whose turn it is, for the status line and the highlight on the seat list
   * and nothing else. See `GameDefinition.turn`: four of these games are
   * free-simultaneous and answer it with a guess.
   */
  turn: number | null;
  /**
   * Whether the seat receiving this view may act right now.
   *
   * Computed by the server, from the same `canAct` the reducer will consult
   * when the move arrives, so a control that is offered and a move that is
   * refused can no longer be the same tap. The client used to work this out as
   * `turn === seat`, which was wrong for every free-simultaneous game, so their
   * boards each imported a predicate of their own and the alternating ones took
   * a `myTurn` prop. One field replaces both.
   *
   * A board on a clock still has to check the clock itself: this was true when
   * the message was built, and the last second of a round belongs to whoever is
   * holding it. Word Hunt's grid is the case, see its `timeIsUp`.
   */
  canAct: boolean;
  status: string;
  over: boolean;
  /** True while the room is still gathering people and has not been dealt. */
  waiting: boolean;
  /**
   * Whether the game could be started right now: enough people here, and not
   * already under way. Only seat 0 may actually send `start`, so this says
   * the room is ready rather than that you personally may press anything.
   */
  canStart: boolean;
  /** The most this game seats, so the lobby can say how many more may come. */
  capacity: number;
  /**
   * The server's clock when this view was built, in epoch milliseconds.
   *
   * Only a timed game needs it, and needs it badly: a deadline is a server
   * timestamp, and a device whose clock is minutes out would show a countdown
   * that disagrees with the game it is counting down. Measuring the gap against
   * this makes the skew cancel out.
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
    }
  | { t: 'move'; move: unknown }
  | { t: 'rematch' }
  /**
   * Deal the game to whoever is in the room.
   *
   * Only seat 0 may send it, and the server checks that rather than trusting
   * anyone. It exists because open seating removed the moment a game used to
   * start on its own: a room no longer knows how many people to expect, so
   * the people in it have to say when they are all here.
   */
  | { t: 'start' }
  /**
   * Are you still there?
   *
   * A WebSocket that dies without a close frame (a phone that locks, a carrier
   * that rebinds its NAT mapping) leaves `readyState` at OPEN forever. Nothing
   * arrives, nothing errors, and the player sits in front of a board that will
   * never move again. Silence in answer to this is the only evidence the socket
   * is gone.
   *
   * No version bump of its own: both adapters ignore a `t` they do not know and
   * so does the client, so a new client against an old server just gets
   * silence, which is why the client counts *any* frame as proof of life and
   * not only the pong. (The version did go to 2, for open seating, which is a
   * genuinely incompatible change to `hello` and to `RoomView`.)
   */
  | { t: 'ping' }
  /**
   * Play something else with the people already here, once the current game
   * is over. The room, its code and its seats all survive and only the reducer
   * changes, so nobody has to swap links to move from Connect Four to Yahtzee.
   *
   * The table is whoever is sitting here, so a game that cannot seat this
   * many is refused rather than quietly dropping somebody.
   */
  | { t: 'switch'; gameId: string };

export type ServerMessage =
  | { t: 'welcome'; seat: number; room: RoomView }
  | { t: 'room'; room: RoomView }
  | { t: 'error'; message: string; kind: ErrorKind }
  /**
   * Yes. See `ping`.
   *
   * In production the runtime answers this rather than any code here (see
   * `setWebSocketAutoResponse` in the worker), so a heartbeat on an idle room
   * does not drag it out of hibernation every twenty seconds for as long as
   * somebody holds a tab open.
   */
  | { t: 'pong' };

/**
 * The heartbeat frames as bytes, because Cloudflare's auto-responder matches
 * the request frame *exactly*: by string, not by shape. If the client built its
 * ping independently and a key order or a space ever differed, the match would
 * silently fail, every heartbeat would wake the room, and the bill would be the
 * first thing to notice. So neither side writes its own.
 */
export const PING_FRAME = JSON.stringify({ t: 'ping' } satisfies ClientMessage);
export const PONG_FRAME = JSON.stringify({ t: 'pong' } satisfies ServerMessage);

/** How often the client proves the socket is alive. */
export const PING_INTERVAL_MS = 20_000;

/**
 * How long a socket may go completely silent before the client gives up on it.
 * Comfortably more than two heartbeats, so a single dropped frame on a slow
 * train is not mistaken for a dead connection.
 */
export const SILENCE_LIMIT_MS = 50_000;
