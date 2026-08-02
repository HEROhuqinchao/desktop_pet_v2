export interface VisualEffect {
  text: string;
  x: number;
  y: number;
  color: string;
  remaining: number;
  priority: number;
}

/**
 * 浮动文字特效，移植 desktop_pet games/effect_system.py
 * （优先级淘汰 + 上浮 + 时限）。
 */
export class EffectSystem {
  effects: VisualEffect[] = [];

  constructor(
    private readonly floatingTextLimit = 8,
  ) {}

  addText(
    text: string,
    x: number,
    y: number,
    color: string,
    options: { priority?: number; duration?: number } = {},
  ): boolean {
    const priority = options.priority ?? 0;
    if (this.effects.length >= this.floatingTextLimit) {
      let lowestIndex = 0;
      for (let index = 1; index < this.effects.length; index += 1) {
        if ((this.effects[index]?.priority ?? 0) < (this.effects[lowestIndex]?.priority ?? 0)) {
          lowestIndex = index;
        }
      }
      const lowest = this.effects[lowestIndex];
      if (lowest && lowest.priority >= priority) {
        return false;
      }
      this.effects.splice(lowestIndex, 1);
    }
    this.effects.push({
      text,
      x,
      y,
      color,
      remaining: Math.max(0.1, options.duration ?? 0.8),
      priority,
    });
    return true;
  }

  update(elapsedSeconds: number): void {
    const velocityY = -28;
    this.effects = this.effects.filter((effect) => {
      effect.remaining -= elapsedSeconds;
      effect.y += velocityY * elapsedSeconds;
      return effect.remaining > 0;
    });
  }

  clear(): void {
    this.effects = [];
  }
}
