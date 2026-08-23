import type { ComponentType } from "react";
import { GAME_MANIFEST } from "../../shared/games/manifest.js";
// Every import below is type-only but the last, so no reducer and no word list
// follows any of them into the bundle. The state and move types happen to live
// beside the rules for several games; `import type` erases the whole module.
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
import { Connect4Board } from "./Connect4Board.js";
import { BackgammonGame } from "./BackgammonBoard.js";
import { WheelBoard } from "./WheelBoard.js";
import { WordleBoard } from "./WordleBoard.js";
import { YahtzeeBoard } from "./YahtzeeBoard.js";
import { BattleshipBoard } from "./BattleshipBoard.js";
import { LiarsDiceBoard } from "./LiarsDiceBoard.js";
import { WordHuntBoard } from "./WordHuntBoard.js";
import { MorrisBoard } from "./MorrisBoard.js";
import { UltimateBoard } from "./UltimateBoard.js";

/** Every id the manifest offers. */
export type GameId = keyof typeof GAME_MANIFEST;

/**
 * What the server sends for each game, and what each board sends back.
 *
 * This exists because `RoomView.state` arrives as `unknown` — it came off a
 * socket as JSON, and no amount of wishing makes that a `BgState`. Somewhere a
 * human has to assert which game's state it is. That assertion used to be made
 * ten times over, once per case in a switch, each one pairing a `gameId`
 * string with a cast by hand:
 *
 * ```
 * case "morris":  <MorrisBoard state={room.state as MmState} … />
 * ```
 *
 * Nothing checked that the two halves of that line matched. Pairing the wrong
 * state with a board is not a type error there, it is a board reading fields
 * that are not on the object — which shows up as a white screen on somebody's
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
}

/** The other half of the pair — see `GameStates`. */
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
}

/**
 * What every board is handed. The same five things for all ten, whether or not
 * a given board wants all five — a uniform shape is what lets them be looked
 * up in a table rather than spelled out one `case` at a time.
 */
export interface BoardProps<S, M> {
  /** Already redacted for this seat by the game's `view()`. */
  state: S;
  /** Null for a socket with no seat. A board must not assume it has one. */
  seat: number | null;
  names: string[];
  /**
   * Whether this player may act right now — the server's own answer, from the
   * same predicate `applyMove` will consult. Gate every control on this.
   *
   * It replaced a `myTurn` prop computed as `room.turn === seat`, which was
   * wrong for the four games that are not strictly alternating; each of those
   * boards had to refuse the prop and import a predicate of its own, with a
   * comment explaining why. There is nothing left to explain.
   *
   * True as of `now`. A board on a clock still owns the last second — see
   * Word Hunt, which checks the running countdown as well.
   */
  canAct: boolean;
  /** The server's clock as of this state. Boards off the clock ignore it. */
  now: number;
  onMove(move: M): void;
}

export type Board<K extends GameId> = ComponentType<BoardProps<GameStates[K], GameMoves[K]>>;

/**
 * The one place that knows which board goes with which game. Everything above
 * it — the lobby, seating, reconnection, the rematch — is game-agnostic, so
 * adding a game means an entry here and a line in each map above.
 */
const BOARDS: { [K in GameId]: Board<K> } = {
  connect4: Connect4Board,
  // One component for board and controls: they share whether the dice have
  // stopped, and two copies of that could disagree.
  backgammon: BackgammonGame,
  wheel: WheelBoard,
  wordle: WordleBoard,
  liarsdice: LiarsDiceBoard,
  battleship: BattleshipBoard,
  yahtzee: YahtzeeBoard,
  wordhunt: WordHuntBoard,
  morris: MorrisBoard,
  ultimate: UltimateBoard,
};

/**
 * The board for a game id, or null for one this build has never heard of —
 * an old tab against a newer server, which is a real thing that happens and
 * not a reason to throw.
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
