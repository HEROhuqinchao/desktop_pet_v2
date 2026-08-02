import type {
  PetBehaviorState,
  StoryEventDefinition,
  TreasureReward,
} from '../shared/contracts';

export const STORY_EVENTS: readonly StoryEventDefinition[] = [
  {
    eventId: 'play_dead',
    name: '装死事件',
    minimumLevel: 1,
    weight: 12,
    durationSeconds: 5,
  },
  {
    eventId: 'steal_cursor',
    name: '偷鼠标事件',
    minimumLevel: 2,
    weight: 7,
    durationSeconds: 5,
  },
  {
    eventId: 'zoomies',
    name: '发疯事件',
    minimumLevel: 1,
    weight: 10,
    durationSeconds: 5,
  },
  {
    eventId: 'office',
    name: '打工事件',
    minimumLevel: 2,
    weight: 8,
    durationSeconds: 6,
  },
  {
    eventId: 'treasure',
    name: '宝箱事件',
    minimumLevel: 2,
    weight: 8,
    durationSeconds: 7,
  },
  {
    eventId: 'weather',
    name: '本地天气表演',
    minimumLevel: 1,
    weight: 6,
    durationSeconds: 7,
  },
  {
    eventId: 'holiday',
    name: '节日彩蛋',
    minimumLevel: 1,
    weight: 4,
    durationSeconds: 8,
  },
  {
    eventId: 'detective',
    name: '侦探事件',
    minimumLevel: 3,
    weight: 6,
    durationSeconds: 7,
  },
  {
    eventId: 'fake_update',
    name: '假更新事件',
    minimumLevel: 2,
    weight: 5,
    durationSeconds: 6,
  },
  {
    eventId: 'edge_adventure',
    name: '屏幕边缘探险',
    minimumLevel: 2,
    weight: 7,
    durationSeconds: 7,
  },
];

const BEHAVIOR_MAPPING: Readonly<Record<string, PetBehaviorState>> = {
  play_dead: 'HIDE',
  steal_cursor: 'CHASE_CURSOR',
  zoomies: 'RUN_RIGHT',
  office: 'IDLE',
  treasure: 'CURIOUS',
  weather: 'SPECIAL_EVENT',
  holiday: 'SPECIAL_EVENT',
  detective: 'LOOK_AT_CURSOR',
  fake_update: 'SCARED',
  edge_adventure: 'CLIMB',
};

const TREASURE_REWARDS: ReadonlyArray<{
  reward: TreasureReward;
  weight: number;
}> = [
  {
    reward: { kind: 'item', itemId: 'bread', name: '小面包', amount: 2 },
    weight: 30,
  },
  {
    reward: { kind: 'item', itemId: 'yarn-ball', name: '毛线球', amount: 1 },
    weight: 18,
  },
  {
    reward: { kind: 'experience', name: '经验', amount: 12 },
    weight: 22,
  },
  {
    reward: { kind: 'title', name: '箱子研究员', amount: 1 },
    weight: 10,
  },
  {
    reward: { kind: 'empty', name: '人生经验', amount: 0 },
    weight: 20,
  },
];

/**
 * 事件开场台词，与 desktop_pet pet_controller._start_special_event 的
 * messages 映射保持一致。
 */
export const EVENT_MESSAGES: Readonly<Record<string, string>> = {
  play_dead: '我只是临时把活力藏起来了……大概。',
  steal_cursor: '借你的鼠标影子一用，真的鼠标还给你。',
  zoomies: '紧急通知：能量正在无序释放！',
  office: '今日工作进度：打开了电脑。',
  treasure: '发现小宝箱！点我一起打开。',
  weather: '局部天气预报：土豆附近有一阵小雨。',
  holiday: '节日彩蛋到达，今天要多一点开心。',
  detective: '侦探土豆出动，正在调查鼠标轨迹。',
  fake_update: '正在更新聪明程度：1%。',
  edge_adventure: '屏幕边缘似乎藏着重要线索。',
};

export interface HolidayDefinition {
  month: number;
  day: number;
  name: string;
  message: string;
}

export class StoryEventSystem {
  private readonly events: readonly StoryEventDefinition[];

  constructor(
    private readonly random: () => number = Math.random,
    events: readonly StoryEventDefinition[] = STORY_EVENTS,
  ) {
    this.events = events;
  }

  /** 从 data/events.json 结构创建事件表。 */
  static fromRecords(
    records: readonly Record<string, unknown>[],
    random: () => number = Math.random,
  ): StoryEventSystem {
    const events: StoryEventDefinition[] = [];
    for (const value of records) {
      if (!value || typeof value.id !== 'string' || typeof value.name !== 'string') {
        continue;
      }
      events.push({
        eventId: value.id,
        name: value.name,
        minimumLevel: Math.max(1, Number(value.minimum_level ?? 1) || 1),
        weight: Math.max(0.1, Number(value.weight ?? 1) || 1),
        durationSeconds: Math.max(2, Number(value.duration_seconds ?? 5) || 5),
      });
    }
    return new StoryEventSystem(random, events);
  }

  choose(level: number, recent: string[]): StoryEventDefinition | null {
    const normalizedLevel = Math.max(1, Math.trunc(level));
    let available = this.events.filter(
      (event) =>
        event.minimumLevel <= normalizedLevel
        && !recent.slice(-3).includes(event.eventId),
    );
    if (available.length === 0) {
      available = this.events.filter(
        (event) => event.minimumLevel <= normalizedLevel,
      );
    }
    return available.length > 0
      ? chooseWeighted(available, (item) => item.weight, this.random)
      : null;
  }

  find(eventId: string): StoryEventDefinition | null {
    return this.events.find((event) => event.eventId === eventId) ?? null;
  }

  behaviorFor(eventId: string): PetBehaviorState {
    return BEHAVIOR_MAPPING[eventId] ?? 'SPECIAL_EVENT';
  }

  treasureReward(): TreasureReward {
    return { ...chooseWeighted(
      TREASURE_REWARDS,
      (item) => item.weight,
      this.random,
    ).reward };
  }

  /** 天气事件变体，季节权重与 desktop_pet event_system.weather_variant 一致。 */
  weatherVariant(now: Date = new Date()): string {
    const month = now.getMonth() + 1;
    const hour = now.getHours();
    let variants: string[];
    let weights: number[];
    if (month === 12 || month <= 2) {
      variants = ['snow', 'wind', 'sun', 'rain'];
      weights = [48, 22, 18, 12];
    } else if (month >= 9 && month <= 11) {
      variants = ['leaves', 'wind', 'sun', 'rain'];
      weights = [40, 25, 20, 15];
    } else {
      variants = ['rain', 'sun', 'wind', 'leaves'];
      weights = [32, hour >= 7 && hour <= 18 ? 30 : 12, 24, 14];
    }
    const items = variants.map((variant, index) => ({
      variant,
      weight: weights[index] ?? 1,
    }));
    return chooseWeighted(items, (item) => item.weight, this.random).variant;
  }

  todayHoliday(
    holidays: readonly HolidayDefinition[],
    today: Date = new Date(),
  ): HolidayDefinition | null {
    const month = today.getMonth() + 1;
    const day = today.getDate();
    return holidays.find(
      (holiday) => holiday.month === month && holiday.day === day,
    ) ?? null;
  }
}

function chooseWeighted<T>(
  items: readonly T[],
  weight: (item: T) => number,
  random: () => number,
): T {
  const total = items.reduce(
    (sum, item) => sum + Math.max(0.1, weight(item)),
    0,
  );
  let target = Math.max(0, Math.min(0.999999999, random())) * total;
  for (const item of items) {
    target -= Math.max(0.1, weight(item));
    if (target < 0) return item;
  }
  return items.at(-1) as T;
}
