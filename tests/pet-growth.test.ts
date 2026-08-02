import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PET_PROFILE,
  PetGrowthEngine,
  requiredExperience,
} from '../src/growth/pet-growth';

describe('PetGrowthEngine', () => {
  it('使用旧版初始属性并把所有数值限制在合法范围', () => {
    expect(DEFAULT_PET_PROFILE).toMatchObject({
      level: 1,
      experience: 0,
      totalExperience: 0,
      relationship: 0,
      attributes: {
        hunger: 78,
        energy: 82,
        mood: 80,
        cleanliness: 90,
        curiosity: 68,
      },
    });
  });

  it('一次奖励可以连续升级并返回新解锁内容', () => {
    const result = new PetGrowthEngine().addGrowth(
      structuredClone(DEFAULT_PET_PROFILE),
      360,
      120,
    );

    expect(requiredExperience(1)).toBe(100);
    expect(result.profile.level).toBe(3);
    expect(result.profile.experience).toBe(
      360 - requiredExperience(1) - requiredExperience(2),
    );
    expect(result.profile.relationship).toBe(120);
    expect(result.unlocked).toEqual([
      'JUMP',
      'CURIOUS',
      'RUN_LEFT',
      'RUN_RIGHT',
    ]);
  });

  it('离线属性补偿最多十二小时', () => {
    const result = new PetGrowthEngine().advance(
      structuredClone(DEFAULT_PET_PROFILE),
      24 * 60 * 60,
      { offline: true, sleeping: false, active: false },
    );

    expect(result.compensatedSeconds).toBe(12 * 60 * 60);
    expect(result.profile.attributes.hunger).toBeCloseTo(58.8);
    expect(result.profile.attributes.energy).toBeCloseTo(72.4);
  });

  it('睡眠恢复体力并保持属性不超过一百', () => {
    const profile = structuredClone(DEFAULT_PET_PROFILE);
    profile.attributes.energy = 98;
    const result = new PetGrowthEngine().advance(profile, 60 * 60, {
      offline: false,
      sleeping: true,
      active: false,
    });

    expect(result.profile.attributes.energy).toBe(100);
    expect(result.compensatedSeconds).toBe(3600);
  });
});
