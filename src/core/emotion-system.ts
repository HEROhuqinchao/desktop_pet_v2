import type { PetAttributes } from '../shared/contracts';
import type { PetBehaviorState } from '../shared/contracts';

export type PetEmotion =
  | 'normal'
  | 'tired'
  | 'hungry'
  | 'sad'
  | 'happy'
  | 'angry'
  | 'scared';

export interface EmotionResult {
  emotion: PetEmotion;
  suggestedState: PetBehaviorState | null;
}

/**
 * 情绪推导，顺序与 desktop_pet systems/emotion_system.py 一致：
 * 强制情绪 → 生命属性 → 临时情绪 → 默认状态。
 */
export class EmotionSystem {
  resolve(
    attributes: PetAttributes,
    options: {
      forced?: PetEmotion | null;
      temporary?: PetEmotion | null;
    } = {},
  ): EmotionResult {
    if (options.forced) {
      return { emotion: options.forced, suggestedState: stateFor(options.forced) };
    }
    if (attributes.energy < 20) {
      return { emotion: 'tired', suggestedState: 'YAWN' };
    }
    if (attributes.hunger < 20) {
      return { emotion: 'hungry', suggestedState: 'HUNGRY' };
    }
    if (attributes.mood < 25) {
      return { emotion: 'sad', suggestedState: 'SAD' };
    }
    if (options.temporary) {
      return {
        emotion: options.temporary,
        suggestedState: stateFor(options.temporary),
      };
    }
    if (attributes.mood > 80 && attributes.affection > 40) {
      return { emotion: 'happy', suggestedState: 'HAPPY' };
    }
    return { emotion: 'normal', suggestedState: null };
  }
}

function stateFor(emotion: PetEmotion): PetBehaviorState | null {
  switch (emotion) {
    case 'tired':
      return 'YAWN';
    case 'hungry':
      return 'HUNGRY';
    case 'sad':
      return 'SAD';
    case 'happy':
      return 'HAPPY';
    case 'angry':
      return 'ANGRY';
    case 'scared':
      return 'SCARED';
    default:
      return null;
  }
}
