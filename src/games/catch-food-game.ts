import type { GameResult } from '../shared/contracts';
import { DifficultyDirector } from './difficulty-director';
import { EffectSystem } from './effect-system';
import type { CatchFoodConfig, CatchItemConfig } from './game-configs';
import { ScoreSystem } from './score-system';
import { SpawnDirector } from './spawn-director';

export type GamePhase =
  | 'ready'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'result';

export const CATCH_SPECIAL_EVENTS = [
  'BIG_EATER',
  'TRUE_FALSE_FOOD',
  'BASKETBALL_FEED',
  'GIANT_BURGER',
  'FOOD_STORM',
  'BOSS_INSPECTION',
] as const;

export type CatchSpecialEvent = (typeof CATCH_SPECIAL_EVENTS)[number];

export interface FallingItem {
  entityId: number;
  config: CatchItemConfig;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  size: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  warningRemaining: number;
  contactRemaining: number;
}

export interface FloatingText {
  text: string;
  x: number;
  y: number;
  color: string;
  remaining: number;
}

export interface CatchFoodSnapshot {
  phase: GamePhase;
  score: number;
  combo: number;
  comboMultiplier: number;
  maxCombo: number;
  remainingSeconds: number;
  countdownSeconds: number;
  petX: number;
  petY: number;
  petWidth: number;
  petHeight: number;
  items: FallingItem[];
  caughtCount: number;
  droppedCount: number;
  feverRemaining: number;
  shieldCharges: number;
  magnetRemaining: number;
  doubleScoreRemaining: number;
  reverseControlRemaining: number;
  stageName: string;
  specialEventText: string;
  effects: FloatingText[];
}

const STAGE_NAMES = ['热身', '提速', '混合', '最终冲刺'] as const;

/**
 * 接食物玩法，完整移植 desktop_pet games/catch_food/catch_food_game.py：
 * 连击/狂热、道具、危险物、8 种生成模式、自适应难度与 6 种特殊事件。
 */
export class CatchFoodGame {
  static readonly WIDTH = 880;
  static readonly HEIGHT = 560;
  static readonly PET_WIDTH = 92;
  static readonly PET_HEIGHT = 78;
  static readonly FLOOR_HEIGHT = 36;

  private phase: GamePhase = 'ready';
  private previousPhase: GamePhase = 'running';
  private countdownSeconds: number;
  private elapsedSeconds = 0;
  private baseDuration: number;
  private durationSeconds: number;
  private scoreSystem: ScoreSystem;
  private spawnDirector: SpawnDirector;
  private difficulty: DifficultyDirector;
  private effects = new EffectSystem();
  private petX = (CatchFoodGame.WIDTH - CatchFoodGame.PET_WIDTH) / 2;
  private petVelocityX = 0;
  private direction = 0;
  private pointerTargetX: number | null = null;
  private entitySequence = 0;
  private items: FallingItem[] = [];
  private caughtCount = 0;
  private droppedCount = 0;
  private specialItemCount = 0;
  private recentSuccesses = 0;
  private recentFailures = 0;
  private lastDangerElapsed = 99;
  private specialAccumulator = 0;
  private specialEvent: CatchSpecialEvent | null = null;
  private specialRemaining = 0;
  private bossRewardSpawned = false;
  private shieldCharges = 0;
  private magnetRemaining = 0;
  private doubleScoreRemaining = 0;
  private reverseControlRemaining = 0;
  private feverRemaining = 0;
  private dangerProtectionRemaining = 0;
  private result: GameResult | null = null;

  constructor(
    private readonly config: CatchFoodConfig,
    private readonly random: () => number = Math.random,
  ) {
    this.countdownSeconds = config.countdownSeconds;
    this.baseDuration = config.durationSeconds;
    this.durationSeconds = config.durationSeconds;
    this.scoreSystem = new ScoreSystem(config.comboTimeoutSeconds);
    this.spawnDirector = new SpawnDirector(config, random);
    this.difficulty = new DifficultyDirector('standard', config.adaptive);
  }

  get feverActive(): boolean {
    return this.feverRemaining > 0;
  }

  start(): void {
    this.phase = 'countdown';
    this.previousPhase = 'running';
    this.countdownSeconds = this.config.countdownSeconds;
    this.elapsedSeconds = 0;
    this.baseDuration = this.config.durationSeconds;
    this.durationSeconds = this.config.durationSeconds;
    this.scoreSystem = new ScoreSystem(this.config.comboTimeoutSeconds);
    this.spawnDirector = new SpawnDirector(this.config, this.random);
    this.difficulty = new DifficultyDirector('standard', this.config.adaptive);
    this.effects = new EffectSystem();
    this.petX = (CatchFoodGame.WIDTH - CatchFoodGame.PET_WIDTH) / 2;
    this.petVelocityX = 0;
    this.direction = 0;
    this.pointerTargetX = null;
    this.entitySequence = 0;
    this.items = [];
    this.caughtCount = 0;
    this.droppedCount = 0;
    this.specialItemCount = 0;
    this.recentSuccesses = 0;
    this.recentFailures = 0;
    this.lastDangerElapsed = 99;
    this.specialAccumulator = 0;
    this.specialEvent = null;
    this.specialRemaining = 0;
    this.bossRewardSpawned = false;
    this.shieldCharges = 0;
    this.magnetRemaining = 0;
    this.doubleScoreRemaining = 0;
    this.reverseControlRemaining = 0;
    this.feverRemaining = 0;
    this.dangerProtectionRemaining = 0;
    this.result = null;
  }

  update(elapsedSeconds: number): void {
    const dt = clamp(elapsedSeconds, 0, 0.1);
    if (this.phase === 'countdown') {
      this.countdownSeconds = Math.max(0, this.countdownSeconds - dt);
      if (this.countdownSeconds <= 0) {
        this.phase = 'running';
      }
      return;
    }
    if (this.phase !== 'running') {
      return;
    }
    this.elapsedSeconds += dt;
    this.fixedUpdate(dt);
    if (this.remainingSeconds() <= 0) {
      this.finish('completed');
    }
  }

  setDirection(direction: number): void {
    this.direction = clamp(direction, -1, 1);
    if (direction !== 0) {
      this.pointerTargetX = null;
    }
  }

  setPointerTarget(x: number | null): void {
    this.pointerTargetX = x === null
      ? null
      : clamp(
        x - CatchFoodGame.PET_WIDTH / 2,
        0,
        CatchFoodGame.WIDTH - CatchFoodGame.PET_WIDTH,
      );
  }

  togglePause(): void {
    if (this.phase === 'paused') {
      this.phase = this.previousPhase;
      return;
    }
    if (this.phase === 'running' || this.phase === 'countdown') {
      this.previousPhase = this.phase;
      this.phase = 'paused';
    }
  }

  cancel(): GameResult {
    return this.finish('cancelled');
  }

  snapshot(): CatchFoodSnapshot {
    return {
      phase: this.phase,
      score: this.scoreSystem.score,
      combo: this.scoreSystem.combo,
      comboMultiplier: this.scoreSystem.comboMultiplier,
      maxCombo: this.scoreSystem.maxCombo,
      remainingSeconds: this.remainingSeconds(),
      countdownSeconds: this.countdownSeconds,
      petX: this.petX,
      petY:
        CatchFoodGame.HEIGHT
        - CatchFoodGame.FLOOR_HEIGHT
        - CatchFoodGame.PET_HEIGHT,
      petWidth: CatchFoodGame.PET_WIDTH,
      petHeight: CatchFoodGame.PET_HEIGHT,
      items: this.items.map((entry) => ({ ...entry })),
      caughtCount: this.caughtCount,
      droppedCount: this.droppedCount,
      feverRemaining: this.feverRemaining,
      shieldCharges: this.shieldCharges,
      magnetRemaining: this.magnetRemaining,
      doubleScoreRemaining: this.doubleScoreRemaining,
      reverseControlRemaining: this.reverseControlRemaining,
      stageName: this.stageName(),
      specialEventText: this.specialEventText(),
      effects: this.effects.effects.map((effect) => ({
        text: effect.text,
        x: effect.x,
        y: effect.y,
        color: effect.color,
        remaining: effect.remaining,
      })),
    };
  }

  gameResult(): GameResult | null {
    return this.result ? { ...this.result } : null;
  }

  private fixedUpdate(dt: number): void {
    const feverBefore = this.feverActive;
    this.updateEffectTimers(dt);
    if (feverBefore && !this.feverActive) {
      this.dangerProtectionRemaining = this.config.feverProtectionSeconds;
      this.effects.addText(
        '狂热结束，危险保护！',
        CatchFoodGame.WIDTH / 2,
        120,
        '#E39C26',
        { priority: 2 },
      );
    }
    this.lastDangerElapsed += dt;
    this.scoreSystem.update(dt);
    this.effects.update(dt);
    this.updatePet(dt);
    this.updateSpecialEvent(dt);

    const progress = Math.min(
      1,
      this.elapsedSeconds / Math.max(1, this.baseDuration),
    );
    const totalAttempts = this.caughtCount + this.droppedCount;
    const difficulty = this.difficulty.update(progress, {
      hitRate: this.caughtCount / Math.max(1, totalAttempts),
      combo: this.scoreSystem.combo,
      recentFailures: this.recentFailures,
      recentSuccesses: this.recentSuccesses,
      currentScore: this.scoreSystem.score,
    });
    const spawnBoost =
      this.feverActive
      || this.specialEvent === 'BIG_EATER'
      || this.specialEvent === 'FOOD_STORM';
    if (this.specialEvent !== 'BOSS_INSPECTION') {
      for (
        const request of this.spawnDirector.update(dt, difficulty, {
          fever: spawnBoost,
          activeCount: this.items.length,
        })
      ) {
        this.spawn(
          request.item,
          request.positionRatio,
          request.horizontalVelocity,
          difficulty,
        );
      }
    }
    this.updateEntities(dt);
    if (
      this.scoreSystem.combo >= this.config.feverComboThreshold
      && this.lastDangerElapsed >= this.config.feverDangerFreeSeconds
      && !this.feverActive
    ) {
      this.feverRemaining = this.config.feverDurationSeconds;
      this.effects.addText(
        '狂热模式！',
        CatchFoodGame.WIDTH / 2,
        105,
        '#F5A623',
        { priority: 3, duration: 1.2 },
      );
    }
  }

  private updateEffectTimers(dt: number): void {
    this.magnetRemaining = Math.max(0, this.magnetRemaining - dt);
    this.doubleScoreRemaining = Math.max(0, this.doubleScoreRemaining - dt);
    this.reverseControlRemaining = Math.max(
      0,
      this.reverseControlRemaining - dt,
    );
    this.feverRemaining = Math.max(0, this.feverRemaining - dt);
    this.dangerProtectionRemaining = Math.max(
      0,
      this.dangerProtectionRemaining - dt,
    );
  }

  private updatePet(dt: number): void {
    let keyboardDirection = this.direction;
    if (this.reverseControlRemaining > 0) {
      keyboardDirection *= -1;
    }
    if (keyboardDirection !== 0) {
      this.petVelocityX +=
        keyboardDirection * this.config.petAcceleration * dt;
      this.pointerTargetX = null;
    } else if (this.pointerTargetX !== null) {
      let distance = this.pointerTargetX - this.petX;
      if (this.reverseControlRemaining > 0) {
        distance *= -1;
      }
      this.petVelocityX += distance * this.config.mouseFollowStrength * dt;
    } else {
      this.petVelocityX *= this.config.petFriction;
    }
    this.petVelocityX = clamp(
      this.petVelocityX,
      -this.config.petMaxSpeed,
      this.config.petMaxSpeed,
    );
    this.petX += this.petVelocityX * dt;
    const maximumX = Math.max(0, CatchFoodGame.WIDTH - CatchFoodGame.PET_WIDTH);
    if (this.petX <= 0) {
      this.petX = 0;
      this.petVelocityX = Math.max(0, this.petVelocityX);
    } else if (this.petX >= maximumX) {
      this.petX = maximumX;
      this.petVelocityX = Math.min(0, this.petVelocityX);
    }
  }

  private spawn(
    source: CatchItemConfig,
    positionRatio: number,
    horizontalVelocity: number,
    difficulty: number,
  ): void {
    let item = source;
    if (
      this.specialEvent === 'TRUE_FALSE_FOOD'
      && (item.category === 'normal_food' || item.category === 'premium_food')
      && this.random() < 0.32
    ) {
      const replacement = this.itemById(
        this.random() < 0.28 ? 'golden_drumstick' : 'empty_plate',
      );
      if (replacement) {
        item = replacement;
      }
    }
    if (this.items.length >= this.config.maxActiveEntities) {
      return;
    }
    const giant = this.specialEvent === 'GIANT_BURGER' && item.itemId === 'burger';
    const size = giant ? 86 : item.category === 'rare_food' ? 46 : 38;
    const x = clamp(
      positionRatio * CatchFoodGame.WIDTH,
      4,
      CatchFoodGame.WIDTH - size - 4,
    );
    let speed =
      item.minimumSpeed
      + (item.maximumSpeed - item.minimumSpeed) * this.random();
    speed *= this.config.modeSpeedScale * (0.92 + difficulty * 0.18);
    this.entitySequence += 1;
    this.items.push({
      entityId: this.entitySequence,
      config: item,
      x,
      y: 48 - size,
      previousX: x,
      previousY: 48 - size,
      size,
      velocityX: horizontalVelocity,
      velocityY: speed,
      rotation: 0,
      warningRemaining: 0.15 + this.random() * 0.1,
      contactRemaining: giant ? 0.45 : 0,
    });
  }

  private updateEntities(dt: number): void {
    const petRect = this.petHitbox();
    const survivors: FallingItem[] = [];
    for (const entity of this.items) {
      entity.previousX = entity.x;
      entity.previousY = entity.y;
      if (entity.warningRemaining > 0) {
        entity.warningRemaining = Math.max(0, entity.warningRemaining - dt);
        survivors.push(entity);
        continue;
      }
      entity.velocityY += this.config.gravity * dt;
      const patternName = this.spawnDirector.pattern;
      if (
        patternName.endsWith('RAIN')
        || this.specialEvent === 'FOOD_STORM'
      ) {
        const direction = patternName.includes('LEFT') ? 1 : -1;
        entity.velocityX += direction * this.config.windStrength * dt;
      }
      if (
        this.magnetRemaining > 0
        && (entity.config.category === 'normal_food'
          || entity.config.category === 'premium_food'
          || entity.config.category === 'rare_food')
      ) {
        const petCenterX = petRect.x + petRect.width / 2;
        const petCenterY = petRect.y + petRect.height / 2;
        const itemCenterX = entity.x + entity.size / 2;
        const itemCenterY = entity.y + entity.size / 2;
        const distance = Math.hypot(
          petCenterX - itemCenterX,
          petCenterY - itemCenterY,
        );
        if (distance <= this.config.magnetRadius) {
          entity.velocityX += (petCenterX - itemCenterX) * 7 * dt;
          entity.velocityY += (petCenterY - itemCenterY) * 2.2 * dt;
        }
      }
      entity.x += entity.velocityX * dt;
      entity.y += entity.velocityY * dt;
      entity.rotation =
        (entity.rotation + entity.velocityX * dt * 0.08) % 360;
      if (entity.x < 0 || entity.x + entity.size > CatchFoodGame.WIDTH) {
        entity.x = clamp(entity.x, 0, CatchFoodGame.WIDTH - entity.size);
        entity.velocityX *= -0.55;
      }
      const current = scaledHitbox(entity, entity.config.hitboxScale);
      const previous = scaledHitbox(
        { ...entity, x: entity.previousX, y: entity.previousY },
        entity.config.hitboxScale,
      );
      if (sweptRectIntersects(previous, current, petRect)) {
        if (entity.contactRemaining > 0) {
          entity.contactRemaining = Math.max(0, entity.contactRemaining - dt);
          entity.velocityY = Math.min(entity.velocityY, 38);
          entity.y = Math.min(entity.y, petRect.y - entity.size * 0.55);
          survivors.push(entity);
        } else {
          this.resolveCatch(entity);
        }
        continue;
      }
      if (entity.y > CatchFoodGame.HEIGHT + entity.size) {
        if (
          entity.config.category === 'normal_food'
          || entity.config.category === 'premium_food'
          || entity.config.category === 'rare_food'
        ) {
          this.droppedCount += 1;
          this.recentFailures = Math.min(8, this.recentFailures + 1);
          this.recentSuccesses = Math.max(0, this.recentSuccesses - 1);
        }
        continue;
      }
      survivors.push(entity);
    }
    this.items = survivors;
  }

  private resolveCatch(entity: FallingItem): void {
    const item = entity.config;
    const centerX = entity.x + entity.size / 2;
    const centerY = entity.y + entity.size / 2;
    this.caughtCount += 1;
    this.recentSuccesses = Math.min(8, this.recentSuccesses + 1);
    this.recentFailures = Math.max(0, this.recentFailures - 1);
    let multiplier = this.doubleScoreRemaining > 0 ? 2 : 1;
    if (this.feverActive) {
      multiplier *= this.config.feverScoreMultiplier;
    }
    if (item.effect === 'bomb') {
      this.lastDangerElapsed = 0;
      if (this.shieldCharges > 0) {
        this.shieldCharges -= 1;
        this.effects.addText('护盾抵消', centerX, centerY, '#5C9DED', {
          priority: 2,
        });
      } else if (this.dangerProtectionRemaining > 0) {
        this.effects.addText('危险保护', centerX, centerY, '#E5B33C', {
          priority: 2,
        });
      } else {
        const delta = this.scoreSystem.penalize(Math.abs(item.score));
        this.effects.addText(String(delta), centerX, centerY, '#E64747', {
          priority: 3,
        });
      }
    } else if (item.effect === 'reverse_control') {
      this.scoreSystem.breakCombo();
      this.reverseControlRemaining = this.config.reverseControlDurationSeconds;
      this.effects.addText('方向混乱！', centerX, centerY, '#E64747', {
        priority: 2,
      });
    } else if (item.effect === 'empty') {
      this.effects.addText('盘子很努力，但它是空的', centerX, centerY, '#687987');
    } else {
      const { delta, milestone } = this.scoreSystem.add(item.score, {
        temporaryMultiplier: multiplier,
      });
      const color = this.feverActive ? '#E9A827' : '#3B8F58';
      this.effects.addText(`+${delta}`, centerX, centerY, color, {
        priority: milestone ? 2 : 1,
      });
      if (milestone) {
        this.effects.addText(
          `${this.scoreSystem.combo} 连击！`,
          CatchFoodGame.WIDTH / 2,
          135,
          '#F09235',
          { priority: 3 },
        );
      }
      this.applyPowerup(item);
    }
    if (item.category === 'powerup' || item.category === 'rare_food') {
      this.specialItemCount += 1;
    }
    if (this.specialEvent === 'BASKETBALL_FEED') {
      this.effects.addText(
        '接球，投篮！',
        this.petX + CatchFoodGame.PET_WIDTH / 2,
        CatchFoodGame.HEIGHT - 135,
        '#D96F2F',
        { priority: 2 },
      );
    }
  }

  private updateSpecialEvent(dt: number): void {
    this.specialAccumulator += dt;
    if (this.specialRemaining > 0) {
      this.specialRemaining = Math.max(0, this.specialRemaining - dt);
      if (
        this.specialEvent === 'BOSS_INSPECTION'
        && this.specialRemaining <= 1
        && !this.bossRewardSpawned
      ) {
        this.bossRewardSpawned = true;
        const drumstick = this.itemById('golden_drumstick');
        if (drumstick) {
          this.spawn(drumstick, 0.5, 0, 0.3);
        }
      }
      if (this.specialRemaining <= 0) {
        this.specialEvent = null;
      }
      return;
    }
    if (this.specialAccumulator < this.config.specialEventIntervalSeconds) {
      return;
    }
    this.specialAccumulator -= this.config.specialEventIntervalSeconds;
    if (this.random() >= this.config.specialEventProbability) {
      return;
    }
    this.specialEvent =
      CATCH_SPECIAL_EVENTS[
        Math.floor(this.random() * CATCH_SPECIAL_EVENTS.length)
      ] ?? 'BIG_EATER';
    this.specialRemaining = this.config.specialEventDurationSeconds;
    this.bossRewardSpawned = false;
    if (this.specialEvent === 'GIANT_BURGER') {
      const burger = this.itemById('burger');
      if (burger) {
        this.spawn(burger, 0.5, 0, 0.4);
      }
    }
    this.effects.addText(
      this.specialEventText(),
      CatchFoodGame.WIDTH / 2,
      108,
      '#A15A9D',
      { priority: 3, duration: 1.2 },
    );
  }

  private specialEventText(): string {
    switch (this.specialEvent) {
      case 'BIG_EATER':
        return '大胃王时间';
      case 'TRUE_FALSE_FOOD':
        return '真假食物';
      case 'BASKETBALL_FEED':
        return '篮球投食';
      case 'GIANT_BURGER':
        return '巨型汉堡';
      case 'FOOD_STORM':
        return '食物暴风雨';
      case 'BOSS_INSPECTION':
        return '老板巡视：先假装认真工作';
      default:
        return '';
    }
  }

  private applyPowerup(item: CatchItemConfig): void {
    if (item.effect === 'add_time') {
      this.durationSeconds = Math.min(
        this.baseDuration + this.config.maximumTimeBonusSeconds,
        this.durationSeconds + this.config.addTimeSeconds,
      );
    } else if (item.effect === 'magnet') {
      this.magnetRemaining = this.config.magnetDurationSeconds;
    } else if (item.effect === 'shield') {
      this.shieldCharges += 1;
    } else if (item.effect === 'double_score') {
      this.doubleScoreRemaining = this.config.doubleScoreDurationSeconds;
    }
  }

  private itemById(itemId: string): CatchItemConfig | null {
    return this.config.items.find((entry) => entry.itemId === itemId) ?? null;
  }

  private petHitbox(): { x: number; y: number; width: number; height: number } {
    const petY =
      CatchFoodGame.HEIGHT
      - CatchFoodGame.FLOOR_HEIGHT
      - CatchFoodGame.PET_HEIGHT;
    const width = CatchFoodGame.PET_WIDTH * 0.68;
    const height = CatchFoodGame.PET_HEIGHT * 0.55;
    return {
      x: this.petX + (CatchFoodGame.PET_WIDTH - width) / 2,
      y: petY + CatchFoodGame.PET_HEIGHT - height,
      width,
      height,
    };
  }

  private stageName(): string {
    const progress = this.elapsedSeconds / Math.max(1, this.baseDuration);
    if (progress < 0.25) {
      return STAGE_NAMES[0] ?? '';
    }
    if (progress < 0.5) {
      return STAGE_NAMES[1] ?? '';
    }
    if (progress < 0.75) {
      return STAGE_NAMES[2] ?? '';
    }
    return STAGE_NAMES[3] ?? '';
  }

  private remainingSeconds(): number {
    return Math.max(0, this.durationSeconds - this.elapsedSeconds);
  }

  private finish(finishReason: GameResult['finishReason']): GameResult {
    if (this.result) {
      return this.result;
    }
    this.phase = 'result';
    const attempts = this.caughtCount + this.droppedCount;
    this.result = {
      gameId: 'catch_food',
      score: this.scoreSystem.score,
      grade: ScoreSystem.grade(
        this.scoreSystem.score,
        this.config.gradeThresholds,
      ),
      durationSeconds: this.elapsedSeconds,
      maxCombo: this.scoreSystem.maxCombo,
      accuracy: this.caughtCount / Math.max(1, attempts),
      caughtCount: this.caughtCount,
      droppedCount: this.droppedCount,
      hitCount: 0,
      missCount: 0,
      finishReason,
    };
    return this.result;
  }
}

interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

function scaledHitbox(entity: FallingItem, scale: number): RectLike {
  const width = entity.size * scale;
  const height = entity.size * scale;
  return {
    x: entity.x + (entity.size - width) / 2,
    y: entity.y + (entity.size - height) / 2,
    width,
    height,
  };
}

function intersects(a: RectLike, b: RectLike): boolean {
  return (
    a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
  );
}

/**
 * 扫掠矩形碰撞，移植 desktop_pet games/collision_system.py 的
 * swept_rect_intersects（端点 + 联合包围盒 + 中心插值探测）。
 */
function sweptRectIntersects(
  previous: RectLike,
  current: RectLike,
  target: RectLike,
): boolean {
  if (intersects(previous, target) || intersects(current, target)) {
    return true;
  }
  const union: RectLike = {
    x: Math.min(previous.x, current.x),
    y: Math.min(previous.y, current.y),
    width: 0,
    height: 0,
  };
  union.width =
    Math.max(previous.x + previous.width, current.x + current.width) - union.x;
  union.height =
    Math.max(previous.y + previous.height, current.y + current.height) - union.y;
  if (!intersects(union, target)) {
    return false;
  }
  const previousCenterX = previous.x + previous.width / 2;
  const previousCenterY = previous.y + previous.height / 2;
  const deltaX = current.x + current.width / 2 - previousCenterX;
  const deltaY = current.y + current.height / 2 - previousCenterY;
  const steps = Math.max(
    1,
    Math.min(12, Math.round(Math.max(Math.abs(deltaX), Math.abs(deltaY)) / 8)),
  );
  for (let index = 1; index < steps; index += 1) {
    const ratio = index / steps;
    const probe: RectLike = {
      ...current,
      x: previousCenterX + deltaX * ratio - current.width / 2,
      y: previousCenterY + deltaY * ratio - current.height / 2,
    };
    if (intersects(probe, target)) {
      return true;
    }
  }
  return false;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
