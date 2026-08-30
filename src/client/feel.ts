/**
 * The dice, heard and felt.
 *
 * Two channels, and the split is deliberate:
 *
 * - **Sound is the table.** Everyone in the room hears their own copy of the
 *   same throw, because a throw is a thing that happens at the table. It is
 *   off until asked for: a page that makes a noise the first time you open it
 *   on a bus is a page you close.
 * - **Haptics are your hand.** Only the player who threw feels it. A phone
 *   that buzzed every time an opponent rolled would be a phone face-down on
 *   the table by the third round.
 *
 * The clatter is synthesised rather than sampled, and stays that way: the gain
 * and pitch come from the impulse the solver actually resolved, so no two
 * contacts sound the same, which is the one thing a recording cannot do. The
 * recorded cues everything *else* makes live in `sfx.ts`; they borrow the
 * context built here, because a second AudioContext is a second hardware output
 * to unsuspend on a phone, for no gain.
 */

const STORAGE_KEY = "ag.sound";

let wanted = false;
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;
/** Contacts arrive in clumps; without a floor a pile-up is one flat buzz. */
let lastHeard = 0;
let lastFelt = 0;

const SOUND_GAP_MS = 22;
const BUZZ_GAP_MS = 55;

export function loadSound(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    // Private browsing with storage denied. A silent default is the safe one.
    return false;
  }
}

export function applySound(on: boolean): void {
  wanted = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
}

export function soundIsOn(): boolean {
  return wanted;
}

/**
 * The audio graph, built on first use, and shared with `sfx.ts`.
 *
 * Deliberately lazy: a context created before the player has touched anything
 * starts suspended on every mobile browser, and building one for a player who
 * never turns the sound on is a decoder they did not ask for.
 */
export function sharedAudio(): AudioContext | null {
  if (!wanted) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    const length = Math.floor(ctx.sampleRate * 0.12);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // Cubed decay: a strike, not a hiss.
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * One die landing. `strength` is 0 to 1, from the impulse; `wall` says it hit
 * the tray rather than another die, which is the duller of the two sounds.
 *
 * `pitch` multiplies the whole voice, the noise burst and the band it is
 * filtered through together, so it transposes rather than just brightening.
 * Left at 1 for a real contact, whose character should come from the impulse
 * the solver resolved and from nothing else. It is turned up only by the
 * celebration in `beats.ts`, where five dice land in sequence and a rising
 * pitch is what turns five identical knocks into a flourish.
 */
export function clatter(strength: number, wall: boolean, pitch = 1): void {
  const ac = sharedAudio();
  if (!ac || !noise) return;
  const stamp = ac.currentTime * 1000;
  if (stamp - lastHeard < SOUND_GAP_MS) return;
  lastHeard = stamp;

  const gain = clamp(strength, 0.05, 1);
  const now = ac.currentTime;

  const source = ac.createBufferSource();
  source.buffer = noise;
  source.playbackRate.value = (0.75 + Math.random() * 0.55) * pitch;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  // Die on die is brighter and harder than die on tray.
  // Capped: the bandpass is happy above the audible range but the noise burst
  // driven through it is not, and an uncapped pitch turns the top of a long
  // flourish into silence rather than into a high note.
  band.frequency.value = Math.min(((wall ? 900 : 1600) + Math.random() * 900) * pitch, 9000);
  band.Q.value = wall ? 0.9 : 1.4;
  const shape = ac.createGain();
  shape.gain.setValueAtTime(0.0001, now);
  shape.gain.exponentialRampToValueAtTime(0.2 * gain, now + 0.004);
  shape.gain.exponentialRampToValueAtTime(0.0001, now + (wall ? 0.1 : 0.07));
  source.connect(band).connect(shape).connect(ac.destination);
  source.start(now);
  source.stop(now + 0.13);

  // The weight underneath, or the clatter reads as a click rather than an
  // object. Only for contacts hard enough to have any.
  if (gain < 0.25) return;
  const thud = ac.createOscillator();
  const body = ac.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(155 + Math.random() * 45, now);
  thud.frequency.exponentialRampToValueAtTime(72, now + 0.06);
  body.gain.setValueAtTime(0.0001, now);
  body.gain.exponentialRampToValueAtTime(0.15 * gain, now + 0.005);
  body.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  thud.connect(body).connect(ac.destination);
  thud.start(now);
  thud.stop(now + 0.09);
}

/**
 * The reward for a right answer: two notes up, short, out of the way.
 *
 * Synthesised rather than a recording, which is the same call `clatter` makes
 * and made for a different reason. The dice are synthesised because a throw is
 * different every time; this is synthesised because it has to be *different by
 * how much was earned*, and ten recordings of the same chime at ten pitches is
 * ten files to ship and one number to get wrong. `sfx.ts` is for the discrete
 * events -- a disc landing, a game ending -- and this is not one.
 *
 * The interval rises with the payment, and only a little: a fifth over the
 * whole range of `xpFor`, from a first recognition to a five-week review. Big
 * enough that a good answer sounds different from an ordinary one, small
 * enough that the ordinary one never sounds like a consolation prize. A
 * language app that sounds disappointed in you is one people stop opening.
 *
 * Goes through `sharedAudio`, so the sound switch is still the only switch --
 * see the note at the top of `sfx.ts`, which is the rule this obeys rather
 * than a second mute to forget about.
 */
export function chime(xp: number): void {
  const ac = sharedAudio();
  if (!ac) return;
  const now = ac.currentTime;

  // The range `xpFor` actually produces: 2 for a recognition, 19 for a
  // produced answer on the top rung. Anything outside it is clamped rather
  // than trusted, because this is fed from a client-side estimate.
  const lift = clamp((xp - 2) / 17, 0, 1);
  // A fourth up from the root, then a fifth, as the payment grows. Both notes
  // move, so the interval opens rather than the whole thing simply getting
  // higher, which is what stops a big answer sounding like a small one played
  // on a smaller speaker.
  const root = 587 * (1 + lift * 0.12);
  const notes = [root, root * (1.335 + lift * 0.165)];

  notes.forEach((hz, i) => {
    const at = now + i * 0.075;
    const tone = ac.createOscillator();
    const shape = ac.createGain();
    // Triangle, not sine: a sine this short reads as a system beep, and not
    // square, which reads as an arcade. A triangle is the one that sounds like
    // it belongs beside wooden dice.
    tone.type = "triangle";
    tone.frequency.setValueAtTime(hz, at);
    shape.gain.setValueAtTime(0.0001, at);
    shape.gain.exponentialRampToValueAtTime(0.12, at + 0.008);
    shape.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    tone.connect(shape).connect(ac.destination);
    tone.start(at);
    tone.stop(at + 0.18);
  });
}

/**
 * A tick in the hand of whoever threw. Silent everywhere the Vibration API is
 * not, which is every iPhone and every desktop.
 *
 * Throttled for a single duration but never for a pattern: a pattern is a
 * deliberate one-off (a throw leaving the hand, a call being settled) and
 * dropping it because a die happened to land 40ms earlier would lose the one
 * buzz that meant something.
 */
export function buzz(pattern: number | number[]): void {
  if (typeof navigator.vibrate !== "function") return;
  if (typeof pattern === "number") {
    const stamp = performance.now();
    if (stamp - lastFelt < BUZZ_GAP_MS) return;
    lastFelt = stamp;
  }
  navigator.vibrate(pattern);
}
