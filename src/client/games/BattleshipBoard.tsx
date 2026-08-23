import { useEffect, useRef, useState } from "react";
// Values from battleshipDisplay.js, which imports nothing — the board must
// never pull the reducer in. The types below are type-only, so they are erased
// and carry no runtime import.
import {
  BOARD_SIZE,
  FLEET,
  afloat,
  canAct,
  fleetReady,
  isHidden,
  isSunk,
  opponentOf,
  placementError,
  shipAt,
  shotAt,
  squareName,
  unplaced,
} from "../../shared/games/battleshipDisplay.js";
import type {
  BsMove,
  BsState,
  Ship,
  ShipKind,
} from "../../shared/games/battleshipDisplay.js";
import { play } from "../sfx.js";

interface Props {
  state: BsState;
  seat: number | null;
  names: string[];
  onMove(move: BsMove): void;
}

/**
 * Note the absence of `myTurn`. Placing is free-simultaneous, and firing hands
 * the guns over only on a miss, so whether this player may act right now is a
 * question only `canAct` answers correctly in both halves of the game.
 */

const ROWS = Array.from({ length: BOARD_SIZE }, (_, i) => i);

/** Every square a ship would take if it were dropped here. */
function ghostCells(
  kind: ShipKind,
  row: number,
  col: number,
  horizontal: boolean,
): Array<[number, number]> {
  const size = FLEET.find((cls) => cls.kind === kind)?.size ?? 0;
  return Array.from({ length: size }, (_, i) =>
    horizontal ? [row, col + i] : [row + i, col],
  );
}

/**
 * The board's two grids are the same ten-by-ten thing seen from either side,
 * so they are one component. What differs is what a square knows about itself,
 * which the caller supplies as a class and a label.
 */
function Sea({
  label,
  cellClass,
  cellLabel,
  onCell,
  onHover,
  playable,
}: {
  label: string;
  cellClass(row: number, col: number): string;
  cellLabel(row: number, col: number): string;
  onCell(row: number, col: number): void;
  onHover?: (row: number, col: number) => void;
  playable(row: number, col: number): boolean;
}) {
  return (
    <div className="bs-sea" role="grid" aria-label={label}>
      {ROWS.map((row) => (
        <div className="bs-sea-row" role="row" key={row}>
          {ROWS.map((col) => (
            <button
              type="button"
              role="gridcell"
              key={col}
              className={`bs-cell surface ${cellClass(row, col)}`}
              disabled={!playable(row, col)}
              aria-label={cellLabel(row, col)}
              onClick={() => onCell(row, col)}
              onMouseEnter={() => onHover?.(row, col)}
              onFocus={() => onHover?.(row, col)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * What is left of a fleet, ship by ship. The count of sunk ships is the only
 * information a player really tracks between shots, and counting wrecks off
 * a grid of a hundred squares is exactly the chore a scoreboard exists to
 * spare them.
 *
 * The pips are damage, and for an enemy fleet they stay dark until a ship goes
 * down and fills them all at once — `view()` wipes the damage on anything
 * still afloat, because which ship a hit belonged to is the thing the player
 * is supposed to be working out.
 */
function Roster({ fleet, label }: { fleet: Ship[]; label: string }) {
  return (
    <ul className="bs-roster" aria-label={label}>
      {FLEET.map((cls) => {
        const ship = fleet.find((s) => s.kind === cls.kind);
        const sunk = ship !== undefined && isSunk(ship);
        return (
          <li key={cls.kind} className={sunk ? "bs-ship sunk" : "bs-ship"}>
            <span className="bs-ship-name">{cls.name}</span>
            <span className="bs-pips" aria-hidden="true">
              {Array.from({ length: cls.size }, (_, i) => (
                <i key={i} className={ship?.hits[i] ? "hit" : ""} />
              ))}
            </span>
            <span className="bs-ship-note">{sunk ? "sunk" : `${cls.size}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Placing: your own sea, a ship in hand, and somewhere to put it. */
function Harbour({
  state,
  seat,
  themName,
  themHere,
  onMove,
}: {
  state: BsState;
  seat: number;
  themName: string;
  /** False while their seat is still empty — they have not joined yet. */
  themHere: boolean;
  onMove(move: BsMove): void;
}) {
  const fleet = state.fleets[seat];
  const waiting = unplaced(fleet);
  const [horizontal, setHorizontal] = useState(true);
  const [holding, setHolding] = useState<ShipKind | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);

  // The ship in hand is whichever is selected, else the next one waiting —
  // so the common case (place them in order) needs no selecting at all, and
  // taking a ship back puts that class straight back in hand.
  const inHand = holding !== null && waiting.some((cls) => cls.kind === holding)
    ? holding
    : (waiting[0]?.kind ?? null);

  useEffect(() => {
    if (inHand === null) setHover(null);
  }, [inHand]);

  const ready = fleetReady(fleet);
  const theyAreReady = fleetReady(state.fleets[opponentOf(seat)]);

  const ghost =
    inHand !== null && hover !== null ? ghostCells(inHand, hover[0], hover[1], horizontal) : [];
  const ghostOk =
    inHand !== null &&
    hover !== null &&
    placementError(fleet, inHand, hover[0], hover[1], horizontal) === null;

  function cellClass(row: number, col: number): string {
    const ship = shipAt(fleet, row, col);
    const shadowed = ghost.some(([r, c]) => r === row && c === col);
    return [ship ? "ship" : "", shadowed ? (ghostOk ? "ghost" : "ghost bad") : ""]
      .filter(Boolean)
      .join(" ");
  }

  function cellLabel(row: number, col: number): string {
    const ship = shipAt(fleet, row, col);
    const where = squareName(row, col);
    if (ship) return `${where}, your ${ship.kind} — tap to take it back`;
    if (inHand === null) return `${where}, empty`;
    return `${where}, place your ${inHand} here`;
  }

  return (
    <div className="board bs-board bs-harbour">
      <p className="bs-brief">
        Set out your fleet. Tap a square to drop the ship in hand, tap a ship to
        take it back.
      </p>

      <div className="bs-hand">
        {FLEET.map((cls) => {
          const out = fleet.some((ship) => ship.kind === cls.kind);
          return (
            <button
              type="button"
              key={cls.kind}
              className={[
                "bs-pick",
                out ? "out" : "",
                !out && cls.kind === inHand ? "in-hand" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={out || ready}
              aria-pressed={!out && cls.kind === inHand}
              onClick={() => setHolding(cls.kind)}
            >
              {cls.name}
              <span className="bs-pick-size">{cls.size}</span>
            </button>
          );
        })}
      </div>

      <div className="bs-tools">
        <button
          type="button"
          className="bs-tool"
          disabled={ready}
          aria-pressed={!horizontal}
          onClick={() => setHorizontal((current) => !current)}
        >
          {horizontal ? "Lying across" : "Standing down"}
        </button>
        <button
          type="button"
          className="bs-tool"
          disabled={ready}
          onClick={() => onMove({ type: "scatter" })}
        >
          Scatter the rest
        </button>
      </div>

      <Sea
        label="Your waters"
        cellClass={cellClass}
        cellLabel={cellLabel}
        playable={(row, col) =>
          !ready && (shipAt(fleet, row, col) !== null || inHand !== null)
        }
        onHover={(row, col) => setHover([row, col])}
        onCell={(row, col) => {
          const ship = shipAt(fleet, row, col);
          if (ship) {
            onMove({ type: "unplace", kind: ship.kind });
            setHolding(ship.kind);
            return;
          }
          if (inHand !== null) onMove({ type: "place", kind: inHand, row, col, horizontal });
        }}
      />

      <p className="bs-waiting" aria-live="polite">
        {ready
          ? !themHere
            ? "Fleet at sea. Send the code — you can start the moment they arrive."
            : theyAreReady
              ? "Both fleets are at sea."
              : `Fleet at sea. Waiting for ${themName} to finish placing.`
          : themHere && theyAreReady
            ? `${themName} is ready and waiting.`
            : `${waiting.length} ${waiting.length === 1 ? "ship" : "ships"} still in harbour.`}
      </p>
    </div>
  );
}

/**
 * Every shot fired, heard by everyone watching — hull or water.
 *
 * Battleships opts out of the generic move sound in `sfx.ts` precisely so this
 * can exist: a shot has a result, and a wooden knock that says "somebody
 * moved" would be the wrong half of the news. Both seats are watched rather
 * than just yours, because a miss of theirs is the best thing that happens to
 * you all game.
 *
 * Counts, not identities: shots are only ever appended, so a longer list is a
 * new shot and its last entry is the one that was just fired. A rematch resets
 * the lists to empty, which is a shorter list and therefore silent.
 */
function useShotSounds(state: BsState): void {
  const seen = useRef<number[] | null>(null);
  useEffect(() => {
    const counts = state.shots.map((shots) => shots.length);
    const before = seen.current;
    seen.current = counts;
    // A board opened mid-game already has shots on it. They are history, not
    // news, and firing all of them at once would be a barrage.
    if (!before || before.length !== counts.length) return;
    counts.forEach((count, index) => {
      if (count <= before[index]) return;
      play(state.shots[index][count - 1].hit ? "hit" : "miss");
    });
  }, [state]);
}

export function BattleshipBoard({ state, seat, names, onMove }: Props) {
  useShotSounds(state);
  const them = seat === null ? null : opponentOf(seat);
  const nameFor = (index: number | null) =>
    index === null ? "" : index === seat ? "You" : names[index] || `Player ${index + 1}`;

  // A spectator has no fleet to set out and no guns to fire; they get the
  // firing view below, with every square inert.
  if (state.phase === "placing") {
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
  const myShot = mine && canAct(state, seat);
  // Which shots are on which board: yours land in their waters, theirs in
  // yours. Getting this pair the wrong way round is the one mistake that
  // would make the whole screen quietly lie, so it is named once, here.
  const yourShots = mine ? state.shots[seat] : [];
  const theirShots = them === null ? [] : state.shots[them];
  const yourFleet = mine ? state.fleets[seat] : [];
  const theirFleet = them === null ? [] : state.fleets[them];

  function targetClass(row: number, col: number): string {
    const shot = shotAt(yourShots, row, col);
    // A wreck is only ever a ship `view()` chose to reveal — sunk, or the game
    // is over. Either way it is ours to draw.
    const wreck = shipAt(theirFleet, row, col);
    return [shot ? (shot.hit ? "hit" : "miss") : "", wreck && !isHidden(wreck) ? "wreck" : ""]
      .filter(Boolean)
      .join(" ");
  }

  return (
    <div className="board bs-board">
      <div className="bs-seas">
        <section className="bs-panel">
          <h3 className="bs-panel-head">
            <span>{them === null ? "Their waters" : `${nameFor(them)}'s waters`}</span>
            <span className="bs-count">{afloat(theirFleet).length} afloat</span>
          </h3>
          <Sea
            label={them === null ? "Their waters" : `${nameFor(them)}'s waters`}
            cellClass={targetClass}
            cellLabel={(row, col) => {
              const shot = shotAt(yourShots, row, col);
              const where = squareName(row, col);
              if (!shot) return myShot ? `Fire at ${where}` : where;
              if (shot.sunk) return `${where}, hit — sank the ${shot.sunk}`;
              return `${where}, ${shot.hit ? "hit" : "miss"}`;
            }}
            playable={(row, col) => myShot && shotAt(yourShots, row, col) === null}
            onCell={(row, col) => {
              if (myShot) onMove({ type: "fire", row, col });
            }}
          />
          <Roster fleet={theirFleet} label="Their fleet" />
        </section>

        <section className="bs-panel">
          <h3 className="bs-panel-head">
            <span>Your waters</span>
            <span className="bs-count">{afloat(yourFleet).length} afloat</span>
          </h3>
          <Sea
            label="Your waters"
            cellClass={(row, col) => {
              const ship = shipAt(yourFleet, row, col);
              const shot = shotAt(theirShots, row, col);
              return [ship ? "ship" : "", shot ? (shot.hit ? "hit" : "miss") : ""]
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
            playable={() => false}
            onCell={() => undefined}
          />
          <Roster fleet={yourFleet} label="Your fleet" />
        </section>
      </div>

      {mine && state.phase === "firing" && (
        <p className="bs-waiting" aria-live="polite">
          {myShot
            ? // A hit keeps the guns, so a player mid-streak is told why they
              // still have them — otherwise a second shot looks like a bug.
              yourShots.at(-1)?.hit
              ? "A hit — fire again."
              : "Your shot — pick a square."
            : `Waiting for ${nameFor(them)} to fire.`}
        </p>
      )}
    </div>
  );
}
