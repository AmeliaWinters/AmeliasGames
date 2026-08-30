/**
 * Turn the `CharacterCreator/` sprite folder into the PNG set and layer table
 * the avatar renderer eats.
 *
 *   npx tsx scripts/extract-kit.ts
 *
 * Rerunnable on purpose, like `extract-sutemo.py`, and for the same reason:
 * the artist's folder is the source and this repo holds a derived copy, so a
 * new drop of art is a rerun rather than an afternoon in an image editor.
 *
 * What it knows about the art, which is the whole of the contract:
 *
 * - **Every sprite is 64x64 and every part lives in its own folder**, named
 *   `<part><suffix>.png`. The suffix says what the file is *for*, and there
 *   are five of them:
 *
 *   - `L` line art, drawn in one colour (#31130b) and never tinted.
 *   - `C` the colour mask, drawn as a three step grey ramp (255 / 206,195,189
 *     / 143,127,118). Multiply a chosen colour through it and the shading
 *     survives. This is the file that makes the set recolourable at all.
 *   - `M` a *second* mask, for the parts that take two colours: the shaved
 *     side of the undercut, the pattern on a background.
 *   - `O` an overlay that belongs *above* the line art: eye highlights, the
 *     stripe on the varsity jacket.
 *   - `1`..`4` pre-baked skin tones. The artist drew four skin ramps
 *     (`extra/skincolors.png`) and exported everything skin coloured four
 *     times: ears, noses, freckles, the shadow an eyelid casts. Numbered
 *     files are picked by the chosen skin rather than tinted, so the skin
 *     stays exactly the four ramps somebody drew on purpose.
 *
 * - **Anything painted in the first skin ramp is exported as four tones here,
 *   whatever the artist called it.** They numbered most of the skin coloured
 *   sprites and left a few as a plain `C` or `L`: the body itself, the tongue
 *   in two of the mouths, and a copy of tone one beside every numbered nose.
 *   Rather than teach the renderer that some skin follows the skin picker and
 *   some does not, this script finishes the job. A sprite whose every colour
 *   is in ramp one is remapped into all four and written out numbered, and
 *   where the artist already drew that tone by hand, theirs wins.
 *
 *   Which leaves the renderer three rules and no exceptions: numbered sprites
 *   are chosen by skin, `C` and `M` are multiplied by a colour somebody
 *   picked, `L` and `O` are drawn exactly as they are.
 *
 * - **Layers are trimmed to their own ink and the offset is written down.** A
 *   64x64 sheet holding an eyebrow is mostly nothing. The renderer places by
 *   percentage, so trimming costs no accuracy.
 *
 * - **`extra/` is the artist's scratch folder** and is skipped whole: a
 *   sketch, two `Copy` directories, the bases they drew hair against, and
 *   loose `Layer 9.png` exports. Nothing in it is a part. The one thing read
 *   out of it is `skincolors.png`, which is not art at all but the skin ramps,
 *   and it is written out as TypeScript rather than as a PNG.
 */

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'CharacterCreator', 'Sprites');
const OUT = path.join(ROOT, 'src', 'client', 'avatar', 'sets', 'kit');

/** The canvas the whole set is drawn on. Asserted below rather than assumed. */
const CANVAS = { w: 64, h: 64 };

/** Folders that are not parts. See the note on `extra/` above. */
const SKIP_DIRS = new Set(['extra']);

/**
 * Loose files the artist left behind, by the shape of the name.
 *
 * Photoshop's default export names, and one typo (`ellflong4`) that would
 * otherwise arrive as a fifth skin tone for the long elf ears.
 */
const JUNK = /^(layer \d|bg$|ellflong)/i;

type Suffix = 'C' | 'L' | 'M' | 'O' | 'N' | '1' | '2' | '3' | '4';

/** `bobC` -> `['bob', 'C']`. A name with no known suffix is not a sprite. */
function split(base: string): [string, Suffix] | null {
  const match = /^(.*?)([CLMON1234])$/.exec(base);
  if (!match || match[1] === '') return null;
  return [match[1], match[2] as Suffix];
}

interface Found {
  category: string;
  part: string;
  suffix: Suffix;
  file: string;
}

async function walk(dir: string, trail: string[] = []): Promise<Found[]> {
  const out: Found[] = [];
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name);
    if ((await stat(full)).isDirectory()) {
      if (trail.length === 0 && SKIP_DIRS.has(name)) continue;
      if (name.endsWith(' Copy')) continue;
      out.push(...(await walk(full, [...trail, name])));
      continue;
    }
    if (!name.endsWith('.png')) continue;
    const base = name.slice(0, -4);
    if (JUNK.test(base)) continue;
    const parts = split(base);
    if (!parts) {
      console.warn(`  skipped, no suffix: ${[...trail, name].join('/')}`);
      continue;
    }
    const [stem, suffix] = parts;
    // `bangs/edgeworth/braid/braidL.png` is a variant nested one deeper. The
    // part is the trail below the category, joined, so it stays addressable
    // and cannot collide with the plain `bangs/braid`.
    const category = trail[0];
    let part = trail.length > 1 ? trail.slice(1).join('-') : stem;
    let tagged: Suffix = suffix;
    if (category === 'body') {
      // `body/1..4` look like four parts and are four *skin tones* of one
      // body: `2/2C.png` is the same figure painted in the second ramp, and
      // all four `L` files are the same bytes. Filed as one part with the
      // numbered suffix every other skin coloured sprite uses, so that the
      // skin picker moves one thing and the renderer keeps its three rules.
      tagged = suffix === 'C' ? (trail[1] as Suffix) : suffix;
      part = 'body';
    }
    out.push({ category, part, suffix: tagged, file: full });
  }
  return out;
}

/**
 * The four skin ramps, read out of the artist's swatch sheet.
 *
 * Read rather than transcribed, so the day somebody adds a fifth column the
 * set gains a skin tone by rerunning this. The sheet is four columns of
 * doubled pixels, each column a ramp running light to dark down the rows, with
 * two more rows underneath holding the eye white and the shadow it takes.
 */
async function skinRamps(): Promise<{ skin: string[][]; sclera: string[] }> {
  const file = path.join(SRC, 'extra', 'skincolors.png');
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    if (data[i + 3] === 0) return null;
    return `#${[data[i], data[i + 1], data[i + 2]].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  };
  // Four columns, at x = 50, 53, 56, 59. Each swatch is drawn two pixels
  // wide and two tall, so the rows are deduplicated rather than counted.
  const columns = [50, 53, 56, 59];
  const rows: (string | null)[][] = [];
  for (let y = 0; y < info.height; y++) {
    const row = columns.map((x) => at(x, y));
    if (row.every((hex) => hex === null)) continue;
    const last = rows[rows.length - 1];
    if (last && last.every((hex, i) => hex === row[i])) continue;
    rows.push(row);
  }
  if (rows.length !== 5 || rows.some((row) => row.some((hex) => hex === null))) {
    throw new Error(`skincolors.png: expected 5 full rows, got ${rows.length}`);
  }
  // The first four rows are the ramp, light to dark, one column per tone. The
  // fifth is not skin at all: it is the eye white, and it runs *along* the row
  // rather than down it, so a darker skin gets a warmer sclera.
  const skin = columns.map((_, x) => rows.slice(0, 4).map((row) => row[x] as string));
  const sclera = rows[4].map((hex) => hex as string);
  return { skin, sclera };
}

async function main() {
  const found = await walk(SRC);
  const png = path.join(OUT, 'png');
  await rm(png, { recursive: true, force: true });
  await mkdir(png, { recursive: true });

  const table: Record<string, { file: string; x: number; y: number; w: number; h: number }> = {};
  let dropped = 0;
  let remapped = 0;

  const { skin, sclera } = await skinRamps();
  const tone1 = new Set(skin[0].map((hex) => hex.toLowerCase()));

  // The artist's own numbered exports, claimed up front so that a remap can
  // never overwrite a tone somebody drew by hand.
  const drawnByHand = new Set(
    found.filter((item) => /^[1-4]$/.test(item.suffix)).map((item) => keyOf(item)),
  );

  for (const item of found.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    const { data, info } = await sharp(item.file)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== CANVAS.w || info.height !== CANVAS.h) {
      throw new Error(`${item.file}: ${info.width}x${info.height}, expected 64x64`);
    }

    const box = inkBox(data, info.width, info.height);
    if (!box) {
      dropped++;
      continue;
    }

    const write = async (suffix: string, pixels: Buffer) => {
      const name = `${item.category}-${item.part}-${suffix}.png`.toLowerCase();
      await sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } })
        .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
        .png()
        .toFile(path.join(png, name));
      table[keyOf({ ...item, suffix })] = { file: name, ...box };
    };

    const palette = colours(data);
    const skinned = palette.size > 0 && [...palette].every((hex) => tone1.has(hex));
    if (skinned && !/^[1-4]$/.test(item.suffix)) {
      let wrote = 0;
      for (let tone = 0; tone < skin.length; tone++) {
        if (drawnByHand.has(keyOf({ ...item, suffix: String(tone + 1) }))) continue;
        await write(String(tone + 1), remap(data, skin[0], skin[tone]));
        wrote++;
      }
      remapped += wrote;
      if (wrote === 0) dropped++;
      continue;
    }

    await write(item.suffix, Buffer.from(data));
  }

  const body = [
    '// GENERATED by scripts/extract-kit.ts. Do not edit: rerun it.',
    "import type { LayerTable } from '../../layered.js';",
    '',
    'export const KIT_LAYERS: LayerTable = {',
    `  canvas: { w: ${CANVAS.w}, h: ${CANVAS.h} },`,
    '  layers: {',
    ...Object.entries(table).map(
      ([key, place]) =>
        `    ${JSON.stringify(key)}: ${JSON.stringify(place).replace(/","/g, '", "')},`,
    ),
    '  },',
    '};',
    '',
    '/**',
    " * The four skin ramps, exactly as the artist drew them in skincolors.png.",
    ' *',
    ' * Four steps each, light to dark. Skin is the one colour in this set chosen',
    ' * from a list rather than tinted, and that is not a shortcut: the numbered',
    ' * sprites are baked against these ramps, so a free picker would put a face',
    ' * next to a pair of ears that did not match it.',
    ' */',
    `export const KIT_SKIN: readonly (readonly string[])[] = ${JSON.stringify(skin)};`,
    '',
    '/**',
    ' * The eye white, at each skin tone.',
    ' *',
    " * The bottom row of the artist's swatch sheet, and it runs along the row",
    ' * rather than down it: a darker face gets a warmer sclera, which is the',
    ' * whole reason it was drawn apart from the ramps above it.',
    ' */',
    `export const KIT_SCLERA: readonly string[] = ${JSON.stringify(sclera)};`,
    '',
  ].join('\n');

  await writeFile(path.join(OUT, 'layers.ts'), body);

  const cats = new Map<string, Set<string>>();
  for (const key of Object.keys(table)) {
    const [category, part] = key.split('/');
    if (!cats.has(category)) cats.set(category, new Set());
    cats.get(category)!.add(part);
  }
  console.log(
    `\n${Object.keys(table).length} sprites, ${remapped} remapped to skin tones, ` +
      `${dropped} dropped, into ${png}`,
  );
  for (const [category, parts] of [...cats].sort()) {
    console.log(`  ${category.padEnd(10)} ${parts.size.toString().padStart(2)}  ${[...parts].join(' ')}`);
  }
}

function keyOf(item: { category: string; part: string; suffix: string }): string {
  return `${item.category}/${item.part}/${item.suffix}`;
}

/** Every opaque colour in a raw RGBA buffer, as lowercase hex. */
function colours(data: Buffer): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    out.add(`#${hex2(data[i])}${hex2(data[i + 1])}${hex2(data[i + 2])}`);
  }
  return out;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/**
 * One ramp swapped for another, pixel by pixel.
 *
 * Exact rather than nearest: a colour not in `from` is left alone, and this
 * only ever runs on a sprite already proven to contain nothing else. Which
 * works because the art is hard edged -- one anti-aliased pixel between two
 * ramp steps would land in neither and stay the old skin.
 */
function remap(data: Buffer, from: readonly string[], to: readonly string[]): Buffer {
  const map = new Map(from.map((hex, i) => [hex.toLowerCase(), to[i].toLowerCase()]));
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const swap = map.get(`#${hex2(out[i])}${hex2(out[i + 1])}${hex2(out[i + 2])}`);
    if (!swap) continue;
    out[i] = parseInt(swap.slice(1, 3), 16);
    out[i + 1] = parseInt(swap.slice(3, 5), 16);
    out[i + 2] = parseInt(swap.slice(5, 7), 16);
  }
  return out;
}

/** The bounding box of everything not fully transparent, or null if empty. */
function inkBox(data: Buffer, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

await main();
