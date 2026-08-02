import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
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
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('发布工具', () => {
  it('拒绝与 package.json 不一致的标签', () => {
    const result = runRelease(['verify', '--tag', 'v9.9.9']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('与 package.json v0.1.0 不一致');
  });

  it('为平台产物生成可复核的元数据和 SHA-256', () => {
    const root = createTemporaryDirectory();
    writeArtifact(root, 'DesktopPet-0.1.0-macOS-arm64.dmg', 'dmg');
    writeArtifact(root, 'DesktopPet-0.1.0-macOS-arm64.zip', 'zip');
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
      version: '0.1.0',
      platform: 'darwin',
      arch: 'arm64',
      signed: true,
    });
    expect(metadata.artifacts).toHaveLength(2);
    expect(metadata.artifacts[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      fs.readFileSync(path.join(root, 'checksums-darwin-arm64.sha256'), 'utf8'),
    ).toContain('DesktopPet-0.1.0-macOS-arm64.dmg');
  });

  it('识别 electron-builder 的 Linux x64 目标架构命名', () => {
    const root = createTemporaryDirectory();
    writeArtifact(root, 'DesktopPet-0.1.0-Linux-x86_64.AppImage', 'appimage');
    writeArtifact(root, 'DesktopPet-0.1.0-Linux-amd64.deb', 'deb');
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
      'DesktopPet-0.1.0-Linux-amd64.deb',
      'DesktopPet-0.1.0-Linux-x86_64.AppImage',
    ]);
  });

  it('聚合前重新校验文件哈希并生成安全下载地址', () => {
    const root = createTemporaryDirectory();
    writeArtifact(root, 'DesktopPet-0.1.0-macOS-arm64.dmg', 'dmg');
    writeArtifact(root, 'DesktopPet-0.1.0-macOS-arm64.zip', 'zip');
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
      '--base-url', 'https://example.com/releases/v0.1.0',
      '--release-url', 'https://example.com/releases/v0.1.0',
      '--expected', 'darwin-arm64',
      '--require-signed', 'darwin',
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifest.artifacts).toHaveLength(2);
    expect(manifest.artifacts[0].url).toMatch(/^https:\/\/example\.com\//);

    fs.appendFileSync(
      path.join(root, 'DesktopPet-0.1.0-macOS-arm64.dmg'),
      'tampered',
    );
    const tampered = runRelease([
      'merge',
      '--input', root,
      '--output', manifestPath,
      '--base-url', 'https://example.com/releases/v0.1.0',
      '--release-url', 'https://example.com/releases/v0.1.0',
      '--expected', 'darwin-arm64',
    ]);
    expect(tampered.status).not.toBe(0);
    expect(tampered.stderr).toContain('发布文件与平台元数据不一致');
  });
});

describe('打包原生模块选择', () => {
  it('Linux 校验使用构建配置中固定的主程序名', () => {
    const builderConfig = fs.readFileSync(builderConfigPath, 'utf8');
    const packageWorkflow = fs.readFileSync(packageWorkflowPath, 'utf8');

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
