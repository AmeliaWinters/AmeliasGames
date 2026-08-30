import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The game server reads the same variable. Hardcoding 8787 here meant setting
// GAME_PORT to dodge a launcher collision silently broke the dev client.
const GAME_PORT = Number(process.env.GAME_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  build: {
    /*
      `avatar/urls.ts` globs six thousand sprites with `?url` and says in its
      own header that this "costs a string per file in the bundle and fetches
      nothing until an `<img>` asks". That was untrue for five sixths of them.
      Vite inlines any asset under `assetsInlineLimit` (4096 bytes by default)
      as a base64 data URI, the Picrew sprites are 128px WebP with a median of
      2.3KB, and 5176 of the 6163 fell under the line: 12.8MB of base64, 92% of
      the entry chunk, downloaded in full by every player opening the lobby to
      play Connect Four.

      A number here would work but would be a second place to hold the same
      rule. This asks the question the glob's contract actually asks -- is this
      one of the sprites addressed by URL? -- so a fifth art set inherits the
      answer and nothing else on the site changes behaviour.
    */
    assetsInlineLimit: (filePath) =>
      /[\/]avatar[\/]sets[\/].*\.(webp|png)$/.test(filePath) ? false : undefined,
  },
  server: {
    host: true, // listen on the LAN so phones can reach it
    proxy: {
      // One origin for both HTTP and WebSocket keeps LAN + tunnel testing simple.
      '/ws': { target: `ws://localhost:${GAME_PORT}`, ws: true },
      // The lobby's room lookup. Deployed it is a route on the worker beside
      // /ws, so it has to arrive on the same origin here too.
      '/peek': { target: `http://localhost:${GAME_PORT}` },
    },
  },
  test: {
    /*
      Vitest's default net is `**\/*.test.ts` from the repo root, and a git
      worktree under `.claude/` is a second entire copy of this project sitting
      inside it. Both copies were being collected: `npm test` ran every suite
      twice, reported thirty-six failures nobody had caused, and the loudest of
      them was `server.test.ts` in both copies racing for port 8899 --
      EADDRINUSE, from a file the person reading it had not touched.

      Only the default `node_modules` exclusion is being restated here, because
      naming one replaces the list rather than adding to it.
    */
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-android/**', '**/.claude/**'],
  },
});
