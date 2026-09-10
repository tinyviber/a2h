// Generates the binary / large fixtures that are awkward to hand-author:
//   - tiny valid PNG images (for image rendering + dimension detection)
//   - a binary file with NUL bytes
//   - a long log (300+ lines) with embedded errors/warnings
// Run: node test/fixtures/generate.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'fixtures');

// --- CRC32 (PNG chunk checksum) -------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function buildPng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = rgb[0]; raw[p + 1] = rgb[1]; raw[p + 2] = rgb[2];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ensure(dir) { mkdirSync(dir, { recursive: true }); }

// --- fixtures --------------------------------------------------------------
ensure(join(ROOT, 'clean', 'screenshots'));
writeFileSync(join(ROOT, 'clean', 'screenshots', 'home.png'), buildPng(120, 90, [210, 120, 60]));

ensure(join(ROOT, 'mixed', 'screenshots'));
writeFileSync(join(ROOT, 'mixed', 'screenshots', 'shot.png'), buildPng(320, 200, [40, 90, 160]));

ensure(join(ROOT, 'mixed', 'misc'));
writeFileSync(join(ROOT, 'mixed', 'misc', 'unknown.bin'), Buffer.from([0, 1, 2, 0, 255, 0, 128, 0, 64, 0, 32]));

ensure(join(ROOT, 'mixed', 'logs'));
const logLines = [];
for (let i = 0; i < 300; i++) {
  if (i === 42) logLines.push(`[line ${i}] ERROR: something went wrong`);
  else if (i === 288) logLines.push(`[line ${i}] warning: deprecation notice`);
  else if (i % 50 === 0) logLines.push(`[line ${i}] info: checkpoint`);
  else logLines.push(`[line ${i}] processing item ${i}`);
}
writeFileSync(join(ROOT, 'mixed', 'logs', 'build.log'), logLines.join('\n') + '\n');

console.log('fixtures generated');
