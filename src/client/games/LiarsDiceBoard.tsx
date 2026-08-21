import { useEffect, useState } from "react";
// Values from liarsDiceDisplay.js, which imports nothing — the board must never
// pull the reducer into the client bundle. The types below are type-only, so
// they are erased and carry no runtime import.
import {
  FACES,
  beats,
  describeBid,
  describeCount,
  isOut,
  smallestRaise,
  totalDice,
} from "../../shared/games/liarsDiceDisplay.js";
import type { Bid, LdMove, LdState } from "../../shared/games/liarsDiceDisplay.js";
import { Die } from "./Die.js";

interface Props {
  state: LdState;
  seat: number | null;
  names: string[];
  myTurn: boolean;
  onMove(move: LdMove): void;
}

/**
 * Liar's Dice is played from two things: your own five dice, and how many dice
 * everyone else is holding. Both are on the board at all times, which is why
 * the hands are drawn as face-down dice rather than written out as a number —
 * "four dice" is something to read, four dice is something to count.
 *
 * The reveal is the other half. When a call settles a round the board keeps
 * showing the table exactly as it stood, every hand face up, with the dice that
 * counted marked — so a player can see *why* they lost the die before the next
 * round is dealt.
 */

/** What each seat is holding right now: their real hand, or the reveal. */
function handFor(state: LdState, index: number): number[] {
  return state.showdown ? (state.showdown.hands[index] ?? []) : (state.dice[index] ?? []);
}

export function LiarsDiceBoard({ state, seat, names, myTurn, onMove }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [face, setFace] = useState(1);

  // The pickers start on the smallest bid that would be legal, which is where a
  // player reaches first and saves them tapping up from one every time. Re-armed
  // whenever the bid on the table moves, so they never sit on a stale bid that
  // the Bid button then refuses.
  const opening = smallestRaise(state);
  const raiseKey = state.bid ? `${state.bid.quantity}-${state.bid.face}` : `open-${state.round}`;
  useEffect(() => {
    if (!opening) return;
    setQuantity(opening.quantity);
    setFace(opening.face);
    // `opening` is derived from exactly this, and depending on the object
    // itself would re-arm the pickers on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raiseKey]);

  const nameFor = (index: number) =>
    index === seat ? "You" : names[index] || `Player ${index + 1}`;
  // "Bo called you's three 2s" is what naming a seat twice gets you. Second
  // person needs its own possessive, and its own verb.
  const possessiveOf = (index: number) =>
    index === seat ? "your" : `${nameFor(index)}'s`;

  const total = totalDice(state);
  const proposed: Bid = { seat: seat ?? 0, quantity, face };
  const legal = quantity <= total && beats(proposed, state.bid);
  const bidding = myTurn && state.phase === "bid";
  const showdown = state.showdown;

  return (
    <div className="ld">
      <p className="ld-round">
        Round {state.round} · {total} {total === 1 ? "die" : "dice"} on the table
      </p>

      {/* Every hand, yours face up and theirs face down — until a call turns
          them all over. */}
      <div className="ld-hands">
        {state.dice.map((_, index) => {
          const hand = handFor(state, index);
          const out = isOut(state, index) && !showdown?.out.includes(index);
          return (
            <div
              key={index}
              className={[
                "ld-hand",
                `p${index}`,
                state.turn === index && !state.over ? "active" : "",
                out ? "out" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <span className="chip" aria-hidden="true" />
              <span className="who">{nameFor(index)}</span>
              <span className="ld-dice">
                {out ? (
                  <span className="note">out</span>
                ) : (
                  hand.map((value, i) => (
                    <Die
                      key={i}
                      value={value}
                      match={showdown !== null && value === showdown.bid.face}
                      label={
                        value >= 1 && value <= FACES
                          ? `${nameFor(index)}: die showing ${value}`
                          : `${nameFor(index)}: a hidden die`
                      }
                    />
                  ))
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* The bid, or what became of it. One block, because they are the same
          thing at two moments and swapping between them keeps the board still. */}
      <div className="ld-table" role="status" aria-live="polite">
        {showdown ? (
          <>
            <span className="ld-call">
              {nameFor(showdown.challenger)} called {possessiveOf(showdown.bid.seat)}{" "}
              {describeBid(showdown.bid)}
            </span>
            <span className="ld-outcome">
              There {showdown.actual === 1 ? "was" : "were"}{" "}
              {describeCount(showdown.actual, showdown.bid.face)} —{" "}
              {nameFor(showdown.loser)} {showdown.loser === seat ? "lose" : "loses"} a die
              {showdown.out.includes(showdown.loser)
                ? showdown.loser === seat
                  ? " and are out"
                  : " and is out"
                : ""}
            </span>
          </>
        ) : state.bid ? (
          <>
            <span className="ld-call">
              {nameFor(state.bid.seat)} {state.bid.seat === seat ? "bid" : "bids"}
            </span>
            <span className="ld-outcome">{describeBid(state.bid)}</span>
          </>
        ) : (
          <span className="ld-outcome">No bid yet</span>
        )}
      </div>

      {state.phase === "reveal" ? (
        <div className="ld-actions">
          <button className="primary" disabled={!myTurn} onClick={() => onMove({ type: "next" })}>
            {myTurn ? `Roll round ${state.round + 1}` : "Waiting on the next roll"}
          </button>
        </div>
      ) : (
        !state.over && (
          <>
            {/* The bid, built in two pieces: how many, and of what. Both are
                spinners rather than free text — there are ten legal quantities
                and six faces, and a number pad on a phone is a keyboard in the
                way of a two-tap decision. */}
            <div className="ld-bid">
              <div className="ld-stepper">
                <button
                  type="button"
                  className="ld-step"
                  disabled={!bidding || quantity <= 1}
                  aria-label="One fewer die"
                  onClick={() => setQuantity((n) => Math.max(1, n - 1))}
                >
                  −
                </button>
                <span className="ld-quantity" aria-live="off">
                  {quantity}
                </span>
                <button
                  type="button"
                  className="ld-step"
                  disabled={!bidding || quantity >= total}
                  aria-label="One more die"
                  onClick={() => setQuantity((n) => Math.min(total, n + 1))}
                >
                  +
                </button>
              </div>

              <div className="ld-faces">
                {Array.from({ length: FACES }, (_, i) => i + 1).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={value === face ? "ld-face picked" : "ld-face"}
                    disabled={!bidding}
                    aria-pressed={value === face}
                    aria-label={`Bid ${value}s`}
                    onClick={() => setFace(value)}
                  >
                    <Die value={value} label="" />
                  </button>
                ))}
              </div>
            </div>

            <div className="ld-actions">
              <button
                className="primary"
                disabled={!bidding || !legal}
                onClick={() => onMove({ type: "bid", quantity, face })}
              >
                Bid {describeBid(proposed)}
              </button>
              <button
                disabled={!bidding || state.bid === null}
                onClick={() => onMove({ type: "challenge" })}
              >
                Call liar
              </button>
            </div>

            <p className="ld-legend">
              {!myTurn
                ? "Ones are just ones — a bid counts only the face it names."
                : state.bid === null
                  ? "Open the round: name how many of a face are on the whole table."
                  : legal
                    ? `Raise past ${describeBid(state.bid)}, or call it a lie.`
                    : `That is not a raise on ${describeBid(state.bid)} — more dice, or a higher face.`}
            </p>
          </>
        )
      )}
    </div>
  );
}
