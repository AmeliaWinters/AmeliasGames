/**
 * What a chest must never do.
 *
 * Four of the five tests here are about money rather than randomness, because
 * the expensive bugs in a gacha are all in the same place: charging twice,
 * charging for nothing, and charging for something already owned. The roll
 * itself is three lines and the seed makes it checkable.
 */
import { describe, expect, it } from 'vitest';

import { CHEST_COST, floorOwed, openChest, ownedIn, wardrobeSet } from './chest.js';
import { applyChest } from './players.js';
import { newProfile, spendable, type Profile } from './profile.js';
import { WARDROBE } from './wardrobe.js';

const NOW = 1_700_000_000_000;

/** A seeded generator, so a roll can be asserted rather than hoped for. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** An account with enough non-English experience for `chests` of them. */
function rich(chests: number): Profile {
  return { ...newProfile('acct', 'Amelia', NOW), xp: { en: 9_999, pl: 500, ja: 0 }, points: CHEST_COST * chests };
}

const KIT = wardrobeSet('kit')!;

describe('the pool', () => {
  it('never lists the same id twice, within a set or across them', () => {
    const seen = new Set<string>();
    for (const set of WARDROBE) {
      for (const id of [...set.floor, ...set.pool]) {
        expect(seen.has(id), `${id} appears twice`).toBe(false);
        seen.add(id);
      }
    }
  });

  it('stamps every id with its set', () => {
    // The bug this exists for: `PartId` carries its set in the type and not in
    // the string, so Sutemo's `hair/long` and the Kit's would be one entry in
    // a flat owned list. See `ownedId`.
    for (const set of WARDROBE) {
      for (const id of [...set.floor, ...set.pool]) {
        expect(id.startsWith(`${set.id}:`), `${id} is not stamped`).toBe(true);
      }
    }
  });
});

describe('opening one', () => {
  it('is a function of the seed and nothing else', () => {
    const owned = new Set<string>();
    expect(openChest(KIT, owned, seeded(7))).toBe(openChest(KIT, owned, seeded(7)));
  });

  it('never gives something already owned', () => {
    // Walked to exhaustion rather than sampled, because "usually new" is
    // exactly the bug a sampled test would pass over.
    const owned = new Set<string>();
    const rng = seeded(99);
    for (let i = 0; i < KIT.pool.length; i++) {
      const drop = openChest(KIT, owned, rng);
      expect(drop, `ran dry after ${i} of ${KIT.pool.length}`).not.toBeNull();
      expect(owned.has(drop!)).toBe(false);
      owned.add(drop!);
    }
    expect(openChest(KIT, owned, rng)).toBeNull();
    expect(owned.size).toBe(KIT.pool.length);
  });

  it('counts what is owned without counting the floor', () => {
    const floor = new Set(KIT.floor);
    expect(ownedIn(KIT, floor)).toBe(0);
    expect(floorOwed(KIT, floor)).toEqual([]);
    expect(floorOwed(KIT, new Set())).toEqual(KIT.floor);
  });
});

describe('paying for one', () => {
  it('hands over the whole floor on the first chest and none on the second', () => {
    const first = applyChest(rich(2), { set: 'kit', nonce: 'A1' }, seeded(3));
    expect(first.granted).toEqual(KIT.floor);
    expect(first.drop).not.toBeNull();

    const second = applyChest(first.profile, { set: 'kit', nonce: 'A2' }, seeded(4));
    expect(second.granted).toEqual([]);
  });

  it('charges once for a repeated nonce and returns the original drop', () => {
    // The whole reason `opens` stores the drop beside the nonce. A retry that
    // said "opened, but I forget what you got" is a lost item.
    const start = rich(2);
    const once = applyChest(start, { set: 'kit', nonce: 'SAME' }, seeded(5));
    const twice = applyChest(once.profile, { set: 'kit', nonce: 'SAME' }, seeded(6));

    expect(twice.repeat).toBe(true);
    expect(twice.drop).toBe(once.drop);
    // Identity, not equality: the adapters skip the write on `===`.
    expect(twice.profile).toBe(once.profile);
    expect(twice.profile.spent).toBe(CHEST_COST);
  });

  it('refuses when there is not enough, and charges nothing for refusing', () => {
    const poor = { ...newProfile('acct', 'Amelia', NOW), points: CHEST_COST - 1 };
    const result = applyChest(poor, { set: 'kit', nonce: 'B1' }, seeded(1));
    expect(result.refusal).toBe('too-poor');
    expect(result.profile).toBe(poor);
    expect(result.drop).toBeNull();
  });

  it('will not spend experience, in any language', () => {
    // The version 7 rule, and the inverse of the one it replaced. Experience
    // is a measurement and the purse is a currency; a hoard of either buys
    // nothing in the other. See `Profile.points`.
    const studious = { ...newProfile('acct', 'Amelia', NOW), xp: { en: 50_000, pl: 50_000, ja: 50_000 } };
    expect(spendable(studious)).toBe(0);
    expect(applyChest(studious, { set: 'kit', nonce: 'C1' }, seeded(1)).refusal).toBe('too-poor');
  });

  it('spends one pooled purse, whatever the points were earned playing', () => {
    // The purse claims nothing about any language, so nothing about where the
    // points came from can refuse a chest the balance plainly covers. See
    // `Profile.spent`.
    const both = { ...newProfile('acct', 'Amelia', NOW), points: 130 };
    expect(spendable(both)).toBe(130);
    expect(applyChest(both, { set: 'kit', nonce: 'D1' }, seeded(1)).refusal).toBeNull();
  });

  it('has one price and one purse, and charges the purse', () => {
    // What replaced the migration credits in version 6. There is no path that
    // opens a chest without the balance moving, which is the property the
    // screen's one-line rule depends on being true.
    const result = applyChest(rich(1), { set: 'kit', nonce: 'E1' }, seeded(1));
    expect(result.refusal).toBeNull();
    expect(result.profile.spent).toBe(CHEST_COST);
    expect(spendable(result.profile)).toBe(0);
  });

  it('refuses an unknown set rather than defaulting to one', () => {
    const result = applyChest(rich(1), { set: 'nothing', nonce: 'F1' }, seeded(1));
    expect(result.refusal).toBe('no-such-set');
    expect(result.profile.spent).toBe(0);
  });

  it('charges nothing for a set with nothing left in it', () => {
    // The cheapest bug to prevent and the most annoying one to hit: taking a
    // hundred experience on the last chest of a set and giving nothing back.
    const done = { ...rich(1), owned: [...KIT.floor, ...KIT.pool] };
    const result = applyChest(done, { set: 'kit', nonce: 'G1' }, seeded(1));
    expect(result.refusal).toBe('complete');
    expect(result.profile).toBe(done);
    expect(spendable(result.profile)).toBe(CHEST_COST);
  });

  it('keeps the nonce ring bounded', () => {
    let profile = rich(200);
    for (let i = 0; i < 40; i++) {
      profile = applyChest(profile, { set: 'kit', nonce: `N${i}` }, seeded(i)).profile;
    }
    expect(profile.opens.length).toBeLessThanOrEqual(20);
    // And the newest is the one kept, which is the half that matters: the
    // retry that needs recognising is always the most recent request.
    expect(profile.opens[profile.opens.length - 1].startsWith('N39 ')).toBe(true);
  });
});
