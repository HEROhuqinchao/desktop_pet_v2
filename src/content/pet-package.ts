import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {
  PetSource,
  PetSyncItem,
  PetSyncReport,
} from '../shared/contracts';

export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const ATLAS_WIDTH = CELL_WIDTH * 8;
export const MAX_SPRITESHEET_BYTES = 64 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 128 * 1024;

const PET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_INPUT_PIXELS = ATLAS_WIDTH * CELL_HEIGHT * 11;

export interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spriteVersionNumber: 1 | 2;
  spritesheetPath: string;
}

export interface PetPackage {
  directory: string;
  manifest: PetManifest;
  spritesheet: string;
  contentHash: string;
  source: PetSource;
}

export class PetPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PetPackageError';
  }
}

export class PetPackageConflictError extends PetPackageError {
  constructor(message: string) {
    super(message);
    this.name = 'PetPackageConflictError';
  }
}

export class PetPackageValidator {
  async validateDirectory(
    directory: string,
    source: PetSource = 'library',
  ): Promise<PetPackage> {
    const root = path.resolve(directory);
    const rootStats = await safeLstat(root, `宠物目录不存在：${root}`);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new PetPackageError(`宠物目录不存在：${root}`);
    }

    const manifestPath = path.join(root, 'pet.json');
    const manifestStats = await safeLstat(
      manifestPath,
      '缺少普通文件 pet.json',
    );
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
      throw new PetPackageError('缺少普通文件 pet.json');
    }
    if (manifestStats.size > MAX_MANIFEST_BYTES) {
      throw new PetPackageError('pet.json 超过 128 KB 限制');
    }

    let manifestBytes: Buffer;
    let payload: unknown;
    try {
      manifestBytes = await fs.readFile(manifestPath);
      payload = JSON.parse(manifestBytes.toString('utf8'));
    } catch (error) {
      throw new PetPackageError(`pet.json 无法读取：${errorMessage(error)}`);
    }
    const manifest = parseManifest(payload);
    const spritesheet = path.join(root, manifest.spritesheetPath);
    const imageStats = await safeLstat(
      spritesheet,
      'spritesheetPath 必须指向普通图片文件',
    );
    if (!imageStats.isFile() || imageStats.isSymbolicLink()) {
      throw new PetPackageError(
        'spritesheetPath 必须指向普通图片文件',
      );
    }
    if (imageStats.size > MAX_SPRITESHEET_BYTES) {
      throw new PetPackageError('图集超过 64 MB 限制');
    }
    if (path.dirname(path.resolve(spritesheet)) !== root) {
      throw new PetPackageError('spritesheetPath 超出宠物目录');
    }

    let imageBytes: Buffer;
    try {
      imageBytes = await fs.readFile(spritesheet);
    } catch (error) {
      throw new PetPackageError(`图集无法读取：${errorMessage(error)}`);
    }
    await validateSpritesheet(imageBytes, manifest.spriteVersionNumber);

    const digest = crypto.createHash('sha256');
    digest.update(manifestBytes);
    digest.update(imageBytes);
    return {
      directory: root,
      manifest,
      spritesheet,
      contentHash: digest.digest('hex'),
      source,
    };
  }

  static cellIsUsed(version: 1 | 2, row: number, column: number): boolean {
    if (row === 0) {
      return column <= (version === 2 ? 6 : 5);
    }
    if ([1, 2, 5].includes(row)) {
      return column <= 7;
    }
    if (row === 3) {
      return column <= 3;
    }
    if (row === 4) {
      return column <= 4;
    }
    if ([6, 7, 8].includes(row)) {
      return column <= 5;
    }
    if ([9, 10].includes(row)) {
      return version === 2 && column <= 7;
    }
    return false;
  }
}

export function emptySyncReport(): PetSyncReport {
  return {
    imported: 0,
    unchanged: 0,
    conflicts: 0,
    invalid: 0,
    items: [],
  };
}

export function addSyncItem(
  report: PetSyncReport,
  item: PetSyncItem,
): void {
  report.items.push(item);
  if (item.status === 'imported' || item.status === 'exported') {
    report.imported += 1;
  } else if (item.status === 'unchanged') {
    report.unchanged += 1;
  } else if (item.status === 'conflict') {
    report.conflicts += 1;
  } else {
    report.invalid += 1;
  }
}

function parseManifest(payload: unknown): PetManifest {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PetPackageError('pet.json 顶层必须是对象');
  }
  const source = payload as Record<string, unknown>;
  if (typeof source.id !== 'string') {
    throw new PetPackageError('id 必须是字符串');
  }
  const id = source.id.trim();
  if (!PET_ID_PATTERN.test(id)) {
    throw new PetPackageError(
      'id 只能包含 ASCII 字母、数字、连字符和下划线，长度 1-64',
    );
  }
  if (typeof source.displayName !== 'string') {
    throw new PetPackageError('displayName 必须是字符串');
  }
  const displayName = source.displayName.trim();
  if (!displayName) {
    throw new PetPackageError('displayName 不能为空');
  }
  if (typeof source.description !== 'string') {
    throw new PetPackageError('description 必须是字符串');
  }
  if (
    source.spriteVersionNumber !== 1
    && source.spriteVersionNumber !== 2
  ) {
    throw new PetPackageError('spriteVersionNumber 只支持 1 或 2');
  }
  if (typeof source.spritesheetPath !== 'string') {
    throw new PetPackageError('spritesheetPath 必须是字符串');
  }
  const spritesheetPath = source.spritesheetPath.trim();
  if (
    !spritesheetPath
    || path.basename(spritesheetPath) !== spritesheetPath
    || spritesheetPath.includes('/')
    || spritesheetPath.includes('\\')
  ) {
    throw new PetPackageError(
      'spritesheetPath 必须是目录内的单个文件名',
    );
  }
  if (!['.png', '.webp'].includes(path.extname(spritesheetPath).toLowerCase())) {
    throw new PetPackageError('spritesheetPath 只支持 PNG 或 WebP');
  }
  return {
    id,
    displayName: displayName.slice(0, 80),
    description: source.description.trim().slice(0, 500),
    spriteVersionNumber: source.spriteVersionNumber,
    spritesheetPath,
  };
}

async function validateSpritesheet(
  imageBytes: Buffer,
  version: 1 | 2,
): Promise<void> {
  try {
    const image = sharp(imageBytes, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !['png', 'webp'].includes(metadata.format)) {
      throw new PetPackageError('图集不是可解码的 PNG 或 WebP');
    }
    const expectedHeight = CELL_HEIGHT * (version === 2 ? 11 : 9);
    if (
      metadata.width !== ATLAS_WIDTH
      || metadata.height !== expectedHeight
    ) {
      throw new PetPackageError(
        `图集尺寸应为 ${ATLAS_WIDTH}x${expectedHeight}，实际为 `
        + `${metadata.width ?? 0}x${metadata.height ?? 0}`,
      );
    }
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      info.width !== ATLAS_WIDTH
      || info.height !== expectedHeight
      || info.channels !== 4
    ) {
      throw new PetPackageError('图集无法解码为 RGBA 像素');
    }
    validateCells(data, version, info.width, info.channels);
  } catch (error) {
    if (error instanceof PetPackageError) {
      throw error;
    }
    throw new PetPackageError(`图集无法读取：${errorMessage(error)}`);
  }
}

function validateCells(
  pixels: Buffer,
  version: 1 | 2,
  width: number,
  channels: number,
): void {
  const rows = version === 2 ? 11 : 9;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const visible = cellHasVisiblePixel(
        pixels,
        width,
        channels,
        row,
        column,
      );
      const used = PetPackageValidator.cellIsUsed(version, row, column);
      if (used && !visible) {
        throw new PetPackageError(
          `必需单元格 row=${row}, col=${column} 为空`,
        );
      }
      if (!used && visible) {
        throw new PetPackageError(
          `未使用单元格 row=${row}, col=${column} 必须全透明`,
        );
      }
    }
  }
}

function cellHasVisiblePixel(
  pixels: Buffer,
  width: number,
  channels: number,
  row: number,
  column: number,
): boolean {
  const startX = column * CELL_WIDTH;
  const startY = row * CELL_HEIGHT;
  for (let y = startY; y < startY + CELL_HEIGHT; y += 1) {
    for (let x = startX; x < startX + CELL_WIDTH; x += 1) {
      if (pixels[(y * width + x) * channels + 3] > 0) {
        return true;
      }
    }
  }
  return false;
}

async function safeLstat(
  target: string,
  message: string,
): Promise<Awaited<ReturnType<typeof fs.lstat>>> {
  try {
    return await fs.lstat(target);
  } catch {
    throw new PetPackageError(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
