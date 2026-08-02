import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { PetCatalog } from '../src/content/pet-catalog';
import { PetLibrary } from '../src/content/pet-library';
import {
  ATLAS_WIDTH,
  CELL_HEIGHT,
  CELL_WIDTH,
  PetPackageConflictError,
  PetPackageError,
  PetPackageValidator,
} from '../src/content/pet-package';

const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const bundledTudou = path.join(
  projectRoot,
  'src',
  'renderer',
  'public',
  'pets',
  'tudou',
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('PetPackageValidator', () => {
  it('accepts the exact bundled Tudou v2 package', async () => {
    const sourcePackage = await new PetPackageValidator().validateDirectory(
      bundledTudou,
      'bundled',
    );

    expect(sourcePackage.manifest.id).toBe('tudou');
    expect(sourcePackage.manifest.spriteVersionNumber).toBe(2);
    expect(sourcePackage.source).toBe('bundled');
  });

  it('rejects manifest path traversal', async () => {
    const root = await temporaryDirectory();
    const packageRoot = path.join(root, 'bad');
    await createPackage(packageRoot, 2);
    const manifestPath = path.join(packageRoot, 'pet.json');
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    manifest.spritesheetPath = '../spritesheet.png';
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    await expect(
      new PetPackageValidator().validateDirectory(packageRoot),
    ).rejects.toBeInstanceOf(PetPackageError);
  });

  it('rejects a visible pixel in an unused v1 cell', async () => {
    const root = await temporaryDirectory();
    const packageRoot = path.join(root, 'unused-cell');
    await createPackage(packageRoot, 1, 'unused-cell', true);

    await expect(
      new PetPackageValidator().validateDirectory(packageRoot),
    ).rejects.toThrow('必须全透明');
  });

  it('accepts a compatible desktop_pet_v2 action sidecar', async () => {
    const root = await temporaryDirectory();
    const packageRoot = path.join(root, 'actions');
    await createPackage(packageRoot, 2, 'actions');
    await createActionPack(packageRoot);

    const sourcePackage = await new PetPackageValidator().validateDirectory(
      packageRoot,
    );

    expect(sourcePackage.actionPack?.manifest.stateMap.SLEEP).toBe('sleep');
    expect(sourcePackage.actionPack?.manifest.animations.eat?.frames).toHaveLength(2);
  });

  it('rejects visible pixels in unused action cells', async () => {
    const root = await temporaryDirectory();
    const packageRoot = path.join(root, 'bad-actions');
    await createPackage(packageRoot, 2, 'bad-actions');
    await createActionPack(packageRoot, true);

    await expect(
      new PetPackageValidator().validateDirectory(packageRoot),
    ).rejects.toThrow('扩展动作未使用单元格');
  });
});

describe('PetLibrary and PetCatalog', () => {
  it('syncs idempotently and never overwrites a conflict', async () => {
    const root = await temporaryDirectory();
    const codexRoot = path.join(root, 'codex', 'pets');
    await fs.mkdir(codexRoot, { recursive: true });
    await fs.cp(bundledTudou, path.join(codexRoot, 'tudou'), {
      recursive: true,
    });
    const library = new PetLibrary(path.join(root, 'library'));

    expect((await library.syncFromDirectory(codexRoot)).imported).toBe(1);
    expect((await library.syncFromDirectory(codexRoot)).unchanged).toBe(1);

    const manifestPath = path.join(codexRoot, 'tudou', 'pet.json');
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    manifest.description = '同 ID 的另一个版本';
    await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');

    expect((await library.syncFromDirectory(codexRoot)).conflicts).toBe(1);
    await expect(
      library.importFolder(path.join(codexRoot, 'tudou')),
    ).rejects.toBeInstanceOf(PetPackageConflictError);
  }, 15_000);

  it('exports only the Codex package files', async () => {
    const root = await temporaryDirectory();
    const library = new PetLibrary(path.join(root, 'library'));
    const local = await library.importFolder(bundledTudou);

    const report = await library.exportPackage(
      local,
      path.join(root, 'codex'),
    );
    const exported = await fs.readdir(
      path.join(root, 'codex', 'pets', 'tudou'),
    );

    expect(report.imported).toBe(1);
    expect(new Set(exported)).toEqual(
      new Set(['pet.json', 'spritesheet.webp']),
    );
  });

  it('discovers an external Codex pet without importing it', async () => {
    const root = await temporaryDirectory();
    const external = path.join(root, 'codex', 'pets', 'other');
    await createPackage(external, 2, 'other');
    const library = new PetLibrary(path.join(root, 'library'));
    const catalog = new PetCatalog(path.join(root, 'bundled'), library);

    const entries = await catalog.listPackages(
      'codex:tudou',
      path.join(root, 'codex'),
    );

    expect(entries.map((item) => item.entry.selectionId)).toContain(
      'codex-external:other',
    );
    await expect(
      fs.access(path.join(root, 'library', 'other')),
    ).rejects.toThrow();
  });

  it('copies action sidecars and exposes their state map', async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, 'source-actions');
    await createPackage(source, 2, 'source-actions');
    await createActionPack(source);
    const library = new PetLibrary(path.join(root, 'library'));

    const imported = await library.importFolder(source);
    const catalog = new PetCatalog(path.join(root, 'bundled'), library);
    const entries = await catalog.listPackages('codex:source-actions');

    expect(imported.actionPack?.manifest.atlasPath).toBe('actions.png');
    expect(entries[0]?.entry.actionManifest?.stateMap.EAT).toBe('eat');
    expect(
      await fs.readdir(path.join(root, 'library', 'source-actions')),
    ).toEqual(expect.arrayContaining([
      'actions.png',
      'desktop-pet-actions.json',
      'pet.json',
      'spritesheet.png',
    ]));
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'desktop-pet-v2-package-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

async function createPackage(
  root: string,
  version: 1 | 2,
  petId = 'test-pet',
  addUnusedPixel = false,
): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const height = CELL_HEIGHT * (version === 2 ? 11 : 9);
  const pixels = Buffer.alloc(ATLAS_WIDTH * height * 4);
  for (let row = 0; row < (version === 2 ? 11 : 9); row += 1) {
    for (let column = 0; column < 8; column += 1) {
      if (PetPackageValidator.cellIsUsed(version, row, column)) {
        setPixel(
          pixels,
          ATLAS_WIDTH,
          column * CELL_WIDTH + Math.floor(CELL_WIDTH / 2),
          row * CELL_HEIGHT + Math.floor(CELL_HEIGHT / 2),
        );
      }
    }
  }
  if (addUnusedPixel) {
    setPixel(pixels, ATLAS_WIDTH, CELL_WIDTH * 7 + 2, 2);
  }
  await sharp(pixels, {
    raw: { width: ATLAS_WIDTH, height, channels: 4 },
  })
    .png({ compressionLevel: 0 })
    .toFile(path.join(root, 'spritesheet.png'));
  await fs.writeFile(
    path.join(root, 'pet.json'),
    JSON.stringify({
      id: petId,
      displayName: petId,
      description: '测试宠物',
      spriteVersionNumber: version,
      spritesheetPath: 'spritesheet.png',
    }),
    'utf8',
  );
}

async function createActionPack(
  root: string,
  addUnusedPixel = false,
): Promise<void> {
  const columns = addUnusedPixel ? 3 : 2;
  const width = CELL_WIDTH * columns;
  const height = CELL_HEIGHT;
  const pixels = Buffer.alloc(width * height * 4);
  setPixel(
    pixels,
    width,
    Math.floor(CELL_WIDTH / 2),
    Math.floor(CELL_HEIGHT / 2),
  );
  setPixel(
    pixels,
    width,
    CELL_WIDTH + Math.floor(CELL_WIDTH / 2),
    Math.floor(CELL_HEIGHT / 2),
  );
  if (addUnusedPixel) {
    setPixel(
      pixels,
      width,
      CELL_WIDTH * 2 + Math.floor(CELL_WIDTH / 2),
      Math.floor(CELL_HEIGHT / 2),
    );
  }
  await sharp(pixels, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 0 })
    .toFile(path.join(root, 'actions.png'));
  await fs.writeFile(
    path.join(root, 'desktop-pet-actions.json'),
    JSON.stringify({
      formatVersion: 1,
      cellWidth: CELL_WIDTH,
      cellHeight: CELL_HEIGHT,
      atlasPath: 'actions.png',
      columns,
      rows: 1,
      animations: {
        sleep: {
          loop: true,
          frames: [{ row: 0, column: 0, durationMs: 180 }],
        },
        eat: {
          loop: false,
          frames: [
            { row: 0, column: 0, durationMs: 100 },
            { row: 0, column: 1, durationMs: 140 },
          ],
        },
      },
      stateMap: {
        SLEEP: 'sleep',
        EAT: 'eat',
      },
    }),
    'utf8',
  );
}

function setPixel(
  pixels: Buffer,
  width: number,
  x: number,
  y: number,
): void {
  const offset = (y * width + x) * 4;
  pixels[offset] = 255;
  pixels[offset + 1] = 128;
  pixels[offset + 2] = 32;
  pixels[offset + 3] = 255;
}
