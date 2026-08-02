import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import type {
  ContentPackManifest,
  ContentPackRecord,
} from '../shared/contracts';

const BANNED_SUFFIXES = new Set([
  '.py',
  '.pyc',
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
]);
const ALLOWED_SUFFIXES = new Set([
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.wav',
  '.mp3',
  '.ogg',
  '.txt',
  '.md',
]);
const PACK_ID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;
const MAX_FILES = 5_000;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;

export interface ContentPackStore {
  listContentPacks(): ContentPackRecord[];
  saveContentPack(manifest: ContentPackManifest, installedAt?: Date): void;
  setContentPackEnabled(packId: string, enabled: boolean): boolean;
  deleteContentPack(packId: string): boolean;
}

export class ContentPackValidationError extends Error {
  override name = 'ContentPackValidationError';
}

export class ContentPackValidator {
  constructor(private readonly appVersion = '0.1.0') {}

  validateArchive(archivePath: string): ContentPackManifest {
    let archive: AdmZip;
    try {
      archive = new AdmZip(archivePath);
    } catch (error) {
      throw new ContentPackValidationError(
        `内容包不是有效的 ZIP 文件：${errorMessage(error)}`,
      );
    }
    const entries = archive.getEntries();
    if (entries.length > MAX_FILES) {
      throw new ContentPackValidationError('内容包文件数量超出限制');
    }
    const names = new Set<string>();
    let total = 0;
    let manifestData: Buffer | null = null;
    for (const entry of entries) {
      const normalizedName = validateArchivePath(entry.entryName);
      if (names.has(normalizedName)) {
        throw new ContentPackValidationError('内容包包含重复路径');
      }
      names.add(normalizedName);
      if (entry.header.encrypted) {
        throw new ContentPackValidationError('内容包不能使用加密条目');
      }
      if (isSymbolicLink(entry.attr)) {
        throw new ContentPackValidationError('内容包不能包含符号链接');
      }
      if (entry.isDirectory) {
        continue;
      }
      validateSuffix(path.posix.extname(normalizedName));
      if (entry.header.size > MAX_SINGLE_FILE_BYTES) {
        throw new ContentPackValidationError('内容包包含过大的单个文件');
      }
      total += entry.header.size;
      if (total > MAX_UNCOMPRESSED_BYTES) {
        throw new ContentPackValidationError('内容包解压后体积超出限制');
      }
      if (normalizedName === 'manifest.json') {
        manifestData = entry.getData();
      }
    }
    if (!manifestData) {
      throw new ContentPackValidationError('内容包缺少 manifest.json');
    }
    return this.parseManifest(manifestData);
  }

  validateDirectory(rootPath: string): ContentPackManifest {
    const root = fs.realpathSync(rootPath);
    const entries = walkDirectory(root);
    if (entries.length > MAX_FILES) {
      throw new ContentPackValidationError('内容包文件数量超出限制');
    }
    let total = 0;
    for (const entry of entries) {
      if (entry.symbolicLink) {
        throw new ContentPackValidationError('内容包不能包含符号链接');
      }
      if (entry.directory) {
        continue;
      }
      validateSuffix(path.extname(entry.absolutePath));
      if (entry.size > MAX_SINGLE_FILE_BYTES) {
        throw new ContentPackValidationError('内容包包含过大的单个文件');
      }
      total += entry.size;
      if (total > MAX_UNCOMPRESSED_BYTES) {
        throw new ContentPackValidationError('内容包总体积超出限制');
      }
      if (path.extname(entry.absolutePath).toLowerCase() === '.json') {
        try {
          JSON.parse(fs.readFileSync(entry.absolutePath, 'utf8'));
        } catch (error) {
          throw new ContentPackValidationError(
            `JSON 文件无效：${path.relative(root, entry.absolutePath)}；`
            + errorMessage(error),
          );
        }
      }
    }
    const manifestPath = path.join(root, 'manifest.json');
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
      throw new ContentPackValidationError('内容包缺少 manifest.json');
    }
    return this.parseManifest(fs.readFileSync(manifestPath));
  }

  private parseManifest(raw: Buffer): ContentPackManifest {
    let value: unknown;
    try {
      value = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ContentPackValidationError(
        '内容包清单不是有效的 UTF-8 JSON',
      );
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ContentPackValidationError('内容包清单顶层必须是对象');
    }
    const source = value as Record<string, unknown>;
    const packId = String(source.id ?? '');
    const name = String(source.name ?? '').trim();
    const version = String(source.version ?? '').trim();
    const formatVersion = Number(source.format_version ?? 0);
    const appMinVersion = String(source.app_min_version ?? '0.1.0');
    if (!PACK_ID_PATTERN.test(packId)) {
      throw new ContentPackValidationError('内容包 ID 格式无效');
    }
    if (!name || name.length > 80) {
      throw new ContentPackValidationError('内容包名称无效');
    }
    if (!version || version.length > 30) {
      throw new ContentPackValidationError('内容包版本无效');
    }
    if (formatVersion !== 1) {
      throw new ContentPackValidationError('内容包格式版本不兼容');
    }
    if (compareVersions(appMinVersion, this.appVersion) > 0) {
      throw new ContentPackValidationError('内容包需要更高版本的桌面宠物');
    }
    return {
      packId,
      name,
      version,
      formatVersion: 1,
      appMinVersion,
      description: String(source.description ?? '').slice(0, 300),
    };
  }
}

export class ContentPackManager {
  private readonly validator: ContentPackValidator;

  constructor(
    private readonly root: string,
    private readonly store: ContentPackStore,
    validator?: ContentPackValidator,
  ) {
    this.validator = validator ?? new ContentPackValidator();
    fs.mkdirSync(root, { recursive: true });
  }

  installArchive(archivePath: string): ContentPackManifest {
    const manifest = this.validator.validateArchive(archivePath);
    const target = this.packPath(manifest.packId);
    if (
      fs.existsSync(target)
      || this.store.listContentPacks().some(
        (item) => item.packId === manifest.packId,
      )
    ) {
      throw new ContentPackValidationError('同名内容包已经安装');
    }
    const temporary = path.join(this.root, `.install-${randomUUID()}`);
    fs.mkdirSync(temporary);
    let moved = false;
    try {
      const archive = new AdmZip(archivePath);
      for (const entry of archive.getEntries()) {
        const normalizedName = validateArchivePath(entry.entryName);
        if (entry.isDirectory) {
          continue;
        }
        const destination = safeChildPath(temporary, normalizedName);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const data = entry.getData();
        if (
          data.length !== entry.header.size
          || data.length > MAX_SINGLE_FILE_BYTES
        ) {
          throw new ContentPackValidationError('内容包条目体积校验失败');
        }
        fs.writeFileSync(destination, data, { flag: 'wx' });
      }
      const installed = this.validator.validateDirectory(temporary);
      if (installed.packId !== manifest.packId) {
        throw new ContentPackValidationError('内容包清单在解压后发生变化');
      }
      fs.renameSync(temporary, target);
      moved = true;
      this.store.saveContentPack(manifest);
      return manifest;
    } catch (error) {
      fs.rmSync(moved ? target : temporary, { recursive: true, force: true });
      throw error;
    }
  }

  list(): ContentPackRecord[] {
    return this.store.listContentPacks();
  }

  setEnabled(packId: string, enabled: boolean): boolean {
    const target = this.packPath(packId);
    return fs.existsSync(target)
      && this.store.setContentPackEnabled(packId, enabled);
  }

  uninstall(packId: string): boolean {
    const target = this.packPath(packId);
    if (!fs.existsSync(target)) {
      return false;
    }
    const temporary = path.join(this.root, `.remove-${randomUUID()}`);
    fs.renameSync(target, temporary);
    try {
      const changed = this.store.deleteContentPack(packId);
      if (!changed) {
        fs.renameSync(temporary, target);
        return false;
      }
      fs.rmSync(temporary, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (fs.existsSync(temporary)) {
        fs.renameSync(temporary, target);
      }
      throw error;
    }
  }

  dialogueLines(): string[] {
    const lines: string[] = [];
    for (const pack of this.list()) {
      if (!pack.enabled) {
        continue;
      }
      const source = path.join(this.packPath(pack.packId), 'dialogues.json');
      try {
        collectDialogueLines(
          JSON.parse(fs.readFileSync(source, 'utf8')),
          lines,
        );
      } catch {
        continue;
      }
      if (lines.length >= 200) {
        break;
      }
    }
    return lines.slice(0, 200);
  }

  private packPath(packId: string): string {
    if (!PACK_ID_PATTERN.test(packId)) {
      throw new ContentPackValidationError('内容包 ID 格式无效');
    }
    return safeChildPath(this.root, packId);
  }
}

function validateArchivePath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/').filter((item) => item !== '');
  if (
    normalized.startsWith('/')
    || parts.length === 0
    || parts.includes('..')
    || parts[0].includes(':')
  ) {
    throw new ContentPackValidationError('内容包包含不安全路径');
  }
  return parts.join('/');
}

function safeChildPath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relativePath);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ContentPackValidationError('内容包路径越界');
  }
  return target;
}

function validateSuffix(suffix: string): void {
  const normalized = suffix.toLowerCase();
  if (BANNED_SUFFIXES.has(normalized)) {
    throw new ContentPackValidationError(`内容包禁止包含 ${normalized} 文件`);
  }
  if (!ALLOWED_SUFFIXES.has(normalized)) {
    throw new ContentPackValidationError(
      `内容包文件类型不受支持：${normalized || '无扩展名'}`,
    );
  }
}

function isSymbolicLink(attributes: number): boolean {
  const unixMode = attributes >>> 16;
  return (unixMode & 0o170000) === 0o120000;
}

function walkDirectory(root: string): Array<{
  absolutePath: string;
  directory: boolean;
  symbolicLink: boolean;
  size: number;
}> {
  const result: Array<{
    absolutePath: string;
    directory: boolean;
    symbolicLink: boolean;
    size: number;
  }> = [];
  const visit = (directory: string) => {
    for (const name of fs.readdirSync(directory)) {
      const absolutePath = path.join(directory, name);
      const stats = fs.lstatSync(absolutePath);
      const item = {
        absolutePath,
        directory: stats.isDirectory(),
        symbolicLink: stats.isSymbolicLink(),
        size: stats.size,
      };
      result.push(item);
      if (item.directory && !item.symbolicLink) {
        visit(absolutePath);
      }
    }
  };
  visit(root);
  return result;
}

function collectDialogueLines(value: unknown, lines: string[]): void {
  if (lines.length >= 200) {
    return;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replaceAll(/\s+/g, ' ');
    if (normalized.length >= 1 && normalized.length <= 120) {
      lines.push(normalized);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDialogueLines(item, lines);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectDialogueLines(item, lines);
  }
}

function compareVersions(left: string, right: string): number {
  const normalize = (value: string) => value
    .split('.')
    .slice(0, 3)
    .map((item) => Number(item.replaceAll(/\D/g, '') || 0));
  const leftParts = [...normalize(left), 0, 0, 0];
  const rightParts = [...normalize(right), 0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
