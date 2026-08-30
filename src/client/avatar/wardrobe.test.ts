/**
 * That the server's copy of the pool still matches the art.
 *
 * `src/shared/wardrobe.ts` is generated, because the roll happens on the
 * server and six thousand image files cannot go there. Generated files rot:
 * somebody adds a set, or re-runs an extract script with a shorter keep list,
 * and the ids the Durable Object rolls from quietly describe last week's
 * wardrobe. The failure mode is not a crash, it is a chest handing over an id
 * the customiser cannot draw, which is exactly the kind of thing that gets
 * noticed by a player rather than by a diff.
 *
 * So this runs the same two functions the generator does and holds the answers
 * against the file it wrote. Same bargain as `bundle.test.ts`, which exists
 * because eighty thousand lines of dictionary once tried to walk into a phone.
 *
 * When it fails: `npm run build:wardrobe`.
 */
import { describe, expect, it } from 'vitest';

import { WARDROBE } from '../../shared/wardrobe.js';
import { SETS } from './manifest.js';
import { floorOf, poolOf } from './wardrobeSplit.js';

describe('the generated wardrobe', () => {
  it('names the same sets as the manifest, in the same order', () => {
    expect(WARDROBE.map((set) => set.id)).toEqual(SETS.map((set) => set.id));
  });

  it('holds the ids the art actually produces', () => {
    for (const set of SETS) {
      const generated = WARDROBE.find((candidate) => candidate.id === set.id);
      expect(generated, `${set.id} is missing from wardrobe.ts`).toBeDefined();
      expect(generated!.floor, `${set.id} floor is stale`).toEqual(floorOf(set));
      expect(generated!.pool, `${set.id} pool is stale`).toEqual(poolOf(set));
    }
  });

  it('can draw everything a chest might hand over', () => {
    // A drop the customiser cannot resolve is a present that renders as
    // "Something new". Every part id in every pool has to come back.
    for (const set of SETS) {
      const generated = WARDROBE.find((candidate) => candidate.id === set.id)!;
      const parts = new Set(set.parts.map((part) => part.id));
      for (const id of generated.pool) {
        const bare = id.slice(set.id.length + 1);
        if (bare.startsWith('#')) {
          const [slot, variant] = bare.slice(1).split(':');
          const known = set.parts.some(
            (part) => part.slot === slot && part.variants.some((v) => v.id === variant),
          );
          expect(known, `${set.id} sells colour ${bare} nothing has`).toBe(true);
        } else {
          expect(parts.has(bare as never), `${set.id} sells ${bare} which is not a part`).toBe(true);
        }
      }
    }
  });
});
