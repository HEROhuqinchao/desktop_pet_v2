import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantDatabase } from '../src/persistence/assistant-database';
import { ReminderEngine } from '../src/reminders/reminder-engine';
import { StoryEventSystem } from '../src/events/story-event-system';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('AssistantDatabase', () => {
  it('重启后保留提醒设置和模板状态', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-pet-v2-db-'),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'assistant.db');

    const first = new AssistantDatabase(filePath);
    first.initialize();
    const firstEngine = new ReminderEngine(
      first,
      () => new Date(2026, 6, 27, 12, 0, 0),
    );
    firstEngine.ensureDefaults();
    firstEngine.updatePreferences({
      quietStart: '21:30',
      shutdownChecklistItems: ['保存文件', '带走电脑'],
    });
    const water = first.findReminder('water');
    if (!water) {
      throw new Error('测试提醒未创建');
    }
    first.saveReminder({ ...water, enabled: false });
    first.close();

    const second = new AssistantDatabase(filePath);
    second.initialize();
    expect(second.getReminderPreferences()).toMatchObject({
      quietStart: '21:30',
      shutdownChecklistItems: ['保存文件', '带走电脑'],
    });
    expect(second.findReminder('water')?.enabled).toBe(false);
    second.close();
  });

  it('首次初始化创建成长档案和默认食物库存', () => {
    const database = new AssistantDatabase(':memory:');
    database.initialize();

    expect(database.getPetProfile()).toMatchObject({
      name: '土豆',
      level: 1,
      relationship: 0,
      attributes: { hunger: 78, energy: 82, mood: 80 },
    });
    expect(database.listInventory()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: 'bread', quantity: 3 }),
      ]),
    );
    database.close();
  });

  it('喂食应用配置效果与经验并触发冷却（对齐基准：不消耗背包）', () => {
    const database = new AssistantDatabase(':memory:');
    database.initialize();
    const result = database.feedPet(
      'juice',
      new Date('2026-07-31T10:00:00.000Z'),
    );

    expect(result.ok).toBe(true);
    expect(result.profile).toMatchObject({
      experience: 5,
      attributes: { hunger: 83, mood: 83, energy: 92 },
    });
    expect(
      database.listInventory().find((item) => item.itemId === 'juice'),
    ).toMatchObject({ quantity: 1 });
    expect(
      database.feedPet('juice', new Date('2026-07-31T10:00:01.000Z')).ok,
    ).toBe(false);
    database.close();
  });

  it('完整游戏结果把奖励结算到同一成长档案（好感进入属性）', () => {
    const database = new AssistantDatabase(':memory:');
    database.initialize();
    const completion = database.recordGameResult({
      gameId: 'catch_food',
      score: 900,
      grade: 'B',
      durationSeconds: 60,
      maxCombo: 20,
      accuracy: 0.8,
      caughtCount: 16,
      droppedCount: 2,
      hitCount: 0,
      missCount: 0,
      finishReason: 'completed',
    });

    const profile = database.getPetProfile();
    expect(profile.experience).toBe(completion.rewards.experience);
    expect(profile.relationship).toBe(0);
    expect(profile.attributes.affection).toBe(
      35 + completion.rewards.affection,
    );
    expect(profile.attributes.hunger).toBe(
      78 + completion.rewards.hunger,
    );
    expect(profile.attributes.mood).toBe(80 + completion.rewards.mood);
    database.close();
  });

  it('切换睡眠前推进属性并持久化睡眠状态', () => {
    const database = new AssistantDatabase(':memory:');
    database.initialize(new Date('2026-07-31T08:00:00.000Z'));

    const sleeping = database.setPetSleeping(
      true,
      new Date('2026-07-31T09:00:00.000Z'),
    );
    const awake = database.advancePetAttributes(
      new Date('2026-07-31T10:00:00.000Z'),
    );

    expect(sleeping.sleeping).toBe(true);
    expect(awake.attributes.energy).toBeCloseTo(91.2);
    database.close();
  });

  it('每日任务只领取一次并把奖励结算到成长档案', () => {
    const database = new AssistantDatabase(':memory:');
    const now = new Date('2026-07-31T10:00:00.000Z');
    database.initialize(now);
    const task = database.getGrowthDashboard(now).tasks[0];

    expect(database.claimDailyTask(task.taskId, now).ok).toBe(false);
    database.recordPetProgress(task.eventType, task.target, now);
    const first = database.claimDailyTask(task.taskId, now);
    const second = database.claimDailyTask(task.taskId, now);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(database.getPetProfile()).toMatchObject({
      experience: task.rewardExperience,
      relationship: task.rewardRelationship,
    });
    database.close();
  });

  it('首次互动成就只解锁一次', () => {
    const database = new AssistantDatabase(':memory:');
    const now = new Date('2026-07-31T10:00:00.000Z');
    database.initialize(now);

    const first = database.recordPetProgress('interaction', 1, now);
    const second = database.recordPetProgress('interaction', 1, now);

    expect(first.unlockedAchievements.map((item) => item.achievementId))
      .toContain('first_touch');
    expect(second.unlockedAchievements).toEqual([]);
    expect(
      database.getGrowthDashboard(now).achievements.find(
        (item) => item.achievementId === 'first_touch',
      )?.unlockedAt,
    ).not.toBeNull();
    database.close();
  });

  it('背包发放与消费拒绝非法类型、非正数和超量消费', () => {
    const database = new AssistantDatabase(':memory:');
    database.initialize();

    expect(
      database.grantInventory('star', 'decoration', '星星', 2).ok,
    ).toBe(true);
    expect(database.consumeInventory('star', 1).ok).toBe(true);
    expect(database.consumeInventory('star', 2).ok).toBe(false);
    expect(
      database.grantInventory('bad', 'script', '脚本', 1).ok,
    ).toBe(false);
    expect(
      database.grantInventory('zero', 'toy', '空气', 0).ok,
    ).toBe(false);
    expect(
      database.listInventory().find((item) => item.itemId === 'star'),
    ).toMatchObject({ quantity: 1 });
    database.close();
  });

  it('连续自然日启动累加陪伴天数，断档后重新从一天开始', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-pet-v2-streak-'),
    );
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'assistant.db');
    const first = new AssistantDatabase(filePath);
    first.initialize(new Date('2026-07-31T10:00:00.000Z'));
    expect(first.getGrowthDashboard().consecutiveDays).toBe(1);
    first.close();

    const second = new AssistantDatabase(filePath);
    second.initialize(new Date('2026-08-01T10:00:00.000Z'));
    expect(second.getGrowthDashboard().consecutiveDays).toBe(2);
    second.close();

    const third = new AssistantDatabase(filePath);
    third.initialize(new Date('2026-08-03T10:00:00.000Z'));
    expect(third.getGrowthDashboard().consecutiveDays).toBe(1);
    third.close();
  });

  it('宝箱事件通过成长和背包服务结算并记录近期事件', () => {
    const database = new AssistantDatabase(':memory:');
    const now = new Date('2026-07-31T10:00:00.000Z');
    database.initialize(now);
    database.addPetGrowth(100, 0, now);
    const values = [0.6, 0];
    const result = database.runStoryEvent(
      new StoryEventSystem(() => values.shift() ?? 0),
      now,
    );

    expect(result?.event.eventId).toBe('treasure');
    expect(result?.reward).toMatchObject({
      kind: 'item',
      itemId: 'bread',
      amount: 2,
    });
    expect(
      database.listInventory().find((item) => item.itemId === 'bread'),
    ).toMatchObject({ quantity: 5 });
    expect(database.listRecentStoryEventIds()).toEqual(['treasure']);
    database.close();
  });
});
