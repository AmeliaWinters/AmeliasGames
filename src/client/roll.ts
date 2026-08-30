/**
 * The spin every purchase in this app is drawn out by.
 *
 * Two screens spend the same purse on the same press: a chest on the shop's
 * grid and a pull in the gacha dialog. They arrived separately and moved
 * differently -- the pull cycled portraits at a flat 90ms and stopped dead,
 * the chest did not cycle anything at all and only pulsed its own border --
 * so the more expensive of the two felt like the cheaper one. This is the one
 * place either of them gets its timing from now, and `roll.css` is the one
 * place either of them gets its movement from. A comment claiming two screens
 * match is not a mechanism for keeping them matching.
 *
 * **The tick schedule is the whole reason this is a module and not a
 * constant.** A slot machine reads as a slot machine because it slows down;
 * a constant interval that stops on the answer reads as a list that was cut
 * off. So the faces are spaced by an ease-out: equal steps through the
 * *sequence*, unequal steps through *time*, which front-loads the blur and
 * leaves a long beat on the last face before the reveal takes over. That beat
 * is the hold, and it costs nothing extra because it is the tail of the floor
 * the pull already waited for.
 *
 * It is a pure function of a duration, so `roll.test.ts` can assert the shape
 * -- monotonic, ends on the floor, decelerating -- in Node. That matters more
 * here than anywhere: the Browser pane never composites a frame, so this is
 * the one kind of movement in this app nobody can check by looking (see
 * CLAUDE.md), and the schedule is the half of it that is arithmetic.
 */

/**
 * How long a spend is drawn out for, at minimum.
 *
 * A server that answers in 80ms would otherwise flash one face and stop,
 * which reads as a broken button rather than as a pull. A slow server simply
 * makes it longer, which is the honest way round: this is a floor, never a
 * delay added to an answer that has already arrived late.
 */
export const SPIN_MS = 1700;

/** How many faces a spin walks through. Taste, but see `spinTicks`. */
export const SPIN_TICKS = 14;

/**
 * When each face lands, in milliseconds from the start of the spin.
 *
 * Equal steps through the sequence, `1 - (1 - s)^2` through time. Quadratic
 * rather than cubic on purpose: cubic put the first two faces 40ms apart,
 * which is under three frames and reads as a flicker rather than as speed.
 * At the numbers above this opens on roughly 60ms gaps and closes on roughly
 * 450, so the last face is held long enough to be read as a face.
 *
 * The final entry is exactly `total`, so a caller can use the schedule as the
 * floor as well and never has to add the two up itself.
 */
export function spinTicks(total: number = SPIN_MS, ticks: number = SPIN_TICKS): number[] {
  const steps = Math.max(2, Math.floor(ticks));
  const at: number[] = [];
  for (let i = 1; i <= steps; i++) {
    const through = i / steps;
    at.push(total * (1 - Math.sqrt(1 - through)));
  }
  return at;
}

/**
 * Run a spin, handing back the way to stop it.
 *
 * Chained `setTimeout` rather than one `setInterval`, because the gaps are not
 * equal; `at` is the offset from the start, so a browser that sleeps mid-spin
 * resumes on the schedule rather than replaying what it missed.
 *
 * `face` is a step counter, not an index: the caller owns the list and knows
 * its length, and passing the list in here would make this module care what is
 * being spun, which is the difference between one shared spin and two.
 */
export function startSpin(
  onFace: (step: number) => void,
  total: number = SPIN_MS,
): () => void {
  const at = spinTicks(total);
  const timers: ReturnType<typeof setTimeout>[] = [];
  const began = Date.now();
  at.forEach((when, step) => {
    timers.push(
      setTimeout(
        () => onFace(step + 1),
        Math.max(0, when - (Date.now() - began)),
      ),
    );
  });
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}

/**
 * Which of `count` things the spin is showing on a given step.
 *
 * A stride rather than `step + 1`, because both pools are sorted and walking
 * them in order shows fourteen neighbours: fourteen faces out of the same
 * series in the gacha, and in a chest fourteen variants of one hat. What a
 * spin is meant to say is *how much is in here*, and adjacent entries say the
 * opposite.
 *
 * The stride is the first of 7, 5, 3, 2, 1 that is coprime with the pool, so
 * it never lands back where it started before it has been everywhere. Picking
 * seven and hoping would stand still on a pool of seven, and a slot with seven
 * variants in it is an ordinary size for a small set.
 */
export function spinFace(step: number, count: number): number {
  if (count <= 1) return 0;
  const stride = [7, 5, 3, 2, 1].find((each) => gcd(each, count) === 1) ?? 1;
  return (step * stride) % count;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
