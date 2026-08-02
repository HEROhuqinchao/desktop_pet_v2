import { describe, expect, it } from 'vitest';
import {
  ATLAS_ANIMATIONS,
  animationForMotion,
  frameAtElapsed,
  framePosition,
  lookFrameIndex,
} from '../src/core/atlas';
import type { MotionState } from '../src/shared/contracts';

function motion(
  patch: Partial<MotionState> = {},
): MotionState {
  return {
    phase: 'idle',
    behaviorState: 'IDLE',
    velocityX: 0,
    velocityY: 0,
    lookFrame: null,
    overlay: {
      emotion: 'normal',
      activeEvent: null,
      eventVariant: null,
      activeFood: null,
      hungerLow: false,
      cleanlinessLow: false,
      sleeping: false,
    },
    ...patch,
  };
}

describe('Codex atlas animation mapping', () => {
  it('switches drag animation using horizontal velocity', () => {
    expect(
      animationForMotion(motion({
        phase: 'dragging',
        velocityX: -200,
      })),
    ).toBe('runningLeft');
    expect(
      animationForMotion(motion({
        phase: 'dragging',
        velocityX: 200,
      })),
    ).toBe('runningRight');
  });

  it('uses jump frames while thrown and returns to idle', () => {
    expect(
      animationForMotion(
        motion({ phase: 'thrown', velocityY: -100 }),
      ),
    ).toBe('jump');
    expect(
      animationForMotion(motion()),
    ).toBe('idle');
  });

  it('maps extended behavior states to Codex v2 rows', () => {
    expect(animationForMotion(motion({ behaviorState: 'ANGRY' }))).toBe(
      'failed',
    );
    expect(animationForMotion(motion({ behaviorState: 'CURIOUS' }))).toBe(
      'review',
    );
    expect(animationForMotion(motion({ behaviorState: 'HAPPY' }))).toBe(
      'wave',
    );
  });

  it('respects variable frame durations and loops', () => {
    expect(frameAtElapsed(ATLAS_ANIMATIONS.idle, 0)).toBe(0);
    expect(frameAtElapsed(ATLAS_ANIMATIONS.idle, 0.3)).toBe(1);
    expect(frameAtElapsed(ATLAS_ANIMATIONS.idle, 1.1)).toBe(0);
  });

  it('maps all 17 directional look frames to their atlas cells', () => {
    expect(lookFrameIndex(0, -1)).toBe(0);
    expect(lookFrameIndex(1, 0)).toBe(4);
    expect(lookFrameIndex(0, 1)).toBe(8);
    expect(lookFrameIndex(-1, 0)).toBe(12);
    expect(lookFrameIndex(0, 0)).toBe(16);
    expect(framePosition(ATLAS_ANIMATIONS.look, 0)).toEqual([9, 0]);
    expect(framePosition(ATLAS_ANIMATIONS.look, 8)).toEqual([10, 0]);
    expect(framePosition(ATLAS_ANIMATIONS.look, 16)).toEqual([0, 6]);
  });
});
