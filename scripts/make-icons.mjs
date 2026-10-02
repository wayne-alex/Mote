import sharp from 'sharp';
import { mkdirSync } from 'fs';

mkdirSync('public/icons', { recursive: true });

// Regular icons + maskable (Android adaptive)
const sizes = [
  { src: 'public/icon.svg', dst: 'public/icons/icon-192.png',          size: 192 },
  { src: 'public/icon.svg', dst: 'public/icons/icon-512.png',          size: 512 },
  { src: 'public/icon.svg', dst: 'public/icons/icon-maskable-192.png', size: 192, mask: true },
  { src: 'public/icon.svg', dst: 'public/icons/icon-maskable-512.png', size: 512, mask: true },
  { src: 'public/icon.svg', dst: 'public/apple-touch-icon.png',        size: 180 },
  { src: 'public/icon.svg', dst: 'public/favicon-32x32.png',           size: 32  },
  { src: 'public/icon.svg', dst: 'public/favicon-16x16.png',           size: 16  },
];

for (const { src, dst, size, mask } of sizes) {
  let pipeline = sharp(src, { density: 512 });

  if (mask) {
    // Maskable icons need ~20% padding inside a solid background
    // so Android's adaptive icon masks don't clip the mark.
    const inner = Math.round(size * 0.6);
    const offset = Math.round((size - inner) / 2);

    const innerPng = await sharp(src, { density: 512 })
      .resize(inner, inner)
      .png()
      .toBuffer();

    pipeline = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 250, g: 250, b: 248, alpha: 1 },  // --paper
      },
    }).composite([{ input: innerPng, top: offset, left: offset }]);
  } else {
    pipeline = pipeline.resize(size, size);
  }

  await pipeline.png().toFile(dst);
  console.log(`✓ ${dst}`);
}