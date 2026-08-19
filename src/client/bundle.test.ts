import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { PUZZLES } from '../shared/games/wheel.js';
import { WORD_SOURCE } from '../shared/games/words.js';

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

function buildClient(): string {
  // Vite's own entry under the running Node binary: no shell (so arguments are
  // escaped, not concatenated) and no .cmd shim, which Windows Node refuses to
  // spawn without one.
  const vite = fileURLToPath(new URL('../../node_modules/vite/bin/vite.js', import.meta.url));
  execFileSync(process.execPath, [vite, 'build', '--outDir', out, '--emptyOutDir'], {
    stdio: 'pipe',
  });
  const assets = join(out, 'assets');
  return readdirSync(assets)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assets, f), 'utf8'))
    .join('\n');
}

it('ships no puzzle answer to the browser', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  const leaked = PUZZLES.filter((p) => bundle.includes(p.answer)).map((p) => p.answer);
  expect(leaked).toEqual([]);
});

it('ships no puzzle category or reducer to the browser', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  // `applyMove` is the reducer entry point; a category is the other half of a
  // puzzle and would narrow the answer just as well.
  expect(bundle).not.toContain('applyMove');
  const categories = [...new Set(PUZZLES.map((p) => p.category))];
  expect(categories.filter((c) => bundle.includes(c))).toEqual([]);
});

/**
 * Word Duel has no secret answer to leak — players bring their own words — but
 * the same import boundary is load-bearing for a different reason: the word
 * list is by far the largest thing in the repo, it is needed only to validate
 * a move, and moves are validated on the server. One convenience import in
 * `WordleBoard.tsx` would put the entire dictionary on the phone of every
 * player who opens the lobby.
 */
it('ships no word list to the browser', { timeout: 120_000 }, () => {
  const bundle = buildClient();
  // A run of consecutive entries: any single word ('about', 'crane') would
  // hit on ordinary English in the UI copy and fail for no reason.
  const runs = WORD_SOURCE.trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  expect(runs.filter((run) => bundle.includes(run))).toEqual([]);
});
