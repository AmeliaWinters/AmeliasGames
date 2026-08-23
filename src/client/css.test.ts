import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The disabled-button rule, held to its inverted shape.
 *
 * A disabled button normally fades to 0.45. A playing surface must not: a
 * column you cannot drop into still has counters in it, and half of
 * Battleships' grid is inert by design. That exception used to be a list of
 * `:not(.column):not(.point)` clauses on the global rule, extended by hand
 * whenever a game arrived -- and four games in a row got it wrong. Morris
 * faded all twenty-four points whenever it was not your turn. Ultimate faded
 * every square outside the board in play. Word Hunt's own `opacity: 0.55`
 * lost to the seven-clause chain on specificity and never applied at all.
 * Word Duel's keyboard dimmed on the row *and* on each key, landing at an
 * effective 0.248.
 *
 * None of those was carelessness; each was a person not knowing there was a
 * list somewhere else to update. So the list was inverted -- surfaces mark
 * themselves with `.surface` -- and these two tests are the halves of that
 * bargain. The first stops the blocklist growing back. The second stops a new
 * board's buttons being written without an opinion either way.
 */

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/**
 * Buttons in a board that are controls rather than surface: they carry a word,
 * they sit beside the board rather than in it, and fading one is the correct
 * way to say it cannot be pressed. Adding to this list is a decision; the test
 * exists so that it has to be one.
 */
const CONTROLS = new Set([
  'primary', // start, roll, spin, submit -- every game's action button
  'bs-pick', // the ship you are holding: a named control beside the sea
  'bs-tool', // rotate and ready
  'ld-step', // bid quantity stepper
  'ld-face', // bid face picker
  'ld-wide',
  'wh-take',
  'wh-clear',
  'wd-input',
  'wd-submit',
  'yz-pick',
]);

/** Board and dice components -- the files that draw a playing surface. */
function boardSources(): { file: string; source: string }[] {
  const dirs = ['games', 'dice'];
  const out: { file: string; source: string }[] = [];
  for (const dir of dirs) {
    const base = new URL(`./${dir}/`, import.meta.url);
    for (const name of readdirSync(base)) {
      if (!name.endsWith('.tsx')) continue;
      out.push({
        file: `${dir}/${name}`,
        source: readFileSync(new URL(name, base), 'utf8'),
      });
    }
  }
  return out;
}

/**
 * Opening `<button …>` tags, whole. Scanning to the first `>` would stop
 * inside `disabled={a > b}` and miss the className that follows it, so this
 * tracks brace depth and only accepts a `>` outside every JSX expression.
 */
function buttonTags(source: string): string[] {
  const tags: string[] = [];
  for (let i = source.indexOf('<button'); i !== -1; i = source.indexOf('<button', i + 1)) {
    let depth = 0;
    for (let j = i; j < source.length; j += 1) {
      const ch = source[j];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      else if (ch === '>' && depth === 0) {
        tags.push(source.slice(i, j + 1));
        break;
      }
    }
  }
  return tags;
}

/** The className attribute's value only -- not the aria-label after it. */
function classNameValue(tag: string): string | null {
  const at = tag.indexOf('className=');
  if (at === -1) return null;
  const from = at + 'className='.length;
  if (tag[from] === '"' || tag[from] === "'") {
    const end = tag.indexOf(tag[from], from + 1);
    return end === -1 ? null : tag.slice(from + 1, end);
  }
  if (tag[from] !== '{') return null;
  let depth = 0;
  for (let i = from; i < tag.length; i += 1) {
    if (tag[i] === '{') depth += 1;
    else if (tag[i] === '}') {
      depth -= 1;
      if (depth === 0) return tag.slice(from + 1, i);
    }
  }
  return null;
}

/**
 * Class names a tag can end up with. Boards build these three ways: a plain
 * string, an inline conditional, or -- where there are more than three or four
 * states -- an array assembled just above the tag and joined. The third is the
 * one worth resolving rather than skipping, because it is what the two biggest
 * boards use, and skipping it is how a surface goes unnoticed here.
 */
function classesIn(tag: string, source: string): string[] {
  const value = classNameValue(tag);
  if (value === null) return [];

  const names: string[] = [];
  const harvest = (text: string) => {
    for (const [, body] of text.matchAll(/["'`]([^"'`]*)["'`]/g)) {
      for (const word of body.split(/\s+/)) {
        if (word && !word.includes('$') && !word.includes('{')) names.push(word);
      }
    }
  };
  harvest(value);

  // `className={classes}` -- follow the identifier to the array it was built
  // from, in the same file.
  const bare = value.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(bare)) {
    const declared = source.match(new RegExp(`const\\s+${bare}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (declared) harvest(declared[1]);
  }
  return names;
}

describe('the disabled-button rule', () => {
  it('names no board class, so no game can be left off it', () => {
    const rule = css.match(/^button:disabled[^{]*\{/gm);
    expect(rule, 'the global disabled rule went missing').not.toBeNull();

    const blocklisted = (rule ?? []).flatMap((r) => [...r.matchAll(/:not\(\.([a-z0-9-]+)\)/g)]);
    const named = blocklisted.map((m) => m[1]).filter((c) => c !== 'surface');

    expect(
      named,
      `the exclusion list is growing back: ${named.join(', ')}. A surface says so ` +
        'on the element with `.surface`, so that a game cannot be forgotten here.',
    ).toEqual([]);
  });

  it('is opted out of by `.surface` and nothing else', () => {
    expect(css).toMatch(/button:disabled:not\(\.surface\)\s*\{[^}]*opacity/);
  });
});

describe('board buttons', () => {
  it('each either mark themselves a surface or are a known control', () => {
    const unclassified: string[] = [];

    for (const { file, source } of boardSources()) {
      for (const tag of buttonTags(source)) {
        if (!/\bdisabled[=\s]/.test(tag)) continue;
        const classes = classesIn(tag, source);
        if (classes.includes('surface')) continue;
        if (classes.some((c) => CONTROLS.has(c))) continue;
        // A button with no class at all is a word in a box -- "Solve", "Call
        // liar". Nothing draws a playing surface without styling it, so this
        // is a control, and fading it is right.
        if (classes.length === 0) continue;
        unclassified.push(`${file}: .${classes.join('.')}`);
      }
    }

    expect(
      unclassified,
      'a disabled button in a board is either part of the playing surface (add ' +
        '`surface` to its className, and it keeps full opacity) or a control ' +
        '(add its class to CONTROLS in this file, and it fades like a button). ' +
        `Undecided: ${unclassified.join(' | ')}`,
    ).toEqual([]);
  });
});

/**
 * A game's accent is written out three times -- once for the room, once for
 * its lobby card, and once in `palette.ts` so the client knows the id is a
 * channel at all. Three copies that must agree, kept in agreement by hand
 * across ten games. They do agree today; nothing was holding them there.
 *
 * The failure is quiet rather than loud, which is why it is worth a test: a
 * game missing from `CHANNELS` renders unstyled instead of broken, and a card
 * whose seat colour disagrees with its room is a thing you have to be looking
 * for to see.
 */
describe('the channel accents', () => {
  const seatFor = (scope: string) =>
    new Map(
      [...css.matchAll(new RegExp(`${scope}\\[data-game="([a-z0-9]+)"\\]\\s*\\{[^}]*--accent:\\s*var\\((--seat-\\d)\\)`, 'g'))]
        .map((m) => [m[1], m[2]] as const),
    );

  it('agree between the room and the lobby card, for every game', () => {
    const room = seatFor(':root');
    const card = seatFor('\\.game');
    expect([...room.keys()].sort()).toEqual([...card.keys()].sort());
    for (const [id, seat] of room) {
      expect(card.get(id), `${id}: room says ${seat}, card says ${card.get(id)}`).toBe(seat);
    }
  });

  it('cover every game in the manifest, and name none that is not one', async () => {
    const { GAME_MANIFEST } = await import('../shared/games/manifest.js');
    const { CHANNELS } = await import('./palette.js');
    const games = Object.keys(GAME_MANIFEST).sort();
    expect([...seatFor(':root').keys()].sort()).toEqual(games);
    expect(Object.keys(CHANNELS).sort()).toEqual(games);
  });
});

describe('the client stylesheet', () => {
  it('reads every custom property it declares', () => {
    const declared = new Set(
      [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
    );
    // Four are set from JS on the element -- the tray's aspect ratio, the Word
    // Hunt grid size, and the wheel's centre and spin duration.
    const read = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const unused = [...declared].filter((name) => !read.has(name));
    expect(unused, `declared and never read: ${unused.join(', ')}`).toEqual([]);
  });
});
