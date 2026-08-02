import { describe, expect, it } from 'vitest';
import { StoryEventSystem } from '../src/events/story-event-system';

describe('StoryEventSystem', () => {
  it('只选择等级允许的事件并避开最近三次', () => {
    const system = new StoryEventSystem(() => 0);
    const selected = system.choose(1, ['play_dead', 'zoomies', 'weather']);

    expect(selected).not.toBeNull();
    expect(selected?.minimumLevel).toBe(1);
    expect(['play_dead', 'zoomies', 'weather']).not.toContain(
      selected?.eventId,
    );
  });

  it('没有未重复候选时回退到当前等级全部事件', () => {
    const system = new StoryEventSystem(() => 0);
    const selected = system.choose(1, [
      'play_dead',
      'zoomies',
      'weather',
      'holiday',
    ]);

    expect(selected?.eventId).toBe('play_dead');
  });

  it('宝箱奖励保持旧版种类并映射到可持久化物品', () => {
    const system = new StoryEventSystem(() => 0);

    expect(system.treasureReward()).toEqual({
      kind: 'item',
      itemId: 'bread',
      name: '小面包',
      amount: 2,
    });
    expect(system.behaviorFor('edge_adventure')).toBe('CLIMB');
  });
});
