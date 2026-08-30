import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { PUZZLES } from '../shared/games/wheel.js';
import { EN_SOURCE, JA_SOURCE, PL_SOURCE } from '../shared/games/chainWords.js';

/**
 * The one property in this project that a passing unit-test suite cannot
 * detect. Wheel of Fortune's secrecy rests on the client never importing a
 * runtime binding from `wheel.ts`; every other test in the repo would still
 * pass on the day someone adds one and ships every answer in the bank to the
 * browser. So this builds the real client and reads the real output.
 *
 * It greps for the answers themselves rather than for a module name, because
 * the failure that matters is an answer reaching a player's devtools, however
 * it got there.
 */

const out = mkdtempSync(join(tmpdir(), 'bundle-check-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

let built: string | null = null;

/**
 * The build, once. Every test here asks a different question of the same
 * artifact, and the build is the entire cost of the file: five of them was
 * 135s of a 300s suite, one is about 25s. Cached rather than done in a
 * `beforeAll` so that the tests still read as self-contained.
 */
function buildClient(): string {
  if (built !== null) return built;
  // Vite's own entry under the running Node binary: no shell (so arguments are
  // escaped, not concatenated) and no .cmd shim, which Windows Node refuses to
  // spawn without one.
  const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
  execFileSync(process.execPath, [vite, 'build', '--outDir', out, '--emptyOutDir'], {
    stdio: 'pipe',
  });
  const assets = join(out, 'assets');
  built = readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n');
  return built;
}

it('ships no puzzle answer to the browser', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  const leaked = PUZZLES.filter((p) => bundle.includes(p.answer)).map((p) => p.answer);
  expect(leaked).toEqual([]);
});

/**
 * A category is the other half of a puzzle and would narrow the answer just as
 * well, so it is asked for separately from the answers.
 *
 * Whole words, not substrings. Every single-word category here is an ordinary
 * English noun: `Phrase`, `Place`, `Thing`, `Nature`, `Weather`. A plain
 * `includes` asks whether those letters appear anywhere in a megabyte of
 * minified client, which is a question with only one answer, and it duly cried
 * wolf the day Vocab Race shipped the mode label `'Phrases'`. Nothing had
 * leaked; `Phrase` is a prefix of `Phrases`.
 *
 * That matters more than one red test. A check that fails on innocent copy
 * gets muted or deleted, and then it is not there on the day something really
 * does leak. A leaked category reaches the bundle as its own string, so a word
 * boundary keeps the whole guarantee and drops the collisions.
 */
it('ships no puzzle category or reducer to the browser', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  // `applyMove` is the reducer entry point.
  expect(bundle).not.toContain('applyMove');
  const categories = [...new Set(PUZZLES.map((p) => p.category))];
  const leaked = categories.filter((c) => {
    // `Food & Drink` and `What Are You Doing?` carry regex metacharacters, and
    // \b before `&` or after `?` would anchor against the wrong side.
    const body = c.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
    const open = /^\w/.test(c) ? '\\b' : '';
    const close = /\w$/.test(c) ? '\\b' : '';
    return new RegExp(`${open}${body}${close}`).test(bundle);
  });
  expect(leaked).toEqual([]);
});

/**
 * Word Duel has no secret answer to leak, players bringing their own words, but
 * the same import boundary is load-bearing for a different reason: the word
 * list is by far the largest thing in the repo, it is needed only to validate
 * a move, and moves are validated on the server. One convenience import in
 * `WordleBoard.tsx` would put the entire dictionary on the phone of every
 * player who opens the lobby.
 *
 * A run of consecutive entries, the same needle the chain list uses below, and
 * for the same reason: any single word is ordinary English and hits on nothing
 * in particular. This test used to say it checked runs and then check words,
 * because `WORD_SOURCE` is `RAW.join(' ')` and splitting a space-joined string
 * on newlines hands back one word per line. It failed on `zyme`, four letters
 * that turn up inside minified output by accident, while `about` and `crane`
 * sat in the same list waiting their turn.
 *
 * The runs come from the template literals in the source file rather than from
 * `WORD_SOURCE`, because that binding is not a literal: it is `RAW.join(' ')`,
 * and a run that straddled two entries of `RAW` would carry a space where the
 * bundle carries a newline, match nothing whatever, and pass forever while the
 * dictionary shipped. That is not hypothetical; slicing the joined string is
 * what this test did first and one of its three offsets landed on a seam. What
 * is in the bundle, if anything is, is the literal.
 */
it('ships no word list to the browser', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  /*
    Read as the bundle will hold it, not as git checked it out. A template
    literal's CRLF is normalised to LF by the language itself, so on a Windows
    working copy every run taken from the file has a `\r` in it that the bundle
    does not, and matches nothing. That is not a guess: the first version of
    this needle was verified by adding the import on purpose, and it sailed
    through green while a 5.2MB bundle sat on disk with the whole dictionary in
    it. Exactly the failure the file exists to prevent, in the check itself.
  */
  const source = readFileSync(
    fileURLToPath(new URL('../shared/games/words.ts', import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
  // Odd segments of a split on backticks are the template bodies; the long
  // ones are the word blocks, and the short ones are things like `${MODERN}`.
  const blocks = source.split('`').filter((body, i) => i % 2 === 1 && body.length > 1000);
  expect(blocks.length).toBeGreaterThan(2);
  const runs = [0, Math.floor(blocks.length / 2), blocks.length - 1].map((i) =>
    blocks[i].slice(500, 800),
  );
  expect(runs.filter((run) => bundle.includes(run))).toEqual([]);
});

/**
 * Word Chain has no secret to leak either, and the same boundary matters for
 * the same reason it does for Word Duel, only more so: its three lists are the
 * second largest thing in the repo, they exist to validate a move, and moves
 * are validated on the server. One convenience import in `WordChainBoard.tsx`
 * would put thirty thousand Polish inflections and twelve thousand Japanese
 * entries on the phone of everyone who opens the lobby.
 *
 * A run of the raw source rather than any single word: the lists are ordinary
 * vocabulary and `apple` or `pan` would hit on UI copy and fail for no reason.
 * If the module is imported at all, its template literal is in the bundle
 * verbatim, newlines and all, so a few hundred consecutive characters of it is
 * both a precise question and an unmissable one.
 */
it('ships no chain word list to the browser', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  const runs = [PL_SOURCE, JA_SOURCE, EN_SOURCE].flatMap((source) => {
    const body = source.trim();
    return [0, 0.4, 0.8].map((at) => body.slice(Math.floor(body.length * at), Math.floor(body.length * at) + 300));
  });
  expect(runs.filter((run) => bundle.includes(run))).toEqual([]);
});

/**
 * The avatar art is supposed to reach the browser, like the roster, but only
 * one sprite at a time and only when an `<img>` asks for it. `avatar/urls.ts`
 * globs six thousand files with `?url` precisely so that the bundle carries a
 * string per file and none of the bytes.
 *
 * It did not. Vite inlines any asset under `assetsInlineLimit` as a base64
 * data URI, the default is 4096 bytes, and the Picrew sprites are 128px WebP
 * with a median of 2.3KB: 5176 of the 6163 came in under the line and were
 * pasted into the entry chunk, which made it 13.9MB, 92% of it art nobody had
 * opened the customiser to see. `vite.config.ts` now answers `false` for that
 * folder, and this is the thing that noticed, because every unit test in the
 * repo passed the entire time it was broken.
 *
 * Two questions rather than one. The data URI is the mechanism that failed and
 * a grep for it is exact. The size ceiling is the property actually worth
 * having, and it catches the next way of breaking it, whatever that turns out
 * to be. Roughly double the current entry chunk, so ordinary growth passes.
 */
it('inlines no avatar sprite into the bundle', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  expect(bundle).not.toContain('data:image/webp;base64');

  const assets = join(out, 'assets');
  const entry = readdirSync(assets).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
  expect(entry).toHaveLength(1);
  /*
    Tightened from 2,200,000 when the boards were split out. That number was
    set as "roughly double the entry chunk" against an entry that carried all
    fifteen boards; against one that carries none it had over a megabyte of
    slack, which is more than the entire split saved -- every board could have
    come back eagerly and this would still have passed. A ceiling is only worth
    having if it is close enough to notice, so this is roughly a fifth above
    what the entry weighs today: ordinary growth passes, a reversal does not.

    The number is bigger than it looks, and anyone comparing it to `npm run
    build` will think it is wrong. Vitest sets `NODE_ENV=test`, this build
    inherits it, and Vite hands React's *development* copy to a build that is
    not `production`: the same commit is 966KB from `npm run build` and
    1,226KB here, a 260KB gap that is React and not this app. Calibrate
    against a run of this test, never against `dist/`.
  */
  expect(readFileSync(join(assets, entry[0])).byteLength).toBeLessThan(1_500_000);
});

/**
 * The boards are downloaded one at a time, and the stylesheets with them.
 *
 * A size ceiling is a blunt instrument for this: the boards are 120KB of a
 * megabyte, so re-importing every one of them eagerly would move the entry
 * chunk by a tenth and could sit under any ceiling loose enough not to cry
 * wolf. What actually matters is the shape -- fifteen chunks, not one -- and
 * that is worth asking directly, because the way it breaks is somebody adding
 * a convenience `import { WheelBoard }` to a file the lobby already loads.
 * Nothing else in this repo would notice; the app would work perfectly, a
 * second slower, for everybody who opened it.
 */
it('gives each board its own chunk, and its stylesheet with it', { timeout: 120_000 }, () => {
  buildClient();
  const assets = readdirSync(join(out, 'assets'));

  // Read off disk rather than listed here, so a new game is covered the day it
  // is added rather than the day somebody remembers this file. Every board is
  // named `<Game>Board.tsx`; the two files in that folder that are not boards
  // (`Choice.tsx`, `Die.tsx`) are not, and are shared rather than lazy.
  const boards = readdirSync(fileURLToPath(new URL('./games/', import.meta.url)))
    .filter((f) => f.endsWith('Board.tsx'))
    .map((f) => f.replace(/\.tsx$/, ''));
  expect(boards.length).toBeGreaterThan(10);

  const missing = boards.filter(
    (name) => !assets.some((f) => f.startsWith(`${name}-`) && f.endsWith('.js')),
  );
  expect(
    missing,
    `${missing.join(', ')} did not come out as a chunk of its own, so it is in ` +
      'the entry chunk and every player downloads it. Boards are reached through ' +
      '`lazy` in `games/boards.ts`; something is importing one directly.',
  ).toEqual([]);
});

/**
 * The render-blocking stylesheet.
 *
 * This is the one that is measured in paint time rather than in parse time: it
 * is a `<link>` in the head, so nothing on the page is drawn until it has
 * arrived, and it carried every game's board CSS to draw a lobby of cards.
 * Thirteen of the fifteen game sheets ride with their board now (see the top
 * of `styles/index.css`), which took it from 152KB to 78KB -- and unlike the
 * entry chunk above, that is a real number, since CSS is not affected by the
 * `NODE_ENV` this build runs under.
 *
 * The ceiling is on the entry sheet alone and deliberately not on the total:
 * CSS that arrives with a board is CSS nobody waits for, so a game growing a
 * lavish stylesheet is not the thing being guarded against here. Putting one
 * back in the running order is.
 */
it('keeps the render-blocking stylesheet small', { timeout: 120_000 }, () => {
  buildClient();
  const assets = join(out, 'assets');
  const sheet = readdirSync(assets).filter((f) => f.startsWith('index-') && f.endsWith('.css'));
  expect(sheet).toHaveLength(1);
  expect(readFileSync(join(assets, sheet[0])).byteLength).toBeLessThan(100_000);
});

/**
 * The roster is *supposed* to reach the browser, unlike everything else this
 * file checks, so what is pinned is its size rather than its absence.
 *
 * `waifuRoster.ts` is generated by a script with a `--pages` flag, and the
 * flag is the whole risk: rerunning the ingest twice as deep is a one-word
 * change that nobody would think to measure, and it lands on the phone of
 * everybody who opens the lobby. The ceiling is roughly double what the
 * current roster costs, so an ordinary re-run passes and a tenfold one does
 * not, and the number arrives with the reason attached rather than as a
 * mystery.
 */
it('keeps the character roster small enough to ship', { timeout: 120_000 }, () => {
  const roster = readFileSync(
    fileURLToPath(new URL('../shared/waifuRoster.ts', import.meta.url)),
    'utf8',
  );
  expect(roster.length).toBeLessThan(120_000);
});
