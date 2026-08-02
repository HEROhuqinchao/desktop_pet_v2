export interface DragSample {
  x: number;
  y: number;
  timestampMs: number;
}

export interface Velocity {
  x: number;
  y: number;
}

/**
 * 保留最近八个光标采样点，使用越新的区间越高的权重估算释放速度。
 * 行为与 desktop_pet 的 Python DragTracker 保持一致。
 */
export class DragVelocityTracker {
  readonly sampleLimit: number;
  readonly maximumSpeed: number;
  private readonly samples: DragSample[] = [];

  constructor(sampleLimit = 8, maximumSpeed = 1_600) {
    this.sampleLimit = Math.max(2, Math.floor(sampleLimit));
    this.maximumSpeed = Math.max(100, maximumSpeed);
  }

  reset(x: number, y: number, timestampMs: number): void {
    this.samples.length = 0;
    this.add(x, y, timestampMs);
  }

  add(x: number, y: number, timestampMs: number): void {
    this.samples.push({ x, y, timestampMs });
    if (this.samples.length > this.sampleLimit) {
      this.samples.splice(0, this.samples.length - this.sampleLimit);
    }
  }

  velocity(): Velocity {
    if (this.samples.length < 2) {
      return { x: 0, y: 0 };
    }

    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    for (let index = 1; index < this.samples.length; index += 1) {
      const previous = this.samples[index - 1];
      const current = this.samples[index];
      const elapsedSeconds = (current.timestampMs - previous.timestampMs) / 1_000;
      if (elapsedSeconds <= 0.0005) {
        continue;
      }
      const weight = index;
      weightedX += ((current.x - previous.x) / elapsedSeconds) * weight;
      weightedY += ((current.y - previous.y) / elapsedSeconds) * weight;
      totalWeight += weight;
    }

    if (totalWeight <= 0) {
      return { x: 0, y: 0 };
    }

    let x = weightedX / totalWeight;
    let y = weightedY / totalWeight;
    const speed = Math.hypot(x, y);
    if (speed > this.maximumSpeed) {
      const factor = this.maximumSpeed / speed;
      x *= factor;
      y *= factor;
    }
    return { x, y };
  }
}
