/**
 * The Character Kit: sixteen slots of 64x64 pixel art, recoloured on the fly.
 *
 * The second layered set, and the one that shows why `layered.ts` was worth
 * writing. Sutemo is five hairstyles in five colours because that is what the
 * artist drew, twenty five files, and there is no twenty sixth. This set is a
 * mask and a line drawing per part, so eighty hair pieces take whatever colour
 * somebody picks and the wardrobe is combinatorial rather than a menu.
 *
 * **The stacking order is the whole design and it is `Z` below.** Getting it
 * wrong is not subtle -- a fringe under a hair cap disappears, ears over the
 * hair look glued on, an iris over its own line art turns the eye into a
 * button -- and every number in that table was checked by rendering it. See
 * `npm run render:avatars`, and the note in CLAUDE.md about why looking is not
 * optional here.
 *
 * Three colour rules, and they come from how the art is drawn rather than from
 * anything decided here. `extract-kit.ts` has the long version:
 *
 * - **Numbered sprites are skin**, chosen by the tone on the `body` slot. Skin
 *   is a list of four rather than a picker because the artist painted four
 *   ramps and every nose, ear and freckle is baked against them.
 * - **`C` and `M` are masks**, multiplied by a colour somebody picked.
 * - **`L` and `O` are drawn as they are.** Line art is one ink colour across
 *   the whole set, which is what holds a hundred mixed parts together as one
 *   character.
 *
 * **Hair is one colour across three slots.** `backhair`, `hair` and `bangs`
 * are separate depths -- that is the point of a layered set -- but they are
 * one head of hair, so the colour lives on `hair` and the other two read it.
 * A picker per slot would have shipped two-tone accidents as the default
 * result of touching two tabs.
 */

import { BACKGROUND_Z, drawLayered, type LayeredSpec } from '../../layered.js';
import { shade } from '../../tint.js';
import { partId, type AvatarSet, type Loadout, type Part, type Slot, type SlotSpec, type Variant } from '../../types.js';
import { KIT_LAYERS, KIT_SKIN } from './layers.js';

type Id = 'kit';
const SET: Id = 'kit';

const id = (name: string) => partId(SET, name);

/**
 * Where each kind of layer sits, back to front.
 *
 * Named rather than numbered at the call sites, and spaced by ten, so that a
 * part which turns out to need a depth of its own can have one without
 * renumbering the file. The gaps that matter:
 *
 * - `EARS` is above the body and below all three hair depths, so a hat of hair
 *   covers a human ear and long elf ears still poke out of a bob, exactly as
 *   the sprites were drawn to.
 * - `MARKS` is under the clothes: freckles and a jaw shadow are on skin, and
 *   the collar of a turtleneck should cover the neck they run down.
 * - The face stack is `NOSE`, then eyes, then `BROWS`, then `MOUTH`, and the
 *   eyes are four depths of their own. An iris under its line art is an eye; a
 *   flat disc over it is a button.
 * - `MAKEUP` is above the face and below the hair, which is where blush goes:
 *   on the cheek, under the fringe.
 */
const Z = {
  BACKGROUND: BACKGROUND_Z,
  BACKHAIR: 10,
  BODY: 20,
  EARS: 30,
  MARKS: 40,
  INNER: 50,
  OUTER: 60,
  NOSE: 70,
  /** Iris, then the shadow the lid casts on it, then lashes, then a glint. */
  EYE_IRIS: 80,
  EYE_LID: 81,
  EYE_LINE: 82,
  EYE_GLINT: 83,
  BROWS: 90,
  MOUTH: 100,
  MAKEUP: 110,
  HAIR: 120,
  BANGS: 130,
  ACCESSORY: 140,
} as const;

/** What a brand new character is wearing, and the colours a picker opens on. */
const DEFAULT = {
  skin: '1',
  hair: '#6b4636',
  eyes: '#5b7c8d',
  inner: '#e4e2e6',
  outer: '#8fa6b8',
  accessory: '#d8737f',
  makeup: '#e88b93',
  background: '#cfd8e3',
} as const;

/**
 * The tone somebody picked, as the digit the sprites are named with.
 *
 * Falls back rather than throwing, because a loadout outlives the art: a
 * stored variant naming a fifth skin the set no longer has should draw a face
 * rather than a stack trace.
 */
function skin(loadout: Loadout): string {
  const chosen = loadout.variants.body ?? DEFAULT.skin;
  return KIT_SKIN[Number(chosen) - 1] ? chosen : DEFAULT.skin;
}

/** A slot's chosen colour, or the colour that slot opens on. */
function colour(loadout: Loadout, slot: Slot, fallback: string): string {
  const chosen = loadout.variants[slot];
  return chosen && /^#[0-9a-f]{6}$/i.test(chosen) ? chosen : fallback;
}

const hairColour = (loadout: Loadout) => colour(loadout, 'hair', DEFAULT.hair);

/**
 * How each slot becomes layers, which is the table the whole set hangs off.
 *
 * A slot lists one `SlotDraw` per depth it occupies. Most list two, a mask and
 * its line art; the eyes list four. A key the table does not hold is skipped
 * by `drawLayered`, which is what lets `mouth` ask every mouth for a tongue
 * when only two of them have one.
 */
const SPEC: LayeredSpec = {
  dir: 'kit',
  table: KIT_LAYERS,
  base: [],
  draws: {
    background: [
      // Two masks, and for a patterned background the second covers the first:
      // the pattern sprite is a full field painted in two steps of the ramp,
      // so one colour through it gives both tones. `solid` has no `M` and the
      // flat field underneath is the whole of it.
      { z: Z.BACKGROUND, key: (part) => `bg/${part}/C`, tint: (l) => colour(l, 'background', DEFAULT.background) },
      { z: Z.BACKGROUND, key: (part) => `bg/${part}/M`, tint: (l) => colour(l, 'background', DEFAULT.background) },
    ],
    backhair: [
      { z: Z.BACKHAIR, key: (part) => `backhair/${part}/C`, tint: hairColour },
      { z: Z.BACKHAIR + 1, key: (part) => `backhair/${part}/L` },
    ],
    body: [
      { z: Z.BODY, key: (part, variant) => `body/${part}/${variant}` },
      { z: Z.BODY + 1, key: (part) => `body/${part}/L` },
    ],
    ears: [
      { z: Z.EARS, key: (part, _variant, l) => `ears/${part}/${skin(l)}` },
      { z: Z.EARS + 1, key: (part) => `ears/${part}/L` },
    ],
    marks: [{ z: Z.MARKS, key: (part, _variant, l) => `misc/${part}/${skin(l)}` },
      // The mole is the one mark drawn in ink rather than in skin, so it has an
      // `L` and no tones. Both keys are asked for and only one ever answers.
      { z: Z.MARKS, key: (part) => `misc/${part}/L` }],
    outfit: [
      { z: Z.INNER, key: (part) => `inner/${part}/C`, tint: (l) => colour(l, 'outfit', DEFAULT.inner) },
      { z: Z.INNER + 1, key: (part) => `inner/${part}/L` },
    ],
    outer: [
      { z: Z.OUTER, key: (part) => `outer/${part}/C`, tint: (l) => colour(l, 'outer', DEFAULT.outer) },
      { z: Z.OUTER + 1, key: (part) => `outer/${part}/L` },
      { z: Z.OUTER + 2, key: (part) => `outer/${part}/O` },
    ],
    nose: [{ z: Z.NOSE, key: (part, _variant, l) => `nose/${part}/${skin(l)}` }],
    eyes: [
      { z: Z.EYE_IRIS, key: (part) => `eyes/${part}/C`, tint: (l) => colour(l, 'eyes', DEFAULT.eyes) },
      { z: Z.EYE_LID, key: (part, _variant, l) => `eyes/${part}/${skin(l)}` },
      { z: Z.EYE_LINE, key: (part) => `eyes/${part}/L` },
      { z: Z.EYE_GLINT, key: (part) => `eyes/${part}/O` },
    ],
    brows: [{ z: Z.BROWS, key: (part) => `eyebrows/${part}/L` }],
    mouth: [
      { z: Z.MOUTH, key: (part, _variant, l) => `mouth/${part}/${skin(l)}` },
      { z: Z.MOUTH + 1, key: (part) => `mouth/${part}/L` },
    ],
    makeup: [
      // `blush` is skin coloured and ignores the picker; `blushm` is a mask and
      // obeys it. One slot rather than two, because to somebody choosing it
      // they are both blush.
      { z: Z.MAKEUP, key: (part, _variant, l) => `makeup/${part}/${skin(l)}` },
      { z: Z.MAKEUP, key: (part) => `makeup/${part}/C`, tint: (l) => colour(l, 'makeup', DEFAULT.makeup) },
      { z: Z.MAKEUP + 1, key: (part) => `makeup/${part}/M`, tint: (l) => shade(colour(l, 'makeup', DEFAULT.makeup)) },
      { z: Z.MAKEUP + 2, key: (part) => `makeup/${part}/N` },
      { z: Z.MAKEUP + 3, key: (part) => `makeup/${part}/L` },
    ],
    hair: [
      { z: Z.HAIR, key: (part) => `basehair/${part}/C`, tint: hairColour },
      { z: Z.HAIR + 1, key: (part) => `basehair/${part}/L` },
    ],
    bangs: [
      { z: Z.BANGS, key: (part) => `bangs/${part}/C`, tint: hairColour },
      { z: Z.BANGS + 1, key: (part) => `bangs/${part}/L` },
    ],
    accessory: [
      { z: Z.ACCESSORY, key: (part) => `access/${part}/C`, tint: (l) => colour(l, 'accessory', DEFAULT.accessory) },
      { z: Z.ACCESSORY + 1, key: (part) => `access/${part}/L` },
      { z: Z.ACCESSORY + 2, key: (part) => `access/${part}/O` },
    ],
  },
};


/**
 * Names the art does not carry.
 *
 * The folders are the artist's working names, and most of them title case into
 * something readable. These are the ones that do not: initials, in jokes, and
 * three that would read as a typo on a button.
 */
const NAMES: Record<string, string> = {
  atriangle: 'Angled',
  bigbow: 'Big bow',
  blep: 'Blep',
  blushm: 'Rosy',
  bushyneutral: 'Bushy flat',
  calmbig: 'Calm wide',
  coif: 'Coif',
  dhorn: 'Horns',
  drope: 'Drop earrings',
  'edgeworth-braid': 'Cravat braid',
  edgeworth: 'Cravat',
  flowerc: 'Flower crown',
  frecklesparse: 'Freckles, light',
  glassRound: 'Round glasses',
  glassSq: 'Square glasses',
  happyClosed: 'Happy closed',
  hpony: 'High ponytail',
  meh: 'Shaggy',
  munch: 'Munching',
  pearle: 'Pearl earrings',
  sclip: 'Side clip',
  seph: 'Long swept',
  shavedn: 'Shaved',
  sly: 'Sly',
  sol: 'Spiked',
  sung: 'Sunglasses',
  tclip: 'Twin clips',
  teef: 'Grin',
  vsweater: 'V sweater',
  yum: 'Yum',
};

function nameOf(part: string): string {
  if (NAMES[part]) return NAMES[part];
  const spaced = part.replace(/-/g, ' ');
  return spaced[0].toUpperCase() + spaced.slice(1);
}

/**
 * A slot's parts, priced by their position in the list given.
 *
 * The list is the order they appear in the customiser and therefore the order
 * they unlock in, so it is written cheapest and plainest first: the shapes
 * somebody wants on day one at the top, the ones that are a whole look at the
 * bottom.
 */
function slot(kind: Slot, ids: string[], variants: Variant[] = []): Part<Id>[] {
  return ids.map((part, rung) => ({
    id: id(`${kind}/${part}`),
    name: nameOf(part),
    slot: kind,
    variants,
  }));
}

/** The four ramps, as the only colour in this set chosen from a list. */
const SKINS: Variant[] = KIT_SKIN.map((ramp, index) => ({
  id: String(index + 1),
  name: ['Fair', 'Warm', 'Tan', 'Deep'][index] ?? `Tone ${index + 1}`,
  // The base step rather than the highlight: the swatch has to be the colour
  // the face reads as, and the highlight is a rim light on the cheekbone.
  swatch: ramp[1],
}));

const PARTS: Part<Id>[] = [
  ...slot('body', ['body'], SKINS),
  ...slot('ears', ['human', 'pointy', 'elf', 'elflong']),
  ...slot('eyes', ['simple', 'mid', 'big', 'calm', 'gentle', 'slim', 'shy', 'closed', 'happyClosed', 'sly', 'anger', 'orange']),
  ...slot('brows', ['straight', 'calm', 'raised', 'sad', 'angry', 'dot', 'hat', 'bushy', 'bushier', 'bushyneutral', 'calmbig']),
  ...slot('nose', ['button', 'tiny', 'straight', 'flat', 'bulb', 'atriangle']),
  ...slot('mouth', ['neutral', 'smile', 'smiling', 'pout', 'smirk', 'angry', 'surprised', 'teef', 'munch', 'blep', 'yum']),
  ...slot('marks', ['freckles', 'frecklesparse', 'blush', 'mole', 'jaw', 'eyewrinkle', 'scar']),
  ...slot('makeup', ['blush', 'blushm']),
  ...slot('backhair', ['bun', 'poof', 'pony', 'hpony', 'pig', 'bushy']),
  ...slot('hair', ['bob', 'mid', 'long', 'slick', 'wavy', 'curl', 'swoosh', 'meh', 'poofs', 'locs', 'coif', 'shavedn', 'undercut', 'beret']),
  ...slot('bangs', ['fringe', 'straight', 'neat', 'part', 'sweep', 'swoop', 'sweeping', 'pixie', 'baby', 'more', 'two', 'cover', 'fake', 'braid', 'ahoge', 'talon', 'sol', 'seph', 'edgeworth', 'edgeworth-braid']),
  ...slot('outfit', ['crew', 'v', 'scoop', 'tank', 'turtleneck', 'sweater', 'tunic', 'halter', 'offshoulder', 'tie', 'ruffle', 'dress']),
  ...slot('outer', ['cardigan', 'hoodie', 'vest', 'jacket', 'vsweater', 'varsity', 'overall', 'cloak', 'toga']),
  ...slot('accessory', ['bandaid', 'choker', 'headband', 'bow', 'sclip', 'tclip', 'earring', 'pearle', 'drope', 'necklace', 'glassRound', 'glassSq', 'sung', 'mask', 'scarf', 'flower', 'flowerc', 'bigbow', 'dhorn', 'sparkles', 'anger', 'sweat']),
  ...slot('background', ['solid', 'striped', 'checker', 'polka', 'diag']),
];

/**
 * The colours worth one tap, per slot.
 *
 * Quick picks and not a palette: the picker underneath them takes any colour
 * at all, which is the answer to "why is my hair not this exact blue". These
 * exist because a colour picker is a bad first offer -- somebody who wants
 * brown hair should get brown hair by pressing brown, not by hunting for it in
 * a gradient on a phone.
 *
 * They are also what the randomiser rolls, which is why there are no
 * near-duplicates: two browns a step apart double brown's odds and change
 * nothing anybody can see.
 *
 * These are the one place in the client outside the art itself that names
 * colours in hex, for the reason `Variant.swatch` gives: a picture of the art
 * is not chrome, and no palette token is the colour hair is.
 */
const HAIR_SWATCHES = [
  '#2b2320',
  '#6b4636',
  '#a9724a',
  '#d8a15c',
  '#efd9a8',
  '#b8b3ae',
  '#8c4a3f',
  '#c8455a',
  '#6d5aa8',
  '#3f7fa8',
  '#4f8a63',
  '#d8737f',
];

const EYE_SWATCHES = [
  '#3a2a22',
  '#7a4a2a',
  '#b07a3a',
  '#5b7c8d',
  '#3f6ea8',
  '#4f8a63',
  '#6d5aa8',
  '#a84050',
  '#7d7a74',
];

/** Clothes, accessories: a wider spread, because anything goes on a jumper. */
const CLOTH_SWATCHES = [
  '#e4e2e6',
  '#9aa3ad',
  '#3c414b',
  '#2c3550',
  '#8fa6b8',
  '#4f8a63',
  '#8fc06a',
  '#e8c15a',
  '#d98a4f',
  '#c8455a',
  '#d8737f',
  '#8a5fa8',
];

/** Blush and lip colour, which is a narrow question with a narrow answer. */
const BLUSH_SWATCHES = ['#e88b93', '#d8737f', '#c8455a', '#e0a08a', '#b06a8a', '#8a5fa8'];

/** Backgrounds, kept quiet: it is behind a face, not a poster. */
const BEHIND_SWATCHES = [
  '#cfd8e3',
  '#e3d9cf',
  '#d9e3cf',
  '#e8d3dd',
  '#b8a9c9',
  '#8fa6b8',
  '#7d8a99',
  '#3c414b',
];

/**
 * The tab strip, in the order somebody builds a face.
 *
 * Shape first, then the features in the order they are noticed, then hair,
 * then clothes, then the things that are a flourish. Not the draw order: what
 * sits behind what is `Z` above and is nobody's business but the renderer's.
 *
 * Optional is doing real work here. Everything a face cannot be without is
 * required -- there is no such thing as a character with no eyes -- and every
 * flourish is optional, so "no glasses" is a choice somebody can make and the
 * randomiser can roll.
 */
const SLOTS: SlotSpec[] = [
  { id: 'body', label: 'Skin', optional: false, colour: 'palette' },
  { id: 'eyes', label: 'Eyes', optional: false, colour: 'free', fallback: DEFAULT.eyes, swatches: EYE_SWATCHES },
  { id: 'brows', label: 'Brows', optional: false },
  { id: 'nose', label: 'Nose', optional: false },
  { id: 'mouth', label: 'Mouth', optional: false },
  { id: 'ears', label: 'Ears', optional: false },
  // All three hair depths write the same colour. See `colourKey`.
  { id: 'hair', label: 'Hair', optional: true, colour: 'free', fallback: DEFAULT.hair, swatches: HAIR_SWATCHES },
  { id: 'bangs', label: 'Fringe', optional: true, colour: 'free', colourKey: 'hair', fallback: DEFAULT.hair, swatches: HAIR_SWATCHES },
  { id: 'backhair', label: 'Back hair', optional: true, colour: 'free', colourKey: 'hair', fallback: DEFAULT.hair, swatches: HAIR_SWATCHES },
  { id: 'outfit', label: 'Top', optional: false, colour: 'free', fallback: DEFAULT.inner, swatches: CLOTH_SWATCHES },
  { id: 'outer', label: 'Layer', optional: true, colour: 'free', fallback: DEFAULT.outer, swatches: CLOTH_SWATCHES },
  { id: 'accessory', label: 'Extras', optional: true, colour: 'free', fallback: DEFAULT.accessory, swatches: CLOTH_SWATCHES },
  { id: 'marks', label: 'Marks', optional: true },
  { id: 'makeup', label: 'Blush', optional: true, colour: 'free', fallback: DEFAULT.makeup, swatches: BLUSH_SWATCHES },
  { id: 'background', label: 'Behind', optional: true, colour: 'free', fallback: DEFAULT.background, swatches: BEHIND_SWATCHES },
];

const STARTER: Loadout<Id> = {
  set: SET,
  parts: {
    body: id('body/body'),
    ears: id('ears/human'),
    eyes: id('eyes/mid'),
    brows: id('brows/calm'),
    nose: id('nose/button'),
    mouth: id('mouth/smile'),
    hair: id('hair/bob'),
    bangs: id('bangs/fringe'),
    outfit: id('outfit/crew'),
    background: id('background/solid'),
  },
  variants: {
    body: DEFAULT.skin,
    hair: DEFAULT.hair,
    eyes: DEFAULT.eyes,
    outfit: DEFAULT.inner,
    background: DEFAULT.background,
  },
};

export const KIT: AvatarSet<Id> = {
  id: SET,
  name: 'Character Kit',
  artist: 'Unknown',
  credit: 'Character Kit sprites by their artist',
  blurb: 'Sixteen layers of pixel art, in any colour you like.',
  canvas: KIT_LAYERS.canvas,
  // Chin to a little above the crown, and wide enough for hair rather than for
  // a head: a bust crop measured on the skull clips a ponytail off at the ear.
  bust: { x: 9, y: 1, w: 46, h: 46 },
  slots: SLOTS,
  parts: PARTS,
  starter: STARTER,
  draw(loadout) {
    return drawLayered(SPEC, PARTS, loadout);
  },
};
