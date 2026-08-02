import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// 创建者：husu
// 从应用主图标派生 AppX 与 Microsoft Store 商品页所需的确定性 PNG 资源。
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const sourceIcon = path.join(projectRoot, 'build', 'icon.png');

const assets = [
  { file: 'build/appx/StoreLogo.png', width: 50, height: 50, scale: 0.84 },
  { file: 'build/appx/Square44x44Logo.png', width: 44, height: 44, scale: 0.84 },
  { file: 'build/appx/Square150x150Logo.png', width: 150, height: 150, scale: 0.84 },
  { file: 'build/appx/Wide310x150Logo.png', width: 310, height: 150, scale: 0.84 },
  { file: 'build/store-listing/AppTile300x300.png', width: 300, height: 300, scale: 0.84 },
];

for (const asset of assets) {
  const destination = path.join(projectRoot, asset.file);
  await fs.mkdir(path.dirname(destination), { recursive: true });

  const resized = await sharp(sourceIcon)
    .resize({
      width: Math.floor(asset.width * asset.scale),
      height: Math.floor(asset.height * asset.scale),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
  const metadata = await sharp(resized).metadata();
  const left = Math.floor((asset.width - (metadata.width ?? 0)) / 2);
  const top = Math.floor((asset.height - (metadata.height ?? 0)) / 2);

  await sharp({
    create: {
      width: asset.width,
      height: asset.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .png({ compressionLevel: 9 })
    .toFile(destination);

  console.log(`${asset.file}: ${asset.width}x${asset.height}`);
}
