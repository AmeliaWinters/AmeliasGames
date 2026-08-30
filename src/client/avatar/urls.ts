/**
 * Set relative file names to URLs the browser can fetch.
 *
 * A `Drawn` image layer says `sutemo/png/body.png`, not a URL, because the
 * renderers are plain functions and have to run under `tsx` in
 * `render-avatars.ts` as well as under Vite. Resolution is the client's job
 * and this is the whole of it.
 *
 * The glob is eager and imports urls rather than modules, so it costs a string
 * per file in the bundle and fetches nothing until an `<img>` asks. Which also
 * means adding a set adds no code here: drop the folder in and its art is
 * addressable.
 */

// Two extensions, because the two art sources are two different problems.
// The pixel sets are 64x64 PNGs where a lossless byte is nothing; the Picrew
// sets are six thousand 128px sprites, and WebP is what makes that a folder
// rather than a download. See `scripts/extract-picrew.ts`.
const FILES = import.meta.glob(['./sets/**/png/*.png', './sets/**/webp/*.webp'], {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** The URL for one set relative path, or empty if the art is not there. */
export function assetUrl(file: string): string {
  return FILES[`./sets/${file}`] ?? '';
}
