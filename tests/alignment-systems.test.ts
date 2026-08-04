import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DialogueSystem } from '../src/core/dialogue-system';
import { EmotionSystem } from '../src/core/emotion-system';
import { SleepSystem } from '../src/core/sleep-system';
import { DifficultyDirector } from '../src/games/difficulty-director';
import { DodgeAI } from '../src/games/dodge-ai';
import {
  loadCatchFoodConfig,
  loadDodgeMouseConfig,
} from '../src/games/game-configs';
import { SpawnDirector } from '../src/games/spawn-director';
import {
  buildPetMenuTemplate,
  buildTrayMenuTemplate,
} from '../src/main/pet-menus';
import {
  DEFAULT_PET_SETTINGS,
  normalizeSettings,
} from '../src/main/preferences-store';
import { AssistantDatabase } from '../src/persistence/assistant-database';

const dataRoot = path.join(__dirname, '..', 'data');
const noop = () => undefined;

describe('SpawnDirector（对齐 spawn_director.py）', () => {
  const config = loadCatchFoodConfig(
    JSON.parse(fs.readFileSync(path.join(dataRoot, 'catch_food.json'), 'utf8')),
    'standard',
  );

  it('按难度插值生成间隔并在狂热时加速', () => {
    const director = new SpawnDirector(config, () => 0.5);
    const normal = director.update(0.6, 0.5, {
      fever: false,
      activeCount: 0,
    });
    expect(normal.length).toBeGreaterThan(0);
    const feverDirector = new SpawnDirector(config, () => 0.5);
    const fever = feverDirector.update(0.4, 0.5, {
      fever: true,
      activeCount: 0,
    });
    expect(fever.length).toBeGreaterThan(0);
  });

  it('每 patternSeconds 切换一次生成模式', () => {
    let call = 0;
    const director = new SpawnDirector(config, () => {
      call += 1;
      return call % 2 === 0 ? 0.9 : 0.1;
    });
    const seen = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      director.update(config.patternSeconds + 0.1, 0.9, {
        fever: false,
        activeCount: 0,
      });
      seen.add(director.pattern);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('低难度只使用前三种模式', () => {
    const director = new SpawnDirector(config, () => 0.99);
    director.update(config.patternSeconds + 0.1, 0.1, {
      fever: false,
      activeCount: 0,
    });
    expect(['SINGLE', 'DOUBLE', 'WAVE']).toContain(director.pattern);
  });
});

describe('DifficultyDirector（对齐 difficulty_director.py）', () => {
  it('以模式基线为起点向目标缓慢趋近', () => {
    const director = new DifficultyDirector('standard', true);
    expect(director.currentDifficulty).toBeCloseTo(0.42);
    const next = director.update(1, {
      hitRate: 1,
      combo: 30,
      recentFailures: 0,
      recentSuccesses: 8,
      currentScore: 1000,
    });
    expect(next).toBeGreaterThan(0.42);
    expect(next).toBeLessThanOrEqual(1);
  });

  it('关闭自适应时表现分固定为 0.5', () => {
    const adaptive = new DifficultyDirector('easy', true);
    const fixed = new DifficultyDirector('easy', false);
    adaptive.update(0.5, {
      hitRate: 1,
      combo: 30,
      recentFailures: 0,
      recentSuccesses: 8,
      currentScore: 0,
    });
    fixed.update(0.5, {
      hitRate: 1,
      combo: 30,
      recentFailures: 0,
      recentSuccesses: 8,
      currentScore: 0,
    });
    expect(fixed.currentDifficulty).toBeLessThan(adaptive.currentDifficulty);
  });
});

describe('DodgeAI（对齐 dodge_ai.py）', () => {
  const config = loadDodgeMouseConfig(
    JSON.parse(fs.readFileSync(path.join(dataRoot, 'dodge_mouse.json'), 'utf8')),
    'standard',
  );
  const bounds = { x: 18, y: 62, width: 864, height: 480 };

  it('光标逼近时进入逃离相关状态并消耗体力冲刺', () => {
    const ai = new DodgeAI(config, () => 0);
    const rect = { x: 400, y: 280, width: 96, height: 96 };
    const cursor = { x: 448, y: 328 };
    let current = rect;
    for (let index = 0; index < 30; index += 1) {
      current = ai.update(current, bounds, cursor, cursor, 0.5, 1 / 60);
    }
    expect(['PREDICT_ESCAPE', 'DASH', 'FEINT', 'WALK_AWAY', 'BRAKE']).toContain(
      ai.state,
    );
  });

  it('体力耗尽进入疲劳状态', () => {
    const ai = new DodgeAI(config, () => 0);
    ai.stamina = 0;
    const rect = { x: 400, y: 280, width: 96, height: 96 };
    const cursor = { x: 100, y: 100 };
    ai.update(rect, bounds, cursor, cursor, 0.5, 1 / 60);
    expect(ai.state).toBe('TIRED');
  });
});

describe('DialogueSystem（对齐 dialogue_system.py）', () => {
  it('加载 data/dialogues.json 的全部 20 个分类', () => {
    const system = new DialogueSystem();
    system.loadFromFile(path.join(dataRoot, 'dialogues.json'));
    expect(system.categories().length).toBe(20);
  });

  it('未知分类回退 fallback，近期台词被抑制', () => {
    let now = 0;
    const system = new DialogueSystem(() => now);
    system.loadFromRecord({ welcome: ['第一句', '第二句'] });
    const pick = () =>
      system.pick('welcome', 'fallback', { random: () => 0 });
    expect(system.pick('unknown', 'fallback', { random: () => 0 })).toBe(
      'fallback',
    );
    expect(pick()).toBe('第一句');
    // 刚说过的台词进入近期列表，优先选另一句
    expect(pick()).toBe('第二句');
    // 30 分钟后冷却解除，可以再次选中第一句
    now = 1_900_000;
    expect(pick()).toBe('第一句');
  });

  it('主动台词有 60 秒冷却', () => {
    let now = 0;
    const system = new DialogueSystem(() => now);
    system.loadFromRecord({ hungry: ['饿了'] });
    expect(system.pick('hungry', 'x', { proactive: true })).toBe('饿了');
    expect(system.pick('hungry', 'x', { proactive: true })).toBe('');
    now = 61_000;
    expect(system.pick('hungry', 'x', { proactive: true })).toBe('饿了');
  });
});

describe('SleepSystem / EmotionSystem（对齐基准系统）', () => {
  const attributes = {
    hunger: 78,
    energy: 82,
    mood: 80,
    affection: 35,
    cleanliness: 90,
    curiosity: 68,
  };

  it('自动睡眠门槛：能量低于 18 或夜间低于 42', () => {
    const system = new SleepSystem();
    expect(system.shouldAutoSleep({ ...attributes, energy: 10 }, true, 12))
      .toBe(true);
    expect(system.shouldAutoSleep({ ...attributes, energy: 40 }, true, 23))
      .toBe(true);
    expect(system.shouldAutoSleep({ ...attributes, energy: 40 }, true, 12))
      .toBe(false);
    expect(system.shouldAutoSleep({ ...attributes, energy: 10 }, false, 12))
      .toBe(false);
    expect(system.shouldWake({ ...attributes, energy: 92 })).toBe(true);
    expect(system.shouldWake({ ...attributes, energy: 91 })).toBe(false);
    expect(system.shouldWake({ ...attributes, energy: 100 }, true)).toBe(false);
  });

  it('情绪优先级：疲劳 > 饥饿 > 悲伤 > 临时 > 开心', () => {
    const system = new EmotionSystem();
    expect(system.resolve({ ...attributes, energy: 10 }).emotion).toBe('tired');
    expect(
      system.resolve({ ...attributes, energy: 50, hunger: 10 }).emotion,
    ).toBe('hungry');
    expect(
      system.resolve({ ...attributes, energy: 50, mood: 10 }).emotion,
    ).toBe('sad');
    expect(
      system.resolve(attributes, { temporary: 'scared' }).emotion,
    ).toBe('scared');
    expect(
      system.resolve({ ...attributes, mood: 90, affection: 60 }).emotion,
    ).toBe('happy');
    expect(system.resolve(attributes).emotion).toBe('normal');
  });
});

describe('菜单构建（对齐 context_menu.py / tray_icon.py）', () => {
  const callbacks = {
    feedBread: noop,
    feedFries: noop,
    feedJuice: noop,
    play: noop,
    pet: noop,
    sleep: noop,
    wake: noop,
    rename: noop,
    cycleSkin: noop,
    petLibrary: noop,
    status: noop,
    inventory: noop,
    conversation: noop,
    growth: noop,
    focus: noop,
    memory: noop,
    privacy: noop,
    contentPacks: noop,
    catchFood: () => undefined,
    dodgeMouse: () => undefined,
    settings: noop,
    toggleLock: noop,
    toggleTopmost: noop,
    togglePause: noop,
    toggleMute: noop,
    resetPosition: noop,
    quit: noop,
  };

  const context = {
    behaviorState: 'IDLE',
    paused: false,
    positionLocked: false,
    alwaysOnTop: true,
    soundEnabled: true,
    canFeed: true,
    gameActive: false,
    gamePaused: false,
  };

  it('右键菜单包含基准全部条目与层级', () => {
    const items = buildPetMenuTemplate(context, callbacks);
    const labels = items.map((item) => item.label ?? '');
    for (const expected of [
      '喂食',
      '玩耍',
      '摸摸它',
      '让它睡觉',
      '更换名字',
      '切换宠物',
      '宠物管理',
      '打开状态面板',
      '打开宠物背包',
      '和宠物聊天',
      '成长与今日任务',
      '专注与健康提醒',
      '长期记忆',
      '隐私与数据',
      '内容包管理',
      '开始小游戏',
      '设置',
      '锁定位置',
      '始终置顶',
      '暂停宠物活动',
      '静音',
      '重置宠物位置',
      '退出程序',
    ]) {
      expect(labels).toContain(expected);
    }
    const feed = items.find((item) => item.label === '喂食');
    const feedSubmenu = (feed?.submenu ?? []) as Array<{ label?: string }>;
    expect(feedSubmenu.map((item) => item.label)).toEqual([
      '小面包',
      '香脆薯条',
      '能量果汁',
    ]);
    const games = items.find((item) => item.label === '开始小游戏');
    const gamesSubmenu = (games?.submenu ?? []) as Array<{
      label?: string;
      submenu?: Array<{ label?: string }>;
    }>;
    expect(gamesSubmenu.map((item) => item.label)).toEqual([
      '接食物',
      '躲避鼠标',
    ]);
    const catchSubmenu = gamesSubmenu[0]?.submenu ?? [];
    expect(catchSubmenu.map((item) => item.label)).toEqual([
      '轻松 · 45 秒',
      '标准 · 60 秒',
      '挑战 · 90 秒',
    ]);
  });

  it('睡眠状态把睡觉项切换为叫醒它并禁用玩耍', () => {
    const items = buildPetMenuTemplate(
      { ...context, behaviorState: 'SLEEP' },
      callbacks,
    );
    expect(items.map((item) => item.label ?? '')).toContain('叫醒它');
    const play = items.find((item) => item.label === '玩耍');
    expect(play?.enabled).toBe(false);
    const games = items.find((item) => item.label === '开始小游戏');
    expect(games?.enabled).toBe(false);
  });

  it('托盘菜单按基准顺序展示且游戏时出现退出项', () => {
    const trayCallbacks = {
      show: noop,
      hide: noop,
      feed: noop,
      toggleSleep: noop,
      status: noop,
      conversation: noop,
      growth: noop,
      focus: noop,
      petLibrary: noop,
      togglePause: noop,
      exitGame: noop,
      settings: noop,
      resetPosition: noop,
      quit: noop,
    };
    const items = buildTrayMenuTemplate(context, trayCallbacks);
    expect(items.map((item) => item.label ?? '')).toEqual([
      '显示宠物',
      '隐藏宠物',
      '',
      '喂食',
      '让它睡觉',
      '查看状态',
      '和宠物聊天',
      '成长与任务',
      '开始专注',
      '宠物管理',
      '暂停活动',
      '设置',
      '重置位置',
      '',
      '退出',
    ]);
    const gaming = buildTrayMenuTemplate(
      { ...context, gameActive: true, gamePaused: true },
      trayCallbacks,
    );
    const labels = gaming.map((item) => item.label ?? '');
    expect(labels).toContain('退出当前小游戏');
    expect(labels).toContain('继续小游戏');
  });
});

describe('设置归一化与存档档案（对齐 PetSettings.normalize / save_system）', () => {
  it('非法值回退到默认区间', () => {
    const normalized = normalizeSettings({
      ...DEFAULT_PET_SETTINGS,
      scale: 5,
      activityFrequency: 500,
      dialogueFrequency: -3,
      soundVolume: 101,
      gameTargetFps: 45,
      gameEffectLevel: 9,
      conversationMode: undefined,
    } as never);
    expect(normalized.scale).toBe(1.6);
    expect(normalized.activityFrequency).toBe(100);
    expect(normalized.dialogueFrequency).toBe(0);
    expect(normalized.soundVolume).toBe(100);
    expect(normalized.gameTargetFps).toBe(60);
    expect(normalized.gameEffectLevel).toBe(2);
  });

  it('存档档案导出后可完整导入恢复', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'desktop-pet-v2-save-'),
    );
    try {
      const first = new AssistantDatabase(path.join(directory, 'a.db'));
      first.initialize();
      first.addPetGrowth(120, 30);
      first.grantTitle('箱子研究员');
      const archive = first.exportArchive();
      first.close();

      const second = new AssistantDatabase(path.join(directory, 'b.db'));
      second.initialize();
      const result = second.importArchive(archive);
      expect(result.ok).toBe(true);
      const profile = second.getPetProfile();
      expect(profile.level).toBe(2);
      expect(profile.relationship).toBe(30);
      expect(profile.titles).toContain('箱子研究员');
      second.close();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('拒绝包含未知数据表的存档档案', () => {
    const database = new AssistantDatabase(':memory:');
    database.initialize();
    const result = database.importArchive({
      tables: { not_a_table: [{ a: 1 }] },
    });
    expect(result.ok).toBe(false);
    database.close();
  });
});
