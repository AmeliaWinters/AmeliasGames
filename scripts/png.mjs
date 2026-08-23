/**
 * A very small RGBA raster with a hand-rolled PNG encoder.
 *
 * Exists so the OG image and the launcher icons can be generated from the
 * same palette the app uses, with no image dependency to install or keep
 * up to date. Shapes are edge-blended, so circles come out antialiased.
 */
import { deflateSync, crc32 as zlibCrc32 } from "node:zlib";

/** "#rrggbb" or "#rrggbbaa" → [r, g, b, a] */
export function rgba(hex) {
  const h = hex.replace("#", "");
  const to = (i) => parseInt(h.slice(i, i + 2), 16);
  return [to(0), to(2), to(4), h.length >= 8 ? to(6) : 255];
}

export class Raster {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4); // transparent
  }

  #index(x, y) {
    return (y * this.width + x) * 4;
  }

  /** Source-over compositing, so shapes stack correctly on transparency. */
  #blend(x, y, [r, g, b, a], coverage) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const alpha = (a / 255) * coverage;
    if (alpha <= 0) return;
    const i = this.#index(x, y);
    const under = this.data[i + 3] / 255;
    const out = alpha + under * (1 - alpha);
    if (out <= 0) return;
    for (let c = 0; c < 3; c++) {
      const src = [r, g, b][c];
      this.data[i + c] = Math.round(
        (src * alpha + this.data[i + c] * under * (1 - alpha)) / out,
      );
    }
    this.data[i + 3] = Math.round(out * 255);
  }

  fill(colour) {
    this.rect(0, 0, this.width, this.height, colour);
  }

  rect(x0, y0, w, h, colour) {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
        this.#blend(x, y, colour, 1);
      }
    }
  }

  /** Signed-distance fill: `distance(x, y)` negative inside the shape. */
  #shape(left, top, right, bottom, colour, distance) {
    for (let y = Math.floor(top); y <= Math.ceil(bottom); y++) {
      for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
        const coverage = Math.min(1, Math.max(0, 0.5 - distance(x + 0.5, y + 0.5)));
        if (coverage > 0) this.#blend(x, y, colour, coverage);
      }
    }
  }

  circle(cx, cy, radius, colour) {
    this.#shape(
      cx - radius - 1,
      cy - radius - 1,
      cx + radius + 1,
      cy + radius + 1,
      colour,
      (x, y) => Math.hypot(x - cx, y - cy) - radius,
    );
  }

  ring(cx, cy, radius, thickness, colour) {
    const outer = radius + thickness / 2;
    this.#shape(
      cx - outer - 1,
      cy - outer - 1,
      cx + outer + 1,
      cy + outer + 1,
      colour,
      (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - radius) - thickness / 2,
    );
  }

  /**
   * A filled convex polygon — the faces of a tumbling cube, and nothing else
   * so far. Convex is the whole of the restriction: the distance is the
   * furthest of the edge half-planes, which is exact for a convex shape and
   * quietly wrong for a concave one.
   *
   * Winding-agnostic on purpose. The projected corners of a cube face reverse
   * their winding as the die turns past edge-on, and a routine that only
   * worked one way round would drop half the frames of a throw. The normals
   * are flipped if the centroid comes out outside.
   */
  polygon(points, colour) {
    if (points.length < 3) return;
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
    const edges = points.map((a, i) => {
      const b = points[(i + 1) % points.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      // The perpendicular; which side is "out" is settled below.
      return { a, nx: (b[1] - a[1]) / len, ny: -(b[0] - a[0]) / len };
    });
    const at = (x, y) =>
      edges.reduce((d, e) => Math.max(d, e.nx * (x - e.a[0]) + e.ny * (y - e.a[1])), -Infinity);
    const flip = at(cx, cy) > 0 ? -1 : 1;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    this.#shape(
      Math.min(...xs) - 1,
      Math.min(...ys) - 1,
      Math.max(...xs) + 1,
      Math.max(...ys) + 1,
      colour,
      (x, y) =>
        flip *
        edges.reduce((d, e) => Math.max(d, e.nx * (x - e.a[0]) + e.ny * (y - e.a[1])), -Infinity),
    );
  }

  roundedRect(x0, y0, w, h, radius, colour) {
    const r = Math.min(radius, w / 2, h / 2);
    this.#shape(x0 - 1, y0 - 1, x0 + w + 1, y0 + h + 1, colour, (x, y) => {
      // Distance to a rounded box, measured from its inset core.
      const dx = Math.max(x0 + r - x, 0, x - (x0 + w - r));
      const dy = Math.max(y0 + r - y, 0, y - (y0 + h - r));
      return Math.hypot(dx, dy) - r;
    });
  }

  toPNG() {
    const crc32 =
      typeof zlibCrc32 === "function"
        ? (buf) => zlibCrc32(buf) >>> 0
        : (() => {
            const table = Array.from({ length: 256 }, (_, n) => {
              let c = n;
              for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
              return c >>> 0;
            });
            return (buf) => {
              let c = 0xffffffff;
              for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
              return (c ^ 0xffffffff) >>> 0;
            };
          })();

    const chunk = (type, data) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const checksum = Buffer.alloc(4);
      checksum.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, checksum]);
    };

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // truecolour with alpha
    // bytes 10-12 stay zero: deflate, adaptive filtering, no interlace

    const stride = this.width * 4;
    const raw = Buffer.alloc(this.height * (stride + 1));
    for (let y = 0; y < this.height; y++) {
      raw[y * (stride + 1)] = 0; // filter: None
      this.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

/**
 * Stage, the app's default palette, shared by every generated image.
 *
 * These are the same six tokens the stylesheet sets on `:root` -- a link
 * preview in a palette the app no longer has is worse than no preview, since
 * it is the one picture of the game most people ever see.
 */
export const PALETTE = {
  ground: rgba("#0c0c0f"),
  board: rgba("#1e1e24"),
  hole: rgba("#08080a"),
  ink: rgba("#f5f1e8"),
  seat0: rgba("#ff5a47"), // ember
  seat1: rgba("#21c7f0"), // ice
  // --motif-off: an unlit piece where nothing bright sits on top of it. On a
  // real board an empty hole can afford to be near-invisible, because the
  // counters around it carry the shape; in a mark two counters wide there is
  // nothing else to carry it, so the empties are drawn as edges in this
  // instead. 3.9:1 on the board, against 1.2:1 for a --hole fill.
  motifOff: rgba("#7a7a86"),
};
