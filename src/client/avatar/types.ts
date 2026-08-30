/**
 * What an avatar is, said once, so that the art underneath can be replaced.
 *
 * The art source is the thing most likely to change here: this prototype ships
 * one artist's PSD and one procedural SVG library, and the third set will
 * arrive as neither. So nothing above this file knows what a set is made of.
 * A set hands back a `Drawn`, which is a list of rectangles and what goes in
 * them, and the screen stacks them. That is the whole contract, and it is
 * deliberately dull enough that a renderer for a sprite sheet, a stack of
 * SVGs, or a single procedural image all satisfy it.
 *
 * **Parts from two sets can never be combined**, and that is enforced here
 * rather than by remembering. Two artists draw at different proportions, with
 * different line weights, around different anchor points; a Sutemo fringe on a
 * 16px pixel head is not a bug you notice in a diff. `PartId` carries its set
 * in the type, so `Loadout<'kit'>` will not accept one.
 */

/**
 * Every set the app knows. A closed union rather than a string, so a manifest
 * missing an entry, or an entry nothing renders, fails to compile.
 */
export type SetId = 'sutemo' | 'kit' | 'snake' | 'makowka';

/**
 * The slots any set may draw into, pooled across all of them.
 *
 * Pooled rather than per set because the customiser draws one tab strip and
 * the loadout is one object; a set that has no `nose` simply never lists one.
 * The two sets are wildly unalike here and that is the point: Sutemo draws a
 * whole expression as one image, so it has a `face` and no `eyes`, `nose` or
 * `mouth`, while the Kit draws sixteen separate pieces and has no `face` at
 * all. Neither is wrong, so neither is the model.
 *
 * Hair is three slots rather than one, because this is a layered set and not
 * a paper doll: `backhair` is behind the body, `hair` is the cap that sits on
 * it, and `bangs` fall in front of the face. Collapsing them would throw away
 * the only property that made either set worth having.
 */
export type Slot =
  | 'background'
  | 'body'
  | 'ears'
  | 'backhair'
  | 'hair'
  | 'bangs'
  | 'eyes'
  | 'brows'
  | 'nose'
  | 'mouth'
  | 'marks'
  | 'makeup'
  | 'face'
  | 'outfit'
  | 'outer'
  | 'accessory'
  // The rest arrived with the two Picrew sets, which draw a necklace, a pair
  // of earrings and three piercings as three menus rather than as one Extras
  // drawer. Folding them into `accessory` would have meant choosing between
  // your glasses and your earrings, which is not a choice either artist drew.
  | 'iris'
  | 'blush'
  | 'scars'
  | 'tattoo'
  | 'beard'
  | 'glasses'
  | 'earrings'
  | 'necklace'
  | 'piercings'
  | 'horns'
  | 'wings'
  | 'hat'
  | 'hairacc'
  /** Never a tab: the artist's signature, drawn over everything. */
  | 'overlay';

declare const OF_SET: unique symbol;

/**
 * A part, named, and stamped with the set it belongs to.
 *
 * The brand is phantom: at runtime this is the plain string in the manifest.
 * Everything that mints one goes through `partId` below, which is the single
 * place the cast lives.
 */
export type PartId<S extends SetId = SetId> = string & { readonly [OF_SET]: S };

/** The one place a raw string becomes a part of a named set. */
export function partId<S extends SetId>(_set: S, id: string): PartId<S> {
  return id as PartId<S>;
}

/**
 * A colour the art itself provides, as a swatch and an id.
 *
 * Only ever the shades the artist drew. Arbitrary recolouring is out of scope:
 * anime line art tinted by a hue rotate looks like anime line art that has
 * been tinted. If per part tinting is ever wanted, it goes on `DrawnImage` as
 * a filter the renderer sets and the stylesheet applies, and it needs a
 * separate look at contrast in both palettes before it ships.
 *
 * `swatch` is a hex, and it is the one place in this feature that names a
 * colour outside the palette. It is a picture of the art rather than chrome:
 * the swatch has to be the colour the hair actually is, and no palette token
 * is that colour. The chrome around it (the ring, the ground, the checked
 * state) is all tokens.
 */
export interface Variant {
  id: string;
  name: string;
  swatch: string;
}

/** One thing you can put in a slot. */
export interface Part<S extends SetId = SetId> {
  id: PartId<S>;
  name: string;
  slot: Slot;
  /** Empty when the art comes in one colour. */
  variants: Variant[];
}

/** A slot a set actually uses, in the order the customiser lists them. */
export interface SlotSpec {
  id: Slot;
  label: string;
  /**
   * Whether this slot's colour is a free choice, and what it colours.
   *
   * Absent means the slot takes no colour of its own, either because the art
   * comes in one colour or because it follows another slot: every skin
   * coloured piece in the Kit reads the `body` slot rather than carrying a
   * second, disagreeing answer to the same question.
   *
   * `'palette'` is the set's own list of shades, as `Variant`s on each part.
   * `'free'` is a colour picker, and it stores a hex in `Loadout.variants`
   * where a palette slot stores a `Variant.id`. Both are strings and the
   * renderer is told which it is by the slot, so nothing has to guess from
   * the shape of the value.
   */
  colour?: 'palette' | 'free';
  /** The colour a `'free'` slot starts on, and what a broken value falls to. */
  fallback?: string;
  /**
   * Quick picks for a `'free'` slot, before somebody opens the picker.
   *
   * Not a restriction: the picker is still there and takes anything. These are
   * the colours worth one tap, and a slot with a sensible short list is a slot
   * most people never open a picker on at all.
   */
  swatches?: string[];
  /**
   * Where this slot's colour is *stored*, when that is not this slot.
   *
   * Three slots make up one head of hair, and one head of hair is one colour.
   * Rather than hide the control on two of the three tabs -- which reads as a
   * missing feature, and sends somebody to the Hair tab to find out why their
   * fringe will not change -- all three show it and all three write `hair`.
   */
  colourKey?: Slot;
  /**
   * Whether "none" is a choice. A figure with no outfit is not a figure this
   * app is going to draw, so `outfit` is not optional and `accessory` is.
   */
  optional: boolean;
}

/**
 * What somebody is wearing. One set, and parts only from it.
 *
 * `parts` may hold a slot the set does not use and `render` will ignore it;
 * that is on purpose, so switching sets and switching back does not wipe what
 * you had on. A missing slot means nothing equipped.
 */
export interface Loadout<S extends SetId = SetId> {
  set: S;
  parts: Partial<Record<Slot, PartId<S>>>;
  /** The chosen variant per slot, by `Variant.id`. Absent means the first. */
  variants: Partial<Record<Slot, string>>;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One layer of a drawn avatar, in canvas units.
 *
 * Two kinds because there are two honest ways art arrives here: a file, and a
 * flat colour for the one slot nobody drew. A consumer that can place a
 * rectangle and fill it can draw both, which is what lets the same `Drawn` go
 * to React in the browser and to a raster in `render-avatars.ts`.
 */
export type DrawnLayer =
  | {
      kind: 'image';
      key: string;
      /** Set relative, like `sutemo/png/body.png`. Resolved by the consumer. */
      file: string;
      x: number;
      y: number;
      w: number;
      h: number;
      /**
       * A hex to multiply this image by, if the art is a mask rather than a
       * picture. See `tint.ts`; absent means draw the file as it is.
       *
       * On the layer rather than on the part, because one part is several
       * layers and they do not share a colour: an eye is an iris the player
       * picked, a lid shadow the skin decides, and line art that is neither.
       */
      tint?: string;
    }
  /** A palette token name, never a colour. The background slot is chrome. */
  | { kind: 'fill'; key: string; token: string };

/** A whole avatar, ready to stack. Layers come back in draw order, back first. */
export interface Drawn {
  canvas: { w: number; h: number };
  layers: DrawnLayer[];
}

/**
 * One artist's coherent character, and everything drawn to fit it.
 *
 * The unit of the big ticket reward. Adding one should cost this object and a
 * folder of art, and nothing else: see the assessment in the report if that
 * ever stops being true.
 */
export interface AvatarSet<S extends SetId = SetId> {
  id: S;
  name: string;
  /** Shown on the locked set card, so a set reads as somebody's work. */
  artist: string;
  /** One line, for the customiser footer. Present when the licence needs it. */
  credit?: string;
  blurb: string;
  /**
   * A set relative path to the artist's own cover art, for the set card.
   *
   * The card used to draw the starter loadout, which for a painted set is the
   * least flattering thing in it: item zero of every menu, and no two of them
   * chosen to sit together. The makers ship a picture of what the set can do,
   * and that is what somebody is deciding from. Sets without one still draw
   * their starter, which is right for the Kit -- its cover *is* a loadout.
   */
  thumb?: string;
  canvas: { w: number; h: number };
  /**
   * The head and shoulders, in canvas units. What the account chip shows.
   *
   * Per set because the two sets frame their character completely differently:
   * Sutemo is already a bust at 1011x1145 and the pixel set is a full figure
   * in a 16x16 box.
   */
  bust: Rect;
  slots: SlotSpec[];
  parts: Part<S>[];
  /** What a brand new player wears. Every part in it must be free. */
  starter: Loadout<S>;
  draw(loadout: Loadout<S>): Drawn;
}
