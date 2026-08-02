import type { PetBehaviorState, PetSettings } from '../shared/contracts';
import type { RandomSource } from './pet-state-machine';

export interface PetAttributes {
  hunger: number;
  energy: number;
  mood: number;
  curiosity: number;
}

export interface BehaviorSelectionInput {
  attributes: PetAttributes;
  settings: Pick<
    PetSettings,
    'autoMove' | 'chaseCursor'
  >;
  candidates?: ReadonlySet<PetBehaviorState>;
  recentBehaviors?: readonly PetBehaviorState[];
  hour?: number;
  quietNightMode?: boolean;
}

interface WeightedBehavior {
  state: PetBehaviorState;
  weight: number;
}

export const DEFAULT_PET_ATTRIBUTES: Readonly<PetAttributes> = {
  hunger: 78,
  energy: 82,
  mood: 80,
  curiosity: 68,
};

/**
 * 权重和门槛来自 desktop_pet Python BehaviorSelector。
 */
export class BehaviorSelector {
  constructor(private readonly random: RandomSource = Math.random) {}

  select(input: BehaviorSelectionInput): PetBehaviorState {
    const hour = input.hour ?? new Date().getHours();
    const weights = new Map<PetBehaviorState, number>([
      ['IDLE', 24],
      ['BLINK', 12],
      ['WALK_LEFT', 18],
      ['WALK_RIGHT', 18],
      ['RUN_LEFT', 5],
      ['RUN_RIGHT', 5],
      ['JUMP', 5],
      ['YAWN', 3],
      ['PLAY', 5],
      ['CURIOUS', 8],
      ['LOOK_AT_CURSOR', 7],
      ['CHASE_CURSOR', 4],
    ]);

    if (input.attributes.energy < 30) {
      weights.set('YAWN', 32);
      weights.set('RUN_LEFT', 1);
      weights.set('RUN_RIGHT', 1);
    }
    if (input.attributes.hunger < 28) {
      weights.set('HUNGRY', 24);
      weights.set('PLAY', 1);
    }
    if (input.attributes.mood < 30) {
      weights.set('SAD', 24);
      weights.set('PLAY', 1);
    }
    if (input.attributes.curiosity > 70) {
      weights.set('CURIOUS', (weights.get('CURIOUS') ?? 0) + 15);
      weights.set(
        'LOOK_AT_CURSOR',
        (weights.get('LOOK_AT_CURSOR') ?? 0) + 8,
      );
    }
    if (
      input.settings.chaseCursor
      && input.attributes.energy > 35
      && input.attributes.curiosity > 45
    ) {
      weights.set(
        'CHASE_CURSOR',
        (weights.get('CHASE_CURSOR') ?? 0) + 10,
      );
    }
    if (
      input.quietNightMode !== false
      && (hour >= 23 || hour < 7)
    ) {
      weights.set('YAWN', (weights.get('YAWN') ?? 0) + 28);
      weights.set('RUN_LEFT', 0.2);
      weights.set('RUN_RIGHT', 0.2);
    }

    const allowed =
      input.candidates
      ?? (input.settings.autoMove
        ? undefined
        : new Set<PetBehaviorState>([
            'IDLE',
            'YAWN',
            'CURIOUS',
            'LOOK_AT_CURSOR',
          ]));
    const recent = new Set(input.recentBehaviors?.slice(-3) ?? []);
    const choices: WeightedBehavior[] = [];
    for (const [state, baseWeight] of weights) {
      if (allowed && !allowed.has(state)) {
        continue;
      }
      const repetitionPenalty = recent.has(state) ? 0.3 : 1;
      choices.push({
        state,
        weight: Math.max(0.01, baseWeight * repetitionPenalty),
      });
    }

    if (choices.length === 0) {
      return 'IDLE';
    }
    const total = choices.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.max(0, Math.min(0.999_999, this.random())) * total;
    for (const choice of choices) {
      cursor -= choice.weight;
      if (cursor < 0) {
        return choice.state;
      }
    }
    return choices.at(-1)?.state ?? 'IDLE';
  }
}
