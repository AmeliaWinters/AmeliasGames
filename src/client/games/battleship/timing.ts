/**
 * The two pieces of timing this board keeps outside React's render: what a
 * shot sounds like, and when the view swaps to the other sea.
 *
 * Both are derived from state changes rather than from events, because the
 * board is re-rendered by a message from the server and there is no click to
 * hang either off for the seat that did not fire.
 */
import { useEffect, useRef, useState } from "react";
import type { BsState, ShipKind } from "../../../shared/games/battleshipDisplay.js";
import { wantsStillness } from "../../motion.js";
import { play } from "../../sfx.js";

/**
 * Every shot fired, heard by everyone watching: hull, water, or a ship going
 * down.
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
 *
 * It returns the ship that has just gone down, because the sound and the
 * ceremony are the same event: deriving them separately is how the noise and
 * the banner end up a frame apart.
 */
export function useShotSounds(state: BsState): ShipKind | null {
  const seen = useRef<number[] | null>(null);
  const [sinking, setSinking] = useState<ShipKind | null>(null);

  useEffect(() => {
    const counts = state.shots.map((shots) => shots.length);
    const before = seen.current;
    seen.current = counts;
    // A board opened mid-game already has shots on it. They are history, not
    // news, and firing all of them at once would be a barrage.
    if (!before || before.length !== counts.length) return;
    let sank: ShipKind | null = null;
    counts.forEach((count, index) => {
      if (count <= before[index]) return;
      const shot = state.shots[index][count - 1];
      if (shot.sunk) sank = shot.sunk;
      play(shot.hit ? "hit" : "miss");
    });
    if (!sank) return;
    // The same shell, pitched down. A ship going down is the biggest moment in
    // the game and it had no sound of its own; a second cue file for one event
    // is not worth its download when the rate control is right here.
    play("hit", 0.55);
    setSinking(sank);
  }, [state]);

  // The ceremony is a moment, not a state, so it clears itself and nothing
  // else has to remember to. Stillness keeps the banner and loses only the
  // movement, which the stylesheet hangs off the same class.
  useEffect(() => {
    if (sinking === null) return;
    const timer = setTimeout(() => setSinking(null), wantsStillness() ? 1600 : 2400);
    return () => clearTimeout(timer);
  }, [sinking]);

  return sinking;
}

/**
 * How long the board being fired at stays up after the shot that ends the
 * turn. A miss hands the guns over, and swapping the moment the move lands
 * takes the splash off the screen before it has been seen: you are told you
 * missed by a board that is no longer the board you shot at. Half a second is
 * long enough to read the result and short enough that nobody waits for it.
 *
 * Kept in reduced motion too. This is not movement, it is time to read.
 */
export const SWAP_AFTER = 500;

/**
 * Which sea is on screen. One grid at a time, because two ten by tens side by
 * side on a phone are two grids nobody can read: the square went from 24px to
 * 12px to buy a second board that is only ever half the answer.
 *
 * The rule is that the board being shot at is the board you see, so the view
 * follows the guns rather than the player: your turn shows their waters, their
 * turn shows yours. The swap trails the shot by `SWAP_AFTER` so the result of
 * a miss is still up when the guns change hands.
 */
export function useShownWaters(desired: "theirs" | "yours"): "theirs" | "yours" {
  const [shown, setShown] = useState<"theirs" | "yours">(desired);

  useEffect(() => {
    if (shown === desired) return;
    const timer = setTimeout(() => setShown(desired), SWAP_AFTER);
    return () => clearTimeout(timer);
  }, [desired, shown]);

  return shown;
}

