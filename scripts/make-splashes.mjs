// scripts/make-splashes.mjs
import sharp from 'sharp';
import { mkdirSync } from 'fs';

mkdirSync('public/splash', { recursive: true });

// Common iOS device sizes
const splashes = [
  { w: 1170, h: 2532, name: 'splash-1170x2532.png' },  // iPhone 12/13/14
  { w: 1284, h: 2778, name: 'splash-1284x2778.png' },  // iPhone 12/13/14 Pro Max
  { w: 1536, h: 2048, name: 'splash-1536x2048.png' },  // iPad
  { w: 750,  h: 1334, name: 'splash-750x1334.png' },   // iPhone SE / 8
  { w: 1242, h: 2688, name: 'splash-1242x2688.png' },  // iPhone XS Max
];

const PAPER_LIGHT = { r: 250, g: 250, b: 248, alpha: 1 };
const ICON_SIZE = 180;

for (const { w, h, name } of splashes) {
  // Icon centered on paper
  const icon = await sharp('public/icon.svg', { density: 512 })
    .resize(ICON_SIZE, ICON_SIZE)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: PAPER_LIGHT,
    },
  })
    .composite([
      {
        input: icon,
        top: Math.round((h - ICON_SIZE) / 2),
        left: Math.round((w - ICON_SIZE) / 2),
      },
    ])
    .png()
    .toFile(`public/splash/${name}`);

  console.log(`✓ public/splash/${name}`);
}