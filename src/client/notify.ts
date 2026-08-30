/*
 * "It's your turn" on a phone that is no longer looking at the game.
 *
 * A game here can sit for minutes between moves, and the person waiting has
 * usually gone to another app. The table already says whose turn it is three
 * ways -- the status line, the seat highlight, the `turn` cue in `sfx.ts` --
 * and every one of them needs the page in front of you. This is the one that
 * does not.
 *
 * Three decisions worth keeping:
 *
 * - **`canAct`, not `turn`.** `turn` is a hint for the status line and four of
 *   these games answer it with a guess; `canAct` is the server's answer to
 *   "may this seat move", the same predicate the reducer will consult. See
 *   `RoomView.canAct`. Notifying off `turn` would have gone quiet for exactly
 *   the free-simultaneous games where a player is most likely to be waiting.
 * - **Only while hidden.** A notification for a table you are looking at is
 *   noise, and on Android it is noise that also buzzes.
 * - **Silence is an acceptable outcome**, as in `sfx.ts`. No worker, no
 *   permission, a browser that has never heard of any of this: all of it ends
 *   as no notification, never as an error the player can see.
 */
import { useEffect, useRef } from "react";
import type { RoomView } from "../shared/protocol.js";

/**
 * The only part of a room view this file reads. Narrow on purpose: the hook
 * compares two of these, and comparing whole views would fire on every
 * unrelated field the protocol grows.
 */
export interface RoomPulse {
  code: string;
  waiting: boolean;
  over: boolean;
  canAct: boolean;
}

export function pulseOf(room: RoomView): RoomPulse {
  return { code: room.code, waiting: room.waiting, over: room.over, canAct: room.canAct };
}

/**
 * Whether this pair of views is a "your turn" worth interrupting somebody for.
 *
 * Pure, and tested, because the interesting half of this feature is the edge
 * cases and none of them need a browser: rejoining a game it is already your
 * turn in must not fire (the first view of a room describes everything that
 * has already happened in it, the same pile-up `useTableSounds` avoids), and
 * neither must a re-render that changed nothing.
 */
export function isTurnNotice(was: RoomPulse | null, now: RoomPulse, hidden: boolean): boolean {
  if (!hidden) return false;
  // A different room is a first view, not a transition. Covers one tab
  // leaving a room and joining another while in the background.
  if (!was || was.code !== now.code) return false;
  if (now.waiting || now.over) return false;
  return now.canAct && !was.canAct;
}

/** The deal: `waiting` going false in the room we were already watching. */
export function isDeal(was: RoomPulse | null, now: RoomPulse): boolean {
  return !!was && was.code === now.code && was.waiting && !now.waiting;
}

/** One notification per room, replaced rather than stacked: two "your turn"s
 *  on the shade is one turn the player already knows about. */
function tagFor(code: string): string {
  return `turn-${code}`;
}

let registering: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * The registration, or null if this browser cannot or will not.
 *
 * Memoised at module scope rather than per hook: the hook is mounted once per
 * table, but the promise it wants is the same one every time, and asking
 * twice on a cold install costs the first turn its notification.
 */
export function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (registering) return registering;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    registering = Promise.resolve(null);
    return registering;
  }
  registering = navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    // `register` resolves before the worker is active, and `showNotification`
    // on an installing registration throws. `ready` is the one that means
    // "there is a worker here that can be asked".
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null);
  return registering;
}

function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Ask, once, at the deal.
 *
 * Deliberately not at page load: a permission prompt before anybody has done
 * anything is the prompt everyone denies, and a denial is permanent per
 * origin. The deal is the first moment the answer means something.
 *
 * The retry is not paranoia. Browsers drop `requestPermission` made outside a
 * user gesture, and only seat 0 tapped Start; everyone else is dealt into a
 * game they pressed nothing for, so their prompt would never appear. If we
 * are still at `default` afterwards, the next tap anywhere is a gesture, and
 * it gets spent on this. Once.
 */
export function askOnce(): void {
  if (!supported() || Notification.permission !== "default") return;
  const ask = () =>
    Notification.requestPermission().catch(() => "denied" as NotificationPermission);
  void ask().then((answer) => {
    if (answer !== "default") return;
    window.addEventListener("pointerdown", () => void ask(), { once: true });
  });
}

/** Put one on the shade. Resolves either way; failure is silence. */
export async function notifyTurn(room: RoomView): Promise<void> {
  if (!supported() || Notification.permission !== "granted") return;
  const reg = await swRegistration();
  if (!reg) return;
  try {
    await reg.showNotification("Your turn", {
      body: `${room.gameName} is waiting on you.`,
      tag: tagFor(room.code),
      icon: `${import.meta.env.BASE_URL}favicon.png`,
      badge: `${import.meta.env.BASE_URL}favicon.png`,
      // The room code lives in the hash; see `roomUrl` in `App.tsx` for what
      // writing it anywhere else cost.
      data: { url: `${location.origin}${location.pathname}#${room.code}` },
    });
  } catch {
    /* no worker, no permission, no notification. Never an error on screen. */
  }
}

/** Clear it when they come back, so the shade is not still announcing a turn
 *  they are already taking. */
async function clearTurn(code: string): Promise<void> {
  const reg = await swRegistration().catch(() => null);
  if (!reg) return;
  try {
    for (const n of await reg.getNotifications({ tag: tagFor(code) })) n.close();
  } catch {
    /* nothing to clear reads the same as clearing nothing */
  }
}

/**
 * The hook the table uses. Shaped after `useTableSounds`, and for the same
 * reason: what matters is the *change* between two views, so the previous one
 * has to be kept somewhere that survives a render.
 */
export function useTurnNotices(room: RoomView | null, seat: number | null): void {
  const previous = useRef<RoomPulse | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    // A spectator has no turn to be told about.
    if (!room || seat === null) {
      previous.current = null;
      return;
    }
    const now = pulseOf(room);
    const was = previous.current;
    previous.current = now;

    if (!asked.current && isDeal(was, now)) {
      asked.current = true;
      askOnce();
      // Registered at the deal rather than at the first turn: `ready` can take
      // a moment on a cold install, and the first turn is the one we cannot
      // afford to be late for.
      void swRegistration();
    }

    if (isTurnNotice(was, now, document.hidden)) void notifyTurn(room);
  }, [room, seat]);

  // Coming back to the tab is the answer to the notification, whether or not
  // it was tapped to get here.
  const code = room?.code;
  useEffect(() => {
    if (!code) return;
    const seen = () => {
      if (!document.hidden) void clearTurn(code);
    };
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, [code]);
}
