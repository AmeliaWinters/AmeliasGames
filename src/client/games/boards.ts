import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { GAME_MANIFEST } from "../../shared/games/manifest.js";
// Every import below is type-only, so no reducer and no word list follows any
// of them into the bundle. The state and move types happen to live beside the
// rules for several games; `import type` erases the whole module.
//
// The boards themselves used to be imported here too, and that is the line
// that made this file expensive: fifteen eager imports meant 334KB of board
// source in the entry chunk, downloaded and parsed by everyone opening the
// lobby to play Connect Four. They are `lazy` now. See `BOARDS`.
import type { C4State, C4Move } from "../../shared/games/connect4.js";
import type { BgState, BgMove } from "../../shared/games/backgammon.js";
import type { WofState, WofMove } from "../../shared/games/wheel.js";
import type { WordleState, WordleMove } from "../../shared/games/wordleDisplay.js";
import type { YState, YMove } from "../../shared/games/yahtzeeDisplay.js";
import type { BsState, BsMove } from "../../shared/games/battleshipDisplay.js";
import type { LdState, LdMove } from "../../shared/games/liarsDiceDisplay.js";
import type { WhState, WhMove } from "../../shared/games/wordHuntDisplay.js";
import type { MmState, MmMove } from "../../shared/games/morrisDisplay.js";
import type { UtState, UtMove } from "../../shared/games/ultimateDisplay.js";
import type { LpState, LpMove } from "../../shared/games/letterpressDisplay.js";
import type { WcState, WcMove } from "../../shared/games/wordChainDisplay.js";
import type { VocabState, VocabMove } from "../../shared/games/vocabDisplay.js";
import type { DrillState, DrillMove } from "../../shared/games/drillDisplay.js";
import type { GhostState, GhostMove } from "../../shared/games/ghostDisplay.js";

/** Every id the manifest offers. */
export type GameId = keyof typeof GAME_MANIFEST;

/**
 * What the server sends for each game, and what each board sends back.
 *
 * This exists because `RoomView.state` arrives as `unknown`: it came off a
 * socket as JSON, and no amount of wishing makes that a `BgState`. Somewhere a
 * human has to assert which game's state it is. That assertion used to be made
 * ten times over, once per case in a switch, each one pairing a `gameId`
 * string with a cast by hand:
 *
 * ```
 * case "morris":  <MorrisBoard state={room.state as MmState} ... />
 * ```
 *
 * Nothing checked that the two halves of that line matched. Pairing the wrong
 * state with a board is not a type error there, it is a board reading fields
 * that are not on the object, which shows up as a white screen on somebody's
 * phone, mid-game, and never in a test.
 *
 * Below, the pairing is the thing the compiler checks. `BOARDS` is keyed by
 * `GameId`, so a game in the manifest with no entry here will not compile; and
 * each entry's props are looked up through these maps, so a board that does
 * not take that game's state will not compile either. One cast survives, in
 * `boardFor` at the bottom, and it is honest: it is the single point where the
 * wire is believed.
 */
export interface GameStates {
  connect4: C4State;
  backgammon: BgState;
  wheel: WofState;
  wordle: WordleState;
  liarsdice: LdState;
  battleship: BsState;
  yahtzee: YState;
  wordhunt: WhState;
  morris: MmState;
  ultimate: UtState;
  letterpress: LpState;
  wordchain: WcState;
  vocab: VocabState;
  drill: DrillState;
  ghost: GhostState;
}

/** The other half of the pair. See `GameStates`. */
export interface GameMoves {
  connect4: C4Move;
  backgammon: BgMove;
  wheel: WofMove;
  wordle: WordleMove;
  liarsdice: LdMove;
  battleship: BsMove;
  yahtzee: YMove;
  wordhunt: WhMove;
  morris: MmMove;
  ultimate: UtMove;
  letterpress: LpMove;
  wordchain: WcMove;
  vocab: VocabMove;
  drill: DrillMove;
  ghost: GhostMove;
}

/**
 * What every board is handed. The same five things for all eleven, whether or
 * not a given board wants all five: a uniform shape is what lets them be looked
 * up in a table rather than spelled out one `case` at a time.
 */
export interface BoardProps<S, M> {
  /** Already redacted for this seat by the game's `view()`. */
  state: S;
  /** Null for a socket with no seat. A board must not assume it has one. */
  seat: number | null;
  names: string[];
  /**
   * Whether this player may act right now: the server's own answer, from the
   * same predicate `applyMove` will consult. Gate every control on this.
   *
   * It replaced a `myTurn` prop computed as `room.turn === seat`, which was
   * wrong for the four games that are not strictly alternating; each of those
   * boards had to refuse the prop and import a predicate of its own, with a
   * comment explaining why. There is nothing left to explain.
   *
   * True as of `now`. A board on a clock still owns the last second, see Word
   * Hunt, which checks the running countdown as well.
   */
  canAct: boolean;
  /**
   * Which seats still have somebody on the end of the socket, by seat index.
   *
   * Only a board drawing its own seat strip needs this, see `ownsSeats.ts`. The
   * shell's strip usually says "away", and a board that replaces it has to be
   * able to say it too, or reconnecting is the one piece of news that goes
   * missing on exactly the tables that hid the strip.
   */
  connected: boolean[];
  /** The server's clock as of this state. Boards off the clock ignore it. */
  now: number;
  onMove(move: M): void;
}

export type Board<K extends GameId> = ComponentType<BoardProps<GameStates[K], GameMoves[K]>>;

/**
 * How a board arrives now: a `lazy` wrapper around the real component, which
 * is a `ComponentType` as far as every caller is concerned and a separate
 * chunk as far as the network is concerned.
 */
export type LazyBoard<K extends GameId> = LazyExoticComponent<Board<K>>;

/**
 * The one place that knows which board goes with which game. Everything above
 * it (the lobby, seating, reconnection, the rematch) is game-agnostic, so
 * adding a game means an entry here and a line in each map above.
 *
 * A thunk per board rather than an import, so each board is its own chunk and
 * a player downloads the one game they opened rather than all fifteen. The
 * `.then` unwrapping a named export is what `lazy` asks for below, and it is
 * not ceremony: it is also where the compiler still checks the pairing this
 * file exists for, because each thunk's resolved type has to satisfy
 * `{ default: Board<K> }` for that same `K`, so a board taking another game's
 * state fails here exactly as it did when these were plain imports.
 *
 * The rendering side of the bargain is a `Suspense` boundary in
 * `screens/Room.tsx`; without one, a lazy board suspends into whatever
 * boundary happens to be above it, which would be the whole app.
 */
const LOADERS: { [K in GameId]: () => Promise<{ default: Board<K> }> } = {
  connect4: () => import("./Connect4Board.js").then((m) => ({ default: m.Connect4Board })),
  // One component for board and controls: they share whether the dice have
  // stopped, and two copies of that could disagree.
  backgammon: () => import("./BackgammonBoard.js").then((m) => ({ default: m.BackgammonGame })),
  wheel: () => import("./WheelBoard.js").then((m) => ({ default: m.WheelBoard })),
  wordle: () => import("./WordleBoard.js").then((m) => ({ default: m.WordleBoard })),
  liarsdice: () => import("./LiarsDiceBoard.js").then((m) => ({ default: m.LiarsDiceBoard })),
  battleship: () => import("./BattleshipBoard.js").then((m) => ({ default: m.BattleshipBoard })),
  yahtzee: () => import("./YahtzeeBoard.js").then((m) => ({ default: m.YahtzeeBoard })),
  wordhunt: () => import("./WordHuntBoard.js").then((m) => ({ default: m.WordHuntBoard })),
  morris: () => import("./MorrisBoard.js").then((m) => ({ default: m.MorrisBoard })),
  ultimate: () => import("./UltimateBoard.js").then((m) => ({ default: m.UltimateBoard })),
  letterpress: () => import("./LetterpressBoard.js").then((m) => ({ default: m.LetterpressBoard })),
  wordchain: () => import("./WordChainBoard.js").then((m) => ({ default: m.WordChainBoard })),
  vocab: () => import("./VocabBoard.js").then((m) => ({ default: m.VocabBoard })),
  drill: () => import("./DrillBoard.js").then((m) => ({ default: m.DrillBoard })),
  ghost: () => import("./GhostBoard.js").then((m) => ({ default: m.GhostBoard })),
};

/**
 * The same fifteen, wrapped for rendering. Built from `LOADERS` rather than
 * written out a second time, so there is one list of games in this file and
 * the mapped type above is the only place the pairing has to hold.
 *
 * The cast inside the loop is the price of that, and it is a narrow one.
 * `Object.keys` hands back a union of all fifteen ids, so at this point
 * TypeScript has lost the fact that `LOADERS[id]` and `out[id]` are indexed by
 * the *same* `K`: it sees a union of fifteen loaders against a union of
 * fifteen slots and correctly refuses to believe they line up. They do, by
 * construction -- it is the same `id` on both sides of the assignment -- and
 * the thing that would actually be worth catching here, a board paired with
 * another game's state, is caught on `LOADERS` above, where the key is still
 * concrete. Writing the fifteen out again would satisfy the compiler and put a
 * second list of games in this file for a new game to be forgotten from.
 */
const BOARDS = (() => {
  const out = {} as Record<GameId, LazyBoard<GameId>>;
  for (const id of Object.keys(LOADERS) as GameId[]) {
    out[id] = lazy(LOADERS[id] as () => Promise<{ default: Board<GameId> }>);
  }
  return out as { [K in GameId]: LazyBoard<K> };
})();

/**
 * Fetch a board's chunk without rendering it.
 *
 * `lazy` starts the download on the first render, which is the moment the
 * player is already looking at the fallback. Anything that knows sooner which
 * game is about to be drawn can call this and have the chunk in flight during
 * the wait it was going to have anyway.
 *
 * Returns nothing for an unknown id, on the same reasoning as `boardFor`: an
 * old tab against a newer server is a real thing and not a reason to throw.
 */
export function preloadBoard(gameId: string): Promise<unknown> | undefined {
  return (LOADERS as Record<string, (() => Promise<unknown>) | undefined>)[gameId]?.();
}

/**
 * Every board's chunk, fetched.
 *
 * For `boards.test.tsx`, which draws all fifteen and would otherwise be
 * racing the module loader on every one of its several hundred renders. It is
 * deliberately not called anywhere in the app: downloading all fifteen boards
 * is the exact thing the lazy split exists to stop.
 */
export function preloadAllBoards(): Promise<unknown[]> {
  return Promise.all(Object.values(LOADERS).map((load) => load()));
}

/**
 * The board for a game id, or null for one this build has never heard of: an
 * old tab against a newer server, which is a real thing that happens and not a
 * reason to throw.
 *
 * The cast is the one place the wire is taken at its word, and it is confined
 * to this function on purpose: everything above has been checked, and the only
 * unchecked step left is "the server said this room is playing `gameId`, so
 * `state` is that game's state". If that is ever false the server is lying to
 * itself, which no cast here could have caught anyway.
 */
export function boardFor(gameId: string): Board<GameId> | null {
  return (BOARDS as Record<string, Board<GameId> | undefined>)[gameId] ?? null;
}
