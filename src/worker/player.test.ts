import { describe, expect, it } from 'vitest';
import { Player } from './player.js';
import { PLAYER_PATHS, type HarvestPost } from '../shared/players.js';
import { PROFILE_VERSION, type Profile, type ProfileView } from '../shared/profile.js';
import type { GameRecord, Learned } from '../shared/harvest.js';

/**
 * The clock the harvests are filed against.
 *
 * Real time rather than a fixed constant, because these read the profile back
 * through `viewOf`, which counts what is due *now* — and a game filed in 2023
 * leaves every word it taught three years overdue.
 */
const NOW = Date.now();

/**
 * Storage that survives the instance, which is the only thing this object
 * depends on. No sockets and no hibernation dance: a player object is woken by
 * a room finishing a game, does one thing, and goes back to sleep.
 */
class FakeState {
  readonly store = new Map<string, unknown>();
  readonly storage = {
    get: async <T>(key: string): Promise<T | undefined> => {
      const value = this.store.get(key);
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
    put: async (key: string, value: unknown): Promise<void> => {
      this.store.set(key, structuredClone(value));
    },
  };
}

function newPlayer() {
  const state = new FakeState();
  let player = new Player(state as unknown as DurableObjectState);
  return {
    state,
    get player() {
      return player;
    },
    /** The instance is destroyed and rebuilt; the storage is not. */
    restart() {
      player = new Player(state as unknown as DurableObjectState);
    },
  };
}

const ID = 'acct-under-test';

async function call(
  ctx: ReturnType<typeof newPlayer>,
  path: string,
  body?: unknown,
): Promise<Response> {
  return ctx.player.fetch(
    new Request(`https://player${path}?id=${encodeURIComponent(ID)}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

function learned(over: Partial<Learned> = {}): Learned {
  return {
    lang: 'pl',
    key: 'byc',
    word: 'jestem',
    script: '',
    lemma: 'być',
    gloss: 'to be',
    rank: 4,
    grade: 'produced',
    ms: 3_000,
    ...over,
  };
}

function post(key: string, words: Learned[] = [learned()], name = 'Amelia'): HarvestPost {
  const record: GameRecord = {
    gameId: 'wordchain',
    seats: [{ seat: 0, result: 'won', learned: words }],
  };
  return { record, seat: 0, key, now: NOW, name };
}

describe('filing a game', () => {
  it('creates the profile on the first one, with no sign-up step anywhere', async () => {
    const ctx = newPlayer();
    const answer = (await (await call(ctx, PLAYER_PATHS.harvest, post('run#1'))).json()) as {
      profile: ProfileView;
    };
    expect(answer.profile.id).toBe(ID);
    expect(answer.profile.words).toBe(1);
    expect(answer.profile.xp).toBeGreaterThan(0);
  });

  it('keeps it across a restart, which is the whole point of the object', async () => {
    const ctx = newPlayer();
    await call(ctx, PLAYER_PATHS.harvest, post('run#1'));
    ctx.restart();
    const answer = (await (await call(ctx, PLAYER_PATHS.profile)).json()) as { profile: ProfileView };
    expect(answer.profile.words).toBe(1);
  });

  /**
   * The retry path, from the receiving end. The room writes to here and only
   * then records that it has, so a crash between the two re-sends the same
   * harvest — deliberately, because at-least-once into a receiver that
   * recognises a repeat is the only exactly-once anybody actually builds.
   */
  it('ignores a repeat of a key it has already applied', async () => {
    const ctx = newPlayer();
    const first = (await (await call(ctx, PLAYER_PATHS.harvest, post('run#1'))).json()) as {
      profile: ProfileView;
    };
    const again = (await (await call(ctx, PLAYER_PATHS.harvest, post('run#1'))).json()) as {
      profile: ProfileView;
    };
    expect(again.profile.xp).toBe(first.profile.xp);
    expect(again.profile.games.find((g) => g.gameId === 'wordchain')?.played).toBe(1);
  });

  it('does not write storage at all for a repeat', async () => {
    const ctx = newPlayer();
    await call(ctx, PLAYER_PATHS.harvest, post('run#1'));
    const written = ctx.state.store.get('profile');
    await call(ctx, PLAYER_PATHS.harvest, post('run#1'));
    // Same object, untouched: the retry path exists because a write failed, so
    // writing again for no reason is how a retry storm starts.
    expect(ctx.state.store.get('profile')).toBe(written);
  });

  it('takes a rematch under a new key as a second game', async () => {
    const ctx = newPlayer();
    await call(ctx, PLAYER_PATHS.harvest, post('run#1'));
    const answer = (await (await call(ctx, PLAYER_PATHS.harvest, post('run#2'))).json()) as {
      profile: ProfileView;
    };
    expect(answer.profile.games.find((g) => g.gameId === 'wordchain')?.played).toBe(2);
  });
});

describe('the name', () => {
  it('is taken from the table when the profile has none', async () => {
    const ctx = newPlayer();
    const answer = (await (await call(ctx, PLAYER_PATHS.harvest, post('run#1', [], 'Amelia'))).json()) as {
      profile: ProfileView;
    };
    expect(answer.profile.name).toBe('Amelia');
  });

  /**
   * A room may fill in a name that is missing; it may not overwrite one
   * somebody chose. Otherwise joining a friend's link while they had typed
   * something else would rename you.
   */
  it('is not overwritten by a later game played under a different one', async () => {
    const ctx = newPlayer();
    await call(ctx, PLAYER_PATHS.harvest, post('run#1', [], 'Amelia'));
    const answer = (await (await call(ctx, PLAYER_PATHS.harvest, post('run#2', [], 'Someone Else'))).json()) as {
      profile: ProfileView;
    };
    expect(answer.profile.name).toBe('Amelia');
  });

  it('can be set outright, and clamped to the length a seat label allows', async () => {
    const ctx = newPlayer();
    const answer = (await (await call(ctx, PLAYER_PATHS.rename, { name: 'x'.repeat(80) })).json()) as {
      profile: ProfileView;
    };
    expect(answer.profile.name).toHaveLength(20);
  });
});

describe('getting it back out', () => {
  /**
   * The insurance policy, and the reason it shipped before the profile screen
   * did: every mistake in the design of this system is survivable for as long
   * as a player can take their vocabulary somewhere else.
   */
  it('exports the whole ledger, not the summary', async () => {
    const ctx = newPlayer();
    await call(ctx, PLAYER_PATHS.harvest, post('run#1'));
    const whole = (await (await call(ctx, PLAYER_PATHS.export)).json()) as Profile;

    expect(whole.version).toBe(PROFILE_VERSION);
    expect(whole.words).toHaveLength(1);
    // The rows themselves, with everything needed to redraw them somewhere
    // that has no dictionary either.
    expect(whole.words[0]).toMatchObject({ key: 'byc', gloss: 'to be', lemma: 'być' });
    expect(whole.applied).toEqual(['run#1']);
  });

  it('summarises rather than sending the ledger on an ordinary read', async () => {
    const ctx = newPlayer();
    await call(ctx, PLAYER_PATHS.harvest, post('run#1'));
    const answer = (await (await call(ctx, PLAYER_PATHS.profile)).json()) as { profile: ProfileView };
    // Counts and a handful of recent rows, never the whole thing: five
    // thousand words is around 600KB and this goes out on every join.
    expect(answer.profile.words).toBe(1);
    expect(answer.profile.recent).toHaveLength(1);
    expect(answer.profile).not.toHaveProperty('applied');
  });

  it('reports what is due, which is the number the lobby shows', async () => {
    const ctx = newPlayer();
    await call(ctx, PLAYER_PATHS.harvest, post('run#1'));
    const answer = (await (await call(ctx, PLAYER_PATHS.profile)).json()) as { profile: ProfileView };
    // Just produced, so it is scheduled forward and not due yet.
    expect(answer.profile.due).toBe(0);
    expect(answer.profile.byLang).toEqual([{ lang: 'pl', words: 1, due: 0 }]);
  });
});

describe('refusals', () => {
  it('will not answer without an account to answer for', async () => {
    const ctx = newPlayer();
    const response = await ctx.player.fetch(new Request(`https://player${PLAYER_PATHS.profile}`));
    expect(response.status).toBe(400);
  });

  it('answers 404 for anything it does not do', async () => {
    const ctx = newPlayer();
    expect((await call(ctx, '/whatever')).status).toBe(404);
  });

  /**
   * A profile is migrated forward, never discarded. The same four lines that
   * correctly delete an unreadable *room* would, copied here, delete a year of
   * somebody's Polish on the deploy that adds a field.
   */
  it('repairs a stored profile it cannot fully read rather than dropping it', async () => {
    const ctx = newPlayer();
    ctx.state.store.set('profile', { version: 0, xp: 99, words: 'not an array' });
    const answer = (await (await call(ctx, PLAYER_PATHS.profile)).json()) as { profile: ProfileView };
    expect(answer.profile.xp).toBe(99);
    expect(answer.profile.words).toBe(0);
    expect(answer.profile.id).toBe(ID);
  });

  it('takes the address it was reached at as the id, over anything stored', async () => {
    const ctx = newPlayer();
    ctx.state.store.set('profile', { version: PROFILE_VERSION, id: 'somebody-else', words: [], games: [], applied: [] });
    const answer = (await (await call(ctx, PLAYER_PATHS.profile)).json()) as { profile: ProfileView };
    expect(answer.profile.id).toBe(ID);
  });
});
