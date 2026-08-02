// 创建者：husu
import path from 'node:path';

export function selectPackagedNativeModule(files, moduleName, platform, arch) {
  const matches = files.filter((filePath) => filePath.includes(moduleName));
  if (matches.length === 0) {
    throw new Error(`打包产物缺少必需原生模块：${moduleName}`);
  }

  const rebuilt = matches.filter((filePath) => {
    const normalized = normalizePath(filePath);
    return normalized.includes('/build/Release/');
  });
  if (rebuilt.length === 1) return rebuilt[0];

  const platformMarkers = platform === 'linux'
    ? [`${platform}-${arch}-gnu`, `${platform}-${arch}`]
    : [`${platform}-${arch}`];
  for (const marker of platformMarkers) {
    const platformMatches = matches.filter((filePath) => (
      nativeFileName(filePath).includes(marker)
    ));
    if (platformMatches.length === 1) return platformMatches[0];
  }

  if (matches.length === 1) return matches[0];
  throw new Error(
    `无法为 ${platform}/${arch} 唯一确定原生模块 ${moduleName}：${matches.join(', ')}`,
  );
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function nativeFileName(filePath) {
  return normalizePath(filePath).split('/').at(-1) ?? '';
}
