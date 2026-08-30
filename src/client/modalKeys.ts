/**
 * Keeping Tab and Escape inside whatever layer is on top.
 *
 * This was `WaifuRoll.tsx`'s, written for the one modal in the app, and it is
 * out here because there are two now: the gacha dialog, and the takeover that
 * covers it while a spin is running. Two copies of a focus trap is two traps
 * both calling `preventDefault` on the same Tab, which is a bug with no
 * symptom until somebody cannot get out of a dialog.
 *
 * `enabled` is what settles that. Only one layer arms itself at a time, and
 * the one on top wins: the dialog stands down while the takeover is up. It is
 * a parameter rather than a stack in this module because the caller is the
 * only thing that knows what is over it.
 *
 * On `document` rather than on the element, so it holds however focus got out,
 * and in the capture phase so a button's own key handling cannot eat the Tab
 * first.
 */
import { useEffect, type RefObject } from "react";

/**
 * What counts as a tab stop.
 *
 * Deliberately the short list rather than the exhaustive one, since what these
 * layers hold is buttons and a heading -- but written as a selector rather
 * than as `querySelectorAll("button")`, because the next thing added will be a
 * link or a field and a trap that silently stopped covering it would be worse
 * than no trap.
 */
const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useModalKeys(
  box: RefObject<HTMLElement | null>,
  {
    onEscape,
    enabled = true,
  }: {
    /** Null while the layer must not be dismissed, which is mid-spin: a roll
        that has been paid for and not yet shown is the one press in either of
        these screens that could lose something. */
    onEscape: (() => void) | null;
    enabled?: boolean;
  },
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape?.();
        return;
      }
      if (e.key !== "Tab") return;
      const layer = box.current;
      if (!layer) return;
      const able = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // A disabled control is in the DOM and out of the tab order, and the
        // roll button is disabled for exactly the people most likely to be
        // tabbing around this looking for the way out.
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
      if (able.length === 0) return;
      const first = able[0];
      const last = able[able.length - 1];
      const on = document.activeElement;
      // Wrapping, and also catching the case where focus is already outside:
      // `layer.contains` is false then, and either end is a way back in.
      if (e.shiftKey && (on === first || !layer.contains(on))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (on === last || !layer.contains(on))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [box, onEscape, enabled]);
}
