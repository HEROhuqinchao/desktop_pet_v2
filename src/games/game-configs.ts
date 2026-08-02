import type { GameDifficulty } from '../shared/contracts';

/**
 * 小游戏配置加载，结构与 desktop_pet data/catch_food.json、
 * data/dodge_mouse.json 以及 games/catch_food/catch_food_config.py、
 * games/dodge_mouse/dodge_mouse_config.py 保持一致。
 */

export interface CatchItemConfig {
  itemId: string;
  name: string;
  category: string;
  score: number;
  minimumSpeed: number;
  maximumSpeed: number;
  spawnWeight: number;
  hitboxScale: number;
  effect: string;
  color: string;
  symbol: string;
}

export interface CatchFoodConfig {
  durationSeconds: number;
  countdownSeconds: number;
  targetFps: number;
  comboTimeoutSeconds: number;
  feverComboThreshold: number;
  feverDurationSeconds: number;
  feverProtectionSeconds: number;
  feverDangerFreeSeconds: number;
  specialEventProbability: number;
  specialEventIntervalSeconds: number;
  specialEventDurationSeconds: number;
  maximumTimeBonusSeconds: number;
  gradeThresholds: readonly [number, number, number, number];
  minSpawnInterval: number;
  maxSpawnInterval: number;
  maxActiveEntities: number;
  patternSeconds: number;
  gravity: number;
  windStrength: number;
  petAcceleration: number;
  petMaxSpeed: number;
  petFriction: number;
  mouseFollowStrength: number;
  magnetDurationSeconds: number;
  magnetRadius: number;
  doubleScoreDurationSeconds: number;
  reverseControlDurationSeconds: number;
  addTimeSeconds: number;
  feverScoreMultiplier: number;
  adaptive: boolean;
  modeSpeedScale: number;
  modeDangerScale: number;
  modeRewardScale: number;
  items: readonly CatchItemConfig[];
}

export interface DodgeMouseConfig {
  durationSeconds: number;
  countdownSeconds: number;
  targetFps: number;
  comboTimeoutSeconds: number;
  gradeThresholds: readonly [number, number, number, number];
  warningRadiusScale: number;
  dangerRadiusScale: number;
  hitboxInflate: number;
  minimumVisibleFraction: number;
  reactionMinSeconds: number;
  reactionMaxSeconds: number;
  acceleration: number;
  walkSpeed: number;
  maximumSpeed: number;
  friction: number;
  predictionTimeMin: number;
  predictionTimeMax: number;
  dashSpeed: number;
  dashDurationSeconds: number;
  dashWindupSeconds: number;
  dashCooldownSeconds: number;
  staminaMaximum: number;
  dashCost: number;
  staminaRecoverPerSecond: number;
  tiredThreshold: number;
  tiredDurationSeconds: number;
  stunnedDurationSeconds: number;
  feintDurationSeconds: number;
  brakeDurationSeconds: number;
  tauntDurationSeconds: number;
  stageDurationSeconds: number;
  baseHitScore: number;
  tauntBonus: number;
  dashBonus: number;
  specialEventProbability: number;
  specialEventIntervalSeconds: number;
  reactionScale: number;
  speedScale: number;
  scoreScale: number;
}

function mapping(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function gradeThresholds(
  value: unknown,
  fallback: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4) {
    return fallback;
  }
  return [
    Math.trunc(Number(value[0])),
    Math.trunc(Number(value[1])),
    Math.trunc(Number(value[2])),
    Math.trunc(Number(value[3])),
  ];
}

export function normalizeDifficulty(value: unknown): GameDifficulty {
  return value === 'easy' || value === 'challenge' ? value : 'standard';
}

export function loadCatchFoodConfig(
  payload: unknown,
  mode: GameDifficulty = 'standard',
): CatchFoodConfig {
  const root = mapping(payload);
  const modes = mapping(root.modes);
  const modeValue = mapping(modes[mode] ?? modes.standard);
  const spawn = mapping(root.spawn);
  const physics = mapping(root.physics);
  const effects = mapping(root.effects);
  const difficulty = mapping(root.difficulty);
  const items: CatchItemConfig[] = [];
  const rawItems = Array.isArray(root.items) ? root.items : [];
  for (const entry of rawItems) {
    const source = mapping(entry);
    const rawSpeeds = source.fall_speed;
    const speeds: [number, number] =
      Array.isArray(rawSpeeds) && rawSpeeds.length === 2
        ? [Number(rawSpeeds[0]) || 220, Number(rawSpeeds[1]) || 300]
        : [220, 300];
    const itemId = String(source.id ?? 'unknown').trim();
    if (!itemId) {
      continue;
    }
    items.push({
      itemId,
      name: String(source.name ?? '未知物品'),
      category: String(source.category ?? 'normal_food'),
      score: Math.trunc(numberValue(source, 'score', 0)),
      minimumSpeed: speeds[0],
      maximumSpeed: speeds[1],
      spawnWeight: Math.max(0, numberValue(source, 'spawn_weight', 1)),
      hitboxScale: Math.max(
        0.4,
        Math.min(1, numberValue(source, 'hitbox_scale', 0.75)),
      ),
      effect: String(source.effect ?? 'score'),
      color: String(source.color ?? '#E9A95B'),
      symbol: String(source.symbol ?? '?').slice(0, 2),
    });
  }
  if (items.length === 0) {
    throw new Error('接食物配置至少需要一个物品');
  }
  return {
    durationSeconds: numberValue(
      modeValue,
      'duration_seconds',
      numberValue(root, 'duration_seconds', 60),
    ),
    countdownSeconds: numberValue(root, 'countdown_seconds', 3),
    targetFps: Math.trunc(numberValue(root, 'target_fps', 60)),
    comboTimeoutSeconds: numberValue(root, 'combo_timeout_seconds', 1.8),
    feverComboThreshold: Math.trunc(numberValue(root, 'fever_combo_threshold', 20)),
    feverDurationSeconds: numberValue(root, 'fever_duration_seconds', 6),
    feverProtectionSeconds: numberValue(root, 'fever_protection_seconds', 1),
    feverDangerFreeSeconds: numberValue(root, 'fever_danger_free_seconds', 8),
    specialEventProbability: Math.max(
      0,
      Math.min(1, numberValue(root, 'special_event_probability', 0.07)),
    ),
    specialEventIntervalSeconds: numberValue(
      root,
      'special_event_interval_seconds',
      1,
    ),
    specialEventDurationSeconds: numberValue(
      root,
      'special_event_duration_seconds',
      5,
    ),
    maximumTimeBonusSeconds: numberValue(root, 'maximum_time_bonus_seconds', 15),
    gradeThresholds: gradeThresholds(root.grade_thresholds, [2400, 1500, 850, 350]),
    minSpawnInterval: numberValue(spawn, 'min_interval_ms', 280) / 1000,
    maxSpawnInterval: numberValue(spawn, 'max_interval_ms', 850) / 1000,
    maxActiveEntities: Math.trunc(numberValue(spawn, 'max_active_entities', 20)),
    patternSeconds: numberValue(spawn, 'pattern_seconds', 5),
    gravity: numberValue(physics, 'gravity', 70),
    windStrength: numberValue(physics, 'wind_strength', 25),
    petAcceleration: numberValue(physics, 'pet_acceleration', 1600),
    petMaxSpeed: numberValue(physics, 'pet_max_speed', 620),
    petFriction: numberValue(physics, 'pet_friction', 0.84),
    mouseFollowStrength: numberValue(physics, 'mouse_follow_strength', 18),
    magnetDurationSeconds: numberValue(effects, 'magnet_duration_seconds', 6),
    magnetRadius: numberValue(effects, 'magnet_radius', 180),
    doubleScoreDurationSeconds: numberValue(
      effects,
      'double_score_duration_seconds',
      5,
    ),
    reverseControlDurationSeconds: numberValue(
      effects,
      'reverse_control_duration_seconds',
      3,
    ),
    addTimeSeconds: numberValue(effects, 'add_time_seconds', 3),
    feverScoreMultiplier: numberValue(effects, 'fever_score_multiplier', 1.5),
    adaptive: difficulty.adaptive !== false,
    modeSpeedScale: numberValue(modeValue, 'speed_scale', 1),
    modeDangerScale: numberValue(modeValue, 'danger_scale', 1),
    modeRewardScale: numberValue(modeValue, 'reward_scale', 1),
    items,
  };
}

export function loadDodgeMouseConfig(
  payload: unknown,
  mode: GameDifficulty = 'standard',
): DodgeMouseConfig {
  const root = mapping(payload);
  const modes = mapping(root.modes);
  const modeValue = mapping(modes[mode] ?? modes.standard);
  const reaction = mapping(root.reaction_time_ms);
  const movement = mapping(root.movement);
  const dash = mapping(root.dash);
  const stamina = mapping(root.stamina);
  const states = mapping(root.states);
  const scoring = mapping(root.scoring);
  return {
    durationSeconds: numberValue(root, 'duration_seconds', 45),
    countdownSeconds: numberValue(root, 'countdown_seconds', 3),
    targetFps: Math.trunc(numberValue(root, 'target_fps', 60)),
    comboTimeoutSeconds: numberValue(root, 'combo_timeout_seconds', 1.5),
    gradeThresholds: gradeThresholds(root.grade_thresholds, [3500, 2400, 1500, 700]),
    warningRadiusScale: numberValue(root, 'warning_radius_scale', 2.8),
    dangerRadiusScale: numberValue(root, 'danger_radius_scale', 1.4),
    hitboxInflate: numberValue(root, 'hitbox_inflate', 1.08),
    minimumVisibleFraction: numberValue(root, 'minimum_visible_fraction', 0.4),
    reactionMinSeconds: numberValue(reaction, 'min', 140) / 1000,
    reactionMaxSeconds: numberValue(reaction, 'max', 420) / 1000,
    acceleration: numberValue(movement, 'acceleration', 1180),
    walkSpeed: numberValue(movement, 'walk_speed', 280),
    maximumSpeed: numberValue(movement, 'maximum_speed', 720),
    friction: numberValue(movement, 'friction', 0.86),
    predictionTimeMin: numberValue(movement, 'prediction_time_min', 0.12),
    predictionTimeMax: numberValue(movement, 'prediction_time_max', 0.32),
    dashSpeed: numberValue(dash, 'speed', 950),
    dashDurationSeconds: numberValue(dash, 'duration_ms', 280) / 1000,
    dashWindupSeconds: numberValue(dash, 'windup_ms', 140) / 1000,
    dashCooldownSeconds: numberValue(dash, 'cooldown_ms', 1800) / 1000,
    staminaMaximum: numberValue(stamina, 'maximum', 100),
    dashCost: numberValue(stamina, 'dash_cost', 25),
    staminaRecoverPerSecond: numberValue(stamina, 'recover_per_second', 12),
    tiredThreshold: numberValue(stamina, 'tired_threshold', 16),
    tiredDurationSeconds: numberValue(stamina, 'tired_duration_seconds', 2.2),
    stunnedDurationSeconds: numberValue(states, 'stunned_duration_seconds', 0.38),
    feintDurationSeconds: numberValue(states, 'feint_duration_seconds', 0.55),
    brakeDurationSeconds: numberValue(states, 'brake_duration_seconds', 0.42),
    tauntDurationSeconds: numberValue(states, 'taunt_duration_seconds', 2),
    stageDurationSeconds: numberValue(states, 'stage_duration_seconds', 3),
    baseHitScore: Math.trunc(numberValue(scoring, 'base_hit', 100)),
    tauntBonus: Math.trunc(numberValue(scoring, 'taunt_bonus', 50)),
    dashBonus: Math.trunc(numberValue(scoring, 'dash_bonus', 100)),
    specialEventProbability: Math.max(
      0,
      Math.min(1, numberValue(root, 'special_event_probability', 0.08)),
    ),
    specialEventIntervalSeconds: numberValue(
      root,
      'special_event_interval_seconds',
      1,
    ),
    reactionScale: numberValue(modeValue, 'reaction_scale', 1),
    speedScale: numberValue(modeValue, 'speed_scale', 1),
    scoreScale: numberValue(modeValue, 'score_scale', 1),
  };
}
