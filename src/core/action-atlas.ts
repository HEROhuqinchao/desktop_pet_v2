import type {
  PetActionDefinition,
  PetActionManifest,
  PetBehaviorState,
} from '../shared/contracts';

export function actionForState(
  manifest: PetActionManifest,
  state: PetBehaviorState,
): string | null {
  const action = manifest.stateMap[state];
  return action && manifest.animations[action] ? action : null;
}

export function actionDurationSeconds(
  definition: PetActionDefinition,
): number {
  return definition.frames.reduce(
    (total, frame) => total + frame.durationMs / 1_000,
    0,
  );
}

export function actionHasCompleted(
  definition: PetActionDefinition,
  elapsedSeconds: number,
): boolean {
  return elapsedSeconds + Number.EPSILON >= actionDurationSeconds(definition);
}

export function actionFrameAtElapsed(
  definition: PetActionDefinition,
  elapsedSeconds: number,
  loop = definition.loop,
): number {
  if (definition.frames.length === 0) {
    return 0;
  }
  const totalDuration = actionDurationSeconds(definition);
  if (totalDuration <= 0) {
    return 0;
  }
  const normalizedElapsed = Math.max(0, elapsedSeconds);
  let cursor = loop
    ? normalizedElapsed % totalDuration
    : Math.min(normalizedElapsed, totalDuration);
  for (let index = 0; index < definition.frames.length; index += 1) {
    const duration = definition.frames[index]!.durationMs / 1_000;
    if (cursor < duration) {
      return index;
    }
    cursor -= duration;
  }
  return definition.frames.length - 1;
}

export function actionFramePosition(
  definition: PetActionDefinition,
  frameIndex: number,
): readonly [row: number, column: number] {
  const frame = definition.frames[
    Math.max(0, Math.min(definition.frames.length - 1, frameIndex))
  ];
  return frame ? [frame.row, frame.column] : [0, 0];
}
