/**
 * The chest and the purse, as two controls that live in the header rather than
 * as rows in a menu.
 *
 * The chest used to be the fifth row of the account menu, which is three
 * presses and a read from anywhere in the app, and it said "Almost there" to
 * everybody who had not saved up yet. That is the wrong shape for the one
 * thing in here that is *supposed* to nag: a chest is earned by playing, and
 * the moment it is earned is a moment somebody is looking at a game, not at a
 * settings list.
 *
 * So it sits in both headers -- the lobby bar and the room's topbar -- and it
 * is the same component in both, because a control that appears in one place
 * and not the other is a control people stop looking for.
 *
 * They were briefly one pill: chest, balance and a progress bar, all inside
 * one border. That read as a currency with a loading bar attached to it, and
 * a press on the number and a press on the chest did the same thing without
 * looking like they would. Two objects now, and each is one idea:
 *
 * - **The purse.** Skull and a number. It is a readout, not a control, and it
 *   carries no gauge -- how close the next chest is belongs on the chest
 *   screen, where there is room to say it in words.
 * - **The chest.** An icon button, 44 square, the same in both headers. Quiet
 *   while there is nothing in it; accent, badge and a slow pulse the moment
 *   there is. That state is the whole reason it is in the header at all.
 *
 * Both are absent with no profile. A chest that says zero to somebody who has
 * never played is the app opening with a bill.
 */
import { useEffect, useRef, useState } from "react";
import { CHEST_COST, purseOf } from "../shared/chest.js";
import type { ProfileView } from "../shared/profile.js";

/** How long the bump lasts. Matched to `pursepill-bump` in `controls.css`. */
const BUMP_MS = 900;

/**
 * True for a moment after `n` goes up, and false the rest of the time.
 *
 * The purse only ever moves at the end of a game, when the server pushes a new
 * summary, and until now it moved *silently*: the number was one thing before
 * the game and a larger thing after it, with nothing in between to notice.
 * Somebody watching the header would see the first game of the day pay three
 * hundred points and never know it had happened.
 *
 * Only upwards. Spending is a thing you did on purpose, on a screen that told
 * you the price, and celebrating the number going down would be the app
 * cheering at a receipt.
 *
 * The previous value is a ref rather than state, because it is an input to a
 * comparison and never something to draw. `null` until the first value
 * arrives, so a profile appearing out of nothing -- a reload, a sign-in -- is
 * not read as a gain.
 */
function useRise(n: number | null): boolean {
  const was = useRef<number | null>(null);
  const [risen, setRisen] = useState(false);
  useEffect(() => {
    if (n === null) return;
    const before = was.current;
    was.current = n;
    if (before === null || n <= before) return;
    setRisen(true);
    const timer = setTimeout(() => setRisen(false), BUMP_MS);
    return () => clearTimeout(timer);
  }, [n]);
  return risen;
}

/**
 * The mark on the purse pill.
 *
 * A skull, because the currency is goth points and the pill has room for one
 * glyph and no room for a word at 320px. Drawn rather than an emoji: the emoji
 * is a different colour, a different weight and a different size on every
 * platform, and this one has to sit on the same baseline as a number.
 */
export function SkullMark() {
  return (
    <svg className="gp-skull" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {/* Cranium and jaw as one filled path, so the eyes and nose can be cut
          out of it by `fill-rule` rather than painted in the pill's colour --
          which would be wrong the moment the chip inverts. */}
      <path
        fillRule="evenodd"
        d="M8 1C4.7 1 2.2 3.4 2.2 6.6c0 1.7.7 3 1.8 3.9v1.7c0 .5.4.9.9.9h.6v1c0 .5.4.9.9.9h5.2c.5 0 .9-.4.9-.9v-1h.6c.5 0 .9-.4.9-.9V10.5c1.1-.9 1.8-2.2 1.8-3.9C13.8 3.4 11.3 1 8 1Zm-2.4 4.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4.8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM8 9.2l-.9 1.7h1.8L8 9.2Z"
      />
    </svg>
  );
}

/**
 * The chest itself, drawn as a lid, a body and a clasp.
 *
 * Three shapes rather than one outline, so the lid can lift on the ready state
 * without the whole glyph having to be redrawn or swapped for a second file.
 */
function ChestMark() {
  return (
    <svg className="chest-mark" viewBox="0 0 20 16" aria-hidden="true" focusable="false">
      <path className="chest-lid" d="M2.4 7.4V5.6A4.4 4.4 0 0 1 6.8 1.2h6.4a4.4 4.4 0 0 1 4.4 4.4v1.8Z" />
      <path className="chest-body" d="M2.4 8.6h15.2v4.6a1.6 1.6 0 0 1-1.6 1.6H4a1.6 1.6 0 0 1-1.6-1.6Z" />
      <rect className="chest-clasp" x="8.6" y="6.4" width="2.8" height="3.8" rx="0.9" />
    </svg>
  );
}

/**
 * The balance, as a readout.
 *
 * Not a button: there is nothing a press on a number could do that the chest
 * beside it does not already do, and a pill that looks pressable and goes
 * where its neighbour goes is two controls for one destination. The unit is
 * the skull rather than the letters "GP" -- at 320px those two characters are
 * the difference between a name that ellipsises to three letters and one that
 * shows none. `role="status"` so the number arriving is announced once,
 * without anybody having to go and look for it.
 */
export function PursePill({ profile }: { profile: ProfileView | null }) {
  // Before the early return, because a hook cannot be conditional. It is fed
  // null for a missing profile, which is the case it already treats as "no
  // previous value" rather than as a fall to zero.
  const risen = useRise(profile?.spendable ?? null);
  if (!profile) return null;
  const spendable = profile.spendable;
  return (
    <span
      className="pursepill"
      /* An attribute rather than a class for the reason `data-ready` is one on
         the chest: it is a state the stylesheet forks on, and it reads as one
         at the point of use. */
      data-rise={risen ? "yes" : "no"}
      role="status"
      aria-label={`${spendable.toLocaleString()} goth points`}
      title={`${spendable.toLocaleString()} goth points`}
    >
      <SkullMark />
      <b aria-hidden="true">{spendable.toLocaleString()}</b>
    </span>
  );
}

export function ChestButton({
  profile,
  onPress,
}: {
  profile: ProfileView | null;
  /** Open the chest screen. Where that lands differs per header; see `App.tsx`. */
  onPress(): void;
}) {
  // Same reason as `PursePill`: hooks come before the early return. The chest
  // bumps on the points rather than on `ready`, because the room's header
  // carries the chest and no purse -- so in a room this button is the only
  // thing on screen that can say the number moved at all.
  const risen = useRise(profile?.spendable ?? null);
  // Nothing to say yet. See the header comment: an empty wallet is not news.
  if (!profile) return null;

  const purse = purseOf(profile.spendable, CHEST_COST);
  const ready = purse.ready;

  return (
    <button
      type="button"
      className="chestbtn"
      /* An attribute rather than a class, because the ready state is what the
         whole of the pill's styling forks on and a selector that reads
         `[data-ready="yes"]` says that at the point of use. */
      data-ready={ready > 0 ? "yes" : "no"}
      data-rise={risen ? "yes" : "no"}
      onClick={onPress}
      /* The label carries what the badge draws, because the badge is a number
         with no noun. Said in the order somebody asks it -- what is this, then
         how many, then how far off the next one. */
      aria-label={
        ready > 0
          ? `Chests. ${ready} ready to open`
          : `Chests. ${purse.toNext} goth points until the next one`
      }
      title={ready > 0 ? "Open a chest" : `${purse.toNext} GP until the next chest`}
    >
      <span className="chestbtn-icon" aria-hidden="true">
        <ChestMark />
        {/* Only when there is something in it. A badge reading "0" is what
            teaches people that the badge means nothing. */}
        {ready > 0 && <span className="chestbtn-n">{ready > 9 ? "9+" : ready}</span>}
      </span>
    </button>
  );
}
