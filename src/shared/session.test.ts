import { describe, it, expect } from 'vitest';
import { RoomEngine } from './room.js';
import { PROTOCOL_VERSION, type ClientMessage } from './protocol.js';
import { MAX_NAME, admit, applyAction, isAction, readFrame, readHello } from './session.js';

/**
 * These rules used to live twice — once in `src/server/index.ts` and once in
 * `src/worker/index.ts` — and so did their tests. Two suites proving two
 * copies is the arrangement in which a rule tightened on one side and missed
 * on the other passes everywhere and is wrong in production.
 *
 * The adapter suites still exist and still matter: they prove the socket
 * bookkeeping, hibernation, alarms and sweeps, which really are different on
 * each side. What they no longer have to prove twice is this.
 */

const CODE = 'ABCD';

function hello(over: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}) {
  return {
    t: 'hello',
    v: PROTOCOL_VERSION,
    playerId: 'p1',
    name: 'Amelia',
    code: CODE,
    create: true,
    gameId: 'connect4',
    ...over,
  } as Extract<ClientMessage, { t: 'hello' }>;
}

describe('reading a frame', () => {
  it('reads an ordinary message', () => {
    const result = readFrame(JSON.stringify({ t: 'ping' }));
    expect(result.ok && result.msg.t).toBe('ping');
  });

  it('refuses something that is not JSON at all', () => {
    const result = readFrame('{oh dear');
    expect(result).toMatchObject({ ok: false, kind: 'protocol' });
  });

  /**
   * The four bytes `null` parse successfully and yield null, and reading `.t`
   * off that throws. Unguarded it is an uncaught exception in the dev server
   * and an aborted Durable Object in production — in both cases taking every
   * other room with it.
   */
  it('refuses the payloads that parse to something with no `t` to read', () => {
    for (const raw of ['null', '42', '"hello"', 'true']) {
      expect(readFrame(raw), raw).toMatchObject({ ok: false, kind: 'protocol' });
    }
  });

  it('lets an array through, because an array cannot throw either', () => {
    // `typeof [] === 'object'` and it is not null, so this passes the guard —
    // and that is fine. Reading `.t` off it yields undefined, which every
    // `t` test below simply misses. The guard is against throwing, not against
    // nonsense; nonsense is handled by falling through to nothing.
    expect(readFrame('[]').ok).toBe(true);
  });
});

describe('reading a hello', () => {
  it('accepts a well-formed one', () => {
    const result = readHello(hello(), CODE);
    expect(result.ok && result.hello).toMatchObject({
      playerId: 'p1',
      name: 'Amelia',
      code: CODE,
      create: true,
      gameId: 'connect4',
    });
  });

  it('turns away a client built against another protocol version', () => {
    const result = readHello(hello({ v: PROTOCOL_VERSION - 1 }), CODE);
    expect(result).toMatchObject({ ok: false, kind: 'protocol' });
  });

  it('refuses a hello with no player id', () => {
    expect(readHello(hello({ playerId: '' }), CODE)).toMatchObject({ ok: false, kind: 'protocol' });
  });

  it('refuses a code the generator could never have produced', () => {
    // O and I are never generated, so a code holding one is always a typo.
    for (const code of ['', 'AB', 'ABCDE', 'AB0D', 'ABOD']) {
      expect(readHello(hello({ code }), null), code).toMatchObject({ ok: false, kind: 'protocol' });
    }
  });

  it('upper-cases a code typed in lower case', () => {
    const result = readHello(hello({ code: 'abcd' }), CODE);
    expect(result.ok && result.hello.code).toBe(CODE);
  });

  /**
   * In production the code in the URL is what chose the Durable Object, so a
   * hello naming a different room would be welcomed into this one. The dev
   * server does not route by code but passes its URL's code anyway, so the
   * invariant holds on both sides rather than only where it happens to bite.
   */
  it('refuses a hello for a different room than the one that routed it', () => {
    expect(readHello(hello({ code: 'WXYZ' }), CODE)).toMatchObject({
      ok: false,
      kind: 'protocol',
    });
  });

  it('clamps a name rather than refusing it', () => {
    // A name is a label above a seat. Turning somebody away from a game over
    // one would be an absurd thing to do.
    const long = 'x'.repeat(MAX_NAME + 40);
    const result = readHello(hello({ name: long }), CODE);
    expect(result.ok && result.hello.name).toHaveLength(MAX_NAME);
  });

  it('gives an empty or blank name something to be called', () => {
    for (const name of ['', '   ', undefined as unknown as string]) {
      const result = readHello(hello({ name }), CODE);
      expect(result.ok && result.hello.name).toBe('Player');
    }
  });
});

describe('which room a hello gets', () => {
  const greeting = (over: Partial<Extract<ClientMessage, { t: 'hello' }>> = {}) => {
    const read = readHello(hello(over), null);
    if (!read.ok) throw new Error('fixture hello should be valid');
    return read.hello;
  };

  it('opens a new room for a create-flagged hello', () => {
    const result = admit(null, greeting());
    expect(result.ok && result.created).toBe(true);
    expect(result.ok && result.engine.code).toBe(CODE);
  });

  it('refuses to open one for a hello that is not creating', () => {
    expect(admit(null, greeting({ create: false }))).toMatchObject({ ok: false, kind: 'no-room' });
  });

  it('refuses a game that does not exist', () => {
    expect(admit(null, greeting({ gameId: 'chess' }))).toMatchObject({
      ok: false,
      kind: 'rejected',
    });
  });

  it('lets an ordinary joiner into a room that is already there', () => {
    const existing = RoomEngine.create(CODE, 'connect4')!;
    existing.join('p1', 'Amelia');
    const result = admit(existing, greeting({ playerId: 'p2', create: false }));
    expect(result.ok && result.created).toBe(false);
    expect(result.ok && result.engine).toBe(existing);
  });

  /**
   * Starting a "new" game on a code that is already someone else's room would
   * silently seat you as player two of their game.
   */
  it('refuses to create over a room somebody is already sitting in', () => {
    const existing = RoomEngine.create(CODE, 'connect4')!;
    existing.join('someone-else', 'Bea');
    expect(admit(existing, greeting({ playerId: 'p1' }))).toMatchObject({
      ok: false,
      kind: 'full',
    });
  });

  it('lets the host re-send a create-flagged hello for their own room', () => {
    // Ordinary — a retry, or a remount. Refusing it would lock the host out of
    // the room they had just made.
    const existing = RoomEngine.create(CODE, 'connect4')!;
    existing.join('p1', 'Amelia');
    expect(admit(existing, greeting({ playerId: 'p1' })).ok).toBe(true);
  });

  it('creates over a room nobody has ever sat in', () => {
    // A code collision against a room that was opened and abandoned before
    // anyone arrived is not somebody else's game.
    const existing = RoomEngine.create(CODE, 'connect4')!;
    expect(admit(existing, greeting({ playerId: 'p1' })).ok).toBe(true);
  });

  it('refuses a hello naming a different game than the room is playing', () => {
    const existing = RoomEngine.create(CODE, 'yahtzee')!;
    existing.join('p1', 'Amelia');
    const result = admit(existing, greeting({ playerId: 'p2', create: false }));
    expect(result).toMatchObject({ ok: false, kind: 'rejected' });
    expect(result.ok === false && result.error).toContain('Yahtzee');
  });

  it('lets a hello with no game id in the door, whatever the room is playing', () => {
    // The client only names a game when it is opening one.
    const existing = RoomEngine.create(CODE, 'yahtzee')!;
    existing.join('p1', 'Amelia');
    expect(admit(existing, greeting({ playerId: 'p2', create: false, gameId: '' })).ok).toBe(true);
  });
});

describe('running an action', () => {
  function dealt() {
    const engine = RoomEngine.create(CODE, 'connect4')!;
    engine.join('p1', 'Amelia');
    engine.join('p2', 'Bea');
    engine.start(0);
    return engine;
  }

  it('knows an action from a message that is not one', () => {
    expect(isAction({ t: 'move', move: {} })).toBe(true);
    expect(isAction({ t: 'start' })).toBe(true);
    expect(isAction({ t: 'rematch' })).toBe(true);
    expect(isAction({ t: 'switch', gameId: 'yahtzee' })).toBe(true);
    expect(isAction({ t: 'ping' })).toBe(false);
  });

  it('plays a legal move', () => {
    const engine = dealt();
    expect(applyAction(engine, 0, { t: 'move', move: { type: 'drop', col: 3 } }).ok).toBe(true);
  });

  it('refuses a move made out of turn, whatever the client believes', () => {
    const engine = dealt();
    const result = applyAction(engine, 1, { t: 'move', move: { type: 'drop', col: 3 } });
    expect(result.ok).toBe(false);
  });

  /**
   * A reducer is not supposed to throw, and the fuzzing says none of them
   * does. But an exception escaping here is fatal in both adapters, and fatal
   * to every other room sharing the process or the object — so the guard is
   * held by a test rather than by hope.
   */
  it('turns a reducer that throws into a refusal, not a crash', () => {
    const engine = dealt();
    const exploding = {
      ...engine.def,
      applyMove() {
        throw new Error('boom');
      },
    };
    engine.def = exploding;
    const result = applyAction(engine, 0, { t: 'move', move: { type: 'drop', col: 3 } });
    expect(result).toEqual({ ok: false, error: 'That move could not be played.' });
  });

  it('refuses a switch to a game that does not exist', () => {
    const engine = dealt();
    expect(applyAction(engine, 0, { t: 'switch', gameId: 'chess' }).ok).toBe(false);
  });

  it('refuses a start from anyone but seat 0', () => {
    const engine = RoomEngine.create(CODE, 'connect4')!;
    engine.join('p1', 'Amelia');
    engine.join('p2', 'Bea');
    expect(applyAction(engine, 1, { t: 'start' }).ok).toBe(false);
    expect(applyAction(engine, 0, { t: 'start' }).ok).toBe(true);
  });
});
