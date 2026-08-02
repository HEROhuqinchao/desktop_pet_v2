import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  PetSource,
  PetSyncReport,
} from '../shared/contracts';
import {
  PetPackageConflictError,
  PetPackageError,
  PetPackageValidator,
  addSyncItem,
  emptySyncReport,
  type PetPackage,
} from './pet-package';

const SOURCE_MARKER = '.desktop-pet-source';

export class PetLibrary {
  constructor(
    readonly root: string,
    readonly validator = new PetPackageValidator(),
  ) {}

  async listPackages(): Promise<PetPackage[]> {
    const directories = await childDirectories(this.root);
    const packages: PetPackage[] = [];
    for (const directory of directories) {
      if (path.basename(directory).startsWith('.')) {
        continue;
      }
      try {
        packages.push(
          await this.validator.validateDirectory(
            directory,
            await readSource(directory),
          ),
        );
      } catch {
        // 无效本地包不会进入可选列表，但保留在磁盘等待用户处理。
      }
    }
    return packages;
  }

  async find(petId: string): Promise<PetPackage | null> {
    const target = path.join(this.root, petId);
    try {
      return await this.validator.validateDirectory(
        target,
        await readSource(target),
      );
    } catch {
      return null;
    }
  }

  async importFolder(
    source: string,
    sourceKind: PetSource = 'library',
  ): Promise<PetPackage> {
    const sourcePackage = await this.validator.validateDirectory(
      source,
      sourceKind,
    );
    await fs.mkdir(this.root, { recursive: true });
    const target = path.join(this.root, sourcePackage.manifest.id);
    if (await pathExists(target)) {
      const existing = await this.validator.validateDirectory(
        target,
        await readSource(target),
      );
      if (existing.contentHash === sourcePackage.contentHash) {
        return existing;
      }
      throw new PetPackageConflictError(
        `宠物 ID ${sourcePackage.manifest.id} 已存在且内容不同，未覆盖`,
      );
    }
    await this.copyPackage(sourcePackage, target, sourceKind, true);
    return this.validator.validateDirectory(target, sourceKind);
  }

  async syncFromCodex(codexHomeOverride = ''): Promise<PetSyncReport> {
    return this.syncFromDirectory(
      path.join(resolveCodexHome(codexHomeOverride), 'pets'),
    );
  }

  async syncFromDirectory(sourceRoot: string): Promise<PetSyncReport> {
    const report = emptySyncReport();
    for (const directory of await childDirectories(sourceRoot)) {
      let sourcePackage: PetPackage;
      try {
        sourcePackage = await this.validator.validateDirectory(
          directory,
          'codex',
        );
      } catch (error) {
        addSyncItem(report, {
          petId: path.basename(directory),
          status: 'invalid',
          detail: errorMessage(error),
        });
        continue;
      }
      const target = path.join(this.root, sourcePackage.manifest.id);
      if (await pathExists(target)) {
        try {
          const existing = await this.validator.validateDirectory(
            target,
            await readSource(target),
          );
          addSyncItem(
            report,
            existing.contentHash === sourcePackage.contentHash
              ? {
                  petId: sourcePackage.manifest.id,
                  status: 'unchanged',
                  detail: '内容一致',
                }
              : {
                  petId: sourcePackage.manifest.id,
                  status: 'conflict',
                  detail: '本地存在同 ID 的不同版本，未覆盖',
                },
          );
        } catch (error) {
          addSyncItem(report, {
            petId: sourcePackage.manifest.id,
            status: 'invalid',
            detail: `本地目标无效，未覆盖：${errorMessage(error)}`,
          });
        }
        continue;
      }
      try {
        await fs.mkdir(this.root, { recursive: true });
        await this.copyPackage(sourcePackage, target, 'codex', true);
        addSyncItem(report, {
          petId: sourcePackage.manifest.id,
          status: 'imported',
          detail: '已从 Codex 同步',
        });
      } catch (error) {
        addSyncItem(report, {
          petId: sourcePackage.manifest.id,
          status: 'invalid',
          detail: errorMessage(error),
        });
      }
    }
    return report;
  }

  async exportPackage(
    sourcePackage: PetPackage,
    codexHomeOverride = '',
  ): Promise<PetSyncReport> {
    const report = emptySyncReport();
    const targetRoot = path.join(
      resolveCodexHome(codexHomeOverride),
      'pets',
    );
    const target = path.join(targetRoot, sourcePackage.manifest.id);
    await fs.mkdir(targetRoot, { recursive: true });
    if (await pathExists(target)) {
      try {
        const existing = await this.validator.validateDirectory(
          target,
          'codex',
        );
        addSyncItem(
          report,
          existing.contentHash === sourcePackage.contentHash
            ? {
                petId: sourcePackage.manifest.id,
                status: 'unchanged',
                detail: 'Codex 中已存在相同版本',
              }
            : {
                petId: sourcePackage.manifest.id,
                status: 'conflict',
                detail: 'Codex 中存在同 ID 的不同版本，未覆盖',
              },
        );
      } catch (error) {
        addSyncItem(report, {
          petId: sourcePackage.manifest.id,
          status: 'invalid',
          detail: `Codex 目标目录无效，未覆盖：${errorMessage(error)}`,
        });
      }
      return report;
    }
    await this.copyPackage(sourcePackage, target, 'codex', false);
    addSyncItem(report, {
      petId: sourcePackage.manifest.id,
      status: 'exported',
      detail: '已导出到 Codex',
    });
    return report;
  }

  private async copyPackage(
    sourcePackage: PetPackage,
    target: string,
    sourceKind: PetSource,
    writeSourceMarker: boolean,
  ): Promise<void> {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = await fs.mkdtemp(
      path.join(path.dirname(target), `.${sourcePackage.manifest.id}.`),
    );
    try {
      await fs.copyFile(
        path.join(sourcePackage.directory, 'pet.json'),
        path.join(temporary, 'pet.json'),
      );
      await fs.copyFile(
        sourcePackage.spritesheet,
        path.join(temporary, sourcePackage.manifest.spritesheetPath),
      );
      if (writeSourceMarker) {
        await fs.writeFile(
          path.join(temporary, SOURCE_MARKER),
          sourceKind,
          'utf8',
        );
      }
      await this.validator.validateDirectory(temporary, sourceKind);
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
}

export function resolveCodexHome(overridePath = ''): string {
  if (overridePath.trim()) {
    return path.resolve(expandHome(overridePath.trim()));
  }
  const environmentPath = process.env.CODEX_HOME?.trim();
  if (environmentPath) {
    return path.resolve(expandHome(environmentPath));
  }
  return path.join(os.homedir(), '.codex');
}

async function childDirectories(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name))
      .sort((left, right) =>
        path.basename(left).localeCompare(path.basename(right)),
      );
  } catch {
    return [];
  }
}

async function readSource(directory: string): Promise<PetSource> {
  try {
    const value = (
      await fs.readFile(path.join(directory, SOURCE_MARKER), 'utf8')
    ).trim();
    return ['bundled', 'library', 'codex'].includes(value)
      ? (value as PetSource)
      : 'library';
  } catch {
    return 'library';
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

function expandHome(value: string): string {
  return value === '~'
    ? os.homedir()
    : value.startsWith('~/')
      ? path.join(os.homedir(), value.slice(2))
      : value;
}

function errorMessage(error: unknown): string {
  return error instanceof PetPackageError || error instanceof Error
    ? error.message
    : String(error);
}
