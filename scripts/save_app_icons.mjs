import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const icon1Source = '/Users/huqinchao/.gemini/antigravity/brain/985d6549-3a63-450d-a81b-0d4247823f62/pet_app_icon_1_1785683658870.jpg';
const icon2Source = '/Users/huqinchao/.gemini/antigravity/brain/985d6549-3a63-450d-a81b-0d4247823f62/pet_app_icon_2_1785683709906.jpg';
const icon3Source = '/Users/huqinchao/.gemini/antigravity/brain/985d6549-3a63-450d-a81b-0d4247823f62/pet_app_icon_3_1785683744201.jpg';

const targetDir = path.join(projectRoot, 'src', 'renderer', 'public', 'icons');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

async function convertImage(srcPath, outPath) {
  const buf = fs.readFileSync(srcPath);
  await sharp(buf)
    .resize(512, 512)
    .png()
    .toFile(outPath);
}

async function processIcons() {
  console.log('Processing icon 1...');
  await convertImage(icon1Source, path.join(targetDir, 'app_icon_1.png'));

  console.log('Processing icon 2...');
  await convertImage(icon2Source, path.join(targetDir, 'app_icon_2.png'));

  console.log('Processing icon 3...');
  await convertImage(icon3Source, path.join(targetDir, 'app_icon_3.png'));

  // Option 3 is default app build icon
  const buildIconPath = path.join(projectRoot, 'build', 'icon.png');
  console.log('Setting Option 3 as default build icon at', buildIconPath);
  await convertImage(icon3Source, buildIconPath);

  console.log('All icons processed and saved successfully!');
}

processIcons().catch(err => console.error(err));
