import { describe, expect, it } from 'vitest';
import {
  ConversationController,
  LocalConversationProvider,
  type ConversationProvider,
} from '../src/conversation/conversation';
import { MemoryPolicy } from '../src/memory/memory-policy';
import { MemoryService } from '../src/memory/memory-service';
import { AssistantDatabase } from '../src/persistence/assistant-database';

describe('MemoryPolicy', () => {
  it('拒绝空内容、超长内容和敏感信息', () => {
    const policy = new MemoryPolicy();

    expect(policy.validate(' ').ok).toBe(false);
    expect(policy.validate('a'.repeat(201)).ok).toBe(false);
    expect(policy.validate('请记住我的 API key 是 secret').message)
      .toContain('敏感信息');
    expect(policy.validate('我的身份证是 110101199001011234').ok)
      .toBe(false);
    expect(policy.validate('我喜欢喝乌龙茶')).toEqual({
      ok: true,
      message: '我喜欢喝乌龙茶',
    });
  });
});

describe('ConversationController', () => {
  it('白名单命令和明确记忆候选只由本地路由产生', async () => {
    const controller = new ConversationController(
      new LocalConversationProvider('土豆', () => 0),
    );

    const focus = await controller.send('陪我专注 250 分钟');
    const memory = await controller.send('请记住：我喜欢乌龙茶');

    expect(focus).toMatchObject({
      commandName: 'start_focus',
      commandArguments: { minutes: 180 },
      providerName: 'local',
    });
    expect(memory.memoryCandidate).toEqual({
      memoryType: 'USER_NOTE',
      content: '我喜欢乌龙茶',
    });
  });

  it('在线提供方失败时回退本地且不丢失当前回复', async () => {
    const remote: ConversationProvider = {
      name: 'test-remote',
      complete: async () => {
        throw new Error('network down');
      },
    };
    const controller = new ConversationController(
      new LocalConversationProvider('土豆', () => 0),
      remote,
      'mixed',
    );

    expect(await controller.send('今天有点累')).toMatchObject({
      text: '辛苦啦。先慢慢呼吸，喝口水，我们把下一件事变小一点。',
      providerName: 'local',
      fallbackUsed: true,
    });
  });
});

describe('MemoryService', () => {
  it('只有二次确认后才保存并触发首条记忆成就', () => {
    const database = new AssistantDatabase(':memory:');
    database.initialize(new Date('2026-07-31T10:00:00.000Z'));
    const service = new MemoryService(database);

    expect(service.propose('USER_NOTE', '我的密码是 123456').ok).toBe(false);
    expect(database.listMemories()).toEqual([]);
    expect(service.propose('USER_PREFERENCE', '我喜欢乌龙茶')).toEqual({
      ok: true,
      message: '等待用户确认',
    });
    expect(database.listMemories()).toEqual([]);
    const memory = service.confirm(new Date('2026-07-31T10:01:00.000Z'));

    expect(memory).toMatchObject({
      memoryType: 'USER_PREFERENCE',
      content: '我喜欢乌龙茶',
    });
    expect(() => service.confirm()).toThrow('没有等待确认的记忆');
    expect(
      database.getGrowthDashboard().achievements.find(
        (item) => item.achievementId === 'first_memory',
      )?.unlockedAt,
    ).not.toBeNull();
    database.close();
  });
});
