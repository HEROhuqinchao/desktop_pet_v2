import { describe, expect, it } from 'vitest';
import { createDailyTasks } from '../src/growth/daily-task-system';

describe('createDailyTasks', () => {
  it('同一日期稳定生成三项普通任务和一项挑战', () => {
    const first = createDailyTasks('2026-07-31');
    const second = createDailyTasks('2026-07-31');

    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
    expect(first.filter((task) => task.challenge)).toHaveLength(1);
    expect(new Set(first.map((task) => task.taskId)).size).toBe(4);
  });

  it('不同日期使用不同稳定种子', () => {
    expect(createDailyTasks('2026-08-01')).not.toEqual(
      createDailyTasks('2026-07-31'),
    );
  });
});
