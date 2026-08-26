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
  'wc-submit', // the submit button beside Word Chain's entry field
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
    The second word is set in the channel colour, which clears 3:1 against the
    ground but not 4.5:1. Bold at 20px it is large text, where 3:1 is the bar
    it has to clear; below 18.66px it is not, and the same colour quietly
    fails.
  */
  it('keeps the accented word at large-text size', () => {
    const mark = rule('.brandmark');
    const size = mark.match(/font-size: ([\d.]+)rem/);
    expect(size, mark).not.toBeNull();
    expect(Number(size![1]) * 16).toBeGreaterThanOrEqual(18.66);
    expect(mark).toContain('font-weight: 700');
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
