/**
 * Writes `src/shared/waifuRoster.ts` from AniList.
 *
 * The same join `build-wardrobe.ts` makes, for the same reason: **the roll
 * happens on the server and the art does not live there.** What goes into
 * `shared/` is names and URLs; the pictures stay on AniList's CDN and the
 * client fetches them per `<img>`. Nothing here downloads an image, and that
 * is a decision rather than an omission. Mirroring a few hundred character
 * portraits into this repo would be redistributing art the project did not
 * draw and has no licence to copy; referencing them is what a page linking to
 * a picture has always done, it is smaller, and it stays correct when the
 * source replaces one.
 *
 * Run by hand, output committed, exactly like the wardrobe:
 *
 *   npm run build:waifu
 *   npm run build:waifu -- --pages 12
 *
 * AniList allows 90 requests a minute and answers 50 characters a page, so the
 * default eight pages is four hundred characters and eight requests. The delay
 * below is politeness rather than a limit anybody is near.
 *
 * **Sorted by favourites, and that ordering is the whole curation.** There is
 * no hand-picked list to argue about and no weight table downstream (see
 * `waifu.ts`); who is in the pool is decided by how many people on AniList
 * favourited them, which is at least somebody else's honest count rather than
 * this project's taste.
 *
 * **And then the same sort again, per series.** The top four hundred of the
 * whole medium is a pool with holes in it that read as opinions: a show can be
 * loved and field nobody that high, so asking for it by name is the only way
 * in. `waifu-extra.ts` is that list, and it names shows rather than people --
 * who comes from each one is still the favourite count, so the property above
 * survives. The two passes are deduped by id, so a character already in on
 * favourites is not added twice and keeps her first place.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { EXTRA_CHARACTERS, EXTRA_SERIES } from './waifu-extra.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PER_PAGE = 50;
const ENDPOINT = 'https://graphql.anilist.co';

const pages = Number(argOf('--pages') ?? 8) || 8;
/** How deep to page one series' cast before giving up on finding `take` women. */
const SERIES_PAGES = 4;

const QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      characters(sort: FAVOURITES_DESC) {
        id
        gender
        name { full }
        image { large }
        media(sort: POPULARITY_DESC, perPage: 1) {
          nodes { title { romaji english } genres }
        }
      }
    }
  }
`;

/**
 * One named series, and its characters in favourite order.
 *
 * `search` rather than an id, because a hand-written list of AniList media ids
 * is unreadable and unauditable: nobody reviewing `waifu-extra.ts` can tell
 * whether 20931 is Death Parade. The cost is one request per series and the
 * risk that a search moves; the build prints what each one matched so a move
 * is visible rather than silent.
 */
const SERIES_QUERY = `
  query ($search: String, $page: Int) {
    Media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
      id
      title { romaji english }
      genres
      characters(sort: FAVOURITES_DESC, perPage: 25, page: $page) {
        pageInfo { hasNextPage }
        nodes {
          id
          gender
          name { full }
          image { large }
        }
      }
    }
  }
`;

/** The stragglers, by id. See `EXTRA_CHARACTERS`. */
const BY_ID_QUERY = `
  query ($ids: [Int]) {
    Page(perPage: 50) {
      characters(id_in: $ids) {
        id
        gender
        name { full }
        image { large }
        media(sort: POPULARITY_DESC, perPage: 1) {
          nodes { title { romaji english } genres }
        }
      }
    }
  }
`;

interface Series {
  id: number;
  title: { romaji: string | null; english: string | null } | null;
  genres: string[] | null;
  characters: { pageInfo: { hasNextPage: boolean } | null; nodes: Node[] } | null;
}

interface Node {
  id: number;
  gender: string | null;
  name: { full: string | null } | null;
  image: { large: string | null } | null;
  media: { nodes: { title: { romaji: string | null; english: string | null } | null; genres: string[] | null }[] } | null;
}

const out: { id: string; name: string; series: string; image: string; tags: string[] }[] = [];
// Ids rather than names, because two series genuinely do field a Rem and the
// roster has to be able to hold both. The name is what somebody reads; the id
// is what a profile stores.
const seen = new Set<string>();

for (let page = 1; page <= pages; page += 1) {
  const data = await ask<{ Page?: { characters?: Node[] } }>(QUERY, { page, perPage: PER_PAGE });
  const rows = data.Page?.characters ?? [];
  if (rows.length === 0) break;

  for (const row of rows) {
    const media = row.media?.nodes?.[0];
    keep(row, titleOf(media), media?.genres ?? []);
  }

  process.stdout.write(`page ${page}: ${out.length} kept\n`);
  await pause();
}

// Then the named series, each sorted the same way inside itself. Anyone
// already in from the pass above stays where she is: `keep` is deduped by id,
// so this only ever adds.
for (const extra of EXTRA_SERIES) {
  // Paged rather than asked for `take` outright, because `take` counts women
  // and AniList sorts everybody. The top eight of Attack on Titan by
  // favourites is mostly Levi and Eren, so a single small page came back with
  // nobody new in it and the series looked like it had no characters to add.
  let title = '';
  const before = out.length;
  let taken = 0;
  for (let page = 1; page <= SERIES_PAGES && taken < extra.take; page += 1) {
    const data = await ask<{ Media?: Series | null }>(SERIES_QUERY, {
      search: extra.search,
      page,
    });
    const media = data.Media;
    if (!media) {
      // Not fatal. A search that stops matching is a series quietly missing
      // from the roster, and the run that notices should say so out loud.
      process.stdout.write(`  ! "${extra.search}" matched nothing\n`);
      break;
    }
    title = titleOf(media);
    for (const row of media.characters?.nodes ?? []) {
      if (taken >= extra.take) break;
      if (keep(row, title, media.genres ?? [])) taken += 1;
    }
    await pause();
    if (!media.characters?.pageInfo?.hasNextPage) break;
  }
  if (title) process.stdout.write(`  ${extra.search} -> ${title}: +${out.length - before}\n`);
}

// And the stragglers, in one request. See `EXTRA_CHARACTERS` for what puts
// somebody there rather than in a series above.
if (EXTRA_CHARACTERS.length > 0) {
  const data = await ask<{ Page?: { characters?: Node[] } }>(BY_ID_QUERY, {
    ids: EXTRA_CHARACTERS,
  });
  const before = out.length;
  for (const row of data.Page?.characters ?? []) {
    const media = row.media?.nodes?.[0];
    keep(row, titleOf(media), media?.genres ?? [], true);
  }
  process.stdout.write(`  by id: +${out.length - before} of ${EXTRA_CHARACTERS.length}\n`);
}

if (out.length === 0) throw new Error('AniList returned nobody. Not writing an empty roster.');

const body = `// GENERATED by scripts/build-waifu.ts. Do not edit: rerun it.
//
// Metadata only. \`image\` points at AniList's CDN and no art is stored here;
// see the script's header for why that is deliberate.
import type { Waifu } from './waifu.js';

export const ROSTER: Waifu[] = ${JSON.stringify(out, null, 2)};
`;

await writeFile(path.join(ROOT, 'src/shared/waifuRoster.ts'), body);
console.log(`roster ${out.length} characters, ${(body.length / 1024).toFixed(1)}KB`);

/**
 * One AniList request, checked.
 *
 * GraphQL answers 200 with an `errors` array, so a bare `ok` check would write
 * a roster out of a response that had failed. Both are checked here rather
 * than at each of the three call sites.
 */
async function ask<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const answer = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!answer.ok) throw new Error(`AniList said ${answer.status}`);
  const body = (await answer.json()) as { data?: T; errors?: unknown };
  if (body.errors) throw new Error(`AniList: ${JSON.stringify(body.errors)}`);
  if (!body.data) throw new Error('AniList answered without data');
  return body.data;
}

/** Politeness between requests. AniList's limit is nowhere near this. */
function pause(): Promise<void> {
  return new Promise((done) => setTimeout(done, 700));
}

function titleOf(
  media: { title?: { romaji: string | null; english: string | null } | null } | null | undefined,
): string {
  return (media?.title?.english || media?.title?.romaji || 'Unknown').trim();
}

/**
 * Take one character, if she is one this roster holds and is not in it yet.
 *
 * A "waifu game" is asking for female characters, and AniList knows the answer
 * rather than this script guessing from a name. Unset gender is dropped rather
 * than assumed: the roster being a bit shorter is a much smaller problem than
 * it being wrong about somebody. `checked` is the one exception, and it means
 * a person read that row by hand -- see `EXTRA_CHARACTERS`.
 */
function keep(row: Node, series: string, genres: string[], checked = false): boolean {
  if (!checked && (row.gender ?? '').toLowerCase() !== 'female') return false;
  const name = row.name?.full?.trim();
  const image = row.image?.large?.trim();
  if (!name || !image) return false;
  const id = `anilist:${row.id}`;
  // Already in on favourites, and she keeps that place. Counted as taken all
  // the same: the series asked for its top few women, and she is one of them.
  if (seen.has(id)) return true;
  seen.add(id);
  out.push({
    id,
    name,
    series,
    image,
    // Genres, lowercased, and capped at four. They are the media's rather than
    // the character's because AniList has no character tags, which is honest
    // enough for a filter that says "show me the ones from fantasy shows" and
    // would be a lie if it claimed to describe her.
    tags: genres.slice(0, 4).map((tag) => tag.toLowerCase()),
  });
  return true;
}

function argOf(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}
