import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PING_FRAME,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  SILENCE_LIMIT_MS,
  type ClientMessage,
  type ErrorKind,
  type RoomView,
  type ServerMessage,
} from '../shared/protocol.js';
import type { Known, LearnLang, ProfileView } from '../shared/profile.js';
import type { RoomPeek } from '../shared/session.js';
import { claimFor } from './account.js';
import { loadAvatar } from './avatar/store.js';

/**
 * `connecting` is the first attempt, `closed` is a connection we had and lost.
 * They are deliberately distinct: a first-time visitor should not be told we
 * are "reconnecting" to something they were never connected to.
 *
 * `superseded` is terminal: this seat is being played somewhere else, so
 * retrying would only start a fight over it.
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'superseded';

/** Close code the server uses when the same player joins from elsewhere. */
const TAKEN_OVER = 4000;

/** How long a ping sent on waking has to be answered before we give up on it. */
const PROBE_MS = 5000;

function randomId(): string {
  // crypto.randomUUID needs a secure context, which a plain http:// LAN address
  // is not, so fall back when testing from a phone over the local network.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/**
 * Identity is per-browser, but `?as=b` gives you a second one on the same
 * machine, which is how you drive both sides of a game in two tabs.
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
 * The last game this browser actually sat down to, which is the one the lobby
 * puts on top at twice the size.
 *
 * Written from the room rather than from the pick, so joining someone else's
 * link counts: the game you played is the game you played, whoever chose it.
 * Reading it returns null rather than a default: the caller decides what an
 * empty shelf looks like, and here that is the first game in the manifest.
 *
 * Carries the `?as=` suffix for the same reason the name does. Two tabs
 * driving both sides of a game are two players, and one of them finishing a
 * round of Yahtzee should not rearrange the other one's lobby.
 */
export function loadLastGame(): string | null {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  return localStorage.getItem(`ag.lastGame${suffix ? `.${suffix}` : ''}`);
}

export function saveLastGame(gameId: string): void {
  const suffix = new URLSearchParams(location.search).get('as') ?? '';
  localStorage.setItem(`ag.lastGame${suffix ? `.${suffix}` : ''}`, gameId);
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

/** The link to hand a friend: always the server, never the WebView. */
export function inviteUrl(code: string): string {
  return `${serverOrigin()}/#${code}`;
}

/**
 * What is behind a code, asked before anybody commits to it.
 *
 * The lobby has no socket -- that is the whole shape of this screen -- so the
 * one question it needs answered before the join is a plain GET. Both adapters
 * serve it from the same `peek`, and neither of them opens a room to answer:
 * see the route in `src/worker/index.ts`.
 *
 * Every failure is "we could not tell", never "no such room". A lookup that
 * fell over offline must not talk somebody out of a code that is perfectly
 * good; the socket is still the thing that decides, and it will say so.
 */
export async function lookupRoom(code: string, signal?: AbortSignal): Promise<RoomPeek | null> {
  try {
    const res = await fetch(`${serverOrigin()}/peek?code=${encodeURIComponent(code)}`, {
      signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as RoomPeek;
  } catch {
    return null;
  }
}

function socketUrl(code: string): string {
  // http -> ws, https -> wss.
  const wsOrigin = serverOrigin().replace(/^http/, 'ws');
  // The code rides in the URL because in production it selects which Durable
  // Object handles the socket, which has to be decided before the upgrade.
  return `${wsOrigin}/ws?code=${encodeURIComponent(code)}`;
}

export interface UseRoom {
  room: RoomView | null;
  seat: number | null;
  /**
   * This account's summary, or null for a guest.
   *
   * Arrives unasked-for twice: once on being welcomed, so the lobby's "words
   * due" is on the screen before anybody presses anything, and again the
   * moment a finished game has been filed, which is when somebody should see
   * what it taught them. `refreshProfile` is there for the third case, a
   * screen opened long after either.
   */
  profile: ProfileView | null;
  status: ConnectionStatus;
  error: string | null;
  /** Why the last error happened, so the UI can frame it. */
  errorKind: ErrorKind | null;
  /**
   * How many refusals this session has seen. The message alone cannot say
   * whether one arrived: tapping the same illegal square twice produces the
   * same string twice, and anything watching `error` for a change (the toasts,
   * the deny sound) saw the second one as no event at all. A counter makes
   * every refusal distinct without making the message carry an id.
   */
  errorSeq: number;
  sendMove(move: unknown): void;
  requestRematch(): void;
  /** Play a different game with the people already in this room. */
  switchGame(gameId: string): void;
  /** Deal the game to whoever is here. Seat 0 only, and the server enforces it. */
  startGame(): void;
  dismissError(): void;
  /** Ask for the profile again. Silently does nothing for a guest. */
  refreshProfile(): void;
  /**
   * The word rows for one language, once they have been asked for.
   *
   * Null until the first answer arrives and again for a language nobody has
   * asked about, which the Vocabulary screen draws as "loading" rather than as
   * "no words": the two look identical on an empty list and only one of them
   * is worth apologising for.
   */
  vocab: { lang: LearnLang; words: Known[] } | null;
  /** Fetch one language's rows. Silently does nothing for a guest. */
  requestVocab(lang: LearnLang): void;
}

export function useRoom(opts: {
  active: boolean;
  name: string;
  code: string | null;
  create: boolean;
  gameId: string;
}): UseRoom {
  const { active, name, code, create, gameId } = opts;
  const [room, setRoom] = useState<RoomView | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null);
  const [errorSeq, setErrorSeq] = useState(0);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [vocab, setVocab] = useState<{ lang: LearnLang; words: Known[] } | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  /**
   * When we last heard *anything* from the server on the current socket.
   *
   * Any frame counts as proof of life, not only a pong. A room being played in
   * sends `room` messages far more often than the heartbeat, and an older
   * server that does not answer pings at all is plainly alive while it is
   * talking to us.
   */
  const heardRef = useRef(0);
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
    let beat: ReturnType<typeof setInterval> | undefined;
    let probe: ReturnType<typeof setTimeout> | undefined;

    /**
     * Abandon a socket that has stopped answering and start again.
     *
     * The handlers come off *before* the close, because a half-open socket can
     * take its own sweet time firing `close`, sometimes minutes, and if it
     * fired after we had begun reconnecting it would schedule a second attempt
     * on top of this one and the two would race for the seat.
     */
    const revive = (delay: number) => {
      if (cancelled) return;
      const socket = socketRef.current;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          /* already gone */
        }
        socketRef.current = null;
      }
      setStatus('closed');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    /**
     * The heartbeat. This is the only thing in the client that can notice a
     * connection that died without saying so: `readyState` still reads OPEN,
     * `close` never fires, and without this the player sits watching a board
     * that will never change again.
     */
    const pulse = () => {
      if (cancelled) return;
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - heardRef.current > SILENCE_LIMIT_MS) {
        retries += 1;
        revive(Math.min(1000 * 2 ** (retries - 1), 10_000));
        return;
      }
      try {
        socket.send(PING_FRAME);
      } catch {
        revive(0);
      }
    };

    /**
     * A locked phone or a backgrounded tab has its timers throttled, so the
     * heartbeat above may not have run for the whole time it was away, so
     * silence proves nothing at the moment it comes back. Ask directly instead,
     * and give the answer a few seconds before concluding anything. Waiting out
     * the ordinary silence limit would leave someone staring at a stale board
     * for the best part of a minute after unlocking.
     */
    const wake = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const socket = socketRef.current;
      // Not open means a reconnect is already under way; leave it alone.
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      if (Date.now() - heardRef.current < PING_INTERVAL_MS) return;
      const asked = Date.now();
      try {
        socket.send(PING_FRAME);
      } catch {
        return revive(0);
      }
      clearTimeout(probe);
      probe = setTimeout(() => {
        if (!cancelled && heardRef.current < asked) revive(0);
      }, PROBE_MS);
    };

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');

      const socket = new WebSocket(socketUrl(code));
      socketRef.current = socket;

      socket.onopen = () => {
        if (cancelled) return;
        retries = 0;
        heardRef.current = Date.now();
        setStatus('open');

        /**
         * Signing is asynchronous, so the hello is sent from a promise.
         *
         * The signature is per-room, so it cannot be prepared once and reused
         * across reconnects to different rooms, and it has to be re-made here
         * rather than held in state. `claimFor` resolves to undefined for a
         * guest and for anything that went wrong, and the server treats those
         * two the same way: seat them and play on. Nothing about having an
         * account may stand between somebody and a game.
         */
        void claimFor(code).then((account) => {
          if (cancelled || socket.readyState !== WebSocket.OPEN) return;
          const hello: ClientMessage = {
            t: 'hello',
            v: PROTOCOL_VERSION,
            playerId: getPlayerId(),
            name,
            code,
            create: createRef.current,
            // Only a client opening a room gets to say what it is playing.
            // Someone arriving on a link is joining whatever is already there,
            // and their lobby still has its own default selected. Asserting it
            // here is how a perfectly good invitation gets refused for "playing
            // Connect Four" at a room that is not.
            gameId: createRef.current ? gameId : '',
            account,
            // Read at send time rather than held in state, and read again on
            // every reconnect, because the customiser is a different screen
            // and this socket does not hear about it. The seat is rewritten by
            // the rejoin anyway, so the reconnect is where a change made
            // mid-game catches up.
            avatar: avatarJson(),
          };
          socket.send(JSON.stringify(hello));
        });
      };

      socket.onmessage = (event) => {
        if (cancelled) return;
        // Before parsing, and whatever it turns out to say: something arrived,
        // so the socket is alive. A frame we cannot read still proves that.
        heardRef.current = Date.now();
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
          // An error describes a moment, not a session. Until this line the
          // only thing that cleared one was the player pressing Dismiss, so a
          // failed first attempt left "No room with that code." sitting above
          // the room it then successfully joined, and "Not connected, hang on"
          // outlived the reconnection it was reporting. Being welcomed is proof
          // both are over.
          setError(null);
          setErrorKind(null);
          if (location.hash.slice(1).toUpperCase() !== msg.room.code) {
            // Path and query first, code last. A query written after the hash
            // is inside the fragment, not beside it. See `roomUrl` in
            // `App.tsx` for what that cost.
            history.replaceState(
              null,
              '',
              `${location.pathname}${location.search}#${msg.room.code}`,
            );
          }
        } else if (msg.t === 'room') {
          setRoom(msg.room);
        } else if (msg.t === 'profile') {
          setProfile(msg.profile);
        } else if (msg.t === 'vocab') {
          // Replaced rather than merged, and the language rides along on the
          // state for the same reason it rides along on the message: two
          // requests in flight must not be drawn under each other's heading.
          setVocab({ lang: msg.lang, words: msg.words });
        } else if (msg.t === 'error') {
          setError(msg.message);
          setErrorKind(msg.kind);
          setErrorSeq((n) => n + 1);
        }
      };

      socket.onclose = (event) => {
        if (cancelled) return;
        // The server closed us because this player said hello on another
        // socket. Retrying would evict that one, which would retry and evict
        // this one: two tabs trading the seat about once a second, forever,
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
    beat = setInterval(pulse, PING_INTERVAL_MS);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      clearTimeout(probe);
      clearInterval(beat);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [active, name, code, gameId]);

  const post = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    // OPEN is not the same as working. A socket that died without a close
    // frame reads OPEN right up until the heartbeat catches it, and moves
    // written into it in the meantime went nowhere at all, silently, which is
    // the worst way for a move to fail. If nothing has been heard for longer
    // than the silence limit, treat it as gone now rather than in a few
    // seconds' time, and tell the player their move did not land.
    if (
      socket &&
      socket.readyState === WebSocket.OPEN &&
      Date.now() - heardRef.current <= SILENCE_LIMIT_MS
    ) {
      socket.send(JSON.stringify(msg));
    } else {
      setError('Not connected, hang on...');
      setErrorKind('rejected');
      setErrorSeq((n) => n + 1);
    }
  }, []);

  return {
    room,
    seat,
    profile,
    status,
    error,
    errorKind,
    errorSeq,
    sendMove: useCallback((move: unknown) => post({ t: 'move', move }), [post]),
    requestRematch: useCallback(() => post({ t: 'rematch' }), [post]),
    // No optimistic swap: the room's game comes back on the next `room`
    // message, so the board only changes once the server agrees, which is also
    // what keeps both players' boards changing at the same moment.
    switchGame: useCallback((id: string) => post({ t: 'switch', gameId: id }), [post]),
    startGame: useCallback(() => post({ t: 'start' }), [post]),
    dismissError: useCallback(() => {
      setError(null);
      setErrorKind(null);
    }, []),
    // Sent unconditionally rather than gated on having an account here: the
    // server answers only for a socket that proved one, so a guest's request
    // is ignored at the far end and there is no second place holding an
    // opinion about whether this client is signed in.
    refreshProfile: useCallback(() => post({ t: 'profile' }), [post]),
    vocab,
    requestVocab: useCallback(
      (lang: LearnLang) => {
        // Cleared before asking, so the screen shows the spinner it is about
        // to earn rather than the previous language's words under the new
        // language's heading for however long the round trip takes.
        setVocab(null);
        post({ t: 'vocab', lang });
      },
      [post],
    ),
  };
}

/**
 * What this browser is wearing, as JSON, or undefined.
 *
 * Re-serialised rather than sending the stored string on: `loadAvatar` drops a
 * loadout naming art this build cannot draw, and sending one anyway would put
 * a figure on everybody else's seat list that this player cannot see on their
 * own. Undefined for somebody who has never opened the customiser, which is
 * the same seat a guest gets.
 */
function avatarJson(): string | undefined {
  const worn = loadAvatar();
  return worn ? JSON.stringify(worn) : undefined;
}
