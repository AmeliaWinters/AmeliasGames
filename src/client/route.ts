/**
 * The pages this app has a URL for: the lobby, and one path per account screen.
 *
 * Everything else the shell shows is a room, and a room is addressed by the
 * fragment (see `roomUrl` at the foot of this file) because it has to survive
 * a link pasted into a chat app. The screens behind the chip are the opposite
 * case: they are places you navigate to, the back button is the way out people
 * already know, and a screen with no address of its own cannot be linked,
 * bookmarked or returned to.
 *
 * They used to share one address, `/account`, with which screen was showing
 * held in React state. That made Back mean "leave the account" from four
 * screens deep, and made "open the chests" unlinkable. The reason for the
 * single path was `/account/*`: `wrangler.toml` hands that prefix to the
 * worker before the asset router sees it, so `/account/words` would be a 404
 * from the chest API rather than the app. So the screens are siblings of
 * `/account` rather than children of it -- `/chests`, `/waifu`, `/words`,
 * `/stats`, `/customise` -- and the worker's prefix is untouched. `/account`
 * itself stays the menu, which is what somebody typing it in expects.
 */

import { CODE_LENGTH, isRoomCode } from "../shared/roomCode.js";

/** Which screen of the account a path names. */
export type Screen = "profile" | "vocab" | "stats" | "avatar" | "chests" | "waifu";

/**
 * The path segment each screen answers to.
 *
 * Words rather than component names: these are read by people. `customise`
 * carries the spelling the rest of the copy uses, and `words` is what the menu
 * row calls the vocabulary screen.
 */
const PATHS: Record<Screen, string> = {
  profile: "account",
  vocab: "words",
  stats: "stats",
  avatar: "customise",
  chests: "chests",
  waifu: "waifu",
};

const SEGMENTS = new Set<string>(Object.values(PATHS));

/**
 * Where this app is mounted, with a trailing slash.
 *
 * Read from the document rather than hard-coded to `/`, because the same
 * bundle is served from a subdirectory in the packaged app and from the root
 * on the web, and a pushState to an absolute `/account` in the first case
 * navigates out of the app entirely. Captured at module load, which is before
 * anything below has pushed anything.
 */
export const BASE = baseOf(typeof location === "undefined" ? "/" : location.pathname);

export function baseOf(path: string): string {
  const parts = path.split("/");
  // A trailing slash first, so `/chests/` and `/chests` are read the same
  // way: a browser adds one to either given half a chance, and a base of
  // `/chests/` would push `/chests/chests`.
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  const last = parts[parts.length - 1];
  // A file (`/index.html`) and any screen are both "not the mount point":
  // strip them. Anything else is a directory, whether or not whoever linked
  // it bothered with the trailing slash. Every screen has to be stripped and
  // not just the account: a reload on `/chests` that read the base as
  // `/chests/` would push `/chests/waifu`, and that one is a real 404.
  if (SEGMENTS.has(last) || last.includes(".")) parts.pop();
  parts.push("");
  return parts.join("/");
}

/** Which screen the address bar is on, or null for the lobby. */
export function screenAt(
  path = typeof location === "undefined" ? "/" : location.pathname,
): Screen | null {
  // One trailing slash, tolerated rather than required, for the same reason
  // `baseOf` pops one: browsers and link shorteners both add them.
  const bare = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (!bare.startsWith(BASE)) return null;
  const rest = bare.slice(BASE.length);
  for (const screen of Object.keys(PATHS) as Screen[]) {
    if (rest === PATHS[screen]) return screen;
  }
  return null;
}

/**
 * A screen and the lobby, as addresses.
 *
 * The query is carried across both, because `?as=b` is how the second seat is
 * driven in a two-tab test and dropping it on a trip through the account is a
 * tab that quietly stops being the other player. The fragment is not: it is a
 * room code, and being in a room is not a state these pages share.
 */
export function screenUrl(screen: Screen): string {
  return `${BASE}${PATHS[screen]}${location.search}`;
}

export function lobbyUrl(): string {
  return `${BASE}${location.search}`;
}

/*
  A room is addressed by the fragment rather than the path, because a room
  code has to survive a link pasted into a chat app. These four moved here
  from `App.tsx` to sit beside the path helpers above: they are the other half
  of the same question, and the comment at the top of this file was already
  pointing at them across a file boundary.
*/

/**
 * This page, addressed to a room: path, query, then the code.
 *
 * The order is the whole of it. Written as `#${code}${location.search}` the
 * query lands *after* the hash, and everything after a hash is the fragment. A
 * player who arrived at `?as=b`, or at a link a chat app had decorated with a
 * tracking parameter (which is most links), got a fragment reading `ABCD?as=b`.
 * Nothing broke on the spot, because the code was already in state. It broke on
 * the next reload, where `codeFromHash` no longer recognised four letters,
 * `brokenHashCode` did, and somebody sitting in a game was shown "that link
 * doesn't look complete" and dropped at the setup screen.
 */
export function roomUrl(code: string): string {
  // The lobby's own address, not "wherever we are now": a room can be opened
  // while the address bar says `/account`, and a room code hung off that path
  // is a link that reloads into the account page with a code nobody uses.
  return `${lobbyUrl()}#${code}`;
}

export function codeFromHash(): string | null {
  const raw = location.hash.slice(1).toUpperCase();
  return isRoomCode(raw) ? raw : null;
}

/**
 * A hash that is present but unusable: a link truncated by a chat app, or
 * mangled in the paste. Silently dropping it leaves someone staring at the
 * setup screen wondering why their friend's link did nothing.
 */
export function brokenHashCode(): string | null {
  const raw = location.hash.slice(1);
  if (raw.length === 0 || isRoomCode(raw.toUpperCase())) return null;
  // Whatever is in the fragment is somebody else's typing, and it can be any
  // length at all. A toast that quotes it has to quote a readable amount of
  // it: past a couple of codes' worth the quotation is no longer helping the
  // player recognise their own broken link, it is just filling the toast.
  return raw.length > 12 ? `${raw.slice(0, 12)}...` : raw;
}

/** The toast a broken invite link raises, quoting the part that went wrong. */
export function brokenLinkMessage(fragment: string): string {
  return (
    `"${fragment}" is not a room code. They're ${CODE_LENGTH} letters. ` +
    "Ask for the link again, or type the code in below."
  );
}
