import type { CatchFoodConfig, CatchItemConfig } from './game-configs';

/**
 * 生成模式与节奏，移植 desktop_pet games/catch_food/spawn_director.py。
 */
export const SPAWN_PATTERNS = [
  'SINGLE',
  'DOUBLE',
  'WAVE',
  'ZIGZAG',
  'LEFT_RAIN',
  'RIGHT_RAIN',
  'BONUS_LINE',
  'DANGER_MIX',
] as const;

export type SpawnPattern = (typeof SPAWN_PATTERNS)[number];

export interface SpawnRequest {
  item: CatchItemConfig;
  positionRatio: number;
  horizontalVelocity: number;
}

export class SpawnDirector {
  accumulator = 0;
  patternElapsed = 0;
  sequence = 0;
  pattern: SpawnPattern = 'SINGLE';

  constructor(
    private readonly config: CatchFoodConfig,
    private readonly random: () => number = Math.random,
  ) {}

  reset(): void {
    this.accumulator = 0;
    this.patternElapsed = 0;
    this.sequence = 0;
    this.pattern = 'SINGLE';
  }

  update(
    elapsedSeconds: number,
    difficulty: number,
    options: { fever: boolean; activeCount: number },
  ): SpawnRequest[] {
    this.accumulator += elapsedSeconds;
    this.patternElapsed += elapsedSeconds;
    if (this.patternElapsed >= this.config.patternSeconds) {
      this.patternElapsed = 0;
      let available: number = SPAWN_PATTERNS.length;
      if (difficulty < 0.25) {
        available = 3;
      } else if (difficulty < 0.55) {
        available = 6;
      }
      this.pattern =
        SPAWN_PATTERNS[Math.floor(this.random() * available)] ?? 'SINGLE';
    }
    const interval =
      this.config.maxSpawnInterval
      + (this.config.minSpawnInterval - this.config.maxSpawnInterval)
        * difficulty;
    const effective = options.fever ? interval * 0.62 : interval;
    if (this.accumulator < effective) {
      return [];
    }
    this.accumulator -= effective;
    let count =
      this.pattern === 'DOUBLE'
      || this.pattern === 'BONUS_LINE'
      || this.pattern === 'DANGER_MIX'
        ? 2
        : 1;
    count = Math.min(count, this.config.maxActiveEntities - options.activeCount);
    if (count <= 0) {
      return [];
    }
    const result: SpawnRequest[] = [];
    for (let lane = 0; lane < count; lane += 1) {
      const item = this.chooseItem(difficulty, options.fever);
      const ratio = this.positionRatio(lane);
      const horizontal = this.horizontalVelocity(difficulty);
      result.push({ item, positionRatio: ratio, horizontalVelocity: horizontal });
      this.sequence += 1;
    }
    return result;
  }

  private chooseItem(difficulty: number, fever: boolean): CatchItemConfig {
    const weights = this.config.items.map((item) => {
      let weight = item.spawnWeight;
      if (item.category === 'danger' || item.category === 'interference') {
        weight *= this.config.modeDangerScale * (0.25 + difficulty * 0.85);
        if (fever) {
          weight *= 0.12;
        }
      } else if (item.category === 'normal_food' && fever) {
        weight *= 2.2;
      } else if (item.category === 'powerup' && difficulty < 0.35) {
        weight *= 1.7;
      } else if (item.category === 'rare_food' && this.pattern === 'BONUS_LINE') {
        weight *= 4;
      }
      return Math.max(0.01, weight);
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = this.random() * total;
    for (let index = 0; index < this.config.items.length; index += 1) {
      target -= weights[index] ?? 0;
      if (target <= 0) {
        return this.config.items[index];
      }
    }
    return this.config.items[this.config.items.length - 1];
  }

  private positionRatio(lane: number): number {
    const index = this.sequence;
    switch (this.pattern) {
      case 'DOUBLE':
        return lane === 0 ? 0.28 : 0.72;
      case 'WAVE':
        return 0.5 + 0.38 * Math.sin(index * 0.72);
      case 'ZIGZAG':
        return index % 2 === 0 ? 0.2 : 0.8;
      case 'LEFT_RAIN':
        return 0.08 + this.random() * 0.37;
      case 'RIGHT_RAIN':
        return 0.55 + this.random() * 0.37;
      case 'BONUS_LINE':
        return 0.22 + lane * 0.56;
      case 'DANGER_MIX':
        return 0.32 + lane * 0.36;
      default:
        return 0.08 + this.random() * 0.84;
    }
  }

  private horizontalVelocity(difficulty: number): number {
    switch (this.pattern) {
      case 'LEFT_RAIN':
        return 55 + difficulty * 45;
      case 'RIGHT_RAIN':
        return -55 - difficulty * 45;
      case 'WAVE':
      case 'ZIGZAG':
        return (this.random() < 0.5 ? -1 : 1) * (25 + difficulty * 45);
      default:
        return 0;
    }
  }
}
