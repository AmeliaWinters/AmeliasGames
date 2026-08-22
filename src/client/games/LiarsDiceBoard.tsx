import { useEffect, useMemo, useState } from "react";
// Values from liarsDiceDisplay.js, which imports nothing — the board must never
// pull the reducer into the client bundle. The types below are type-only, so
// they are erased and carry no runtime import.
import {
  DICE_PER_PLAYER,
  FACES,
  beats,
  countInHand,
  describeBid,
  describeCount,
  isOut,
  smallestRaise,
  totalDice,
} from "../../shared/games/liarsDiceDisplay.js";
import type { Bid, LdMove, LdState, Showdown } from "../../shared/games/liarsDiceDisplay.js";
import { Die } from "./Die.js";
import { useReveal } from "../dice/useReveal.js";

interface Props {
  state: LdState;
  seat: number | null;
  names: string[];
  myTurn: boolean;
  onMove(move: LdMove): void;
}

/**
 * Liar's Dice is played from three things: your own five dice, how many dice
 * everyone else is holding, and what has already been said this round. All
 * three are on the board at all times, which is why the hands are drawn as
 * face-down dice rather than written out as a number — "four dice" is something
 * to read, four dice is something to count — and why the bidding stays visible
 * as a run rather than as whatever happened to be said last.
 *
 * The reveal is the other half. When a call settles a round the board keeps
 * showing the table exactly as it stood, every hand face up, with the dice that
 * counted marked — so a player can see *why* the die moved before the next
 * round is dealt.
 */

/**
 * What each seat is holding right now: their real hand, or the reveal — and
 * for a seat the reveal has not reached yet, still the face-down row it was
 * showing a moment ago.
 */
function handFor(state: LdState, index: number, turned: boolean): number[] {
  return state.showdown && turned
    ? (state.showdown.hands[index] ?? [])
    : (state.dice[index] ?? []);
}

/**
 * The order the hands turn over in: the bidding, oldest first, and then
 * everyone who never said anything.
 *
 * It ends on the seat that was challenged, because that is the hand the call
 * was about — and the run is what a call is reasoned from, so replaying it is
 * the reveal saying *why* before it says what.
 */
function revealOrder(state: LdState): number[] {
  const call = state.showdown;
  if (!call) return [];
  const seats = state.dice.map((_, index) => index);
  const said = call.bid.seat;
  const spoke = [...new Set(state.history.map((bid) => bid.seat))].filter((s) => s !== said);
  const silent = seats.filter((s) => s !== said && !spoke.includes(s));
  return [...spoke, ...silent, said];
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
  /** "You lose" but "Bo loses" — the whole of English subject agreement, here. */
  const verb = (index: number, plural: string, singular: string) =>
    index === seat ? plural : singular;

  const total = totalDice(state);
  const proposed: Bid = { seat: seat ?? 0, quantity, face };
  const legal = quantity <= total && beats(proposed, state.bid);
  const bidding = myTurn && state.phase === "bid";
  const canCall = bidding && state.bid !== null;
  const showdown = state.showdown;
  /*
    Turning the hands over, one at a time. The key changes exactly when there
    is a new call to settle — the round it settled plus who made it, since a
    round can only ever produce one — so a re-render for any other reason does
    not start the reveal again.
  */
  const order = useMemo(
    () => revealOrder(state),
    // Exactly what the order is built from. Depending on `state` itself would
    // rebuild it on every message, which is harmless here and would not be if
    // anything downstream ever depended on its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.showdown, state.history, state.dice.length],
  );
  const reveal = useReveal(
    showdown ? `${state.round}:${showdown.challenger}` : null,
    order,
  );
  // The count waits for the last hand. Being told the answer while a hand is
  // still face down is being told rather than shown.
  const counted = showdown !== null && reveal.done;
  // Every die on the table is claimed already: the bidding is finished and the
  // only moves left are the two calls. Saying so is kinder than a Bid button
  // that refuses everything the spinners can reach.
  const bidsExhausted = state.bid !== null && opening === null;
  // What you are holding of the face you are about to name. It is the one part
  // of the count you actually know, and counting it off your own row by eye
  // every time the spinner moves is arithmetic the board can just do.
  const mine = seat !== null && !isOut(state, seat) ? countInHand(state, seat, face) : null;

  /** What the call cost, or paid — the line under the count it turned up. */
  const consequence = (call: Showdown) => {
    if (call.loser === null) {
      // A spot-on call that was right. Nobody pays; the caller is owed a die,
      // unless they were already holding all five they started with.
      return call.gainer === null
        ? `${nameFor(call.challenger)} ${verb(call.challenger, "were", "was")} already holding ${DICE_PER_PLAYER}`
        : `${nameFor(call.gainer)} ${verb(call.gainer, "take", "takes")} a die back`;
    }
    const out = call.out.includes(call.loser) ? ` and ${verb(call.loser, "are", "is")} out` : "";
    return `${nameFor(call.loser)} ${verb(call.loser, "lose", "loses")} a die${out}`;
  };

  return (
    <div className="ld">
      <p className="ld-round">
        Round {state.round} · {total} {total === 1 ? "die" : "dice"} on the table ·{" "}
        {nameFor(state.starter)} opened
      </p>

      {/* Every hand, yours face up and theirs face down — until a call turns
          them all over. */}
      <div className="ld-hands">
        {state.dice.map((_, index) => {
          const turned = reveal.shown(index);
          const hand = handFor(state, index, turned);
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
                      hidden={value < 1 || value > FACES}
                      // Only once the count has been said. A green die on a
                      // hand that has only just turned over is the arithmetic
                      // arriving before the hand it was done on.
                      match={counted && value === showdown?.bid.face}
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
              {showdown.call === "exact" ? " spot on" : ""}
            </span>
            {/* The count, and what it cost, held until every hand is up. The
                block keeps its height either way, so the board does not jump
                when the answer arrives. */}
            <span className="ld-outcome">
              {!counted
                ? "Turning them over…"
                : showdown.call === "exact" && showdown.loser === null
                  ? `Exactly ${describeCount(showdown.actual, showdown.bid.face)}`
                  : `There ${showdown.actual === 1 ? "was" : "were"} ${describeCount(
                      showdown.actual,
                      showdown.bid.face,
                    )}`}
            </span>
            <span className="ld-consequence">{counted ? consequence(showdown) : ""}</span>
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

      {/* What has been said this round, in the order it was said. A call is
          reasoned from the run as much as from the last bid in it: who climbed
          eagerly, and who was dragged. Only worth drawing once it is a run. */}
      {state.history.length > 1 && (
        <ol className="ld-history" aria-label="The bidding this round">
          {state.history.map((said, index) => (
            <li
              key={index}
              className={`p${said.seat}${index === state.history.length - 1 ? " last" : ""}`}
            >
              <span className="chip" aria-hidden="true" />
              {nameFor(said.seat)} {describeBid(said)}
            </li>
          ))}
        </ol>
      )}

      {state.phase === "reveal" ? (
        <div className="ld-actions">
          <button
            className="primary ld-wide"
            disabled={!myTurn}
            onClick={() => onMove({ type: "next" })}
          >
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

            {mine !== null && (
              <p className="ld-mine" aria-live="polite">
                You hold {describeCount(mine, face)} of the {total} dice on the table
              </p>
            )}

            <div className="ld-actions">
              <button
                className="primary ld-wide"
                disabled={!bidding || !legal}
                onClick={() => onMove({ type: "bid", quantity, face })}
              >
                Bid {describeBid(proposed)}
              </button>
              <button disabled={!canCall} onClick={() => onMove({ type: "challenge" })}>
                Call liar
              </button>
              <button disabled={!canCall} onClick={() => onMove({ type: "exact" })}>
                Spot on
              </button>
            </div>

            <p className="ld-legend">
              {!myTurn
                ? "Ones are just ones — a bid counts only the face it names."
                : state.bid === null
                  ? "Open the round: name how many of a face are on the whole table."
                  : bidsExhausted
                    ? `Every die is claimed already — call ${describeBid(state.bid)} a lie, or spot on.`
                    : legal
                      ? `Raise past ${describeBid(state.bid)}, call it a lie, or call it spot on — exactly right wins a die back.`
                      : `That is not a raise on ${describeBid(state.bid)} — more dice, or a higher face.`}
            </p>
          </>
        )
      )}
    </div>
  );
}
