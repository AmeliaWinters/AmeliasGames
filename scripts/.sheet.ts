import sharp from 'sharp';
import path from 'node:path';

const COLS = 10, CELL = 128, PAD = 4;
async function sheet(dir: string, prefix: string, n: number, out: string) {
  const rows = Math.ceil(n / COLS);
  const W = COLS * (CELL + PAD) + PAD, H = rows * (CELL + PAD + 16) + PAD;
  const comp: sharp.OverlayOptions[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % COLS, r = Math.floor(i / COLS);
    const x = PAD + c * (CELL + PAD), y = PAD + r * (CELL + PAD + 16);
    try {
      comp.push({ input: await sharp(path.join(dir, `${prefix}-${i}-0-0.webp`)).resize(CELL, CELL, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer(), left: x, top: y });
    } catch { /* some items have no 0-0 layer */ }
    comp.push({
      input: Buffer.from(`<svg width="${CELL}" height="16"><text x="2" y="12" font-family="monospace" font-size="12" fill="#000">${i}</text></svg>`),
      left: x, top: y + CELL,
    });
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 235, g: 235, b: 238, alpha: 1 } } }).composite(comp).png().toFile(out);
  console.log(out, `${W}x${H}`, `${n} cells`);
}

await sheet('src/client/avatar/sets/makowka/webp', 'bg', 50, 'preview/makowka-bg.png');
await sheet('src/client/avatar/sets/snake/webp', 'bg', 8, 'preview/snake-bg.png');
