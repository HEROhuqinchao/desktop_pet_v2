import type { DodgeMouseConfig } from './game-configs';
import type { Point } from './cursor-predictor';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DODGE_STATES = [
  'IDLE_OBSERVE',
  'WALK_AWAY',
  'PREDICT_ESCAPE',
  'DASH',
  'FEINT',
  'BRAKE',
  'HIDE_EDGE',
  'TAUNT',
  'STUNNED',
  'TIRED',
] as const;

export type DodgeState = (typeof DODGE_STATES)[number];

/**
 * 带反应延迟、体力与连续运动约束的鼠标闪避 AI，移植 desktop_pet
 * games/dodge_mouse/dodge_ai.py。
 */
export class DodgeAI {
  state: DodgeState = 'IDLE_OBSERVE';
  velocity: Point = { x: 0, y: 0 };
  stateRemaining = 0;
  reactionRemaining = 0;
  currentReactionSeconds: number;
  stamina: number;
  dashCooldownRemaining = 0;
  private escapeDirection: Point = { x: 1, y: 0 };
  private feintDirection: Point = { x: 1, y: 0 };
  private feintElapsed = 0;

  constructor(
    private readonly config: DodgeMouseConfig,
    private readonly random: () => number = Math.random,
  ) {
    this.currentReactionSeconds = config.reactionMaxSeconds;
    this.stamina = config.staminaMaximum;
  }

  reset(): void {
    this.state = 'IDLE_OBSERVE';
    this.velocity = { x: 0, y: 0 };
    this.stateRemaining = 0;
    this.reactionRemaining = 0;
    this.currentReactionSeconds = this.config.reactionMaxSeconds;
    this.escapeDirection = { x: 1, y: 0 };
    this.feintDirection = { x: 1, y: 0 };
    this.feintElapsed = 0;
    this.stamina = this.config.staminaMaximum;
    this.dashCooldownRemaining = 0;
  }

  get canDash(): boolean {
    return (
      this.dashCooldownRemaining <= 0 && this.stamina >= this.config.dashCost
    );
  }

  forceState(state: DodgeState, durationSeconds: number): void {
    this.state = state;
    this.stateRemaining = Math.max(0, durationSeconds);
    if (state === 'STUNNED') {
      this.velocity = scale(this.velocity, 0.18);
    } else if (state === 'TAUNT' || state === 'TIRED') {
      this.velocity = scale(this.velocity, 0.35);
    }
  }

  update(
    rect: Rect,
    bounds: Rect,
    cursor: Point,
    predictedCursor: Point,
    difficulty: number,
    elapsedSeconds: number,
  ): Rect {
    const dt = Math.max(0, Math.min(0.1, elapsedSeconds));
    this.updateSkill(dt);
    this.reactionRemaining = Math.max(0, this.reactionRemaining - dt);
    this.stateRemaining = Math.max(0, this.stateRemaining - dt);
    this.advanceActiveState(rect, predictedCursor, difficulty, dt);

    if (this.stateAllowsDecision() && this.reactionRemaining <= 0) {
      this.decide(rect, bounds, cursor, predictedCursor, difficulty);
      this.currentReactionSeconds = this.reactionTime(difficulty);
      this.reactionRemaining = this.currentReactionSeconds;
    }

    const maximumSpeed = this.config.maximumSpeed * this.config.speedScale;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (speed > maximumSpeed) {
      this.velocity = scale(this.velocity, maximumSpeed / speed);
    }
    const updated: Rect = {
      ...rect,
      x: rect.x + this.velocity.x * dt,
      y: rect.y + this.velocity.y * dt,
    };
    this.clampToBounds(updated, bounds);
    return updated;
  }

  private updateSkill(dt: number): void {
    this.dashCooldownRemaining = Math.max(0, this.dashCooldownRemaining - dt);
    this.stamina = Math.min(
      this.config.staminaMaximum,
      this.stamina + this.config.staminaRecoverPerSecond * dt,
    );
  }

  private useDash(): boolean {
    if (!this.canDash) {
      return false;
    }
    this.stamina -= this.config.dashCost;
    this.dashCooldownRemaining = this.config.dashCooldownSeconds;
    return true;
  }

  private advanceActiveState(
    rect: Rect,
    predictedCursor: Point,
    difficulty: number,
    dt: number,
  ): void {
    if (this.state === 'PREDICT_ESCAPE') {
      this.velocity = scale(this.velocity, this.config.friction);
      if (this.stateRemaining <= 0) {
        if (this.useDash()) {
          this.state = 'DASH';
          this.stateRemaining = this.config.dashDurationSeconds;
          this.velocity = scale(
            this.escapeDirection,
            this.config.dashSpeed * this.config.speedScale,
          );
        } else {
          this.state = 'WALK_AWAY';
        }
      }
      return;
    }
    if (this.state === 'DASH') {
      if (this.stateRemaining <= 0) {
        this.forceState('BRAKE', this.config.brakeDurationSeconds);
      }
      return;
    }
    if (this.state === 'FEINT') {
      this.feintElapsed += dt;
      const half = this.config.feintDurationSeconds / 2;
      const direction =
        this.feintElapsed < half
          ? this.feintDirection
          : scale(this.feintDirection, -1);
      this.accelerate(
        direction,
        this.config.acceleration * (0.85 + difficulty * 0.25),
        dt,
      );
      if (this.stateRemaining <= 0) {
        this.state = 'WALK_AWAY';
      }
      return;
    }
    if (this.state === 'BRAKE') {
      this.velocity = scale(this.velocity, Math.max(0, 1 - dt * 8.5));
      if (this.stateRemaining <= 0) {
        this.state = 'IDLE_OBSERVE';
      }
      return;
    }
    if (this.state === 'STUNNED' || this.state === 'TAUNT' || this.state === 'TIRED') {
      const damping = this.state === 'TIRED' ? 0.78 : 0.68;
      this.velocity = scale(this.velocity, damping);
      if (this.stateRemaining <= 0) {
        this.state = 'IDLE_OBSERVE';
      }
      return;
    }
    if (this.state === 'WALK_AWAY' || this.state === 'HIDE_EDGE') {
      const center = rectCenter(rect);
      const direction = normalized({
        x: center.x - predictedCursor.x,
        y: center.y - predictedCursor.y,
      });
      const speedScale = this.state === 'HIDE_EDGE' ? 0.55 : 1;
      this.accelerate(direction, this.config.acceleration * speedScale, dt);
      return;
    }
    this.velocity = scale(this.velocity, this.config.friction);
  }

  private decide(
    rect: Rect,
    bounds: Rect,
    cursor: Point,
    predictedCursor: Point,
    difficulty: number,
  ): void {
    const center = rectCenter(rect);
    const distance = Math.hypot(center.x - cursor.x, center.y - cursor.y);
    const safeRadius = rect.width * this.config.warningRadiusScale;
    const dangerRadius = rect.width * this.config.dangerRadiusScale;
    let escapeDirection = normalized({
      x: center.x - predictedCursor.x,
      y: center.y - predictedCursor.y,
    });
    if (Math.abs(escapeDirection.x) + Math.abs(escapeDirection.y) <= 0) {
      escapeDirection = { x: 1, y: 0 };
    }
    if (this.stamina <= this.config.tiredThreshold) {
      this.forceState('TIRED', this.config.tiredDurationSeconds);
      return;
    }
    if (distance <= dangerRadius) {
      this.escapeDirection = escapeDirection;
      if (this.canDash && this.random() < 0.58 + difficulty * 0.25) {
        this.forceState('PREDICT_ESCAPE', this.config.dashWindupSeconds);
      } else {
        this.feintDirection =
          this.random() < 0.5
            ? { x: -escapeDirection.y, y: escapeDirection.x }
            : { x: escapeDirection.y, y: -escapeDirection.x };
        this.feintElapsed = 0;
        this.forceState('FEINT', this.config.feintDurationSeconds);
      }
      return;
    }
    if (distance <= safeRadius) {
      if (difficulty > 0.55 && this.random() < 0.16) {
        this.state = 'HIDE_EDGE';
        this.stateRemaining = this.config.brakeDurationSeconds * 2;
      } else {
        this.state = 'WALK_AWAY';
        this.stateRemaining = 0;
      }
      return;
    }
    if (this.nearEdge(rect, bounds) && this.random() < 0.4) {
      this.forceState('BRAKE', this.config.brakeDurationSeconds);
    } else {
      this.state = 'IDLE_OBSERVE';
      this.stateRemaining = 0;
    }
  }

  private reactionTime(difficulty: number): number {
    const reaction =
      this.config.reactionMaxSeconds
      + (this.config.reactionMinSeconds - this.config.reactionMaxSeconds)
        * Math.max(0, Math.min(1, difficulty));
    const tiredFactor = this.state === 'TIRED' ? 1.35 : 1;
    return reaction * tiredFactor * this.config.reactionScale;
  }

  private accelerate(
    direction: Point,
    acceleration: number,
    elapsedSeconds: number,
  ): void {
    const factor = acceleration * this.config.speedScale * elapsedSeconds;
    this.velocity = {
      x: this.velocity.x + direction.x * factor,
      y: this.velocity.y + direction.y * factor,
    };
  }

  private stateAllowsDecision(): boolean {
    return (
      this.state !== 'PREDICT_ESCAPE'
      && this.state !== 'DASH'
      && this.state !== 'FEINT'
      && this.state !== 'BRAKE'
      && this.state !== 'TAUNT'
      && this.state !== 'STUNNED'
      && this.state !== 'TIRED'
    );
  }

  private clampToBounds(rect: Rect, bounds: Rect): void {
    const minimumX = bounds.x;
    const maximumX = bounds.x + bounds.width - rect.width;
    const minimumY = bounds.y;
    const maximumY = bounds.y + bounds.height - rect.height;
    if (rect.x < minimumX) {
      rect.x = minimumX;
      this.velocity.x = Math.abs(this.velocity.x) * 0.35;
    } else if (rect.x > maximumX) {
      rect.x = maximumX;
      this.velocity.x = -Math.abs(this.velocity.x) * 0.35;
    }
    if (rect.y < minimumY) {
      rect.y = minimumY;
      this.velocity.y = Math.abs(this.velocity.y) * 0.35;
    } else if (rect.y > maximumY) {
      rect.y = maximumY;
      this.velocity.y = -Math.abs(this.velocity.y) * 0.35;
    }
  }

  private nearEdge(rect: Rect, bounds: Rect): boolean {
    const margin = rect.width * 0.55;
    return (
      rect.x - bounds.x < margin
      || bounds.x + bounds.width - (rect.x + rect.width) < margin
      || rect.y - bounds.y < margin
      || bounds.y + bounds.height - (rect.y + rect.height) < margin
    );
  }
}

function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function normalized(vector: Point): Point {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= 0.0001) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
}

function scale(vector: Point, factor: number): Point {
  return { x: vector.x * factor, y: vector.y * factor };
}
