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
 * Nothing here is fetched. The clatter is synthesised from a noise buffer and
 * two oscillators, because the Android build has to work with no network and
 * a folder of samples is weight carried on every device forever. It also buys
 * something a recording cannot: the gain and pitch come from the impulse the
 * solver actually resolved, so no two contacts sound the same.
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
 * The audio graph, built on first use.
 *
 * Deliberately lazy: a context created before the player has touched anything
 * starts suspended on every mobile browser, and building one for a player who
 * never turns the sound on is a decoder they did not ask for.
 */
function audio(): AudioContext | null {
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
 */
export function clatter(strength: number, wall: boolean): void {
  const ac = audio();
  if (!ac || !noise) return;
  const stamp = ac.currentTime * 1000;
  if (stamp - lastHeard < SOUND_GAP_MS) return;
  lastHeard = stamp;

  const gain = clamp(strength, 0.05, 1);
  const now = ac.currentTime;

  const source = ac.createBufferSource();
  source.buffer = noise;
  source.playbackRate.value = 0.75 + Math.random() * 0.55;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  // Die on die is brighter and harder than die on tray.
  band.frequency.value = (wall ? 900 : 1600) + Math.random() * 900;
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
 * A tick in the hand of whoever threw. Silent everywhere the Vibration API is
 * not — which is every iPhone, and every desktop.
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
