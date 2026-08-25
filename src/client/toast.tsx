/**
 * Transient messages, stacked.
 *
 * This replaced two surfaces that were saying the same kind of thing in two
 * different registers. In a room, a refusal was a `.banner.error` wedged
 * between the topbar and the players strip: it pushed the board down the page
 * the moment it appeared, which on a phone moved whatever you were about to
 * tap, and it sat there until you found the Dismiss link. Out of a room, a
 * failed join took over the whole screen with a heading and a way back: a full
 * stop for something as ordinary as a typo in a four-letter code.
 *
 * A toast is neither: it floats over the layout so nothing reflows, it says
 * its piece and goes, and the thing it interrupted is still on screen behind
 * it. The one case that kept its full screen is a protocol mismatch, because
 * that is not a moment. The bundle is out of date until it is reloaded, and
 * the screen's job there is to hold still and offer the reload.
 *
 * Two details are load-bearing:
 *
 * - **Toasts are keyed by an id, not by their text.** The same refusal twice
 *   is two events. Deduplicating them by message meant tapping an illegal
 *   square twice looked, and sounded, like it worked the second time.
 * - **The timer stops while the toast has focus or a pointer on it.** Five
 *   seconds is plenty to read one and not nearly enough to reach its close
 *   button with a keyboard, and a control that moves out from under the key
 *   that was about to press it is worse than no control.
 */
import { useCallback, useEffect, useState } from "react";
import type { ErrorKind } from "../shared/protocol.js";

export interface Toast {
  id: number;
  message: string;
  /** Why it happened, so the toast can name the kind of trouble it is. */
  kind: ErrorKind | null;
  /** How loudly to say it. See `toneFor`. */
  tone: Tone;
}

/**
 * The four voices a toast has, which is one more than the four `ErrorKind`s
 * collapse into. A refusal is never good news, so `success` has no caller in
 * here -- it is reachable by passing a tone to `push`, and it exists because
 * the tone is what the colour means: green is "that worked", and a stack that
 * can only ever go red teaches players to read the colour as noise.
 */
export type Tone = "success" | "info" | "warn" | "error";

/**
 * Colour follows consequence, not severity of wording.
 *
 * `full` and `started` are facts about a table rather than anything the player
 * did wrong -- the same distinction the old border-left drew with --pending --
 * so they are amber. Everything else that reaches here is something that did
 * not work, and a message with no kind at all is the app telling you where you
 * are, which is information rather than trouble.
 */
function toneFor(kind: ErrorKind | null): Tone {
  if (kind === null) return "info";
  if (kind === "full" || kind === "started") return "warn";
  return "error";
}

/** Long enough to read a sentence twice; short enough not to outstay a turn. */
const LIFETIME_MS = 5000;

/**
 * How many are on screen at once. A phone gives the stack about a third of
 * its height, and a fourth toast would start covering the board it is
 * reporting on, so the oldest leaves to make room, which is also the one the
 * player has had longest to read.
 */
const MAX_VISIBLE = 3;

let nextId = 0;

export interface Toasts {
  toasts: Toast[];
  push(message: string, kind?: ErrorKind | null, tone?: Tone): void;
  dismiss(id: number): void;
}

export function useToasts(): Toasts {
  const [toasts, setToasts] = useState<Toast[]>([]);

  return {
    toasts,
    push: useCallback((message: string, kind: ErrorKind | null = null, tone?: Tone) => {
      nextId += 1;
      const toast = { id: nextId, message, kind, tone: tone ?? toneFor(kind) };
      setToasts((current) => [...current, toast].slice(-MAX_VISIBLE));
    }, []),
    dismiss: useCallback((id: number) => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, []),
  };
}

/**
 * The heading a toast wears, from the same vocabulary the full-screen join
 * failure used to use. It is a label rather than a sentence: the message
 * underneath is the sentence, and repeating its subject in bold above it is
 * how a notification ends up saying everything twice.
 */
function toastLabel(kind: ErrorKind | null): string | null {
  if (kind === "no-room") return "No such room";
  if (kind === "full") return "That table is full";
  if (kind === "started") return "Already under way";
  if (kind === "protocol") return "Out of date";
  return null;
}

/** The mark inside the disc, in stroke rather than in text. See `ToastIcon`. */
const GLYPH: Record<Tone, string> = {
  success: "M6.6 12.4 10.3 16 17.4 8.6",
  // A bar and a dot, drawn the right way up for each: an "i" carries its dot
  // above the stem, a "!" below it.
  info: "M12 10.6v7.2M12 6.6v.1",
  warn: "M12 9.2v5.4M12 18v.1",
  error: "M12 6v7.4M12 17.4v.1",
};

/**
 * The disc a toast opens with.
 *
 * Drawn rather than typed: the obvious spelling is a character -- U+2713,
 * U+26A0 and friends -- and on Android those render as the system emoji, in
 * full colour, at whatever size the font feels like, which on a solid green
 * bar is a second picture arguing with the first. An inline SVG is the same
 * shape everywhere, takes `currentColor`, and costs four paths.
 *
 * `aria-hidden`, because the tone it draws is already in the label and the
 * message beside it; a screen reader that announced "warning triangle" before
 * "That table is full" would be saying the same thing twice.
 */
function ToastIcon({ tone }: { tone: Tone }) {
  return (
    <svg className="toast-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {tone === "warn" ? (
        // The one shape that is not a disc. A triangle is the only one of the
        // four that reads as its meaning without colour, which matters most
        // for amber -- it is the pair the common colour blindnesses confuse
        // with green.
        <path d="M12 2.6 23 21.4H1z" />
      ) : (
        <circle cx="12" cy="12" r="11" />
      )}
      <path className="toast-glyph" d={GLYPH[tone]} />
    </svg>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(id: number): void }) {
  const { id, message, kind, tone } = toast;
  // A count rather than a flag, because the two ways to hold a toast overlap:
  // tapping its close button on a touchscreen raises the pointer *and* takes
  // focus, and a flag cleared by the pointer leaving would start the clock
  // again under a button that is now focused.
  const [held, setHeld] = useState(0);
  const hold = () => setHeld((n) => n + 1);
  const release = () => setHeld((n) => Math.max(0, n - 1));

  useEffect(() => {
    if (held > 0) return;
    const timer = setTimeout(() => onDismiss(id), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss, held]);

  const label = toastLabel(kind);
  return (
    <div
      className={`toast t-${tone}`}
      /* Each toast is its own alert rather than the stack being one live
         region: a live region announces its *changes*, so a second toast
         arriving while the first was still up read out both of them again. */
      role="alert"
      onPointerEnter={hold}
      onPointerLeave={release}
      onFocusCapture={hold}
      onBlurCapture={release}
    >
      <ToastIcon tone={tone} />
      <div className="toast-body">
        {label && <strong className="toast-label">{label}</strong>}
        <span className="toast-message">{message}</span>
      </div>
      <button
        type="button"
        className="toast-close"
        /* The visible glyph is a cross, which is not a word, so the name has
           to carry the meaning -- and enough of *which* toast to tell three
           of them apart. Not the whole message: these run to a sentence and a
           half, the alert has just read it out, and a button named with a
           hundred characters is a button nobody waits to the end of. */
        aria-label={label ? `Dismiss: ${label}` : "Dismiss this message"}
        onClick={() => onDismiss(id)}
      >
        {/* Drawn for the reason ToastIcon is drawn, and because the letter it
            was typed as -- a lowercase x -- is a letter: it sits off-centre in
            most UI fonts and reads as text beside four drawn marks. */}
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M7 7l10 10M17 7L7 17" />
        </svg>
      </button>
    </div>
  );
}

export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
