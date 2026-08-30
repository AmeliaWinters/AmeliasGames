/**
 * Sutemo's visual novel sprite, as a set.
 *
 * The art and its licence are described in `sets/PROVENANCE.md`. The PNGs and
 * `layers.json` under `sets/sutemo/` are produced by
 * `scripts/extract-sutemo.py` from the artist's PSD and should not be edited
 * by hand: rerun the script.
 *
 * What is written out here rather than generated is everything the PSD does
 * not know: what a part is called in English, and what you have to have
 * learned to own it. Thresholds are argued in `unlock.ts`.
 *
 * The hair is one part carrying two layers rather than two parts, and that is
 * the decision this set was chosen to make possible. The art separates a
 * fringe from the mass behind the head so the body and the outfit can go
 * between them, and exposing them as two slots would let somebody put a hime
 * cut's fringe on a ponytail. See `HAIR` below for the two styles that share a
 * back and the two that share a front.
 */

import { drawLayered, type LayeredSpec } from './layered.js';
import { SUTEMO_LAYERS } from './sets/sutemo/layers.js';
import { BACKGROUNDS } from './backgrounds.js';
import { partId, type AvatarSet, type Part, type Variant } from './types.js';

type Id = 'sutemo';
const SET: Id = 'sutemo';

/**
 * The five shades the artist drew, and their swatches.
 *
 * Each hex is the mean of the opaque pixels of that shade's bob, measured off
 * the exported PNG rather than picked by eye, so a swatch is the colour the
 * hair actually comes out. The commonest pixel was tried first and put blondie
 * and silver within a shade of each other, because the commonest pixel in
 * anime hair is the highlight.
 */
const HAIR_COLOURS: Variant[] = [
  { id: 'dark', name: 'Black', swatch: '#32303f' },
  { id: 'brown', name: 'Brown', swatch: '#6f423b' },
  { id: 'blondie', name: 'Blonde', swatch: '#ebc49b' },
  { id: 'silver', name: 'Silver', swatch: '#c9c3c9' },
  { id: 'pink', name: 'Pink', swatch: '#d48683' },
];

const HAIR: [string, string][] = [
  ['long', 'Long'],
  ['short', 'Short'],
  ['bob', 'Bob'],
  ['twintail', 'Twin tails'],
  ['hime', 'Hime cut'],
];

const OUTFITS: [string, string][] = [
  ['seifuku-2', 'Uniform'],
  ['pe', 'Gym kit'],
  ['hoodie', 'Hoodie'],
  ['pajama', 'Pyjamas'],
  ['winter', 'Winter coat'],
  ['summer-dress', 'Summer dress'],
  ['swimsuit', 'Swimsuit'],
  ['towel', 'Towel'],
  ['seifuku-1', 'Winter uniform'],
];

const FACES: [string, string][] = [
  ['normal', 'Neutral'],
  ['smile', 'Smile'],
  ['delighted', 'Delighted'],
  ['smug', 'Smug'],
  ['annoyed', 'Annoyed'],
  ['smile-2', 'Grin'],
  ['laugh', 'Laughing'],
  ['sad', 'Sad'],
  ['sleepy', 'Sleepy'],
  ['angry', 'Angry'],
  ['shocked', 'Shocked'],
];

const ACCESSORIES: [string, string][] = [
  ['choker', 'Choker'],
  ['glasses-black', 'Glasses'],
  ['glasses-red', 'Red glasses'],
  ['glasses-circle', 'Round glasses'],
  ['flower', 'Hair flower'],
];

function parts(): Part<Id>[] {
  const out: Part<Id>[] = [];
  for (const [id, name] of HAIR) {
    out.push({
      id: partId(SET, `hair/${id}`),
      name,
      slot: 'hair',
      variants: HAIR_COLOURS,
    });
  }
  for (const [id, name] of OUTFITS) {
    out.push({ id: partId(SET, `outfit/${id}`), name, slot: 'outfit', variants: [] });
  }
  for (const [id, name] of FACES) {
    out.push({ id: partId(SET, `face/${id}`), name, slot: 'face', variants: [] });
  }
  for (const [id, name] of ACCESSORIES) {
    out.push({
      id: partId(SET, `accessory/${id}`),
      name,
      slot: 'accessory',
      variants: [],
    });
  }
  for (const background of BACKGROUNDS) {
    out.push({
      id: partId(SET, background.id),
      name: background.name,
      slot: 'background',
      variants: [],
    });
  }
  return out;
}

/**
 * Where each slot lands in the stack.
 *
 * Read off the PSD's own order, which is the order the artist checked the art
 * in: hair behind, body, costume, hair in front, expression, accessories. The
 * gaps of ten are so a set that grows a layer between two of these does not
 * renumber the rest.
 */
const SPEC: LayeredSpec = {
  dir: 'sutemo',
  table: SUTEMO_LAYERS,
  base: [{ z: 20, key: 'body/default' }],
  draws: {
    hair: [
      { z: 10, key: (part, variant) => `hair/${part}/${variant}/back` },
      { z: 40, key: (part, variant) => `hair/${part}/${variant}/front` },
    ],
    outfit: [{ z: 30, key: (part) => `outfit/${part}` }],
    face: [{ z: 50, key: (part) => `face/${part}` }],
    accessory: [{ z: 60, key: (part) => `accessory/${part}` }],
  },
};

const PARTS = parts();

export const SUTEMO: AvatarSet<Id> = {
  id: SET,
  name: 'Ink',
  artist: 'Sutemo',
  blurb: 'Hand drawn, five hair colours, eleven faces.',
  // The set somebody earns, which used to be the pixel set's job. One of the
  // two has to be, or there is no reason to open this screen twice; and the
  // Kit is the better first set, because it is the one a person can build
  // themselves in rather than choose from.
  canvas: SUTEMO_LAYERS.canvas,
  /**
   * The head and the top of the shoulders, in canvas units, measured off the
   * exported body PNG rather than guessed. It has to sit low enough to catch
   * the collar, because a crop that ends at the chin reads as a mugshot, and
   * wide enough for twin tails, which are the widest hair in the set.
   */
  bust: { x: 190, y: 140, w: 630, h: 630 },
  slots: [
    { id: 'hair', label: 'Hair', optional: false },
    { id: 'face', label: 'Face', optional: false },
    { id: 'outfit', label: 'Outfit', optional: false },
    { id: 'accessory', label: 'Extras', optional: true },
    { id: 'background', label: 'Background', optional: true },
  ],
  parts: PARTS,
  /**
   * What somebody has on the first time they open the app: a complete, decent
   * looking character. Nothing here may be locked, and `avatar.test.ts` holds
   * that, because a starter avatar with a hole in it is the worst first
   * impression this feature can make.
   */
  starter: {
    set: SET,
    parts: {
      hair: partId(SET, 'hair/long'),
      face: partId(SET, 'face/smile'),
      outfit: partId(SET, 'outfit/seifuku-2'),
    },
    variants: { hair: 'dark' },
  },
  draw(loadout) {
    return drawLayered(SPEC, PARTS, loadout);
  },
};
