import type { PetAttributes } from '../shared/contracts';

/**
 * 自动入睡/自然醒条件，与 desktop_pet systems/sleep_system.py 一致。
 */
export class SleepSystem {
  shouldAutoSleep(
    attributes: PetAttributes,
    autoSleepEnabled: boolean,
    hour: number = new Date().getHours(),
  ): boolean {
    if (!autoSleepEnabled) {
      return false;
    }
    const currentHour = ((hour % 24) + 24) % 24;
    const night = currentHour >= 23 || currentHour < 7;
    return attributes.energy < 18 || (night && attributes.energy < 42);
  }

  shouldWake(attributes: PetAttributes): boolean {
    return attributes.energy >= 92;
  }
}
