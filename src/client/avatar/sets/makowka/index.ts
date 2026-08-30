/**
 * makowka's character maker II: the widest wardrobe of the four.
 *
 * The fourth set and the second Picrew one, so the interesting thing about it
 * is how little there is here: twenty-five menus, sixty-eight hairstyles and
 * a hundred and twenty tops, and the whole of it is `data.ts` plus this. That
 * is the bar `types.ts` set for adding a set, and it is the reason `picrew.ts`
 * was worth writing rather than copying `snake/` and changing the ids.
 *
 * **Licensed for personal, non-commercial use, unedited, with the signature
 * visible.** The signature and the paper grain are drawn as `base` and cannot
 * be removed. `sets/PROVENANCE.md` has the terms and the links.
 *
 * The one shape difference from `snake/`: this maker draws the head and the
 * face as separate required menus that share the skin palette, so `face` is a
 * tab with `colourKey: 'body'` and changing skin on one moves both. Three
 * categories read that key -- head, face and ears -- and a picker per tab
 * would ship a two-tone face as the default result of touching two tabs.
 */

import { picrewSet } from '../../picrew.js';
import type { AvatarSet } from '../../types.js';
import { MAKOWKA_DATA } from './data.js';

export const MAKOWKA: AvatarSet<'makowka'> = picrewSet(MAKOWKA_DATA, {
  id: 'makowka',
  name: 'Character Maker',
  artist: 'makowka',
  credit: 'Art by makowka, used with permission for personal use',
  blurb: 'Soft line art, sixty-eight haircuts, and a beard if you want one.',
  thumb: 'makowka/png/thumb.png',
  bust: { x: 26, y: 6, w: 76, h: 76 },
  order: [
    'body',
    'face',
    'eyes',
    'brows',
    'nose',
    'mouth',
    'ears',
    'hair',
    'backhair',
    'hairacc',
    'hat',
    'beard',
    'outfit',
    'outer',
    'glasses',
    'earrings',
    'necklace',
    'piercings',
    'makeup',
    'blush',
    'marks',
    'scars',
    'tattoo',
    'horns',
    'background',
  ],
  dressed: ['hair', 'background'],
});
