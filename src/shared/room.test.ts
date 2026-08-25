import { describe, it, expect } from 'vitest';
import {
  CODE_LENGTH,
  RoomEngine,
  SNAPSHOT_VERSION,
  isRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  type RoomSnapshot,
} from './room.js';
import type { C4State } from './games/connect4.js';
import { wheel } from './games/wheel.js';

/** `create` returns null for an unknown game; every test here names a real one. */
function newRoom(code = 'TEST', gameId = 'connect4'): RoomEngine {
  const room = RoomEngine.create(code, gameId);
  if (!room) throw new Error(`could not create ${gameId}`);
  return room;
}

describe('room codes', () => {
  it('produces accepted characters at the advertised length', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  it('omits glyphs that are ambiguous when read aloud', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of makeRoomCode()) seen.add(ch);
    for (const ambiguous of ['O', 'I']) expect(seen.has(ambiguous)).toBe(false);
    for (const digit of '0123456789') expect(seen.has(digit)).toBe(false);
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', 'AB', 'ABCDE', 'ab!d', 'AB C']) {
      expect(isRoomCode(bad)).toBe(false);
    }
  });

  it('rejects glyphs the generator never emits, rather than sending them off to fail', () => {
    // Digits, O and I are not in the alphabet, so a code containing one is
    // always a typo, and better to say so at once than to come back with "no room".
    for (const bad of ['ABCO', 'ABC0', 'ABCI', 'ABC1', 'AB12']) {
      expect(isRoomCode(bad)).toBe(false);
    }
  });

  it('normalises typed input to something the server could accept', () => {
    expect(normalizeRoomCode('  ab-cd  ')).toBe('ABCD');
    expect(normalizeRoomCode('a1b2c3d4')).toBe('ABCD');
    expect(normalizeRoomCode('ABCDEFGHIJ')).toHaveLength(CODE_LENGTH);
    expect(isRoomCode(normalizeRoomCode('abcd'))).toBe(true);
  });
});

describe('creating', () => {
  it('refuses an unknown game rather than throwing at the caller', () => {
    // Every caller is holding a socket that needs an answer; a throw here
    // aborts the Durable Object and drops everyone else in the room.
    expect(RoomEngine.create('TEST', 'chess')).toBeNull();
    expect(() => RoomEngine.create('TEST', 'chess')).not.toThrow();
  });
});

describe('seating', () => {
  it('fills seats in order and then reports the room full', () => {
    const room = newRoom();
    expect(room.isFresh()).toBe(true);
    expect(room.join('a', 'A')).toEqual({ ok: true, seat: 0, reclaimed: false });
    expect(room.join('b', 'B')).toEqual({ ok: true, seat: 1, reclaimed: false });
    expect(room.isFresh()).toBe(false);
    const third = room.join('c', 'C');
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.error).toMatch(/full/i);
  });

  it('returns the same seat to a returning player', () => {
    const room = newRoom();
    room.join('a', 'A');
    room.join('b', 'B');
    expect(room.join('a', 'A')).toEqual({ ok: true, seat: 0, reclaimed: true });
    expect(room.seatOf('b')).toBe(1);
  });

  it('will not accept moves before the game is dealt', () => {
    const room = newRoom();
    room.join('a', 'A');
    room.join('b', 'B');
    const result = room.move(0, { type: 'drop', col: 0 });
    expect(result.ok).toBe(false);
    // Named, because "the game has not started yet" left a player wondering
    // which game the room thought it was holding.
    expect(result.ok === false && result.error).toMatch(/Connect Four has not been dealt/i);
  });

  /**
   * Battleships used to be the one game that opted out of the rule above, via
   * `allowsEarlyMove`: setting out a fleet was exactly what there was to do
   * while an invite went unanswered, and blocking it made every placement
   * bounce.
   *
   * Open seating removed the problem rather than the exception. A room is
   * dealt when the people in it say they are all here, so by the time there is
   * a fleet to place there is nobody still to arrive, so placing happens in an
   * ordinary dealt game like every other move.
   */
  it('lets a fleet be placed once the room has been dealt', () => {
    const room = newRoom('TEST', 'battleship');
    room.join('a', 'A');
    room.join('b', 'B');
    room.start(0, () => 0.5);
    expect(room.move(0, { type: 'place', kind: 'destroyer', row: 0, col: 0, horizontal: true }).ok)
      .toBe(true);
    expect(room.move(0, { type: 'scatter' }).ok).toBe(true);
    expect(room.move(0, { type: 'unplace', kind: 'destroyer' }).ok).toBe(true);
  });

  it('refuses a placement while the room is still gathering', () => {
    const room = newRoom('TEST', 'battleship');
    room.join('a', 'A');
    const early = room.move(0, { type: 'scatter' });
    expect(early.ok).toBe(false);
    expect(early.ok === false && early.error).toMatch(/Battleships has not been dealt/i);
  });

  /** One fleet placed must not start the shooting on its own. */
  it('does not let one fleet sail before the other is set out', () => {
    const room = newRoom('TEST', 'battleship');
    room.join('a', 'A');
    room.join('b', 'B');
    room.start(0, () => 0.5);
    room.move(0, { type: 'scatter' });
    expect((room.viewFor(0, new Set()).state as { phase: string }).phase).toBe('placing');
  });
});

describe('snapshot round-trip', () => {
  it('restores seats and board exactly, which is what survives hibernation', () => {
    const room = newRoom();
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    room.start(0);
    room.move(0, { type: 'drop', col: 3 });
    room.move(1, { type: 'drop', col: 3 });

    const revived = RoomEngine.restore(JSON.parse(JSON.stringify(room.snapshot())));
    if (!revived) throw new Error('snapshot should have restored');

    expect(revived.code).toBe('TEST');
    expect(revived.seatOf('a')).toBe(0);
    expect(revived.seatOf('b')).toBe(1);

    const view = revived.viewFor(0, new Set([0, 1]));
    const state = view.state as C4State;
    expect(state.moveCount).toBe(2);
    expect(state.board[5][3]).toBe(0);
    expect(state.board[4][3]).toBe(1);
    expect(view.turn).toBe(0);
    expect(view.players.map((p) => p.name)).toEqual(['Ann', 'Bo']);

    // And it keeps playing correctly from there.
    expect(revived.move(0, { type: 'drop', col: 0 }).ok).toBe(true);
  });
});

describe('snapshot versioning', () => {
  it('refuses a snapshot from a shape it no longer understands', () => {
    // Otherwise a deploy that changes a game's state shape bricks every stored
    // room for it: restore throws on every message, forever, and the bad
    // snapshot is never cleared.
    const stale = { ...newRoom().snapshot(), version: SNAPSHOT_VERSION - 1 };
    expect(RoomEngine.restore(stale)).toBeNull();
  });

  it('refuses a snapshot for a game that no longer exists', () => {
    const orphaned = { ...newRoom().snapshot(), gameId: 'chess' };
    expect(RoomEngine.restore(orphaned)).toBeNull();
  });

  it('refuses a snapshot with no version at all', () => {
    const ancient = { code: 'TEST', gameId: 'connect4', state: {}, seats: [] };
    expect(RoomEngine.restore(ancient as unknown as RoomSnapshot)).toBeNull();
  });

  it('stamps the current version on everything it writes', () => {
    expect(newRoom().snapshot().version).toBe(SNAPSHOT_VERSION);
  });
});

describe('view', () => {
  it('marks only genuinely connected seats as connected', () => {
    const room = newRoom();
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    const view = room.viewFor(0, new Set([0]));
    expect(view.players[0].connected).toBe(true);
    expect(view.players[1].connected).toBe(false);
  });
});

describe('open seating', () => {
  /** A room for `filled` people who have arrived but not yet started. */
  function table(filled: number, gameId = 'wheel'): RoomEngine {
    const room = RoomEngine.create('TEST', gameId);
    if (!room) throw new Error(`could not create ${gameId}`);
    for (let i = 0; i < filled; i++) room.join(`p${i}`, `P${i}`);
    return room;
  }

  it('opens with no seats at all and grows as people arrive', () => {
    const room = table(0);
    expect(room.size).toBe(0);
    expect(room.isFresh()).toBe(true);
    room.join('a', 'Ann');
    expect(room.size).toBe(1);
    room.join('b', 'Bo');
    expect(room.size).toBe(2);
  });

  it('takes whoever turns up, right up to what the game seats', () => {
    // The bug this replaced: a third friend arriving at a room "opened for
    // two" was told the game was full, and the only way to include them was
    // for everyone to abandon the code and start over.
    const room = table(4);
    expect(room.size).toBe(4);
    expect(room.capacity).toBe(4);
  });

  it('turns away the player who would be one too many', () => {
    const room = table(4);
    const late = room.join('late', 'Late');
    expect(late.ok).toBe(false);
    expect(late.ok === false && late.error).toMatch(/full/i);
    expect(late.ok === false && late.kind).toBe('full');
  });

  it('deals nothing until somebody starts it', () => {
    const room = table(2);
    expect(room.started()).toBe(false);
    const view = room.viewFor(0, new Set([0, 1]));
    expect(view.waiting).toBe(true);
    // No state, rather than an improvised one: there is no game yet, and a
    // board handed a made-up state would draw a lie.
    expect(view.state).toBeNull();
    expect(view.turn).toBeNull();
    expect(view.over).toBe(false);
  });

  it('refuses every move before the deal', () => {
    const room = table(2);
    const result = room.move(0, { type: 'spin' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Wheel of Fortune has not been dealt/i);
  });

  it('will not start below the game minimum', () => {
    const room = table(1);
    expect(room.canStart()).toBe(false);
    const result = room.start(0);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/more player/i);
  });

  it('lets only the player who opened the room start it', () => {
    const room = table(3);
    expect(room.start(1).ok).toBe(false);
    expect(room.start(2).ok).toBe(false);
    expect(room.start(0).ok).toBe(true);
  });

  it('refuses to start twice', () => {
    const room = table(2);
    expect(room.start(0).ok).toBe(true);
    const again = room.start(0);
    expect(again.ok).toBe(false);
    expect(again.ok === false && again.error).toMatch(
      /Wheel of Fortune is already under way in room/i,
    );
  });

  it('tells the game how many actually sat down', () => {
    // The whole reason the deal is deferred rather than done at create: the
    // reducer is told the real number, so no reducer had to learn what an
    // empty seat is.
    const room = table(3);
    room.start(0, () => 0.5);
    const state = room.viewFor(0, new Set([0, 1, 2])).state as { bank: number[] };
    expect(state.bank).toHaveLength(3);
  });

  it('says what it is waiting for, and it is not always the same thing', () => {
    const short = table(1);
    expect(short.viewFor(0, new Set()).status).toMatch(/1 more player.../);
    expect(short.viewFor(0, new Set()).canStart).toBe(false);

    const ready = table(2);
    expect(ready.viewFor(0, new Set()).canStart).toBe(true);
    expect(ready.viewFor(0, new Set()).status).toMatch(/can start/i);
  });

  it('refuses a latecomer once the game is under way', () => {
    // Seating them anyway hands the reducer a seat its arrays were never
    // sized for, and every move in the room fails from then on.
    const room = table(2);
    room.start(0, () => 0.5);
    const late = room.join('late', 'Late');
    expect(late.ok).toBe(false);
    expect(late.ok === false && late.error).toMatch(/already started/i);
    // Not 'full': the room has empty seats, and a player told it was full
    // would go looking for someone to make space that nobody can make.
    expect(late.ok === false && late.kind).toBe('started');
  });

  it('still lets a player who was here reclaim their seat mid-game', () => {
    const room = table(2);
    room.start(0, () => 0.5);
    const back = room.join('p1', 'P1');
    expect(back.ok).toBe(true);
    expect(back.ok === true && back.seat).toBe(1);
    expect(back.ok === true && back.reclaimed).toBe(true);
  });

  it('replays a rematch for whoever is at the table', () => {
    // Wheel of Fortune seats up to four, so a rematch that reached for
    // `maxPlayers` would quietly deal a two-handed room a four-handed game.
    const room = RoomEngine.restore({
      version: SNAPSHOT_VERSION,
      code: 'TEST',
      gameId: 'wheel',
      state: { ...wheel.setup(2, () => 0.5), roundOver: true, over: true },
      seats: [
        { playerId: 'a', name: 'Ann' },
        { playerId: 'b', name: 'Bo' },
      ],
    });
    if (!room) throw new Error('snapshot should have restored');

    expect(room.rematch().ok).toBe(true);
    const fresh = room.viewFor(0, new Set([0, 1])).state as { bank: number[] };
    expect(fresh.bank).toHaveLength(2);
    expect(room.size).toBe(2);
  });
});

/**
 * Word Hunt is the only timed game, and the room is what makes its clock real:
 * a reducer cannot end a round nobody is playing.
 */
describe('a game on a clock', () => {
  const START = 1_700_000_000_000;
  const ROUND_MS = 120_000;

  function hunt(): RoomEngine {
    const room = RoomEngine.create('TEST', 'wordhunt');
    if (!room) throw new Error('could not create wordhunt');
    room.join('a', 'A');
    room.join('b', 'B');
    room.start(0, () => 0.5, START);
    return room;
  }

  it('reports the deadline the adapters arm their timers on', () => {
    expect(hunt().deadline()).toBe(START + ROUND_MS);
  });

  /**
   * The clock belongs to the game being played, not to the room being open.
   * Starting it at `create` meant a hunt could run out while its second player
   * was still reading the invite.
   */
  it('does not start the clock until the game is dealt', () => {
    const room = RoomEngine.create('TEST', 'wordhunt');
    if (!room) throw new Error('could not create wordhunt');
    room.join('a', 'A');
    expect(room.deadline()).toBe(null);

    // Ten minutes of nobody turning up, and the round is still all there. The
    // clock belongs to the game being played, not to the room being open.
    const late = START + 10 * 60 * 1000;
    expect(room.tick(late)).toBe(false);
    expect(room.viewFor(0, new Set(), late).over).toBe(false);

    room.join('b', 'B');
    // Still nothing: arriving no longer starts anything by itself. Somebody
    // has to say the room is ready, which is the whole of open seating.
    expect(room.deadline()).toBe(null);

    room.start(0, () => 0.5, late);
    expect(room.deadline()).toBe(late + ROUND_MS);
  });

  it('does not hand out a fresh round when a player reconnects', () => {
    const room = hunt();
    room.join('a', 'A');
    expect(room.deadline()).toBe(START + ROUND_MS);
  });

  it('reports no deadline for a game that is not timed', () => {
    expect(newRoom().deadline()).toBe(null);
  });

  it('does nothing when the clock has not run out', () => {
    const room = hunt();
    expect(room.tick(START + ROUND_MS - 1)).toBe(false);
    expect(room.viewFor(0, new Set(), START).over).toBe(false);
  });

  it('ends the round when it does, with nobody having moved', () => {
    const room = hunt();
    expect(room.tick(START + ROUND_MS)).toBe(true);
    expect(room.viewFor(0, new Set(), START + ROUND_MS).over).toBe(true);
    // Settled once and left alone: a second tick has nothing to report.
    expect(room.tick(START + ROUND_MS + 1)).toBe(false);
  });

  it('refuses a move that arrives after time, without a tick having run', () => {
    const room = hunt();
    const late = room.move(0, { type: 'done' }, () => 0.5, START + ROUND_MS + 1);
    expect(late.ok).toBe(false);
    expect(room.viewFor(0, new Set(), START).over).toBe(true);
  });

  it('starts a fresh clock on a rematch', () => {
    const room = hunt();
    room.tick(START + ROUND_MS);
    const later = START + 10 * 60 * 1000;
    expect(room.rematch(() => 0.5, later).ok).toBe(true);
    expect(room.deadline()).toBe(later + ROUND_MS);
  });

  it('sends the server clock with every view, so a countdown has something to measure against', () => {
    expect(hunt().viewFor(0, new Set(), START).now).toBe(START);
  });
});

describe('changing game', () => {
  /**
   * A finished room, built by restoring a snapshot: `switchGame` refuses until
   * the current game is genuinely over, and finishing a Wheel properly needs
   * the answer that every view redacts by design.
   */
  function finishedWheel(seats: number): RoomEngine {
    const room = RoomEngine.restore({
      version: SNAPSHOT_VERSION,
      code: 'TEST',
      gameId: 'wheel',
      state: { ...wheel.setup(seats, () => 0.5), roundOver: true, over: true },
      seats: Array.from({ length: seats }, (_, i) => ({
        playerId: `p${i}`,
        name: `P${i}`,
      })),
    });
    if (!room) throw new Error('snapshot should have restored');
    return room;
  }

  it('keeps the code and the players when it changes the game', () => {
    const room = finishedWheel(2);
    expect(room.switchGame('connect4').ok).toBe(true);

    expect(room.def.id).toBe('connect4');
    expect(room.code).toBe('TEST');
    expect(room.size).toBe(2);
    const view = room.viewFor(0, new Set([0, 1]));
    expect(view.gameName).toBe('Connect Four');
    expect(view.players.map((p) => p.name)).toEqual(['P0', 'P1']);
    expect(view.over).toBe(false);
    // Everyone keeps the seat they were already sitting in.
    expect(room.seatOf('p1')).toBe(1);
  });

  it('deals the new game the table that is sitting there, not its maximum', () => {
    const room = finishedWheel(3);
    expect(room.switchGame('yahtzee').ok).toBe(true);
    const state = room.viewFor(0, new Set()).state as { sheets: unknown[] };
    expect(state.sheets).toHaveLength(3);
  });

  it('refuses while the current game is still in progress', () => {
    const room = newRoom('TEST', 'connect4');
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    room.start(0);
    const result = room.switchGame('wheel');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/in progress/i);
    expect(room.def.id).toBe('connect4');
  });

  it('refuses a game that will not seat this table', () => {
    // Connect Four is strictly two-handed, and these four are already seated:
    // switching would have to deal two of them out of the room.
    const room = finishedWheel(4);
    const result = room.switchGame('connect4');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/4/);
    expect(room.def.id).toBe('wheel');
  });

  it('refuses a game that does not exist', () => {
    const room = finishedWheel(2);
    expect(room.switchGame('hopscotch').ok).toBe(false);
    expect(room.def.id).toBe('wheel');
  });

  it('treats switching to the game already running as a rematch', () => {
    const room = finishedWheel(2);
    expect(room.switchGame('wheel').ok).toBe(true);
    expect(room.def.id).toBe('wheel');
    expect(room.viewFor(0, new Set()).over).toBe(false);
  });

  it('survives the round trip through a snapshot', () => {
    const room = finishedWheel(2);
    expect(room.switchGame('connect4').ok).toBe(true);
    const restored = RoomEngine.restore(room.snapshot());
    expect(restored?.def.id).toBe('connect4');
    expect(restored?.viewFor(0, new Set()).gameName).toBe('Connect Four');
  });
});
