/**
 * What a roll must never do.
 *
 * Same shape as `chest.test.ts` and for the same reason: the expensive bugs in
 * a gacha are about money, not randomness. Charging twice, charging for a
 * refusal, charging full price for a duplicate. The pull itself is three lines
 * and the seed makes it checkable.
 *
 * The one thing here that is not in the chest's suite is the showcase, which
 * is the only browser-writable state in the feature and therefore the only
 * place a hostile request has anything to aim at.
 */
import { describe, expect, it } from 'vitest';

import {
  DUPLICATE_REFUND,
  ROLL_COST,
  SHOWCASE_MAX,
  legalShowcase,
  roll,
  roster,
  waifuById,
} from './waifu.js';
import { applyRoll, applyShowcase } from './players.js';
import { RoomEngine } from './room.js';
import { migrate, newProfile, spendable, type Profile } from './profile.js';

const NOW = 1_700_000_000_000;

/** A seeded generator, so a pull can be asserted rather than hoped for. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

/** An account with enough non-English experience for `rolls` of them. */
function rich(rolls: number): Profile {
  return { ...newProfile('acct', 'Amelia', NOW), xp: { en: 9_999, pl: 500, ja: 0 }, points: ROLL_COST * rolls };
}

describe('the roster', () => {
  it('is there at all', () => {
    // The failure this catches is a build that shipped without the ingest
    // script having been run, which would otherwise present as every roll
    // refusing and nobody knowing why.
    expect(roster().length).toBeGreaterThan(20);
  });

  it('never lists the same id twice', () => {
    const seen = new Set<string>();
    for (const one of roster()) {
      expect(seen.has(one.id), `${one.id} appears twice`).toBe(false);
      seen.add(one.id);
    }
  });

  it('gives every character a name and a picture', () => {
    // A row missing either is a row the screen draws as a blank tile, which
    // reads as a broken roll rather than as a character nobody wrote down.
    for (const one of roster()) {
      expect(one.name.length, one.id).toBeGreaterThan(0);
      expect(one.image.startsWith('https://'), `${one.id}: ${one.image}`).toBe(true);
    }
  });

  it('is findable by id', () => {
    expect(waifuById(roster()[0].id)).toEqual(roster()[0]);
    expect(waifuById('anilist:nobody')).toBeUndefined();
  });
});

describe('one pull', () => {
  it('is a function of the seed and nothing else', () => {
    expect(roll(roster(), seeded(7))).toBe(roll(roster(), seeded(7)));
  });

  it('can reach both ends of the roster', () => {
    // The floored-versus-rounded bug: rounding would give the first and last
    // entries half the chance of everybody else. Checked at the boundaries
    // rather than by sampling, which is what makes it a proof.
    const pool = roster();
    expect(roll(pool, () => 0)).toBe(pool[0]);
    expect(roll(pool, () => 0.999_999_9)).toBe(pool[pool.length - 1]);
  });

  it('refuses an empty roster rather than throwing', () => {
    expect(roll([], seeded(1))).toBeNull();
  });
});

describe('paying for it', () => {
  it('costs a hundred and hands back a character', () => {
    const result = applyRoll(rich(1), { nonce: 'A1' }, seeded(3));
    expect(result.refusal).toBeNull();
    expect(result.pulled).not.toBeNull();
    expect(result.paid).toBe(ROLL_COST);
    expect(spendable(result.profile)).toBe(0);
    expect(result.profile.claimed).toEqual([result.pulled!.id]);
  });

  it('charges once for a retried nonce and returns the same character', () => {
    const start = rich(2);
    const once = applyRoll(start, { nonce: 'SAME' }, seeded(5));
    const twice = applyRoll(once.profile, { nonce: 'SAME' }, seeded(6));
    expect(twice.repeat).toBe(true);
    expect(twice.pulled?.id).toBe(once.pulled?.id);
    // The whole point: the second call must not spend, and must not claim
    // again. Both are checked, because a retry that claimed without charging
    // would still corrupt the collection.
    expect(twice.profile).toBe(once.profile);
    expect(spendable(twice.profile)).toBe(ROLL_COST);
  });

  it('does not answer a chest receipt as a roll', () => {
    // One `opens` ring holds both, and one client mints both nonces. Without
    // the tag on the receipt this would hand back a wardrobe id as a character.
    const withChest: Profile = { ...rich(1), opens: ['SAME kit:hair/long'] };
    const result = applyRoll(withChest, { nonce: 'SAME' }, seeded(2));
    expect(result.repeat).toBe(false);
    expect(result.pulled).not.toBeNull();
  });

  it('refuses a nonce carrying the separator', () => {
    // The receipt splits on a space, so a nonce with one in it splits into the
    // wrong halves and a later legitimate roll is answered from a fragment.
    const poor = rich(1);
    const result = applyRoll(poor, { nonce: 'A B' }, seeded(1));
    expect(result.refusal).toBe('empty');
    expect(result.profile).toBe(poor);
  });

  it('takes nothing from somebody who cannot afford it', () => {
    const poor = { ...newProfile('acct', 'Amelia', NOW), points: ROLL_COST - 1 };
    const result = applyRoll(poor, { nonce: 'B1' }, seeded(1));
    expect(result.refusal).toBe('too-poor');
    expect(result.paid).toBe(0);
    // The same object back, so the adapter skips the write.
    expect(result.profile).toBe(poor);
  });

  it('will not let experience pay for it, in any language', () => {
    // Version 7: experience measures a language and the purse is a currency.
    // A roll is bought with points, whatever the ledger says about Polish.
    const studious = { ...newProfile('acct', 'Amelia', NOW), xp: { en: 100_000, pl: 100_000, ja: 0 } };
    expect(applyRoll(studious, { nonce: 'C1' }, seeded(1)).refusal).toBe('too-poor');
  });

  it('charges less for somebody already in the collection', () => {
    const first = applyRoll(rich(3), { nonce: 'D1' }, seeded(9));
    // The same seed pulls the same character, which is what makes this a
    // duplicate rather than a hope.
    const again = applyRoll(first.profile, { nonce: 'D2' }, seeded(9));
    expect(again.pulled?.id).toBe(first.pulled?.id);
    expect(again.duplicate).toBe(true);
    expect(again.paid).toBe(ROLL_COST - DUPLICATE_REFUND);
    // Kept rather than dropped: the collection records how many times somebody
    // pulled the one they were after.
    expect(again.profile.claimed).toEqual([first.pulled!.id, first.pulled!.id]);
  });

  it('never pays experience back, only charges less', () => {
    // `xp` is a lifetime record of words. A refund that added to it would be
    // paying for something that is not a word, and a level would move on a roll.
    const start = rich(4);
    const first = applyRoll(start, { nonce: 'E1' }, seeded(9));
    const again = applyRoll(first.profile, { nonce: 'E2' }, seeded(9));
    expect(again.profile.xp).toEqual(start.xp);
    expect(again.profile.spent).toBeGreaterThan(first.profile.spent);
  });

  it('comes out of the same purse a chest does, at the same price', () => {
    // Version 6 removed the `credits` path that used to pay for this. The
    // point of `ROLL_COST` is that a roll and a chest compete for one balance,
    // so a roll that could ever be free would undo the argument.
    const result = applyRoll(rich(1), { nonce: 'F1' }, seeded(1));
    expect(result.refusal).toBeNull();
    expect(result.paid).toBe(ROLL_COST);
    expect(result.profile.spent).toBe(ROLL_COST);
  });

  it('keeps the receipt ring bounded', () => {
    let profile = rich(200);
    for (let i = 0; i < 40; i += 1) {
      profile = applyRoll(profile, { nonce: `N${i}` }, seeded(i)).profile;
    }
    expect(profile.opens.length).toBeLessThanOrEqual(20);
    // The collection is the thing that must not be trimmed.
    expect(profile.claimed.length).toBe(40);
  });
});

describe('the showcase', () => {
  const four = roster().slice(0, 4).map((one) => one.id);

  function holding(ids: string[]): Profile {
    return { ...newProfile('acct', 'Amelia', NOW), claimed: ids };
  }

  it('holds no more than three', () => {
    expect(legalShowcase(four, four).length).toBe(SHOWCASE_MAX);
  });

  it('refuses somebody who was never claimed', () => {
    // The one fact a browser sends in this whole feature, and it is checked
    // against stored state rather than believed.
    const profile = applyShowcase(holding([four[0]]), [four[1], four[0]]);
    expect(profile.showcase).toEqual([four[0]]);
  });

  it('refuses the same character twice', () => {
    expect(legalShowcase([four[0], four[0]], [four[0]])).toEqual([four[0]]);
  });

  it('keeps the order it was asked for', () => {
    // The first slot is the one that travels, so the arrangement is the
    // player's rather than the collection's.
    const asked = [four[2], four[0], four[1]];
    expect(legalShowcase(asked, four)).toEqual(asked);
  });

  it('hands back the same profile when nothing moved', () => {
    const profile = { ...holding(four), showcase: [four[0]] };
    expect(applyShowcase(profile, [four[0]])).toBe(profile);
  });

  it('costs nothing', () => {
    const profile = { ...holding(four), points: 500 };
    expect(spendable(applyShowcase(profile, four))).toBe(500);
  });
});

describe('migrating into it', () => {
  it('gives a version 4 profile an empty collection rather than failing', () => {
    const old = { version: 4, id: 'acct', name: 'Amelia', createdAt: NOW, xp: { en: 0, pl: 300, ja: 0 } };
    const next = migrate(old, NOW);
    expect(next.claimed).toEqual([]);
    expect(next.showcase).toEqual([]);
    // Nothing is owed, because the feature did not exist to have been earned in.
    expect(spendable(next)).toBe(300);
  });

  it('drops a showcase entry that was never claimed', () => {
    // The subset rule is an invariant of the shape, so a hand-edited profile
    // is repaired on the read path rather than at the one route that writes it.
    const tampered = { version: 5, id: 'acct', claimed: ['anilist:1'], showcase: ['anilist:1', 'anilist:2'] };
    expect(migrate(tampered, NOW).showcase).toEqual(['anilist:1']);
  });
});

/** One room with one person in it, at seat 0. */
function seated(): RoomEngine {
  const engine = RoomEngine.create('AAAA', 'connect4');
  if (!engine) throw new Error('connect4 is not a game any more');
  engine.join('p1', 'Amelia');
  return engine;
}

describe('the seat list', () => {
  it('caps a seat at exactly as many faces as a showcase holds', () => {
    /*
      `room.ts` copies `SHOWCASE_MAX` rather than importing it, because
      importing `waifu.ts` would carry the whole roster and its CDN URLs into
      every Durable Object for the sake of one integer. A copied constant needs
      somewhere it is held to the original, and this is it: the two drifting
      apart is either a seat drawing a face the account menu will not, or a
      showcase somebody cannot see the whole of.
    */
    const engine = seated();
    engine.setShowcase(0, ['a', 'b', 'c', 'd', 'e']);
    expect(engine.viewFor(0, new Set([0])).players[0].showcase).toHaveLength(SHOWCASE_MAX);
  });

  it('draws no faces for a seat nobody told it about', () => {
    // A guest, and the commonest seat in the app. An absent field has to reach
    // the client as an empty array rather than as undefined, so no board has
    // to decide what the difference means.
    expect(seated().viewFor(0, new Set([0])).players[0].showcase).toEqual([]);
  });
});

describe('the avatar a seat carries', () => {
  /*
    The one seat field a client sets about itself. It arrives in the `hello`
    because the equipped loadout lives in a browser and nowhere else yet (see
    `avatar/store.ts`), which makes it a claim rather than a fact, and the
    engine's whole job here is to bound it and pass it on unopened.
  */
  it('relays a loadout it cannot read', () => {
    const engine = seated();
    const worn = JSON.stringify({ set: 'kit', parts: { hair: 'kit/bob' }, variants: {} });
    engine.setAvatar(0, worn);
    expect(engine.viewFor(0, new Set([0])).players[0].avatar).toBe(worn);
  });

  it('refuses one longer than a loadout could be', () => {
    // A cap rather than a parse, because `shared/` does not know what a
    // loadout is. What this stops is one seat making every other seat receive
    // a novel on every view, and the failure is an initial, not a refused join.
    const engine = seated();
    engine.setAvatar(0, 'x'.repeat(4097));
    expect(engine.viewFor(0, new Set([0])).players[0].avatar).toBeNull();
  });

  it('draws an initial for anything that is not a string', () => {
    for (const bad of [undefined, null, 42, { set: 'kit' }, '']) {
      const engine = seated();
      engine.setAvatar(0, bad);
      expect(engine.viewFor(0, new Set([0])).players[0].avatar, String(bad)).toBeNull();
    }
  });
});
