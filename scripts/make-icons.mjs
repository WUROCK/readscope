// Generates app + tray icons without any image dependency.
// Renders at 4x and box-downsamples to keep edges clean.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'electron', 'assets');
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

class Canvas {
  constructor(size) {
    this.size = size;
    this.data = Buffer.alloc(size * size * 4);
  }
  blend(x, y, r, g, b, a = 1) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const i = (y * this.size + x) * 4;
    const da = this.data[i + 3] / 255;
    const outA = a + da * (1 - a);
    if (outA <= 0) return;
    for (let k = 0; k < 3; k++) {
      const sc = [r, g, b][k];
      const dc = this.data[i + k];
      this.data[i + k] = Math.round((sc * a + dc * da * (1 - a)) / outA);
    }
    this.data[i + 3] = Math.round(outA * 255);
  }
  roundedRect(x, y, w, h, radius, color, alpha = 1) {
    const [r, g, b] = color;
    for (let py = Math.floor(y); py < y + h; py++) {
      for (let px = Math.floor(x); px < x + w; px++) {
        const dx = Math.max(x + radius - px, 0, px - (x + w - radius - 1));
        const dy = Math.max(y + radius - py, 0, py - (y + h - radius - 1));
        const inside = dx * dx + dy * dy <= radius * radius;
        if (inside) this.blend(px, py, r, g, b, alpha);
      }
    }
  }
  circle(cx, cy, rad, color, alpha = 1) {
    const [r, g, b] = color;
    for (let py = Math.floor(cy - rad); py <= cy + rad; py++) {
      for (let px = Math.floor(cx - rad); px <= cx + rad; px++) {
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy <= rad * rad) this.blend(px, py, r, g, b, alpha);
      }
    }
  }
  downsample(factor) {
    const outSize = this.size / factor;
    const out = Buffer.alloc(outSize * outSize * 4);
    for (let y = 0; y < outSize; y++) {
      for (let x = 0; x < outSize; x++) {
        let sr = 0, sg = 0, sb = 0, sa = 0;
        for (let yy = 0; yy < factor; yy++) {
          for (let xx = 0; xx < factor; xx++) {
            const i = ((y * factor + yy) * this.size + (x * factor + xx)) * 4;
            const a = this.data[i + 3] / 255;
            sr += this.data[i] * a;
            sg += this.data[i + 1] * a;
            sb += this.data[i + 2] * a;
            sa += a;
          }
        }
        const o = (y * outSize + x) * 4;
        const n = factor * factor;
        if (sa > 0) {
          out[o] = Math.round(sr / sa);
          out[o + 1] = Math.round(sg / sa);
          out[o + 2] = Math.round(sb / sa);
        }
        out[o + 3] = Math.round((sa / n) * 255);
      }
    }
    return { size: outSize, data: out };
  }
}

const TERRA = [181, 83, 47];
const CREAM = [255, 250, 238];
const SAND = [232, 212, 176];
const GOLD = [201, 154, 75];
const INK = [38, 34, 27];

function render(size) {
  const S = 4;
  const c = new Canvas(size * S);
  const u = size * S;
  const pad = u * 0.04;
  c.roundedRect(pad, pad, u - pad * 2, u - pad * 2, u * 0.24, TERRA);
  // subtle top highlight
  c.roundedRect(pad, pad, u - pad * 2, u * 0.32, u * 0.24, [201, 116, 78], 0.35);
  // book page
  const bw = u * 0.46;
  const bh = u * 0.6;
  const bx = (u - bw) / 2;
  const by = (u - bh) / 2;
  c.roundedRect(bx, by, bw, bh, u * 0.035, CREAM);
  // spine
  c.roundedRect(bx, by, bw * 0.16, bh, u * 0.03, SAND);
  // lines
  const lineX = bx + bw * 0.27;
  const lineW = bw * 0.56;
  for (let i = 0; i < 3; i++) {
    c.roundedRect(lineX, by + bh * (0.27 + i * 0.18), lineW * (i === 2 ? 0.62 : 1), bh * 0.045, bh * 0.02, TERRA, 0.72);
  }
  // bookmark ribbon
  c.roundedRect(bx + bw * 0.72, by - u * 0.012, bw * 0.13, bh * 0.28, u * 0.012, GOLD);
  // small dot
  c.circle(bx + bw * 0.78, by + bh * 0.78, u * 0.022, INK, 0.55);
  return c.downsample(S);
}

function save(name, size) {
  const { size: s, data } = render(size);
  writeFileSync(path.join(OUT, name), encodePng(s, s, data));
  console.log(`wrote ${name} ${s}x${s}`);
}

function saveIco(name, size) {
  const { size: s, data } = render(size);
  const png = encodePng(s, s, data);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0; // 0 = 256
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  writeFileSync(path.join(OUT, name), Buffer.concat([header, png]));
  console.log(`wrote ${name} (ico, ${s}x${s})`);
}

save('icon.png', 256);
save('icon@512.png', 512);
save('tray.png', 32);
saveIco('icon.ico', 256);
