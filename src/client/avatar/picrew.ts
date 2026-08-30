/**
 * Sets that arrive as a Picrew export: a stack of finished pictures.
 *
 * The third and fourth sets are both this shape, so this file is the adapter
 * rather than either of them. `sets/snake/` and `sets/makowka/` are a
 * generated `data.ts` and a dozen lines of metadata each, which is the bar
 * `types.ts` set for adding a set and the reason it is worth keeping.
 *
 * **The art is painted, not masked, and that decides everything here.** The
 * Kit ships a grey ramp and a colour picker, so its wardrobe is combinatorial.
 * These two ship one PNG per colour the artist chose -- eighteen hairs times
 * seventeen shades is three hundred files and there is no three hundred and
 * first. So colour is a `Variant` list, `SlotSpec.colour` is `'palette'`, and
 * `tint.ts` is not involved at all. Trying to tint them would mean multiplying
 * a colour through finished line art, which turns black outlines brown.
 *
 * **Nothing here is priced or named by hand.** A Picrew export has no names
 * for its items -- the menus are thumbnails -- so parts are numbered within
 * their slot. Nothing is priced: a chest decides what you get, not a threshold.
 * uses. Colours are free, all of them: a locked shade reads as the app being
 * broken rather than as something to earn, and the ladder is already long
 * enough at three hundred parts a set.
 *
 * **The artist's signature is `base` and cannot be removed.** Both makers are
 * licensed for personal use on the condition the mark stays visible, so those
 * layers are drawn on every avatar and are not a slot. See `sets/PROVENANCE.md`.
 */

import { drawLayered, type LayeredSpec, type LayerTable, type SlotDraw } from './layered.js';
import {
  partId,
  type AvatarSet,
  type Loadout,
  type Part,
  type Rect,
  type SetId,
  type Slot,
  type SlotSpec,
  type Variant,
} from './types.js';

export interface PicrewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PicrewLayer {
  z: number;
  /** Per item, in `items` order. Null where that item does not draw here. */
  boxes: (PicrewBox | null)[];
}

/**
 * One category of the export, after curation.
 *
 * Compact on purpose. The obvious shape would be a `LayerTable` entry per
 * file, but that is one line of JavaScript per item per colour per layer and
 * these two sets have about six thousand between them. Every colour of one
 * item shares a trim box -- they are the same drawing -- so the box is stored
 * once and the table is expanded at load. See `tableOf`.
 */
export interface PicrewCat {
  slot: string;
  label: string;
  /** Short, filename safe, unique within the set. Prefixes files and keys. */
  tag: string;
  optional: boolean;
  colourKey?: string;
  /** Hex per colour, indexed by the `Variant.id` this file stores. */
  colours: string[];
  /** The export's own item ids, kept only so a rerun can be diffed. */
  items: string[];
  layers: PicrewLayer[];
}

export interface PicrewData {
  /** Folder under `sets/`, and the first segment of every emitted file. */
  dir: string;
  canvas: { w: number; h: number };
  /** Drawn always: the artist's signature. One item each. */
  base: PicrewCat[];
  cats: PicrewCat[];
}

/** What a set says about itself, which is the only hand written part. */
export interface PicrewMeta<S extends SetId> {
  id: S;
  name: string;
  artist: string;
  credit: string;
  blurb: string;
  /** Set relative path to the maker's cover art. See `AvatarSet.thumb`. */
  thumb?: string;
  bust: Rect;
  /** Tab order, by slot. A slot the data has no category for is dropped. */
  order: Slot[];
  /**
   * Optional slots the starter wears anyway, so a new character is dressed.
   *
   * Everything required is worn by definition; this is the short list of
   * flourishes without which the figure reads as unfinished -- hair, mostly.
   */
  dressed?: Slot[];
}

const file = (cat: PicrewCat, item: number, layer: number, colour: number) =>
  `${cat.tag}-${item}-${layer}-${colour}.webp`;

const key = (cat: PicrewCat, item: number, layer: number, colour: number) =>
  `${cat.tag}/${item}/${layer}/${colour}`;

/**
 * Every file the set can draw, as the flat table `layered.ts` looks things up in.
 *
 * Built once at module load rather than shipped as source: see `PicrewCat`.
 * The cost is a few thousand object literals on first import of a set, which
 * is a millisecond and happens behind the menu that offers the set.
 */
function tableOf(data: PicrewData): LayerTable {
  const layers: LayerTable['layers'] = {};
  for (const cat of [...data.cats, ...data.base]) {
    for (let l = 0; l < cat.layers.length; l++) {
      const boxes = cat.layers[l].boxes;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (!box) continue;
        for (let c = 0; c < cat.colours.length; c++) {
          layers[key(cat, i, l, c)] = { file: file(cat, i, l, c), ...box };
        }
      }
    }
  }
  return { canvas: data.canvas, layers };
}

/** The colour index this slot is drawn in, which is not always its own. */
function colourOf(cat: PicrewCat, loadout: Loadout): string {
  const chosen = loadout.variants[(cat.colourKey ?? cat.slot) as Slot];
  const index = Number(chosen);
  return Number.isInteger(index) && index >= 0 && index < cat.colours.length ? String(index) : '0';
}

/**
 * How one category becomes draws, one per depth it occupies.
 *
 * The part id's tail is `<tag>-<item>`, so the item index comes back out of it
 * rather than being looked up. A malformed id draws nothing, because
 * `drawLayered` skips a key the table does not hold, which is the failure this
 * screen wants: half an avatar in the customiser beats a blank account chip.
 */
function drawsOf(cat: PicrewCat): SlotDraw[] {
  return cat.layers.map((layer, l) => ({
    z: layer.z,
    key: (part: string, _variant: string, loadout: Loadout) =>
      `${cat.tag}/${part.slice(cat.tag.length + 1)}/${l}/${colourOf(cat, loadout)}`,
  }));
}

/** How many shades one menu may offer. See `offeredColours`. */
const COLOUR_CAP = 12;

/** Whether a hex reads as green, on hue, ignoring near greys. */
function isGreen(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  // A shade with almost no chroma has no hue worth reading, and the grey ramps
  // in these sets would otherwise round to whatever channel won by a point.
  if (span < 0.06 || max < 0.1) return false;
  let hue: number;
  if (max === r) hue = ((g - b) / span + 6) % 6;
  else if (max === g) hue = (b - r) / span + 2;
  else hue = (r - g) / span + 4;
  hue *= 60;
  return hue >= 80 && hue < 170;
}

/**
 * The shades a category offers, as original index and swatch.
 *
 * Capped at twelve. Both makers ship up to eighteen hairs, and a strip that
 * long stops being a choice and turns into a wall of near neighbours on a
 * phone; greens go first because these are portraits and green is the shade
 * of hair, skin and eyes that gets picked least. Then from the end, which is
 * the export's own order.
 *
 * **The index is the original one and must stay that way.** A colour is a
 * filename -- `bang-3-0-11.webp` -- so renumbering after a drop would repoint
 * every menu at somebody else's art, and would move every avatar already
 * saved. Dropping a shade only stops it being offered; `colourOf` still draws
 * a loadout that names one.
 */
function offeredColours(cat: PicrewCat): { index: number; swatch: string }[] {
  const all = cat.colours.map((swatch, index) => ({ index, swatch }));
  if (all.length <= COLOUR_CAP) return all;
  const kept = [...all];
  // Never the first: it is what every starter loadout wears.
  for (let i = kept.length - 1; i > 0 && kept.length > COLOUR_CAP; i--) {
    if (isGreen(kept[i].swatch)) kept.splice(i, 1);
  }
  return kept.slice(0, COLOUR_CAP);
}

/**
 * The colours a category offers, as swatches.
 *
 * All free. See the note at the top: a locked shade beside fifteen open ones
 * reads as a bug, and there are already three hundred parts a set to earn.
 */
function variantsOf(cat: PicrewCat): Variant[] {
  const colours = offeredColours(cat);
  if (colours.length < 2) return [];
  return colours.map(({ index, swatch }) => ({
    id: String(index),
    name: `Shade ${index + 1}`,
    swatch,
  }));
}

export function picrewSet<S extends SetId>(data: PicrewData, meta: PicrewMeta<S>): AvatarSet<S> {
  const table = tableOf(data);
  const bySlot = new Map(data.cats.map((cat) => [cat.slot, cat]));

  const cats = meta.order.map((slot) => {
    const cat = bySlot.get(slot);
    if (!cat) throw new Error(`${meta.id}: no art for slot ${slot}`);
    return cat;
  });
  if (cats.length !== data.cats.length) {
    // A category with no tab is art nobody can reach. Louder than a silent
    // drop, because the data file is generated and the order is not: a rerun
    // that adds a category should fail here rather than quietly waste a
    // megabyte of WebP.
    throw new Error(`${meta.id}: ${data.cats.length} categories, ${cats.length} tabs`);
  }

  const parts: Part<S>[] = cats.flatMap((cat) =>
    cat.items.map((_id, index) => ({
      id: partId(meta.id, `${cat.slot}/${cat.tag}-${index}`),
      name: `${cat.label} ${index + 1}`,
      slot: cat.slot as Slot,
      variants: variantsOf(cat),
    })),
  );

  const slots: SlotSpec[] = cats.map((cat) => ({
    id: cat.slot as Slot,
    label: cat.label,
    optional: cat.optional,
    ...(cat.colours.length > 1 ? { colour: 'palette' as const } : {}),
    ...(cat.colourKey ? { colourKey: cat.colourKey as Slot } : {}),
  }));

  const spec: LayeredSpec = {
    dir: data.dir,
    art: 'webp',
    table,
    base: data.base.flatMap((cat) =>
      cat.layers.map((layer, l) => ({ z: layer.z, key: key(cat, 0, l, 0) })),
    ),
    draws: Object.fromEntries(cats.map((cat) => [cat.slot, drawsOf(cat)])),
  };

  const worn = new Set<Slot>([
    ...cats.filter((cat) => !cat.optional).map((cat) => cat.slot as Slot),
    ...(meta.dressed ?? []),
  ]);
  const starter: Loadout<S> = {
    set: meta.id,
    parts: Object.fromEntries(
      cats
        .filter((cat) => worn.has(cat.slot as Slot))
        .map((cat) => [cat.slot, partId(meta.id, `${cat.slot}/${cat.tag}-0`)]),
    ),
    // Every slot opens on the first shade, including the ones that follow
    // another slot's colour: `colourOf` falls back to it anyway, and writing
    // it down means a starter loadout round trips through storage unchanged.
    variants: Object.fromEntries(cats.filter((cat) => cat.colours.length > 1).map((cat) => [cat.colourKey ?? cat.slot, '0'])),
  };

  return {
    id: meta.id,
    name: meta.name,
    artist: meta.artist,
    credit: meta.credit,
    blurb: meta.blurb,
    thumb: meta.thumb,
    canvas: data.canvas,
    bust: meta.bust,
    slots,
    parts,
    starter,
    draw: (loadout) => drawLayered(spec, parts, loadout),
  };
}
