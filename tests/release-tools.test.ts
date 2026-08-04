import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '..');
const releaseScript = path.join(projectRoot, 'scripts', 'release.mjs');
const nativeSelectorScript = path.join(
  projectRoot,
  'scripts',
  'select-packaged-native.mjs',
);
const builderConfigPath = path.join(projectRoot, 'electron-builder.yml');
const packageWorkflowPath = path.join(
  projectRoot,
  '.github',
  'workflows',
  'package.yml',
);
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageVersion = String(
  JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version,
);
const temporaryDirectories: string[] = [];

// 统一归一化换行符：Windows runner 默认检出 CRLF，直接断言 LF 子串会误失败。
function readRepositoryText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('发布工具', () => {
  it('拒绝与 package.json 不一致的标签', () => {
    const result = runRelease(['verify', '--tag', 'v9.9.9']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `与 package.json v${packageVersion} 不一致`,
    );
  });

  it('为平台产物生成可复核的元数据和 SHA-256', () => {
    const root = createTemporaryDirectory();
    writeArtifact(root, `DesktopPet-${packageVersion}-macOS-arm64.dmg`, 'dmg');
    writeArtifact(root, `DesktopPet-${packageVersion}-macOS-arm64.zip`, 'zip');
    const metadataPath = path.join(root, 'build-meta-darwin-arm64.json');

    const result = runRelease([
      'metadata',
      '--platform', 'darwin',
      '--arch', 'arm64',
      '--directory', root,
      '--output', metadataPath,
      '--signed', 'true',
    ]);

    expect(result.status).toBe(0);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    expect(metadata).toMatchObject({
      schemaVersion: 1,
      version: packageVersion,
      platform: 'darwin',
      arch: 'arm64',
      signed: true,
    });
    expect(metadata.artifacts).toHaveLength(2);
    expect(metadata.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      fs.readFileSync(path.join(root, 'checksums-darwin-arm64.sha256'), 'utf8'),
    ).toContain(`DesktopPet-${packageVersion}-macOS-arm64.dmg`);
  });

  it('识别 electron-builder 的 Linux x64 目标架构命名', () => {
    const root = createTemporaryDirectory();
    writeArtifact(
      root,
      `DesktopPet-${packageVersion}-Linux-x86_64.AppImage`,
      'appimage',
    );
    writeArtifact(root, `DesktopPet-${packageVersion}-Linux-amd64.deb`, 'deb');
    const metadataPath = path.join(root, 'build-meta-linux-x64.json');

    const result = runRelease([
      'metadata',
      '--platform', 'linux',
      '--arch', 'x64',
      '--directory', root,
      '--output', metadataPath,
      '--signed', 'false',
    ]);

    expect(result.status).toBe(0);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    expect(metadata.artifacts.map((artifact: { fileName: string }) => (
      artifact.fileName
    ))).toEqual([
      `DesktopPet-${packageVersion}-Linux-amd64.deb`,
      `DesktopPet-${packageVersion}-Linux-x86_64.AppImage`,
    ]);
  });

  it('为 Microsoft Store AppX 生成单产物元数据', () => {
    const root = createTemporaryDirectory();
    writeArtifact(
      root,
      `DesktopPet-${packageVersion}-Windows-x64-Store.appx`,
      'appx',
    );
    const metadataPath = path.join(root, 'build-meta-win32-store-x64.json');

    const result = runRelease([
      'metadata',
      '--platform', 'win32-store',
      '--arch', 'x64',
      '--directory', root,
      '--output', metadataPath,
      '--signed', 'false',
    ]);

    expect(result.status).toBe(0);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    expect(metadata).toMatchObject({
      platform: 'win32-store',
      arch: 'x64',
      signed: false,
    });
    expect(metadata.artifacts).toHaveLength(1);
    expect(metadata.artifacts[0].fileName).toBe(
      `DesktopPet-${packageVersion}-Windows-x64-Store.appx`,
    );
  });

  it('聚合前重新校验文件哈希并生成安全下载地址', () => {
    const root = createTemporaryDirectory();
    writeArtifact(root, `DesktopPet-${packageVersion}-macOS-arm64.dmg`, 'dmg');
    writeArtifact(root, `DesktopPet-${packageVersion}-macOS-arm64.zip`, 'zip');
    const metadataPath = path.join(root, 'build-meta-darwin-arm64.json');
    expect(runRelease([
      'metadata',
      '--platform', 'darwin',
      '--arch', 'arm64',
      '--directory', root,
      '--output', metadataPath,
      '--signed', 'true',
    ]).status).toBe(0);
    const manifestPath = path.join(root, 'release-manifest.json');

    const result = runRelease([
      'merge',
      '--input', root,
      '--output', manifestPath,
      '--base-url', `https://example.com/releases/v${packageVersion}`,
      '--release-url', `https://example.com/releases/v${packageVersion}`,
      '--expected', 'darwin-arm64',
      '--require-signed', 'darwin',
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.artifacts).toHaveLength(2);
    expect(manifest.artifacts[0].url).toMatch(/^https:\/\/example\.com\//);

    fs.appendFileSync(
      path.join(root, `DesktopPet-${packageVersion}-macOS-arm64.dmg`),
      'tampered',
    );
    const tampered = runRelease([
      'merge',
      '--input', root,
      '--output', manifestPath,
      '--base-url', `https://example.com/releases/v${packageVersion}`,
      '--release-url', `https://example.com/releases/v${packageVersion}`,
      '--expected', 'darwin-arm64',
    ]);
    expect(tampered.status).not.toBe(0);
    expect(tampered.stderr).toContain('发布文件与平台元数据不一致');
  });
});

describe('打包原生模块选择', () => {
  it('Linux 校验使用构建配置中固定的主程序名', () => {
    const builderConfig = readRepositoryText(builderConfigPath);
    const packageWorkflow = readRepositoryText(packageWorkflowPath);

    expect(builderConfig).toContain('executableName: desktop-pet-v2');
    expect(packageWorkflow).toContain('BIN="$ROOT/desktop-pet-v2"');
  });

  it('Windows 只选择当前平台架构的预构建文件', () => {
    const files = [
      'resources/node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
      'resources/node_modules/better-sqlite3/prebuilds/linux-x64.node',
      'resources/node_modules/better-sqlite3/prebuilds/win32-x64.node',
    ];

    expect(runNativeSelector(files, 'better-sqlite3', 'win32', 'x64')).toBe(
      files[2],
    );
  });

  it('Linux 优先选择 GNU Keyring 文件', () => {
    const files = [
      'resources/node_modules/@napi-rs/keyring-linux-x64-musl/keyring.linux-x64-musl.node',
      'resources/node_modules/@napi-rs/keyring-linux-x64-gnu/keyring.linux-x64-gnu.node',
    ];

    expect(runNativeSelector(files, 'keyring', 'linux', 'x64')).toBe(files[1]);
  });

  it('Linux 产物根目录名不参与原生模块平台匹配', () => {
    const files = [
      'release/linux-arm64-unpacked/resources/node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
      'release/linux-arm64-unpacked/resources/node_modules/better-sqlite3/prebuilds/linux-arm64.node',
      'release/linux-arm64-unpacked/resources/node_modules/better-sqlite3/prebuilds/win32-arm64.node',
    ];

    expect(runNativeSelector(files, 'better-sqlite3', 'linux', 'arm64')).toBe(
      files[1],
    );
  });

  it('优先选择 electron-builder 在当前 runner 重建的文件', () => {
    const rebuilt = 'resources/node_modules/better-sqlite3/build/Release/better_sqlite3.node';
    const files = [
      'resources/node_modules/better-sqlite3/prebuilds/darwin-arm64.node',
      rebuilt,
      'resources/node_modules/better-sqlite3/prebuilds/win32-x64.node',
    ];

    expect(runNativeSelector(files, 'better-sqlite3', 'win32', 'x64')).toBe(
      rebuilt,
    );
  });
});

describe('Microsoft Store 打包配置', () => {
  it('提供独立 AppX 目标和 Actions 预览产物', () => {
    const builderConfig = readRepositoryText(builderConfigPath);
    const packageWorkflow = readRepositoryText(packageWorkflowPath);

    expect(builderConfig).toContain('appx:');
    expect(builderConfig).toContain(
      'artifactName: "DesktopPet-${version}-Windows-${arch}-Store.${ext}"',
    );
    expect(builderConfig).toContain('displayName: DeskTato');
    expect(builderConfig).toContain('identityName: husu.DeskTato');
    expect(builderConfig).toContain(
      'publisher: CN=6E0F686D-434E-4F6F-A421-03253B68F46A',
    );
    expect(builderConfig).toContain('publisherDisplayName: husu');
    expect(builderConfig).toContain('capabilities:\n    - runFullTrust');
    expect(packageWorkflow).toContain('windows-store-x64');
    expect(packageWorkflow).toContain('distribution-win32-store-x64');
    expect(packageWorkflow).toContain('--platform win32-store --arch x64');
    expect(packageWorkflow).toContain('Verify Microsoft Store package identity');
    expect(packageWorkflow).toContain('AppX Identity Name 不匹配');
  });

  it('提供可复现的 AppX 和商店一览图片生成命令', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    expect(packageJson.scripts['assets:store']).toBe(
      'node scripts/generate-store-assets.mjs',
    );
    expect(packageJson.scripts['assets:store:screenshots']).toBe(
      'node scripts/generate-store-screenshots.mjs',
    );
    expect(fs.existsSync(path.join(
      projectRoot,
      'scripts',
      'generate-store-assets.mjs',
    ))).toBe(true);
    expect(fs.existsSync(path.join(
      projectRoot,
      'scripts',
      'generate-store-screenshots.mjs',
    ))).toBe(true);
  });

  it('生成 Microsoft Store 要求尺寸的图片资源', async () => {
    const expectedAssets = new Map([
      ['build/appx/StoreLogo.png', [50, 50]],
      ['build/appx/Square44x44Logo.png', [44, 44]],
      ['build/appx/Square150x150Logo.png', [150, 150]],
      ['build/appx/Wide310x150Logo.png', [310, 150]],
      ['build/store-listing/AppTile300x300.png', [300, 300]],
      ['build/store-listing/01-desktop-companion.png', [1366, 768]],
      ['build/store-listing/02-focus-reminders.png', [1366, 768]],
      ['build/store-listing/03-growth-tasks.png', [1366, 768]],
      ['build/store-listing/04-catch-food-game.png', [1366, 768]],
      ['build/store-listing/05-private-customizable.png', [1366, 768]],
    ]);

    for (const [relativePath, [width, height]] of expectedAssets) {
      const metadata = await sharp(path.join(projectRoot, relativePath)).metadata();
      expect(metadata.width, relativePath).toBe(width);
      expect(metadata.height, relativePath).toBe(height);
      expect(metadata.format, relativePath).toBe('png');
    }
  });
});

function runRelease(arguments_: string[]) {
  return spawnSync(process.execPath, [releaseScript, ...arguments_], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
    },
  });
}

function runNativeSelector(
  files: string[],
  moduleName: string,
  platform: string,
  arch: string,
) {
  const program = [
    `import { selectPackagedNativeModule } from ${JSON.stringify(pathToFileURL(nativeSelectorScript).href)};`,
    'const [files, moduleName, platform, arch] = JSON.parse(process.argv[1]);',
    'process.stdout.write(selectPackagedNativeModule(files, moduleName, platform, arch));',
  ].join('\n');
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', program, JSON.stringify([
      files,
      moduleName,
      platform,
      arch,
    ])],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-release-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeArtifact(root: string, name: string, contents: string): void {
  fs.writeFileSync(path.join(root, name), contents, 'utf8');
}
