
/**
 * A die, drawn in pips.
 *
 * Lived in `BackgammonBoard.tsx` until Liar's Dice needed the same thing; it is
 * here rather than there because a component two boards import from a third
 * board's file is a dependency nobody expects to find. Yahtzee had a private
 * second copy for a while, drawing the same six faces by a different
 * mechanism — folded back in, because one die is the precondition for one
 * throw.
 *
 * One shape, now. `Die` is flat, for dice that sit in a row and are there to be
 * counted — Liar's Dice's hands, and the pair printed beside the Backgammon
 * board. A thrown die is not this and never was: it is a cube, and since the
 * dice became a real simulation it is drawn by WebGL in `dice3d/scene.ts`
 * rather than by six `<span>`s under `preserve-3d`. `Pips` stays here because
 * a counted die still needs a face.
 *
 * **Six pip slots, always, placed by CSS from `data-face`.** The alternative is
 * rendering only the pips a face needs, which is tidier to read. It stays this
 * way because the reason it was written still holds for a counted hand: an
 * attribute write is one DOM operation where re-rendering children is six.
 */

/** One face: a 3×3 grid of pip slots, of which `face` are shown. */
function Pips({ face, className }: { face: number; className: string }) {
  return (
    <span className={className} data-face={face >= 1 && face <= 6 ? face : 0}>
      <i />
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export interface DieProps {
  /** 1 to 6. Anything else is a die with no face: unrolled, or someone else's. */
  value: number;
  /** Face down: a die whose face is somebody else's business. */
  hidden?: boolean;
  /** Marks a die that counts towards the bid a call has just settled. */
  match?: boolean;
  /**
   * Overrides the spoken label, where the board around it can say more than
   * "die showing four". Pass an empty string for the one case where the die is
   * decorative — inside a button whose own label already names it.
   */
  label?: string;
}

/** A die lying flat, seen square on. What a hand of them is counted from. */
export function Die({ value, hidden, match, label }: DieProps) {
  const faced = !hidden && value >= 1 && value <= 6;
  // A die with no face is one somebody else is holding, or one nobody has
  // thrown yet. "Die showing 0" would be a lie, and saying nothing at all
  // would leave a screen reader counting silence.
  const spoken = label ?? (faced ? `Die showing ${value}` : "A hidden die");
  // `aria-hidden` rather than an empty label, which some screen readers fall
  // back to reading the element's contents for.
  const voice =
    spoken === "" ? { "aria-hidden": true as const } : { role: "img", "aria-label": spoken };

  return (
    <span
      className={["die", hidden ? "down" : "", match ? "match" : ""].filter(Boolean).join(" ")}
      {...voice}
    >
      <Pips face={faced ? value : 0} className="pips" />
    </span>
  );
}
