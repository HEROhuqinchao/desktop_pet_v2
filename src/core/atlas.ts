import type {
  MotionState,
  PetBehaviorState,
} from '../shared/contracts';

export interface AtlasAnimation {
  frameDurations: readonly number[];
  positions: readonly (readonly [row: number, column: number])[];
}

export const ATLAS_COLUMNS = 8;
export const ATLAS_V2_ROWS = 11;

export const ATLAS_ANIMATIONS = {
  idle: {
    frameDurations: [0.28, 0.11, 0.11, 0.14, 0.14, 0.32],
    positions: rowPositions(0, 6),
  },
  runningRight: {
    frameDurations: Array.from({ length: 8 }, () => 0.09),
    positions: rowPositions(1, 8),
  },
  runningLeft: {
    frameDurations: Array.from({ length: 8 }, () => 0.09),
    positions: rowPositions(2, 8),
  },
  wave: {
    frameDurations: [0.12, 0.12, 0.12, 0.22],
    positions: rowPositions(3, 4),
  },
  jump: {
    frameDurations: [0.1, 0.1, 0.12, 0.1, 0.18],
    positions: rowPositions(4, 5),
  },
  failed: {
    frameDurations: Array.from({ length: 8 }, () => 0.12),
    positions: rowPositions(5, 8),
  },
  wait: {
    frameDurations: Array.from({ length: 6 }, () => 0.18),
    positions: rowPositions(6, 6),
  },
  run: {
    frameDurations: Array.from({ length: 6 }, () => 0.09),
    positions: rowPositions(7, 6),
  },
  review: {
    frameDurations: Array.from({ length: 6 }, () => 0.15),
    positions: rowPositions(8, 6),
  },
  look: {
    frameDurations: Array.from({ length: 17 }, () => 1),
    positions: [
      ...rowPositions(9, 8),
      ...rowPositions(10, 8),
      [0, 6] as const,
    ],
  },
} as const satisfies Record<string, AtlasAnimation>;

export type AtlasAnimationName = keyof typeof ATLAS_ANIMATIONS;

const STATE_ANIMATIONS: Readonly<
  Record<PetBehaviorState, AtlasAnimationName>
> = {
  IDLE: 'idle',
  BLINK: 'idle',
  LOOK_AT_CURSOR: 'idle',
  WALK_LEFT: 'runningLeft',
  RUN_LEFT: 'runningLeft',
  WALK_RIGHT: 'runningRight',
  RUN_RIGHT: 'runningRight',
  CHASE_CURSOR: 'runningRight',
  DRAGGED: 'runningRight',
  JUMP: 'jump',
  FALL: 'jump',
  THROWN: 'jump',
  LAND: 'jump',
  HAPPY: 'wave',
  PLAY: 'wave',
  SPECIAL_ACTION: 'wait',
  HUNGRY: 'wave',
  EAT: 'wave',
  ANGRY: 'failed',
  SAD: 'failed',
  SCARED: 'failed',
  DIZZY: 'failed',
  CURIOUS: 'review',
  SPECIAL_EVENT: 'run',
  YAWN: 'idle',
  PREPARE_SLEEP: 'idle',
  SLEEP: 'idle',
  WAKE_UP: 'idle',
  HIDE: 'idle',
  CLIMB: 'jump',
};

export function animationForMotion(state: MotionState): AtlasAnimationName {
  if (state.phase === 'dragging') {
    return state.velocityX < -8 ? 'runningLeft' : 'runningRight';
  }
  if (state.phase === 'thrown') {
    return 'jump';
  }
  return STATE_ANIMATIONS[state.behaviorState];
}

export function frameAtElapsed(
  animation: AtlasAnimation,
  elapsedSeconds: number,
): number {
  const totalDuration = animation.frameDurations.reduce(
    (total, duration) => total + duration,
    0,
  );
  if (totalDuration <= 0) {
    return 0;
  }

  let cursor = ((elapsedSeconds % totalDuration) + totalDuration) % totalDuration;
  for (let index = 0; index < animation.frameDurations.length; index += 1) {
    const duration = animation.frameDurations[index];
    if (cursor < duration) {
      return index;
    }
    cursor -= duration;
  }
  return animation.frameDurations.length - 1;
}

export function framePosition(
  animation: AtlasAnimation,
  frameIndex: number,
): readonly [row: number, column: number] {
  if (animation.positions.length === 0) {
    return [0, 0];
  }
  const index =
    ((Math.floor(frameIndex) % animation.positions.length)
      + animation.positions.length)
    % animation.positions.length;
  return animation.positions[index];
}

/**
 * Codex v2 的 16 向注视帧按“上方起点、顺时针”排列，中心使用待机第 7 帧。
 */
export function lookFrameIndex(
  directionX: number,
  directionY: number,
  deadzone = 0.28,
): number {
  if (Math.hypot(directionX, directionY) < Math.max(0, deadzone)) {
    return 16;
  }
  const clockwiseFromUp =
    Math.atan2(directionX, -directionY) * (180 / Math.PI);
  const normalized = (clockwiseFromUp + 360) % 360;
  return Math.round(normalized / 22.5) % 16;
}

function rowPositions(
  row: number,
  count: number,
): readonly (readonly [row: number, column: number])[] {
  return Array.from(
    { length: count },
    (_, column) => [row, column] as const,
  );
}
