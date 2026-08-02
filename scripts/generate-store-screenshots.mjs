import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// 创建者：husu
// 将真实应用窗口截图排版成 Microsoft Store Desktop 1366x768 展示图。
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const listingDirectory = path.join(projectRoot, 'build', 'store-listing');
const sourceDirectory = path.join(listingDirectory, 'source');
const iconPath = path.join(projectRoot, 'build', 'icon.png');
const width = 1366;
const height = 768;

const screenshots = [
  {
    file: '01-desktop-companion.png',
    source: 'status-panel.png',
    title: '你的桌面陪伴伙伴',
    subtitle: '互动、喂食与状态照料，让工作桌面多一点温度。',
    shot: { x: 760, y: 148, width: 500, height: 520 },
    icon: { x: 128, y: 302, width: 330, height: 360 },
  },
  {
    file: '02-focus-reminders.png',
    source: 'focus-reminders.png',
    title: '专注工作，也记得休息',
    subtitle: '专注计时、喝水、久坐与健康提醒集中管理。',
    shot: { x: 620, y: 180, width: 650, height: 470 },
    icon: { x: 154, y: 356, width: 270, height: 300 },
  },
  {
    file: '03-growth-tasks.png',
    source: 'growth-tasks.png',
    title: '陪伴会留下成长轨迹',
    subtitle: '经验、关系值、每日任务与成就持续记录。',
    shot: { x: 610, y: 146, width: 690, height: 540 },
    icon: { x: 150, y: 348, width: 278, height: 310 },
  },
  {
    file: '04-catch-food-game.png',
    source: 'catch-food-game.png',
    title: '轻松玩一局',
    subtitle: '多档难度、连击与每日奖励。',
    shot: { x: 470, y: 116, width: 840, height: 570 },
    icon: { x: 108, y: 396, width: 230, height: 260 },
  },
  {
    file: '05-private-customizable.png',
    source: 'settings.png',
    title: '本地优先，按你的习惯运行',
    subtitle: '行为、提醒、小游戏与隐私选项都可细致调整。',
    shot: { x: 850, y: 58, width: 390, height: 650 },
    icon: { x: 170, y: 368, width: 270, height: 300 },
  },
];

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function createBackdrop(item) {
  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#111827"/>
          <stop offset="1" stop-color="#263449"/>
        </linearGradient>
        <radialGradient id="glow" cx="0.2" cy="0.2" r="0.8">
          <stop offset="0" stop-color="#d39a5a" stop-opacity="0.24"/>
          <stop offset="1" stop-color="#d39a5a" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1366" height="768" fill="url(#background)"/>
      <rect width="1366" height="768" fill="url(#glow)"/>
      <circle cx="1240" cy="80" r="180" fill="#8b5cf6" opacity="0.09"/>
      <text x="96" y="94" fill="#d9a76c" font-size="25" font-weight="700"
        font-family="PingFang SC, Microsoft YaHei, sans-serif" letter-spacing="2">DESKTATO</text>
      <text x="96" y="184" fill="#ffffff" font-size="50" font-weight="700"
        font-family="PingFang SC, Microsoft YaHei, sans-serif">${escapeXml(item.title)}</text>
      <text x="98" y="238" fill="#cbd5e1" font-size="25"
        font-family="PingFang SC, Microsoft YaHei, sans-serif">${escapeXml(item.subtitle)}</text>
      <rect x="96" y="270" width="104" height="4" rx="2" fill="#d9a76c"/>
      <rect x="${item.shot.x - 12}" y="${item.shot.y - 12}"
        width="${item.shot.width + 24}" height="${item.shot.height + 24}"
        rx="20" fill="#ffffff" opacity="0.12"/>
    </svg>
  `);
}

async function fitSourceScreenshot(item) {
  const sourcePath = path.join(sourceDirectory, item.source);
  const metadata = await sharp(sourcePath).metadata();
  const cropTop = Math.min(30, Math.max(0, (metadata.height ?? 0) - 1));
  const cropBottom = Math.min(12, Math.max(0, (metadata.height ?? 0) - cropTop - 1));
  const cropHorizontal = Math.min(2, Math.max(0, Math.floor(((metadata.width ?? 1) - 1) / 2)));
  return sharp(sourcePath)
    .extract({
      left: cropHorizontal,
      top: cropTop,
      width: (metadata.width ?? 1) - cropHorizontal * 2,
      height: (metadata.height ?? 1) - cropTop - cropBottom,
    })
    .resize({
      width: item.shot.width,
      height: item.shot.height,
      fit: 'contain',
      background: { r: 17, g: 24, b: 39, alpha: 1 },
    })
    .png()
    .toBuffer();
}

await fs.mkdir(listingDirectory, { recursive: true });
for (const item of screenshots) {
  const [shot, icon] = await Promise.all([
    fitSourceScreenshot(item),
    sharp(iconPath)
      .resize({ width: item.icon.width, height: item.icon.height, fit: 'inside' })
      .png()
      .toBuffer(),
  ]);

  await sharp(createBackdrop(item))
    .composite([
      { input: icon, left: item.icon.x, top: item.icon.y },
      { input: shot, left: item.shot.x, top: item.shot.y },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(listingDirectory, item.file));

  console.log(`${item.file}: ${width}x${height}`);
}
