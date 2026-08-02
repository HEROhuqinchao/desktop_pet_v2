export interface Point {
  x: number;
  y: number;
}

/**
 * 光标速度平滑与短时预测，移植 desktop_pet
 * games/dodge_mouse/cursor_predictor.py。
 */
export class CursorPredictor {
  position: Point = { x: 0, y: 0 };
  velocity: Point = { x: 0, y: 0 };
  private initialized = false;

  reset(position: Point | null = null): void {
    this.position = position ? { ...position } : { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.initialized = position !== null;
  }

  sample(position: Point, elapsedSeconds: number): void {
    if (!this.initialized) {
      this.reset(position);
      return;
    }
    const elapsed = Math.max(1 / 240, Math.min(0.1, elapsedSeconds));
    const rawX = (position.x - this.position.x) / elapsed;
    const rawY = (position.y - this.position.y) / elapsed;
    this.velocity = {
      x: this.velocity.x * 0.64 + rawX * 0.36,
      y: this.velocity.y * 0.64 + rawY * 0.36,
    };
    this.position = { ...position };
  }

  predict(predictionSeconds: number): Point {
    const seconds = Math.max(0, Math.min(0.5, predictionSeconds));
    return {
      x: this.position.x + this.velocity.x * seconds,
      y: this.position.y + this.velocity.y * seconds,
    };
  }
}
