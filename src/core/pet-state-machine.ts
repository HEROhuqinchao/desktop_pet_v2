import type { PetBehaviorState } from '../shared/contracts';

export interface PetStateDefinition {
  allowed: ReadonlySet<PetBehaviorState>;
  frameIntervalMs: number;
  durationRange: readonly [number, number];
  draggable: boolean;
  moveSpeed: number;
  completionCandidates: readonly PetBehaviorState[];
}

export interface PetStateTick {
  deltaX: number;
  deltaY: number;
  completed: boolean;
}

export type RandomSource = () => number;

const states = (...values: PetBehaviorState[]) =>
  new Set<PetBehaviorState>(values);

const GROUND_ALLOWED = states(
  'IDLE',
  'BLINK',
  'WALK_LEFT',
  'WALK_RIGHT',
  'RUN_LEFT',
  'RUN_RIGHT',
  'JUMP',
  'HUNGRY',
  'YAWN',
  'PREPARE_SLEEP',
  'SLEEP',
  'EAT',
  'PLAY',
  'DRAGGED',
  'ANGRY',
  'HAPPY',
  'SAD',
  'SCARED',
  'DIZZY',
  'CURIOUS',
  'HIDE',
  'CLIMB',
  'LOOK_AT_CURSOR',
  'CHASE_CURSOR',
  'SPECIAL_ACTION',
  'SPECIAL_EVENT',
);

const AIR_ALLOWED = states('FALL', 'LAND', 'THROWN', 'DRAGGED', 'SCARED');
const SLEEP_ALLOWED = states('WAKE_UP', 'DRAGGED', 'ANGRY');
const DRAGGED_ALLOWED = states(
  'THROWN',
  'FALL',
  'LAND',
  'HAPPY',
  'ANGRY',
);

function definition(
  allowed: ReadonlySet<PetBehaviorState>,
  frameIntervalMs: number,
  durationRange: readonly [number, number],
  draggable: boolean,
  moveSpeed: number,
  completionCandidates: readonly PetBehaviorState[],
): PetStateDefinition {
  return {
    allowed,
    frameIntervalMs,
    durationRange,
    draggable,
    moveSpeed,
    completionCandidates,
  };
}

/**
 * 状态参数与 desktop_pet Python 版本保持一致。
 */
export const PET_STATE_DEFINITIONS: Readonly<
  Record<PetBehaviorState, PetStateDefinition>
> = {
  IDLE: definition(
    GROUND_ALLOWED,
    90,
    [2.2, 5.5],
    true,
    0,
    ['BLINK', 'WALK_LEFT', 'WALK_RIGHT', 'CURIOUS'],
  ),
  BLINK: definition(GROUND_ALLOWED, 100, [0.24, 0.36], true, 0, ['IDLE']),
  WALK_LEFT: definition(
    GROUND_ALLOWED,
    70,
    [2, 5],
    true,
    92,
    ['IDLE', 'WALK_RIGHT'],
  ),
  WALK_RIGHT: definition(
    GROUND_ALLOWED,
    70,
    [2, 5],
    true,
    92,
    ['IDLE', 'WALK_LEFT'],
  ),
  RUN_LEFT: definition(GROUND_ALLOWED, 45, [1.4, 3], true, 205, ['IDLE']),
  RUN_RIGHT: definition(GROUND_ALLOWED, 45, [1.4, 3], true, 205, ['IDLE']),
  JUMP: definition(AIR_ALLOWED, 45, [0.15, 0.7], false, 0, ['FALL']),
  FALL: definition(AIR_ALLOWED, 45, [0, 0], false, 0, ['LAND']),
  LAND: definition(GROUND_ALLOWED, 55, [0.35, 0.55], true, 0, ['IDLE']),
  THROWN: definition(AIR_ALLOWED, 34, [0.12, 0.28], false, 0, ['FALL']),
  HUNGRY: definition(GROUND_ALLOWED, 90, [2, 4], true, 0, ['IDLE']),
  YAWN: definition(
    states('PREPARE_SLEEP', 'IDLE', 'DRAGGED'),
    90,
    [0.75, 1.05],
    true,
    0,
    ['PREPARE_SLEEP'],
  ),
  PREPARE_SLEEP: definition(
    states('SLEEP', 'IDLE', 'DRAGGED'),
    100,
    [0.8, 1.2],
    false,
    0,
    ['SLEEP'],
  ),
  SLEEP: definition(SLEEP_ALLOWED, 150, [0, 0], false, 0, []),
  WAKE_UP: definition(GROUND_ALLOWED, 80, [1, 1.5], true, 0, ['IDLE']),
  EAT: definition(GROUND_ALLOWED, 75, [1.8, 2.6], false, 0, ['HAPPY']),
  PLAY: definition(GROUND_ALLOWED, 55, [2, 3.5], true, 0, ['HAPPY']),
  DRAGGED: definition(DRAGGED_ALLOWED, 40, [0, 0], false, 0, []),
  ANGRY: definition(GROUND_ALLOWED, 70, [2, 3.5], true, 0, ['IDLE']),
  HAPPY: definition(GROUND_ALLOWED, 55, [1.5, 2.6], true, 0, ['IDLE']),
  SAD: definition(GROUND_ALLOWED, 100, [2, 4], true, 0, ['IDLE']),
  SCARED: definition(
    GROUND_ALLOWED,
    50,
    [1.3, 2.5],
    true,
    0,
    ['RUN_LEFT', 'RUN_RIGHT'],
  ),
  DIZZY: definition(GROUND_ALLOWED, 75, [1.6, 2.5], true, 0, ['IDLE']),
  CURIOUS: definition(GROUND_ALLOWED, 85, [2, 4], true, 0, ['IDLE']),
  HIDE: definition(GROUND_ALLOWED, 110, [2, 5], false, 0, ['IDLE']),
  CLIMB: definition(GROUND_ALLOWED, 75, [2, 4], false, 58, ['IDLE']),
  LOOK_AT_CURSOR: definition(
    GROUND_ALLOWED,
    70,
    [1.5, 3.5],
    true,
    0,
    ['IDLE'],
  ),
  CHASE_CURSOR: definition(
    GROUND_ALLOWED,
    55,
    [3, 8],
    true,
    240,
    ['IDLE'],
  ),
  SPECIAL_ACTION: definition(
    GROUND_ALLOWED,
    80,
    [2, 4.5],
    true,
    0,
    ['IDLE'],
  ),
  SPECIAL_EVENT: definition(
    GROUND_ALLOWED,
    80,
    [3, 6],
    false,
    0,
    ['IDLE'],
  ),
};

export class PetStateMachine {
  private elapsedSeconds = 0;
  private durationSeconds = 0;
  private readonly random: RandomSource;

  currentState: PetBehaviorState;

  constructor(
    initialState: PetBehaviorState = 'IDLE',
    random: RandomSource = Math.random,
  ) {
    this.random = random;
    this.currentState = initialState;
    this.enterState();
  }

  get definition(): PetStateDefinition {
    return PET_STATE_DEFINITIONS[this.currentState];
  }

  canChangeTo(target: PetBehaviorState): boolean {
    return this.definition.allowed.has(target);
  }

  changeState(target: PetBehaviorState, force = false): boolean {
    if (target === this.currentState) {
      return false;
    }
    if (!force && !this.canChangeTo(target)) {
      return false;
    }
    this.currentState = target;
    this.enterState();
    return true;
  }

  update(elapsedSeconds: number): PetStateTick {
    const elapsed = Math.max(0, elapsedSeconds);
    this.elapsedSeconds += elapsed;
    const direction = this.currentState.endsWith('LEFT')
      ? -1
      : this.currentState.endsWith('RIGHT')
        ? 1
        : 0;
    const movesHorizontally =
      this.currentState.startsWith('WALK_')
      || this.currentState.startsWith('RUN_');

    return {
      deltaX: movesHorizontally
        ? direction * this.definition.moveSpeed * elapsed
        : 0,
      deltaY: 0,
      completed:
        this.durationSeconds > 0
        && this.elapsedSeconds >= this.durationSeconds,
    };
  }

  private enterState(): void {
    this.elapsedSeconds = 0;
    const [minimum, maximum] = this.definition.durationRange;
    this.durationSeconds =
      maximum > 0
        ? minimum + (maximum - minimum) * clampUnit(this.random())
        : 0;
  }
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(0.999_999, value));
}
