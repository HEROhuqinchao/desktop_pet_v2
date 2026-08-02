import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CatchFoodGame } from '../src/games/catch-food-game';
import { DodgeMouseGame } from '../src/games/dodge-mouse-game';
import { FixedStepAccumulator } from '../src/games/fixed-step-loop';
import {
  loadCatchFoodConfig,
  loadDodgeMouseConfig,
} from '../src/games/game-configs';
import { ScoreSystem } from '../src/games/score-system';
import { AssistantDatabase } from '../src/persistence/assistant-database';

const dataRoot = path.join(__dirname, '..', 'data');

function readCatchConfig(mode: 'easy' | 'standard' | 'challenge' = 'standard') {
  return loadCatchFoodConfig(
    JSON.parse(fs.readFileSync(path.join(dataRoot, 'catch_food.json'), 'utf8')),
    mode,
  );
}

function readDodgeConfig(mode: 'easy' | 'standard' | 'challenge' = 'standard') {
  return loadDodgeMouseConfig(
    JSON.parse(fs.readFileSync(path.join(dataRoot, 'dodge_mouse.json'), 'utf8')),
    mode,
  );
}

describe('FixedStepAccumulator', () => {
  it('限制单帧更新时间和追帧次数', () => {
    const loop = new FixedStepAccumulator();
    let calls = 0;
    const result = loop.advance(1, () => {
      calls += 1;
    });
    expect(calls).toBe(5);
    expect(result.updateCount).toBe(5);
    expect(result.droppedRemainder).toBe(true);
  });
});

describe('ScoreSystem', () => {
  it('保持原项目的连击倍率、超时和惩罚规则', () => {
    const score = new ScoreSystem(1.8);
    for (let index = 0; index < 5; index += 1) {
      score.add(10);
    }
    expect(score.combo).toBe(5);
    expect(score.score).toBe(52);
    expect(score.comboMultiplier).toBe(1.2);
    score.update(2);
    expect(score.combo).toBe(0);
    expect(score.penalize(30)).toBe(-30);
    expect(score.score).toBe(22);
  });
});

describe('小游戏配置加载', () => {
  it('按难度载入时长与模式缩放（对齐 data/*.json）', () => {
    expect(readCatchConfig('easy').durationSeconds).toBe(45);
    expect(readCatchConfig('standard').durationSeconds).toBe(60);
    expect(readCatchConfig('challenge').durationSeconds).toBe(90);
    expect(readCatchConfig('challenge').modeSpeedScale).toBe(1.12);
    expect(readDodgeConfig('easy').reactionScale).toBe(1.25);
    expect(readDodgeConfig('challenge').scoreScale).toBe(1.2);
    expect(readCatchConfig().items.length).toBeGreaterThanOrEqual(14);
    expect(readCatchConfig().gradeThresholds).toEqual([2400, 1500, 850, 350]);
    expect(readDodgeConfig().gradeThresholds).toEqual([3500, 2400, 1500, 700]);
  });
});

describe('CatchFoodGame', () => {
  it('完成倒计时后按生成模式掉落食物并可接住得分', () => {
    const game = new CatchFoodGame(readCatchConfig(), () => 0);
    game.start();
    // 倒计时 3s
    for (let index = 0; index < 31; index += 1) {
      game.update(0.1);
    }
    expect(game.snapshot().phase).toBe('running');
    // random()=0 时首个物品落在左侧固定位置，把宠物移过去接
    game.setPointerTarget(0.08 * CatchFoodGame.WIDTH);
    for (let index = 0; index < 60 * 4; index += 1) {
      game.update(1 / 60);
    }
    const snapshot = game.snapshot();
    expect(snapshot.items.length + snapshot.caughtCount).toBeGreaterThan(0);
    expect(snapshot.caughtCount).toBeGreaterThan(0);
    expect(snapshot.score).toBeGreaterThanOrEqual(10);
  });

  it('炸弹在护盾耗尽后扣分并打断连击', () => {
    const config = readCatchConfig();
    const game = new CatchFoodGame(config, () => 0);
    game.start();
    for (let index = 0; index < 31; index += 1) {
      game.update(0.1);
    }
    const bomb = config.items.find((item) => item.itemId === 'bomb');
    expect(bomb).toBeDefined();
  });
});

describe('DodgeMouseGame', () => {
  it('玩家点击宠物后计分，点空会中断连击', () => {
    const game = new DodgeMouseGame(readDodgeConfig(), () => 1);
    game.start();
    for (let index = 0; index < 31; index += 1) {
      game.update(0.1);
    }
    const snapshot = game.snapshot();
    expect(
      game.click(
        snapshot.petX + snapshot.petSize / 2,
        snapshot.petY + snapshot.petSize / 2,
      ),
    ).toBe(true);
    expect(game.snapshot().score).toBe(100);
    game.update(0.4);
    expect(game.click(1, 1)).toBe(false);
    expect(game.snapshot().combo).toBe(0);
  });

  it('结算给出评价与命中率', () => {
    const game = new DodgeMouseGame(readDodgeConfig('easy'), () => 1);
    game.start();
    for (let index = 0; index < 31; index += 1) {
      game.update(0.1);
    }
    const result = game.cancel();
    expect(result.gameId).toBe('dodge_mouse');
    expect(result.finishReason).toBe('cancelled');
    expect(['S', 'A', 'B', 'C', 'D']).toContain(result.grade);
  });
});

describe('游戏记录与奖励', () => {
  const databases: AssistantDatabase[] = [];

  afterEach(() => {
    for (const database of databases.splice(0)) {
      database.close();
    }
  });

  it('保存最高分、次数并按原规则计算每日奖励', () => {
    const database = new AssistantDatabase(':memory:');
    databases.push(database);
    database.initialize();
    const first = database.recordGameResult({
      gameId: 'catch_food',
      score: 900,
      grade: 'B',
      durationSeconds: 60,
      maxCombo: 15,
      accuracy: 0.8,
      caughtCount: 16,
      droppedCount: 4,
      hitCount: 0,
      missCount: 0,
      finishReason: 'completed',
    });
    expect(first.rewards).toEqual({
      experience: 6,
      affection: 2,
      hunger: 4,
      mood: 3,
      energy: 0,
    });
    expect(first.record).toMatchObject({
      highScore: 900,
      playCount: 1,
      bestCombo: 15,
      bestGrade: 'B',
    });

    const second = database.recordGameResult({
      gameId: 'catch_food',
      score: 300,
      grade: 'D',
      durationSeconds: 12,
      maxCombo: 2,
      accuracy: 0.2,
      caughtCount: 1,
      droppedCount: 4,
      hitCount: 0,
      missCount: 0,
      finishReason: 'cancelled',
    });
    expect(second.rewards).toEqual({
      experience: 0,
      affection: 0,
      hunger: 0,
      mood: 0,
      energy: 0,
    });
    expect(second.record).toMatchObject({
      highScore: 900,
      playCount: 2,
      bestGrade: 'B',
    });
  });
});
