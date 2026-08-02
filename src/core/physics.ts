export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MotionInput {
  x: number;
  y: number;
  width: number;
  height: number;
  velocityX: number;
  velocityY: number;
  elapsedSeconds: number;
  bounds: Bounds;
}

export interface MotionResult {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  hitHorizontalEdge: boolean;
  landed: boolean;
  settled: boolean;
}

export interface PhysicsOptions {
  gravity?: number;
  horizontalBounce?: number;
  verticalBounce?: number;
  floorFriction?: number;
  airDrag?: number;
  maximumSpeed?: number;
  visibleFraction?: number;
}

/**
 * 桌宠投掷物理。参数和计算顺序保持 desktop_pet Python 版本的行为基线。
 */
export class PhysicsEngine {
  readonly gravity: number;
  readonly horizontalBounce: number;
  readonly verticalBounce: number;
  readonly floorFriction: number;
  readonly airDrag: number;
  readonly maximumSpeed: number;
  readonly visibleFraction: number;

  constructor(options: PhysicsOptions = {}) {
    this.gravity = options.gravity ?? 1_800;
    this.horizontalBounce = options.horizontalBounce ?? 0.42;
    this.verticalBounce = options.verticalBounce ?? 0.42;
    this.floorFriction = options.floorFriction ?? 0.82;
    this.airDrag = clamp(options.airDrag ?? 0.985, 0, 1);
    this.maximumSpeed = Math.max(100, options.maximumSpeed ?? 1_600);
    this.visibleFraction = clamp(options.visibleFraction ?? 1, 0.3, 1);
  }

  step(input: MotionInput): MotionResult {
    const elapsedSeconds = clamp(input.elapsedSeconds, 0, 0.05);
    let velocityX = input.velocityX;
    let velocityY = input.velocityY + this.gravity * elapsedSeconds;
    const dragFactor = this.airDrag ** (elapsedSeconds * 60);
    velocityX *= dragFactor;
    velocityY *= dragFactor;

    const speed = Math.hypot(velocityX, velocityY);
    if (speed > this.maximumSpeed) {
      const factor = this.maximumSpeed / speed;
      velocityX *= factor;
      velocityY *= factor;
    }

    let x = input.x + velocityX * elapsedSeconds;
    let y = input.y + velocityY * elapsedSeconds;
    let hitHorizontalEdge = false;
    let landed = false;

    const hiddenWidth = input.width * (1 - this.visibleFraction);
    const hiddenHeight = input.height * (1 - this.visibleFraction);
    const minimumX = input.bounds.left - hiddenWidth;
    const maximumX = Math.max(
      minimumX,
      input.bounds.right - input.width + hiddenWidth,
    );
    const minimumY = input.bounds.top - hiddenHeight;
    const floorY = Math.max(input.bounds.top, input.bounds.bottom - input.height);

    if (x < minimumX) {
      x = minimumX;
      velocityX = Math.abs(velocityX) * this.horizontalBounce;
      hitHorizontalEdge = true;
    } else if (x > maximumX) {
      x = maximumX;
      velocityX = -Math.abs(velocityX) * this.horizontalBounce;
      hitHorizontalEdge = true;
    }

    if (y < minimumY) {
      y = minimumY;
      velocityY = Math.abs(velocityY) * this.verticalBounce;
    } else if (y >= floorY) {
      y = floorY;
      landed = velocityY > 85;
      if (Math.abs(velocityY) > 165) {
        velocityY = -velocityY * this.verticalBounce;
        velocityX *= this.floorFriction;
      } else {
        velocityY = 0;
        velocityX *= this.floorFriction;
      }
    }

    if (y === floorY && Math.abs(velocityX) < 8) {
      velocityX = 0;
    }

    return {
      x,
      y,
      velocityX,
      velocityY,
      hitHorizontalEdge,
      landed,
      settled: y === floorY && velocityX === 0 && velocityY === 0,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
