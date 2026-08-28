import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'public/icons');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]), Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const nearX = Math.max(left + radius, Math.min(x, right - radius));
  const nearY = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - nearX) ** 2 + (y - nearY) ** 2 <= radius ** 2;
}

function makeIcon(size, safeInset = 0.14) {
  const pixels = new Uint8Array(size * size * 4);
  const colors = { green: [23, 107, 82, 255], cream: [250, 247, 239, 255], orange: [227, 128, 73, 255], ink: [25, 67, 57, 255] };
  const inset = Math.round(size * safeInset);
  const left = inset;
  const top = Math.round(size * (safeInset + 0.04));
  const right = size - inset;
  const bottom = size - inset;
  const radius = Math.round(size * 0.08);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = colors.green;
      if (insideRoundedRect(x, y, left, top, right, bottom, radius)) color = colors.cream;
      if (insideRoundedRect(x, y, left, top, right, Math.round(size * 0.38), radius)) color = colors.orange;
      const ringWidth = Math.max(2, Math.round(size * 0.035));
      const ringTop = Math.round(size * 0.13);
      const ringBottom = Math.round(size * 0.29);
      const ringCenters = [Math.round(size * 0.34), Math.round(size * 0.66)];
      if (ringCenters.some((center) => Math.abs(x - center) <= ringWidth / 2) && y >= ringTop && y <= ringBottom) color = colors.ink;
      const dotRadius = Math.max(2, Math.round(size * 0.035));
      const dotCentersX = [0.34, 0.5, 0.66].map((value) => Math.round(size * value));
      const dotCentersY = [0.52, 0.68].map((value) => Math.round(size * value));
      if (dotCentersX.some((centerX) => dotCentersY.some((centerY) => (x - centerX) ** 2 + (y - centerY) ** 2 <= dotRadius ** 2))) color = colors.green;
      pixels.set(color, (y * size + x) * 4);
    }
  }
  return png(size, size, pixels);
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDirectory, 'icon-192.png'), makeIcon(192)),
  writeFile(resolve(outputDirectory, 'icon-512.png'), makeIcon(512)),
  writeFile(resolve(outputDirectory, 'icon-maskable-512.png'), makeIcon(512, 0.2)),
  writeFile(resolve(outputDirectory, 'apple-touch-icon.png'), makeIcon(180)),
]);
console.log(`Generated PWA icons: ${outputDirectory}`);
