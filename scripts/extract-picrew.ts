/**
 * Turn a Picrew export under `CharacterCreator/<id>/` into the art and the
 * table a `picrew.ts` set draws from.
 *
 *   npx tsx scripts/extract-picrew.ts            both sets
 *   npx tsx scripts/extract-picrew.ts snake      one of them
 *
 * Rerunnable, like `extract-kit.ts`, and for the same reason: the export is
 * the source and this repo holds a derived copy, so a new drop of art is a
 * rerun rather than an afternoon in an image editor.
 *
 * What it knows about the export, which is the whole of the contract:
 *
 * - **`cf.json` is the manifest and it is complete.** `pList` is the category
 *   list in menu order, each with its items, the layers it draws into, the id
 *   of its colour palette and whether it may be empty. `cpList` maps a palette
 *   id to hex codes. `lyrList` maps a layer id to its z. Nothing here is
 *   guessed from the folders; the folders are only where the pixels are.
 *
 * - **Every sprite is a finished 600x600 picture, one file per colour.** This
 *   art is not masks: the artist exported
 *   `<category>/<item>/layer<L>_color<C>.png` already painted. So colour is a
 *   `Variant` list and never a tint, and the file count is items times
 *   colours, which is why the curation below is not optional.
 *
 * - **A category may draw into more than one layer** (`lyrs`), at different
 *   depths, and an item may be missing one of them. A hat with no brim simply
 *   has no file for the brim layer, and the box for it is written as null.
 *
 * - **Layers are trimmed to their own ink and the box is written down**, as in
 *   `extract-kit.ts`. A 128x128 sheet holding an eyebrow is mostly nothing.
 *   The box is the union across that item's colours, so a colour that paints
 *   one pixel wider than the others is not clipped by the one sampled first.
 *
 * **Curation is the point of `KITS[].keep` and it is a size decision, not
 * taste.** The two exports are 207MB and 39MB of 600x600 PNGs. Everything here
 * is resampled to 128 and written as WebP, and the categories that survive are
 * the ones that make a face: the doubled-up slots the makers offer so you can
 * wear two necklaces at once (`necklaces 2`, `tats 2`, `piercing 2`) are
 * dropped whole, along with the filters, the frames, the flags and the
 * confetti. What is left is about a tenth of the pixels and nearly all of the
 * character.
 *
 * **The signature layers stay.** Both makers are licensed for personal use
 * with the artist's mark visible, so the categories listed in `base` are drawn
 * always and cannot be taken off. See `sets/PROVENANCE.md`.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Everything is resampled to this. A 600px avatar is drawn at 96 on a phone. */
const CANVAS = 128;

/** One category we keep, and what it becomes. */
interface Keep {
  /** `pId` in `cf.json`. */
  p: number;
  slot: string;
  label: string;
  /** Short, filename safe, and the first segment of every key. */
  tag: string;
  optional: boolean;
  /** Where this slot's colour is stored, when that is not this slot. */
  colourKey?: string;
  /**
   * A second category composited into this one, item by item, by position.
   *
   * The one case is a pair of eyes: the maker files the left iris and the
   * right iris as two menus of fourteen, and picking them apart is a way to
   * end up with odd eyes by accident rather than on purpose. Nothing is drawn
   * between their two depths, so flattening them into one sprite loses
   * nothing and turns two menus into one.
   */
  merge?: number;
}

interface Kit {
  /** Folder under `CharacterCreator/`. */
  src: string;
  /** Folder under `sets/`, and the set id. */
  id: string;
  constant: string;
  keep: Keep[];
  /** Categories drawn always and never chosen: the artist's signature. */
  base: number[];
}

const KITS: Kit[] = [
  {
    src: '2863746',
    id: 'snake',
    constant: 'SNAKE_DATA',
    base: [3002704],
    keep: [
      { p: 3002694, slot: 'background', label: 'Behind', tag: 'bg', optional: true },
      { p: 3003095, slot: 'wings', label: 'Wings', tag: 'wing', optional: true },
      { p: 3003109, slot: 'backhair', label: 'Back hair', tag: 'bhair', optional: true, colourKey: 'hair' },
      { p: 2999506, slot: 'body', label: 'Skin', tag: 'body', optional: false },
      { p: 3002702, slot: 'tattoo', label: 'Tattoos', tag: 'tat', optional: true },
      { p: 3003130, slot: 'marks', label: 'Marks', tag: 'mark', optional: true },
      { p: 3003103, slot: 'blush', label: 'Blush', tag: 'blush', optional: true },
      { p: 3003098, slot: 'mouth', label: 'Mouth', tag: 'mouth', optional: false },
      { p: 3003101, slot: 'nose', label: 'Nose', tag: 'nose', optional: false },
      { p: 3003097, slot: 'brows', label: 'Brows', tag: 'brow', optional: false },
      { p: 3002956, slot: 'outfit', label: 'Top', tag: 'top', optional: false },
      { p: 3003105, slot: 'outer', label: 'Coat', tag: 'coat', optional: true },
      { p: 3003125, slot: 'piercings', label: 'Piercings', tag: 'pierce', optional: true },
      { p: 3003104, slot: 'necklace', label: 'Necklace', tag: 'neck', optional: true },
      { p: 3003116, slot: 'earrings', label: 'Earrings', tag: 'ear', optional: true },
      { p: 3002801, slot: 'ears', label: 'Ears', tag: 'ears', optional: true },
      { p: 3002703, slot: 'eyes', label: 'Eyes', tag: 'eye', optional: false },
      // Left and right irises, flattened. See `Keep.merge`.
      { p: 3002953, slot: 'iris', label: 'Irises', tag: 'iris', optional: false, merge: 3003124 },
      { p: 3003094, slot: 'makeup', label: 'Eyeshadow', tag: 'shadow', optional: true },
      { p: 3003121, slot: 'glasses', label: 'Eyewear', tag: 'glass', optional: true },
      { p: 3003106, slot: 'bangs', label: 'Fringe', tag: 'bang', optional: true, colourKey: 'hair' },
      { p: 3003132, slot: 'horns', label: 'Horns', tag: 'horn', optional: true },
      { p: 3003115, slot: 'hat', label: 'Headscarf', tag: 'scarf', optional: true },
      { p: 3003122, slot: 'hairacc', label: 'Hair bits', tag: 'hacc', optional: true },
    ],
  },
  {
    src: '644129',
    id: 'makowka',
    constant: 'MAKOWKA_DATA',
    base: [674511, 674518],
    keep: [
      { p: 674453, slot: 'background', label: 'Behind', tag: 'bg', optional: true },
      { p: 669097, slot: 'backhair', label: 'Back hair', tag: 'bhair', optional: true, colourKey: 'hair' },
      { p: 666913, slot: 'body', label: 'Skin', tag: 'body', optional: false },
      { p: 2435336, slot: 'tattoo', label: 'Tattoos', tag: 'tat', optional: true },
      { p: 666975, slot: 'ears', label: 'Ears', tag: 'ears', optional: true, colourKey: 'body' },
      { p: 666914, slot: 'face', label: 'Face', tag: 'face', optional: false, colourKey: 'body' },
      { p: 667778, slot: 'blush', label: 'Blush', tag: 'blush', optional: true },
      { p: 667779, slot: 'marks', label: 'Freckles', tag: 'freck', optional: true },
      { p: 669095, slot: 'scars', label: 'Scars', tag: 'scar', optional: true },
      { p: 670743, slot: 'earrings', label: 'Earrings', tag: 'ear', optional: true },
      { p: 671796, slot: 'outfit', label: 'Top', tag: 'top', optional: false },
      { p: 674345, slot: 'necklace', label: 'Necklace', tag: 'neck', optional: true },
      { p: 671798, slot: 'outer', label: 'Layer', tag: 'coat', optional: true },
      { p: 674250, slot: 'makeup', label: 'Makeup', tag: 'make', optional: true },
      { p: 673442, slot: 'beard', label: 'Beard', tag: 'beard', optional: true },
      { p: 666915, slot: 'eyes', label: 'Eyes', tag: 'eye', optional: false },
      { p: 666916, slot: 'nose', label: 'Nose', tag: 'nose', optional: false },
      { p: 666918, slot: 'mouth', label: 'Mouth', tag: 'mouth', optional: false },
      { p: 666924, slot: 'brows', label: 'Brows', tag: 'brow', optional: false },
      { p: 670744, slot: 'piercings', label: 'Piercings', tag: 'pierce', optional: true },
      { p: 668161, slot: 'hair', label: 'Hair', tag: 'hair', optional: true },
      { p: 669096, slot: 'glasses', label: 'Glasses', tag: 'glass', optional: true },
      { p: 1716848, slot: 'hairacc', label: 'Hair bits', tag: 'hacc', optional: true },
      { p: 669098, slot: 'hat', label: 'Hijab', tag: 'hijab', optional: true },
      { p: 675335, slot: 'horns', label: 'Horns', tag: 'horn', optional: true },
    ],
  },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Cf {
  w: number;
  h: number;
  title: string;
  pList: {
    pId: number;
    pNm: string;
    cpId: string;
    isRmv: number;
    lyrs: number[];
    items: { itmId: number }[];
    defItmId?: number;
  }[];
  cpList: Record<string, { cId: number; cd: string }[]>;
  lyrList: Record<string, number>;
}

/** `13_bangs` for pId 3003106: the export numbers its folders, cf.json does not. */
async function folders(src: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const name of await readdir(src, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    out.set(name.name.replace(/^\d+_/, ''), name.name);
  }
  return out;
}

/** The bounding box of everything not fully transparent, or null if empty. */
function inkBox(data: Buffer, size: number): Box | null {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // A resample leaves a fringe of nearly-nothing around a hard edge, and
      // trimming to alpha > 0 keeps a box two pixels wider than the drawing on
      // every sprite in the set. Four is below what any eye resolves and above
      // what lanczos leaves behind.
      if (data[(y * size + x) * 4 + 3] < 4) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function union(a: Box | null, b: Box | null): Box | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** One 600x600 export, resampled to the canvas, as raw RGBA. */
async function load(file: string): Promise<Buffer | null> {
  try {
    return await sharp(file)
      .ensureAlpha()
      .resize(CANVAS, CANVAS, { kernel: 'lanczos3', fit: 'fill' })
      .raw()
      .toBuffer();
  } catch {
    return null;
  }
}

/** `b` painted over `a`, both raw RGBA of the same size. Source-over. */
function over(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.from(a);
  for (let i = 0; i < out.length; i += 4) {
    const alpha = b[i + 3] / 255;
    if (alpha === 0) continue;
    const keep = (out[i + 3] / 255) * (1 - alpha);
    const total = alpha + keep;
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.round((b[i + c] * alpha + out[i + c] * keep) / total);
    }
    out[i + 3] = Math.round(total * 255);
  }
  return out;
}

interface OutLayer {
  z: number;
  /** Per item, the trim box for this layer, or null where the item has none. */
  boxes: (Box | null)[];
}

interface OutCat {
  slot: string;
  label: string;
  tag: string;
  optional: boolean;
  colourKey?: string;
  colours: string[];
  items: string[];
  layers: OutLayer[];
}

async function build(kit: Kit) {
  const src = path.join(ROOT, 'CharacterCreator', kit.src);
  const out = path.join(ROOT, 'src', 'client', 'avatar', 'sets', kit.id);
  const art = path.join(out, 'webp');
  const cf = JSON.parse(await readFile(path.join(src, 'cf.json'), 'utf8')) as Cf;
  const dirs = await folders(src);

  if (cf.w !== cf.h) throw new Error(`${kit.id}: ${cf.w}x${cf.h} is not square`);

  await rm(art, { recursive: true, force: true });
  await mkdir(art, { recursive: true });

  const byId = new Map(cf.pList.map((p) => [p.pId, p]));
  const dirOf = (pId: number) => {
    const p = byId.get(pId);
    if (!p) throw new Error(`${kit.id}: no category ${pId}`);
    // The folders drop the punctuation cf.json keeps: `10_mouth add ons 2`
    // against `mouth add ons 2`, and `03_irises L` against `irises L`.
    const want = p.pNm.replace(/[\\/]/g, '_');
    const key = [...dirs.keys()].find((name) => name === p.pNm || name === want);
    if (!key) throw new Error(`${kit.id}: no folder for ${p.pNm}`);
    return path.join(src, dirs.get(key)!);
  };

  let files = 0;
  let bytes = 0;

  /**
   * One category, written out. `tag` prefixes every file and every key.
   *
   * Two passes per item and layer: find the box every colour of it fits
   * inside, then extract each colour to that box. The box has to cover every
   * colour or the widest one loses a pixel, and reading twice costs less than
   * being wrong about which colour that is.
   */
  async function emit(spec: Keep, forceItems?: number[]): Promise<OutCat> {
    const p = byId.get(spec.p)!;
    const merge = spec.merge ? byId.get(spec.merge)! : undefined;
    const dir = dirOf(spec.p);
    const mergeDir = merge ? dirOf(merge.pId) : undefined;
    const palette = cf.cpList[p.cpId] ?? [];
    // A category with no palette still has one file per item, exported under
    // whatever colour id the maker gave it, so the list is never empty.
    const colours = palette.length > 0 ? palette : [{ cId: 0, cd: '#000000' }];
    const items = forceItems ?? p.items.map((item) => item.itmId);
    const layers: OutLayer[] = p.lyrs.map((id) => ({ z: cf.lyrList[String(id)], boxes: [] }));

    for (let i = 0; i < items.length; i++) {
      for (let l = 0; l < p.lyrs.length; l++) {
        const layer = p.lyrs[l];
        const raw: (Buffer | null)[] = [];
        let box: Box | null = null;
        for (const colour of colours) {
          let pixels = await load(
            path.join(dir, String(items[i]), `layer${layer}_color${colour.cId}.png`),
          );
          if (pixels && merge && mergeDir) {
            const mate = merge.items[i];
            const other = mate
              ? await load(
                  path.join(
                    mergeDir,
                    String(mate.itmId),
                    `layer${merge.lyrs[0]}_color${colour.cId}.png`,
                  ),
                )
              : null;
            if (other) pixels = over(pixels, other);
          }
          raw.push(pixels);
          if (pixels) box = union(box, inkBox(pixels, CANVAS));
        }
        layers[l].boxes.push(box);
        if (!box) continue;
        for (let c = 0; c < colours.length; c++) {
          const pixels = raw[c];
          if (!pixels) continue;
          const name = `${spec.tag}-${i}-${l}-${c}.webp`;
          const info = await sharp(pixels, {
            raw: { width: CANVAS, height: CANVAS, channels: 4 },
          })
            .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
            // Near-lossless, not lossy: this art is flat colour with hard
            // edges, and lossy WebP rings on exactly that. Measured over 247
            // sprites from both sets, compositing each over white and black
            // before diffing, so a change hidden under alpha does not count:
            // lossy q90 is 68% of lossless but pushes a worst pixel 65/255,
            // visible as a halo on a hard edge. `nearLossless` quantises in a
            // way the lossless coder predicts instead of transforming, so q40
            // is 75% -- nearly the same saving -- for a worst pixel of 4/255,
            // alpha included. That is the trade the original comment was
            // right to refuse in its lossy form and is safe in this one.
            .webp({ nearLossless: true, quality: 40, effort: 6 })
            .toFile(path.join(art, name));
          files++;
          bytes += info.size;
        }
      }
    }

    return {
      slot: spec.slot,
      label: spec.label,
      tag: spec.tag,
      optional: spec.optional,
      ...(spec.colourKey ? { colourKey: spec.colourKey } : {}),
      colours: colours.map((colour) => colour.cd),
      items: items.map(String),
      layers,
    };
  }

  const cats: OutCat[] = [];
  for (const spec of kit.keep) {
    cats.push(await emit(spec));
    console.log(`  ${spec.tag.padEnd(7)} ${String(files).padStart(5)} files so far`);
  }

  // The signature, drawn always. One item, whichever the export defaults to.
  const base: OutCat[] = [];
  for (const pId of kit.base) {
    const p = byId.get(pId)!;
    base.push(
      await emit({ p: pId, slot: 'overlay', label: p.pNm, tag: `sig${base.length}`, optional: false }, [
        p.defItmId ?? p.items[0].itmId,
      ]),
    );
  }

  const body = [
    `// GENERATED by scripts/extract-picrew.ts. Do not edit: rerun it.`,
    `import type { PicrewData } from '../../picrew.js';`,
    ``,
    `export const ${kit.constant}: PicrewData = {`,
    `  dir: ${JSON.stringify(kit.id)},`,
    `  canvas: { w: ${CANVAS}, h: ${CANVAS} },`,
    `  base: ${JSON.stringify(base)},`,
    `  cats: [`,
    ...cats.map((cat) => `    ${JSON.stringify(cat)},`),
    `  ],`,
    `};`,
    ``,
  ].join('\n');
  await writeFile(path.join(out, 'data.ts'), body);

  console.log(`${kit.id}: ${files} files, ${(bytes / 1e6).toFixed(1)}MB into ${art}\n`);
}

const wanted = process.argv.slice(2);
for (const kit of KITS) {
  if (wanted.length > 0 && !wanted.includes(kit.id)) continue;
  console.log(`== ${kit.id}`);
  await mkdir(path.join(ROOT, 'src', 'client', 'avatar', 'sets', kit.id), { recursive: true });
  await build(kit);
}
