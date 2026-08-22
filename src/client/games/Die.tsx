import { forwardRef } from "react";

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
 * Two shapes, one set of faces. `Die` is flat, for dice that sit in a row and
 * are there to be counted; `Cube` is the real thing, for dice that are
 * thrown. `Pips` is the face both are made of, so the six faces are drawn
 * once.
 *
 * **Six pip slots, always, placed by CSS from `data-face`.** The alternative
 * is rendering only the pips a face needs, which is tidier to read and wrong
 * here: a die in a tray changes face forty times while it tumbles, and an
 * attribute write is one DOM operation where re-rendering children is six. It
 * is also what lets the solver drive the face without a React render a frame.
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

/**
 * A die as an actual cube — six faces, and five of them behind the one you can
 * read.
 *
 * It is a cube because the number is not written on it, it is *on a side of
 * it*: the simulation tumbles the die and the face pointing at you when it
 * stops is the face you get. A flat square cannot express that, and a flat
 * square spun about one axis is a flat square pretending.
 *
 * There is no face prop, and that is the point: which number a cube is showing
 * is a fact about how it is turned, and the solver is what turns it. The only
 * thing the board says about it is whether it has been thrown at all.
 *
 * The faces are placed to match `FACE_AXES` in `dice.ts`, in the same
 * coordinates CSS uses — x right, y down, z towards the player — so the
 * solver's rotation can be handed to `matrix3d` without a change of basis
 * nobody would remember. Opposite faces sum to seven, as on any real die, and
 * `dice.test.ts` holds them to it.
 */
export const Cube = forwardRef<HTMLSpanElement, { blank?: boolean; spent?: boolean }>(
  function Cube({ blank, spent }, ref) {
    return (
      <span
        className={['cube', blank ? 'blank' : '', spent ? 'spent' : ''].filter(Boolean).join(' ')}
        ref={ref}
        aria-hidden="true"
      >
        <Pips face={1} className="pips cube-face f1" />
        <Pips face={6} className="pips cube-face f6" />
        <Pips face={2} className="pips cube-face f2" />
        <Pips face={5} className="pips cube-face f5" />
        <Pips face={3} className="pips cube-face f3" />
        <Pips face={4} className="pips cube-face f4" />
      </span>
    );
  },
);
