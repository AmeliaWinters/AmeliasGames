/// <reference types="@cloudflare/workers-types" />
import {
  PLAYER_PATHS,
  applyHarvest,
  loadProfile,
  viewOf,
  type HarvestPost,
} from '../shared/players.js';
import { MAX_NAME } from '../shared/session.js';
import { dueWords } from '../shared/profile.js';
import type { Profile } from '../shared/profile.js';

/**
 * One Durable Object per account.
 *
 * The same shape as `GameRoom` and for the same reasons: `idFromName` pins an
 * account to one instance worldwide, so there is no locking, no database and
 * no race between the two rooms a player might finish a game in at the same
 * moment. It also costs nothing while nobody is playing, which matters here
 * more than it does for a room, because an account is idle almost all of the
 * time and there is one per person rather than one per game.
 *
 * **It is only ever reached from inside the worker**, never from a browser.
 * Rooms post results to it directly through their stub, which is the whole
 * trust story: a client that could post its own results could post any
 * results, and the interesting cheat is not "I won" but "I knew that word",
 * which corrupts the one thing this system exists to be accurate about. There
 * is no route to `/players/...` in the worker's `fetch` and there must never
 * be one.
 *
 * No hibernation dance: there are no sockets here. Every request loads from
 * storage, which is the rule `GameRoom` learned the hard way — treat every
 * in-memory field as empty at the top of every handler — applied from the
 * start rather than after an outage.
 */
export class Player implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  /**
   * The stored profile, brought up to the current shape.
   *
   * Deliberately not cached on the instance. This object is woken by a room
   * finishing a game, does one thing and goes back to sleep, so a cache would
   * be a field that is empty every time it is read and a correctness risk the
   * rest of the time.
   */
  private async load(id: string, now: number): Promise<Profile> {
    return loadProfile(await this.state.storage.get<unknown>('profile'), id, now);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // The account id is the name this object was addressed by. It arrives on
    // the query string because a Durable Object cannot ask what its own
    // `idFromName` argument was, and the worker is the only thing that can
    // reach here, so there is nobody to lie about it.
    const id = url.searchParams.get('id') ?? '';
    if (!id) return json({ error: 'No account.' }, 400);

    const now = Date.now();

    if (url.pathname === PLAYER_PATHS.harvest && request.method === 'POST') {
      const post = (await request.json()) as HarvestPost;
      const profile = await this.load(id, now);
      const next = applyHarvest(profile, post);
      // Nothing changed means the key had already been applied — the retry
      // path, which exists because a write failed, so writing again for no
      // reason is how a retry storm starts.
      if (next !== profile) await this.state.storage.put('profile', next);
      return json({ profile: viewOf(next, now) });
    }

    if (url.pathname === PLAYER_PATHS.profile) {
      return json({ profile: viewOf(await this.load(id, now), now) });
    }

    if (url.pathname === PLAYER_PATHS.study) {
      // Keys only, and no write: a room asks this at every deal and it must
      // stay the cheapest thing this object answers.
      return json({ study: dueWords(await this.load(id, now), now) });
    }

    if (url.pathname === PLAYER_PATHS.export) {
      // The whole ledger, not the summary. This is the insurance policy: a
      // player can take their vocabulary somewhere else, and every mistake in
      // the design of this system is survivable as long as that stays true.
      return json(await this.load(id, now));
    }

    if (url.pathname === PLAYER_PATHS.rename && request.method === 'POST') {
      const { name } = (await request.json()) as { name?: unknown };
      const profile = await this.load(id, now);
      const next = { ...profile, name: String(name ?? '').trim().slice(0, MAX_NAME) };
      await this.state.storage.put('profile', next);
      return json({ profile: viewOf(next, now) });
    }

    return json({ error: 'No such thing.' }, 404);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
