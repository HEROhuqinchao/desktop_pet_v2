import type { GameDifficulty } from '../shared/contracts';

/**
 * 自适应难度，移植 desktop_pet games/difficulty_director.py。
 */
export interface PlayerPerformance {
  hitRate: number;
  combo: number;
  recentFailures: number;
  recentSuccesses: number;
  averageReactionMs?: number;
  currentScore: number;
}

const MODE_BASE: Record<GameDifficulty, number> = {
  easy: 0.18,
  standard: 0.42,
  challenge: 0.68,
};

export class DifficultyDirector {
  currentDifficulty: number;

  constructor(
    private readonly mode: GameDifficulty = 'standard',
    private readonly adaptive = true,
  ) {
    this.currentDifficulty = MODE_BASE[mode] ?? MODE_BASE.standard;
  }

  update(timeProgress: number, performance: PlayerPerformance): number {
    const progress = Math.max(0, Math.min(1, timeProgress));
    const successBalance =
      (performance.recentSuccesses - performance.recentFailures) / 8;
    let performanceScore =
      performance.hitRate * 0.45
      + Math.min(1, performance.combo / 30) * 0.25
      + Math.max(-1, Math.min(1, successBalance)) * 0.3;
    if (!this.adaptive) {
      performanceScore = 0.5;
    }
    const target =
      progress * 0.5
      + Math.max(0, Math.min(1, performanceScore)) * 0.3
      + (MODE_BASE[this.mode] ?? MODE_BASE.standard) * 0.2;
    this.currentDifficulty += (target - this.currentDifficulty) * 0.08;
    this.currentDifficulty = Math.max(0, Math.min(1, this.currentDifficulty));
    return this.currentDifficulty;
  }
}
