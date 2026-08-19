import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorKind,
  type RoomView,
  type ServerMessage,
} from '../shared/protocol.js';

/**
 * `connecting` is the first attempt, `closed` is a connection we had and lost.
 * They are deliberately distinct: a first-time visitor should not be told we
 * are "reconnecting" to something they were never connected to.
 *
 * `superseded` is terminal — this seat is being played somewhere else, so
 * retrying would only start a fight over it.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'superseded';

/** Close code the server uses when the same player joins from elsewhere. */
const TAKEN_OVER = 4000;

function randomId(): string {
  // crypto.randomUUID needs a secure context, which a plain http:// LAN address
  // is not — so fall back when testing from a phone over the local network.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Identity is per-browser, but `?as=b` gives you a second one on the same
 * machine — which is how you drive both sides of a game in two tabs.
 */
export function getPlayerId(): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  const key = `ag.playerId${suffix ? `.${suffix}` : ''}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = randomId();
    localStorage.setItem(key, id);
  }
  return id;
}

export function loadName(): string {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return localStorage.getItem(`ag.name${suffix ? `.${suffix}` : ''}`) ?? '';
}

export function saveName(name: string): void {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  localStorage.setItem(`ag.name${suffix ? `.${suffix}` : ''}`, name);
}

/**
 * Where the game server lives. On the web that's wherever the page came from.
 * In the Android app the page comes from the APK itself, so the origin has to
 * be baked in at build time via VITE_SERVER_ORIGIN.
 */
export function serverOrigin(): string {
  const configured = import.meta.env.VITE_SERVER_ORIGIN?.trim();
  return configured ? configured.replace(/\/+$/, '') : location.origin;
}

/** The link to hand a friend — always the server, never the WebView. */
export function inviteUrl(code: string): string {
  return `${serverOrigin()}/#${code}`;
}

function socketUrl(code: string): string {
  // http -> ws, https -> wss.
  const wsOrigin = serverOrigin().replace(/^http/, 'ws');
  // The code rides in the URL because in production it selects which Durable
  // Object handles the socket — that has to be decided before the upgrade.
  return `${wsOrigin}/ws?code=${encodeURIComponent(code)}`;
}

export interface UseRoom {
  room: RoomView | null;
  seat: number | null;
  status: ConnectionStatus;
  error: string | null;
  /** Why the last error happened, so the UI can frame it. */
  errorKind: ErrorKind | null;
  sendMove(move: unknown): void;
  requestRematch(): void;
  dismissError(): void;
}

export function useRoom(opts: {
  active: boolean;
  name: string;
  code: string | null;
  create: boolean;
  gameId: string;
  /** How many seats to lay out, honoured only when this client opens the room. */
  players: number;
}): UseRoom {
  const { active, name, code, create, gameId, players } = opts;
  const [room, setRoom] = useState<RoomView | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  // Only the very first join may create the room. Reconnects must not silently
  // conjure a fresh empty room if the original one went away.
  const createRef = useRef(create);

  useEffect(() => {
    createRef.current = create;
  }, [create, code]);

  useEffect(() => {
    if (!active || !name || !code) {
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');

      const socket = new WebSocket(socketUrl(code));
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled) return;
        retries = 0;
        setStatus('open');
        const hello: ClientMessage = {
          t: 'hello',
          v: PROTOCOL_VERSION,
          playerId: getPlayerId(),
          name,
          code,
          create: createRef.current,
          // Only a client opening a room gets to say what it is playing.
          // Someone arriving on a link is joining whatever is already there,
          // and their lobby still has its own default selected — asserting it
          // here is how a perfectly good invitation gets refused for "playing
          // Connect Four" at a room that is not.
          gameId: createRef.current ? gameId : '',
          players,
        };
        socket.send(JSON.stringify(hello));
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (msg.t === 'welcome') {
          setSeat(msg.seat);
          setRoom(msg.room);
          createRef.current = false;
          if (location.hash.slice(1).toUpperCase() !== msg.room.code) {
            history.replaceState(null, '', `#${msg.room.code}${location.search}`);
          }
        } else if (msg.t === 'room') {
          setRoom(msg.room);
        } else if (msg.t === 'error') {
          setError(msg.message);
          setErrorKind(msg.kind);
        }
      };

      socket.onclose = (event) => {
        if (cancelled) return;
        // The server closed us because this player said hello on another
        // socket. Retrying would evict that one, which would retry and evict
        // this one — two tabs trading the seat about once a second, forever,
        // with the room never allowed to hibernate.
        if (event.code === TAKEN_OVER) {
          cancelled = true;
          setStatus('superseded');
          return;
        }
        setStatus('closed');
        retries += 1;
        const delay = Math.min(1000 * 2 ** (retries - 1), 10_000);
        retryTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        /* onclose always follows; retry is handled there */
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [active, name, code, gameId, players]);

  const post = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
    else {
      setError('Not connected — reconnecting…');
      setErrorKind('rejected');
    }
  }, []);

  return {
    room,
    seat,
    status,
    error,
    errorKind,
    sendMove: useCallback((move: unknown) => post({ t: 'move', move }), [post]),
    requestRematch: useCallback(() => post({ t: 'rematch' }), [post]),
    dismissError: useCallback(() => {
      setError(null);
      setErrorKind(null);
    }, []),
  };
}
