import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssistantDatabase } from '../src/persistence/assistant-database';
import { FocusTimer } from '../src/reminders/focus-timer';

describe('FocusTimer', () => {
  let database: AssistantDatabase;
  let monotonicSeconds: number;
  let wallClock: Date;
  let timer: FocusTimer;

  beforeEach(() => {
    database = new AssistantDatabase(':memory:');
    database.initialize();
    monotonicSeconds = 0;
    wallClock = new Date(2026, 6, 27, 12, 0, 0);
    timer = new FocusTimer(
      database,
      () => monotonicSeconds,
      () => new Date(wallClock),
    );
    timer.initialize();
  });

  afterEach(() => {
    database.close();
  });

  it('暂停期间不消耗专注时长并记录完成次数', () => {
    timer.start(1);
    monotonicSeconds += 20;
    expect(timer.pause().remainingSeconds).toBe(40);
    monotonicSeconds += 100;
    expect(timer.snapshot().remainingSeconds).toBe(40);
    timer.resume();
    monotonicSeconds += 40;
    wallClock = new Date(2026, 6, 27, 12, 3, 0);
    const result = timer.tick();
    expect(result.completed).toBe(true);
    expect(result.state.status).toBe('idle');
    expect(result.state.completedCount).toBe(1);
  });

  it('停止专注会记录取消并回到空闲状态', () => {
    timer.start(25);
    monotonicSeconds += 12;
    const state = timer.stop();
    expect(state.status).toBe('idle');
    expect(state.completedCount).toBe(0);
  });

  it('不允许覆盖正在进行的专注', () => {
    timer.start(25);
    expect(() => timer.start(15)).toThrow('已有专注计时正在进行');
  });
});
