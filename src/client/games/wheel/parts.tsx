/**
 * What the puzzle board and the purses are drawn from: how a tile is classed,
 * how the answer is read aloud, and the money counting up.
 *
 * Split from the board because none of it decides anything. The reveal's
 * stagger and the tally's easing are both timings rather than rules -- the
 * score is already final when they start -- so they belong beside the drawing
 * and not beside the game.
 */
import { useEffect, useRef, useState } from "react";
import {
  ALPHABET,
  BLANK,
  money,
} from "../../../shared/games/wheelDisplay.js";
import { wantsStillness } from "../../motion.js";

/**
 * The puzzle board is drawn from the *masked* answer, the only version this
 * component has ever seen. `_` is a letter nobody has called; everything else
 * is on the board because it was called, or because it was never hidden.
 */
export function tileClass(ch: string, justCalled: string | null): string {
  if (ch === BLANK) return "wof-tile blank";
  if (!ALPHABET.includes(ch)) return "wof-tile mark";
  return ch === justCalled ? "wof-tile letter just" : "wof-tile letter";
}

/** Whether this tile is one the letter just called turned over. */
export function turnedNow(ch: string, justCalled: string | null): boolean {
  return justCalled !== null && ch === justCalled && ALPHABET.includes(ch);
}

/**
 * How long each turning tile waits behind the one before it.
 *
 * The tiles used to flip together, and together is the one arrangement that
 * throws the information away: four T's turning at the same instant is a
 * single event with no count in it, and you are back to comparing the board
 * against your memory of it, which is what the animation was added to save you
 * from. Left to right at 80ms a tile, four T's is visibly four, and the longest
 * call this bank can produce is seven, which lands inside the same half-second
 * the readout takes to arrive.
 */
export const REVEAL_STAGGER = 80;

/**
 * The board read out rather than looked at. Letter by letter, because "blank P
 * blank blank C E" is the information, where "_PIECE" is not something a screen
 * reader says usefully.
 */
export function spoken(answer: string): string {
  return answer
    .split(" ")
    .map((word) =>
      [...word].map((ch) => (ch === BLANK ? "blank" : ch)).join(" "),
    )
    .join(", ");
}

/** How long a purse takes to count from its old total to its new one. */
export const COUNT_MS = 700;

/** How long the gain or the loss stays marked on the purse afterwards. */
export const FLASH_MS = 900;

/**
 * A total that arrives at its new value rather than jumping to it, and says
 * which way it went while it is getting there.
 *
 * The money is the score, and a score that changes between two renders with
 * nothing in between is a score you have to have been watching the right
 * corner to see. Counting it takes the same three quarters of a second the
 * note line takes to read, and it is the only thing on the board that draws
 * the eye to a purse that is not yours.
 *
 * Eased out rather than linear for one reason worth keeping: a Bankrupt drops
 * a four-figure total to nothing, and a linear count spends most of its time
 * in the last two hundred dollars. Out-eased, the big digits go first, which
 * is the part that reads.
 *
 * The board freezes the whole position while the wheel turns (see `frozen`) so
 * this is fed the *frozen* total and only starts once the pointer has stopped.
 * Nothing here has to know that; it is why it looks like it does.
 */
export function useTally(value: number): { shown: number; move: string } {
  const [shown, setShown] = useState(value);
  const [move, setMove] = useState("");
  // What the last animation was heading for. Not `shown`, which is mid-count
  // and would restart the sum from wherever this frame happened to be.
  const target = useRef(value);

  useEffect(() => {
    const from = target.current;
    if (from === value) return;
    target.current = value;
    setMove(value > from ? "up" : "down");
    const clear = setTimeout(() => setMove(""), FLASH_MS);

    // Asked at the moment the movement starts, per `wantsStillness`. There is
    // no rAF in a non-browser render either, and this is the same branch.
    if (wantsStillness() || typeof requestAnimationFrame !== "function") {
      setShown(value);
      return () => clearTimeout(clear);
    }

    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - began) / COUNT_MS);
      const eased = 1 - (1 - p) * (1 - p);
      setShown(Math.round(from + (value - from) * eased));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // A backstop, and not a theoretical one: `requestAnimationFrame` does not
    // fire in a tab nobody is looking at, so a purse that changed while the
    // player was in another tab would sit on its old total until the *next*
    // time it changed: the score, silently a spin behind. Caught in the preview
    // pane, which is a hidden document, and so is every backgrounded tab. A
    // timer is throttled there rather than stopped, so this is the thing that
    // lands the number; in a tab being watched the count has already finished
    // and this sets it to what it already says.
    const land = setTimeout(() => setShown(value), COUNT_MS + 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(land);
      clearTimeout(clear);
      // A total that changed again mid-count is not two counts overlapping:
      // the sum that was running is abandoned at its answer, and the next one
      // starts from there.
      setShown(value);
    };
  }, [value]);

  return { shown, move };
}

/**
 * One player: who they are, and what they have.
 *
 * This is the shell's players strip and the Wheel's scoreboard, which were two
 * rows of the same four names. See `ownsSeats` in `ownsSeats.ts`, which is what
 * takes the shell's copy down on this table. So it carries everything the strip
 * carried: the seat colour, the name, "you", "away", and the ring round whoever
 * is up. The money is the only thing it adds, and the money is the score of
 * this game.
 *
 * Its own component only because `useTally` is a hook and there are up to four
 * of these: a hook cannot be called from inside a map, and each purse counts
 * its own total on its own clock.
 */
export function Purse({
  seatIndex,
  name,
  mine,
  away,
  amount,
  banked,
  active,
}: {
  seatIndex: number;
  name: string;
  mine: boolean;
  away: boolean;
  amount: number;
  banked: number;
  active: boolean;
}) {
  const round = useTally(amount);
  const total = useTally(banked);
  return (
    <div
      className={[
        "wof-purse",
        `p${seatIndex}`,
        active ? "active" : "",
        round.move,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="chip" aria-hidden="true" />
      <span className="who">{name}</span>
      {mine && <span className="note">you</span>}
      {away && <span className="note">away</span>}
      {/* The counting number is decoration over a fact, so the fact is what is
          published: the live region reads the total it is heading for, not
          whichever frame a screen reader happened to catch. */}
      {/* The two totals share a line and wrap back to two when they cannot
          have one. A purse is as narrow as two-to-a-row on a phone allows, and
          the alternative to wrapping is a third line every player pays for
          whether their numbers need it or not. */}
      <span className="totals">
        <span
          className="round"
          aria-label={`${name}, ${money(amount)} this round`}
        >
          <span aria-hidden="true">{money(round.shown)}</span>
        </span>
        <span className="banked">{money(total.shown)} banked</span>
      </span>
    </div>
  );
}

