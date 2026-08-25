import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The thirteen card hues, held to the arithmetic they were solved for.
 *
 * The lobby cards each carry their own colour, and the whole of what makes
 * that one set of rules instead of thirteen is that the family is uniform:
 * every `--card` takes white ink at the same ratio, and every `--card-well`
 * sits at the same luminance. Both facts are relied on elsewhere and neither
 * is visible in the value -- `#647012` does not look like "5.4:1 against
 * white", and nobody hand-editing it would notice it had stopped being.
 *
 * So the family is checked rather than remembered. The comment in
 * `palette.css` explains why each target is what it is; this file is what
 * stops the explanation drifting away from the values underneath it.
 *
 * The failure this is really written against is the cheerful one: someone
 * warms a hue up two points because it looked muddy beside its neighbour, and
 * the card is still perfectly readable while the *blurb* on it has quietly
 * dropped under AA. That is invisible by eye and one line of arithmetic here.
 */

const palette = readFileSync(new URL('./styles/palette.css', import.meta.url), 'utf8');

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as Rgb;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` composited over an opaque `bg` -- what the eye actually gets. */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return bg.map((c, i) => fg[i] * alpha + c * (1 - alpha)) as Rgb;
}

const WHITE: Rgb = [1, 1, 1];

/**
 * Every `--card` / `--card-well` pair in the file, including the uncoloured
 * fallback on the bare `.game` rule -- which is a member of the family and is
 * checked as one, because a fourteenth game with no hue is still a card
 * somebody has to read.
 */
function cardPairs(): { id: string; card: Rgb; well: Rgb }[] {
  const out: { id: string; card: Rgb; well: Rgb }[] = [];
  const re = /\.game(?:\[data-game="([a-z0-9]+)"\])?\s*\{\s*--card:\s*(#[0-9a-f]{6});\s*--card-well:\s*(#[0-9a-f]{6});/g;
  for (const m of palette.matchAll(re)) {
    out.push({ id: m[1] ?? '(fallback)', card: rgb(m[2]), well: rgb(m[3]) });
  }
  return out;
}

/**
 * A declaration's value, from one named rule.
 *
 * The rule has to be named. Half of these tokens are declared twice on purpose
 * -- `--motif-off` is `#7a7a86` in the stage palette and a translucent white
 * on `.art`, which is the whole point of the pinning block -- so a bare search
 * of the file answers with whichever comes first, and the first one is the one
 * this file is not asking about. That is not hypothetical: it is what the
 * first draft of this test did, and it reported the stage grey as "not a
 * translucent token" rather than checking the value the cards actually use.
 */
function token(rule: string, name: string): string {
  // Every block with this selector, not the first: `:root` opens three times
  // in this file -- the stage palette, the daylight palette, and the card
  // family -- and the token being asked for is in exactly one of them. Taking
  // the first `:root` found the stage block and reported `--card-ink-soft`
  // missing from a file that declares it forty lines further down.
  for (let at = palette.indexOf(`${rule} {`); at !== -1; at = palette.indexOf(`${rule} {`, at + 1)) {
    const block = palette.slice(at, palette.indexOf('}', at));
    const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (m) return m[1].trim();
  }
  throw new Error(`no ${name} in any ${rule} block of palette.css`);
}

/** The alpha out of an `rgb(... / 0.46)` token. */
function alphaOf(rule: string, name: string): number {
  const value = token(rule, name);
  const m = value.match(/\/\s*([0-9.]+)\s*\)/);
  if (!m) throw new Error(`${name} on ${rule} is not translucent: ${value}`);
  return Number(m[1]);
}

describe('the card hue family', () => {
  const pairs = cardPairs();

  it('covers every game in the manifest, and names none that is not one', async () => {
    const { GAME_MANIFEST } = await import('../shared/games/manifest.js');
    const named = pairs.map((p) => p.id).filter((id) => id !== '(fallback)');
    expect(named.sort()).toEqual(Object.keys(GAME_MANIFEST).sort());
    // And the fallback exists, so an unknown id is uncoloured rather than
    // transparent -- a card with no `--card` at all has no background.
    expect(pairs.some((p) => p.id === '(fallback)')).toBe(true);
  });

  /*
    White ink, at one ratio across the whole family.

    This is the fact that lets `--card-ink` be a single token. The name on a
    card is 1.18rem bold and the blurb is 0.78rem, so the binding constraint is
    the blurb: normal-size body text, held to 4.5:1. The hues are solved to
    5.4 rather than to 4.5 because the blurb is white at 0.90 alpha rather than
    white, and that costs about 0.7 -- so the margin here is not slack, it is
    the room the blurb is about to spend.
  */
  it('takes white ink at the ratio --card-ink depends on', () => {
    for (const { id, card } of pairs) {
      expect(contrast(card, WHITE), `${id}: name on card`).toBeGreaterThanOrEqual(5.3);
    }
  });

  it('leaves the blurb clearing AA once --card-ink-soft has spent its alpha', () => {
    const alpha = alphaOf(':root', '--card-ink-soft');
    for (const { id, card } of pairs) {
      const ink = over(WHITE, alpha, card);
      expect(contrast(ink, card), `${id}: blurb on card`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /*
    One luminance across the thirteen wells, which is what makes the motif
    rebinding in `palette.css` a single block instead of thirteen.

    The band is tight on purpose. It is not "dark enough" -- it is "the same",
    because `--motif-off` and `--hole` are translucent and their contrast is
    decided entirely by what is behind them. A well two points brighter than
    its siblings is a card whose empty squares have quietly stopped clearing
    3:1, on a card that otherwise looks fine.
  */
  it('keeps every well at the one luminance the motif tokens were mixed for', () => {
    for (const { id, well } of pairs) {
      expect(luminance(well) * 100, `${id}: well luminance %`).toBeGreaterThan(1.1);
      expect(luminance(well) * 100, `${id}: well luminance %`).toBeLessThan(1.6);
    }
  });

  /*
    The unlit pieces, which is the rule `docs/card-motifs.md` is built on: a
    motif's empty half is drawn as an edge in `--motif-off`, and it has to be
    findable against the well with nothing brighter on top of it. 3:1 is the
    floor for a shape rather than text.
  */
  it('leaves --motif-off clearing 3:1 on every well', () => {
    const alpha = alphaOf('.art', '--motif-off');
    for (const { id, well } of pairs) {
      const off = over(WHITE, alpha, well);
      expect(contrast(off, well), `${id}: motif edge on well`).toBeGreaterThanOrEqual(3);
    }
  });

  /*
    The lit pieces. Seats are pinned to their stage values on `.game` precisely
    so this can be checked once, against one set -- see the "locked to the
    stage palette" note in `palette.css`. A daylight seat here would be the
    piece vanishing into the well, which is the bug that pinning prevents.
  */
  it('leaves every seat clearing 3:1 on every well', () => {
    const seats = [...palette.matchAll(/^\s*(--seat-\d):\s*(#[0-9a-f]{6});/gm)]
      .map((m) => m[2])
      .slice(0, 4)
      .map(rgb);
    expect(seats).toHaveLength(4);
    for (const { id, well } of pairs) {
      for (const seat of seats) {
        expect(contrast(seat, well), `${id}: seat on well`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  /*
    Thirteen colours are only wayfinding if they are thirteen. Two games close
    enough to be confused at a glance would put the shelf back where it was --
    found by reading rather than by looking -- without failing any of the
    contrast checks above, all of which are about a card against itself.
  */
  it('gives no two games the same hue', () => {
    const seen = new Map<string, string>();
    for (const { id, card } of pairs) {
      const key = card.join(',');
      expect(seen.has(key), `${id} and ${seen.get(key)} share a hue`).toBe(false);
      seen.set(key, id);
    }
  });

  /*
    And are far enough apart to be told apart. A plain distance in sRGB is a
    poor model of perception, but it is a fine model of "somebody pasted the
    same blue twice with one digit changed", which is the mistake that actually
    happens.

    30 is not a taste, it is close to the ceiling. Every card is solved to the
    same contrast against white, so all fourteen sit at nearly the same
    luminance -- which leaves them spread around a ring in the two chromatic
    dimensions and nowhere to go in the third. Thirteen points on a ring cannot
    be further apart than about 0.48 of its radius however they are arranged,
    and the family reaches 34 at its closest pair (the two greens, Vocab Race
    and Word Duel). So this catches a collision and does not pretend the hues
    could be spread twice as far if someone tried harder; they could not.

    The first draft of this test asserted 40, which the family had no way of
    meeting -- worth saying, because a threshold that cannot be met is the kind
    that gets lowered until it passes rather than reasoned about.
  */
  it('keeps the hues far enough apart to be told apart', () => {
    for (let i = 0; i < pairs.length; i += 1) {
      for (let j = i + 1; j < pairs.length; j += 1) {
        const d = Math.hypot(...pairs[i].card.map((c, k) => (c - pairs[j].card[k]) * 255));
        expect(d, `${pairs[i].id} and ${pairs[j].id} are ${d.toFixed(0)} apart`)
          .toBeGreaterThan(30);
      }
    }
  });
});

/**
 * The pinning block, held complete.
 *
 * A lobby card is drawn in the stage palette whichever palette the app is in,
 * and that is not a preference -- the thirteen wells were solved once, and the
 * contrast checks above are only true because the pieces standing on them are
 * the stage pieces. A token that varies by palette and is reachable from
 * inside a card is a hole in that, and the hole is invisible: the card looks
 * right in the palette you happen to be developing in.
 *
 * Two were found by hand and neither was findable by reading `picker.css`.
 * `--ut-*` came in through Ultimate's motif, which is the board's own markup
 * and the board's own stylesheet. `--rule-hi` came in through Liar's Dice,
 * whose motif draws real dice from `dice.css`. Both are the same shape of
 * mistake: the motif's token surface is the *borrowed* file's, not this one's.
 *
 * So the list is inverted, the way `.surface` inverted the disabled-button
 * blocklist for exactly this reason. Every token that differs between the two
 * palettes must either be pinned or be named below as one a card cannot
 * reach -- and a new palette token is a decision rather than a silent leak.
 */
describe('the card pinning block', () => {
  /** The token names declared inside one `:root[...]`-style block. */
  const namesIn = (marker: string) => {
    const at = palette.indexOf(marker);
    expect(at, `no ${marker} block`).toBeGreaterThan(-1);
    const block = palette.slice(at, palette.indexOf('\n}', at));
    return new Set([...block.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
  };

  /**
   * Palette tokens a card provably cannot reach, and why. Shrinking this list
   * is always safe; adding to it is a claim that has to be true.
   */
  const UNREACHABLE = new Map([
    ['--ground', 'the page behind the shelf, never inside a card'],
    ['--action', 'derived: var(--accent), and the seats it resolves through are pinned'],
    ['--point-dark', "backgammon's motif draws its points in --motif-off and --seat-3"],
    ['--point-light', 'the other half of the same pair, and used by neither motif'],
    ['--live', 'a status colour; no motif shows a board in play'],
    ['--pending', 'a status colour; nothing on a card is pending'],
    ['--mark-miss-text', "Word Duel's motif is deliberately letterless -- the marks are the game"],
  ]);

  it('pins every palette token a card can reach', () => {
    const stage = namesIn(':root,');
    const daylight = namesIn(':root[data-palette="daylight"] {');
    const varies = [...stage].filter((t) => daylight.has(t));
    expect(varies.length, 'the two palettes should share their token names').toBeGreaterThan(20);

    const pinned = new Set([...namesIn('.game {'), ...namesIn('.art {')]);
    const leaked = varies.filter((t) => !pinned.has(t) && !UNREACHABLE.has(t));
    expect(leaked, `palette-varying and not pinned: ${leaked.join(', ')}`).toEqual([]);
  });

  it('names nothing unreachable that is not a palette token at all', () => {
    const stage = namesIn(':root,');
    for (const name of UNREACHABLE.keys()) {
      expect(stage.has(name), `${name} is not in the stage palette any more`).toBe(true);
    }
  });
});
