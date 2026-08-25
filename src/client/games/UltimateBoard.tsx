// Values from ultimateDisplay.js, which imports nothing. One number does three
// jobs here (a square's place in its small board is also the board it sends the
// opponent to) and a second copy of that arithmetic would be a board pointing
// at the wrong square. The types below are type-only, so they carry no import.
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
import type { Result, UtMove, UtState } from "../../shared/games/ultimateDisplay.js";
import { useEffect, useRef, useState } from "react";
import { wantsStillness } from "../motion.js";

import type { BoardProps } from "./boards.js";

type Props = BoardProps<UtState, UtMove>;

/**
 * Nine boards inside a board, and the only hard part is showing which one you
 * are allowed to play in.
 *
 * Three things are drawn about a small board and they are deliberately three
 * different marks, because a player has to read all of them at once: whose it
 * is (the ground it stands on, and the winning three in a seat colour),
 * whether it is still in play (the green edge), and whether it is part of the
 * line that won the game (the ink edge, the same one Connect Four draws).
 *
 * Whose it is used to be the marks alone, and it did not carry: nine small
 * marks in a block a third the width of a phone is something you count rather
 * than see, and across nine blocks nobody counts. So a settled board takes its
 * winner's hue as ground, and the board you are sent to lights its empty
 * squares: one channel each for the two questions this board is always being
 * asked. The CSS holds the measurements.
 *
 * A settled board keeps its marks rather than being crossed out. They are the
 * record of how it was won, and on a phone the alternative, one big mark over
 * nine small ones, is two overlapping shapes in the same colour.
 */
export function UltimateBoard({ state, seat, names, canAct, onMove }: Props) {
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
            canAct={canAct}
            names={names}
            onMove={onMove}
          />
        ))}
      </div>

      {/* Boards won, which is both the object of the game and the tiebreak if
          nobody gets three in a row. The mark beside each name is the one that
          player is leaving on the board: the legend for everything above. */}
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

/**
 * How long the mark is on the board for, in `ultimate.css`: the fall, the
 * dust, and the fade that takes it away again. The two have to agree: this
 * number is what unmounts the element, and cutting it short would snatch the
 * mark away mid-fade.
 */
const FALL_MS = 900;

/**
 * The seat that has just this moment won this small board, or null.
 *
 * Winning one of the nine is the event this game is made of and the board said
 * it in a single frame: the nine squares took a tint, and you found out by
 * noticing. Nine small marks in a block a third of a phone wide is something
 * you count rather than see, the same reason the tint exists at all.
 *
 * So the board is stamped, once, with a mark big enough to read across the
 * grid, and then the stamp goes away. Going away is the whole design. The file
 * comment above explains why a settled board keeps its nine small marks rather
 * than wearing one big one, and that reasoning holds: the marks are the record
 * of *how* it was won, and a permanent overlay is two shapes in one colour. A
 * mark that lands, throws up dust and lifts says the same thing without
 * spending any of the board on saying it.
 *
 * `null -> 0 | 1` only. A drawn board is not won by anybody and gets nothing;
 * a board that was already settled when this client joined has no news in it,
 * and replaying the stamps of a game in progress on every reconnection would
 * be nine boards being won at once.
 */
function useJustWon(result: Result): 0 | 1 | null {
  const seen = useRef(result);
  const [stamped, setStamped] = useState<0 | 1 | null>(null);

  useEffect(() => {
    const was = seen.current;
    seen.current = result;
    if (was !== null || (result !== 0 && result !== 1)) return;
    // Asked at the moment the movement would start, as everywhere else. There
    // is nothing withheld by skipping it: the tint, the marks and the spoken
    // label all say who won, and this only says it louder.
    if (wantsStillness()) return;
    setStamped(result);
    const done = setTimeout(() => setStamped(null), FALL_MS);
    return () => clearTimeout(done);
  }, [result]);

  return stamped;
}

function SmallBoard({
  state,
  small,
  target,
  only,
  crowned,
  canAct,
  names,
  onMove,
}: {
  state: UtState;
  small: number;
  target: boolean;
  only: boolean;
  crowned: boolean;
  canAct: boolean;
  names: string[];
  onMove(move: UtMove): void;
}) {
  const result = state.results[small];
  const stamped = useJustWon(result);
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
    <div className={classes} role="group" aria-label={`${boardName(small)}, ${standing}`}>
      {/* The stamp. Purely a picture of what the group label above already
          says, so it is hidden from the reader rather than announced twice,
          and it must never be in the way of the squares underneath, which stay
          pressable on the nine boards around it while this one lands. */}
      {stamped !== null && (
        <span className="ut-fall" aria-hidden="true">
          <span className={`ut-mark m${stamped}`} />
          <span className="ut-dust" />
        </span>
      )}
      {Array.from({ length: SPOTS }, (_, spot) => {
        const cell = cellAt(small, spot);
        const mark = state.board[cell];
        const playable = canAct && legal(state, cell);
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
                ? `${cellName(cell)}, ${nameFor(mark)}`
                : playable
                  ? `${cellName(cell)}, sends to the ${boardName(spotOf(cell))}`
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
