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
const BOARDS = new URL('./games/', import.meta.url);

/** The sheets `index.css` still pulls in, in the order it pulls them. */
const eager = [...readFileSync(new URL('index.css', STYLES), 'utf8')
  .matchAll(/@import\s+"\.\/([^"]+)"/g)].map((m) => m[1]);

/**
 * The game sheets that now arrive with their board, found the way the browser
 * finds them: by reading the import out of the board component.
 *
 * Thirteen of the fifteen left `index.css` so that a player opening the lobby
 * stops downloading every game's CSS to look at a shelf of cards. They are
 * still part of one stylesheet as far as this file is concerned, and they have
 * to be, because the tests below reason about the whole cascade -- the
 * disabled-button rule and the phone-width arithmetic both answer differently
 * with a game sheet missing, and would answer *green* rather than failing.
 *
 * Read from the board sources rather than globbed, for the reason the old
 * comment here gave: a sheet nobody imports is a sheet the app never loads,
 * and it should not be covered. That property is now worth more than it was,
 * since forgetting the import is a whole game rendering unstyled, so
 * `every game sheet` below asserts it directly.
 */
function lazySheets(): string[] {
  const found: string[] = [];
  for (const name of readdirSync(BOARDS)) {
    if (!name.endsWith('.tsx') || name.endsWith('.test.tsx')) continue;
    const source = readFileSync(new URL(name, BOARDS), 'utf8');
    for (const [, path] of source.matchAll(/import\s+"\.\.\/styles\/([^"]+\.css)"/g)) {
      if (!eager.includes(path)) found.push(path);
    }
  }
  // Sorted for a stable read, and sorting is honest here in a way it would not
  // have been for `index.css`: these are separate chunk stylesheets, appended
  // after the entry sheet in whatever order the player opens games, so the
  // browser does not fix an order between them either. Nothing may depend on
  // one -- every one of these files is prefixed to its own game.
  return [...new Set(found)].sort();
}

/**
 * The whole stylesheet as one string: what `index.css` blocks the first paint
 * with, and then the per-board sheets, which is the order a browser ends up in
 * -- a chunk's CSS is appended after the entry sheet's.
 */
const css = [...eager, ...lazySheets()]
  .map((path) => readFileSync(new URL(path, STYLES), 'utf8'))
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
  'wc-submit', // the submit button beside Word Chain's entry field
  'vr-submit', // the answer button beside Vocab Race's entry field
  'vr-give-up', // "I don't know it", under the entry row
  'vr-hint-buy', // spending one of the three, beside it
  'vr-speak-clue', // the spoken clue itself, on a listening round
  'vr-speak-small', // replaying the answer, on the reveal
  'yz-pick',
  'gh-give-up', // giving the round up, under Superghost's keyboard
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
    // Quotes kept, so `harvest` below reads a plain string the same way it
    // reads the strings inside an expression. Stripping them here made
    // `harvest`'s quote-seeking regex find nothing, and every
    // `className="plain-string"` button in every board was silently exempt.
    return end === -1 ? null : tag.slice(from, end + 1);
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
 * The hero's well, held to being a crop.
 *
 * Past 900px the featured card turns on its side and its well stops being 5:2:
 * `aspect-ratio` comes off, and the art is told to fill the height of the row
 * instead. Which works only while the row *has* a height. Without one,
 * `height: 100%` resolves against nothing, the well takes the size of the
 * pieces inside it, and the crop stops cropping -- measured at 1280 that was a
 * Connect Four board 107px to a disc inside a hero 673px tall, which is the
 * emblem every motif here was rewritten to stop being.
 *
 * Three declarations carry it and all three look removable. The failure is
 * also invisible below 900px, which is where anybody would be looking.
 */
describe('the hero well', () => {
  const wide = css
    .slice(
      css.indexOf('.app.setup:has(.shelves) .game.featured {'),
      css.indexOf('/* Why this card is the big one'),
    )
    // Comments out, because these rules are half commentary and a declaration
    // is being distinguished from a longhand of itself below.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  it('gives the turned hero a definite height, so the well can crop', () => {
    // `[;{]` and not a bare `height:`, so a `min-height` -- which loses to the
    // content and would not make the row definite -- cannot pass this.
    expect(wide).toMatch(/\.game\.featured\s*\{[^}]*[;{]\s*height:\s*\d+px/s);
  });

  it('drops the 5:2 ratio only where that height is there to replace it', () => {
    const art = wide.slice(wide.indexOf('.game.featured .art'));
    expect(art).toContain('aspect-ratio: auto');
    expect(art).toContain('height: 100%');
    // The bug this project has already shipped once: an unreset `min-height`
    // beats `aspect-ratio`, and 44px of it comes from the button rule.
    expect(art).toContain('min-height: 0');
  });

  /*
    One scale for the whole motif, on the card that draws it at two sizes.

    `cqw` answers with the width of the nearest *ancestor* container, and an
    element's own `container-type` does not change that. So on the hero -- the
    one card whose well is not its own width -- the well's grid was being laid
    out against the card while the pieces standing in it were sized against the
    well: tracks nearly twice the size of the pieces filling them, which is
    eight loose squares where Battleships' sea should be.

    Both now come from `--well-share`, which is also the width of the column
    the well sits in. The two have to be the same number or the split comes
    back, so the test is that one value feeds both.
  */
  it('draws the hero motif and its tracks at one scale', () => {
    expect(wide).toMatch(/--well-share:\s*(\d+)\s*;/);
    const share = wide.match(/--well-share:\s*(\d+)\s*;/)![1];
    // The column the well occupies, and the unit the motif inside it is drawn
    // in, both read the same custom property rather than restating the number.
    expect(wide).toContain('var(--well-share) * 1%');
    expect(wide).toMatch(/--m:\s*calc\(1cqw \* var\(--well-share\) \/ \d+\)/);
    expect(Number(share)).toBeGreaterThan(0);
    expect(Number(share)).toBeLessThan(100);
  });

  /*
    An SVG in a box its viewBox does not match either crops or shrinks, and the
    default is to shrink. Two motifs are drawn in SVG, and on the hero they are
    the two that can fail rule 1 silently -- at one breakpoint, on one card.
  */
  it('makes every SVG motif crop rather than shrink', () => {
    // The whole of `art.tsx`: it is nothing but marks and motifs, so there is
    // no longer a shell to slice away. The mark is not a motif -- it is a
    // fixed-aspect glyph sized in `em` beside the wordmark, and cropping it
    // would crop the logo rather than fill a box -- and it is filtered below.
    // Every other SVG in the file is drawn into a card and must fill it.
    const art = readFileSync(new URL('./art.tsx', import.meta.url), 'utf8');
    const svgs = [...art.matchAll(/<svg[^>]*>/g)]
      .map((m) => m[0])
      .filter((svg) => !svg.includes('className="logo"'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg, svg).toContain('preserveAspectRatio="xMidYMid slice"');
    }
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

    const art = readFileSync(new URL('./art.tsx', import.meta.url), 'utf8');
    // The switch itself, not the whole file: `case "wordchain"` appears in
    // other switches keyed by the same ids, and a motif is only a motif if it
    // is in this one.
    const motif = art.slice(art.indexOf('function motif('));
    expect(motif).toContain('switch (gameId)');
    const drawn = [...motif.matchAll(/case "([a-z0-9]+)":/g)].map((m) => m[1]).sort();
    expect(drawn).toEqual(games);

    const styled = [...css.matchAll(/\.art-([a-z0-9]+)\b/g)].map((m) => m[1]);
    expect([...new Set(styled)].sort()).toEqual(games);
  });
});

/**
 * The lobby bar's brand, which is the half of it people recognise.
 *
 * It shipped as one line of type at 1.4rem beside a name chip capped at 46vw,
 * and at 375px it read "REBE...". Stacked over two lines it fits at 320 with a
 * twenty-character name beside it, but only because three things hold: the
 * heading can shrink, it clips what is left, and the chip gives way first.
 *
 * Measured in the browser once and pinned here, because the failure is one
 * viewport wide and nobody re-measures a bar they did not touch.
 */
describe('the lobby bar', () => {
  // Every block for a selector, joined: `.whoami` is written twice, once for
  // the chip shape it shares and once for what is its own.
  const rule = (selector: string) => {
    const head = selector + ' {';
    const blocks: string[] = [];
    for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
      blocks.push(css.slice(at, css.indexOf('}', at)));
    }
    expect(blocks.length, selector).toBeGreaterThan(0);
    return blocks.join(' ');
  };

  it('lets the brand shrink and clips what is left', () => {
    const heading = rule('.lobby-bar .wordmark');
    expect(heading).toContain('min-width: 0');
    expect(heading).toContain('overflow: hidden');
  });

  it('caps the name chip below the width the brand needs', () => {
    // 40vw leaves the lockup its full width at 320px. Anything larger and a
    // long name eats "Rebellia" one character at a time.
    expect(rule('.whoami')).toContain('max-width: 40vw');
  });

  /*
    The chip is inside a card now, and the card is what the bar sees. The card
    holds two pills -- the purse and the chip -- so its cap is the pair's,
    while the chip keeps the 40vw measured in a browser and pinned above,
    because that is what the name ellipsises against. Measured at 320 with a
    19-character name: the lockup stays whole and the name is the thing that
    ellipsises, which is the contract.
  */
  it('caps the account card the chip now sits in', () => {
    expect(rule('.account')).toContain('max-width: min(62vw, 360px)');
    // Never shrunk by the bar: the lockup is an image, and an image's flex
    // base size is its natural width -- 1076px for this file -- not the width
    // its 3em height comes to. The bar thought it was overflowing and shrank
    // this card to 84px on a 1280 lobby with 800px of empty bar beside it.
    // The wordmark is the item that gives, which is what its `min-width: 0`
    // and hidden overflow up here were always for.
    expect(rule('.account')).toContain('flex: none');
  });

  /*
    The avatar is a definite square, and that is the other half of the same
    bug. It was `align-self: stretch` with `width: auto` and `aspect-ratio: 1`
    -- height off the flex line, width off the height -- which is a cycle, and
    Chrome resolves it by leaving the avatar out of the chip's max-content
    width. The chip measured 84px and the name came out as "Am", clipped by the
    column rather than ellipsised by the text; 111px from the same markup once
    the square was definite.

    Pinned because both symptoms point away from the cause: what is visibly
    wrong is a name, and nothing about a name mentions the avatar.
  */
  it('gives the chip avatar a definite square rather than an aspect ratio', () => {
    const av = rule('.whoami .av');
    expect(av).toContain('width: 34px');
    expect(av).toContain('height: 34px');
    // The declarations, not the words: the block explains the cycle it
    // replaced, and the explanation is the point of it.
    expect(av).not.toMatch(/^\s*aspect-ratio:/m);
    expect(av).not.toMatch(/^\s*align-self: stretch/m);
  });

  /*
    What the chip is worth, and what it gives up to say it.

    Measured at 320: the bar is 288 wide and the lockup wants 147. The purse
    pill and the chip's avatar are fixed, and the name column is the only
    elastic thing on the row, so the name ellipsises and nothing else moves.
    The old rule hid the name outright at this width; the ellipsis is the
    better half of that trade, because four characters still say which account
    this is and the whole name is on the button's label either way.

    Pinned because the failure is invisible on a desktop viewport: somebody
    widening the purse or the type here would only see it re-break at a width
    they are not looking at.
  */
  it('ellipsises the name rather than dropping it at a phone width', () => {
    const name = rule('.whoami .who');
    expect(name).toContain('text-overflow: ellipsis');
    expect(name).toContain('overflow: hidden');
    const column = rule('.whoami .whocol');
    // A flex item defaults to `min-width: auto` and refuses to shrink below
    // its content, which is how a long name used to take the brand's width.
    expect(column).toContain('min-width: 0');

    const phone = css.slice(css.indexOf('@media (max-width: 400px)'));
    const block = phone.slice(0, phone.indexOf('\n}'));
    // Nothing is hidden at a phone width any more, the purse included: an
    // icon with no figure beside it is a currency nobody has learned yet.
    expect(block).not.toContain('display: none');
    // 41vw is what the pair may have if the lockup is to keep its 147. The
    // card carries it, not the chip, because the purse is inside the card, and
    // the rule sits below `.account` rather than up here with the others --
    // at equal specificity the later block wins, and this one has to.
    // The arithmetic rather than a percentage that matched it at one width:
    // 16px of gutter either side, the 147 the lockup needs to read "Rebellia"
    // whole, and the 8px between them. 133 at 320, 188 at 375, 203 at 390,
    // where a flat 41vw gave 131, 154 and 160 and threw the rest away.
    expect(rule('.account')).toContain('max-width: calc(100vw - 187px)');
  });

  /*
    The bar the level fills is drawn from a variable set per profile, and an
    unset variable has to read as an empty bar rather than a full one: the
    chip is the one place in the app that claims progress nobody asked it to
    prove.
  */
  /*
    The account menu is a dropdown again, and the requirement it lost as a page
    is the one pinned here: as big as it needs to be, hung off the chip, and
    never wider than the phone it is on.

    `width: max-content` between a floor and a ceiling is what "as big as it
    needs to be" is in CSS, and both bounds are `min(...)` against the viewport
    because the same rule is the phone layout -- there is no second one. The
    height is bounded only so a menu taller than the screen scrolls itself
    rather than running off the bottom with no way to reach the end.

    Measured nowhere, because there is nothing to measure: the failure this
    guards is somebody giving the popover a fixed width or a fixed height, and
    that is visible in the stylesheet before it is visible anywhere else.
  */
  it('hangs the account menu off the chip at the size it needs', () => {
    const pop = rule('.acct-pop');
    expect(pop).toContain('position: absolute');
    // Right-aligned: the chip is at the right-hand end of the bar, and this is
    // what keeps the card's left edge inside the gutter at 320.
    expect(pop).toContain('right: 0');
    expect(pop).toContain('width: max-content');
    // Both bounds against the viewport, so 320px needs no rule of its own.
    expect(pop).toContain('max-width: min(340px, calc(100vw - 24px))');
    expect(pop).toContain('min-width: min(260px, calc(100vw - 24px))');
    // No fixed height anywhere: only a cap, and it scrolls when it is hit.
    expect(pop).not.toMatch(/height: (?!auto)/);
    expect(pop).toContain('overflow-y: auto');
  });

  /*
    The chest is an icon button in both headers, and the purse is a readout
    beside it. They were one pill -- chest, balance and a progress bar through
    one border -- so a press on the number and a press on the chest were the
    same press wearing two faces, and the number read as a thing that was
    loading.
  */
  it('keeps the chest square and the purse a readout', () => {
    // The bar is gone. It drew the currency as a thing that was loading, and
    // how close the next chest is belongs on the chest screen, where there is
    // room to say it in words.
    expect(css).not.toContain('.chestbtn-bar');
    const chest = rule('.chestbtn');
    expect(chest).toContain('min-width: 44px');
    expect(chest).toContain('min-height: 44px');
    // No border and no background on the purse: that is what separates a
    // readout from the two pressable things either side of it.
    expect(rule('.pursepill')).not.toContain('border:');
  });

  /*
    Under 360 the chip is the face and nothing else, and it has to be the face
    rather than a column with the name clipped out of it. The card is 133px at
    320 and the purse and the chest take 100 of it; what is left is an avatar
    and a 0px column, which is the "Am" this block was written for. The name is
    on the button's label and on the first row of the panel it opens.
  */
  it('drops the name column rather than clipping it under 360', () => {
    const narrow = css.slice(css.indexOf('@media (max-width: 359px)'));
    const block = narrow.slice(0, narrow.indexOf('\n}\n'));
    expect(block).toContain('.whoami .whocol');
    expect(block).toContain('display: none');
  });

  /*
    The one animation in the app that runs unprompted, and the one rule that
    makes that acceptable. Somebody who has asked for less motion still gets
    the accent border and the badge, which is the whole of the message.
  */
  it('stops the ready chest pulsing for anyone who asked motion to stop', () => {
    // Every reduced-motion block in the sheet, not the tail of the file from
    // the first one: this app has several, and slicing to the end would pass
    // on a rule written anywhere below the first of them.
    const head = '@media (prefers-reduced-motion: reduce) {';
    const blocks: string[] = [];
    for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
      blocks.push(css.slice(at, css.indexOf('\n}', at)));
    }
    const mine = blocks.find((block) => block.includes('.chestbtn[data-ready="yes"]'));
    expect(mine, 'a reduced-motion block covering the chest pill').toBeDefined();
    expect(mine).toContain('animation: none');
  });

  it('empties the level bar when nothing has set its fill', () => {
    expect(rule('.whoami .rank-bar::before')).toContain('var(--fill, 0%)');
  });

  /*
    The bar is down to one control, and everything the second one reached is
    inside the panel it opens. The rows of that panel are the menu items, and
    the smallest type in there is the value carried on the row: `--muted`
    against `--surface`, which is the pairing measured in a browser for the
    link this replaced -- 6.03 dark, 5.32 light. The colour is the thing a
    change would move, so it is the colour that is pinned.
  */
  it('leaves the value on a menu row on the muted token', () => {
    expect(rule('.prof-row-value')).toContain('color: var(--muted)');
  });

  /*
    A menu row is the press target, so it carries the floor every touch target
    in this app is held to. It is a full-bleed row rather than a chip, which is
    exactly the shape that looks fine at any height and is 30px tall.
  */
  it('holds a menu row to the touch-target floor', () => {
    expect(rule('.prof-row')).toContain('min-height: 44px');
  });

  /*
    The brand is now the supplied image, and its height is set in `em` off this
    one font-size -- so the font-size is still what sizes the logo even though
    nothing here is type any more. Left as a font-size because the bar's other
    rules are measured against it, and a stray change to it silently resizes
    the mark; this pins it.
  */
  it('keeps the brand image sized off the bar font-size', () => {
    const mark = rule('.brandmark');
    const size = mark.match(/font-size: ([\d.]+)rem/);
    expect(size, mark).not.toBeNull();
    expect(Number(size![1]) * 16).toBeGreaterThanOrEqual(18.66);
    expect(rule('.brandmark .logo')).toMatch(/height: [\d.]+em/);
  });

  /*
    The wordmark's ink is near black in the file, so stage gets the swapped
    copy. If either palette ends up drawing both, the bar shows the logo twice.
  */
  it('draws exactly one of the two logo files per palette', () => {
    expect(rule(':root[data-palette="stage"] .brandmark .logo.daylight')).toContain('display: none');
    expect(rule(':root[data-palette="stage"] .brandmark .logo.stage')).toContain('display: block');
    expect(rule('.brandmark .logo.stage')).toContain('display: none');
  });
});

/**
 * The one "pick one of these" control, and the two things about it that a
 * single declaration can quietly reverse.
 *
 * It was collected out of Word Chain's language row and Vocab Race's three
 * rows, which had drifted into three looks; the collecting is only worth
 * anything if the collected version cannot drift back. Both rules below are
 * ones the originals had already got wrong in one copy or the other, so
 * neither is hypothetical.
 */
describe('the choice control', () => {
  const choice = css.slice(css.indexOf('.choice-group {'), css.indexOf('.choice-name {'));

  /*
    `--muted` is chosen against `--surface`. The chosen tile is not on
    `--surface` -- it takes a fill to mark itself -- so a note left on `--muted`
    lands at 4.3 in the dark palette and 4.1 in daylight, under AA, on the
    smallest type in the control. Measured in the browser, on both palettes,
    which is the only way this one shows up: nothing about the two declarations
    looks wrong beside each other.
  */
  it('lifts the note off --muted wherever the chosen tile fills', () => {
    const fills = /\.choice\.chosen\s*\{[^}]*background:/.test(css);
    expect(fills).toBe(true);
    const lifted = css.slice(css.indexOf('.choice.chosen .choice-note'));
    expect(lifted).toMatch(/^\.choice\.chosen \.choice-note \{[^}]*color: var\(--ink\)/);
  });

  /*
    `.even` keeps a fixed number of tracks at every width, so at 320 a track is
    under 100px. A grid item's `min-width` defaults to `auto`, which is "as wide
    as my content", and a row of three that will not shrink overflows the phone
    rather than wrapping its words.
  */
  it('lets a fixed-column tile shrink under its own content', () => {
    expect(choice).toMatch(/\.choice-group\.even \.choice \{[^}]*min-width: 0/s);
  });

  /* The thumb target both originals agreed on, and the only reason collecting
     them was safe. */
  it('keeps every tile a thumb target', () => {
    expect(choice).toMatch(/\.choice \{[^}]*min-height: 44px/s);
  });
});


/**
 * The phone widths, and the arithmetic that goes with them.
 *
 * `CLAUDE.md` opens with this: nearly every visual bug reported here has been a
 * phone bug, several of them invert on a desktop viewport, and checking the
 * wide case first has already produced a confident wrong answer more than once.
 * The remedy written there is "reproduce at 320, 375 and 390 before forming a
 * theory", and the remedy has so far been a person, a browser and an afternoon.
 *
 * This is that check, done by arithmetic instead. It cannot see, and for this
 * one bug it does not need to: what goes wrong is a *number* crossing 44, and
 * the number is derivable from the declarations. See `trackAt` for the model
 * and the block at the bottom for what is asserted about it.
 */
const PHONES = [320, 375, 390] as const;

/** One rule, with the media query it was found inside. */
interface Rule {
  selectors: string[];
  body: string;
  /** The `@media` condition it sits in, or '' for the top level. */
  media: string;
}

/**
 * Every rule in the stylesheet, in source order, each carrying its media
 * condition. A brace walk rather than a regex, because the whole point of this
 * pass is which `@media` blocks apply and a regex cannot see that it is inside
 * one.
 */
const RULES: Rule[] = (() => {
  /*
    Comments out first, and this is not tidiness. Half the commentary in this
    stylesheet contains a brace -- a selector being quoted, a snippet being
    contrasted -- and a brace walk that counts those loses its place and comes
    back with rules filed under the wrong media query, or with no rules at all.
    The first cut of this parser reported `.app` as having no padding, which
    made every width below it 32px too generous and quietly wrong.
  */
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out: Rule[] = [];
  const stack: string[] = [];
  let i = 0;
  let head = '';
  while (i < source.length) {
    const ch = source[i];
    if (ch === '{') {
      const at = head.trim();
      if (at.startsWith('@')) {
        stack.push(at.startsWith('@media') ? at.slice('@media'.length).trim() : '');
        head = '';
        i += 1;
        continue;
      }
      const end = source.indexOf('}', i);
      const close = end === -1 ? source.length : end;
      out.push({
        selectors: at.split(',').map((sel) => sel.trim()),
        body: source.slice(i + 1, close),
        media: stack.filter(Boolean).join(' and '),
      });
      head = '';
      i = close + 1;
      continue;
    }
    if (ch === '}') {
      stack.pop();
      head = '';
      i += 1;
      continue;
    }
    head += ch;
    i += 1;
  }
  return out;
})();

/**
 * Whether a media condition holds at this viewport width.
 *
 * Only the width features are evaluated, because the width is the only thing
 * being varied. A condition mentioning anything else -- `prefers-reduced-motion`,
 * `hover` -- is treated as not applying, which is the right default here: those
 * blocks say what happens for somebody who asked for something, and the sizes
 * below are what everybody else gets.
 */
function mediaHolds(condition: string, width: number): boolean {
  if (condition === '') return true;
  if (/\((?!(min|max)-width)/.test(condition)) return false;
  const features = [...condition.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)];
  if (features.length === 0) return false;
  return features.every(([, kind, size]) =>
    kind === 'min' ? width >= Number(size) : width <= Number(size),
  );
}

/**
 * The declarations in force on an element with this class, at this width,
 * last-wins in source order.
 *
 * Specificity is deliberately not modelled, and the shortcut is named rather
 * than hidden: everything asked about below is a single-class rule or the bare
 * `button` element rule, and a cascade solver would be a second implementation
 * of a browser, free to be wrong in a new way. Where specificity has actually
 * decided something here it was worth its own test -- see the disabled-button
 * rule at the top of this file.
 */
function declsAt(target: string, width: number): Map<string, string> {
  const decls = new Map<string, string>();
  for (const rule of RULES) {
    if (!mediaHolds(rule.media, width)) continue;
    if (!rule.selectors.includes(target)) continue;
    for (const [, name, value] of rule.body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
      decls.set(name, value.trim());
    }
  }
  return decls;
}

/** `--bs-gap` and its neighbours, as they resolve at this width. */
function varsAt(width: number): Map<string, string> {
  const vars = new Map<string, string>();
  for (const rule of RULES) {
    if (!mediaHolds(rule.media, width)) continue;
    if (!rule.selectors.some((sel) => sel.startsWith(':root'))) continue;
    for (const [, name, value] of rule.body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars.set(name, value.trim());
    }
  }
  return vars;
}

/** A length in px, following one `var()` and honouring its fallback. */
function px(value: string | undefined, vars: Map<string, string>): number {
  if (value === undefined) return 0;
  const ref = value.match(/var\((--[a-z0-9-]+)(?:\s*,\s*([^)]+))?\)/);
  const text = ref ? vars.get(ref[1]) ?? ref[2] ?? '' : value;
  return Number(text.match(/(-?[\d.]+)px/)?.[1] ?? 0);
}

/** `padding: 18px 16px ...` -- the inline half, doubled. */
function paddingInline(decls: Map<string, string>, vars: Map<string, string>): number {
  const shorthand = decls.get('padding');
  if (shorthand !== undefined) {
    // Split on spaces outside brackets, so `calc(28px + env(...))` stays whole.
    const parts = shorthand.trim().split(/\s+(?![^(]*\))/);
    const inline = parts.length === 1 ? parts[0] : parts[1];
    return px(inline, vars) * 2;
  }
  return px(decls.get('padding-inline'), vars) * 2;
}

/** Columns and gap, for a `repeat(N, 1fr)` track list. */
function tracksOf(decls: Map<string, string>, vars: Map<string, string>) {
  const value = decls.get('grid-template-columns');
  if (value === undefined) return null;
  // `repeat(var(--wh-size, 4), 1fr)` -- the count is set from JS on the element,
  // and the fallback in the stylesheet is the size the game actually plays at.
  // Taking the fallback is taking the stylesheet at its word, which is the only
  // source this test has.
  const repeat = value.match(/repeat\(\s*(?:var\(--[a-z0-9-]+,\s*)?(\d+)/);
  if (!repeat) return null;
  // A fixed track before the repeat -- Battleships' rank gutter -- is width
  // this grid's cells never see.
  const fixed = value
    .slice(0, value.indexOf('repeat('))
    .split(/\s+/)
    .reduce((sum, part) => sum + px(part, vars), 0);
  return { count: Number(repeat[1]), gap: px(decls.get('gap'), vars), fixed };
}

/**
 * How wide one cell of a board's grid comes out at a given viewport width.
 *
 * The chain is `.app` and then whatever wraps the grid: each step gives up its
 * inline padding, and each grid divides what is left between its tracks. It is
 * a model, and it is held to a number somebody arrived at in a real browser --
 * see the cross-check below, where `ultimate.css` records 31px at 320 and this
 * lands in the same place.
 */
function trackAt(chain: readonly string[], width: number): number {
  const vars = varsAt(width);
  const app = declsAt('.app', width);
  let box = Math.min(width, px(app.get('max-width'), vars) || width) - paddingInline(app, vars);
  for (const step of chain) {
    const decls = declsAt(step, width);
    box -= paddingInline(decls, vars);
    const tracks = tracksOf(decls, vars);
    if (tracks) box = (box - tracks.fixed - tracks.gap * (tracks.count - 1)) / tracks.count;
  }
  return box;
}

/**
 * Every class a board puts on a `<button>`.
 *
 * This is the half of the question the stylesheet cannot answer, and getting it
 * wrong would make the test below either useless or a nuisance. `button`
 * carries the app's 44px touch floor and a `<span>` does not, so whether the
 * floor is in play for a tile depends on a file in `games/` and on no
 * declaration anywhere. Letterpress' tile and Word Duel's are spans with a
 * deliberate `aspect-ratio` and no minimum reset, and both are right;
 * Word Hunt's cell is nearly the same three declarations on a button, and is
 * not the same thing at all.
 */
const BUTTON_CLASSES: ReadonlySet<string> = new Set(
  boardSources().flatMap(({ source }) =>
    buttonTags(source).flatMap((tag) => classesIn(tag, source)),
  ),
);

/**
 * The grids a board draws its playing surface with, and the boxes each one sits
 * in. Written out rather than discovered, because the nesting lives in the TSX
 * and the point of the list is to say plainly what is being modelled.
 */
const GRIDS: ReadonlyArray<{ what: string; chain: string[]; cell: string }> = [
  { what: 'Connect Four', chain: ['.board'], cell: '.column' },
  { what: 'Battleships', chain: ['.bs-gridwrap', '.bs-grid'], cell: '.bs-cell' },
  { what: 'Ultimate', chain: ['.ut-board', '.ut-small'], cell: '.ut-cell' },
  { what: 'Word Hunt', chain: ['.wh-grid'], cell: '.wh-cell' },
  { what: 'Letterpress', chain: ['.lp-grid'], cell: '.lp-tile' },
  { what: "the Wheel's keyboard", chain: ['.wof-keys'], cell: '.wof-key' },
];

/**
 * Controls allowed under the 44px floor, and what was bought with the
 * shortfall.
 *
 * The floor is not a guess -- it is the size named on `button` and on the toast
 * close, and it is the number every other control here clears -- so a control
 * under it should be a decision somebody made rather than a number somebody
 * typed. Both halves are tested: a control that falls short without appearing
 * here fails, and an entry here whose control has since grown fails too.
 */
const SHORT_ON_PURPOSE: Record<string, string> = {
  // 40px. `yahtzee.css` has the reasoning: the cell is full-column-width, which
  // does most of the work of making it hittable, and the column narrows with
  // every player who sits down. Thirteen boxes on a sheet that already scrolls
  // grow it by about a hundred pixels for the last four.
  'yz-pick': 'the sheet would grow ~100px on a screen that already scrolls',
};

describe('a board at a phone width', () => {
  it('measures the same board the stylesheet says it measured', () => {
    /*
      The model, checked against the one number in this repo that was arrived at
      by a person looking at a real browser. `ultimate.css` records eighty-one
      squares across a 320px phone coming out at 31px each, and says in the same
      breath that the touch floor is genuinely unreachable there and that the
      alternative to a small square is a board that scrolls. If the arithmetic
      here ever stops landing on that number it is the arithmetic that is wrong,
      and every assertion below it is worth nothing.
    */
    const cell = trackAt(['.ut-board', '.ut-small'], 320);
    expect(cell, `ultimate.css says 31px at 320; this model says ${cell.toFixed(1)}`)
      .toBeGreaterThan(30);
    expect(cell).toBeLessThan(32);
  });

  it('never lets the touch floor decide the size of a cell', () => {
    /*
      The trap this project has sprung twice, and the first test to hold it
      shut.

      `button` carries `min-height: 44px`, and a minimum beats a size set on the
      element. Against `aspect-ratio` on a track narrower than 44px the floor
      wins and takes the width with it. Battleships came out as ten 44px squares
      in 39px columns, overlapping into one solid bar with the gaps buried;
      Ultimate came out as nine 44px squares in 31px columns and buried both
      hashes. Both were found by eye, on a phone, after shipping, and both were
      fixed by resetting the two minimums and making the width definite. Nothing
      has been holding those three declarations in place since.

      Only where the arithmetic says it matters. A cell with room to be 44px
      does not need the reset, and demanding it everywhere would be a rule with
      no visible reason, which is the kind that gets deleted.
    */
    const wrong: string[] = [];
    for (const { what, chain, cell } of GRIDS) {
      if (!BUTTON_CLASSES.has(cell.slice(1))) continue;
      for (const width of PHONES) {
        const track = trackAt(chain, width);
        if (track >= 44) continue;
        const vars = varsAt(width);
        const decls = declsAt(cell, width);
        if (decls.get('aspect-ratio') === undefined) continue;
        const at = `${what} (${cell}) at ${width}px, where the track is ${track.toFixed(1)}px`;
        if (px(decls.get('min-height'), vars) !== 0) {
          wrong.push(`${at}: min-height is ${decls.get('min-height') ?? "the button floor's 44px"}`);
        }
        if (px(decls.get('min-width'), vars) !== 0) {
          wrong.push(`${at}: min-width is ${decls.get('min-width') ?? 'unset'}`);
        }
        if (decls.get('width') !== '100%') {
          // Without a definite width the ratio has nothing to derive the height
          // from, and which way round an engine resolves that stops being
          // something this stylesheet decides.
          wrong.push(`${at}: its width is not 100%`);
        }
      }
    }
    expect(
      wrong,
      'a button narrower than the 44px touch floor, carrying an `aspect-ratio` ' +
        'the floor will beat. Reset `min-width` and `min-height` to 0 and give ' +
        `it \`width: 100%\`, as .bs-cell and .ut-cell do.\n  ${wrong.join('\n  ')}`,
    ).toEqual([]);
  });

  it('keeps a control a finger can land on, at every phone width', () => {
    /*
      The other direction, and the one a media query breaks rather than the
      cascade. A control is a word in a box beside the board -- Spin, Fire,
      Submit -- and there is always room for one of those to be 44px tall, so a
      phone width that shrinks one is a mistake and never a compromise. Cells
      are deliberately not in this list: eighty-one of them do not fit, which is
      what the test above is about.
    */
    const short: string[] = [];
    for (const control of CONTROLS) {
      if (control in SHORT_ON_PURPOSE) continue;
      for (const width of PHONES) {
        const decls = declsAt(`.${control}`, width);
        const floor = decls.has('min-height')
          ? px(decls.get('min-height'), varsAt(width))
          : px(declsAt('button', width).get('min-height'), varsAt(width));
        if (floor < 44) short.push(`.${control} at ${width}px is ${floor}px`);
      }
    }
    expect(
      short,
      "a control shorter than the app's 44px touch floor. If the shortfall is " +
        'the price of something -- a sheet that would otherwise grow a hundred ' +
        'pixels -- say so in SHORT_ON_PURPOSE. Otherwise it is a control a ' +
        `thumb misses: ${short.join(', ')}`,
    ).toEqual([]);
  });

  it('has no excuse left over for a control that grew back to full size', () => {
    // The other half of the bargain above. An exception outlives the layout it
    // was granted for, and a list of reasons nobody rechecks is how the floor
    // quietly becomes advisory.
    const stale: string[] = [];
    for (const control of Object.keys(SHORT_ON_PURPOSE)) {
      const floors = PHONES.map((width) => {
        const decls = declsAt(`.${control}`, width);
        return decls.has('min-height')
          ? px(decls.get('min-height'), varsAt(width))
          : px(declsAt('button', width).get('min-height'), varsAt(width));
      });
      if (floors.every((floor) => floor >= 44)) stale.push(`.${control}`);
    }
    expect(
      stale,
      `${stale.join(', ')} clears 44px at every phone width now. Drop it from ` +
        'SHORT_ON_PURPOSE, so the next one that falls short is noticed.',
    ).toEqual([]);
  });

  it('gives the app a wider content box on a wider phone', () => {
    // Guards the model rather than the stylesheet. Three widths that all came
    // back the same number would mean the width was reaching nothing, and every
    // assertion above would be one assertion run three times over.
    const boxes = PHONES.map((width) => trackAt([], width));
    expect(new Set(boxes).size, `all three widths measured ${boxes[0]}px`).toBe(3);
  });
});

describe('the chest screen at a phone width', () => {
  /*
    The chest grid is `auto-fill` over a minimum, which `trackAt` cannot model:
    it solves a known column count and `auto-fill` decides one from the width.
    So this asserts the two things that actually go wrong on a 320 phone rather
    than pretending to measure a track.
  */

  it('cannot overflow the narrowest phone, whatever the minimum is', () => {
    /*
      `minmax(13rem, 1fr)` on its own overflows a 320px viewport once the app's
      padding is counted, and it does it silently: the page grows a horizontal
      scrollbar and every card is cut off at the same place. Wrapping the
      minimum in `min(100%, ...)` is the whole fix, and it is one easily lost
      to a tidy-up that reads it as redundant.
    */
    const grid = declsAt('.chest-grid', 320).get('grid-template-columns') ?? '';
    expect(grid, '.chest-grid has no columns').not.toBe('');
    expect(grid, `${grid} can be wider than the phone it is on`).toMatch(/min\(\s*100%/);
  });

  it('keeps every control on it above the touch floor', () => {
    // The screen is reached from a menu on a phone and its whole job is to be
    // pressed. `min-height` rather than `height`, so a label that wraps grows
    // the button instead of clipping it.
    for (const control of ['.chest-open', '.chest-retry']) {
      const decls = declsAt(control, 320);
      const floor = px(decls.get('min-height'), varsAt(320));
      expect(floor, `${control} is ${floor}px tall`).toBeGreaterThanOrEqual(44);
    }
  });

  it('never gives a pressable thing an aspect ratio', () => {
    /*
      The trap CLAUDE.md opens with, checked here for the one screen that mixes
      square art with buttons. `button` carries `min-height: 44px`; a minimum
      beats `aspect-ratio`, so a square control narrower than 44px comes out
      44px tall in a narrower column and overlaps its neighbours. The art on
      this screen is square on purpose, so the rule is that the square things
      are not the pressable things.
    */
    for (const square of ['.chest-art', '.chest-drop-art']) {
      const decls = declsAt(square, 320);
      expect(decls.get('aspect-ratio'), `${square} should be square`).toBe('1');
      expect(
        BUTTON_CLASSES.has(square.slice(1)),
        `${square} is square and pressable, which is the overlap bug`,
      ).toBe(false);
    }
  });

  it('reveals the drop in an order, and lets it all through at once', () => {
    /*
      The order is `roll.css`'s now, because the gacha buys the same thing for
      the same hundred and used to arrive in one pop. So this reads the shared
      classes: what the chest's markup wears is asserted where the markup is.
    */
    /*
      The reveal is staged: the panel, then the item with an overshoot, then
      what it was and what it left. It is spelled with `animation-delay` rather
      than timers precisely so it can be asserted here -- the Browser pane never
      composites a frame, so nobody can look at this, and an unlooked-at
      animation is one a tidy-up deletes.

      The delays are asserted as an *order* rather than as four numbers, because
      the numbers are taste and the order is the design. What is not taste is
      that every one of them ends up visible: `both` is what holds the item on
      screen after its 420ms is up, and losing it is an item that flashes and
      goes.
    */
    const stages = ['.roll-panel', '.roll-land', '.roll-say', '.roll-say-late'];
    const delays = stages.map((stage) => {
      const shorthand = declsAt(stage, 320).get('animation') ?? '';
      expect(shorthand, `${stage} does not animate`).not.toBe('');
      expect(shorthand, `${stage} does not hold its end state`).toMatch(/\bboth\b/);
      // Two durations in the shorthand: the second time is the delay.
      const times = [...shorthand.matchAll(/([\d.]+)ms/g)].map((hit) => Number(hit[1]));
      return times.length > 1 ? times[1] : 0;
    });

    for (let i = 1; i < delays.length; i++) {
      expect(
        delays[i],
        `${stages[i]} at ${delays[i]}ms does not follow ${stages[i - 1]} at ${delays[i - 1]}ms`,
      ).toBeGreaterThan(delays[i - 1]);
    }
    // And the whole of it is over inside a second. A reveal somebody has to
    // wait out is one they learn to press through, and they open several in a
    // row.
    expect(delays[delays.length - 1]).toBeLessThan(1000);
  });

  it('stops every one of them for somebody who asked it to', () => {
    /*
      The spin repeats forever, which is exactly the shape this setting exists
      for, and the staged reveal withholds a present from somebody who has said
      they do not want things moving. Nothing is lost by dropping them: the
      order goes, and it is all there at once.

      One list, covering both spends. It used to be two -- this block and a
      near-identical one for the gacha further down -- and two lists of the
      same thing are two chances to update one of them.
    */
    // Read off the source rather than through `declsAt`, which models width and
    // nothing else on purpose. Same shape as the toast's rule above.
    const block = /@media \(prefers-reduced-motion: reduce\) \{([^}]*\{[^}]*\}[^}]*)*?\}\s*\}/g;
    const quiet = [...css.matchAll(block)].map((hit) => hit[0]).join(' ');
    for (const stage of [
      '.roll-art-spin',
      '.roll-panel',
      '.roll-land',
      '.roll-say',
      '.roll-say-late',
    ]) {
      expect(quiet, `${stage} still moves`).toContain(stage);
    }
    expect(quiet).toMatch(/\.roll-say-late \{\s*animation:\s*none/);
    expect(quiet).toMatch(/\.roll-art-spin \{\s*filter:\s*none/);
  });
});

/*
  The gacha, at the three phone widths.

  Two shapes on this screen can cross the number CLAUDE.md opens with. The
  showcase is a fixed three-column grid that must not collapse, so a third of a
  320px phone has to stay a legal touch target; and the collection tiles are
  buttons wrapping a portrait, which is the exact arrangement where
  `min-height: 44px` beats `aspect-ratio` and takes the width with it.

  Measured rather than looked at, for the reason the block above gives at
  length: what goes wrong is a number crossing 44, and the number is derivable
  from the declarations.
*/
describe('the lobby seat list', () => {
  it('leaves a name room to be read beside the figure and the faces', () => {
    /*
      The trap CLAUDE.md opens with, in the one place this change could spring
      it. The seat carries three fixed-width things now -- a 44px figure and a
      fan of three 34px faces -- and only the name gives.

      This is why the list went to one column at a phone width. The same
      arithmetic on the old two-column grid leaves a name about 10px, which is
      not an ellipsis, it is nothing; the assertion below is what says so
      rather than somebody looking at it later.

      Measured rather than looked at. What the browser is left for the name is
      the track, less the card's padding, less the figure and the gaps, less
      the strip.
    */
    for (const width of PHONES) {
      const vars = varsAt(width);
      const card = declsAt('.player', width);
      const face = px(declsAt('.seat-face', width).get('width'), vars);
      const overlap = px(declsAt('.seat-face + .seat-face', width).get('margin-inline-start'), vars);
      const figure = px(declsAt('.seat-figure', width).get('width'), vars);
      const gap = px(card.get('gap'), vars);

      const strip = face * 3 + overlap * 2;
      const seat = trackAt(['.seats'], width);
      const name = seat - paddingInline(card, vars) - figure - gap * 2 - strip;

      // Enough for a short name and an ellipsis rather than an initial. Six
      // characters of the 0.88rem this row is set in, which is "Amelia".
      expect(name, `a name has ${name.toFixed(1)}px at ${width}`).toBeGreaterThanOrEqual(52);
    }
  });

  /*
    The two things the seat list exists to show are the two things that used to
    be too small to see, so their sizes are pinned rather than left to drift
    back: an avatar nobody could make out and three 18px beads were the state
    this change was asked to fix.
  */
  it('draws the figure and the faces at a size somebody can read', () => {
    for (const width of PHONES) {
      const vars = varsAt(width);
      // 44, the number this stylesheet is already full of, used here as a
      // measurement rather than as a touch target: a seat is not pressable.
      expect(px(declsAt('.seat-figure', width).get('width'), vars)).toBeGreaterThanOrEqual(44);
      expect(px(declsAt('.seat-face', width).get('width'), vars)).toBeGreaterThanOrEqual(32);
      // Square, both of them. A frame of the wrong shape does not letterbox
      // the avatar's stage, it stretches it -- see `Avatar.tsx`.
      expect(declsAt('.seat-figure', width).get('height')).toBe(
        declsAt('.seat-figure', width).get('width'),
      );
      expect(declsAt('.seat-face', width).get('height')).toBe(
        declsAt('.seat-face', width).get('width'),
      );
    }
  });

  /*
    And the reason both of the above are affordable: one seat per row at a
    phone width. A grid that goes back to two columns takes the name below an
    initial, which the test above would catch -- this one names the cause, so
    the failure says what to change rather than only what broke.
  */
  it('gives a seat a whole row at a phone width', () => {
    for (const width of PHONES) {
      expect(declsAt('.seats', width).get('grid-template-columns')).toBe('minmax(0, 1fr)');
    }
  });
});

describe('the account menu', () => {
  it('leaves the collection row mostly words', () => {
    /*
      The row is a label, a value and a strip of faces, and only the value
      gives: `.prof-row-value` is the ellipsised half and the strip is
      `flex: none`. So the strip has to be small enough that "2 of 3 on show"
      is still readable beside it on the narrowest phone. A third of the row is
      the line drawn here, which at 320 is about 96px against a strip of 60.

      Not a touch-target check: the whole row is the button and it carries the
      44px floor already. This is about the words.
    */
    for (const width of PHONES) {
      const vars = varsAt(width);
      const face = px(declsAt('.prof-row-face', width).get('width'), vars);
      const overlap = px(
        declsAt('.prof-row-face + .prof-row-face', width).get('margin-inline-start'),
        vars,
      );
      const row = declsAt('.prof-row', width);
      const inner = trackAt([], width) - paddingInline(row, vars);
      const strip = face * 3 + overlap * 2;
      expect(strip, `the strip is ${strip}px of a ${inner.toFixed(1)}px row at ${width}`)
        .toBeLessThanOrEqual(inner / 3);
    }
  });
});

/*
  The pull dialog, at the three phone widths.

  It is a fixed-width panel inside a fixed-position ground, so the one number
  that can go wrong is what is left for the row of three buttons at the bottom
  of the narrowest phone. Two of them share whatever the roll does not take,
  and both are touch targets.

  The portrait is checked the way every other portrait in this app is: the
  ratio has to be on the image, because `button` carries `min-height: 44px` and
  a minimum beats `aspect-ratio`. See CLAUDE.md.
*/
describe('the pull dialog', () => {
  it('leaves both ways out wide enough to press', () => {
    /*
      `px` above reads pixels, and every length in this dialog is in rem --
      it is a panel rather than a board, so it is set in the type scale like
      the rest of the chrome. Sixteen to the rem is the root size `base.css`
      leaves alone, and the arithmetic below is the browser's.
    */
    const rem = (value: string | undefined): number =>
      value === undefined ? 0 : Number(value.match(/(-?[\d.]+)rem/)?.[1] ?? 0) * 16;
    const padding = (decls: Map<string, string>): number => {
      const parts = (decls.get('padding') ?? '').trim().split(/\s+/);
      return rem(parts.length === 1 ? parts[0] : parts[1]) * 2;
    };

    for (const width of PHONES) {
      const ground = declsAt('.gacha-back', width);
      const panel = declsAt('.gacha', width);
      const acts = declsAt('.gacha-acts', width);
      // min(24rem, 100%) of what the ground leaves, less the panel's padding.
      const outer = width - padding(ground);
      const inner = Math.min(24 * 16, outer) - padding(panel);
      // The roll takes the whole first row; the other two split the second.
      const each = (inner - rem(acts.get('gap'))) / 2;
      expect(each, `a secondary is ${each.toFixed(1)}px at ${width}`).toBeGreaterThanOrEqual(44);
    }
  });

  it('puts the portrait ratio on the image and never on a button', () => {
    expect(declsAt('.gacha-art', 320).get('aspect-ratio')).toBe('3 / 4');
    for (const button of ['.gacha-roll', '.gacha-shelf', '.gacha-close']) {
      expect(declsAt(button, 320).get('aspect-ratio'), `${button} sets a ratio`).toBeUndefined();
      expect(px(declsAt(button, 320).get('min-height'), varsAt(320)) || 44).toBeGreaterThanOrEqual(44);
    }
  });

  it('takes its movement from the shared file and keeps none of its own', () => {
    /*
      The pull and the chest are the same hundred GP spent on the same press,
      and they moved like two different apps until `roll.css`. This is the
      guard on that: a bespoke keyframe or a second reduced-motion answer in
      here is exactly how they drifted the first time, and the stillness itself
      is asserted once, in the chest block above, on the shared classes.

      The face swap stays a JavaScript ticker and is skipped in the component
      as well -- it is the one timeline in this app, because CSS cannot walk a
      list of portraits -- but its pacing is `roll.ts`, shared too.
    */
    /*
      The file itself, rather than a slice of the concatenation. It used to be
      `css.slice(indexOf('.gacha-back'), indexOf('.waifu-back'))`, and there is
      no `.waifu-back` anywhere in this app: that second index was -1, so the
      slice ran from the gacha to the end of the whole stylesheet, and the test
      passed only because `gacha.css` happened to be the last @import. It is
      not last any more -- the game sheets are appended after it now -- and the
      first thing it did was fail on a reduced-motion block belonging to a
      game. Reading the one file asks the question the comment above says it is
      asking, and cannot be moved again by a change to the running order.
    */
    const own = readFileSync(new URL('gacha.css', STYLES), 'utf8');
    expect(own, 'the gacha grew a keyframe of its own again').not.toContain('@keyframes gacha-');
    expect(own, 'the gacha answers reduced motion twice').not.toContain(
      'prefers-reduced-motion',
    );
  });
});

describe('the collection screen', () => {
  it('keeps three showcase slots on a row at every phone width', () => {
    for (const width of PHONES) {
      const slot = trackAt(['.waifu', '.waifu-showcase'], width);
      // The floor every touch target in this app is held to. A slot is a
      // button, and a third of the narrowest phone is where this is tightest.
      expect(slot, `a showcase slot is ${slot.toFixed(1)}px at ${width}`).toBeGreaterThanOrEqual(44);
    }
  });

  it('never lets the showcase drop to fewer than three columns', () => {
    // The empty outlines are the sentence "there are three of these and you
    // have one". A row that wrapped on a narrow phone would stop saying it, so
    // the column count is pinned rather than left to `auto-fill`.
    for (const width of PHONES) {
      expect(declsAt('.waifu-showcase', width).get('grid-template-columns')).toBe(
        'repeat(3, 1fr)',
      );
    }
  });

  it('puts the portrait ratio on the image and never on the button', () => {
    /*
      The trap this whole file exists for. `button` carries `min-height: 44px`,
      a minimum beats `aspect-ratio`, and a tile whose ratio lived on the
      button would square up on a desktop and go tall and thin on a phone from
      one declaration. Asserted both ways round: the image has it, and neither
      button that contains one does.
    */
    expect(declsAt('.waifu-art', 320).get('aspect-ratio')).toBe('3 / 4');
    for (const button of ['.waifu-tile', '.waifu-slot-full']) {
      expect(declsAt(button, 320).get('aspect-ratio'), `${button} sets a ratio`).toBeUndefined();
    }
  });

  it('leaves a collection tile wide enough to press', () => {
    for (const width of PHONES) {
      const tile = trackAt(['.waifu', '.waifu-grid'], width);
      expect(tile, `a tile is ${tile.toFixed(1)}px at ${width}`).toBeGreaterThanOrEqual(44);
    }
  });

  it('reveals a pull in an order, and lets it all through at once', () => {
    /*
      The same bargain the chest reveal above strikes, and deliberately the
      same numbers: the two screens spend one balance and sit beside each other
      in the menu, so a pull landing at a different tempo from a drop would
      read as a different app.

      An order rather than four numbers, because the numbers are taste. `both`
      is not taste: it is what holds the face on screen after its 420ms is up,
      and losing it is a character who flashes and goes.
    */
    const stages = [
      '.waifu-reveal',
      '.waifu-reveal .waifu-art',
      '.waifu-reveal .waifu-pull-name',
      '.waifu-reveal .waifu-pull-acts',
    ];
    const delays = stages.map((stage) => {
      const shorthand = declsAt(stage, 320).get('animation') ?? '';
      expect(shorthand, `${stage} does not animate`).not.toBe('');
      expect(shorthand, `${stage} does not hold its end state`).toMatch(/\bboth\b/);
      const times = [...shorthand.matchAll(/([\d.]+)ms/g)].map((hit) => Number(hit[1]));
      return times.length > 1 ? times[1] : 0;
    });
    for (let i = 1; i < delays.length; i++) {
      expect(
        delays[i],
        `${stages[i]} at ${delays[i]}ms does not follow ${stages[i - 1]} at ${delays[i - 1]}ms`,
      ).toBeGreaterThan(delays[i - 1]);
    }
    // Over inside a second, for the reason the chest's twin gives: somebody
    // rolls several in a row and learns to press through anything longer.
    expect(delays[delays.length - 1]).toBeLessThan(1000);
  });

  it('stops the reveal for somebody who asked it to', () => {
    /*
      The blocks are found by counting braces rather than by the pattern the
      chest's twin above uses. That one needs two rules inside a block to
      match, which is an accident of the regex rather than anything about the
      CSS, and it silently finds nothing for a block holding one rule -- a test
      that passes by looking at the wrong text is worse than no test.
    */
    const quiet = reducedMotionBlocks(css).join(' ');
    for (const stage of [
      '.waifu-reveal',
      '.waifu-reveal .waifu-art',
      '.waifu-reveal .waifu-pull-name',
      '.waifu-reveal .waifu-pull-acts',
    ]) {
      expect(quiet, `${stage} still moves`).toContain(stage);
    }
  });

  it('gives a portrait a ground to arrive on', () => {
    // AniList is a third-party CDN and a slow one is the ordinary case on a
    // phone. Without this the grid is a field of holes while it loads.
    expect(declsAt('.waifu-art', 320).get('background')).toBe('var(--rule)');
  });
});

/**
 * Every `prefers-reduced-motion: reduce` block in the sheet, as text.
 *
 * Brace-counted, because a block is nested rules and a regex over `[^}]` can
 * only ever guess at how many. Comments are not stripped: nothing in this
 * sheet puts a brace in one, and the callers only ever ask whether a selector
 * is named in here.
 */
function reducedMotionBlocks(sheet: string): string[] {
  const found: string[] = [];
  const opener = /@media \(prefers-reduced-motion: reduce\) \{/g;
  for (const hit of sheet.matchAll(opener)) {
    let depth = 1;
    let at = hit.index + hit[0].length;
    while (at < sheet.length && depth > 0) {
      if (sheet[at] === '{') depth++;
      else if (sheet[at] === '}') depth--;
      at++;
    }
    found.push(sheet.slice(hit.index, at));
  }
  return found;
}

/**
 * Every game's stylesheet is loaded by something.
 *
 * The cost of moving thirteen sheets out of `index.css` and into their boards:
 * the running order used to be one list somebody would notice a game missing
 * from, and now the import sits in the board file where a new game gets copied
 * from a neighbour and edited. Forgetting it is not subtle -- the whole board
 * draws unstyled -- but it is exactly the sort of thing that reaches a phone
 * rather than a test, so it is a test.
 */
describe('every game sheet', () => {
  it('is imported by its own board, or is still in the running order', () => {
    const loaded = new Set([...eager, ...lazySheets()]);
    const orphans = readdirSync(new URL('games/', STYLES))
      .filter((name) => name.endsWith('.css'))
      .map((name) => `games/${name}`)
      .filter((path) => !loaded.has(path));

    expect(
      orphans,
      `nothing loads ${orphans.join(', ')}. A game's sheet is imported at the ` +
        'top of its board component, so that it rides in that chunk, or ' +
        'listed in `styles/index.css` if something outside the game reads it.',
    ).toEqual([]);
  });
});
