import { describe, it, expect } from 'vitest';
import { RoomEngine, makeRoomCode, isRoomCode } from './room.js';
import type { C4State } from './games/connect4.js';

describe('room codes', () => {
  it('produces four accepted characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(4);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  it('omits glyphs that are ambiguous when read aloud', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of makeRoomCode()) seen.add(ch);
    for (const ambiguous of ['O', '0', 'I', '1']) expect(seen.has(ambiguous)).toBe(false);
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', 'ABC', 'ABCDE', 'ab!d', 'AB CD']) expect(isRoomCode(bad)).toBe(false);
  });
});

describe('seating', () => {
  it('fills seats in order and then reports the room full', () => {
    const room = RoomEngine.create('TEST', 'connect4');
    expect(room.isFresh()).toBe(true);
    expect(room.join('a', 'A')).toEqual({ ok: true, seat: 0, reclaimed: false });
    expect(room.join('b', 'B')).toEqual({ ok: true, seat: 1, reclaimed: false });
    expect(room.isFresh()).toBe(false);
    const third = room.join('c', 'C');
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.error).toMatch(/full/i);
  });

  it('returns the same seat to a returning player', () => {
    const room = RoomEngine.create('TEST', 'connect4');
    room.join('a', 'A');
    room.join('b', 'B');
    expect(room.join('a', 'A')).toEqual({ ok: true, seat: 0, reclaimed: true });
    expect(room.seatOf('b')).toBe(1);
  });

  it('will not accept moves before the room is full', () => {
    const room = RoomEngine.create('TEST', 'connect4');
    room.join('a', 'A');
    const result = room.move(0, { type: 'drop', col: 0 });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/waiting/i);
  });
});

describe('snapshot round-trip', () => {
  it('restores seats and board exactly — this is what survives hibernation', () => {
    const room = RoomEngine.create('TEST', 'connect4');
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    room.move(0, { type: 'drop', col: 3 });
    room.move(1, { type: 'drop', col: 3 });

    const revived = RoomEngine.restore(JSON.parse(JSON.stringify(room.snapshot())));

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

describe('view', () => {
  it('marks only genuinely connected seats as connected', () => {
    const room = RoomEngine.create('TEST', 'connect4');
    room.join('a', 'Ann');
    room.join('b', 'Bo');
    const view = room.viewFor(0, new Set([0]));
    expect(view.players[0].connected).toBe(true);
    expect(view.players[1].connected).toBe(false);
  });
});
