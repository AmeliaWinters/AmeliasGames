/**
 * What is worth pinning about a wardrobe.
 *
 * Four things, and they are the four that would otherwise be found by
 * somebody's eye months later:
 *
 * - what a chest gives and what the floor grants, because an id in both lists
 *   would be a chest handing over something already owned;
 * - that a part from one set cannot be equipped into another, at compile time
 *   and at run time;
 * - z order, because a fringe behind a head is not obviously wrong in a diff;
 * - the bust crop, because a chip full of forehead is a shrug rather than a
 *   bug report.
 *
 * The looking is still the point and this cannot do it. `npm run
 * render:avatars` draws the contact sheet; see the note at the top of that
 * script and the CLAUDE.md section it quotes.
 */
import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cropRect, layerBox, stageStyle } from './Avatar.js';
import { fits, partsIn, SETS, STARTER_SET, setById, starterFor } from './manifest.js';
import { KIT } from './sets/kit/index.js';
import { KIT_LAYERS } from './sets/kit/layers.js';
import { MAKOWKA } from './sets/makowka/index.js';
import { SNAKE } from './sets/snake/index.js';
import { SUTEMO } from './sutemo.js';
import { partId, type AvatarSet, type Loadout } from './types.js';
import { ownsPart, ownsSet, ownsVariant, wardrobeOf } from './unlock.js';
import { floorOf, poolOf } from './wardrobeSplit.js';

describe('what a chest gives', () => {
  it('owns nothing before a chest has been opened', () => {
    const nothing = wardrobeOf(null);
    for (const set of SETS) {
      for (const part of set.parts) expect(ownsPart(set.id, part, nothing)).toBe(false);
    }
  });

  it('owns exactly what the list says and nothing near it', () => {
    // The whole model in one assertion: ownership is a lookup now, not a
    // comparison, so a part is owned when its id is in the list and never
    // because something adjacent to it is.
    const bob = SUTEMO.parts.find((part) => part.name === 'Bob')!;
    const other = SUTEMO.parts.find((part) => part.id !== bob.id)!;
    const owned = wardrobeOf([`sutemo:${bob.id}`]);
    expect(ownsPart('sutemo', bob, owned)).toBe(true);
    expect(ownsPart('sutemo', other, owned)).toBe(false);
  });

  it('prices a colour per slot rather than per part', () => {
    // Sutemo's five hair colours are one list shared by five cuts. Owning the
    // colour has to mean owning it on all of them, or one shade becomes five
    // separate drops pretending to be one. See `ownsVariant`.
    const hairs = partsIn(SUTEMO, 'hair');
    const shade = hairs[0].variants[1];
    const owned = wardrobeOf([`sutemo:#hair:${shade.id}`]);
    for (const cut of hairs) {
      const same = cut.variants.find((variant) => variant.id === shade.id)!;
      expect(ownsVariant('sutemo', 'hair', same, owned), `${cut.name} disagrees`).toBe(true);
    }
  });

  it('opens a set once anything in it is owned', () => {
    const later = SETS[1];
    expect(ownsSet(later.id, wardrobeOf([]))).toBe(false);
    // The floor is what a set's first chest hands over, so owning it is
    // exactly the moment the set becomes wearable.
    expect(ownsSet(later.id, wardrobeOf(floorOf(later)))).toBe(true);
  });

  it('never puts the same id in the floor and the pool', () => {
    // The whole no-duplicates promise rests on this: a chest draws from the
    // pool, and an id that is also granted for free would be a chest handing
    // over something already owned.
    for (const set of SETS) {
      const floor = new Set(floorOf(set));
      const clash = poolOf(set).filter((id) => floor.has(id));
      expect(clash, `${set.id} sells ${clash[0]}`).toEqual([]);
    }
  });

  it('gives every required slot two parts and every colour slot one', () => {
    for (const set of SETS) {
      const floor = new Set(floorOf(set));
      for (const spec of set.slots) {
        const parts = set.parts.filter((part) => part.slot === spec.id);
        if (parts.length === 0) continue;
        const free = parts.filter((part) => floor.has(`${set.id}:${part.id}`)).length;
        if (!spec.optional) {
          expect(free, `${set.id}/${spec.id} has ${free} free`).toBeGreaterThanOrEqual(
            Math.min(2, parts.length),
          );
        }
        // A part owned in no colour cannot be drawn, so a colour-bearing slot
        // always has one whether or not the slot itself is required.
        const colours = parts.flatMap((part) => part.variants);
        if (colours.length > 0) {
          expect(
            [...floor].some((id) => id.startsWith(`${set.id}:#${spec.id}:`)),
            `${set.id}/${spec.id} has no free colour`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('the starter avatar', () => {
  it('is complete and free in every set', () => {
    // A brand new player gets a whole character immediately. A starter with a
    // locked part in it, or a hole where the outfit goes, is the worst first
    // impression this feature can make.

    for (const set of SETS) {
      const loadout = starterFor(set);
      // Whatever the starter wears is in the floor by construction; this is
      // the assertion that keeps `wardrobeSplit.ts` honest about it.
      const owned = wardrobeOf(floorOf(set));
      for (const spec of set.slots) {
        if (spec.optional) continue;
        const chosen = loadout.parts[spec.id];
        expect(chosen, `${set.id} has no ${spec.id}`).toBeDefined();
        const part = set.parts.find((candidate) => candidate.id === chosen)!;
        expect(ownsPart(set.id, part, owned), `${set.id}/${part.name} is locked`).toBe(true);
        for (const variant of part.variants.slice(0, 1)) {
          expect(ownsVariant(set.id, spec.colourKey ?? spec.id, variant, owned)).toBe(true);
        }
      }
      // At least one: a set that composites internally hands back a single
      // picture, which is the case the `Drawn` contract exists to survive.
      expect(set.draw(loadout).layers.length).toBeGreaterThan(0);
    }
  });
});

describe('sets do not mix', () => {
  it('refuses a part from another set at run time', () => {
    const wrong: Loadout = {
      set: 'sutemo',
      parts: { hair: partId('sutemo', 'hair/short01') },
      variants: {},
    };
    expect(fits(SUTEMO, wrong)).toBe(false);
    expect(fits(SUTEMO, starterFor(SUTEMO))).toBe(true);
    expect(fits(KIT, starterFor(SUTEMO))).toBe(false);
  });

  it('refuses one at compile time', () => {
    const kitHair = partId('kit', 'hair/bob');
    const loadout: Loadout<'sutemo'> = { set: 'sutemo', parts: {}, variants: {} };
    // @ts-expect-error a Kit part may not be equipped into a Sutemo loadout
    loadout.parts.hair = kitHair;
    // The runtime value is a plain string; the brand is phantom. Asserting on
    // it keeps the line above from being deleted as dead code.
    expect(loadout.parts.hair).toBe('hair/bob');
  });
});

describe('the stack', () => {
  it('puts the hair back behind the body and the fringe in front of it', () => {
    const drawn = SUTEMO.draw(starterFor(SUTEMO));
    const keys = drawn.layers.map((layer) => layer.key);
    const back = keys.findIndex((key) => key.endsWith('/back'));
    const body = keys.indexOf('body/default');
    const outfit = keys.findIndex((key) => key.startsWith('outfit/'));
    const front = keys.findIndex((key) => key.endsWith('/front'));
    const face = keys.findIndex((key) => key.startsWith('face/'));
    // The whole reason this set was chosen: the body and the outfit go between
    // the two halves of the hair. Collapse them and it is a paper doll.
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(body);
    expect(body).toBeLessThan(outfit);
    expect(outfit).toBeLessThan(front);
    expect(front).toBeLessThan(face);
  });

  it('draws a background behind everything', () => {
    const loadout = starterFor(SUTEMO);
    loadout.parts.background = partId('sutemo', 'background/board');
    const drawn = SUTEMO.draw(loadout);
    expect(drawn.layers[0]).toMatchObject({ kind: 'fill', token: '--board' });
  });

  it('has art for every part in the manifest', () => {
    // A key builder with a typo in it produces an avatar that is silently
    // missing a layer, which is exactly the failure `drawLayered` swallows on
    // purpose so the lobby does not go blank. So it is caught here instead.
    for (const slot of SUTEMO.slots) {
      if (slot.id === 'background') continue;
      for (const part of partsIn(SUTEMO, slot.id)) {
        const loadout = starterFor(SUTEMO);
        loadout.parts[slot.id] = part.id;
        for (const variant of part.variants.length > 0 ? part.variants : [null]) {
          if (variant) loadout.variants[slot.id] = variant.id;
          const keys = SUTEMO.draw(loadout).layers.map((layer) => layer.key);
          expect(
            keys.some((key) => key.startsWith(`${part.id}/`) || key === part.id),
            `${part.id} ${variant?.id ?? ''} draws nothing`,
          ).toBe(true);
        }
      }
    }
  });

  /**
   * The Kit's stack, which is sixteen deep and the whole design of the set.
   *
   * Read as a list of "this is behind that", because that is how the mistakes
   * happen: every one of these was got wrong at least once on the way to the
   * contact sheet, and none of them is visible in a diff.
   */
  it('stacks the Kit the way a face is built', () => {
    const loadout = starterFor(KIT);
    loadout.parts.backhair = partId('kit', 'backhair/pony');
    loadout.parts.marks = partId('kit', 'marks/freckles');
    loadout.parts.outer = partId('kit', 'outer/hoodie');
    loadout.parts.accessory = partId('kit', 'accessory/glassRound');
    const keys = KIT.draw(loadout).layers.map((layer) => layer.key.split(' ')[0]);
    const at = (prefix: string) => {
      const found = keys.findIndex((key) => key.startsWith(prefix));
      expect(found, `nothing drawn for ${prefix}`).toBeGreaterThanOrEqual(0);
      return found;
    };

    // Hair goes behind the body and in front of it, with the clothes between:
    // the same property Sutemo was chosen for, and the reason this is a
    // layered set rather than a paper doll.
    expect(at('backhair/')).toBeLessThan(at('body/'));
    expect(at('body/')).toBeLessThan(at('inner/'));
    expect(at('inner/')).toBeLessThan(at('outer/'));
    expect(at('basehair/')).toBeGreaterThan(at('outer/'));
    expect(at('bangs/')).toBeGreaterThan(at('basehair/'));

    // Ears sit on the head and under the hair. Over it, they look glued on.
    expect(at('ears/')).toBeGreaterThan(at('body/'));
    expect(at('ears/')).toBeLessThan(at('basehair/'));

    // Marks are on skin, so the collar of a top covers the neck they run down.
    expect(at('misc/')).toBeLessThan(at('inner/'));

    // Glasses over everything, fringe included, because that is where glasses
    // are. This is the one slot allowed above the hair.
    expect(at('access/')).toBeGreaterThan(at('bangs/'));
  });

  it('builds an eye out of four layers in the one order that reads', () => {
    const loadout = starterFor(KIT);
    loadout.parts.eyes = partId('kit', 'eyes/big');
    const eye = KIT.draw(loadout)
      .layers.map((layer) => layer.key.split(' ')[0])
      .filter((key) => key.startsWith('eyes/big/'));
    // Iris, then the shadow the lid casts on it, then the lashes and pupil,
    // then the glint. Any other order is a button rather than an eye: the
    // iris over its own line art loses the pupil, and the glint under
    // anything at all is invisible.
    expect(eye).toEqual(['eyes/big/C', 'eyes/big/1', 'eyes/big/L', 'eyes/big/O']);
  });

  it('paints one head of hair in one colour across three depths', () => {
    // Three slots, one colour, and it is stored on `hair`. A fringe that could
    // disagree with the hair behind it is a bug generator, not a feature.
    const loadout = starterFor(KIT);
    loadout.parts.backhair = partId('kit', 'backhair/pony');
    loadout.variants.hair = '#c8455a';
    const tints = KIT.draw(loadout)
      .layers.filter(
        (layer) =>
          layer.kind === 'image' &&
          /^(backhair|basehair|bangs)\//.test(layer.key) &&
          layer.tint !== undefined,
      )
      .map((layer) => (layer.kind === 'image' ? layer.tint : undefined));
    expect(tints.length).toBeGreaterThanOrEqual(3);
    expect(new Set(tints)).toEqual(new Set(['#c8455a']));
  });

  it('draws every skin coloured piece in the tone the body was given', () => {
    // The trap this replaces: a nose that stayed tone one while the face went
    // to tone four. Every numbered sprite has to move together, and the
    // numbers are baked into the file names rather than into a tint.
    const loadout = starterFor(KIT);
    loadout.parts.ears = partId('kit', 'ears/human');
    loadout.parts.marks = partId('kit', 'marks/freckles');
    loadout.variants.body = '4';
    const numbered = KIT.draw(loadout)
      .layers.map((layer) => layer.key.split(' ')[0])
      .filter((key) => /\/[1-4]$/.test(key));
    expect(numbered.length).toBeGreaterThanOrEqual(4);
    for (const key of numbered) expect(key, `${key} is not tone 4`).toMatch(/\/4$/);
  });

  it('has art for every part the Kit offers, in every skin tone', () => {
    // The same promise as the Sutemo test above and for the same reason, but
    // it has to be spelled differently: the Kit's folders are the artist's
    // names for things (`inner`, `misc`, `bg`) and the slots are the app's
    // names for them, so a part is found by its tail rather than by its id.
    for (const spec of KIT.slots) {
      for (const part of partsIn(KIT, spec.id)) {
        const tail = part.id.slice(part.id.indexOf('/') + 1);
        for (const tone of ['1', '2', '3', '4']) {
          const loadout = starterFor(KIT);
          loadout.parts[spec.id] = part.id;
          loadout.variants.body = tone;
          const keys = KIT.draw(loadout).layers.map((layer) => layer.key.split(' ')[0]);
          expect(
            keys.some((key) => key.split('/')[1] === tail),
            `${part.id} draws nothing at skin ${tone}`,
          ).toBe(true);
        }
      }
    }
  });
});

/**
 * The pixel of daylight between a hair and its outline.
 *
 * Shipped once, and invisible in a diff: the two sprites of a part are trimmed
 * to different boxes on purpose, so at 240px on a 64 unit canvas -- 3.75 px a
 * unit -- their fractional lefts differ, `image-rendering: pixelated` snaps
 * each image's own grid, and the line sits a pixel off the fill. Exact at 256
 * and wrong nearly everywhere else, which is why it read as a scaling bug.
 *
 * What this pins is the property that kills it: whatever the size, two layers
 * that share a canvas edge share a drawn edge. Sizes chosen to be nasty --
 * 240 is the customiser's figure, 44 the thumbnail, 26 the account chip, and
 * 3 is a scale below one pixel a unit.
 */
/**
 * The two Picrew sets, which are generated and therefore need pinning most.
 *
 * Nobody reads `data.ts`. It is forty kilobytes of boxes written by
 * `extract-picrew.ts`, and the three things below are the three that would go
 * wrong in a rerun without anybody noticing until they were shipped.
 */
describe('the Picrew sets', () => {
  // Widened deliberately. Left as a tuple, TypeScript intersects the two
  // `Loadout<S>` parameters and lands on `never`, which is the brand in
  // `types.ts` doing exactly its job: the sets do not mix. Here we want the
  // loop, so this is the one place that says so out loud.
  const PICREW: AvatarSet[] = [SNAKE as AvatarSet, MAKOWKA as AvatarSet];

  /**
   * The licence condition, as a test.
   *
   * Both makers permit this on the condition their mark is visible. That is
   * not a comment in `PROVENANCE.md`, it is a property of every avatar the app
   * can draw, so it is asserted against a loadout wearing nothing at all --
   * the state a broken or outdated stored loadout falls to.
   */
  it("draws the artist's signature whatever is worn", () => {
    for (const set of PICREW) {
      const bare: Loadout = { set: set.id, parts: {}, variants: {} };
      for (const loadout of [starterFor(set), bare]) {
        const keys = set.draw(loadout).layers.map((layer) => layer.key);
        expect(
          keys.filter((key) => key.startsWith('sig')).length,
          `${set.id} lost its signature`,
        ).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Twelve shades a menu, and the ids still point at the art.
   *
   * The cap is a phone decision -- eighteen near neighbours in a strip is not
   * a choice -- but the half worth pinning is the other one: a variant id is a
   * filename, so trimming the list may not renumber what is left. Both halves
   * here, because a renumber would pass every other test in this file and draw
   * somebody else's hair.
   */
  it('offers at most twelve shades a menu, without renumbering them', () => {
    for (const set of PICREW) {
      for (const part of set.parts) {
        expect(part.variants.length, `${set.id} ${part.slot} offers too many shades`)
          .toBeLessThanOrEqual(12);
        for (const variant of part.variants) {
          expect(variant.name, `${set.id} ${part.slot} renumbered its shades`)
            .toBe(`Shade ${Number(variant.id) + 1}`);
        }
      }
    }
  });

  /** The set card is the maker's own cover art, and it has to resolve. */
  it('has cover art for both makers', () => {
    for (const set of PICREW) {
      expect(set.thumb, `${set.id} has no cover`).toBeTruthy();
      expect(existsSync(new URL(`./sets/${set.thumb}`, import.meta.url))).toBe(true);
    }
  });

  /**
   * Every part, in every shade, has a file behind it.
   *
   * The same check the Sutemo set gets, and it matters more here: the key is
   * assembled from a tag, an index and a colour index, so an off-by-one in the
   * generator produces an avatar missing exactly one layer, which `drawLayered`
   * swallows on purpose. Six thousand keys, and it runs in well under a second
   * because nothing is decoded.
   */
  it('has art for every part in every shade', () => {
    for (const set of PICREW) {
      for (const slot of set.slots) {
        for (const part of partsIn(set, slot.id)) {
          const loadout = starterFor(set);
          loadout.parts[slot.id] = part.id;
          const colour = slot.colourKey ?? slot.id;
          for (const variant of part.variants.length > 0 ? part.variants : [null]) {
            if (variant) loadout.variants[colour] = variant.id;
            const tail = part.id.slice(part.id.indexOf('/') + 1);
            const keys = set.draw(loadout).layers.map((layer) => layer.key);
            expect(
              keys.some((key) => key.startsWith(`${tail.split('-')[0]}/${tail.split('-')[1]}/`)),
              `${set.id} ${part.id} ${variant?.id ?? ''} draws nothing`,
            ).toBe(true);
          }
        }
      }
    }
  });

  /**
   * One skin, across the three menus that draw skin.
   *
   * makowka files the head, the face and the ears as separate required tabs
   * sharing one palette. They read `body` through `colourKey`, and the bug this
   * catches is the obvious one: a shade written against the tab it was picked
   * on gives a face one step lighter than the neck under it, which reads as a
   * rendering fault rather than as a choice.
   */
  it('paints one face in one skin across three menus', () => {
    const loadout = starterFor(MAKOWKA);
    // Ears are optional here, so the starter is not wearing any and the tab
    // that reads `body` most easily by accident would go untested.
    loadout.parts.ears = partsIn(MAKOWKA, 'ears')[0].id;
    loadout.variants.body = '7';
    const files = MAKOWKA.draw(loadout)
      .layers.filter((layer) => layer.kind === 'image')
      .map((layer) => (layer.kind === 'image' ? layer.file : ''));
    for (const tag of ['body', 'face', 'ears']) {
      const drawn = files.filter((file) => file.includes(`/${tag}-`));
      expect(drawn.length, `nothing drawn for ${tag}`).toBeGreaterThan(0);
      for (const file of drawn) expect(file, `${file} is not shade 7`).toMatch(/-7\.webp$/);
    }
  });
});

describe('layers on one grid', () => {
  const px = (v: string) => Number(v.replace('px', ''));

  it('gives two layers that share a canvas edge the same drawn edge', () => {
    const canvas = KIT_LAYERS.canvas;
    for (const size of [240, 256, 44, 26, 100, 3]) {
      for (const dpr of [1, 1.5, 2, 3]) {
        const box = (rect: { x: number; y: number; w: number; h: number }) =>
          layerBox(rect, { w: size, h: size }, canvas, dpr);
        for (let unit = 1; unit <= canvas.w; unit++) {
          // The same canvas edge reached two ways: as one layer's left, and as
          // the right edge of a layer that starts somewhere else. The second
          // origin is what makes this bite -- from x = 0 every scheme agrees,
          // including rounding the width, which is the wrong one.
          const asLeft = px(box({ x: unit, y: unit, w: 1, h: 1 }).left);
          for (const origin of [0, 1, 3, 7]) {
            if (origin >= unit) continue;
            const from = box({ x: origin, y: origin, w: unit - origin, h: unit - origin });
            const asRight = px(from.left) + px(from.width);
            expect(asRight, `unit ${unit} from ${origin} at ${size}px, dpr ${dpr}`).toBeCloseTo(
              asLeft,
              6,
            );
          }
        }
      }
    }
  });

  it('lands every edge on a whole device pixel', () => {
    const canvas = KIT_LAYERS.canvas;
    for (const dpr of [1, 1.5, 2, 3]) {
      const box = layerBox(KIT_LAYERS.layers['basehair/bob/L'], { w: 240, h: 240 }, canvas, dpr);
      for (const side of [box.left, box.top, box.width, box.height]) {
        expect(Math.abs(px(side) * dpr - Math.round(px(side) * dpr))).toBeLessThan(1e-6);
      }
    }
  });

  it('keeps a layer within a pixel of the size the art asks for', () => {
    // The snapping may move an edge, but not by enough to be a resize: a mask
    // that came out a unit narrow than its line art would be the same bug
    // wearing a different hat.
    const canvas = KIT_LAYERS.canvas;
    const scale = 240 / canvas.w;
    for (const key of ['basehair/bob/C', 'basehair/bob/L', 'access/drope/C']) {
      const rect = KIT_LAYERS.layers[key];
      const box = layerBox(rect, { w: 240, h: 240 }, canvas, 2);
      expect(Math.abs(px(box.width) - rect.w * scale)).toBeLessThanOrEqual(1);
      expect(Math.abs(px(box.height) - rect.h * scale)).toBeLessThanOrEqual(1);
    }
  });
});

describe('the bust crop', () => {
  it('scales the canvas so the crop fills the frame', () => {
    // A 1000 wide canvas cropped to the middle 500 has to be drawn at 200% and
    // pushed half a frame left. Both halves matter: get the offset right and
    // the size wrong and the head is the correct size in the wrong place.
    const style = stageStyle({ w: 1000, h: 1000 }, { x: 250, y: 100, w: 500, h: 500 });
    expect(style).toEqual({ width: '200%', height: '200%', left: '-50%', top: '-20%' });
  });

  it('is the whole canvas at the full crop', () => {
    for (const set of SETS) {
      expect(cropRect(set, 'full')).toEqual({ x: 0, y: 0, ...set.canvas });
      expect(stageStyle(set.canvas, cropRect(set, 'full'))).toEqual({
        width: '100%',
        height: '100%',
        left: '0%',
        top: '0%',
      });
    }
  });

  it('keeps every bust square and inside its canvas', () => {
    for (const set of SETS) {
      const { x, y, w, h } = set.bust;
      // Square, because both places that draw it are circles or rounded
      // squares, and a rectangle in a circle crops twice.
      expect(w, `${set.id} bust is not square`).toBe(h);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(set.canvas.w);
      expect(y + h).toBeLessThanOrEqual(set.canvas.h);
    }
  });
});

describe('the manifest', () => {
  it('finds every set by its own id', () => {
    for (const set of SETS) expect(setById(set.id)).toBe(set);
    expect(setById('nothing')).toBeUndefined();
  });

  it('starts somebody in the set a new account is given', () => {
    // There is no set-level threshold any more, so the starter set is simply
    // the first one, and `STARTER_SET` is what a new profile is handed.
    expect(SETS[0]).toBe(STARTER_SET);
  });

  it('has no two parts sharing an id inside one set', () => {
    for (const set of SETS) {
      const ids = set.parts.map((part) => part.id);
      expect(new Set(ids).size, `${set.id} has a duplicate part id`).toBe(ids.length);
    }
  });

  it('lists a part for every slot it declares', () => {
    for (const set of SETS) {
      for (const spec of set.slots) {
        expect(partsIn(set, spec.id).length, `${set.id} declares ${spec.id} and has none`)
          .toBeGreaterThan(0);
      }
    }
  });
});
