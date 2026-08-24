/**
 * The part of a room that is neither the rules nor the socket.
 *
 * `RoomEngine` is shared by both adapters and always has been. Everything
 * *above* it was not: reading a frame, checking the protocol version, clamping
 * a name, deciding whether a create-flagged hello may have the room it is
 * asking for, and dispatching the four action messages all existed twice —
 * once in the Node dev server and once in the Durable Object — in the same
 * order, with the same reasoning written out twice in the comments.
 *
 * That is the security-critical surface, and it is exactly the wrong thing to
 * keep two copies of: a rule tightened in one adapter and missed in the other
 * is invisible, because each has its own test suite proving its own copy.
 *
 * So this module holds the decisions and the adapters hold the I/O. Everything
 * here is pure and synchronous, which is what lets the Durable Object — whose
 * engine arrives from storage, asynchronously, and may not arrive at all — use
 * the same code as a dev server holding the engine in a Map. The split falls
 * where the await does: the adapter fetches the engine, this decides what to
 * do with it.
 *
 * What deliberately stays in the adapters is the part that is genuinely
 * different: seat bookkeeping (a `Map` against `getWebSockets()` and socket
 * attachments), persistence, and waking up (a `setTimeout` against a Durable
 * Object alarm). Those are not two copies of one thing.
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
 * an absurd thing to do.
 */
export const MAX_NAME = 20;

/** A `hello` that has been read and found to make sense. */
export interface Hello {
  playerId: string;
  name: string;
  code: string;
  create: boolean;
  gameId: string;
}

/**
 * Read one frame off the wire.
 *
 * `JSON.parse` of the four bytes `null` succeeds and yields null, and reading
 * `.t` off that throws — which in the dev server would reach
 * `uncaughtException` and take every room on the process with it, and in the
 * worker would abort the Durable Object and the other player's game with it.
 * Both adapters learned that separately. Now neither has to.
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
 * one — in production it is what chose this Durable Object, so a hello naming
 * a different room would otherwise be welcomed into this one. The dev server
 * does not route by code, but it passes its URL's code anyway: "the code on
 * the socket is the code in the hello" is an invariant, and an invariant
 * enforced in one adapter only is the way the two stop agreeing.
 */
export function readHello(
  msg: Extract<ClientMessage, { t: 'hello' }>,
  routingCode: string | null,
): { ok: true; hello: Hello } | ({ ok: false } & Refusal) {
  if (msg.v !== PROTOCOL_VERSION) {
    return { ok: false, kind: 'protocol', error: 'This page is out of date — please refresh.' };
  }

  const playerId = String(msg.playerId ?? '');
  const code = String(msg.code ?? '').toUpperCase();
  if (!playerId) return { ok: false, kind: 'protocol', error: 'Missing player id.' };
  if (!isRoomCode(code)) {
    return {
      ok: false,
      kind: 'protocol',
      error: `${named(msg.code)} is not a room code — they are ${CODE_LENGTH} letters.`,
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
    },
  };
}

/**
 * Which room this hello gets: the one that is already there, or a new one.
 *
 * `existing` is whatever the adapter found — a room from its `Map`, a snapshot
 * restored from Durable Object storage, or null for neither. `created` says
 * whether the engine coming back is new, because that is the adapter's cue to
 * register or persist it, and only the adapter knows how.
 *
 * The two refusals here are the ones worth stating plainly:
 *
 * Starting a "new" game on a code that is already someone else's room would
 * silently seat you as player two of their game. Two rooms are not someone
 * else's, though: one nobody has sat in yet, and one where this player already
 * has a seat. That second case is ordinary — a create-flagged hello arriving
 * twice, from a retry or a remount — and refusing it would lock the host out
 * of the room they had just made.
 *
 * A hello naming a different game than the room is playing is refused rather
 * than quietly honoured, because the client asked for one thing and would be
 * given another.
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
        error: `Room ${hello.code} is already someone else's game. Try starting again.`,
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
  // whatever the game itself seats.
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
 * reducer is not supposed to throw, and the fuzzing says none of them does —
 * but an exception escaping here is fatal in both adapters, and fatal to every
 * other room sharing the process or the object. So the guard is here, once,
 * around the only place a reducer is ever entered.
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
    return { ok: false, error: 'That move could not be played.' };
  }
}
