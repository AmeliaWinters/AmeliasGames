import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { PUZZLES } from '../shared/games/wheel.js';

/**
 * The one property in this project that a passing unit-test suite cannot
 * detect. Wheel of Fortune's secrecy rests on the client never importing a
 * runtime binding from `wheel.ts`; every other test in the repo would still
 * pass on the day someone adds one and ships all forty-seven answers to the
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
