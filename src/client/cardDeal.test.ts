import { describe, expect, it } from "vitest";
import {
  DEALS,
  LOCKED_TILE,
  MORRIS_POINTS,
  TILE_COUNT,
  VOWEL_COUNT,
  letterpressDeal,
  liarsDeal,
  morrisDeal,
  yahtzeeDeal,
} from "./cardDeal";

/*
  Rule 3 of `docs/card-motifs.md` is "the moment shown must be legal", and it
  used to be held by somebody reading four constants back as positions before
  shipping them. Once the positions are dealt there is no constant to read, so
  the reading is done here instead -- over every seed the app can ever draw,
  which is a stronger check than the one it replaces rather than a weaker one.
*/
const SEEDS = Array.from({ length: DEALS }, (_, i) => i);

describe("every shelf the lobby can deal", () => {
  it("gives Yahtzee a large straight, unsorted", () => {
    for (const seed of SEEDS) {
      const dice = yahtzeeDeal(seed);
      expect(dice).toHaveLength(5);
      const sorted = [...dice].sort();
      // The two hands that are five different faces and score.
      expect(["1,2,3,4,5", "2,3,4,5,6"]).toContain(sorted.join(","));
      // Dice do not land in order. A run reads as a ruler, not as a throw.
      const up = dice.every((d, i) => i === 0 || d >= dice[i - 1]);
      const down = dice.every((d, i) => i === 0 || d <= dice[i - 1]);
      expect(up || down).toBe(false);
    }
  });

  it("gives Liar's Dice exactly one pair among five", () => {
    for (const seed of SEEDS) {
      const dice = liarsDeal(seed);
      expect(dice).toHaveLength(5);
      for (const die of dice) expect(die).toBeGreaterThanOrEqual(1);
      for (const die of dice) expect(die).toBeLessThanOrEqual(6);
      const counts = new Map<number, number>();
      for (const die of dice) counts.set(die, (counts.get(die) ?? 0) + 1);
      // Four faces on the table, one of them twice: a hand worth bidding on
      // rather than a lucky one.
      expect([...counts.values()].sort().join(",")).toBe("1,1,1,2");
      const up = dice.every((d, i) => i === 0 || d >= dice[i - 1]);
      const down = dice.every((d, i) => i === 0 || d <= dice[i - 1]);
      expect(up || down).toBe(false);
    }
  });

  it("gives Letterpress a board that could spell something", () => {
    for (const seed of SEEDS) {
      const tiles = letterpressDeal(seed);
      expect(tiles).toHaveLength(TILE_COUNT);
      for (const tile of tiles) expect(tile).toMatch(/^[A-Z]$/);
      // No Q and no Z: a real bag is common letters, and one rare tile on a
      // fifteen-tile crop reads as a Scrabble rack rather than a board.
      expect(tiles.join("")).not.toMatch(/[QZ]/);

      // The vowels are the reason this deal is two pools. A single weighted
      // bag deals a board with one vowel in it often enough to ship one, and a
      // word game that cannot spell is a worse card than a fixed board was.
      // One fewer is allowed because the locked K may have landed on a vowel.
      const vowels = tiles.filter((tile) => "AEIOU".includes(tile)).length;
      expect(vowels).toBeGreaterThanOrEqual(VOWEL_COUNT - 1);

      // The register and the `.art-letterpress` block both name this tile by
      // its letter, so the deal is not allowed to move it -- nor to deal a
      // second one, which would make "the K" a phrase with two referents.
      expect(tiles[LOCKED_TILE.index]).toBe(LOCKED_TILE.letter);
      expect(tiles.filter((tile) => tile === LOCKED_TILE.letter)).toHaveLength(1);
    }
  });

  it("stands two Morris men a side on points the board has", () => {
    for (const seed of SEEDS) {
      const { men, empty } = morrisDeal(seed);
      expect(men).toHaveLength(4);
      expect(men.filter((man) => man.seat === 0)).toHaveLength(2);
      expect(men.filter((man) => man.seat === 1)).toHaveLength(2);

      // Two men a side is why no mill can appear on this card. Asserted rather
      // than reasoned about in a comment alone, because the day the crop shows
      // three the reason it was safe will have quietly expired.
      expect(men.filter((man) => man.seat === 0).length).toBeLessThan(3);
      expect(men.filter((man) => man.seat === 1).length).toBeLessThan(3);

      // Every visible point is accounted for exactly once: no man standing on
      // another man, and no point drawn twice.
      const all = [...men, ...empty].map(({ ring, spot }) => `${ring},${spot}`);
      expect(new Set(all).size).toBe(MORRIS_POINTS.length);
      for (const point of all) {
        expect(MORRIS_POINTS.map(([r, s]) => `${r},${s}`)).toContain(point);
      }
    }
  });

  it("does not deal the same shelf every time", () => {
    // The point of the whole exercise. If a change to the seeding quietly
    // collapses the space, four cards go back to being constants and nothing
    // else in this file would notice.
    expect(new Set(SEEDS.map((s) => yahtzeeDeal(s).join(","))).size).toBeGreaterThan(8);
    expect(new Set(SEEDS.map((s) => liarsDeal(s).join(","))).size).toBeGreaterThan(8);
    expect(new Set(SEEDS.map((s) => letterpressDeal(s).join(""))).size).toBeGreaterThan(8);
    expect(
      new Set(SEEDS.map((s) => morrisDeal(s).men.map((m) => `${m.ring}${m.spot}${m.seat}`).join(""))).size,
    ).toBeGreaterThan(8);
  });
});
