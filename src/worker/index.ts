/// <reference types="@cloudflare/workers-types" />
import { RoomEngine, isRoomCode, type RoomSnapshot } from '../shared/room.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
}

/** Per-socket identity, kept across hibernation via serializeAttachment. */
interface SocketMeta {
  playerId: string;
  seat: number;
}

/**
 * One Durable Object per room code. Cloudflare guarantees a single instance
 * globally for a given code, which is exactly the "one authoritative process
 * per game" model — no locking, no shared database.
 */
export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private engine: RoomEngine | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  /**
   * Rehydrate the room from storage.
   *
   * This must be called on EVERY message, not just on join. Hibernation
   * destroys the object instance while the sockets stay alive, so an in-memory
   * `engine` is routinely null for a player who joined perfectly legitimately.
   */
  private async loadEngine(): Promise<RoomEngine | null> {
    if (this.engine) return this.engine;
    const stored = await this.state.storage.get<RoomSnapshot>('room');
    if (stored) this.engine = RoomEngine.restore(stored);
    return this.engine;
  }

  private async engineFor(gameId: string, code: string, create: boolean): Promise<RoomEngine | null> {
    const existing = await this.loadEngine();
    if (existing) return existing;
    if (!create) return null;
    this.engine = RoomEngine.create(code, gameId);
    await this.persist();
    return this.engine;
  }

  private async persist(): Promise<void> {
    if (this.engine) await this.state.storage.put('room', this.engine.snapshot());
  }

  /** Seats with a live socket right now. */
  private connectedSeats(): Set<number> {
    const seats = new Set<number>();
    for (const ws of this.state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta) seats.add(meta.seat);
    }
    return seats;
  }

  private post(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket is going away; close handler will clean up */
    }
  }

  private broadcast(): void {
    if (!this.engine) return;
    const connected = this.connectedSeats();
    for (const ws of this.state.getWebSockets()) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta) this.post(ws, { t: 'room', room: this.engine.viewFor(meta.seat, connected) });
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    const pair = new WebSocketPair();
    // acceptWebSocket (rather than ws.accept) opts into hibernation: an idle
    // room is evicted from memory and costs nothing until the next message.
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.post(ws, { t: 'error', message: 'Malformed message.' });
    }

    const meta = ws.deserializeAttachment() as SocketMeta | null;

    if (msg.t === 'hello') {
      if (meta) return;

      const name = String(msg.name ?? '').trim().slice(0, 20) || 'Player';
      const playerId = String(msg.playerId ?? '');
      const code = String(msg.code ?? '').toUpperCase();
      if (!playerId) return this.post(ws, { t: 'error', message: 'Missing player id.' });
      if (!isRoomCode(code)) return this.post(ws, { t: 'error', message: 'Invalid room code.' });

      const engine = await this.engineFor(msg.gameId, code, msg.create === true);
      if (!engine) return this.post(ws, { t: 'error', message: 'No room with that code.' });

      const result = engine.join(playerId, name);
      if (!result.ok) return this.post(ws, { t: 'error', message: result.error });

      // Drop any earlier socket for this same player so it stops receiving updates.
      for (const other of this.state.getWebSockets()) {
        if (other === ws) continue;
        const otherMeta = other.deserializeAttachment() as SocketMeta | null;
        if (otherMeta?.playerId === playerId) other.close(4000, 'Reconnected elsewhere');
      }

      ws.serializeAttachment({ playerId, seat: result.seat } satisfies SocketMeta);
      await this.persist();

      this.post(ws, { t: 'welcome', seat: result.seat, room: engine.viewFor(result.seat, this.connectedSeats()) });
      this.broadcast();
      return;
    }

    if (!meta) return this.post(ws, { t: 'error', message: 'Join a room first.' });

    const engine = await this.loadEngine();
    if (!engine) return this.post(ws, { t: 'error', message: 'This room no longer exists.' });

    if (msg.t === 'move') {
      const result = engine.move(meta.seat, msg.move);
      if (!result.ok) return this.post(ws, { t: 'error', message: result.error });
      await this.persist();
      this.broadcast();
      return;
    }

    if (msg.t === 'rematch') {
      const result = engine.rematch();
      if (!result.ok) return this.post(ws, { t: 'error', message: result.error });
      await this.persist();
      this.broadcast();
      return;
    }
  }

  async webSocketClose(): Promise<void> {
    // The seat itself is kept in storage, so the player can reclaim it later.
    await this.loadEngine();
    this.broadcast();
  }

  async webSocketError(): Promise<void> {
    await this.loadEngine();
    this.broadcast();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('code') ?? '').toUpperCase();
      if (!isRoomCode(code)) return new Response('Invalid room code.', { status: 400 });
      // Routing by code is what pins every player in a room to one instance.
      const id = env.ROOMS.idFromName(code);
      return env.ROOMS.get(id).fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
