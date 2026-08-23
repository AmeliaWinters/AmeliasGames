// Values from ultimateDisplay.js, which imports nothing: one number does three
// jobs on this board — a square's place in its small board is also the board it
// sends the opponent to — and a second copy of that arithmetic would be a board
// pointing at the wrong square. The types below are type-only, so they are
// erased and carry no import.
import {
  SPOTS,
  boardName,
  cellAt,
  cellName,
  legal,
  openBoards,
  spotOf,
  tally,
} from "../../shared/games/ultimateDisplay.js";
import type { UtMove, UtState } from "../../shared/games/ultimateDisplay.js";

interface Props {
  state: UtState;
  seat: number | null;
  names: string[];
  myTurn: boolean;
  onMove(move: UtMove): void;
}

/**
 * Nine boards inside a board, and the only hard part is showing which one you
 * are allowed to play in.
 *
 * Three things are drawn about a small board and they are deliberately three
 * different marks, because a player has to read all of them at once: whose it
 * is (the marks in it, and the winning three in a seat colour), whether it is
 * still in play (the green edge), and whether it is part of the line that won
 * the game (the ink edge, the same one Connect Four draws).
 *
 * A settled board keeps its marks rather than being crossed out. It is the
 * record of how it was won, and on a phone the alternative — one big mark over
 * nine small ones — is two overlapping shapes in the same colour.
 */
export function UltimateBoard({ state, seat, names, myTurn, onMove }: Props) {
  const nameFor = (index: 0 | 1) => names[index] ?? `Player ${index + 1}`;
  const open = new Set(openBoards(state));
  // One open board is an instruction; eight is a permission. Both are true
  // statements about the position, so both are drawn, at different weights.
  const only = open.size === 1;
  const crowned = new Set(state.winningLine ?? []);
  const counts = tally(state);

  return (
    <div className="ut">
      <div className="ut-board" role="group" aria-label="Ultimate Tic-Tac-Toe board">
        {Array.from({ length: SPOTS }, (_, small) => (
          <SmallBoard
            key={small}
            state={state}
            small={small}
            target={open.has(small)}
            only={only}
            crowned={crowned.has(small)}
            myTurn={myTurn}
            names={names}
            onMove={onMove}
          />
        ))}
      </div>

      {/* Boards won, which is both the object of the game and the tiebreak if
          nobody gets three in a row. The mark beside each name is the one that
          player is leaving on the board — the legend for everything above. */}
      <ul className="ut-tally">
        {([0, 1] as const).map((index) => (
          <li key={index} className={`ut-side s${index}${seat === index ? " you" : ""}`}>
            <span className={`ut-mark m${index}`} aria-hidden="true" />
            <span className="ut-who">{nameFor(index)}</span>
            <span className="ut-count">
              {counts[index]} {counts[index] === 1 ? "board" : "boards"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SmallBoard({
  state,
  small,
  target,
  only,
  crowned,
  myTurn,
  names,
  onMove,
}: {
  state: UtState;
  small: number;
  target: boolean;
  only: boolean;
  crowned: boolean;
  myTurn: boolean;
  names: string[];
  onMove(move: UtMove): void;
}) {
  const result = state.results[small];
  const line = new Set(state.lines[small] ?? []);
  const classes = [
    "ut-small",
    result === null ? "live" : "settled",
    result === "drawn" ? "drawn" : result !== null ? `won${result}` : "",
    target ? "target" : "",
    target && only ? "only" : "",
    crowned ? "crowned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Said in full, because a group label is all a screen reader has to go on
  // once it is inside the nine buttons.
  const nameFor = (index: 0 | 1) => names[index] ?? `Player ${index + 1}`;
  const standing =
    result === "drawn"
      ? "drawn"
      : result !== null
        ? `won by ${nameFor(result)}`
        : target
          ? only
            ? "in play, and the board to play in"
            : "in play"
          : "in play, but not the board to play in";

  return (
    <div className={classes} role="group" aria-label={`${boardName(small)} — ${standing}`}>
      {Array.from({ length: SPOTS }, (_, spot) => {
        const cell = cellAt(small, spot);
        const mark = state.board[cell];
        const playable = myTurn && legal(state, cell);
        const cellClasses = [
          "ut-cell",
          "surface",
          mark === null ? "empty" : `m${mark}`,
          line.has(spot) ? "line" : "",
          state.lastMove === cell ? "landed" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            key={spot}
            className={cellClasses}
            onClick={() => playable && onMove({ type: "play", cell })}
            disabled={!playable}
            // The consequence, not just the square: where this move sends the
            // opponent is the whole game, and it is the one thing a player
            // cannot see by looking at the square they are about to press.
            aria-label={
              mark !== null
                ? `${cellName(cell)} — ${nameFor(mark)}`
                : playable
                  ? `${cellName(cell)} — sends to the ${boardName(spotOf(cell))}`
                  : cellName(cell)
            }
          >
            <span className="ut-mark" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
