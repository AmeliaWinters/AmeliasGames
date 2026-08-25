/**
 * What the lobby's motifs are showing this visit.
 *
 * The cards are crops of a table mid-play (see `docs/card-motifs.md`), and a
 * crop of a game in progress is the one kind of picture that has no reason to
 * be the same twice. Four of the thirteen are dealt rather than written down:
 * the two dice games, Letterpress's tiles and the men on the Morris corner.
 * The shelf is then subtly never the same shelf, at the cost of one integer
 * and no animation at all.
 *
 * Which four, and why not the rest: a motif can be dealt when its data lives
 * here and its legality can be *decided* here. Five of the others are a bare
 * count of `<i>` elements coloured by `nth-child` in `picker.css` -- Connect
 * Four, Word Duel, Battleships and their kin -- and the position they show is
 * written in the stylesheet, not in this file. Dealing those means moving the
 * position into markup and rewriting the blocks that draw them, which is the
 * count-plus-a-CSS-block contract the register keeps on purpose. Word Hunt's
 * letters have to spell a word the game agrees is traceable, Word Chain's have
 * to chain, and Vocab Race's have to be a real translation -- and the lobby is
 * kept out of the word lists by `bundle.test.ts`. Ultimate's would need the
 * rules of Ultimate in the lobby to check its own win lines. Those eight stay
 * written down.
 *
 * Every deal is a pure function of a seed, and `DEALS` is the whole of the
 * space, so `cardDeal.test.ts` checks every position this file can ever
 * produce rather than the one it happened to produce today. That is the only
 * honest way to hold rule 3 -- "the moment shown must be legal" -- once the
 * moment stops being a constant somebody read back by eye.
 */

/** How many distinct shelves there are. Small enough to enumerate in a test. */
export const DEALS = 64;

/** mulberry32: three lines, no dependency, and the same sequence everywhere. */
function rng(seed: number): () => number {
  let a = (seed + 0x6d2b79f5) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, on a copy: the callers all hold constants. */
function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Dice do not land in order, and a shuffle does not know that.
 *
 * One permutation in sixty is a run, up or down, and over a seed space this
 * size that is not a rarity to be hoped past -- it is a card somebody will
 * see, showing five dice lined up like a ruler. So it is shuffled again until
 * it is not one. Terminating, because at most two of the permutations of five
 * distinct faces are monotonic and the shuffle is drawing from all of them.
 */
function tumbled(faces: number[], rand: () => number): number[] {
  let out = faces;
  while (monotonic(out)) out = shuffled(out, rand);
  return out;
}

function monotonic(faces: number[]): boolean {
  const up = faces.every((face, i) => i === 0 || face >= faces[i - 1]);
  const down = faces.every((face, i) => i === 0 || face <= faces[i - 1]);
  return up || down;
}

/**
 * Yahtzee: a large straight, landed in the order dice land in.
 *
 * The register asks for the one scoring hand that shows five different faces,
 * and there are exactly two of them. Shuffling is not decoration -- a sorted
 * row reads as a ruler rather than as a throw, which is why the constant this
 * replaced was written 3,1,5,2,4 rather than 1,2,3,4,5.
 */
export function yahtzeeDeal(seed: number): number[] {
  const rand = rng(seed);
  const low = rand() < 0.5;
  return tumbled(shuffled(low ? [1, 2, 3, 4, 5] : [2, 3, 4, 5, 6], rand), rand);
}

/**
 * Liar's Dice: your five, with exactly one pair among them.
 *
 * Exactly one, rather than at least one: the card's job is to show a hand
 * worth bidding on, and three of a kind reads as a lucky throw where a pair
 * reads as the ordinary one. Built by taking four distinct faces and doubling
 * one of them, so the shape is guaranteed rather than sampled for.
 */
export function liarsDeal(seed: number): number[] {
  const rand = rng(seed ^ 0x9e37);
  const faces = shuffled([1, 2, 3, 4, 5, 6], rand).slice(0, 4);
  return tumbled(shuffled([...faces, faces[Math.floor(rand() * 4)]], rand), rand);
}

/**
 * Letterpress: fifteen tiles, and the locked one keeps its letter.
 *
 * The board's letters are scrambled on purpose -- adjacency means nothing in
 * this game, so a row that spelled something would advertise a rule it does
 * not have -- which is exactly what makes this the cheapest of the four to
 * deal. No tile is a Q or a Z: a real board draws from a bag that is mostly
 * vowels and common consonants, and a card with a Z on it looks like a
 * Scrabble rack.
 *
 * The vowels are counted out rather than drawn, and that is the whole reason
 * this is two pools instead of one. Drawing fifteen tiles from a single
 * weighted bag deals a board with one vowel in it about as often as it deals a
 * plausible one -- the first seed tried came out WKLMLTVSTEXCBFD -- and a word
 * game whose board cannot spell anything is a worse advertisement than a fixed
 * board would have been. Five in fifteen is about what a real bag gives.
 *
 * Index 1 is pinned to K because it is the locked tile -- `nth-child(2)` in
 * `picker.css` -- and the block there, and the register, both describe that
 * tile by its letter. A dealt K is one fewer thing that can quietly stop being
 * true about a comment.
 */
const VOWELS = "AAAAEEEEEIIIOOOU";
// No K in the bag: index 1 is pinned to one, and a second K somewhere else on
// the board makes "the K is the locked tile" -- which is how the register and
// the `.art-letterpress` block both describe it -- a sentence with two answers.
const CONSONANTS = "NNNRRRSSSTTTLLDDCCMMHHPPGGBBFFWWYVJX";
export const LOCKED_TILE = { index: 1, letter: "K" };
export const TILE_COUNT = 15;
export const VOWEL_COUNT = 5;

export function letterpressDeal(seed: number): string[] {
  const rand = rng(seed ^ 0x51ed);
  const drawn = shuffled(
    [
      ...shuffled([...VOWELS], rand).slice(0, VOWEL_COUNT),
      ...shuffled([...CONSONANTS], rand).slice(0, TILE_COUNT - VOWEL_COUNT),
    ],
    rand,
  );
  drawn[LOCKED_TILE.index] = LOCKED_TILE.letter;
  return drawn;
}

/**
 * Morris: which of the corner's points have men on them.
 *
 * The nine visible points are the three rings crossed with the three spots the
 * crop shows; the ninth is off the frame, so eight are dealt among. Two men
 * each, which is what the crop has always shown, and the rest of both hands is
 * off the card.
 *
 * No mill can be formed here and that is arithmetic rather than luck: a mill
 * is three men in a line and neither side has three men on this card. It is
 * still asserted in the test, because the day someone shows three the reason
 * it was safe will have quietly expired.
 */
export const MORRIS_POINTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0, 1], [0, 2],
  [1, 0], [1, 1], [1, 2],
  [2, 0], [2, 1],
];

export function morrisDeal(seed: number): {
  men: Array<{ ring: number; spot: number; seat: 0 | 1 }>;
  empty: Array<{ ring: number; spot: number }>;
} {
  const order = shuffled(MORRIS_POINTS, rng(seed ^ 0x2f19));
  const men = order.slice(0, 4).map(([ring, spot], i) => ({
    ring,
    spot,
    // Alternating rather than the first two and the last two, so a deal cannot
    // put both of one side's men on the same ring by construction.
    seat: (i % 2) as 0 | 1,
  }));
  const empty = order.slice(4).map(([ring, spot]) => ({ ring, spot }));
  return { men, empty };
}
