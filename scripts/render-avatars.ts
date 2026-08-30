/**
 * Draw a wardrobe to a PNG, because it cannot be looked at anywhere else.
 *
 * The same bargain as `render:throw`. The in-app browser pane is a hidden
 * document and will not composite frames, so the only way to *see* an avatar
 * is to composite it in Node and open the file. See "Verifying visual work" in
 * CLAUDE.md.
 *
 *   npm run render:avatars
 *
 * It goes through `SETS` and `AvatarSet.draw` rather than reading the art
 * directly, which is the point: whatever this draws is exactly what the app
 * draws, including the z order and the bust crop. A layer the renderer forgets
 * is missing here too.
 *
 * Two things it has to do that the browser does for free. It decodes PNGs
 * (`readPNG` in `png.mjs`), and it multiplies the Character Kit's masks by the
 * colours somebody picked, which in the browser is an SVG filter on the `<img>`
 * and here is `multiplyRgba`. Both go through the arithmetic in `tint.ts`, so
 * what this draws is what the app draws; `tint.test.ts` pins the two together.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import sharp from 'sharp';

import { Raster, readPNG, rgba } from './png.mjs';

import { SETS } from '../src/client/avatar/manifest.js';
import { multiplyRgba } from '../src/client/avatar/tint.js';
import type { AvatarSet, Drawn, Loadout, Rect, Slot } from '../src/client/avatar/types.js';

const ART = new URL('../src/client/avatar/sets/', import.meta.url);

/** The two palettes, as the tokens a `fill` layer can name. */
const PALETTES = {
  stage: {
    ground: '#0c0c0f',
    board: '#1e1e24',
    surface: '#16161b',
    rule: '#2b2b33',
    'seat-0': '#ff5a47',
    'seat-1': '#21c7f0',
    'seat-2': '#8fde4c',
    'seat-3': '#ffc24b',
  },
  daylight: {
    ground: '#f2f1ec',
    board: '#e4e2da',
    surface: '#ffffff',
    rule: '#d8d6cd',
    'seat-0': '#cf3a24',
    'seat-1': '#0a7d9e',
    'seat-2': '#44861a',
    'seat-3': '#9a6a00',
  },
} as const;

type PaletteName = keyof typeof PALETTES;

const cache = new Map<string, Raster>();

/**
 * One sprite, tinted if the layer asked for it, decoded at most once.
 *
 * Keyed by file *and* colour, because the same hair mask is drawn in several
 * colours on one sheet and the multiply is destructive. Caching by file alone
 * painted the second avatar's hair with the first avatar's colour, which is
 * the sort of bug a contact sheet is for.
 */
async function image(file: string, tint?: string): Promise<Raster> {
  const key = tint ? `${file} ${tint}` : file;
  const got = cache.get(key);
  if (got) return got;
  const source = file.endsWith('.webp')
    ? await readWebP(new URL(file, ART))
    : (readPNG(await readFile(new URL(file, ART))) as Raster);
  let raster = source;
  if (tint) {
    raster = new Raster(source.width, source.height);
    raster.data.set(source.data);
    multiplyRgba(raster.data, tint);
  }
  cache.set(key, raster);
  return raster;
}

/**
 * One WebP, decoded to the same raster `png.mjs` hands back.
 *
 * `png.mjs` is hand rolled and PNG only, and it stays that way: it exists so
 * the dice and wheel sheets can be drawn with no dependency at all. The two
 * Picrew sets ship WebP for size, which is a decoder nobody is going to write
 * by hand, so this one case borrows sharp -- which is already a dev dependency
 * because `extract-picrew.ts` wrote the files with it.
 */
async function readWebP(url: URL): Promise<Raster> {
  const { data, info } = await sharp(await readFile(url))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raster = new Raster(info.width, info.height);
  raster.data.set(data);
  return raster;
}

/** Source-over one raster onto another, nearest neighbour, at a scale. */
function blit(src: Raster, from: Rect, dest: Raster, to: Rect): void {
  for (let y = 0; y < to.h; y++) {
    const sy = Math.floor(from.y + ((y + 0.5) / to.h) * from.h);
    if (sy < 0 || sy >= src.height) continue;
    for (let x = 0; x < to.w; x++) {
      const sx = Math.floor(from.x + ((x + 0.5) / to.w) * from.w);
      if (sx < 0 || sx >= src.width) continue;
      const si = (sy * src.width + sx) * 4;
      const alpha = src.data[si + 3] / 255;
      if (alpha <= 0) continue;
      const dx = Math.round(to.x) + x;
      const dy = Math.round(to.y) + y;
      if (dx < 0 || dy < 0 || dx >= dest.width || dy >= dest.height) continue;
      const di = (dy * dest.width + dx) * 4;
      const under = dest.data[di + 3] / 255;
      const out = alpha + under * (1 - alpha);
      for (let c = 0; c < 3; c++) {
        dest.data[di + c] = Math.round(
          (src.data[si + c] * alpha + dest.data[di + c] * under * (1 - alpha)) / out,
        );
      }
      dest.data[di + 3] = Math.round(out * 255);
    }
  }
}

/** One avatar, at `scale` device pixels per canvas unit. */
async function composite(
  set: AvatarSet,
  loadout: Loadout,
  scale: number,
  palette: PaletteName,
): Promise<Raster> {
  const drawn: Drawn = set.draw(loadout);
  const sheet = new Raster(Math.round(drawn.canvas.w * scale), Math.round(drawn.canvas.h * scale));
  for (const layer of drawn.layers) {
    if (layer.kind === 'fill') {
      const token = layer.token.replace(/^--/, '') as keyof (typeof PALETTES)['stage'];
      sheet.fill(rgba(PALETTES[palette][token] ?? '#000000'));
    } else {
      const art = await image(layer.file, layer.tint);
      blit(
        art,
        { x: 0, y: 0, w: art.width, h: art.height },
        sheet,
        {
          x: Math.round(layer.x * scale),
          y: Math.round(layer.y * scale),
          w: Math.round(layer.w * scale),
          h: Math.round(layer.h * scale),
        },
      );
    }
  }
  return sheet;
}

/**
 * A page of avatars in one palette.
 *
 * Every row is one loadout: the full figure as the customiser draws it, then
 * the bust crop as the account chip draws it, at the two sizes those two
 * places actually use. Both are cut from the same composite, so a bust that
 * looks wrong here is a `set.bust` that is wrong in the app.
 */
async function sheetFor(palette: PaletteName, samples: Sample[]): Promise<Raster> {
  const CELL = 260;
  const PAD = 16;
  const BUST = 88;
  const CHIP = 26;
  const columns = 4;
  const rows = Math.ceil(samples.length / columns);
  const cellW = CELL + BUST + PAD * 3;
  const cellH = CELL + PAD * 2;

  const page = new Raster(cellW * columns, cellH * rows);
  page.fill(rgba(PALETTES[palette].ground));

  for (const [index, sample] of samples.entries()) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const left = col * cellW + PAD;
    const top = row * cellH + PAD;

    // The card the figure stands on, so the art is judged against the surface
    // it will really sit on rather than against the page.
    page.rect(left - 8, top - 8, CELL + BUST + PAD + 16, CELL + 16, rgba(PALETTES[palette].surface));

    const set = sample.set;
    const scale = CELL / set.canvas.h;
    const full = await composite(set, sample.loadout, Math.max(scale, 1), palette);
    blit(
      full,
      { x: 0, y: 0, w: full.width, h: full.height },
      page,
      { x: left + (CELL - CELL * (set.canvas.w / set.canvas.h)) / 2, y: top, w: Math.round(CELL * (set.canvas.w / set.canvas.h)), h: CELL },
    );

    // The bust, twice: the size the profile header draws it and the 26px the
    // account chip draws it. The small one is the one that decides whether the
    // crop works, and it is the one nobody looks at.
    const crop = set.bust;
    const pixels = full.width / set.canvas.w;
    const from = {
      x: crop.x * pixels,
      y: crop.y * pixels,
      w: crop.w * pixels,
      h: crop.h * pixels,
    };
    blit(full, from, page, { x: left + CELL + PAD, y: top, w: BUST, h: BUST });
    blit(full, from, page, { x: left + CELL + PAD, y: top + BUST + PAD, w: CHIP, h: CHIP });
  }
  return page;
}

interface Sample {
  set: AvatarSet;
  loadout: Loadout;
}

/**
 * The range worth looking at.
 *
 * The starter first, because it is the one avatar most people will ever see,
 * then a spread that puts every kind of part on at least once: the widest hair
 * over the bulkiest outfit, glasses under a fringe, the two styles that share
 * a hair back, and one of everything at once. Then the same for the next set.
 */
const SWATCHES = [
  '#6b4636',
  '#c8455a',
  '#3f6ea8',
  '#e8c15a',
  '#4f8a63',
  '#8a5fa8',
  '#2c2f3a',
  '#d98a4f',
];

function samples(): Sample[] {
  const out: Sample[] = [];
  for (const set of SETS) {
    out.push({ set, loadout: { ...set.starter } as Loadout });
    const bySlot = new Map<Slot, string[]>();
    for (const part of set.parts) {
      bySlot.set(part.slot, [...(bySlot.get(part.slot) ?? []), part.id]);
    }
    // Seeded walk rather than random, so two runs are comparable and a change
    // to the art shows up as a difference in the picture rather than as noise.
    for (let n = 1; n <= 7; n++) {
      const loadout: Loadout = { set: set.id, parts: {}, variants: {} };
      for (const slot of set.slots) {
        const options = bySlot.get(slot.id) ?? [];
        if (options.length === 0) continue;
        if (slot.optional && n % 3 === 0) continue;
        loadout.parts[slot.id] = options[(n * 3 + slot.id.length * 5) % options.length] as never;
      }
      // A colour per slot that takes one, walked the same seeded way. A set
      // whose colours are a picker has no variants to cycle, and a sheet of
      // seven identically brown haired characters would hide exactly the bug
      // this script exists to catch.
      for (const slot of set.slots) {
        const part = set.parts.find((candidate) => candidate.id === loadout.parts[slot.id]);
        if (slot.colour === 'palette' && part && part.variants.length > 0) {
          loadout.variants[slot.id] = part.variants[n % part.variants.length].id;
        } else if (slot.colour === 'free') {
          loadout.variants[slot.id] = SWATCHES[(n * 3 + slot.id.length) % SWATCHES.length];
        }
      }
      const hair = set.parts.find((part) => part.id === loadout.parts.hair);
      if (hair && hair.variants.length > 0) {
        loadout.variants.hair = hair.variants[n % hair.variants.length].id;
      }
      out.push({ set, loadout });
    }
  }
  return out;
}

async function main(): Promise<void> {
  await mkdir(new URL('../preview/', import.meta.url), { recursive: true });
  const list = samples();
  for (const palette of Object.keys(PALETTES) as PaletteName[]) {
    const page = await sheetFor(palette, list);
    const file = new URL(`../preview/avatars-${palette}.png`, import.meta.url);
    await writeFile(file, page.toPNG());
    console.log(`preview/avatars-${palette}.png  ${page.width}x${page.height}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
