import { useCallback, useState } from "react";

/**
 * Whether the dice are still in the air.
 *
 * The one piece of state a board needs from a throw, and the reason it is a
 * hook rather than a flag inside the tray: what it gates is mostly *outside*
 * the tray. Yahtzee's score previews, Backgammon's legal-move marks and Liar's
 * Dice's count are all drawn by the board, and all of them have to wait: a
 * sheet that says "full house" while a die is still rolling makes the die
 * stopping into theatre.
 *
 * Derived during render rather than set from an effect, deliberately. A throw
 * arrives with its faces already in the same state message, so a flag raised
 * one render later would show the answer for a frame before hiding it again,
 * the exact bug this exists to prevent.
 *
 * `n` counts up for the life of a game and is never reused, so "in the air"
 * is simply "the last throw the board saw arrive is one the tray has not
 * reported landing yet".
 */
export function useLanding(n: number): [flying: boolean, land: () => void] {
  const [settled, setSettled] = useState(n);

  // A rematch starts the count again. Without this a board that had already
  // watched throw seven would sit out the new game's first six.
  if (settled > n) setSettled(n);

  const land = useCallback(() => setSettled(n), [n]);
  return [n > settled, land];
}
