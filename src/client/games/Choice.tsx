import type { CSSProperties, ReactNode } from "react";

/**
 * Pick one of these.
 *
 * Word Chain's language row, Vocab Race's language, difficulty and handicap
 * rows: four instances of one control, written out four times, with three
 * stylesheets between them. `vocab.css` already carried the comment that says
 * why -- "the same control asked twice, and giving them separate styles would
 * be inviting them to drift" -- and it was right about its own two while the
 * drift happened one file over.
 *
 * What the copies had actually diverged on, by the time they were collected:
 *
 * - the chosen mark. Vocab set a border and a quiet fill, Word Chain filled the
 *   whole tile with `--action`. Vocab's reasoning is the one written down (a
 *   filled tile beside an empty one reads as one button and one label, not as
 *   two choices), so it is the one that survived. Word Chain's setup screen
 *   looks quieter than it did.
 * - the thumb target. Both said 44px, which is the only reason this collapse
 *   was safe to make at all.
 * - `text-align`. Word Chain's tiles were centred and Vocab's ranged left, on
 *   the same two-line name-over-note shape.
 *
 * A board that needs a third line under the note passes it as children; that is
 * the handicap row, and it is the only caller that does.
 */
export function ChoiceGroup({
  label,
  narrow,
  columns,
  children,
}: {
  label: string;
  /** A tighter floor before wrapping: for a set that reads as a scale. */
  narrow?: boolean;
  /**
   * Stay on one row at every width, in exactly this many tracks.
   *
   * For a set that reads worse wrapped than crowded: three languages laid out
   * two-then-one read as a group of two with a stray. Do not reach for it to
   * mean "about this wide" -- that is what the default and `narrow` are.
   */
  columns?: number;
  children: ReactNode;
}) {
  const classes = ["choice-group", narrow ? "narrow" : "", columns ? "even" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={classes}
      style={columns ? ({ "--choice-cols": columns } as CSSProperties) : undefined}
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function Choice({
  name,
  note,
  noteLang,
  chosen,
  disabled,
  onPick,
  children,
}: {
  name: ReactNode;
  note: ReactNode;
  /** For a note written in the language it names, so a screen reader says it. */
  noteLang?: string;
  chosen: boolean;
  disabled?: boolean;
  onPick(): void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={chosen ? "choice surface chosen" : "choice surface"}
      disabled={disabled}
      // `aria-pressed` and not `aria-checked`: these are buttons in a group, not
      // a radio group, and claiming the radio pattern without its arrow-key
      // roving focus is a worse lie than not claiming it.
      aria-pressed={chosen}
      onClick={onPick}
    >
      <span className="choice-name">{name}</span>
      <span className="choice-note" lang={noteLang}>
        {note}
      </span>
      {children}
    </button>
  );
}
