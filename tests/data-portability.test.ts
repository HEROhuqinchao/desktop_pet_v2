import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryService } from '../src/memory/memory-service';
import { AssistantDatabase } from '../src/persistence/assistant-database';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('个人数据迁移', () => {
  it('JSON 导出不包含在线密钥和会话历史并可安全导入', () => {
    const root = createTemporaryDirectory();
    const exportPath = path.join(root, 'personal-data.json');
    const source = new AssistantDatabase(path.join(root, 'source.db'));
    source.initialize(new Date('2026-07-31T10:00:00.000Z'));
    source.addPetGrowth(25, 4);
    source.grantInventory('star', 'decoration', '星星', 2);
    const memory = new MemoryService(source);
    memory.propose('USER_PREFERENCE', '我喜欢乌龙茶');
    memory.confirm();
    source.exportPersonalData(exportPath);
    const raw = fs.readFileSync(exportPath, 'utf8');

    expect(raw).not.toContain('apiKey');
    expect(raw).not.toContain('conversationHistory');
    const target = new AssistantDatabase(path.join(root, 'target.db'));
    target.initialize();
    const result = target.importPersonalData(exportPath);

    expect(result.ok).toBe(true);
    expect(target.getPetProfile()).toMatchObject({
      experience: 25,
      relationship: 4,
    });
    expect(target.listMemories()[0]?.content).toBe('我喜欢乌龙茶');
    expect(
      target.listInventory().find((item) => item.itemId === 'star'),
    ).toMatchObject({ quantity: 2 });
    source.close();
    target.close();
  });

  it('JSON 导入保留已经耗尽的零数量库存', () => {
    const root = createTemporaryDirectory();
    const exportPath = path.join(root, 'personal-data.json');
    const source = new AssistantDatabase(path.join(root, 'source.db'));
    source.initialize();
    source.grantInventory('test-snack', 'food', '测试零食', 1);
    expect(source.consumeInventory('test-snack', 1).ok).toBe(true);
    source.exportPersonalData(exportPath);

    const target = new AssistantDatabase(path.join(root, 'target.db'));
    target.initialize();
    const result = target.importPersonalData(exportPath);

    expect(result.ok).toBe(true);
    expect(
      target.listInventory().find((item) => item.itemId === 'test-snack'),
    ).toMatchObject({ quantity: 0 });
    source.close();
    target.close();
  });

  it('SQLite 一致性备份可以恢复备份时的状态', async () => {
    const root = createTemporaryDirectory();
    const databasePath = path.join(root, 'assistant.db');
    const backupPath = path.join(root, 'backup.db');
    const database = new AssistantDatabase(databasePath);
    database.initialize();
    database.addPetGrowth(10, 1);
    await database.backupDatabase(backupPath);
    database.addPetGrowth(30, 4);

    await database.restoreDatabase(backupPath);

    expect(database.getPetProfile()).toMatchObject({
      experience: 10,
      relationship: 1,
    });
    expect(database.integrityCheck()).toBe('ok');
    database.close();
  });

  it('导入拒绝敏感长期记忆并保持现有数据不变', () => {
    const root = createTemporaryDirectory();
    const source = path.join(root, 'unsafe.json');
    fs.writeFileSync(source, JSON.stringify({
      formatVersion: 1,
      profile: null,
      memories: [{
        memoryId: 1,
        memoryType: 'USER_NOTE',
        content: '我的 API key 是 secret',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
      inventory: [],
    }));
    const database = new AssistantDatabase(path.join(root, 'assistant.db'));
    database.initialize();

    expect(database.importPersonalData(source).ok).toBe(false);
    expect(database.listMemories()).toEqual([]);
    expect(database.getPetProfile().level).toBe(1);
    database.close();
  });
});

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-portability-'));
  temporaryDirectories.push(directory);
  return directory;
}
