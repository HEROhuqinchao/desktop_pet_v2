import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = path.resolve(import.meta.dirname, '..');
const releaseScript = path.join(projectRoot, 'scripts', 'release.mjs');
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

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-release-'));
  temporaryDirectories.push(directory);
  return directory;
}

function writeArtifact(root: string, name: string, contents: string): void {
  fs.writeFileSync(path.join(root, name), contents, 'utf8');
}
