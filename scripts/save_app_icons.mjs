import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const icon1Source = '/Users/huqinchao/.gemini/antigravity/brain/985d6549-3a63-450d-a81b-0d4247823f62/pet_app_icon_1_1785683658870.jpg';
const icon2Source = '/Users/huqinchao/.gemini/antigravity/brain/985d6549-3a63-450d-a81b-0d4247823f62/pet_app_icon_2_1785683709906.jpg';
const icon3Source = '/Users/huqinchao/.gemini/antigravity/brain/985d6549-3a63-450d-a81b-0d4247823f62/pet_app_icon_3_1785683744201.jpg';

const targetDir1 = path.join(projectRoot, 'src', 'renderer', 'public', 'icons');
const targetDir2 = path.join(projectRoot, 'src', 'renderer', 'icons');
const buildIconPath = path.join(projectRoot, 'build', 'icon.png');

// Create 512x512 rounded rectangle mask with rx=110 (iOS / macOS standard squircle proportion)
const maskSvg = Buffer.from(
  `<svg width="512" height="512">
    <rect x="0" y="0" width="512" height="512" rx="110" ry="110" fill="#ffffff" />
  </svg>`
);

async function processIcon(srcPath, filename) {
  const buf = fs.readFileSync(srcPath);
  const metadata = await sharp(buf).metadata();
  const w = metadata.width || 1024;
  const h = metadata.height || 1024;

  // Crop inner squircle (inset ~10% on each edge)
  const insetX = Math.round(w * 0.095);
  const insetY = Math.round(h * 0.095);
  const cropW = w - insetX * 2;
  const cropH = h - insetY * 2;

  // Extract inner icon, resize to 512x512, apply rounded alpha mask
  const cropped = await sharp(buf)
    .extract({ left: insetX, top: insetY, width: cropW, height: cropH })
    .resize(512, 512)
    .toBuffer();

  const finalPng = await sharp(cropped)
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(targetDir1, filename), finalPng);
  fs.writeFileSync(path.join(targetDir2, filename), finalPng);
  return finalPng;
}

async function run() {
  console.log('Processing Icon 1...');
  await processIcon(icon1Source, 'app_icon_1.png');

  console.log('Processing Icon 2...');
  await processIcon(icon2Source, 'app_icon_2.png');

  console.log('Processing Icon 3...');
  const icon3Png = await processIcon(icon3Source, 'app_icon_3.png');

  console.log('Updating build/icon.png...');
  fs.writeFileSync(buildIconPath, icon3Png);

  console.log('Done! All icons cropped to transparent squircle shape!');
}

run().catch(err => console.error(err));
