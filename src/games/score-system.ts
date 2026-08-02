export class ScoreSystem {
  static readonly MILESTONES = [5, 10, 20, 30] as const;

  score = 0;
  combo = 0;
  maxCombo = 0;
  private comboRemaining = 0;

  constructor(
    readonly comboTimeoutSeconds = 1.8,
  ) {}

  get comboMultiplier(): number {
    if (this.combo >= 30) {
      return 3;
    }
    if (this.combo >= 20) {
      return 2;
    }
    if (this.combo >= 10) {
      return 1.5;
    }
    if (this.combo >= 5) {
      return 1.2;
    }
    return 1;
  }

  update(elapsedSeconds: number): void {
    if (this.combo <= 0) {
      return;
    }
    this.comboRemaining -= Math.max(0, elapsedSeconds);
    if (this.comboRemaining <= 0) {
      this.breakCombo();
    }
  }

  add(
    baseScore: number,
    options: {
      increasesCombo?: boolean;
      temporaryMultiplier?: number;
    } = {},
  ): { delta: number; milestone: boolean } {
    const increasesCombo = options.increasesCombo ?? true;
    if (increasesCombo) {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.comboRemaining = Math.max(0.1, this.comboTimeoutSeconds);
    }
    const delta = Math.trunc(
      Math.trunc(baseScore)
      * this.comboMultiplier
      * Math.max(1, options.temporaryMultiplier ?? 1),
    );
    this.score += delta;
    return {
      delta,
      milestone: ScoreSystem.MILESTONES.includes(
        this.combo as (typeof ScoreSystem.MILESTONES)[number],
      ),
    };
  }

  penalize(amount: number): number {
    const delta = -Math.abs(Math.trunc(amount));
    this.score = Math.max(0, this.score + delta);
    this.breakCombo();
    return delta;
  }

  breakCombo(): void {
    this.combo = 0;
    this.comboRemaining = 0;
  }

  static grade(
    score: number,
    thresholds: readonly [number, number, number, number],
  ): 'S' | 'A' | 'B' | 'C' | 'D' {
    const grades = ['S', 'A', 'B', 'C'] as const;
    for (let index = 0; index < thresholds.length; index += 1) {
      if (score >= thresholds[index]) {
        return grades[index] ?? 'D';
      }
    }
    return 'D';
  }
}
