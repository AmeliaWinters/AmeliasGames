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
function newRoom(code = 'TESTER', gameId = 'connect4'): RoomEngine {
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
    for (const ambiguous of ['O', '0', 'I', '1']) expect(seen.has(ambiguous)).toBe(false);
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', 'ABC', 'ABCDEFG', 'ab!def', 'AB CDE']) {
      expect(isRoomCode(bad)).toBe(false);
    }
  });

  it('rejects glyphs the generator never emits, rather than sending them off to fail', () => {
    // O/0 and I/1 are not in the alphabet, so a code containing one is always a
    // typo — better to say so at once than to come back with "no room".
    for (const bad of ['ABCDEO', 'ABCDE0', 'ABCDEI', 'ABCDE1']) {
      expect(isRoomCode(bad)).toBe(false);
    }
  });

  it('normalises typed input to something the server could accept', () => {
    expect(normalizeRoomCode('  abc-def  ')).toBe('ABCDEF');
    expect(normalizeRoomCode('ABCDEFGHIJ')).toHaveLength(CODE_LENGTH);
    expect(isRoomCode(normalizeRoomCode('abcdef'))).toBe(true);
  });
});

describe('creating', () => {
  it('refuses an unknown game rather than throwing at the caller', () => {
    // Every caller is holding a socket that needs an answer; a throw here
    // aborts the Durable Object and drops everyone else in the room.
    expect(RoomEngine.create('TESTER', 'chess')).toBeNull();
    expect(() => RoomEngine.create('TESTER', 'chess')).not.toThrow();
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

  it('will not accept moves before the room is full', () => {
    const room = newRoom();
    room.join('a', 'A');
    const result = room.move(0, { type: 'drop', col: 0 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/waiting/i);
  });
});

describe('snapshot round-trip', () => {
  it('restores seats and board exactly — this is what survives hibernation', () => {
    const room = newRoom();
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    room.move(0, { type: 'drop', col: 3 });
    room.move(1, { type: 'drop', col: 3 });

    const revived = RoomEngine.restore(JSON.parse(JSON.stringify(room.snapshot())));
    if (!revived) throw new Error('snapshot should have restored');

    expect(revived.code).toBe('TESTER');
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
    // room for it — restore throws on every message, forever, and the bad
    // snapshot is never cleared.
    const stale = { ...newRoom().snapshot(), version: SNAPSHOT_VERSION - 1 };
    expect(RoomEngine.restore(stale)).toBeNull();
  });

  it('refuses a snapshot for a game that no longer exists', () => {
    const orphaned = { ...newRoom().snapshot(), gameId: 'chess' };
    expect(RoomEngine.restore(orphaned)).toBeNull();
  });

  it('refuses a snapshot with no version at all', () => {
    const ancient = { code: 'TESTER', gameId: 'connect4', state: {}, seats: [null, null] };
    expect(RoomEngine.restore(ancient as RoomSnapshot)).toBeNull();
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

describe('table size', () => {
  /** A four-handed room, seated but for the count given. */
  function table(count: number, filled = count): RoomEngine {
    const room = RoomEngine.create('TESTER', 'wheel', undefined, count);
    if (!room) throw new Error('could not create wheel');
    for (let i = 0; i < filled; i++) room.join(`p${i}`, `P${i}`);
    return room;
  }

  it('lays out as many seats as the room was opened for', () => {
    expect(table(2, 0).size).toBe(2);
    expect(table(3, 0).size).toBe(3);
    expect(table(4, 0).size).toBe(4);
  });

  it('clamps a size the game cannot seat, rather than refusing the room', () => {
    expect(table(99, 0).size).toBe(4);
    expect(table(1, 0).size).toBe(2);
    // And a game with no range is unaffected by being asked for one.
    expect(newRoom('TESTER', 'connect4').size).toBe(2);
  });

  it('tells the game how big its table is', () => {
    const room = table(3);
    const state = room.viewFor(0, new Set([0, 1, 2])).state as { bank: number[] };
    expect(state.bank).toHaveLength(3);
  });

  it('waits for every seat, not merely for the game minimum', () => {
    // A four-handed room that started as soon as two arrived would deal the
    // other two out of a game they were invited to.
    const room = table(4, 3);
    expect(room.viewFor(0, new Set()).waiting).toBe(true);
    expect(room.move(0, { type: 'spin' }).ok).toBe(false);
    expect(room.viewFor(0, new Set()).status).toMatch(/1 more player…/);

    room.join('p3', 'P3');
    expect(room.viewFor(0, new Set()).waiting).toBe(false);
  });

  it('counts down how many are still missing', () => {
    expect(table(4, 1).viewFor(0, new Set()).status).toMatch(/3 more players…/);
  });

  it('turns away the player who would be one too many', () => {
    const room = table(3);
    const late = room.join('late', 'Late');
    expect(late.ok).toBe(false);
    expect(late.ok === false && late.error).toMatch(/full/i);
  });

  it('replays a rematch at the same table, not at the game maximum', () => {
    // Wheel of Fortune seats up to four, so a rematch that reached for
    // `maxPlayers` would quietly deal a two-handed room a four-handed game.
    // Restored from a finished snapshot because `rematch` refuses until the
    // match is genuinely over, and the answer needed to end one properly is
    // redacted from every view by design.
    const room = RoomEngine.restore({
      version: SNAPSHOT_VERSION,
      code: 'TESTER',
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
