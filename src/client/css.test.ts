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

/**
 * The whole stylesheet as one string, assembled in the order `index.css`
 * imports it -- which is the order the browser sees, so a test that reasons
 * about the cascade is reasoning about the real thing.
 *
 * Read through the @import list rather than by globbing the directory. A glob
 * would come back alphabetised, and every test below that depends on one rule
 * following another would then be answering a question the browser never
 * asks. It also means a file nobody imported is a file these tests do not
 * cover -- correctly, since the app would not load it either.
 */
const STYLES = new URL('./styles/', import.meta.url);
const css = [...readFileSync(new URL('index.css', STYLES), 'utf8')
  .matchAll(/@import\s+"\.\/([^"]+)"/g)]
  .map((m) => readFileSync(new URL(m[1], STYLES), 'utf8'))
  .join('');

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
  'lp-take',
  'lp-clear',
  'wd-input',
  'wd-submit',
  'vr-submit', // the answer button beside Vocab Race's entry field
  'vr-give-up', // "I don't know it", under the entry row
  'vr-hint-buy', // spending one of the three, beside it
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
 * Opening `<button ...>` tags, whole. Scanning to the first `>` would stop
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

/**
 * The tray's camera.
 *
 * `perspective: 900px` put the vanishing point a hand's width in front of the
 * tray, so every die away from the middle was drawn leaning: five dice lying
 * flat on one table, each apparently tipped a different way, which is what a
 * player saw and reported as the dice not having a floor under them. Without a
 * `perspective` above it a cube under `preserve-3d` is drawn orthographically,
 * which is how dice on a table are read.
 *
 * A grep, and worth being one: this is a decision about what the dice look
 * like that a single declaration can quietly reverse, and the only other thing
 * that would catch it is somebody rendering a throw and noticing.
 */
describe('the dice tray', () => {
  /*
    These used to guard the opposite thing, and the swap is the whole story of
    the change: the tray had *no* `perspective` on purpose, because a cube
    under `preserve-3d` with no perspective above it is drawn straight down,
    and a vanishing point a hand's width in front of the tray made five resting
    dice each look tipped a different way. The dice are WebGL now and the
    camera lives in `scene.ts`, so there is nothing left here to get wrong
    about projection, and two new things that a single declaration could
    quietly reverse.
  */
  it('lets the flick through to the tray', () => {
    // The canvas covers the tray edge to edge. If it ever takes the pointer,
    // the throw gesture stops existing, and it would look like nothing at all,
    // since the dice would still be drawn perfectly.
    const canvas = css.match(/^\.dice-canvas\s*\{[\s\S]*?^\}/m)?.[0] ?? '';
    expect(canvas, 'the .dice-canvas rule went missing').not.toBe('');
    expect(canvas).toMatch(/pointer-events:\s*none/);
  });

  it('does not let a button minimum decide how big a die is', () => {
    /*
      `button` carries `min-height: 44px`, the app's touch floor, and a minimum
      beats a size set on the element. The old cube learned this the hard way:
      a 35px die-slot came out 35 wide and 44 tall, an upright slab, and only
      on a phone, because on a laptop the die was over 44px and the minimum
      never bit. The mark is positioned in pixels from the projection now, so
      the same rule would fight it the same way; the 44px is honoured by the
      size the tray computes instead.
    */
    const mark = css.match(/^\.die-mark\s*\{[\s\S]*?^\}/m)?.[0] ?? '';
    expect(mark, 'the .die-mark rule went missing').not.toBe('');
    expect(mark).toMatch(/min-height:\s*0/);
  });

  it('still refuses to be scrolled by a thumb dragged across it', () => {
    const tray = css.match(/^\.dice-tray\s*\{[\s\S]*?^\}/m)?.[0] ?? '';
    expect(tray, 'the .dice-tray rule went missing').not.toBe('');
    expect(tray).toMatch(/touch-action:\s*none/);
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

/**
 * The toast stack, which is the only thing in the app that floats.
 *
 * Every other panel here sits in the flow, and that is the whole reason the
 * toasts exist: the refusal a player is being shown is about the tap they
 * just made, and the banner it replaced pushed the board down the page at
 * exactly that moment. Three declarations carry that, and all three are the
 * kind a tidy-up removes without noticing, because the page still renders
 * perfectly well with any of them gone -- just wrong.
 */
describe('the toast stack', () => {
  /** One rule's body, by exact selector -- `.toast` must not answer `.toasts`. */
  const rule = (selector: string) => {
    // Found by text rather than by pattern: every rule here is written one
    // declaration to a line with the brace on the selector, so looking for the
    // exact opening line is both simpler to read and unable to answer
    // `.toasts` when it was asked about `.toast`.
    const at = css.indexOf(`\n.${selector} {`);
    return at === -1 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('floats, so a refusal never reflows the board underneath it', () => {
    expect(rule('toasts')).toMatch(/position:\s*fixed/);
  });

  it('does not sit inside anything that transforms', () => {
    /*
      `position: fixed` is relative to the viewport -- unless an ancestor has a
      transform, filter or perspective, in which case it is relative to *that*,
      and the stack would scroll away with whatever screen raised it. `.app`
      wraps every screen the toasts float over, so a transform on it (a page
      transition, a shake, a nudge) would break them from a file that never
      mentions toasts. This test is the note that says so.
    */
    expect(rule('app')).not.toMatch(/^\s*(transform|filter|perspective):/m);
  });

  it('lets taps through the gaps between toasts', () => {
    // The stack is a viewport-wide strip so its children can be centred. Left
    // opaque to the pointer it would swallow every tap on the top of the board
    // while a toast was up -- including the retry the toast is asking for.
    expect(rule('toasts')).toMatch(/pointer-events:\s*none/);
    expect(rule('toast')).toMatch(/pointer-events:\s*auto/);
  });

  it('gives the close button a finger-sized box around its cross', () => {
    const close = rule('toast-close');
    expect(close).toMatch(/min-height:\s*44px/);
    expect(close).toMatch(/min-width:\s*44px/);
  });

  it('holds still for anyone who asked for less movement', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.toast \{\s*animation:\s*none/,
    );
  });
});

/**
 * Every game has a picture on its card.
 *
 * Word Chain and Vocab Race shipped without one. Nothing broke and nothing
 * complained: `motif()` ends in a `default` that returns null, which is the
 * right answer for a game whose motif has not been drawn yet -- an empty well
 * reads as a card with no picture, where a wrong one reads as a lie -- and so
 * two games sat in the lobby with a blank frame where the other eleven had a
 * board. It is the same shape of bug as the channel accents above: a
 * registration in one more place than anyone counted.
 *
 * Both halves are checked because either alone is silent. A `case` with no
 * `.art-` block draws bare elements on the board colour; an `.art-` block with
 * no `case` styles an empty span.
 */
describe('the card motifs', () => {
  it('cover every game in the manifest, and name none that is not one', async () => {
    const { GAME_MANIFEST } = await import('../shared/games/manifest.js');
    const games = Object.keys(GAME_MANIFEST).sort();

    const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
    // The switch itself, not the whole file: `case "wordchain"` appears in
    // other switches keyed by the same ids, and a motif is only a motif if it
    // is in this one.
    const motif = app.slice(app.indexOf('function motif('), app.indexOf('function roomUrl('));
    expect(motif).toContain('switch (gameId)');
    const drawn = [...motif.matchAll(/case "([a-z0-9]+)":/g)].map((m) => m[1]).sort();
    expect(drawn).toEqual(games);

    const styled = [...css.matchAll(/\.art-([a-z0-9]+)\b/g)].map((m) => m[1]);
    expect([...new Set(styled)].sort()).toEqual(games);
  });
});
