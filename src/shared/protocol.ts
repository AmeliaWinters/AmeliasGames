/** Wire format shared by client and server. */
import type { Known, LearnLang, ProfileView } from './profile.js';

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
 *
 * 8 adds accounts. `hello` may carry a signed claim to one, and the server may
 * send a `profile` back. Neither is required and a room where nobody has an
 * account plays exactly as it always has — but the version still moves, because
 * an older client cannot be told about a profile it has no field for, and a
 * newer client that quietly went unrecognised would sit there having earned
 * nothing and never find out why.
 *
 * 9 splits experience per language and adds `vocab`, which fetches the actual
 * word rows for one language rather than the summary. The summary's shape
 * changed with it -- `xp`, `level` and `nextLevel` came off the top level and
 * went onto `byLang` -- and that is the part that forces the bump: an older
 * client reads `profile.xp`, finds nothing, and draws a level bar full of
 * `NaN` over somebody's vocabulary. See `LangView`.
 *
 * 10 puts `showcase` on `PlayerView`, so the seat list can draw the characters
 * somebody is showing. Additive, and an older client would simply ignore the
 * field -- but a newer client reads `p.showcase.map(...)` against an older
 * server and finds undefined, which is a seat list that throws rather than a
 * seat list missing some pictures. The bump is for that direction.
 *
 * 11 puts `avatar` on `PlayerView` and on `hello`, so the seat list can draw
 * the figure somebody built as well as the characters they collected. Same
 * direction as 10 and the same argument: a newer client reads `p.avatar`
 * against a 10 server, finds undefined, and draws an initial forever for
 * people who do have one.
 *
 * It is a *string* on the wire, and that is the interesting part. A loadout is
 * a client type -- it names parts out of an art manifest that only the client
 * compiles in -- so `shared/` deliberately does not learn its shape. The
 * server carries the JSON from one seat to the others without opening it, the
 * receiving client parses it through the same guard `loadAvatar` uses, and a
 * loadout naming art this build has never heard of falls back to the initial.
 * That guard is what makes an opaque string safe to relay; see
 * `avatar/store.ts`.
 *
 * 12 adds `winner` to `RoomView`, so the end screen can put the winner's
 * figure, name and characters where a sentence used to stand alone. The same
 * direction again: a newer client reading `room.winner` off an 11 server finds
 * undefined, and `undefined` is not `null` -- it would draw the hero panel for
 * nobody, or worse, for seat `undefined`.
 */
export const PROTOCOL_VERSION = 12;

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
  /**
   * The character ids this player has on show, newest last, at most
   * `SHOWCASE_MAX` of them. Empty for a guest, for anybody who has not rolled,
   * and for a room restored from before this field existed.
   *
   * Ids rather than art: the client compiles the roster in already (see
   * `waifuRoster.ts`), so sending URLs would be paying for them twice on every
   * view, and every view goes out after every move.
   *
   * This is the whole point of the showcase being called one. It was private
   * to the account menu, which made three slots nobody else could see, and a
   * collection nobody sees is a collection nobody starts.
   */
  showcase: string[];
  /**
   * The figure this player built, as the JSON of a client loadout, or null for
   * anybody who has never opened the customiser.
   *
   * Opaque here on purpose, and capped rather than trusted: see
   * `PROTOCOL_VERSION` 11 for why the wire holds a string, and
   * `RoomEngine.setAvatar` for the cap.
   */
  avatar: string | null;
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
  /**
   * The seat that won, once `over`, and null the rest of the time.
   *
   * Decoration, not authority: the end screen draws this player's figure,
   * name and showcase, and nothing is decided from it. Null is a real answer
   * and a common one -- a draw, a tie at the top of a four-handed table, or
   * Drill, which is played alone -- and the end screen falls back to `status`
   * for every one of those, since that sentence already says why nobody is
   * named. See `GameDefinition.winner`.
   */
  winner: number | null;
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
   * The fewest this game will start with, so the waiting room can mark which
   * of its empty seats have to be filled before anything can happen. The
   * lobby used to know only the ceiling, which meant "1/8" said nothing about
   * whether pressing start was minutes or one person away.
   */
  minimum: number;
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
      /**
       * A signed claim to an account, or absent for a guest.
       *
       * Absent is the ordinary case and must stay playable forever: the app
       * advertises "no accounts" on every share card, and the whole charm of
       * it is that a link is enough. A claim that fails to verify is treated
       * as absent rather than as a refusal — somebody whose key has gone wrong
       * should still get their game.
       *
       * Deliberately not typed as `AccountClaim`: this is the wire, where
       * everything is `unknown` until it has been checked, and `verifyClaim`
       * is what checks it.
       */
      account?: unknown;
      /**
       * The loadout this browser has equipped, as JSON, or absent.
       *
       * Sent by the client rather than read from a profile because that is
       * where it lives: the equipped loadout is `localStorage` today (see
       * `avatar/store.ts`, which says out loud that its home is meant to be
       * the profile). Until it moves, the only thing that knows what somebody
       * is wearing is the tab they are wearing it in.
       *
       * Which means it is a claim, not a fact, and it is treated as one: the
       * server never parses it, and every client that draws it re-checks it
       * against its own art. The worst a hostile one can do is show its own
       * player a shape, and pay the cap for it.
       */
      avatar?: unknown;
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
  | { t: 'switch'; gameId: string }
  /**
   * What have I got?
   *
   * Answered only for a socket that arrived with a claim that verified, so it
   * cannot be used to read somebody else's: there is no id on it to name one.
   * The client asks on joining, and the server also pushes an unasked-for
   * answer when a game it played has just been filed — see `profile` below.
   */
  | { t: 'profile' }
  /**
   * Show me the actual words, for one language.
   *
   * The second request `ProfileView` says would be needed "when somebody
   * actually opens the ledger", and this is it. Per language rather than the
   * whole ledger, because the whole ledger is the 600KB the summary exists to
   * avoid and because the screen that asks is already showing one language at
   * a time.
   *
   * Answered only for a socket whose account claim verified, exactly like
   * `profile`, and for the same reason: there is no id on it, so it can only
   * ever name your own.
   */
  | { t: 'vocab'; lang: LearnLang };

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
  | { t: 'pong' }
  /**
   * Your profile, as a summary.
   *
   * Sent in answer to `profile`, and again unasked-for the moment a finished
   * game has been filed, which is the moment worth showing somebody what they
   * earned. Pushed rather than requested because the alternative is the client
   * polling for a change it cannot predict, and because a player who was
   * looking at the end screen when the write landed should see the number move.
   *
   * A **summary**, never the ledger: five thousand words is around 600KB and
   * this would carry it on every join. See `ProfileView`.
   */
  | { t: 'profile'; profile: ProfileView }
  /**
   * The words themselves, for one language. Answer to `vocab`.
   *
   * Never pushed. The summary is pushed because a number moving at the end of
   * a game is worth seeing; a list of two thousand rows arriving unasked-for
   * on a phone is not, and the screen that wants it is a screen somebody had
   * to open on purpose.
   *
   * `lang` is echoed rather than assumed, because a player who switches
   * language twice quickly has two requests in flight and the second answer
   * must not be drawn under the first heading.
   */
  | { t: 'vocab'; lang: LearnLang; words: Known[] };

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
