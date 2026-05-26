// Script to generate PNG icons from SVG for the extension
// Run with: node generate-icons.js
// Requires: npm install sharp

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZES = [16, 48, 128];

const svgBuffer = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7c3aed"/>
      <stop offset="100%" style="stop-color:#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <text x="64" y="88" font-family="system-ui, sans-serif" font-size="72" fill="white" font-weight="900" text-anchor="middle">✦</text>
</svg>
`);

async function generate() {
  for (const size of SIZES) {
    const outPath = path.join(__dirname, 'icons', `icon${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Generated ${outPath}`);
  }
}

generate().catch(console.error);
