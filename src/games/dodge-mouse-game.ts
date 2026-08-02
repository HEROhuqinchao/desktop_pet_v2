import type { GameResult } from '../shared/contracts';
import { CursorPredictor } from './cursor-predictor';
import { DifficultyDirector } from './difficulty-director';
import { DodgeAI } from './dodge-ai';
import type { Rect } from './dodge-ai';
import { EffectSystem } from './effect-system';
import type { DodgeMouseConfig } from './game-configs';
import { ScoreSystem } from './score-system';

export type GamePhase =
  | 'ready'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'result';

export const DODGE_SPECIAL_EVENTS = [
  'SHADOW_CLONE',
  'SUDDEN_BRAKE',
  'REVERSE_FEINT',
  'SUNGLASSES_TAUNT',
  'BASKETBALL',
  'STAGE_SING',
] as const;

export type DodgeSpecialEvent = (typeof DODGE_SPECIAL_EVENTS)[number];

export interface DodgeMouseSnapshot {
  phase: GamePhase;
  score: number;
  combo: number;
  comboMultiplier: number;
  maxCombo: number;
  remainingSeconds: number;
  countdownSeconds: number;
  petX: number;
  petY: number;
  petSize: number;
  velocityX: number;
  velocityY: number;
  stamina: number;
  staminaMaximum: number;
  dodgeState: string;
  dashRemaining: number;
  stunnedRemaining: number;
  tauntRemaining: number;
  hitCount: number;
  missCount: number;
  accuracy: number;
  pointerX: number | null;
  pointerY: number | null;
  warningRadius: number;
  dangerRadius: number;
  decoys: Rect[];
  specialEventText: string;
  effects: Array<{ text: string; x: number; y: number; color: string }>;
}

/**
 * 躲避鼠标玩法，完整移植 desktop_pet
 * games/dodge_mouse/dodge_mouse_game.py：光标预测、反应延迟、
 * 冲刺/假动作/疲劳 AI 与 6 种特殊事件。
 */
export class DodgeMouseGame {
  static readonly WIDTH = 900;
  static readonly HEIGHT = 560;
  static readonly PET_SIZE = 96;
  static readonly HEADER_HEIGHT = 62;
  static readonly MARGIN = 18;

  private phase: GamePhase = 'ready';
  private previousPhase: GamePhase = 'running';
  private countdownSeconds: number;
  private elapsedSeconds = 0;
  private durationSeconds: number;
  private scoreSystem: ScoreSystem;
  private ai: DodgeAI;
  private predictor = new CursorPredictor();
  private difficulty: DifficultyDirector;
  private effects = new EffectSystem();
  private petRect: Rect;
  private previousPetRect: Rect;
  private pointerX: number | null = null;
  private pointerY: number | null = null;
  private hitCount = 0;
  private missCount = 0;
  private specialHitCount = 0;
  private recentSuccesses = 0;
  private recentFailures = 0;
  private reactionSamples: number[] = [];
  private lastThreatAt = 0;
  private wasDangerous = false;
  private specialAccumulator = 0;
  private specialEvent: DodgeSpecialEvent | null = null;
  private specialRemaining = 0;
  private decoys: Rect[] = [];
  private stageEscapeUsed = false;
  private result: GameResult | null = null;

  constructor(
    private readonly config: DodgeMouseConfig,
    private readonly random: () => number = Math.random,
  ) {
    this.countdownSeconds = config.countdownSeconds;
    this.durationSeconds = config.durationSeconds;
    this.scoreSystem = new ScoreSystem(config.comboTimeoutSeconds);
    this.ai = new DodgeAI(config, random);
    this.difficulty = new DifficultyDirector('standard', true);
    this.petRect = this.centerRect();
    this.previousPetRect = { ...this.petRect };
  }

  start(): void {
    this.phase = 'countdown';
    this.previousPhase = 'running';
    this.countdownSeconds = this.config.countdownSeconds;
    this.elapsedSeconds = 0;
    this.durationSeconds = this.config.durationSeconds;
    this.scoreSystem = new ScoreSystem(this.config.comboTimeoutSeconds);
    this.ai = new DodgeAI(this.config, this.random);
    this.predictor.reset();
    this.difficulty = new DifficultyDirector('standard', true);
    this.effects = new EffectSystem();
    this.petRect = this.centerRect();
    this.previousPetRect = { ...this.petRect };
    this.pointerX = null;
    this.pointerY = null;
    this.hitCount = 0;
    this.missCount = 0;
    this.specialHitCount = 0;
    this.recentSuccesses = 0;
    this.recentFailures = 0;
    this.reactionSamples = [];
    this.lastThreatAt = 0;
    this.wasDangerous = false;
    this.specialAccumulator = 0;
    this.specialEvent = null;
    this.specialRemaining = 0;
    this.decoys = [];
    this.stageEscapeUsed = false;
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

  setPointer(x: number | null, y: number | null): void {
    this.pointerX = x === null ? null : clamp(x, 0, DodgeMouseGame.WIDTH);
    this.pointerY = y === null
      ? null
      : clamp(y, DodgeMouseGame.HEADER_HEIGHT, DodgeMouseGame.HEIGHT);
  }

  click(x: number, y: number): boolean {
    if (this.phase !== 'running') {
      return false;
    }
    const hitCurrent = ellipseContains(this.petRect, x, y, this.config.hitboxInflate);
    const hitPrevious = ellipseContains(
      this.previousPetRect,
      x,
      y,
      this.config.hitboxInflate,
    );
    const canScore = this.ai.state !== 'STUNNED';
    if ((hitCurrent || hitPrevious) && canScore) {
      const previousState = this.ai.state;
      let bonus = 0;
      if (previousState === 'TAUNT') {
        bonus += this.config.tauntBonus;
      }
      if (previousState === 'DASH') {
        bonus += this.config.dashBonus;
      }
      const base = Math.round(
        (this.config.baseHitScore + bonus) * this.config.scoreScale,
      );
      const { milestone } = this.scoreSystem.add(base);
      this.hitCount += 1;
      this.recentSuccesses = Math.min(8, this.recentSuccesses + 1);
      this.recentFailures = Math.max(0, this.recentFailures - 1);
      const reactionMs = Math.max(
        0,
        (this.elapsedSeconds - this.lastThreatAt) * 1000,
      );
      this.reactionSamples.push(Math.min(3000, reactionMs));
      if (bonus > 0) {
        this.specialHitCount += 1;
      }
      this.effects.addText(
        `+${this.scoreSystem.score}`,
        this.petRect.x + this.petRect.width / 2,
        this.petRect.y + this.petRect.height / 2,
        '#4B9A64',
        { priority: bonus > 0 || milestone ? 3 : 1 },
      );
      if (this.specialEvent === 'STAGE_SING' && !this.stageEscapeUsed) {
        this.stageEscapeUsed = true;
        this.ai.forceState('PREDICT_ESCAPE', this.config.dashWindupSeconds);
      } else {
        this.ai.forceState('STUNNED', this.config.stunnedDurationSeconds);
      }
      return true;
    }
    this.missCount += 1;
    this.recentFailures = Math.min(8, this.recentFailures + 1);
    this.recentSuccesses = Math.max(0, this.recentSuccesses - 1);
    this.scoreSystem.breakCombo();
    this.effects.addText('差一点', x, y, '#7C6C8E');
    return false;
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

  snapshot(): DodgeMouseSnapshot {
    const total = this.hitCount + this.missCount;
    return {
      phase: this.phase,
      score: this.scoreSystem.score,
      combo: this.scoreSystem.combo,
      comboMultiplier: this.scoreSystem.comboMultiplier,
      maxCombo: this.scoreSystem.maxCombo,
      remainingSeconds: this.remainingSeconds(),
      countdownSeconds: this.countdownSeconds,
      petX: this.petRect.x,
      petY: this.petRect.y,
      petSize: this.petRect.width,
      velocityX: this.ai.velocity.x,
      velocityY: this.ai.velocity.y,
      stamina: this.ai.stamina,
      staminaMaximum: this.config.staminaMaximum,
      dodgeState: this.ai.state,
      dashRemaining: this.ai.state === 'DASH' ? this.ai.stateRemaining : 0,
      stunnedRemaining:
        this.ai.state === 'STUNNED' ? this.ai.stateRemaining : 0,
      tauntRemaining: this.ai.state === 'TAUNT' ? this.ai.stateRemaining : 0,
      hitCount: this.hitCount,
      missCount: this.missCount,
      accuracy: this.hitCount / Math.max(1, total),
      pointerX: this.pointerX,
      pointerY: this.pointerY,
      warningRadius: this.petRect.width * this.config.warningRadiusScale,
      dangerRadius: this.petRect.width * this.config.dangerRadiusScale,
      decoys: this.decoys.map((decoy) => ({ ...decoy })),
      specialEventText: this.specialEventText(),
      effects: this.effects.effects.map((effect) => ({
        text: effect.text,
        x: effect.x,
        y: effect.y,
        color: effect.color,
      })),
    };
  }

  gameResult(): GameResult | null {
    return this.result ? { ...this.result } : null;
  }

  private fixedUpdate(dt: number): void {
    this.scoreSystem.update(dt);
    this.effects.update(dt);
    const cursorInside = this.pointerX !== null && this.pointerY !== null;
    const cursor = { x: this.pointerX ?? 0, y: this.pointerY ?? 0 };
    if (cursorInside) {
      this.predictor.sample(cursor, dt);
      const dangerDistance = this.petRect.width * this.config.dangerRadiusScale;
      const distance = Math.hypot(
        this.petRect.x + this.petRect.width / 2 - cursor.x,
        this.petRect.y + this.petRect.height / 2 - cursor.y,
      );
      const dangerous = distance <= dangerDistance;
      if (dangerous && !this.wasDangerous) {
        this.lastThreatAt = this.elapsedSeconds;
      }
      this.wasDangerous = dangerous;
    }
    const totalClicks = this.hitCount + this.missCount;
    const accuracy = this.hitCount / Math.max(1, totalClicks);
    const progress = this.elapsedSeconds / Math.max(1, this.durationSeconds);
    const difficulty = this.difficulty.update(progress, {
      hitRate: accuracy,
      combo: this.scoreSystem.combo,
      recentFailures: this.recentFailures,
      recentSuccesses: this.recentSuccesses,
      averageReactionMs: this.averageReactionMs(),
      currentScore: this.scoreSystem.score,
    });
    const predictionTime =
      this.config.predictionTimeMin
      + (this.config.predictionTimeMax - this.config.predictionTimeMin)
        * difficulty;
    const predicted = this.predictor.predict(predictionTime);
    this.previousPetRect = { ...this.petRect };
    if (cursorInside) {
      this.petRect = this.ai.update(
        this.petRect,
        this.movementBounds(),
        cursor,
        predicted,
        difficulty,
        dt,
      );
    } else {
      this.ai.velocity = {
        x: this.ai.velocity.x * this.config.friction,
        y: this.ai.velocity.y * this.config.friction,
      };
      this.petRect = {
        ...this.petRect,
        x: this.petRect.x + this.ai.velocity.x * dt,
        y: this.petRect.y + this.ai.velocity.y * dt,
      };
      this.clampPet();
    }
    this.updateSpecialEvent(dt);
  }

  private updateSpecialEvent(dt: number): void {
    this.specialAccumulator += dt;
    if (this.specialRemaining > 0) {
      this.specialRemaining = Math.max(0, this.specialRemaining - dt);
      if (this.specialRemaining <= 0) {
        this.specialEvent = null;
        this.decoys = [];
        this.stageEscapeUsed = false;
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
    const event =
      DODGE_SPECIAL_EVENTS[
        Math.floor(this.random() * DODGE_SPECIAL_EVENTS.length)
      ] ?? 'SUNGLASSES_TAUNT';
    this.specialEvent = event;
    this.stageEscapeUsed = false;
    if (event === 'SHADOW_CLONE') {
      const maximum = 2;
      this.decoys = [];
      for (let index = 0; index < maximum; index += 1) {
        this.decoys.push(this.offsetClone(index));
      }
      this.specialRemaining = this.config.tauntDurationSeconds;
    } else if (event === 'SUDDEN_BRAKE') {
      this.ai.forceState('BRAKE', this.config.brakeDurationSeconds);
      this.specialRemaining = this.config.brakeDurationSeconds;
    } else if (event === 'REVERSE_FEINT') {
      this.ai.forceState('FEINT', this.config.feintDurationSeconds);
      this.specialRemaining = this.config.feintDurationSeconds;
    } else if (event === 'SUNGLASSES_TAUNT') {
      this.ai.forceState('TAUNT', this.config.tauntDurationSeconds);
      this.specialRemaining = this.config.tauntDurationSeconds;
    } else if (event === 'BASKETBALL') {
      this.specialRemaining = this.config.tauntDurationSeconds;
    } else {
      this.ai.forceState('TAUNT', this.config.stageDurationSeconds);
      this.specialRemaining = this.config.stageDurationSeconds;
    }
  }

  private specialEventText(): string {
    switch (this.specialEvent) {
      case 'SHADOW_CLONE':
        return '影分身！';
      case 'SUDDEN_BRAKE':
        return '急刹车';
      case 'REVERSE_FEINT':
        return '反向假动作';
      case 'SUNGLASSES_TAUNT':
        return '墨镜挑衅';
      case 'BASKETBALL':
        return '篮球时间';
      case 'STAGE_SING':
        return '舞台演唱：抓住我算你赢';
      default:
        return '';
    }
  }

  private offsetClone(index: number): Rect {
    const size = this.petRect.width;
    const offsetX = size * (index === 0 ? 1.15 : -1.15);
    const offsetY = size * (index === 0 ? -0.55 : 0.55);
    const bounds = this.movementBounds();
    const clone: Rect = {
      ...this.petRect,
      x: this.petRect.x + offsetX,
      y: this.petRect.y + offsetY,
    };
    clone.x = clamp(clone.x, bounds.x, bounds.x + bounds.width - clone.width);
    clone.y = clamp(clone.y, bounds.y, bounds.y + bounds.height - clone.height);
    return clone;
  }

  private movementBounds(): Rect {
    return {
      x: DodgeMouseGame.MARGIN,
      y: DodgeMouseGame.HEADER_HEIGHT,
      width: Math.max(1, DodgeMouseGame.WIDTH - DodgeMouseGame.MARGIN * 2),
      height: Math.max(
        1,
        DodgeMouseGame.HEIGHT - DodgeMouseGame.HEADER_HEIGHT - DodgeMouseGame.MARGIN,
      ),
    };
  }

  private clampPet(): void {
    const bounds = this.movementBounds();
    const clampedX = clamp(
      this.petRect.x,
      bounds.x,
      bounds.x + bounds.width - this.petRect.width,
    );
    const clampedY = clamp(
      this.petRect.y,
      bounds.y,
      bounds.y + bounds.height - this.petRect.height,
    );
    if (clampedX !== this.petRect.x) {
      this.ai.velocity.x *= -0.35;
    }
    if (clampedY !== this.petRect.y) {
      this.ai.velocity.y *= -0.35;
    }
    this.petRect.x = clampedX;
    this.petRect.y = clampedY;
  }

  private centerRect(): Rect {
    return {
      x: (DodgeMouseGame.WIDTH - DodgeMouseGame.PET_SIZE) / 2,
      y: (DodgeMouseGame.HEIGHT - DodgeMouseGame.PET_SIZE) / 2,
      width: DodgeMouseGame.PET_SIZE,
      height: DodgeMouseGame.PET_SIZE,
    };
  }

  private averageReactionMs(): number {
    if (this.reactionSamples.length === 0) {
      return 0;
    }
    return (
      this.reactionSamples.reduce((sum, value) => sum + value, 0)
      / this.reactionSamples.length
    );
  }

  private remainingSeconds(): number {
    return Math.max(0, this.durationSeconds - this.elapsedSeconds);
  }

  private finish(finishReason: GameResult['finishReason']): GameResult {
    if (this.result) {
      return this.result;
    }
    this.phase = 'result';
    const attempts = this.hitCount + this.missCount;
    this.result = {
      gameId: 'dodge_mouse',
      score: this.scoreSystem.score,
      grade: ScoreSystem.grade(
        this.scoreSystem.score,
        this.config.gradeThresholds,
      ),
      durationSeconds: this.elapsedSeconds,
      maxCombo: this.scoreSystem.maxCombo,
      accuracy: this.hitCount / Math.max(1, attempts),
      caughtCount: 0,
      droppedCount: 0,
      hitCount: this.hitCount,
      missCount: this.missCount,
      finishReason,
    };
    return this.result;
  }
}

/** 椭圆命中判定，移植 desktop_pet collision_system.ellipse_contains。 */
function ellipseContains(
  rect: Rect,
  x: number,
  y: number,
  inflate: number,
): boolean {
  const factor = Math.max(1, inflate);
  const width = rect.width * factor;
  const height = rect.height * factor;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  if (radiusX <= 0 || radiusY <= 0) {
    return false;
  }
  const normalizedX = (x - centerX) / radiusX;
  const normalizedY = (y - centerY) / radiusY;
  return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
