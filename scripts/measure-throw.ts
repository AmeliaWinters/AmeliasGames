/**
 * What a throw actually does, in numbers, over a lot of throws.
 *
 * `render-throw3d.ts` draws one throw so you can look at it; this counts many
 * so you can tune against something. They are complementary and both have
 * caught things the other could not: the contact sheet found dice dying in the
 * corner they started in while every metric said the retune had worked, and
 * this found a die that "rolled" at a distance-per-radian of 4.5 while looking
 * perfectly fine in a still.
 *
 * Not a test. Tests pin the thresholds that have to hold; this is the
 * instrument you point at a constant while you are deciding what its threshold
 * should be.
 *
 *     npx tsx scripts/measure-throw.ts
 *     npx tsx scripts/measure-throw.ts --runs 400 --tray backgammon
 */
import {
  initDice,
  openThrow,
  stepThrow,
  restOf,
  facesOf,
  disposeThrow,
  PHYS,
  DIE_HALF,
  type Hit,
} from '../src/client/dice3d/engine.js';
import { YAHTZEE_TRAY } from '../src/shared/games/yahtzeeDisplay.js';
import { BACKGAMMON_TRAY } from '../src/shared/games/backgammon.js';
import { LIARSDICE_TRAY } from '../src/shared/games/liarsDiceDisplay.js';

const TRAYS = { yahtzee: YAHTZEE_TRAY, backgammon: BACKGAMMON_TRAY, liarsdice: LIARSDICE_TRAY };

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

interface Run {
  steps: number;
  /** Fraction of the tray's length the resting dice span. */
  spanX: number;
  /** Centimetres travelled along the table per radian turned, while touching it. */
  skid: number;
  /** How many times a die changed direction against a wall. */
  walls: number;
  faces: number[];
  /** Peak height reached, in dice. */
  peak: number;
  /** How fast a die was still going at the moment Rapier called it asleep. */
  dozed: number;
  /** The same as `skid`, over the last 40% of a die's time on the table. */
  lateSkid: number;
  /** Share of die-frames spent above 0, 1, 2 ... dice of height. */
  above: number[];
}

async function main() {
  await initDice();
  const runs = Number(arg('runs', '240'));
  const name = arg('tray', 'yahtzee') as keyof typeof TRAYS;
  const tray = TRAYS[name];
  const count = name === 'backgammon' ? 2 : 5;
  // Half taps, half flicks of every strength, because the two ends of the
  // range settle differently and an average over only one of them is a lie.
  const out: Run[] = [];
  const bin: Hit[] = [];

  for (let r = 0; r < runs; r++) {
    const hard = r % 2 === 0 ? 0 : PHYS.FLICK_FLOOR + ((r % 8) / 8) * (PHYS.FLICK_FULL - PHYS.FLICK_FLOOR);
    const live = openThrow({
      tray,
      count,
      seed: r * 7919 + 13,
      flick: hard === 0 ? { x: 0, y: 0 } : { x: hard, y: 0, ax: 0.8, ay: 0.5 },
      from: null,
    });
    const k = live.k;
    let ground = 0;
    let turned = 0;
    let travelled = 0;
    // Split early from late, because a real die does both and the average of
    // the two says nothing: it skids on the landing and rolls itself out. What
    // "the dice slide instead of tumbling" meant was that the late phase never
    // arrived, so that is the phase worth measuring on its own.
    const perDie: Array<Array<[number, number]>> = live.bodies.map(() => []);
    let walls = 0;
    let peak = 0;
    // Not the peak but the *dwell*: what fraction of all the die-frames in a
    // throw sit above a candidate headroom. A die that crosses the top of the
    // frame for two frames on its way off another die is a blink; one that
    // spends a tenth of the throw up there is a die you cannot see. Framing has
    // to be sized against this rather than against a maximum, or a single
    // freak bounce buys everyone a permanently smaller tray.
    const above = [0, 0, 0, 0, 0, 0, 0];
    let frames = 0;
    const last = live.bodies.map((b) => ({ ...b.translation() }));
    const asleep = live.bodies.map(() => false);
    const was = live.bodies.map(() => 0);
    let dozed = 0;
    let dozedN = 0;
    const sign = live.bodies.map(() => 0);

    let moving = 1;
    while (moving > 0) {
      moving = stepThrow(live, bin);
      for (let i = 0; i < live.bodies.length; i++) {
        const b = live.bodies[i];
        const t = b.translation();
        const high = (t.y - DIE_HALF) / (DIE_HALF * 2);
        peak = Math.max(peak, high);
        frames++;
        for (let n = 0; n < above.length; n++) if (high > n) above[n]++;
        // On the table means within a hair of resting height, which is the only
        // stretch where "distance per radian" means anything at all.
        if (t.y < DIE_HALF * 1.6) {
          const dx = t.x - last[i].x;
          const dz = t.z - last[i].z;
          travelled += Math.hypot(dx, dz);
          const w = b.angvel();
          turned += Math.hypot(w.x, w.y, w.z) * PHYS.STEP;
          ground++;
          perDie[i].push([Math.hypot(dx, dz), Math.hypot(w.x, w.y, w.z) * PHYS.STEP]);
        }
        // Rapier zeroes a body's velocity as it sleeps it, so the speed that
        // matters, how fast it was still going when it was stopped, is the one
        // from the step before, kept here for exactly this reason.
        if (!asleep[i] && b.isSleeping()) {
          asleep[i] = true;
          dozed += was[i];
          dozedN++;
        }
        const vv = b.linvel();
        was[i] = Math.hypot(vv.x, vv.y, vv.z);
        const vx = vv.x;
        const s = Math.sign(vx);
        if (s !== 0 && sign[i] !== 0 && s !== sign[i] && Math.abs(vx) > 20) walls++;
        if (s !== 0) sign[i] = s;
        last[i] = { ...t };
      }
    }
    const rest = restOf(live);
    const faces = facesOf(live);
    const steps = live.steps;
    disposeThrow(live);
    const xs = rest.map((p) => p.x);
    out.push({
      steps,
      spanX: (Math.max(...xs) - Math.min(...xs)) / tray.w,
      skid: turned > 0 ? travelled / turned : Infinity,
      walls: walls / count,
      faces,
      peak,
      dozed: dozedN ? dozed / dozedN : 0,
      above: above.map((n) => n / Math.max(1, frames)),
      lateSkid: (() => {
        let d = 0;
        let a = 0;
        for (const rows of perDie) {
          for (const [dd, aa] of rows.slice(Math.floor(rows.length * 0.6))) {
            d += dd;
            a += aa;
          }
        }
        return a > 1e-6 ? d / a : 0;
      })(),
    });
    void ground;
  }

  const mean = (f: (r: Run) => number) => out.reduce((a, r) => a + f(r), 0) / out.length;
  const pct = (f: (r: Run) => number, p: number) => {
    const v = out.map(f).sort((a, b) => a - b);
    return v[Math.min(v.length - 1, Math.floor(v.length * p))];
  };

  const tally = [0, 0, 0, 0, 0, 0];
  for (const r of out) for (const f of r.faces) tally[f - 1]++;
  const total = tally.reduce((a, b) => a + b, 0);
  const chi = tally.reduce((a, n) => a + ((n - total / 6) ** 2 * 6) / total, 0);

  console.log(`tray ${name}, ${count} dice, ${runs} throws, step 1/${Math.round(1 / PHYS.STEP)}`);
  console.log(`  settle      ${(mean((r) => r.steps) * PHYS.STEP).toFixed(2)}s mean, ` +
    `${(pct((r) => r.steps, 0.9) * PHYS.STEP).toFixed(2)}s p90, ` +
    `${(pct((r) => r.steps, 0.99) * PHYS.STEP).toFixed(2)}s p99`);
  console.log(`  spanX       ${(mean((r) => r.spanX) * 100).toFixed(1)}%`);
  console.log(`  skid        ${mean((r) => r.skid).toFixed(2)} cm/rad   (a rolling cube is ~${DIE_HALF.toFixed(2)})`);
  console.log(`  late skid   ${mean((r) => r.lateSkid).toFixed(2)} cm/rad   (the roll-out, after the landing)`);
  console.log(`  reversals   ${mean((r) => r.walls).toFixed(2)} per die`);
  console.log(`  peak        ${mean((r) => r.peak).toFixed(2)} mean, ${pct((r) => r.peak, 0.99).toFixed(2)} p99, ${pct((r) => r.peak, 1).toFixed(2)} max  (dice high)`);
  console.log('  dwell above ' + [1, 2, 3, 4, 5].map((n) => `${n}d ${(mean((r) => r.above[n]) * 100).toFixed(2)}%`).join('  '));
  console.log(`  sleeps at   ${mean((r) => r.dozed).toFixed(2)} cm/s mean, ${pct((r) => r.dozed, 0.99).toFixed(2)} p99`);
  console.log(`  past deadline ${((out.filter((r) => r.steps > PHYS.DEADLINE).length / out.length) * 100).toFixed(1)}% of throws`);
  console.log(`  faces       ${tally.join(' ')}   chi2 ${chi.toFixed(2)} (5% crit 11.07)`);
}

main();
