import { describe, expect, it } from 'vitest';
import {
  actionDurationSeconds,
  actionForMotion,
  actionForState,
  actionFrameAtElapsed,
  actionFramePosition,
  actionHasCompleted,
} from '../src/core/action-atlas';
import type {
  MotionState,
  PetActionDefinition,
  PetActionManifest,
} from '../src/shared/contracts';

const definition: PetActionDefinition = {
  loop: false,
  frames: [
    { row: 2, column: 3, durationMs: 100 },
    { row: 2, column: 4, durationMs: 200 },
  ],
};

const manifest: PetActionManifest = {
  formatVersion: 1,
  cellWidth: 192,
  cellHeight: 208,
  atlasPath: 'actions.webp',
  columns: 8,
  rows: 3,
  animations: {
    sleep: definition,
    dragged: definition,
    'run-left': definition,
    'run-right': definition,
  },
  stateMap: {
    SLEEP: 'sleep',
    DRAGGED: 'dragged',
    RUN_LEFT: 'run-left',
    RUN_RIGHT: 'run-right',
  },
};

function motion(patch: Partial<MotionState> = {}): MotionState {
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

describe('desktop_pet_v2 action atlas', () => {
  it('resolves state actions and leaves missing states to Codex fallback', () => {
    expect(actionForState(manifest, 'SLEEP')).toBe('sleep');
    expect(actionForState(manifest, 'EAT')).toBeNull();
  });

  it('resolves directional drag actions before the fixed DRAGGED mapping', () => {
    expect(actionForMotion(manifest, motion({
      phase: 'dragging',
      behaviorState: 'DRAGGED',
      velocityX: -200,
    }))).toBe('run-left');
    expect(actionForMotion(manifest, motion({
      phase: 'dragging',
      behaviorState: 'DRAGGED',
      velocityX: 200,
    }))).toBe('run-right');
    expect(actionForMotion(manifest, motion({
      behaviorState: 'DRAGGED',
    }))).toBe('dragged');
  });

  it('falls back to the Codex atlas when directional actions are absent', () => {
    const withoutDirectionalActions: PetActionManifest = {
      ...manifest,
      stateMap: { DRAGGED: 'dragged' },
    };
    expect(actionForMotion(withoutDirectionalActions, motion({
      phase: 'dragging',
      behaviorState: 'DRAGGED',
      velocityX: -200,
    }))).toBeNull();
  });

  it('uses per-frame durations for looping and one-shot playback', () => {
    expect(actionDurationSeconds(definition)).toBeCloseTo(0.3);
    expect(actionFrameAtElapsed(definition, 0.05)).toBe(0);
    expect(actionFrameAtElapsed(definition, 0.15)).toBe(1);
    expect(actionFrameAtElapsed(definition, 0.35)).toBe(1);
    expect(actionFrameAtElapsed(definition, 0.35, true)).toBe(0);
    expect(actionHasCompleted(definition, 0.3)).toBe(true);
    expect(actionFramePosition(definition, 1)).toEqual([2, 4]);
  });
});
