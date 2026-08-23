import { COLS, ROWS, landingRow, type C4State } from "../../shared/games/connect4.js";
import type { BoardProps } from "./boards.js";
import type { C4Move } from "../../shared/games/connect4.js";

export function Connect4Board({
  state,
  canAct,
  onMove,
}: BoardProps<C4State, C4Move>) {
  const winning = new Set((state.winningLine ?? []).map(([r, c]) => `${r},${c}`));

  return (
    // Not role="grid": that pattern requires row and gridcell descendants, and
    // these are seven column buttons. A labelled group is what this actually is.
    <div className="board" role="group" aria-label="Connect Four board">
      {Array.from({ length: COLS }, (_, col) => {
        const full = landingRow(state.board, col) === -1;
        const playable = canAct && !full;
        return (
          <button
            key={col}
            className="column surface"
            onClick={() => playable && onMove({ type: "drop", col })}
            disabled={!playable}
            aria-label={`Drop in column ${col + 1}${full ? " (full)" : ""}`}
          >
            {Array.from({ length: ROWS }, (_, row) => {
              const cell = state.board[row][col];
              // The class lands on a different element each move, which is what
              // restarts the drop animation — a re-render of the same position
              // (a reconnect, say) deliberately does not replay it.
              const justLanded =
                state.lastMove?.row === row && state.lastMove?.col === col;
              const classes = [
                "cell",
                cell === null ? "empty" : `p${cell}`,
                winning.has(`${row},${col}`) ? "winning" : "",
                justLanded ? "landed" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return <span key={row} className={classes} />;
            })}
            {playable && <span className="ghost" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
