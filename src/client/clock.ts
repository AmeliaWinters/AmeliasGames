import { useEffect, useRef, useState } from "react";

/**
 * The server's clock, ticking, on this device.
 *
 * Every deadline in this app is a server timestamp, so counting down to one
 * with a local `Date.now()` shows the wrong number on any device whose clock
 * is off, and phones are off by minutes more often than you would hope. Every
 * state message carries the server's time, so the gap between the two clocks is
 * remeasured whenever one arrives and the skew cancels out.
 *
 * This only ever decides what the player *sees*. Whether a move counts is the
 * server's business, and it has already made up its mind by the time this runs.
 *
 * `running` stops the interval when there is nothing counting down, so a board
 * sitting on a finished game is not re-rendering four times a second forever.
 *
 * Shared by every board on a clock (Word Hunt's round, Word Duel's shot clock)
 * because the skew correction is the subtle part and two copies of it would be
 * two chances to get it wrong.
 */
export function useServerNow(serverNow: number, running: boolean): number {
  const skew = useRef(0);
  const [now, setNow] = useState(serverNow);

  // Before the interval, not after: a state message is also the freshest
  // reading of the server's clock this device will ever have, so it is worth
  // showing immediately rather than up to a tick later.
  useEffect(() => {
    skew.current = serverNow - Date.now();
    setNow(serverNow);
  }, [serverNow]);

  useEffect(() => {
    if (!running) return;
    // Four times a second: fast enough that the seconds never visibly stick,
    // cheap enough not to matter.
    const id = setInterval(() => setNow(Date.now() + skew.current), 250);
    return () => clearInterval(id);
  }, [running]);

  return now;
}
