import type {
  GameRewards,
  GrowthChange,
  PetAttributes,
  PetProfile,
} from '../shared/contracts';

const LEVEL_UNLOCKS: Readonly<Record<number, readonly string[]>> = {
  2: ['JUMP', 'CURIOUS'],
  3: ['RUN_LEFT', 'RUN_RIGHT'],
  4: ['CHASE_CURSOR', '称号：桌面巡逻员'],
  5: ['SPECIAL_EVENT', '称号：土豆搭档'],
};

export const DEFAULT_PET_ATTRIBUTES: Readonly<PetAttributes> = {
  hunger: 78,
  energy: 82,
  mood: 80,
  affection: 35,
  cleanliness: 90,
  curiosity: 68,
};

export const DEFAULT_PET_PROFILE: Readonly<PetProfile> = {
  name: '土豆',
  level: 1,
  experience: 0,
  totalExperience: 0,
  relationship: 0,
  affectionLevel: 1,
  attributes: DEFAULT_PET_ATTRIBUTES,
  unlockedActions: ['IDLE', 'WALK_LEFT', 'WALK_RIGHT', 'HAPPY'],
  titles: ['初来乍到'],
  sleeping: false,
  lastAttributeAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

export function requiredExperience(level: number): number {
  return Math.floor(100 * Math.max(1, Math.trunc(level)) ** 1.35);
}

export class PetGrowthEngine {
  addGrowth(
    source: PetProfile,
    experience: number,
    relationship: number,
  ): GrowthChange {
    const profile = normalizePetProfile(source);
    const experienceAdded = Math.max(0, Math.trunc(experience));
    const relationshipAdded = Math.trunc(relationship);
    const previousLevel = profile.level;
    const unlocked: string[] = [];
    profile.experience += experienceAdded;
    profile.totalExperience += experienceAdded;
    profile.relationship = clamp(
      profile.relationship + relationshipAdded,
      0,
      1000,
    );
    profile.affectionLevel = 1 + Math.floor(profile.relationship / 100);
    while (profile.experience >= requiredExperience(profile.level)) {
      profile.experience -= requiredExperience(profile.level);
      profile.level += 1;
      for (const item of LEVEL_UNLOCKS[profile.level] ?? []) {
        const isTitle = item.startsWith('称号：');
        const value = isTitle ? item.slice('称号：'.length) : item;
        const collection = isTitle
          ? profile.titles
          : profile.unlockedActions;
        if (!collection.includes(value)) {
          collection.push(value);
          unlocked.push(item);
        }
      }
    }
    profile.updatedAt = new Date().toISOString();
    return {
      profile,
      levelsGained: profile.level - previousLevel,
      experienceAdded,
      relationshipAdded,
      unlocked,
    };
  }

  /**
   * 小游戏奖励，与 desktop_pet games/reward_system.py 一致：
   * 经验计入等级，好感奖励进入 affection 属性（而非关系值）。
   */
  applyGameRewards(source: PetProfile, rewards: GameRewards): GrowthChange {
    const growth = this.addGrowth(source, rewards.experience, 0);
    growth.profile.attributes = normalizeAttributes({
      ...growth.profile.attributes,
      hunger: growth.profile.attributes.hunger + rewards.hunger,
      mood: growth.profile.attributes.mood + rewards.mood,
      energy: growth.profile.attributes.energy + rewards.energy,
      affection: growth.profile.attributes.affection + rewards.affection,
    });
    return growth;
  }

  advance(
    source: PetProfile,
    elapsedSeconds: number,
    options: {
      offline: boolean;
      sleeping: boolean;
      active: boolean;
      unattendedSeconds?: number;
    },
  ): { profile: PetProfile; compensatedSeconds: number } {
    const profile = normalizePetProfile(source);
    const maximumSeconds = options.offline ? 12 * 3600 : 6 * 3600;
    const compensatedSeconds = clamp(
      Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0,
      0,
      maximumSeconds,
    );
    const hours = compensatedSeconds / 3600;
    const unattendedSeconds = options.unattendedSeconds
      ?? (options.offline ? compensatedSeconds : 0);
    profile.attributes = normalizeAttributes({
      hunger: profile.attributes.hunger - 1.6 * hours,
      energy: profile.attributes.energy + (
        options.sleeping ? 10 : options.active ? -1.8 : -0.8
      ) * hours,
      mood: profile.attributes.mood + (
        unattendedSeconds > 90 * 60 ? -0.35 * hours : 0
      ),
      affection: profile.attributes.affection,
      cleanliness: profile.attributes.cleanliness - 0.3 * hours,
      curiosity: profile.attributes.curiosity + 0.25 * hours,
    });
    profile.sleeping = options.sleeping;
    profile.updatedAt = new Date().toISOString();
    return { profile, compensatedSeconds };
  }
}

export function normalizePetProfile(source: PetProfile): PetProfile {
  const profile: PetProfile = {
    ...source,
    name: String(source.name).trim().slice(0, 20) || '土豆',
    level: Math.max(1, Math.trunc(source.level)),
    experience: Math.max(0, Math.trunc(source.experience)),
    totalExperience: Math.max(0, Math.trunc(source.totalExperience)),
    relationship: clamp(Math.trunc(source.relationship), 0, 1000),
    affectionLevel: Math.max(1, Math.trunc(source.affectionLevel)),
    attributes: normalizeAttributes(source.attributes),
    unlockedActions: uniqueStrings(source.unlockedActions),
    titles: uniqueStrings(source.titles),
    sleeping: Boolean(source.sleeping),
    lastAttributeAt: validIso(source.lastAttributeAt),
    updatedAt: validIso(source.updatedAt),
  };
  profile.affectionLevel = 1 + Math.floor(profile.relationship / 100);
  return profile;
}

function normalizeAttributes(source: PetAttributes): PetAttributes {
  return {
    hunger: clamp(source.hunger),
    energy: clamp(source.energy),
    mood: clamp(source.mood),
    affection: clamp(source.affection),
    cleanliness: clamp(source.cleanliness),
    curiosity: clamp(source.curiosity),
  };
}

function uniqueStrings(value: string[]): string[] {
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function validIso(value: string): string {
  return Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString();
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  const finite = Number.isFinite(value) ? value : minimum;
  return Math.max(minimum, Math.min(maximum, finite));
}
