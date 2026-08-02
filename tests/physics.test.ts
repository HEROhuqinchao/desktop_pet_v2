import { describe, expect, it } from 'vitest';
import { PhysicsEngine } from '../src/core/physics';

const desktopBounds = {
  left: 0,
  top: 0,
  right: 1_000,
  bottom: 800,
};

describe('PhysicsEngine', () => {
  it('applies gravity and advances a thrown pet', () => {
    const engine = new PhysicsEngine();
    const result = engine.step({
      x: 200,
      y: 100,
      width: 192,
      height: 208,
      velocityX: 300,
      velocityY: -500,
      elapsedSeconds: 1 / 60,
      bounds: desktopBounds,
    });

    expect(result.x).toBeGreaterThan(200);
    expect(result.y).toBeLessThan(100);
    expect(result.velocityY).toBeGreaterThan(-500);
    expect(result.settled).toBe(false);
  });

  it('bounces from horizontal edges without leaving the work area', () => {
    const engine = new PhysicsEngine();
    const result = engine.step({
      x: 805,
      y: 100,
      width: 192,
      height: 208,
      velocityX: 900,
      velocityY: 0,
      elapsedSeconds: 0.05,
      bounds: desktopBounds,
    });

    expect(result.x).toBe(808);
    expect(result.velocityX).toBeLessThan(0);
    expect(result.hitHorizontalEdge).toBe(true);
  });

  it('settles on the floor once vertical and horizontal speed are low', () => {
    const engine = new PhysicsEngine();
    const result = engine.step({
      x: 400,
      y: 592,
      width: 192,
      height: 208,
      velocityX: 2,
      velocityY: 2,
      elapsedSeconds: 1 / 60,
      bounds: desktopBounds,
    });

    expect(result.y).toBe(592);
    expect(result.velocityX).toBe(0);
    expect(result.velocityY).toBe(0);
    expect(result.settled).toBe(true);
  });

  it('clamps long frames to avoid tunnelling after a pause', () => {
    const engine = new PhysicsEngine({ gravity: 0, airDrag: 1 });
    const result = engine.step({
      x: 100,
      y: 100,
      width: 192,
      height: 208,
      velocityX: 100,
      velocityY: 0,
      elapsedSeconds: 10,
      bounds: desktopBounds,
    });

    expect(result.x).toBe(105);
  });
});
