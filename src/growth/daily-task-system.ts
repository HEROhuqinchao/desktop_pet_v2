import type {
  DailyTaskRecord,
  PetProgressType,
} from '../shared/contracts';

type TaskTemplate = readonly [
  PetProgressType,
  string,
  number,
  number,
  number,
  number,
];

const NORMAL_TEMPLATES: readonly TaskTemplate[] = [
  ['interaction', '和宠物互动 {target} 次', 3, 8, 12, 2],
  ['feed', '喂食 {target} 次', 1, 3, 12, 2],
  ['game', '完成 {target} 局小游戏', 1, 2, 16, 3],
  ['focus', '完成 {target} 次专注', 1, 2, 20, 4],
];

const CHALLENGE_TEMPLATES: readonly TaskTemplate[] = [
  ['game_score', '小游戏累计获得 {target} 分', 300, 800, 35, 8],
  ['interaction', '今天互动 {target} 次', 12, 20, 30, 7],
  ['focus', '完成 {target} 次专注挑战', 2, 3, 40, 10],
];

export function createDailyTasks(taskDate: string): DailyTaskRecord[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) {
    throw new Error('任务日期格式无效');
  }
  const random = createRandom(hashText(taskDate));
  const normals = [...NORMAL_TEMPLATES];
  for (let index = normals.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [normals[index], normals[target]] = [normals[target], normals[index]];
  }
  const selected = [
    ...normals.slice(0, 3),
    CHALLENGE_TEMPLATES[
      Math.floor(random() * CHALLENGE_TEMPLATES.length)
    ],
  ];
  return selected.map((template, index) => {
    const [eventType, title, minimum, maximum, experience, relationship] =
      template;
    const target = minimum + Math.floor(random() * (maximum - minimum + 1));
    return {
      taskId: `${taskDate}:${index}:${eventType}`,
      taskDate,
      title: title.replace('{target}', String(target)),
      eventType,
      target,
      progress: 0,
      rewardExperience: experience,
      rewardRelationship: relationship,
      challenge: index === 3,
      claimed: false,
    };
  });
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
