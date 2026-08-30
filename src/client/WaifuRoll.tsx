/**
 * The pull, as a dialog over the shop.
 *
 * The gacha's card used to be a door: pressing "Roll" navigated to The
 * Polycule, which is a shelf with a roll button on it, so the press somebody
 * made and the thing that happened were two screens apart and the shop lost
 * whoever took it. This is the other half of that fix. The card's button now
 * opens this, the roll happens here, and the shelf stays where it was for
 * somebody who wants to arrange it.
 *
 * It answers the three questions a card cannot fit, in the order they are
 * asked: what this is, what is in it, and what it costs. Then it rolls.
 *
 * **The spin is a JavaScript ticker, and it is the one in this app.** Every
 * other reveal here is staged with `animation-delay` on a state change so that
 * `css.test.ts` can assert the order, because the Browser pane never
 * composites a frame and nobody can look at it (see CLAUDE.md). That trick
 * cannot do this one: cycling *different faces* is a change of `src`, not of
 * style, and CSS has no way to walk a list of three hundred portraits. So the
 * faces are swapped on a schedule and everything else about the reveal -- the
 * entrance, the order, the reduced-motion answer -- is still CSS.
 *
 * Neither half of that is this file's any more. `roll.ts` owns the schedule
 * and `roll.css` owns the movement, because the chest on the shop's grid is
 * the same hundred GP spent on the same press and the two used to feel like
 * different apps: this one blurred through faces at a flat 90ms and stopped
 * dead, the chest cycled nothing at all. They slow into the answer now, both
 * of them, out of one module.
 *
 * The spin has a floor. A server that answers in 80ms would otherwise flash
 * one face and stop, which reads as a broken button rather than as a pull;
 * `SPIN_MS` is what the reveal waits for even when the answer is already in
 * hand. A slow server simply makes it longer, which is the honest way round.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfileView } from "../shared/profile.js";
import { purseOf } from "../shared/chest.js";
import {
  DUPLICATE_REFUND,
  ROLL_COST,
  roster,
  waifuById,
  type Waifu,
} from "../shared/waifu.js";
import { mintNonce, rollWaifu, type Rolled, type WaifuError } from "./waifuApi.js";
import { SPIN_MS, spinFace, startSpin } from "./roll.js";
import { wantsStillness } from "./motion.js";

interface Props {
  profile: ProfileView | null;
  /** Every id rolled, or null for a browser that has not been told yet. */
  claimed: string[] | null;
  /** Hands the whole claimed list and a fresh summary back to be cached. */
  onRolled(result: Rolled): void;
  /** The shelf this fills. A quiet way out, never the main act. */
  onOpenPolycule(): void;
  onClose(): void;
}

/**
 * What counts as a tab stop, for the trap above.
 *
 * The dialog's own contents are three buttons and a heading, so this is
 * deliberately the short list rather than the exhaustive one -- but written as
 * a selector rather than as `querySelectorAll("button")`, because the next
 * thing added in here will be a link or a field and a trap that silently
 * stopped covering it would be worse than no trap.
 */
const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

type Phase =
  | { at: "idle" }
  | { at: "spinning" }
  | { at: "pulled"; result: Rolled }
  | { at: "failed"; nonce: string; error: WaifuError };

export function WaifuRoll({ profile, claimed, onRolled, onOpenPolycule, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  /* Which face the spin is showing. Meaningless outside `spinning`, and left
     where it stopped afterwards on purpose: the reveal draws the real portrait
     over the top, so resetting it would only buy a flash of the first face. */
  const [face, setFace] = useState(0);

  const all = roster();
  const spendable = profile?.spendable ?? 0;
  const purse = purseOf(spendable, ROLL_COST);
  const affordable = purse.ready > 0;

  // Distinct, because the stored list is a ledger and keeps repeats. "12 of
  // 300" counting the same face four times is a number nobody can reconcile
  // with the grid on the shelf.
  const have = useMemo(() => new Set(claimed ?? []).size, [claimed]);

  /* Every series in the pool, counted once. It is the one line in here that
     says what is actually inside rather than how much of it there is, and it
     is the question anybody who has not rolled yet is really asking. */
  const series = useMemo(() => new Set(all.map((one) => one.series)).size, [all]);

  /* The way to stop the spin, not the spin itself: `startSpin` hands back a
     cancel because its gaps are unequal and there is no single interval to
     clear. */
  const stop = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    return () => {
      alive.current = false;
      stop.current?.();
    };
  }, []);

  /* Somebody who has asked not to be animated is asked once, on arrival. A
     live `matchMedia` listener would be a subscription for a preference that
     does not change mid-pull. `wantsStillness` rather than a `matchMedia` call
     spelled out here, because this was the fourth copy of that line and the
     chest's spin needed a fifth. */
  const [still] = useState(wantsStillness);

  async function pull(reuse?: string): Promise<void> {
    if (phase.at === "spinning") return;
    const nonce = reuse ?? mintNonce();
    setPhase({ at: "spinning" });

    if (!still && all.length > 0) {
      stop.current = startSpin((step) => setFace(spinFace(step, all.length)));
    }

    const began = Date.now();
    const answer = await rollWaifu(nonce);
    // The floor, and only ever the remainder of it. A server slower than the
    // spin has already paid for the drama.
    const left = Math.max(0, SPIN_MS - (Date.now() - began));
    await new Promise((done) => setTimeout(done, still ? 0 : left));
    if (!alive.current) return;
    stop.current?.();
    stop.current = null;

    if (!answer.ok) {
      setPhase({ at: "failed", nonce, error: answer.error });
      return;
    }
    setPhase({ at: "pulled", result: answer.result });
    onRolled(answer.result);
  }

  /* Focus lands on the heading, as it does on every screen here. A dialog that
     opened with focus still on the card behind it would put Tab back at the
     top of a document the reader cannot see. */
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  const busy = phase.at === "spinning";

  /*
    The only modal in this app, and the one thing it was missing.

    `aria-modal="true"` is a promise that the rest of the page is not there,
    and nothing was keeping it: the shop's grid stays mounted behind this, so
    Tab off the last button walked into the chest cards underneath -- still
    pressable, still able to spend the same balance this dialog is about to
    spend, and read out to a screen reader as content that the dialog had just
    told it to ignore. Escape went with it, because it was a handler on this
    element and only ever fired while focus was still inside.

    Note the rest of the app deliberately has no modals for exactly this
    reason; see `Setup.tsx` on the account page, where the focus trap was the
    scaffolding that made a route the better answer. This one earns it: the
    press and the thing it buys have to stay on one screen.

    On `document` rather than on the dialog, so it holds however focus got
    out, and in the capture phase so a button's own key handling cannot eat
    the Tab first.
  */
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Not mid-pull. Dismissing a roll that has been paid for and not yet
        // shown is the one press in here that could lose something.
        if (!busy) onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = box.current;
      if (!dialog) return;
      const able = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // A disabled control is in the DOM and out of the tab order, and the
        // roll button is disabled for exactly the people most likely to be
        // tabbing around this dialog looking for the way out.
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
      if (able.length === 0) return;
      const first = able[0];
      const last = able[able.length - 1];
      const on = document.activeElement;
      // Wrapping, and also catching the case where focus is already outside:
      // `dialog.contains` is false then, and either end is a way back in.
      if (e.shiftKey && (on === first || !dialog.contains(on))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (on === last || !dialog.contains(on))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  return (
    <div
      className="gacha-back"
      /* Only when it is not mid-pull. Dismissing a roll that has been paid for
         and not yet shown is the one press in here that could lose something. */
      onClick={() => !busy && onClose()}
    >
      <div
        className="gacha"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gacha-head"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gacha-head">
          <h2 id="gacha-head" ref={heading} tabIndex={-1}>
            The gacha
          </h2>
          <p className="gacha-what">
            {ROLL_COST} GP pulls one waifu at random out of {all.length} of them,
            across {series} series. She is yours for keeps and she lands in The
            Polycule.
          </p>
          {/* The duplicate rule, said before the pull rather than after it.
              It is the one term of this deal somebody could feel cheated by,
              and a refund explained only once it has happened reads as an
              apology. */}
          <p className="gacha-terms">
            Pull somebody you already have and she costs {DUPLICATE_REFUND} GP
            less. Chests spend this same GP.
          </p>
          <p className="gacha-balance">
            <b>{spendable.toLocaleString()}</b> GP
            <span className="gacha-worth">
              {purse.ready > 0
                ? ` = ${purse.ready} ${purse.ready === 1 ? "pull" : "pulls"}`
                : `, ${purse.toNext} to your next pull`}
            </span>
            <span className="gacha-have">
              {have > 0 ? ` · ${have} of ${all.length} yours` : ` · none yet`}
            </span>
          </p>
        </header>

        <div className={`gacha-stage${busy ? " roll-stage-spin" : ""}`}>
          {phase.at === "pulled" && phase.result.pulled ? (
            <Pulled result={phase.result} />
          ) : phase.at === "pulled" ? (
            /* A refusal is not nothing happening. The server can say no to a
               press this dialog believed in, most often a balance spent in
               another tab, and a press that appears to do nothing is read as a
               broken button and pressed again. */
            <p className="gacha-line" role="status">
              {phase.result.refusal === "too-poor"
                ? "Not enough to spend yet. Nothing was taken."
                : "There is nobody left to pull right now."}
            </p>
          ) : (
            <Face one={busy ? all[face % all.length] : cover(claimed, all)} spinning={busy} />
          )}
        </div>

        {phase.at === "failed" && (
          <p className="gacha-error" role="status">
            {phase.error === "no-account"
              ? "You need an account for this. Make one from the menu."
              : phase.error === "offline"
                ? "That did not reach the server."
                : "That did not work."}{" "}
            {phase.error !== "no-account" && (
              <button type="button" className="gacha-retry" onClick={() => void pull(phase.nonce)}>
                Try again
              </button>
            )}
          </p>
        )}

        <div className="gacha-acts">
          <button
            type="button"
            className="primary gacha-roll"
            disabled={!affordable || busy}
            onClick={() => void pull()}
          >
            {busy
              ? "Rolling..."
              : phase.at === "pulled" && phase.result.pulled
                ? `Again, ${ROLL_COST}`
                : `Roll, ${ROLL_COST}`}
          </button>
          {/* The shelf, and it is deliberately quiet. Putting somebody on show
              is arranging, and arranging is not what this dialog is for. */}
          <button type="button" className="gacha-shelf" onClick={onOpenPolycule} disabled={busy}>
            The Polycule
          </button>
          <button type="button" className="gacha-close" onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>

        {!affordable && phase.at !== "pulled" && (
          <p className="gacha-short">{purse.toNext} GP away.</p>
        )}
      </div>
    </div>
  );
}

/**
 * What came out.
 *
 * No "put her on show" here, and that is the split with the shelf: this dialog
 * is the pull and The Polycule is the arranging. A showcase control on a thing
 * that closes would be asking somebody to make a display decision while the
 * confetti is still up.
 */
function Pulled({ result }: { result: Rolled }) {
  const one = result.pulled as Waifu;
  return (
    /* The stagger is the chest's, to the millisecond, because it is `roll.css`
       and there is only one of it: the panel, then the face with an overshoot,
       then who she is, then the small print. It used to be one 320ms pop for
       the whole block, so the picture the hundred bought arrived at the same
       instant as its own footnotes. */
    <div className="gacha-pull roll-panel">
      <div className="roll-land">
        <Face one={one} spinning={false} />
      </div>
      <p className="gacha-name roll-say">{one.name}</p>
      <p className="gacha-series roll-say">{one.series}</p>
      {result.duplicate && (
        <p className="gacha-note roll-say-late">
          Already yours, so she cost {result.paid} GP instead of {ROLL_COST}.
        </p>
      )}
      {result.repeat && !result.duplicate && (
        <p className="gacha-note roll-say-late">You had already pulled this one.</p>
      )}
      <p className="gacha-note gacha-landed roll-say-late">She is in The Polycule.</p>
    </div>
  );
}

/**
 * One portrait, spinning or still.
 *
 * `alt` is empty throughout. During the spin the faces are noise and naming
 * them would be a screen reader reading twenty names nobody asked for; on the
 * reveal the name is the line immediately under it.
 */
function Face({ one, spinning }: { one: Waifu | undefined; spinning: boolean }) {
  if (!one?.image) return <div className="gacha-art" aria-hidden="true" />;
  return (
    <img
      className={`gacha-art${spinning ? " roll-art-spin" : ""}`}
      src={one.image}
      alt=""
      decoding="async"
    />
  );
}

/**
 * The face on the door, before anything has been pulled.
 *
 * The newest one claimed, falling back to the head of the roster. A chest lid
 * would be more literal and it would also be the one picture in here that is
 * not what the hundred buys.
 */
function cover(claimed: string[] | null, all: readonly Waifu[]): Waifu | undefined {
  const mine = [...new Set(claimed ?? [])].reverse();
  for (const id of mine) {
    const one = waifuById(id);
    if (one) return one;
  }
  return all[0];
}
