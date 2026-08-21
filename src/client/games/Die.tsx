/**
 * One die, drawn in pips.
 *
 * Lived in `BackgammonBoard.tsx` until Liar's Dice needed the same thing; it is
 * here rather than there because a component two boards import from a third
 * board's file is a dependency nobody expects to find.
 *
 * Pips rather than numerals, which is what makes a hand countable at a glance
 * — and what makes a face-down die read as a die rather than as an empty box.
 */

/** Pip positions on a die face, as [column, row] on a 3×3 grid. */
const FACES: Record<number, Array<[number, number]>> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [3, 1],
    [1, 3],
    [3, 3],
  ],
  5: [
    [1, 1],
    [3, 1],
    [2, 2],
    [1, 3],
    [3, 3],
  ],
  6: [
    [1, 1],
    [3, 1],
    [1, 2],
    [3, 2],
    [1, 3],
    [3, 3],
  ],
};

export interface DieProps {
  /** 1 to 6. Anything else is a die whose face is not known. */
  value: number;
  /** Marks a die that counts towards the bid a call has just settled. */
  match?: boolean;
  /**
   * Overrides the spoken label, where the board around it can say more than
   * "die showing four". Pass an empty string for the one case where the die is
   * decorative — inside a button whose own label already names it.
   */
  label?: string;
}

export function Die({ value, match, label }: DieProps) {
  const pips = FACES[value];
  // A die with no face is one somebody else is holding: a blank panel, and a
  // label that says so. "Die showing 0" would be a lie, and saying nothing at
  // all would leave a screen reader counting silence.
  const spoken = label ?? (pips ? `Die showing ${value}` : "A hidden die");
  // `aria-hidden` rather than an empty label, which some screen readers fall
  // back to reading the element's contents for.
  const voice = spoken === "" ? { "aria-hidden": true } : { role: "img", "aria-label": spoken };

  if (!pips) return <span className="die down" {...voice} />;

  return (
    <span className={match ? "die match" : "die"} {...voice}>
      {pips.map(([column, row], i) => (
        <span key={i} className="pip" style={{ gridColumn: column, gridRow: row }} />
      ))}
    </span>
  );
}
