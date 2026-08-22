import { useEffect, useRef, useState } from "react";
import { buzz, clatter } from "../feel.js";
import { wantsStillness } from "../motion.js";

/** Between one hand turning over and the next. */
export const REVEAL_MS = 260;
/** And after the last one, before the count says what it found. */
export const COUNT_MS = 260;

/**
 * Turning the hands over, one at a time.
 *
 * Liar's Dice's showdown is the most dramatic moment in the app and it used to
 * happen in a single frame: every hand at the table flipped face up and the
 * count appeared beside them, all at once, so the answer arrived before any of
 * the evidence for it. This deals the evidence out in the order the bidding
 * went, ending on the hand that was challenged, and holds the count until the
 * last one is up — so you watch the count build against the bid instead of
 * being handed it.
 *
 * Not a throw and no solver in it: the dice are already on the table, and what
 * happens to them is a turn-over rather than a tumble.
 *
 * Returns which seats are face up, and whether the reveal has finished. Both
 * are everything at once under `prefers-reduced-motion` — the same bargain the
 * Wheel strikes, where the flourish goes and no fact is withheld.
 */
export function useReveal(
  /** Changes when there is a new showdown, and is null when there is none. */
  key: string | null,
  /** Seats in the order they should turn over. */
  order: readonly number[],
): { shown: (seat: number) => boolean; done: boolean } {
  const [step, setStep] = useState(order.length + 1);
  const seen = useRef(key);
  /*
    The order is rebuilt from the state on every render, so it is a new array
    every time a message arrives — and an effect that depended on it would be
    torn down and set up again mid-reveal, clearing its own timers and leaving
    the table half turned over. It is read through a ref for that reason: the
    reveal depends on *which* showdown it is, and nothing else.
  */
  const line = useRef(order);
  line.current = order;

  useEffect(() => {
    if (key === seen.current) return;
    seen.current = key;
    const seats = line.current;
    if (key === null) return;
    if (wantsStillness()) {
      setStep(seats.length + 1);
      return;
    }

    setStep(0);
    const timers = seats.map((_, i) =>
      setTimeout(() => {
        setStep(i + 1);
        clatter(0.5, true);
      }, i * REVEAL_MS),
    );
    // One more beat for the count: the last hand going up and the arithmetic
    // landing are two different pieces of news.
    timers.push(
      setTimeout(() => {
        setStep(seats.length + 1);
        // A settled round is worth feeling once, in the hand of whoever is
        // holding the phone — this is the moment a die changes hands.
        buzz([0, 14, 60, 22]);
      }, seats.length * REVEAL_MS + COUNT_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [key]);

  return {
    shown: (seat: number) => {
      const place = order.indexOf(seat);
      return place === -1 || place < step;
    },
    done: step > order.length,
  };
}
