/**
 * The table, heard.
 *
 * `feel.ts` synthesises the dice, because a throw is different every time and
 * a recording of one is not. Everything else in the app is a discrete event —
 * a disc landing, a player sitting down, a game ending — and those are
 * recordings, from Kenney's CC0 packs (see `public/sfx/LICENSE.txt`). Ten
 * files, 112 KB, which the Android build carries offline and the web build
 * fetches once.
 *
 * Three rules hold the whole thing together:
 *
 * - **One switch.** A cue asks `feel.ts` for the shared context, which hands
 *   back null while the sound preference is off. There is no second mute to
 *   forget about, and nothing is fetched or decoded for a player who never
 *   turns it on.
 * - **One cue per moment.** The gap below drops a repeat of the same cue
 *   inside 90ms, and `useTableSounds` picks *either* "your turn" or the move
 *   sound, never both. A room message can carry several changes at once, and
 *   three noises stacked on one frame is the sound of a bug.
 * - **Silence is always an acceptable outcome.** A missing file, a browser
 *   that cannot decode ogg, a context that will not start: every one of those
 *   ends as no sound, never as an error the player can see.
 */
import { useEffect, useRef } from "react";
import type { RoomView } from "../shared/protocol.js";
import { sharedAudio } from "./feel.js";

/** Levelled by ear against the synthesised dice, which are the loudest thing here. */
const CUES = {
  /** The game is dealt: cards going through a shuffle. */
  deal: { file: "deal.ogg", gain: 0.35 },
  /** A move landed. Wood on a board. */
  place: { file: "place.ogg", gain: 0.55 },
  /** A Connect Four disc, which falls rather than being placed. */
  drop: { file: "drop.ogg", gain: 0.5 },
  /** It is now your turn. */
  turn: { file: "turn.ogg", gain: 0.45 },
  /** Somebody sat down. */
  join: { file: "join.ogg", gain: 0.4 },
  /** The game is over — for everyone, so it says "finished", not "you won". */
  over: { file: "over.ogg", gain: 0.45 },
  /** The server refused something. */
  deny: { file: "deny.ogg", gain: 0.4 },
  /** A shell into a hull. */
  hit: { file: "hit.ogg", gain: 0.6 },
  /** A shell into the sea. */
  miss: { file: "miss.ogg", gain: 0.5 },
  /** A press that changed a setting. */
  tap: { file: "tap.ogg", gain: 0.35 },
} as const;

export type Cue = keyof typeof CUES;

const REPEAT_GAP_MS = 90;
const BASE = `${import.meta.env.BASE_URL}sfx/`;

const decoded = new Map<Cue, AudioBuffer>();
/** A cue that failed to load is never asked for again; retrying it every move
 *  would be one request per move for a sound that is not coming. */
const dead = new Set<Cue>();
const inFlight = new Map<Cue, Promise<void>>();
const lastPlayed = new Map<Cue, number>();

function fetchCue(cue: Cue, ac: AudioContext): Promise<void> {
  const already = inFlight.get(cue);
  if (already) return already;
  if (decoded.has(cue) || dead.has(cue)) return Promise.resolve();
  const run = fetch(BASE + CUES[cue].file)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.arrayBuffer();
    })
    // Callback form rather than the promise one: older WebKit resolves nothing
    // unless it is given the callbacks, and that is the browser most likely to
    // be holding the phone.
    .then((bytes) => new Promise<AudioBuffer>((ok, no) => ac.decodeAudioData(bytes, ok, no)))
    .then((buffer) => void decoded.set(cue, buffer))
    .catch(() => void dead.add(cue))
    .finally(() => inFlight.delete(cue));
  inFlight.set(cue, run);
  return run;
}

/**
 * Pull every cue down and decode it.
 *
 * Called the moment sound is switched on, which is the only honest time to do
 * it: a cue that starts loading when it is first needed is a cue that misses
 * the thing it was describing. Turning the switch on is also a gesture, so the
 * context this builds is one the browser will actually let make a noise.
 */
export function primeSfx(announce?: Cue): void {
  const ac = sharedAudio();
  if (!ac) return;
  const all = (Object.keys(CUES) as Cue[]).map((cue) => fetchCue(cue, ac));
  // Something to hear the moment the switch is flipped, once there is
  // something to hear. Without it, turning sound on is a button that appears
  // to do nothing until the next move — which is how a player concludes it is
  // broken and turns it back off.
  if (announce) void Promise.all(all).then(() => play(announce));
}

/**
 * One cue, now. Silent — not queued — if sound is off or it has not landed yet.
 *
 * `rate` detunes for variety where the same cue fires repeatedly; leaving it
 * at 1 is right for anything that happens once.
 */
export function play(cue: Cue, rate = 1): void {
  const ac = sharedAudio();
  if (!ac) return;

  const buffer = decoded.get(cue);
  if (!buffer) {
    // Arms it for next time. Deliberately not played on arrival: a sound that
    // turns up 300ms after the move it belonged to is worse than no sound.
    void fetchCue(cue, ac);
    return;
  }

  const stamp = ac.currentTime * 1000;
  if (stamp - (lastPlayed.get(cue) ?? -Infinity) < REPEAT_GAP_MS) return;
  lastPlayed.set(cue, stamp);

  const source = ac.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  const level = ac.createGain();
  level.gain.value = CUES[cue].gain;
  source.connect(level).connect(ac.destination);
  source.start(ac.currentTime);
}

/**
 * What a move sounds like in a given game.
 *
 * Null means the board speaks for itself, and then the generic rule stands
 * down completely — not just for the move, but for "your turn" as well.
 * Battleships is the case: a shot is a hit or a miss, the board is the only
 * thing that knows which, and in a two-player game their shot landing *is*
 * your turn arriving. Left to fire as well, the generic rule would put a
 * wooden knock and a pluck underneath every splash — three sounds for one
 * event.
 */
const MOVE_CUE: Record<string, Cue | null> = {
  connect4: "drop",
  battleship: null,
};

/** The move cue for a game, or null where its board does the talking. */
function moveCue(gameId: string): Cue | null {
  return gameId in MOVE_CUE ? MOVE_CUE[gameId] : "place";
}

/**
 * The room, turned into sound.
 *
 * Everything here is read off `RoomView`, which is the same shape for all
 * nine games — so a new game gets the whole set (dealt, moved, your turn,
 * joined, over) without this file being touched, which is the same bargain
 * the server already makes.
 *
 * The state comparison is a stringify. It is what makes "a move happened"
 * honest where `turn` is not enough — backgammon and Yahtzee both let one
 * player move several times in a row — and it is cheap because `view()` has
 * already cut each state down to what one seat may see. Nothing in any view
 * ticks on its own: Word Hunt's `endsAt` is an absolute stamp, so a running
 * clock does not read as a move every second.
 */
export function useTableSounds(
  room: RoomView | null,
  seat: number | null,
  errorSeq: number,
): void {
  const previous = useRef<{
    code: string;
    waiting: boolean;
    over: boolean;
    players: number;
    turn: number | null;
    state: string;
  } | null>(null);

  useEffect(() => {
    if (!room) {
      previous.current = null;
      return;
    }

    const now = {
      code: room.code,
      waiting: room.waiting,
      over: room.over,
      players: room.players.length,
      turn: room.turn,
      state: JSON.stringify(room.state ?? null),
    };
    const was = previous.current;
    previous.current = now;

    // The first view of a room — including one rejoined mid-game — describes
    // everything that has already happened in it. Announcing all of that at
    // once is not a recap, it is a pile-up.
    if (!was || was.code !== now.code) return;

    if (was.waiting && !now.waiting) {
      play("deal");
      return;
    }
    if (!was.over && now.over) {
      play("over");
      return;
    }
    if (now.players > was.players) {
      play("join");
      return;
    }
    if (now.waiting || now.over) return;

    const cue = moveCue(room.gameId);
    if (!cue) return;

    // Your turn beats the move that handed it to you: they are one event seen
    // from two sides, and the one worth hearing is the one about you.
    if (now.turn === seat && was.turn !== seat) {
      play("turn");
      return;
    }
    if (now.state !== was.state) play(cue);
  }, [room, seat]);

  const heardRefusals = useRef(0);
  useEffect(() => {
    // Only a new refusal. Re-rendering with a toast still up is not a second
    // thing going wrong -- but a *second refusal with the same wording* is,
    // and this used to compare messages, so tapping the same illegal square
    // twice was silent the second time. The counter comes from `useRoom` and
    // moves once per refusal whatever the refusal says.
    if (errorSeq > heardRefusals.current) play("deny");
    heardRefusals.current = errorSeq;
  }, [errorSeq]);
}
