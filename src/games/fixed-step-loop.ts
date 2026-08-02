export interface FixedStepResult {
  updateCount: number;
  alpha: number;
  droppedRemainder: boolean;
}

export class FixedStepAccumulator {
  static readonly FIXED_DT = 1 / 60;
  static readonly MAX_FRAME_TIME = 0.1;
  static readonly MAX_UPDATES_PER_FRAME = 5;

  private accumulator = 0;

  reset(): void {
    this.accumulator = 0;
  }

  advance(
    frameSeconds: number,
    update: (fixedSeconds: number) => void,
  ): FixedStepResult {
    const safeFrame = clamp(
      frameSeconds,
      0,
      FixedStepAccumulator.MAX_FRAME_TIME,
    );
    this.accumulator += safeFrame;
    let updateCount = 0;
    while (
      this.accumulator >= FixedStepAccumulator.FIXED_DT
      && updateCount < FixedStepAccumulator.MAX_UPDATES_PER_FRAME
    ) {
      update(FixedStepAccumulator.FIXED_DT);
      this.accumulator -= FixedStepAccumulator.FIXED_DT;
      updateCount += 1;
    }
    const droppedRemainder =
      updateCount >= FixedStepAccumulator.MAX_UPDATES_PER_FRAME;
    if (droppedRemainder) {
      this.accumulator = 0;
    }
    return {
      updateCount,
      alpha: this.accumulator / FixedStepAccumulator.FIXED_DT,
      droppedRemainder,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
