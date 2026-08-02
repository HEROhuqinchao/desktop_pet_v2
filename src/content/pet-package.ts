import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type {
  PetActionDefinition,
  PetActionManifest,
  PetBehaviorState,
  PetSource,
  PetSyncItem,
  PetSyncReport,
} from '../shared/contracts';
import { PET_BEHAVIOR_STATES } from '../shared/contracts';

export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const ATLAS_WIDTH = CELL_WIDTH * 8;
export const MAX_SPRITESHEET_BYTES = 64 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 128 * 1024;
export const ACTION_MANIFEST_FILE = 'desktop-pet-actions.json';
export const MAX_ACTION_MANIFEST_BYTES = 512 * 1024;
export const MAX_ACTION_ATLAS_BYTES = 64 * 1024 * 1024;

const PET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ACTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const MAX_INPUT_PIXELS = ATLAS_WIDTH * CELL_HEIGHT * 11;
const MAX_ACTION_COLUMNS = 16;
const MAX_ACTION_ROWS = 64;
const MAX_ACTION_INPUT_PIXELS =
  CELL_WIDTH * CELL_HEIGHT * MAX_ACTION_COLUMNS * MAX_ACTION_ROWS;

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
  actionPack: PetActionPack | null;
  contentHash: string;
  source: PetSource;
}

export interface PetActionPack {
  manifestPath: string;
  manifest: PetActionManifest;
  atlas: string;
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
    const validatedActionPack = await validateActionPack(root);

    const digest = crypto.createHash('sha256');
    digest.update(manifestBytes);
    digest.update(imageBytes);
    if (validatedActionPack) {
      digest.update(validatedActionPack.manifestBytes);
      digest.update(validatedActionPack.atlasBytes);
    }
    return {
      directory: root,
      manifest,
      spritesheet,
      actionPack: validatedActionPack
        ? {
            manifestPath: validatedActionPack.manifestPath,
            manifest: validatedActionPack.manifest,
            atlas: validatedActionPack.atlas,
          }
        : null,
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

interface ValidatedActionPack extends PetActionPack {
  manifestBytes: Buffer;
  atlasBytes: Buffer;
}

export async function validateActionPack(
  root: string,
): Promise<ValidatedActionPack | null> {
  const manifestPath = path.join(root, ACTION_MANIFEST_FILE);
  let manifestStats: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    manifestStats = await fs.lstat(manifestPath);
  } catch {
    return null;
  }
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new PetPackageError(
      `${ACTION_MANIFEST_FILE} 必须是普通文件`,
    );
  }
  if (manifestStats.size > MAX_ACTION_MANIFEST_BYTES) {
    throw new PetPackageError(
      `${ACTION_MANIFEST_FILE} 超过 512 KB 限制`,
    );
  }

  let manifestBytes: Buffer;
  let payload: unknown;
  try {
    manifestBytes = await fs.readFile(manifestPath);
    payload = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new PetPackageError(
      `${ACTION_MANIFEST_FILE} 无法读取：${errorMessage(error)}`,
    );
  }
  const manifest = parseActionManifest(payload);
  const atlas = path.join(root, manifest.atlasPath);
  const atlasStats = await safeLstat(
    atlas,
    '扩展动作 atlasPath 必须指向普通图片文件',
  );
  if (!atlasStats.isFile() || atlasStats.isSymbolicLink()) {
    throw new PetPackageError(
      '扩展动作 atlasPath 必须指向普通图片文件',
    );
  }
  if (atlasStats.size > MAX_ACTION_ATLAS_BYTES) {
    throw new PetPackageError('扩展动作图集超过 64 MB 限制');
  }
  let atlasBytes: Buffer;
  try {
    atlasBytes = await fs.readFile(atlas);
  } catch (error) {
    throw new PetPackageError(
      `扩展动作图集无法读取：${errorMessage(error)}`,
    );
  }
  await validateActionAtlas(atlasBytes, manifest);
  return {
    manifestPath,
    manifest,
    manifestBytes,
    atlas,
    atlasBytes,
  };
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

function parseActionManifest(payload: unknown): PetActionManifest {
  const source = objectValue(
    payload,
    `${ACTION_MANIFEST_FILE} 顶层必须是对象`,
  );
  if (source.formatVersion !== 1) {
    throw new PetPackageError('扩展动作 formatVersion 只支持 1');
  }
  if (
    source.cellWidth !== CELL_WIDTH
    || source.cellHeight !== CELL_HEIGHT
  ) {
    throw new PetPackageError(
      `扩展动作单元格尺寸必须为 ${CELL_WIDTH}x${CELL_HEIGHT}`,
    );
  }
  const atlasPath = plainFileName(
    source.atlasPath,
    '扩展动作 atlasPath',
    ['.png', '.webp'],
  );
  if (atlasPath === ACTION_MANIFEST_FILE) {
    throw new PetPackageError('扩展动作 atlasPath 不能指向清单本身');
  }
  const columns = boundedInteger(
    source.columns,
    '扩展动作 columns',
    1,
    MAX_ACTION_COLUMNS,
  );
  const rows = boundedInteger(
    source.rows,
    '扩展动作 rows',
    1,
    MAX_ACTION_ROWS,
  );

  const animationSource = objectValue(
    source.animations,
    '扩展动作 animations 必须是对象',
  );
  const animationEntries = Object.entries(animationSource);
  if (animationEntries.length === 0) {
    throw new PetPackageError('扩展动作 animations 不能为空');
  }
  const animations: Record<string, PetActionDefinition> = {};
  for (const [name, rawDefinition] of animationEntries) {
    if (!ACTION_ID_PATTERN.test(name)) {
      throw new PetPackageError(
        `扩展动作名称 ${name} 只能使用小写字母、数字和连字符`,
      );
    }
    const definition = objectValue(
      rawDefinition,
      `扩展动作 ${name} 必须是对象`,
    );
    if (typeof definition.loop !== 'boolean') {
      throw new PetPackageError(`扩展动作 ${name}.loop 必须是布尔值`);
    }
    if (!Array.isArray(definition.frames)) {
      throw new PetPackageError(`扩展动作 ${name}.frames 必须是数组`);
    }
    if (definition.frames.length < 1 || definition.frames.length > 64) {
      throw new PetPackageError(
        `扩展动作 ${name}.frames 数量必须为 1-64`,
      );
    }
    const frames = definition.frames.map((rawFrame, index) => {
      const frame = objectValue(
        rawFrame,
        `扩展动作 ${name}.frames[${index}] 必须是对象`,
      );
      return {
        row: boundedInteger(
          frame.row,
          `扩展动作 ${name}.frames[${index}].row`,
          0,
          rows - 1,
        ),
        column: boundedInteger(
          frame.column,
          `扩展动作 ${name}.frames[${index}].column`,
          0,
          columns - 1,
        ),
        durationMs: boundedInteger(
          frame.durationMs,
          `扩展动作 ${name}.frames[${index}].durationMs`,
          16,
          10_000,
        ),
      };
    });
    animations[name] = { loop: definition.loop, frames };
  }

  const rawStateMap = objectValue(
    source.stateMap,
    '扩展动作 stateMap 必须是对象',
  );
  const stateMap: Partial<Record<PetBehaviorState, string>> = {};
  for (const [state, rawAction] of Object.entries(rawStateMap)) {
    if (!PET_BEHAVIOR_STATES.includes(state as PetBehaviorState)) {
      throw new PetPackageError(`扩展动作 stateMap 包含未知状态 ${state}`);
    }
    if (typeof rawAction !== 'string' || !animations[rawAction]) {
      throw new PetPackageError(
        `扩展动作 stateMap.${state} 必须引用已定义动作`,
      );
    }
    stateMap[state as PetBehaviorState] = rawAction;
  }

  return {
    formatVersion: 1,
    cellWidth: CELL_WIDTH,
    cellHeight: CELL_HEIGHT,
    atlasPath,
    columns,
    rows,
    animations,
    stateMap,
  };
}

async function validateActionAtlas(
  imageBytes: Buffer,
  manifest: PetActionManifest,
): Promise<void> {
  try {
    const image = sharp(imageBytes, {
      failOn: 'error',
      limitInputPixels: MAX_ACTION_INPUT_PIXELS,
    });
    const metadata = await image.metadata();
    if (!metadata.format || !['png', 'webp'].includes(metadata.format)) {
      throw new PetPackageError(
        '扩展动作图集不是可解码的 PNG 或 WebP',
      );
    }
    const expectedWidth = manifest.columns * CELL_WIDTH;
    const expectedHeight = manifest.rows * CELL_HEIGHT;
    if (
      metadata.width !== expectedWidth
      || metadata.height !== expectedHeight
    ) {
      throw new PetPackageError(
        `扩展动作图集尺寸应为 ${expectedWidth}x${expectedHeight}，实际为 `
        + `${metadata.width ?? 0}x${metadata.height ?? 0}`,
      );
    }
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const usedCells = new Set(
      Object.values(manifest.animations).flatMap((definition) =>
        definition.frames.map((frame) => `${frame.row}:${frame.column}`),
      ),
    );
    for (let row = 0; row < manifest.rows; row += 1) {
      for (let column = 0; column < manifest.columns; column += 1) {
        const visible = cellHasVisiblePixel(
          data,
          info.width,
          info.channels,
          row,
          column,
        );
        const used = usedCells.has(`${row}:${column}`);
        if (used && !visible) {
          throw new PetPackageError(
            `扩展动作必需单元格 row=${row}, col=${column} 为空`,
          );
        }
        if (!used && visible) {
          throw new PetPackageError(
            `扩展动作未使用单元格 row=${row}, col=${column} 必须全透明`,
          );
        }
      }
    }
  } catch (error) {
    if (error instanceof PetPackageError) {
      throw error;
    }
    throw new PetPackageError(
      `扩展动作图集无法读取：${errorMessage(error)}`,
    );
  }
}

function objectValue(
  value: unknown,
  message: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PetPackageError(message);
  }
  return value as Record<string, unknown>;
}

function boundedInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < minimum
    || value > maximum
  ) {
    throw new PetPackageError(`${name} 必须是 ${minimum}-${maximum} 的整数`);
  }
  return value;
}

function plainFileName(
  value: unknown,
  name: string,
  extensions: readonly string[],
): string {
  if (typeof value !== 'string') {
    throw new PetPackageError(`${name} 必须是字符串`);
  }
  const normalized = value.trim();
  if (
    !normalized
    || path.basename(normalized) !== normalized
    || normalized.includes('/')
    || normalized.includes('\\')
  ) {
    throw new PetPackageError(`${name} 必须是目录内的单个文件名`);
  }
  if (!extensions.includes(path.extname(normalized).toLowerCase())) {
    throw new PetPackageError(
      `${name} 只支持 ${extensions.join(' 或 ')}`,
    );
  }
  return normalized;
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
