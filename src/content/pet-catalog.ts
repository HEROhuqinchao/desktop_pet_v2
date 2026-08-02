import fs from 'node:fs/promises';
import path from 'node:path';
import type { PetCatalogEntry } from '../shared/contracts';
import { PetLibrary, resolveCodexHome } from './pet-library';
import {
  PetPackageError,
  type PetPackage,
} from './pet-package';

export interface CatalogPackage {
  entry: PetCatalogEntry;
  package: PetPackage;
  externalOnly: boolean;
}

export class PetCatalog {
  constructor(
    private readonly bundledRoot: string,
    private readonly library: PetLibrary,
  ) {}

  async listPackages(
    selectedPetId: string,
    codexHomeOverride = '',
  ): Promise<CatalogPackage[]> {
    const available = new Map<string, PetPackage>();
    for (const sourcePackage of await this.bundledPackages()) {
      available.set(sourcePackage.manifest.id, sourcePackage);
    }
    for (const sourcePackage of await this.library.listPackages()) {
      if (!available.has(sourcePackage.manifest.id)) {
        available.set(sourcePackage.manifest.id, sourcePackage);
      }
    }

    const packages: CatalogPackage[] = [...available.values()]
      .sort((left, right) =>
        left.manifest.displayName.localeCompare(right.manifest.displayName),
      )
      .map((sourcePackage) =>
        catalogPackage(sourcePackage, selectedPetId, false),
      );

    const codexRoot = path.join(
      resolveCodexHome(codexHomeOverride),
      'pets',
    );
    for (const directory of await childDirectories(codexRoot)) {
      try {
        const sourcePackage = await this.library.validator.validateDirectory(
          directory,
          'codex',
        );
        if (available.has(sourcePackage.manifest.id)) {
          continue;
        }
        packages.push(
          catalogPackage(sourcePackage, selectedPetId, true),
        );
      } catch (error) {
        if (!(error instanceof PetPackageError)) {
          throw error;
        }
      }
    }
    return packages;
  }

  async resolve(
    selectionId: string,
    codexHomeOverride = '',
  ): Promise<CatalogPackage | null> {
    const normalized =
      selectionId === 'default' ? 'codex:tudou' : selectionId;
    const packages = await this.listPackages(
      normalized,
      codexHomeOverride,
    );
    return (
      packages.find(
        (item) =>
          !item.externalOnly
          && item.entry.selectionId === normalized,
      )
      ?? null
    );
  }

  private async bundledPackages(): Promise<PetPackage[]> {
    const packages: PetPackage[] = [];
    for (const directory of await childDirectories(this.bundledRoot)) {
      try {
        packages.push(
          await this.library.validator.validateDirectory(
            directory,
            'bundled',
          ),
        );
      } catch {
        // 打包目录里无效的宠物不会暴露给 Renderer。
      }
    }
    return packages;
  }
}

function catalogPackage(
  sourcePackage: PetPackage,
  selectedPetId: string,
  externalOnly: boolean,
): CatalogPackage {
  const selectionId = externalOnly
    ? `codex-external:${sourcePackage.manifest.id}`
    : `codex:${sourcePackage.manifest.id}`;
  return {
    package: sourcePackage,
    externalOnly,
    entry: {
      selectionId,
      petId: sourcePackage.manifest.id,
      displayName: sourcePackage.manifest.displayName,
      description: sourcePackage.manifest.description,
      spriteVersionNumber: sourcePackage.manifest.spriteVersionNumber,
      actionManifest: sourcePackage.actionPack?.manifest ?? null,
      source: sourcePackage.source,
      contentHash: sourcePackage.contentHash,
      active: selectionId === selectedPetId,
    },
  };
}

async function childDirectories(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name))
      .sort();
  } catch {
    return [];
  }
}
