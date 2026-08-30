/// <reference types="@cloudflare/workers-types" />
import {
  PLAYER_PATHS,
  applyChest,
  applyHarvest,
  applyRoll,
  applyShowcase,
  collectionOf,
  loadProfile,
  viewOf,
  vocabOf,
  wardrobeOf,
  type ChestPost,
  type HarvestPost,
  type WaifuPost,
} from '../shared/players.js';
import { MAX_NAME } from '../shared/session.js';
import { LEARN_LANGS, dueWords } from '../shared/profile.js';
import type { LearnLang, Profile } from '../shared/profile.js';

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
 * **It is only ever reached from inside the worker.** Rooms post results to it
 * directly through their stub, which is the whole trust story: a client that
 * could post its own results could post any results, and the interesting cheat
 * is not "I won" but "I knew that word", which corrupts the one thing this
 * system exists to be accurate about.
 *
 * This used to say there is no route here from a browser and there never must
 * be one. There are now four, and the rule that replaced that sentence is the
 * one that was doing the work all along: **a browser may reach a path here
 * only if the request carries no facts.** A chest names a set and a nonce and
 * a roll names only a nonce; the balance, the pull and the result are all read
 * and written on this side.
 *
 * `/showcase` is the one exception and it is worth being precise about, since
 * it is the first browser-reachable path that carries anything at all. It
 * carries three ids, and `applyShowcase` re-derives from stored state that
 * each was actually claimed, so the fact is checked rather than believed. What
 * a hostile request achieves is rearranging its own showcase. Every other path
 * below stays unreachable from outside, and `/harvest` most of all.
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

    if (url.pathname === PLAYER_PATHS.vocab) {
      // One language's rows, ordered for the screen that asked. No write, and
      // no summary: see `vocabOf`.
      const lang = url.searchParams.get('lang') ?? '';
      if (!(LEARN_LANGS as readonly string[]).includes(lang)) return json({ error: 'No such language.' }, 400);
      return json({ words: vocabOf(await this.load(id, now), lang as LearnLang) });
    }

    if (url.pathname === PLAYER_PATHS.export) {
      // The whole ledger, not the summary. This is the insurance policy: a
      // player can take their vocabulary somewhere else, and every mistake in
      // the design of this system is survivable as long as that stays true.
      return json(await this.load(id, now));
    }

    if (url.pathname === PLAYER_PATHS.chest && request.method === 'POST') {
      const post = (await request.json()) as ChestPost;
      const profile = await this.load(id, now);
      // The randomness is the object's, never the client's. See `chest.ts`:
      // a browser that rolled its own chest would reroll until it liked the
      // answer, and the reroll is one page refresh.
      const result = applyChest(profile, { set: String(post?.set ?? ''), nonce: String(post?.nonce ?? '') }, random);
      // Same skip as `/harvest`: a refusal and a repeat both hand back the
      // very object that went in, so neither writes.
      if (result.profile !== profile) await this.state.storage.put('profile', result.profile);
      return json({
        drop: result.drop,
        granted: result.granted,
        refusal: result.refusal,
        repeat: result.repeat,
        owned: wardrobeOf(result.profile),
        profile: viewOf(result.profile, now),
      });
    }

    if (url.pathname === PLAYER_PATHS.waifu && request.method === 'POST') {
      const post = (await request.json()) as WaifuPost;
      const profile = await this.load(id, now);
      // Same randomness as the chest, and never the client's.
      const result = applyRoll(profile, { nonce: String(post?.nonce ?? '') }, random);
      if (result.profile !== profile) await this.state.storage.put('profile', result.profile);
      return json({
        pulled: result.pulled,
        duplicate: result.duplicate,
        paid: result.paid,
        refusal: result.refusal,
        repeat: result.repeat,
        claimed: collectionOf(result.profile),
        profile: viewOf(result.profile, now),
      });
    }

    if (url.pathname === PLAYER_PATHS.showcase && request.method === 'POST') {
      const { showcase } = (await request.json()) as { showcase?: unknown };
      const profile = await this.load(id, now);
      const asked = Array.isArray(showcase) ? showcase.map((id) => String(id)) : [];
      const next = applyShowcase(profile, asked);
      // Skipped when the answer is unchanged, which is the ordinary case of
      // somebody tapping the slot they were already showing.
      if (next !== profile) await this.state.storage.put('profile', next);
      return json({ profile: viewOf(next, now) });
    }

    if (url.pathname === PLAYER_PATHS.collection) {
      // No write. See `PLAYER_PATHS.collection` for why the ids are not on the
      // summary -- but the summary rides along, because the screen that asks
      // for this list draws the balance beside it and stores what comes back.
      // This route once answered with the ids alone while the dev server's
      // `serveAccount` appended a profile to every account response, so the
      // collection screen overwrote a good summary with `undefined` and the
      // balance read zero in production and never in development.
      const profile = await this.load(id, now);
      return json({ claimed: collectionOf(profile), profile: viewOf(profile, now) });
    }

    if (url.pathname === PLAYER_PATHS.wardrobe) {
      // Ids only, and no write. See `PLAYER_PATHS.wardrobe` for why this is
      // not a field on the profile summary.
      return json({ owned: wardrobeOf(await this.load(id, now)) });
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

/**
 * A float in [0, 1), from the platform's CSPRNG.
 *
 * `Math.random` would very probably be fine for a hat, and it is still the
 * wrong call: this is the one number in the system a player has an incentive
 * to predict, and a seeded PRNG whose state leaks is a chest somebody can aim.
 * `crypto.getRandomValues` costs nothing here and removes the question.
 *
 * Divided by 2^32 rather than by `0xffffffff`, so the result can be zero and
 * can never be one. `openChest` multiplies by the pool size and floors, and a
 * value of exactly one would index off the end.
 */
function random(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4_294_967_296;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
