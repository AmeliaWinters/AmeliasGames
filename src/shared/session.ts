/**
 * The part of a room that is neither the rules nor the socket.
 *
 * `RoomEngine` is shared by both adapters and always has been. Everything
 * *above* it was not: reading a frame, checking the protocol version, clamping
 * a name, deciding whether a create-flagged hello may have the room it asks
 * for, and dispatching the four action messages all existed twice, once in the
 * Node dev server and once in the Durable Object, in the same order with the
 * same reasoning written out twice.
 *
 * That is the security-critical surface, and exactly the wrong thing to keep
 * two copies of: a rule tightened in one adapter and missed in the other is
 * invisible, because each has its own tests proving its own copy.
 *
 * So this module holds the decisions and the adapters hold the I/O. Everything
 * here is pure and synchronous, which is what lets the Durable Object (whose
 * engine arrives from storage, asynchronously, and may not arrive at all) use
 * the same code as a dev server holding the engine in a Map. The split falls
 * where the await does: the adapter fetches the engine, this decides what to
 * do with it.
 *
 * Seat bookkeeping, persistence and waking up stay in the adapters, because
 * those are genuinely different between the two rather than two copies of one
 * thing.
 */
import { CODE_LENGTH, RoomEngine, isRoomCode } from './room.js';
import { named } from './refusal.js';
import { getGame } from './games/index.js';
import { PROTOCOL_VERSION, type ClientMessage, type ErrorKind } from './protocol.js';
import type { ActionResult } from './room.js';

/** A refusal, in the shape both adapters send it. */
export interface Refusal {
  kind: ErrorKind;
  error: string;
}

/**
 * The longest name we will show. Clamped rather than refused: a name is a
 * label above a seat, and turning somebody away from a game over it would be
 * absurd.
 */
export const MAX_NAME = 20;

/** A `hello` that has been read and found to make sense. */
export interface Hello {
  playerId: string;
  name: string;
  code: string;
  create: boolean;
  gameId: string;
  /**
   * The account claim as it arrived, still unverified.
   *
   * Carried rather than checked, because checking it is asynchronous —
   * `crypto.subtle.verify` — and everything in this module is deliberately
   * synchronous so that the Durable Object and the dev server can share it
   * verbatim. So the shape is read here and the truth of it is established by
   * `verifyClaim` in the adapters, one await before `admit`. The split still
   * falls where the await does.
   *
   * `undefined` for a guest, which is the ordinary case and always will be.
   */
  claim?: unknown;
  /**
   * The account this hello *proved*, filled in by the adapter after
   * `verifyClaim`. Never set by anything that has only read the wire.
   *
   * On the same object as `claim` so that a reader cannot mistake one for the
   * other: the field with the id in it is the one that has been checked.
   */
  accountId?: string;
}

/**
 * Read one frame off the wire.
 *
 * `JSON.parse` of the four bytes `null` succeeds and yields null, and reading
 * `.t` off that throws, which in the dev server reaches `uncaughtException`
 * and takes every room on the process with it, and in the worker aborts the
 * Durable Object and the other player's game with it. Both adapters learned
 * that separately. Now neither has to.
 */
export function readFrame(raw: string): { ok: true; msg: ClientMessage } | ({ ok: false } & Refusal) {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { ok: false, kind: 'protocol', error: 'Malformed message.' };
  }
  if (typeof msg !== 'object' || msg === null) {
    return { ok: false, kind: 'protocol', error: 'Malformed message.' };
  }
  return { ok: true, msg: msg as ClientMessage };
}

/**
 * Validate a `hello`, and normalise everything that comes out of it.
 *
 * `routingCode` is the code the socket arrived on, where the transport has
 * one. In production it is what chose this Durable Object, so a hello naming a
 * different room would otherwise be welcomed into this one. The dev server
 * does not route by code but passes its URL's code anyway: "the code on the
 * socket is the code in the hello" is an invariant, and an invariant enforced
 * in one adapter only is how the two stop agreeing.
 */
export function readHello(
  msg: Extract<ClientMessage, { t: 'hello' }>,
  routingCode: string | null,
): { ok: true; hello: Hello } | ({ ok: false } & Refusal) {
  if (msg.v !== PROTOCOL_VERSION) {
    return { ok: false, kind: 'protocol', error: 'This page is out of date, give it a refresh.' };
  }

  const playerId = String(msg.playerId ?? '');
  const code = String(msg.code ?? '').toUpperCase();
  if (!playerId) return { ok: false, kind: 'protocol', error: 'Missing player id.' };
  if (!isRoomCode(code)) {
    return {
      ok: false,
      kind: 'protocol',
      error: `${named(msg.code)} is not a room code. They are ${CODE_LENGTH} letters.`,
    };
  }
  if (routingCode && code !== routingCode) {
    return {
      ok: false,
      kind: 'protocol',
      error: `This is room ${routingCode}, and that hello asked for ${code}.`,
    };
  }

  return {
    ok: true,
    hello: {
      playerId,
      code,
      name: String(msg.name ?? '').trim().slice(0, MAX_NAME) || 'Player',
      create: msg.create === true,
      gameId: String(msg.gameId ?? ''),
      // Passed through untouched, and deliberately not validated here beyond
      // existing. A claim that is malformed, forged or simply broken is not a
      // reason to turn somebody away from a game of Connect Four; it is a
      // reason to seat them as a guest, and `verifyClaim` returning null is how
      // that gets said.
      claim: msg.account,
    },
  };
}

/**
 * Which room this hello gets: the one already there, or a new one.
 *
 * `existing` is whatever the adapter found: a room from its `Map`, a snapshot
 * restored from Durable Object storage, or null for neither. `created` says
 * whether the engine coming back is new, because that is the adapter's cue to
 * register or persist it, and only the adapter knows how.
 *
 * Two refusals worth stating plainly. Starting a "new" game on a code that is
 * already someone else's room would silently seat you as their player two. Two
 * rooms are not someone else's, though: one nobody has sat in yet, and one
 * where this player already has a seat. That second case is ordinary (a
 * create-flagged hello arriving twice, from a retry or a remount) and refusing
 * it would lock the host out of the room they just made.
 *
 * And a hello naming a different game than the room is playing is refused
 * rather than quietly honoured, because the client asked for one thing and
 * would be given another.
 */
export function admit(
  existing: RoomEngine | null,
  hello: Hello,
): { ok: true; engine: RoomEngine; created: boolean } | ({ ok: false } & Refusal) {
  if (existing) {
    const mine = existing.seatOf(hello.playerId) !== -1;
    if (hello.create && !existing.isFresh() && !mine) {
      return {
        ok: false,
        kind: 'full',
        error: `Room ${hello.code} is already someone else's game. Start a fresh one.`,
      };
    }
    if (hello.gameId && hello.gameId !== existing.def.id) {
      return {
        ok: false,
        kind: 'rejected',
        error: `Room ${hello.code} is playing ${existing.def.name}.`,
      };
    }
    return { ok: true, engine: existing, created: false };
  }

  if (!hello.create) {
    return { ok: false, kind: 'no-room', error: `No room with code ${hello.code}.` };
  }
  if (!getGame(hello.gameId)) {
    return {
      ok: false,
      kind: 'rejected',
      error: `There is no game called ${named(hello.gameId)}.`,
    };
  }
  // No size to settle: the room opens empty and takes whoever arrives, up to
  // whatever the game seats.
  const engine = RoomEngine.create(hello.code, hello.gameId);
  if (!engine) {
    return { ok: false, kind: 'rejected', error: `Could not open a room of ${hello.gameId}.` };
  }
  return { ok: true, engine, created: true };
}

/** The four messages that change a room, as opposed to asking it something. */
export type ActionMessage = Extract<ClientMessage, { t: 'move' | 'rematch' | 'switch' | 'start' }>;

export function isAction(msg: ClientMessage): msg is ActionMessage {
  return msg.t === 'move' || msg.t === 'rematch' || msg.t === 'switch' || msg.t === 'start';
}

/**
 * Run one action against the room, and never throw.
 *
 * The server runs the same reducer the client does and its answer wins. A
 * reducer is not supposed to throw, and the fuzzing says none of them does,
 * but an exception escaping here is fatal in both adapters and to every other
 * room sharing the process or the object. So the guard is here, once, around
 * the only place a reducer is ever entered.
 */
export function applyAction(engine: RoomEngine, seat: number, msg: ActionMessage): ActionResult {
  try {
    switch (msg.t) {
      case 'move':
        return engine.move(seat, msg.move);
      case 'switch':
        return engine.switchGame(String(msg.gameId ?? ''));
      case 'start':
        return engine.start(seat);
      case 'rematch':
        return engine.rematch();
    }
  } catch {
    return { ok: false, error: "That move didn't land." };
  }
}

/**
 * What a lobby is told about a code before anybody commits to it.
 *
 * Deliberately not a `RoomView`: nobody has said hello yet, so there is no
 * seat to build one for, and a view carries the state of a game in progress to
 * a browser that has not been admitted to it. This is the three facts the
 * question "is this the right code?" actually needs, and nothing that could
 * not be read off the door.
 *
 * `full` rather than "you may join": whether a *particular* person may sit
 * down is `admit` plus `join`, both of which want a hello, and both of which
 * run again on the socket anyway. This is a warning, not a verdict.
 */
export interface RoomPeek {
  code: string;
  exists: boolean;
  gameId?: string;
  gameName?: string;
  players?: number;
  capacity?: number;
  full?: boolean;
}

/** Both adapters answer the lookup with this, so the two cannot drift. */
export function peek(code: string, engine: RoomEngine | null): RoomPeek {
  if (!engine) return { code, exists: false };
  return {
    code,
    exists: true,
    gameId: engine.def.id,
    gameName: engine.def.name,
    players: engine.size,
    capacity: engine.capacity,
    full: engine.size >= engine.capacity,
  };
}
