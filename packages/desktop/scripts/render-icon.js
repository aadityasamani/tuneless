const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const svg = fs.readFileSync(svgPath, 'utf8');

async function main() {
  const sizes = [512, 256, 128, 64, 32];

  for (const size of sizes) {
    const output = path.join(__dirname, '..', 'assets', size === 512 ? 'icon.png' : `icon-${size}.png`);

    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(output);

    const stat = fs.statSync(output);
    console.log(`  icon-${size}.png  (${(stat.size / 1024).toFixed(1)} KB)`);
  }

  console.log('✓ All icons generated');
}

main().catch(console.error);
