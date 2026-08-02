import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const packagePath = path.join(projectRoot, 'package.json');

if (!fs.existsSync(packagePath)) {
  throw new Error(`拒绝清理：${projectRoot} 缺少 package.json`);
}

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (packageJson.name !== 'desktop-pet-v2') {
  throw new Error(`拒绝清理非 desktop-pet-v2 项目：${projectRoot}`);
}

for (const relativePath of ['dist', 'release']) {
  const target = path.resolve(projectRoot, relativePath);
  if (path.dirname(target) !== projectRoot) {
    throw new Error(`拒绝清理越界目录：${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}
