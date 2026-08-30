/**
 * The hand-picked half of the roster.
 *
 * `build-waifu.ts` on its own is one rule -- AniList's favourite count, top
 * four hundred -- and that rule is deliberately somebody else's taste rather
 * than this project's. What it is not is a way to ask for a *series*. A show
 * can be beloved and still field nobody in the global top four hundred, so
 * "there are no Death Parade characters in this game" was never a judgement,
 * it was an artefact of sorting the whole medium at once.
 *
 * So: the same sort, run per series. Each entry below is a search AniList
 * answers with one media; the build takes that media's female characters in
 * favourite order and keeps the first `take` of them. The curation is which
 * shows are named here, and nothing else -- who from each show is still the
 * favourite count, which keeps the property the header of `build-waifu.ts`
 * argues for.
 *
 * **Only what AniList indexes.** It is an anime and manga database, so the
 * live-action and western-animation asks (Wednesday, Andor, and Avatar: The
 * Last Airbender) have no entry here: there is no character row and, more to
 * the point, no image URL, and this repo stores no art of its own on purpose
 * (see the build script's header). They need a licensed image source before
 * they can be a line in this file. Star Wars is in because AniList does index
 * `Visions`, which is anime, and that is the only part of it here.
 */

/** One series to pull, and how deep. */
export interface Extra {
  /** What to search AniList's media for. The first hit wins. */
  search: string;
  /** How many of that media's female characters to keep, by favourites. */
  take: number;
}

export const EXTRA_SERIES: Extra[] = [
  { search: 'Attack on Titan', take: 8 },
  { search: 'Re:ZERO -Starting Life in Another World-', take: 10 },
  { search: "JoJo's Bizarre Adventure", take: 6 },
  { search: "JoJo's Bizarre Adventure: Stardust Crusaders", take: 4 },
  { search: "JoJo's Bizarre Adventure: Golden Wind", take: 4 },
  { search: "JoJo's Bizarre Adventure: Stone Ocean", take: 4 },
  { search: 'Death Parade', take: 5 },
  { search: 'Hellsing Ultimate', take: 4 },
  { search: 'Dragon Ball Z', take: 8 },
  { search: 'Dragon Ball Super', take: 6 },
  { search: 'Star Wars: Visions', take: 6 },
];

/**
 * Characters AniList knows but the media pass above cannot reach.
 *
 * Two ways that happens, and both are here rather than being worked around in
 * the query: a character whose one media is not the one the search returns,
 * and a character AniList has no gender on. The second is the reason this list
 * is separate from a filter -- the build drops unset gender rather than
 * guessing at somebody, which is the right default and the wrong answer for a
 * row that has been checked by hand.
 */
export const EXTRA_CHARACTERS: number[] = [
  15380, // Leia Organa, Star Wars: A New Hope. Gender unset on AniList.
];
