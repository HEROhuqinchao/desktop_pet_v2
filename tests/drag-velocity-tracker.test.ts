import { describe, expect, it } from 'vitest';
import { DragVelocityTracker } from '../src/core/drag-velocity-tracker';

describe('DragVelocityTracker', () => {
  it('uses recent weighted samples to estimate release velocity', () => {
    const tracker = new DragVelocityTracker();
    tracker.reset(0, 0, 0);
    tracker.add(10, 0, 100);
    tracker.add(30, 0, 200);

    const velocity = tracker.velocity();
    expect(velocity.x).toBeCloseTo((100 * 1 + 200 * 2) / 3, 5);
    expect(velocity.y).toBe(0);
  });

  it('clamps the combined speed', () => {
    const tracker = new DragVelocityTracker(8, 1_600);
    tracker.reset(0, 0, 0);
    tracker.add(10_000, 10_000, 100);

    const velocity = tracker.velocity();
    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(1_600, 5);
  });

  it('keeps only the configured number of recent samples', () => {
    const tracker = new DragVelocityTracker(3);
    tracker.reset(0, 0, 0);
    tracker.add(1, 0, 100);
    tracker.add(3, 0, 200);
    tracker.add(7, 0, 300);

    expect(tracker.velocity().x).toBeGreaterThan(20);
  });
});
