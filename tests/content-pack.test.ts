import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ContentPackManager,
  ContentPackValidationError,
  ContentPackValidator,
} from '../src/content/content-pack';
import { AssistantDatabase } from '../src/persistence/assistant-database';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('ContentPackManager', () => {
  it('安装、停用、启用和卸载纯数据内容包', () => {
    const root = createTemporaryDirectory();
    const archive = path.join(root, 'gentle-night.zip');
    createArchive(archive, {
      'manifest.json': JSON.stringify({
        id: 'gentle-night',
        name: '温柔夜晚',
        version: '1.0.0',
        format_version: 1,
        app_min_version: '0.1.0',
      }),
      'dialogues.json': JSON.stringify({ night: ['夜深啦，今天辛苦你了。'] }),
    });
    const database = new AssistantDatabase(':memory:');
    database.initialize();
    const manager = new ContentPackManager(
      path.join(root, 'packs'),
      database,
    );

    expect(manager.installArchive(archive).packId).toBe('gentle-night');
    expect(manager.dialogueLines()).toContain('夜深啦，今天辛苦你了。');
    expect(manager.setEnabled('gentle-night', false)).toBe(true);
    expect(manager.dialogueLines()).toEqual([]);
    expect(manager.setEnabled('gentle-night', true)).toBe(true);
    expect(manager.uninstall('gentle-night')).toBe(true);
    expect(manager.list()).toEqual([]);
    expect(fs.existsSync(path.join(root, 'packs', 'gentle-night'))).toBe(false);
    database.close();
  });

  it('拒绝可执行文件和需要更高应用版本的内容包', () => {
    const root = createTemporaryDirectory();
    const executable = path.join(root, 'executable.zip');
    createArchive(executable, {
      'manifest.json': manifest('safe-pack', '0.1.0'),
      'run.ps1': 'Write-Host bad',
    });
    const future = path.join(root, 'future.zip');
    createArchive(future, {
      'manifest.json': manifest('future-pack', '9.0.0'),
    });
    const validator = new ContentPackValidator('0.1.0');

    expect(() => validator.validateArchive(executable)).toThrow(
      ContentPackValidationError,
    );
    expect(() => validator.validateArchive(future)).toThrow(
      '内容包需要更高版本的桌面宠物',
    );
  });

  it('拒绝目录中的符号链接和无效 JSON', () => {
    const root = createTemporaryDirectory();
    const pack = path.join(root, 'unsafe-pack');
    fs.mkdirSync(pack);
    fs.writeFileSync(
      path.join(pack, 'manifest.json'),
      manifest('unsafe-pack', '0.1.0'),
    );
    fs.writeFileSync(path.join(root, 'outside.txt'), 'outside');
    fs.symlinkSync(path.join(root, 'outside.txt'), path.join(pack, 'link.txt'));
    const validator = new ContentPackValidator('0.1.0');

    expect(() => validator.validateDirectory(pack)).toThrow(
      '内容包不能包含符号链接',
    );
    fs.unlinkSync(path.join(pack, 'link.txt'));
    fs.writeFileSync(path.join(pack, 'dialogues.json'), '{bad');
    expect(() => validator.validateDirectory(pack)).toThrow(
      'JSON 文件无效',
    );
  });
});

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-pet-pack-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createArchive(
  archivePath: string,
  entries: Record<string, string>,
): void {
  const archive = new AdmZip();
  for (const [entryName, content] of Object.entries(entries)) {
    archive.addFile(entryName, Buffer.from(content));
  }
  archive.writeZip(archivePath);
}

function manifest(packId: string, appMinVersion: string): string {
  return JSON.stringify({
    id: packId,
    name: '安全内容包',
    version: '1.0.0',
    format_version: 1,
    app_min_version: appMinVersion,
  });
}
