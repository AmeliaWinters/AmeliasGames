import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { MAX_FLICK, type Flick } from "../../shared/games/toss.js";

/**
 * Throwing the dice, by hand.
 *
 * The same gesture grammar Word Hunt uses, for the same reason: drag or tap,
 * both the same underneath, and the tap is the path a keyboard can reach. A
 * flick is measured and sent; a tap is a plain throw; a tap that started on a
 * die is that die being kept, which is the one case the tray has to tell apart
 * from a throw.
 *
 * What a flick carries is a direction, a speed and a starting point, and
 * between them they are the throw: `engine.ts` sends the dice in from the edge
 * the gesture came from, the way it was aimed, as hard as it was thrown. A tap
 * carries none of the three and gets the tray's own throw instead.
 *
 * What the flick decides is how the dice got there — never what they landed
 * on. That is read off the cubes when they stop, and no gesture can aim it.
 */

/** Below this the finger was resting, not throwing. */
const MOVED_PX = 12;
const SPEED_PX = 140;

export interface FlickHandlers {
  onPointerDown(event: PointerEvent<HTMLElement>): void;
  onPointerMove(event: PointerEvent<HTMLElement>): void;
  onPointerUp(event: PointerEvent<HTMLElement>): void;
  onPointerCancel(event: PointerEvent<HTMLElement>): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
}

export function useFlick(opts: {
  enabled: boolean;
  /** Absent when there is nothing to throw right now. */
  onThrow?(flick: Flick): void;
  /** A tap that landed on a die, where the game has something to do with one. */
  onTapDie?(index: number): void;
}): { handlers: FlickHandlers; armed: boolean } {
  const { enabled, onThrow, onTapDie } = opts;
  /*
    Refs rather than state, and for the reason Word Hunt gives: the first
    pointermove of a fast flick can arrive in the same frame as the pointerdown
    that started it, before React has re-rendered — so anything the move
    handler reads has to be current, not committed.
  */
  const down = useRef(false);
  const id = useRef(-1);
  const at = useRef({ x: 0, y: 0, t: 0 });
  /** Where the gesture began, which is where the dice come in from. */
  const began = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const travelled = useRef(0);
  const origin = useRef<number | null>(null);
  /** Only for the border that says the tray has the pointer. */
  const [armed, setArmed] = useState(false);

  const start = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      down.current = true;
      id.current = event.pointerId;
      travelled.current = 0;
      velocity.current = { x: 0, y: 0 };
      at.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      began.current = { x: event.clientX, y: event.clientY };
      // Which die the press landed on, remembered now because the capture
      // below retargets every later event for this pointer to the tray — so a
      // listener on the die itself would never hear the release.
      const die = (event.target as HTMLElement).closest?.("[data-die]");
      origin.current = die ? Number(die.getAttribute("data-die")) : null;
      event.currentTarget.setPointerCapture(event.pointerId);
      setArmed(true);
    },
    [enabled],
  );

  const move = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!down.current || event.pointerId !== id.current) return;
    const gap = Math.max(8, event.timeStamp - at.current.t);
    const dx = event.clientX - at.current.x;
    const dy = event.clientY - at.current.y;
    travelled.current += Math.hypot(dx, dy);
    // A rolling estimate, so the number is the speed of the last few
    // milliseconds rather than the average of the whole drag — a throw that
    // starts slow and snaps is still a hard throw.
    velocity.current = {
      x: velocity.current.x * 0.55 + (dx / gap) * 1000 * 0.45,
      y: velocity.current.y * 0.55 + (dy / gap) * 1000 * 0.45,
    };
    at.current = { x: event.clientX, y: event.clientY, t: event.timeStamp };
  }, []);

  const end = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!down.current || event.pointerId !== id.current) return;
      down.current = false;
      setArmed(false);
      const die = origin.current;
      origin.current = null;

      const box = event.currentTarget.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const speed = Math.hypot(velocity.current.x, velocity.current.y);

      // Anything slower than this was a tap: on the way to a die, or meaning
      // "just throw them". Either way it is not a measurement.
      if (travelled.current <= MOVED_PX || speed <= SPEED_PX) {
        if (die !== null && onTapDie) onTapDie(die);
        else onThrow?.({ x: 0, y: 0 });
        return;
      }

      // Tray widths a second, not pixels — see `Flick`. The cap keeps the
      // direction and only takes the speed down, so a wild throw is still
      // thrown the way it was aimed.
      const cap = Math.min(1, (MAX_FLICK * box.width) / speed) / box.width;
      onThrow?.({
        x: velocity.current.x * cap,
        y: velocity.current.y * cap,
        // And where the hand was when it started, as a fraction of the tray.
        // The *start* rather than the release: a flick is a throwing motion,
        // and the dice should come in from where the arm swung from rather
        // than from wherever the finger happened to leave the glass. Clamped
        // because the tray captured the pointer and a fast flick can finish
        // well outside it.
        ax: Math.min(1, Math.max(0, (began.current.x - box.left) / box.width)),
        ay: Math.min(1, Math.max(0, (began.current.y - box.top) / box.height)),
      });
    },
    [onThrow, onTapDie],
  );

  const cancel = useCallback(() => {
    down.current = false;
    origin.current = null;
    setArmed(false);
  }, []);

  const key = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onThrow?.({ x: 0, y: 0 });
    },
    [enabled, onThrow],
  );

  return {
    armed,
    handlers: {
      onPointerDown: start,
      onPointerMove: move,
      onPointerUp: end,
      onPointerCancel: cancel,
      onKeyDown: key,
    },
  };
}
