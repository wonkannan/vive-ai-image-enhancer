/**
 * Generates assets/icon.ico (proper multi-size ICO) with the VIVE AI brand.
 * Run once:  node create-icon.js
 */
'use strict';

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

// VIVE AI brand SVG logo (V-shaped ribbon with cyan→blue→purple→magenta→orange)
function makeSvg(size) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 512 512"
          xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="left" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#00d4ff"/>
      <stop offset="100%" stop-color="#4040e8"/>
    </linearGradient>
    <linearGradient id="right" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#ff6a00"/>
      <stop offset="50%"  stop-color="#cc00cc"/>
      <stop offset="100%" stop-color="#6600cc"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- White background -->
  <rect width="512" height="512" rx="80" fill="white"/>

  <!-- Left wing of V -->
  <path d="M 60 80
           C 80 80, 120 90, 145 130
           L 256 360
           L 230 360
           L 100 130
           C 75 95, 50 90, 40 90 Z"
        fill="url(#left)" opacity="0.95"/>

  <!-- Main left arm -->
  <path d="M 40 90
           L 145 130
           L 256 360
           L 256 390
           L 130 145
           C 100 105, 65 95, 45 98 Z"
        fill="url(#left)"/>

  <!-- Right wing of V -->
  <path d="M 452 80
           C 432 80, 392 90, 367 130
           L 256 360
           L 282 360
           L 412 130
           C 437 95, 462 90, 472 90 Z"
        fill="url(#right)" opacity="0.95"/>

  <!-- Main right arm -->
  <path d="M 472 90
           L 367 130
           L 256 360
           L 256 390
           L 382 145
           C 412 105, 447 95, 467 98 Z"
        fill="url(#right)"/>

  <!-- Center sparkle -->
  <circle cx="256" cy="195" r="12" fill="white" filter="url(#glow)" opacity="0.9"/>
  <circle cx="256" cy="195" r="5"  fill="white"/>
</svg>`;
}

/** Build a valid .ico from an array of PNG Buffers */
function buildIco(pngBuffers) {
  const count       = pngBuffers.length;
  const headerBytes = 6 + count * 16;

  let dataOffset = headerBytes;
  const entries  = pngBuffers.map(buf => {
    // Read PNG IHDR: width @ offset 16, height @ 20
    const w   = buf.readUInt32BE(16);
    const h   = buf.readUInt32BE(20);
    const ent = { w: w >= 256 ? 0 : w, h: h >= 256 ? 0 : h,
                  size: buf.length, offset: dataOffset };
    dataOffset += buf.length;
    return ent;
  });

  const total = dataOffset;
  const out   = Buffer.alloc(total);

  // ICONDIR
  out.writeUInt16LE(0, 0);      // reserved
  out.writeUInt16LE(1, 2);      // type = ICO
  out.writeUInt16LE(count, 4);  // image count

  // ICONDIRENTRY × count
  let pos = 6;
  for (const e of entries) {
    out.writeUInt8(e.w, pos);      out.writeUInt8(e.h, pos+1);
    out.writeUInt8(0,  pos+2);    out.writeUInt8(0,  pos+3);  // colorCount, reserved
    out.writeUInt16LE(1,      pos+4);   // planes
    out.writeUInt16LE(32,     pos+6);   // bit count
    out.writeUInt32LE(e.size, pos+8);   // data size
    out.writeUInt32LE(e.offset, pos+12);// data offset
    pos += 16;
  }

  // PNG image data
  for (const buf of pngBuffers) {
    buf.copy(out, pos);
    pos += buf.length;
  }

  return out;
}

async function main() {
  const outDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const sizes   = [16, 32, 48, 64, 128, 256];
  const buffers = [];

  for (const sz of sizes) {
    const svg = makeSvg(sz);
    const png = await sharp(Buffer.from(svg))
      .resize(sz, sz)
      .png()
      .toBuffer();
    buffers.push(png);
    console.log(`  ✓ ${sz}×${sz}`);
  }

  // Save the 256px PNG as well (used for macOS / Linux)
  fs.writeFileSync(path.join(outDir, 'icon.png'), buffers[buffers.length - 1]);

  // Build and save proper ICO (contains all sizes)
  const ico = buildIco(buffers);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  console.log('\n✓ assets/icon.ico  (16 / 32 / 48 / 64 / 128 / 256 px)');
  console.log('✓ assets/icon.png  (256 px)');
  console.log('\nReplace assets/icon.ico with your own file any time.');
}

main().catch(console.error);
