/**
 * snakeinajar's OC maker: twenty-four menus of painted art.
 *
 * The third set, and the first that is not the app's own art in any sense --
 * it is somebody's Picrew, exported, curated down and re-served. Everything
 * mechanical about it is generated into `data.ts` by
 * `scripts/extract-picrew.ts`; this file is what the set says about itself,
 * and it is deliberately the only hand written part. See `picrew.ts` for why
 * these two sets share an adapter and why colour here is a list rather than a
 * picker.
 *
 * **Licensed for personal, non-commercial use with the artist's mark
 * visible.** The frame category is drawn as `base` and cannot be removed for
 * exactly that reason. `sets/PROVENANCE.md` has the terms and the links.
 *
 * The tab order is the order somebody builds a face -- shape, then the
 * features in the order they are noticed, then hair, then clothes, then the
 * flourishes -- and it is not the draw order. What sits behind what is the `z`
 * in `data.ts`, taken from the export, and is nobody's business but the
 * renderer's.
 */

import { picrewSet } from '../../picrew.js';
import type { AvatarSet } from '../../types.js';
import { SNAKE_DATA } from './data.js';

export const SNAKE: AvatarSet<'snake'> = picrewSet(SNAKE_DATA, {
  id: 'snake',
  name: 'OC Maker',
  artist: 'snakeinajar',
  credit: 'Art by snakeinajar, used with permission for personal use',
  blurb: 'Painted portraits, with a fringe for every mood.',
  // The second reward set, and pitched past the Kit's ladder rather than
  // beside it: this is three hundred parts of somebody else's work and it
  // should arrive as an event.
  // Chin to a little above the crown, wide enough for hair rather than for a
  // head: a bust crop measured on the skull clips a ponytail off at the ear.
  thumb: 'snake/png/thumb.png',
  bust: { x: 26, y: 6, w: 76, h: 76 },
  order: [
    'body',
    'eyes',
    'iris',
    'brows',
    'nose',
    'mouth',
    'ears',
    'bangs',
    'backhair',
    'hairacc',
    'hat',
    'outfit',
    'outer',
    'glasses',
    'earrings',
    'necklace',
    'piercings',
    'makeup',
    'blush',
    'marks',
    'tattoo',
    'horns',
    'wings',
    'background',
  ],
  // Without a fringe this set draws a bald head with a face on it, which reads
  // as a broken avatar rather than as a style choice.
  dressed: ['bangs', 'backhair', 'background'],
});
