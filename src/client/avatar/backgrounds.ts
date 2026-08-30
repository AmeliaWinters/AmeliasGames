/**
 * The one slot neither artist drew.
 *
 * A background is a flat field behind the figure, and it is chrome rather than
 * art, so it is a palette token and not a PNG. Two reasons, and the second is
 * the real one: thirty images of solid colour is a silly way to store six
 * numbers, and a colour baked into a file is the wrong colour in the other
 * palette. A token follows `data-palette` like everything else.
 *
 * Shared by both sets, which is the one thing in this feature that crosses a
 * set boundary and is allowed to: it carries no proportions, no line weight
 * and no anchor point, so there is nothing here to mismatch.
 */


export interface Background {
  /** Slot prefixed, and the tail is the palette token without its dashes. */
  id: string;
  name: string;
}

export const BACKGROUNDS: Background[] = [
  { id: 'background/board', name: 'Board' },
  { id: 'background/surface', name: 'Card' },
  { id: 'background/seat-1', name: 'Ice' },
  { id: 'background/seat-2', name: 'Lime' },
  { id: 'background/seat-3', name: 'Amber' },
  { id: 'background/seat-0', name: 'Ember' },
];
