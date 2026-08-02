import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

const svgTemplate = `
<svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <mask id="cat-mask">
    <rect width="24" height="24" fill="white" />
    <circle cx="8.5" cy="11.5" r="1.3" fill="black" />
    <circle cx="15.5" cy="11.5" r="1.3" fill="black" />
    <path d="M10.8 14.2C11.5 15 12.5 15 13.2 14.2" stroke="black" stroke-width="1.3" stroke-linecap="round" fill="none" />
  </mask>

  <!-- Cute Cat Head Silhouette -->
  <path d="M4.2 9L6.8 3.8L10.2 6.3C11.4 6 12.6 6 13.8 6.3L17.2 3.8L19.8 9C20.8 11.2 20.6 14.2 19.2 16.5C17.7 18.8 15 20.2 12 20.2C9 20.2 6.3 18.8 4.8 16.5C3.4 14.2 3.2 11.2 4.2 9Z" fill="black" mask="url(#cat-mask)" />
</svg>
`;

const buildDir = path.join(projectRoot, 'build');
const publicIconsDir = path.join(projectRoot, 'src', 'renderer', 'public', 'icons');
const rendererIconsDir = path.join(projectRoot, 'src', 'renderer', 'icons');

[buildDir, publicIconsDir, rendererIconsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

async function run() {
  const svgBuffer = Buffer.from(svgTemplate);

  // 44x44 for @2x high-DPI displays
  const png44 = await sharp(svgBuffer)
    .resize(44, 44)
    .png()
    .toBuffer();

  // 22x22 for standard displays
  const png22 = await sharp(svgBuffer)
    .resize(22, 22)
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(buildDir, 'trayTemplate@2x.png'), png44);
  fs.writeFileSync(path.join(buildDir, 'trayTemplate.png'), png22);

  fs.writeFileSync(path.join(publicIconsDir, 'trayTemplate@2x.png'), png44);
  fs.writeFileSync(path.join(publicIconsDir, 'trayTemplate.png'), png22);

  fs.writeFileSync(path.join(rendererIconsDir, 'trayTemplate@2x.png'), png44);
  fs.writeFileSync(path.join(rendererIconsDir, 'trayTemplate.png'), png22);

  console.log('macOS monochrome Tray icons generated successfully!');
}

run().catch(err => console.error(err));
