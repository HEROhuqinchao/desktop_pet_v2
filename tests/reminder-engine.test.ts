import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssistantDatabase } from '../src/persistence/assistant-database';
import {
  isInQuietHours,
  nextOccurrence,
  ReminderEngine,
} from '../src/reminders/reminder-engine';

describe('ReminderEngine', () => {
  let database: AssistantDatabase;
  let current: Date;
  let engine: ReminderEngine;

  beforeEach(() => {
    database = new AssistantDatabase(':memory:');
    database.initialize();
    current = new Date(2026, 6, 27, 12, 0, 0);
    engine = new ReminderEngine(database, () => new Date(current));
    engine.ensureDefaults();
  });

  afterEach(() => {
    database.close();
  });

  it('迁移原有健康提醒并补齐需求中的日常模板', () => {
    const dashboard = engine.dashboard();
    expect(dashboard.reminders.map((item) => item.reminderId)).toEqual(
      expect.arrayContaining([
        'water',
        'sedentary',
        'rest',
        'meal',
        'save-work',
        'tidy-up',
      ]),
    );
    expect(dashboard.reminders).toHaveLength(6);
    expect(
      dashboard.reminders.find((item) => item.reminderId === 'water'),
    ).toMatchObject({
      intervalMinutes: 45,
      scheduleType: 'interval',
      enabled: true,
      builtIn: true,
    });
    expect(
      dashboard.reminders.find((item) => item.reminderId === 'meal'),
    ).toMatchObject({
      scheduleType: 'daily',
      dailyTimes: ['12:00', '18:30'],
    });
  });

  it('遵守跨午夜免打扰、总工作日规则和单提醒工作日规则', () => {
    current = new Date(2026, 6, 27, 13, 1, 0);
    expect(engine.due().map((item) => item.reminderId)).toEqual(
      expect.arrayContaining(['water', 'sedentary', 'rest', 'save-work']),
    );

    engine.updatePreferences({ quietStart: '11:00', quietEnd: '14:00' });
    expect(engine.due()).toEqual([]);

    engine.updatePreferences({
      quietStart: '22:00',
      quietEnd: '08:00',
      workdaysOnly: true,
    });
    current = new Date(2026, 7, 1, 13, 1, 0);
    expect(engine.due()).toEqual([]);

    expect(
      isInQuietHours(new Date(2026, 6, 27, 23, 0), '22:00', '08:00'),
    ).toBe(true);
    expect(
      isInQuietHours(new Date(2026, 6, 27, 9, 0), '22:00', '08:00'),
    ).toBe(false);
  });

  it('支持稍后提醒、今日停用和送达后的下次调度', () => {
    current = new Date(2026, 6, 27, 13, 1, 0);
    expect(engine.snooze('water', 10)).toBe(true);
    expect(engine.due().some((item) => item.reminderId === 'water')).toBe(
      false,
    );

    current = new Date(2026, 6, 27, 13, 12, 0);
    expect(engine.due().some((item) => item.reminderId === 'water')).toBe(
      true,
    );
    expect(engine.markDelivered('water')).toBe(true);
    expect(engine.due().some((item) => item.reminderId === 'water')).toBe(
      false,
    );

    expect(engine.disableToday('sedentary')).toBe(true);
    expect(
      engine.due().some((item) => item.reminderId === 'sedentary'),
    ).toBe(false);
  });

  it('可创建、修改和删除自定义提醒，但不删除内置模板', () => {
    const created = engine.save({
      reminderType: 'custom',
      title: '提交日报',
      scheduleType: 'daily',
      intervalMinutes: 30,
      dailyTimes: ['18:20', '09:10', '18:20'],
      enabled: true,
      workdaysOnly: true,
    });
    expect(created.dailyTimes).toEqual(['09:10', '18:20']);
    expect(created.builtIn).toBe(false);
    expect(engine.delete(created.reminderId)).toBe(true);
    expect(engine.delete('water')).toBe(false);
  });
});

describe('nextOccurrence', () => {
  it('间隔提醒使用真实经过时间，每日提醒选择下一个合法时刻', () => {
    const now = new Date(2026, 6, 31, 18, 45, 0);
    expect(
      nextOccurrence(now, 'interval', 45, [], false).getTime()
      - now.getTime(),
    ).toBe(45 * 60_000);
    const nextWorkday = nextOccurrence(
      now,
      'daily',
      30,
      ['18:00'],
      true,
    );
    expect(nextWorkday.getDay()).toBe(1);
    expect(nextWorkday.getHours()).toBe(18);
  });
});
