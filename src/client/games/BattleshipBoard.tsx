import { useEffect, useState } from "react";
// Values from battleshipDisplay.js, which imports nothing: the board must
// never pull the reducer in. The types below are type-only, so they carry no
// runtime import.
import {
  afloat,
  opponentOf,
  shipAt,
  shipClass,
  shotAt,
  shotLog,
  squareName,
} from "../../shared/games/battleshipDisplay.js";
import type { BsMove, BsState } from "../../shared/games/battleshipDisplay.js";

import type { BoardProps } from "./boards.js";
import { namer } from "./names.js";
import { Harbour } from "./battleship/Harbour.js";
import { sameCell } from "./battleship/geometry.js";
import type { Cell } from "./battleship/geometry.js";
import { Roster, Sea } from "./battleship/parts.js";
import { useShotSounds, useShownWaters } from "./battleship/timing.js";

// In this board's chunk, not the entry sheet. See `styles/index.css`.
import "../styles/games/battleship.css";

type Props = BoardProps<BsState, BsMove>;

export function BattleshipBoard({ state, seat, names, canAct, onMove }: Props) {
  const sinking = useShotSounds(state);
  const them = seat === null ? null : opponentOf(seat);
  const nameFor = namer(names, seat);

  // Where the guns are pointed, which is not the same as where they have
  // fired. A shot cannot be taken back and costs the turn that fired it, and
  // the squares are small, small enough on a phone that a thumb covers three of
  // them, so a press aims and a second press on the same square fires.
  //
  // What makes that safe without a confirm button under the board is that the
  // aim is drawn *outside* the grid as well as in it: the rank and the file
  // light in the gutters and a line runs out to them, so the square being
  // committed to is named where there is room to read it.
  const [aim, setAim] = useState<Cell | null>(null);
  const [cursor, setCursor] = useState<Cell>([0, 0]);

  // Losing the guns is the moment a stale aim turns dangerous: it would still
  // be sitting there, armed, when the turn came back round.
  const armed = seat !== null && canAct;
  useEffect(() => {
    if (!armed) setAim(null);
  }, [armed]);

  // Called above the placing return, because the phase changes under it and a
  // hook that only exists in one phase is not a hook.
  //
  // Once the game is over nobody is being fired at, and the sea worth looking
  // at is theirs: the fleet that has been hidden all game is revealed there.
  const shown = useShownWaters(canAct || state.phase === "over" ? "theirs" : "yours");

  if (state.phase === "placing") {
    // A spectator has no fleet to set out and no guns to fire; they get the
    // firing view below, with every square inert.
    if (seat === null) {
      return (
        <div className="board bs-board bs-harbour">
          <p className="bs-waiting">Both fleets are putting to sea.</p>
        </div>
      );
    }
    return (
      <Harbour
        state={state}
        seat={seat}
        themName={names[opponentOf(seat)] || "the other player"}
        themHere={Boolean(names[opponentOf(seat)])}
        onMove={onMove}
      />
    );
  }

  const mine = seat !== null;
  const myShot = mine && canAct;
  // Which shots are on which board: yours land in their waters, theirs in
  // yours. Getting this pair the wrong way round is the one mistake that
  // would make the whole screen quietly lie, so it is named once, here.
  const yourShots = mine ? state.shots[seat] : [];
  const theirShots = them === null ? [] : state.shots[them];
  const yourFleet = mine ? state.fleets[seat] : [];
  const theirFleet = them === null ? [] : state.fleets[them];
  const log = shotLog(state.shots);
  // The newest shot of the game, whoever fired it, ringed where it fell. Two
  // dozen red squares all look equally recent otherwise, and "where did they
  // just shoot" is the first question on coming back to the board.
  const latest = log.at(-1) ?? null;
  const isLatest = (row: number, col: number, firedBy: number) =>
    latest !== null && latest.seat === firedBy && latest.row === row && latest.col === col;

  function fireAt(cell: Cell) {
    if (!myShot) return;
    if (!sameCell(aim, cell)) {
      setAim(cell);
      return;
    }
    setAim(null);
    onMove({ type: "fire", row: cell[0], col: cell[1] });
  }

  function targetClass(row: number, col: number): string {
    const shot = shotAt(yourShots, row, col);
    return [
      shot ? (shot.hit ? "hit" : "miss") : "",
      sameCell(aim, [row, col]) ? "aimed" : "",
      seat !== null && isLatest(row, col, seat) ? "latest" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  // What the next tap does, in the one line that used to be a line and a
  // button. The square is named in full before it is committed to, which is
  // what the button was for.
  const orders = myShot ? (
    aim ? (
      <span>
        <b>Locked</b> on <span className="bs-coord">{squareName(aim[0], aim[1])}</span>, tap
        again to fire
      </span>
    ) : yourShots.at(-1)?.hit ? (
      // A hit keeps the guns, so a player mid-streak is told why they still
      // have them, or a second shot looks like a bug.
      <span>
        <b>A hit.</b> Fire again.
      </span>
    ) : (
      <span>
        <b>Your shot.</b> Pick a square.
      </span>
    )
  ) : (
    // Their last shot, which is the one thing the shot log was really for:
    // "where did they just go" is asked every turn, and it does not need a
    // scrolling panel under the board to answer.
    <span>
      {mine ? `${nameFor(them)} is firing` : "Watching"}
      {theirShots.length > 0 && (
        <>
          {", last shot "}
          <span className="bs-coord">
            {squareName(theirShots[theirShots.length - 1].row, theirShots[theirShots.length - 1].col)}
          </span>
          {theirShots[theirShots.length - 1].hit ? ", a hit" : ", a miss"}
        </>
      )}
    </span>
  );

  // One sea at a time for a seated player: two ten by tens side by side put a
  // 12px square on a phone, and half of that screen is always the board nobody
  // is shooting at. A spectator still gets both, because neither of them is
  // theirs and there is no turn of their own to follow.
  const solo = seat !== null;

  const theirWaters = (
    <section className="bs-panel">
      <h3 className="bs-panel-head">
        <span className="bs-who them">
          {them === null ? "Their waters" : `${nameFor(them)}'s waters`}
        </span>
        <span className="bs-count">{afloat(theirFleet).length} afloat</span>
      </h3>
      <Sea
        label={them === null ? "Their waters" : `${nameFor(them)}'s waters`}
        cellClass={targetClass}
        // A hull is only ever drawn here once `view()` has revealed her:
        // sunk, or the game is over. `Hulls` skips the hidden ones, so
        // handing it the whole fleet reveals nothing.
        fleet={theirFleet}
        sinking={sinking}
        aim={aim}
        cellLabel={(row, col) => {
          const shot = shotAt(yourShots, row, col);
          const where = squareName(row, col);
          if (!shot) {
            if (!myShot) return where;
            return sameCell(aim, [row, col])
              ? `${where}, aimed. Press again to fire`
              : `Aim at ${where}`;
          }
          if (shot.sunk) return `${where}, hit, and sank the ${shot.sunk}`;
          return `${where}, ${shot.hit ? "hit" : "miss"}`;
        }}
        playable={(row, col) => myShot && shotAt(yourShots, row, col) === null}
        cursor={myShot ? cursor : null}
        onCursor={(cell) => setCursor(cell)}
        onActivate={(row, col) => fireAt([row, col])}
      />
      {/* Over the sea rather than under it. A line in the flow had to hold
          its height all game so that its arrival did not shove everything
          below it down, which left an empty bar under the board for the
          whole game. Floating, it can simply not be there. */}
      {sinking && (
        <p className="bs-banner">The {shipClass(sinking)?.name} is sunk</p>
      )}
      <Roster fleet={theirFleet} label="Their fleet" sinking={sinking} />
    </section>
  );

  const yourWaters = (
    <section className="bs-panel">
      <h3 className="bs-panel-head">
        <span className="bs-who">Your waters</span>
        <span className="bs-count">{afloat(yourFleet).length} afloat</span>
      </h3>
      <Sea
        label="Your waters"
        fleet={yourFleet}
        sinking={sinking}
        cellClass={(row, col) => {
          const shot = shotAt(theirShots, row, col);
          return [
            shot ? (shot.hit ? "hit" : "miss") : "",
            them !== null && isLatest(row, col, them) ? "latest" : "",
          ]
            .filter(Boolean)
            .join(" ");
        }}
        cellLabel={(row, col) => {
          const ship = shipAt(yourFleet, row, col);
          const shot = shotAt(theirShots, row, col);
          const where = squareName(row, col);
          if (ship && shot) return `${where}, your ${ship.kind}, hit`;
          if (ship) return `${where}, your ${ship.kind}`;
          if (shot) return `${where}, they missed`;
          return where;
        }}
        // Your own sea is a readout, not a control: every square is
        // disabled, so nothing here takes a tab stop from the guns.
        cursor={null}
        playable={() => false}
        onActivate={() => undefined}
      />
      <Roster fleet={yourFleet} label="Your fleet" sinking={sinking} />
    </section>
  );

  return (
    <div className="board bs-board">
      <div className={`bs-seas${solo ? " solo" : ""}`}>
        {solo ? (shown === "theirs" ? theirWaters : yourWaters) : (
          <>
            {theirWaters}
            {yourWaters}
          </>
        )}
      </div>

      {/* Announced as well as drawn. A screen reader gets hit and miss from
          the cell it just fired at, and would otherwise never hear the one
          piece of news that is not attached to a square. The banner above is
          a picture of this line, and this is the line. */}
      <p className="sr-only" role="status" aria-live="assertive">
        {sinking ? `The ${shipClass(sinking)?.name} is sunk` : ""}
      </p>

      {state.phase === "firing" && (
        <p className={`bs-orders${myShot ? "" : " waiting"}`} aria-live="polite">
          {orders}
        </p>
      )}
    </div>
  );
}
