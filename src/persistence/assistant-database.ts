import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  GAME_IDS,
  MEMORY_TYPES,
  PET_PROGRESS_TYPES,
  REMINDER_TYPES,
  type AchievementRecord,
  type ContentPackManifest,
  type ContentPackRecord,
  type ConversationPreferences,
  type DailyTaskRecord,
  type GameRecord,
  type GameResult,
  type GameRewards,
  type InventoryItem,
  type InventoryItemType,
  type PetCareResult,
  type PetOperationResult,
  type PetProgressResult,
  type PetProgressType,
  type PetProfile,
  type MemoryRecord,
  type MemoryType,
  type GrowthDashboard,
  type ReminderPreferences,
  type ReminderRecord,
  type ReminderScheduleType,
  type ReminderType,
  type StoryEventResult,
} from '../shared/contracts';
import {
  DEFAULT_PET_PROFILE,
  PetGrowthEngine,
  normalizePetProfile,
} from '../growth/pet-growth';
import { createDailyTasks } from '../growth/daily-task-system';
import type { StoryEventSystem } from '../events/story-event-system';
import { MemoryPolicy } from '../memory/memory-policy';
import type { FocusStorage } from '../reminders/focus-timer';
import {
  DEFAULT_REMINDER_PREFERENCES,
  normalizeDailyTimes,
  normalizeReminderPreferences,
  type ReminderStorage,
} from '../reminders/reminder-engine';

const SCHEMA_VERSION = 4;
const REMINDER_PREFERENCES_KEY = 'reminder_preferences';
const LAST_LAUNCH_DATE_KEY = 'last_launch_date';
const CONSECUTIVE_DAYS_KEY = 'consecutive_days';
const CONVERSATION_PREFERENCES_KEY = 'conversation_preferences';

/** 存档档案覆盖的业务数据表（白名单，防止导入任意表名）。 */
const ARCHIVE_TABLES = [
  'app_metadata',
  'reminders',
  'focus_sessions',
  'game_records',
  'game_results',
  'game_daily_rewards',
  'pet_profile',
  'inventory',
  'care_cooldowns',
  'daily_tasks',
  'achievements',
  'pet_statistics',
  'content_packs',
  'memories',
  'story_event_history',
] as const;

const DEFAULT_CONVERSATION_PREFERENCES: Readonly<ConversationPreferences> = {
  mode: 'local',
  endpoint: '',
  model: '',
  shareMemoriesWithAi: false,
};

interface ReminderRow {
  reminder_id: string;
  reminder_type: string;
  title: string;
  schedule_type: string;
  interval_minutes: number;
  daily_times_json: string;
  enabled: number;
  workdays_only: number;
  next_due_at: string;
  snoozed_until: string | null;
  disabled_date: string | null;
  built_in: number;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  amount: number;
}

interface MetadataRow {
  value_json: string;
}

interface GameRecordRow {
  game_id: string;
  high_score: number;
  play_count: number;
  best_combo: number;
  best_grade: string;
  best_accuracy: number;
  updated_at: string;
}

interface DailyRewardRow {
  reward_date: string;
  experience_play_count: number;
  affection_play_count: number;
  attribute_gain: number;
}

interface PetProfileRow {
  name: string;
  level: number;
  experience: number;
  total_experience: number;
  relationship: number;
  affection_level: number;
  hunger: number;
  energy: number;
  mood: number;
  affection: number;
  cleanliness: number;
  curiosity: number;
  unlocked_actions_json: string;
  titles_json: string;
  sleeping: number;
  last_attribute_at: string;
  updated_at: string;
}

interface InventoryRow {
  item_id: string;
  item_type: string;
  display_name: string;
  quantity: number;
  metadata_json: string;
}

interface CooldownRow {
  ready_at: string;
}

interface FoodDefinition {
  foodId: string;
  name: string;
  hunger: number;
  mood: number;
  energy: number;
  cooldownSeconds: number;
}

interface DailyTaskRow {
  task_id: string;
  task_date: string;
  title: string;
  event_type: string;
  target: number;
  progress: number;
  reward_experience: number;
  reward_relationship: number;
  challenge: number;
  claimed: number;
}

interface AchievementRow {
  achievement_id: string;
  name: string;
  description: string;
  unlocked_at: string | null;
}

interface StatisticRow {
  statistic_value: number;
}

interface ContentPackRow {
  pack_id: string;
  name: string;
  version: string;
  format_version: number;
  app_min_version: string;
  description: string;
  enabled: number;
  installed_at: string;
}

interface MemoryRow {
  memory_id: number;
  memory_type: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface StoryEventRow {
  event_id: string;
}

const FOODS: Readonly<Record<string, FoodDefinition>> = {
  bread: {
    foodId: 'bread',
    name: '小面包',
    hunger: 15,
    mood: 2,
    energy: 0,
    cooldownSeconds: 10,
  },
  fries: {
    foodId: 'fries',
    name: '香脆薯条',
    hunger: 10,
    mood: 8,
    energy: 0,
    cooldownSeconds: 20,
  },
  juice: {
    foodId: 'juice',
    name: '能量果汁',
    hunger: 5,
    mood: 3,
    energy: 10,
    cooldownSeconds: 30,
  },
};

const VALID_INVENTORY_TYPES = new Set<InventoryItemType>([
  'food',
  'toy',
  'skin',
  'decoration',
  'legacy',
]);

const ACHIEVEMENT_DEFINITIONS: ReadonlyArray<{
  achievementId: string;
  name: string;
  description: string;
}> = [
  {
    achievementId: 'first_touch',
    name: '初次见面',
    description: '第一次与宠物互动',
  },
  {
    achievementId: 'friendly_hand',
    name: '温柔的手',
    description: '累计互动 30 次',
  },
  {
    achievementId: 'snack_keeper',
    name: '饼干保管员',
    description: '累计喂食 10 次',
  },
  {
    achievementId: 'week_together',
    name: '一周同桌',
    description: '连续陪伴 7 天',
  },
  {
    achievementId: 'first_memory',
    name: '认真倾听',
    description: '保存第一条经确认的长期记忆',
  },
  {
    achievementId: 'first_focus',
    name: '并肩专注',
    description: '完成第一次专注计时',
  },
  {
    achievementId: 'game_500',
    name: '游戏搭档',
    description: '单局小游戏达到 500 分',
  },
];

export class AssistantDatabase implements ReminderStorage, FocusStorage {
  private database: Database.Database | null = null;
  private readonly growthEngine = new PetGrowthEngine();
  private readonly memoryPolicy = new MemoryPolicy();

  constructor(private readonly filePath: string) {}

  initialize(now = new Date()): void {
    if (this.database) {
      return;
    }
    if (this.filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
    const database = new Database(this.filePath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reminders (
        reminder_id TEXT PRIMARY KEY,
        reminder_type TEXT NOT NULL,
        title TEXT NOT NULL,
        schedule_type TEXT NOT NULL
          CHECK (schedule_type IN ('interval', 'daily')),
        interval_minutes INTEGER NOT NULL
          CHECK (interval_minutes BETWEEN 1 AND 10080),
        daily_times_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1
          CHECK (enabled IN (0, 1)),
        workdays_only INTEGER NOT NULL DEFAULT 0
          CHECK (workdays_only IN (0, 1)),
        next_due_at TEXT NOT NULL,
        snoozed_until TEXT,
        disabled_date TEXT,
        built_in INTEGER NOT NULL DEFAULT 0
          CHECK (built_in IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS focus_sessions (
        session_id TEXT PRIMARY KEY,
        planned_seconds INTEGER NOT NULL
          CHECK (planned_seconds > 0),
        elapsed_seconds INTEGER NOT NULL DEFAULT 0
          CHECK (elapsed_seconds >= 0),
        status TEXT NOT NULL
          CHECK (
            status IN (
              'running',
              'completed',
              'cancelled',
              'interrupted'
            )
          ),
        started_at TEXT NOT NULL,
        ended_at TEXT
      );

      CREATE INDEX IF NOT EXISTS reminders_due_index
        ON reminders(enabled, next_due_at);
      CREATE INDEX IF NOT EXISTS focus_status_index
        ON focus_sessions(status);

      CREATE TABLE IF NOT EXISTS game_records (
        game_id TEXT PRIMARY KEY,
        high_score INTEGER NOT NULL DEFAULT 0,
        play_count INTEGER NOT NULL DEFAULT 0,
        best_combo INTEGER NOT NULL DEFAULT 0,
        best_grade TEXT NOT NULL DEFAULT 'D',
        best_accuracy REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS game_results (
        result_id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        score INTEGER NOT NULL,
        grade TEXT NOT NULL,
        duration_seconds REAL NOT NULL,
        max_combo INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        finish_reason TEXT NOT NULL,
        rewards_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS game_daily_rewards (
        reward_date TEXT PRIMARY KEY,
        experience_play_count INTEGER NOT NULL DEFAULT 0,
        affection_play_count INTEGER NOT NULL DEFAULT 0,
        attribute_gain INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS game_results_game_index
        ON game_results(game_id, created_at);

      CREATE TABLE IF NOT EXISTS pet_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
        experience INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
        total_experience INTEGER NOT NULL DEFAULT 0
          CHECK (total_experience >= 0),
        relationship INTEGER NOT NULL DEFAULT 0
          CHECK (relationship BETWEEN 0 AND 1000),
        affection_level INTEGER NOT NULL DEFAULT 1
          CHECK (affection_level >= 1),
        hunger REAL NOT NULL CHECK (hunger BETWEEN 0 AND 100),
        energy REAL NOT NULL CHECK (energy BETWEEN 0 AND 100),
        mood REAL NOT NULL CHECK (mood BETWEEN 0 AND 100),
        affection REAL NOT NULL DEFAULT 35
          CHECK (affection BETWEEN 0 AND 100),
        cleanliness REAL NOT NULL CHECK (cleanliness BETWEEN 0 AND 100),
        curiosity REAL NOT NULL CHECK (curiosity BETWEEN 0 AND 100),
        unlocked_actions_json TEXT NOT NULL DEFAULT '[]',
        titles_json TEXT NOT NULL DEFAULT '[]',
        sleeping INTEGER NOT NULL DEFAULT 0 CHECK (sleeping IN (0, 1)),
        last_attribute_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inventory (
        item_id TEXT PRIMARY KEY,
        item_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS care_cooldowns (
        cooldown_id TEXT PRIMARY KEY,
        ready_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_tasks (
        task_id TEXT PRIMARY KEY,
        task_date TEXT NOT NULL,
        title TEXT NOT NULL,
        event_type TEXT NOT NULL,
        target INTEGER NOT NULL CHECK (target > 0),
        progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0),
        reward_experience INTEGER NOT NULL DEFAULT 0,
        reward_relationship INTEGER NOT NULL DEFAULT 0,
        challenge INTEGER NOT NULL DEFAULT 0 CHECK (challenge IN (0, 1)),
        claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed IN (0, 1))
      );

      CREATE INDEX IF NOT EXISTS daily_tasks_date_index
        ON daily_tasks(task_date);

      CREATE TABLE IF NOT EXISTS achievements (
        achievement_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        unlocked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pet_statistics (
        statistic_key TEXT PRIMARY KEY,
        statistic_value INTEGER NOT NULL DEFAULT 0
          CHECK (statistic_value >= 0)
      );

      CREATE TABLE IF NOT EXISTS content_packs (
        pack_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        format_version INTEGER NOT NULL DEFAULT 1,
        app_min_version TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        installed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        memory_id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS story_event_history (
        history_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        reward_json TEXT NOT NULL DEFAULT 'null',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS story_event_history_created_index
        ON story_event_history(created_at DESC);
    `);
    database.pragma(`user_version = ${SCHEMA_VERSION}`);
    this.database = database;
    this.migrateSchema();
    this.ensurePetProfile(now);
    this.ensureDefaultInventory();
    this.ensureAchievements();
    this.ensureDailyTasks(localDateKey(now));
    this.recordDailyLaunch(now);
    this.unlockAchievements(now);
    if (!this.readMetadata(REMINDER_PREFERENCES_KEY)) {
      this.saveReminderPreferences({
        ...DEFAULT_REMINDER_PREFERENCES,
        shutdownChecklistItems: [
          ...DEFAULT_REMINDER_PREFERENCES.shutdownChecklistItems,
        ],
      });
    }
  }

  close(): void {
    this.database?.close();
    this.database = null;
  }

  /** schema v3 → v4：为旧库补充 affection（好感）列。 */
  private migrateSchema(): void {
    const columns = this.connection()
      .prepare<[], { name: string }>('PRAGMA table_info(pet_profile)')
      .all()
      .map((row) => row.name);
    if (columns.length > 0 && !columns.includes('affection')) {
      this.connection()
        .exec(
          'ALTER TABLE pet_profile ADD COLUMN affection REAL NOT NULL DEFAULT 35',
        );
    }
  }

  listReminders(): ReminderRecord[] {
    const rows = this.connection()
      .prepare<[], ReminderRow>(`
        SELECT
          reminder_id,
          reminder_type,
          title,
          schedule_type,
          interval_minutes,
          daily_times_json,
          enabled,
          workdays_only,
          next_due_at,
          snoozed_until,
          disabled_date,
          built_in,
          created_at,
          updated_at
        FROM reminders
        ORDER BY built_in DESC, created_at ASC, reminder_id ASC
      `)
      .all();
    return rows.map(reminderFromRow);
  }

  findReminder(reminderId: string): ReminderRecord | null {
    const row = this.connection()
      .prepare<[string], ReminderRow>(`
        SELECT
          reminder_id,
          reminder_type,
          title,
          schedule_type,
          interval_minutes,
          daily_times_json,
          enabled,
          workdays_only,
          next_due_at,
          snoozed_until,
          disabled_date,
          built_in,
          created_at,
          updated_at
        FROM reminders
        WHERE reminder_id = ?
      `)
      .get(reminderId);
    return row ? reminderFromRow(row) : null;
  }

  saveReminder(reminder: ReminderRecord): void {
    this.connection()
      .prepare(`
        INSERT INTO reminders (
          reminder_id,
          reminder_type,
          title,
          schedule_type,
          interval_minutes,
          daily_times_json,
          enabled,
          workdays_only,
          next_due_at,
          snoozed_until,
          disabled_date,
          built_in,
          created_at,
          updated_at
        ) VALUES (
          @reminderId,
          @reminderType,
          @title,
          @scheduleType,
          @intervalMinutes,
          @dailyTimesJson,
          @enabled,
          @workdaysOnly,
          @nextDueAt,
          @snoozedUntil,
          @disabledDate,
          @builtIn,
          @createdAt,
          @updatedAt
        )
        ON CONFLICT(reminder_id) DO UPDATE SET
          reminder_type = excluded.reminder_type,
          title = excluded.title,
          schedule_type = excluded.schedule_type,
          interval_minutes = excluded.interval_minutes,
          daily_times_json = excluded.daily_times_json,
          enabled = excluded.enabled,
          workdays_only = excluded.workdays_only,
          next_due_at = excluded.next_due_at,
          snoozed_until = excluded.snoozed_until,
          disabled_date = excluded.disabled_date,
          built_in = excluded.built_in,
          updated_at = excluded.updated_at
      `)
      .run({
        reminderId: reminder.reminderId,
        reminderType: reminder.reminderType,
        title: reminder.title,
        scheduleType: reminder.scheduleType,
        intervalMinutes: reminder.intervalMinutes,
        dailyTimesJson: JSON.stringify(reminder.dailyTimes),
        enabled: reminder.enabled ? 1 : 0,
        workdaysOnly: reminder.workdaysOnly ? 1 : 0,
        nextDueAt: reminder.nextDueAt,
        snoozedUntil: reminder.snoozedUntil,
        disabledDate: reminder.disabledDate,
        builtIn: reminder.builtIn ? 1 : 0,
        createdAt: reminder.createdAt,
        updatedAt: reminder.updatedAt,
      });
  }

  deleteReminder(reminderId: string): boolean {
    const result = this.connection()
      .prepare('DELETE FROM reminders WHERE reminder_id = ?')
      .run(reminderId);
    return result.changes === 1;
  }

  getReminderPreferences(): ReminderPreferences {
    const stored = this.readMetadata(REMINDER_PREFERENCES_KEY);
    if (!stored) {
      return {
        ...DEFAULT_REMINDER_PREFERENCES,
        shutdownChecklistItems: [
          ...DEFAULT_REMINDER_PREFERENCES.shutdownChecklistItems,
        ],
      };
    }
    try {
      return normalizeReminderPreferences(
        JSON.parse(stored) as Partial<ReminderPreferences>,
      );
    } catch {
      return normalizeReminderPreferences({});
    }
  }

  saveReminderPreferences(preferences: ReminderPreferences): void {
    const normalized = normalizeReminderPreferences(preferences);
    this.connection()
      .prepare(`
        INSERT INTO app_metadata(key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(
        REMINDER_PREFERENCES_KEY,
        JSON.stringify(normalized),
        new Date().toISOString(),
      );
  }

  startFocusSession(
    sessionId: string,
    plannedSeconds: number,
    startedAt: string,
  ): void {
    this.connection()
      .prepare(`
        INSERT INTO focus_sessions (
          session_id,
          planned_seconds,
          elapsed_seconds,
          status,
          started_at
        ) VALUES (?, ?, 0, 'running', ?)
      `)
      .run(sessionId, Math.max(1, Math.round(plannedSeconds)), startedAt);
  }

  finishFocusSession(
    sessionId: string,
    elapsedSeconds: number,
    status: 'completed' | 'cancelled' | 'interrupted',
    endedAt: string,
  ): void {
    this.connection()
      .prepare(`
        UPDATE focus_sessions
        SET elapsed_seconds = ?, status = ?, ended_at = ?
        WHERE session_id = ?
      `)
      .run(
        Math.max(0, Math.round(elapsedSeconds)),
        status,
        endedAt,
        sessionId,
      );
  }

  countCompletedFocusSessions(): number {
    const row = this.connection()
      .prepare<[], CountRow>(`
        SELECT COUNT(*) AS amount
        FROM focus_sessions
        WHERE status = 'completed'
      `)
      .get();
    return row?.amount ?? 0;
  }

  interruptOpenFocusSessions(endedAt: string): void {
    this.connection()
      .prepare(`
        UPDATE focus_sessions
        SET status = 'interrupted', ended_at = ?
        WHERE status = 'running'
      `)
      .run(endedAt);
  }

  getPetProfile(): PetProfile {
    const row = this.connection()
      .prepare<[], PetProfileRow>(`
        SELECT
          name,
          level,
          experience,
          total_experience,
          relationship,
          affection_level,
          hunger,
          energy,
          mood,
          affection,
          cleanliness,
          curiosity,
          unlocked_actions_json,
          titles_json,
          sleeping,
          last_attribute_at,
          updated_at
        FROM pet_profile
        WHERE id = 1
      `)
      .get();
    if (!row) {
      throw new Error('宠物成长档案尚未初始化');
    }
    return normalizePetProfile({
      name: row.name,
      level: row.level,
      experience: row.experience,
      totalExperience: row.total_experience,
      relationship: row.relationship,
      affectionLevel: row.affection_level,
      attributes: {
        hunger: row.hunger,
        energy: row.energy,
        mood: row.mood,
        affection: row.affection,
        cleanliness: row.cleanliness,
        curiosity: row.curiosity,
      },
      unlockedActions: parseStringArray(row.unlocked_actions_json),
      titles: parseStringArray(row.titles_json),
      sleeping: row.sleeping === 1,
      lastAttributeAt: row.last_attribute_at,
      updatedAt: row.updated_at,
    });
  }

  addPetGrowth(
    experience: number,
    relationship: number,
    now = new Date(),
  ): PetProfile {
    return this.connection().transaction(() => {
      const growth = this.growthEngine.addGrowth(
        this.getPetProfile(),
        experience,
        relationship,
      );
      growth.profile.updatedAt = now.toISOString();
      this.savePetProfile(growth.profile);
      return growth.profile;
    })();
  }

  listInventory(): InventoryItem[] {
    return this.connection()
      .prepare<[], InventoryRow>(`
        SELECT item_id, item_type, display_name, quantity, metadata_json
        FROM inventory
        ORDER BY item_type, display_name, item_id
      `)
      .all()
      .map(inventoryFromRow);
  }

  getGrowthDashboard(now = new Date()): GrowthDashboard {
    const taskDate = localDateKey(now);
    this.ensureDailyTasks(taskDate);
    return {
      profile: this.getPetProfile(),
      consecutiveDays: this.statistic('consecutive_days'),
      tasks: this.listDailyTasks(taskDate),
      achievements: this.listAchievements(),
      inventory: this.listInventory(),
    };
  }

  getConversationPreferences(): ConversationPreferences {
    const stored = this.readMetadata(CONVERSATION_PREFERENCES_KEY);
    if (!stored) return { ...DEFAULT_CONVERSATION_PREFERENCES };
    try {
      return normalizeConversationPreferences(JSON.parse(stored));
    } catch {
      return { ...DEFAULT_CONVERSATION_PREFERENCES };
    }
  }

  saveConversationPreferences(
    preferences: ConversationPreferences,
    now = new Date(),
  ): ConversationPreferences {
    const normalized = normalizeConversationPreferences(preferences);
    this.saveMetadata(
      CONVERSATION_PREFERENCES_KEY,
      JSON.stringify(normalized),
      now,
    );
    return normalized;
  }

  recordPetProgress(
    eventType: PetProgressType,
    amount = 1,
    now = new Date(),
  ): PetProgressResult {
    if (!PET_PROGRESS_TYPES.includes(eventType)) {
      throw new Error('不支持的成长事件');
    }
    const normalizedAmount = Math.max(0, Math.trunc(amount));
    return this.connection().transaction(() => {
      const taskDate = localDateKey(now);
      this.ensureDailyTasks(taskDate);
      if (normalizedAmount > 0) {
        this.connection()
          .prepare(`
            UPDATE daily_tasks
            SET progress = MIN(target, progress + ?)
            WHERE task_date = ? AND event_type = ?
          `)
          .run(normalizedAmount, taskDate, eventType);
        this.updateStatistics(eventType, normalizedAmount);
        if (eventType === 'interaction') {
          this.bumpInteractionCount(now);
        }
      }
      const unlockedAchievements = this.unlockAchievements(now);
      return {
        dashboard: this.getGrowthDashboard(now),
        unlockedAchievements,
      };
    })();
  }

  claimDailyTask(taskId: string, now = new Date()): PetOperationResult {
    return this.connection().transaction(() => {
      const task = this.connection()
        .prepare<[string], DailyTaskRow>(`
          SELECT
            task_id,
            task_date,
            title,
            event_type,
            target,
            progress,
            reward_experience,
            reward_relationship,
            challenge,
            claimed
          FROM daily_tasks
          WHERE task_id = ?
        `)
        .get(taskId);
      if (!task || task.task_date !== localDateKey(now)) {
        return { ok: false, message: '今日任务不存在' };
      }
      if (task.progress < task.target) {
        return { ok: false, message: '任务尚未完成' };
      }
      if (task.claimed === 1) {
        return { ok: false, message: '任务奖励已经领取' };
      }
      const changed = this.connection()
        .prepare(`
          UPDATE daily_tasks SET claimed = 1
          WHERE task_id = ? AND claimed = 0
        `)
        .run(taskId);
      if (changed.changes !== 1) {
        return { ok: false, message: '任务奖励已经领取' };
      }
      const growth = this.growthEngine.addGrowth(
        this.getPetProfile(),
        task.reward_experience,
        task.reward_relationship,
      );
      growth.profile.updatedAt = now.toISOString();
      this.savePetProfile(growth.profile);
      return {
        ok: true,
        message:
          `已领取经验 ${task.reward_experience}、关系值 ${task.reward_relationship}`,
      };
    })();
  }

  grantInventory(
    itemId: string,
    itemType: string,
    displayName: string,
    amount = 1,
    metadata: Record<string, unknown> = {},
  ): PetOperationResult {
    const normalizedId = itemId.trim();
    const normalizedName = displayName.trim().slice(0, 80);
    const normalizedAmount = Math.trunc(amount);
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(normalizedId)) {
      return { ok: false, message: '物品 ID 格式无效' };
    }
    if (!VALID_INVENTORY_TYPES.has(itemType as InventoryItemType)) {
      return { ok: false, message: '不支持的物品类型' };
    }
    if (!normalizedName || normalizedAmount <= 0) {
      return { ok: false, message: '物品名称和发放数量无效' };
    }
    let metadataJson: string;
    try {
      metadataJson = JSON.stringify(metadata);
    } catch {
      return { ok: false, message: '物品元数据无法序列化' };
    }
    if (metadataJson.length > 10_000) {
      return { ok: false, message: '物品元数据过大' };
    }
    this.connection()
      .prepare(`
        INSERT INTO inventory (
          item_id, item_type, display_name, quantity, metadata_json
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET
          item_type = excluded.item_type,
          display_name = excluded.display_name,
          quantity = inventory.quantity + excluded.quantity,
          metadata_json = excluded.metadata_json
      `)
      .run(
        normalizedId,
        itemType,
        normalizedName,
        normalizedAmount,
        metadataJson,
      );
    return { ok: true, message: `已获得${normalizedName} × ${normalizedAmount}` };
  }

  consumeInventory(itemId: string, amount = 1): PetOperationResult {
    const normalizedAmount = Math.trunc(amount);
    if (normalizedAmount <= 0) {
      return { ok: false, message: '消费数量必须大于零' };
    }
    const item = this.connection()
      .prepare<[string], InventoryRow>(`
        SELECT item_id, item_type, display_name, quantity, metadata_json
        FROM inventory WHERE item_id = ?
      `)
      .get(itemId);
    if (!item || item.quantity < normalizedAmount) {
      return { ok: false, message: '物品数量不足' };
    }
    this.connection()
      .prepare(`UPDATE inventory SET quantity = quantity - ? WHERE item_id = ?`)
      .run(normalizedAmount, itemId);
    return { ok: true, message: `已使用${item.display_name} × ${normalizedAmount}` };
  }

  listContentPacks(): ContentPackRecord[] {
    return this.connection()
      .prepare<[], ContentPackRow>(`
        SELECT
          pack_id,
          name,
          version,
          format_version,
          app_min_version,
          description,
          enabled,
          installed_at
        FROM content_packs
        ORDER BY installed_at, pack_id
      `)
      .all()
      .map((row) => ({
        packId: row.pack_id,
        name: row.name,
        version: row.version,
        formatVersion: 1,
        appMinVersion: row.app_min_version,
        description: row.description,
        enabled: row.enabled === 1,
        installedAt: row.installed_at,
      }));
  }

  saveContentPack(manifest: ContentPackManifest, installedAt = new Date()): void {
    this.connection()
      .prepare(`
        INSERT INTO content_packs (
          pack_id,
          name,
          version,
          format_version,
          app_min_version,
          description,
          enabled,
          installed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `)
      .run(
        manifest.packId,
        manifest.name,
        manifest.version,
        manifest.formatVersion,
        manifest.appMinVersion,
        manifest.description,
        installedAt.toISOString(),
      );
  }

  setContentPackEnabled(packId: string, enabled: boolean): boolean {
    return this.connection()
      .prepare('UPDATE content_packs SET enabled = ? WHERE pack_id = ?')
      .run(enabled ? 1 : 0, packId).changes === 1;
  }

  deleteContentPack(packId: string): boolean {
    return this.connection()
      .prepare('DELETE FROM content_packs WHERE pack_id = ?')
      .run(packId).changes === 1;
  }

  listMemories(): MemoryRecord[] {
    return this.connection()
      .prepare<[], MemoryRow>(`
        SELECT memory_id, memory_type, content, created_at, updated_at
        FROM memories
        ORDER BY created_at, memory_id
      `)
      .all()
      .map(memoryFromRow);
  }

  createMemory(
    memoryType: MemoryType,
    content: string,
    now = new Date(),
  ): MemoryRecord {
    if (!MEMORY_TYPES.includes(memoryType)) {
      throw new Error('不支持的记忆类型');
    }
    return this.connection().transaction(() => {
      const timestamp = now.toISOString();
      const result = this.connection()
        .prepare(`
          INSERT INTO memories(memory_type, content, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `)
        .run(memoryType, content, timestamp, timestamp);
      this.recordPetProgress('memory', 1, now);
      const row = this.connection()
        .prepare<[number], MemoryRow>(`
          SELECT memory_id, memory_type, content, created_at, updated_at
          FROM memories WHERE memory_id = ?
        `)
        .get(Number(result.lastInsertRowid));
      if (!row) throw new Error('长期记忆保存失败');
      return memoryFromRow(row);
    })();
  }

  updateMemory(memoryId: number, content: string, now = new Date()): boolean {
    return this.connection()
      .prepare(`
        UPDATE memories SET content = ?, updated_at = ? WHERE memory_id = ?
      `)
      .run(content, now.toISOString(), memoryId).changes === 1;
  }

  deleteMemory(memoryId: number): boolean {
    return this.connection()
      .prepare('DELETE FROM memories WHERE memory_id = ?')
      .run(memoryId).changes === 1;
  }

  clearMemories(): number {
    return this.connection().prepare('DELETE FROM memories').run().changes;
  }

  listRecentStoryEventIds(limit = 3): string[] {
    const rows = this.connection()
      .prepare<[number], StoryEventRow>(`
        SELECT event_id
        FROM story_event_history
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      `)
      .all(Math.max(1, Math.min(20, Math.trunc(limit))));
    return rows.map((row) => row.event_id).reverse();
  }

  /** 记录一次随机事件（对应基准 recent_events 与 completed_events 统计）。 */
  recordStoryEvent(
    eventId: string,
    rewardJson: string | null = null,
    now = new Date(),
  ): void {
    this.connection()
      .prepare(`
        INSERT INTO story_event_history (
          history_id, event_id, reward_json, created_at
        ) VALUES (?, ?, ?, ?)
      `)
      .run(randomUUID(), eventId, rewardJson ?? 'null', now.toISOString());
  }

  /** 发放称号（去重），对应基准宝箱奖励的 title 分支。 */
  grantTitle(name: string, now = new Date()): boolean {
    const profile = this.getPetProfile();
    if (profile.titles.includes(name)) {
      return false;
    }
    profile.titles.push(name);
    profile.updatedAt = now.toISOString();
    this.savePetProfile(profile);
    return true;
  }

  runStoryEvent(
    system: StoryEventSystem,
    now = new Date(),
  ): StoryEventResult | null {
    return this.connection().transaction(() => {
      const profile = this.getPetProfile();
      const event = system.choose(
        profile.level,
        this.listRecentStoryEventIds(),
      );
      if (!event) return null;
      const reward = event.eventId === 'treasure'
        ? system.treasureReward()
        : null;
      if (reward?.kind === 'item') {
        this.grantInventory(
          reward.itemId,
          reward.itemId === 'bread' ? 'food' : 'toy',
          reward.name,
          reward.amount,
        );
      } else if (reward?.kind === 'experience') {
        this.addPetGrowth(reward.amount, 0, now);
      } else if (reward?.kind === 'title') {
        const current = this.getPetProfile();
        if (!current.titles.includes(reward.name)) {
          current.titles.push(reward.name);
          current.updatedAt = now.toISOString();
          this.savePetProfile(current);
        }
      }
      this.connection()
        .prepare(`
          INSERT INTO story_event_history (
            history_id, event_id, reward_json, created_at
          ) VALUES (?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          event.eventId,
          JSON.stringify(reward),
          now.toISOString(),
        );
      return {
        event,
        behaviorState: system.behaviorFor(event.eventId),
        reward,
        message: reward
          ? `${event.name}：获得${reward.name}${reward.amount > 0 ? ` × ${reward.amount}` : ''}`
          : `土豆正在进行${event.name}`,
      };
    })();
  }

  exportPersonalData(targetPath: string, now = new Date()): void {
    const payload = {
      formatVersion: 1,
      exportedAt: now.toISOString(),
      profile: this.getPetProfile(),
      memories: this.listMemories(),
      achievements: this.listAchievements(),
      inventory: this.listInventory(),
      games: this.listGameRecords(),
      contentPacks: this.listContentPacks(),
      reminderPreferences: this.getReminderPreferences(),
      reminders: this.listReminders(),
    };
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporary = `${targetPath}.tmp-${randomUUID()}`;
    fs.writeFileSync(
      temporary,
      `${JSON.stringify(payload, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    replaceFile(temporary, targetPath);
  }

  importPersonalData(sourcePath: string, now = new Date()): PetOperationResult {
    let source: unknown;
    try {
      const stats = fs.statSync(sourcePath);
      if (!stats.isFile() || stats.size > 20 * 1024 * 1024) {
        return { ok: false, message: '个人数据文件无效或体积过大' };
      }
      source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    } catch {
      return { ok: false, message: '无法读取个人数据文件' };
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return { ok: false, message: '个人数据顶层格式无效' };
    }
    const value = source as Record<string, unknown>;
    if (value.formatVersion !== 1) {
      return { ok: false, message: '个人数据格式版本不兼容' };
    }
    let profile: PetProfile | null = null;
    try {
      profile = value.profile === null
        ? null
        : parsePortableProfile(value.profile);
    } catch (error) {
      return { ok: false, message: `成长档案无效：${errorMessage(error)}` };
    }
    if (!Array.isArray(value.memories) || !Array.isArray(value.inventory)) {
      return { ok: false, message: '个人数据缺少记忆或背包数组' };
    }
    const memories: Array<{ memoryType: MemoryType; content: string }> = [];
    for (const item of value.memories) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { ok: false, message: '长期记忆格式无效' };
      }
      const memory = item as Record<string, unknown>;
      const memoryType = String(memory.memoryType ?? '');
      const validation = this.memoryPolicy.validate(String(memory.content ?? ''));
      if (!MEMORY_TYPES.includes(memoryType as MemoryType) || !validation.ok) {
        return { ok: false, message: validation.ok ? '记忆类型无效' : validation.message };
      }
      memories.push({
        memoryType: memoryType as MemoryType,
        content: validation.message,
      });
    }
    const inventory: InventoryItem[] = [];
    for (const item of value.inventory) {
      const parsed = parsePortableInventoryItem(item);
      if (!parsed) {
        return { ok: false, message: '背包物品格式无效' };
      }
      inventory.push(parsed);
    }
    try {
      this.connection().transaction(() => {
        this.connection().prepare('DELETE FROM memories').run();
        this.connection().prepare('DELETE FROM inventory').run();
        if (profile) {
          profile.updatedAt = now.toISOString();
          this.savePetProfile(profile);
        }
        for (const memory of memories) {
          this.createMemory(memory.memoryType, memory.content, now);
        }
        for (const item of inventory) {
          this.connection().prepare(`
            INSERT INTO inventory (
              item_id, item_type, display_name, quantity, metadata_json
            ) VALUES (?, ?, ?, ?, ?)
          `).run(
            item.itemId,
            item.itemType,
            item.displayName,
            item.quantity,
            JSON.stringify(item.metadata),
          );
        }
      })();
      return { ok: true, message: '个人数据导入完成' };
    } catch (error) {
      return { ok: false, message: `个人数据导入失败：${errorMessage(error)}` };
    }
  }

  async backupDatabase(targetPath: string): Promise<void> {
    if (this.filePath === ':memory:') {
      throw new Error('内存数据库不能创建文件备份');
    }
    if (path.resolve(targetPath) === path.resolve(this.filePath)) {
      throw new Error('备份目标不能是当前数据库');
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporary = `${targetPath}.tmp-${randomUUID()}`;
    try {
      await this.connection().backup(temporary);
      validateDatabaseFile(temporary);
      replaceFile(temporary, targetPath);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }

  async restoreDatabase(sourcePath: string): Promise<void> {
    if (this.filePath === ':memory:') {
      throw new Error('内存数据库不能恢复文件备份');
    }
    if (path.resolve(sourcePath) === path.resolve(this.filePath)) {
      throw new Error('恢复来源不能是当前数据库');
    }
    validateDatabaseFile(sourcePath);
    const rollback = `${this.filePath}.rollback-${randomUUID()}`;
    const replacement = `${this.filePath}.restore-${randomUUID()}`;
    await this.connection().backup(rollback);
    fs.copyFileSync(sourcePath, replacement, fs.constants.COPYFILE_EXCL);
    this.close();
    try {
      fs.rmSync(`${this.filePath}-wal`, { force: true });
      fs.rmSync(`${this.filePath}-shm`, { force: true });
      replaceFile(replacement, this.filePath);
      this.initialize();
      if (this.integrityCheck() !== 'ok') {
        throw new Error('恢复后的数据库完整性检查失败');
      }
      fs.rmSync(rollback, { force: true });
    } catch (error) {
      this.close();
      fs.rmSync(replacement, { force: true });
      fs.copyFileSync(rollback, this.filePath);
      fs.rmSync(rollback, { force: true });
      this.initialize();
      throw error;
    }
  }

  integrityCheck(): string {
    return String(
      this.connection().pragma('integrity_check', { simple: true }) ?? '',
    );
  }

  /** 重置成长数据，对应 desktop_pet privacy_window 的"重置成长数据"。 */
  resetGrowthData(now = new Date()): PetProfile {
    return this.connection().transaction(() => {
      const profile = this.getPetProfile();
      profile.level = 1;
      profile.experience = 0;
      profile.totalExperience = 0;
      profile.relationship = 0;
      profile.affectionLevel = 1;
      profile.updatedAt = now.toISOString();
      this.savePetProfile(profile);
      return this.getPetProfile();
    })();
  }

  /**
   * 清空全部个人数据，对应 desktop_pet backup_service.clear_personal_data
   * 与 pet_controller._delete_all_phase4_data 的数据库部分。
   */
  clearAllPersonalData(now = new Date()): void {
    this.connection().transaction(() => {
      this.clearAllPersonalDataInner();
    })();
    this.ensurePetProfile(now);
    this.ensureDefaultInventory();
    this.ensureAchievements();
    this.ensureDailyTasks(localDateKey(now));
    this.saveReminderPreferences({
      ...DEFAULT_REMINDER_PREFERENCES,
      shutdownChecklistItems: [
        ...DEFAULT_REMINDER_PREFERENCES.shutdownChecklistItems,
      ],
    });
  }

  private clearAllPersonalDataInner(): void {
    for (const table of ARCHIVE_TABLES) {
      this.connection().prepare(`DELETE FROM ${table}`).run();
    }
    this.connection().prepare('DELETE FROM pet_profile').run();
  }

  /** 导出完整存档档案（存档导出/导入对应基准 save_system.export_archive）。 */
  exportArchive(now = new Date()): Record<string, unknown> {
    const data: Record<string, unknown[]> = {};
    for (const table of ARCHIVE_TABLES) {
      data[table] = this.connection()
        .prepare<[], Record<string, unknown>>(`SELECT * FROM ${table}`)
        .all();
    }
    return {
      format: 'desktop-pet-v2-save-archive',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      tables: data,
    };
  }

  /** 导入完整存档档案，替换当前业务数据。 */
  importArchive(payload: unknown, now = new Date()): PetOperationResult {
    if (!payload || typeof payload !== 'object') {
      return { ok: false, message: '存档档案格式无效' };
    }
    const tables = (payload as { tables?: unknown }).tables;
    if (!tables || typeof tables !== 'object') {
      return { ok: false, message: '存档档案缺少数据表' };
    }
    const source = tables as Record<string, unknown>;
    for (const table of Object.keys(source)) {
      if (!(ARCHIVE_TABLES as readonly string[]).includes(table)) {
        return { ok: false, message: `存档档案包含未知数据表：${table}` };
      }
    }
    try {
      this.connection().transaction(() => {
        this.clearAllPersonalDataInner();
        // 先恢复默认档案行，保证存档中的 pet_profile 更新有目标行。
        this.ensurePetProfile(now);
        for (const [table, rows] of Object.entries(source)) {
          if (!Array.isArray(rows) || rows.length === 0) {
            continue;
          }
          if (table === 'pet_profile') {
            for (const row of rows) {
              if (!row || typeof row !== 'object') {
                continue;
              }
              const record = row as Record<string, unknown>;
              this.connection()
                .prepare(`
                  UPDATE pet_profile SET
                    name = ?,
                    level = ?,
                    experience = ?,
                    total_experience = ?,
                    relationship = ?,
                    affection_level = ?,
                    hunger = ?,
                    energy = ?,
                    mood = ?,
                    affection = ?,
                    cleanliness = ?,
                    curiosity = ?,
                    unlocked_actions_json = ?,
                    titles_json = ?,
                    sleeping = ?,
                    last_attribute_at = ?,
                    updated_at = ?
                  WHERE id = 1
                `)
                .run(
                  String(record.name ?? '土豆'),
                  Number(record.level ?? 1),
                  Number(record.experience ?? 0),
                  Number(record.total_experience ?? 0),
                  Number(record.relationship ?? 0),
                  Number(record.affection_level ?? 1),
                  Number(record.hunger ?? 78),
                  Number(record.energy ?? 82),
                  Number(record.mood ?? 80),
                  Number(record.affection ?? 35),
                  Number(record.cleanliness ?? 90),
                  Number(record.curiosity ?? 68),
                  String(record.unlocked_actions_json ?? '[]'),
                  String(record.titles_json ?? '[]'),
                  Number(record.sleeping ?? 0),
                  String(record.last_attribute_at ?? now.toISOString()),
                  String(record.updated_at ?? now.toISOString()),
                );
            }
            continue;
          }
          const first = rows[0];
          if (!first || typeof first !== 'object') {
            continue;
          }
          const columns = Object.keys(first as Record<string, unknown>);
          const placeholders = columns.map(() => '?').join(', ');
          const statement = this.connection().prepare(`
            INSERT OR REPLACE INTO ${table} (${columns.join(', ')})
            VALUES (${placeholders})
          `);
          for (const row of rows) {
            if (!row || typeof row !== 'object') {
              continue;
            }
            const record = row as Record<string, unknown>;
            statement.run(...columns.map((column) => record[column] ?? null));
          }
        }
      })();
      this.ensurePetProfile(now);
      this.ensureDefaultInventory();
      this.ensureAchievements();
      this.ensureDailyTasks(localDateKey(now));
      return { ok: true, message: '存档档案已导入' };
    } catch (error) {
      return {
        ok: false,
        message: `存档档案导入失败：${errorMessage(error)}`,
      };
    }
  }

  /**
   * 喂食，与 desktop_pet systems/feeding_system.py 行为一致：
   * 只受饱食上限与食物冷却限制，不消耗背包物品。
   */
  feedPet(foodId: string, now = new Date()): PetCareResult {
    const food = FOODS[foodId];
    if (!food) {
      return { ok: false, message: '这个食物暂时不在菜单里。' };
    }
    return this.connection().transaction(() => {
      const profile = this.getPetProfile();
      if (profile.attributes.hunger > 95) {
        return {
          ok: false,
          message: '已经吃得圆滚滚啦，晚点再来。',
          profile,
        };
      }
      const cooldownId = `food:${food.foodId}`;
      const cooldown = this.connection()
        .prepare<[string], CooldownRow>(`
          SELECT ready_at FROM care_cooldowns WHERE cooldown_id = ?
        `)
        .get(cooldownId);
      const remaining = cooldown
        ? Math.max(0, (Date.parse(cooldown.ready_at) - now.getTime()) / 1000)
        : 0;
      if (remaining > 0) {
        return {
          ok: false,
          message: `${food.name}还要等 ${Math.max(1, Math.round(remaining))} 秒。`,
          profile,
          cooldownRemaining: remaining,
        };
      }
      const growth = this.growthEngine.addGrowth(profile, 5, 0);
      growth.profile.attributes.hunger = clampAttribute(
        growth.profile.attributes.hunger + food.hunger,
      );
      growth.profile.attributes.mood = clampAttribute(
        growth.profile.attributes.mood + food.mood,
      );
      growth.profile.attributes.energy = clampAttribute(
        growth.profile.attributes.energy + food.energy,
      );
      growth.profile.lastAttributeAt = now.toISOString();
      growth.profile.updatedAt = now.toISOString();
      this.savePetProfile(growth.profile);
      this.connection()
        .prepare(`
          INSERT INTO care_cooldowns(cooldown_id, ready_at)
          VALUES (?, ?)
          ON CONFLICT(cooldown_id) DO UPDATE SET ready_at = excluded.ready_at
        `)
        .run(
          cooldownId,
          new Date(now.getTime() + food.cooldownSeconds * 1000).toISOString(),
        );
      this.recordPetProgress('interaction', 1, now);
      this.recordPetProgress('feed', 1, now);
      return {
        ok: true,
        message: `${food.name}真好吃！`,
        profile: growth.profile,
      };
    })();
  }

  /**
   * 玩耍，对应 desktop_pet attribute_system.play + pet_controller.play：
   * 体力 -4、心情 +8、好奇 +3，经验 +4。
   */
  playWithPet(now = new Date()): PetCareResult {
    return this.connection().transaction(() => {
      const profile = this.getPetProfile();
      if (profile.attributes.energy < 12) {
        return {
          ok: false,
          message: '电量不足，先让我充一小会儿。',
          profile,
        };
      }
      const growth = this.growthEngine.addGrowth(profile, 4, 0);
      growth.profile.attributes.energy = clampAttribute(
        growth.profile.attributes.energy - 4,
      );
      growth.profile.attributes.mood = clampAttribute(
        growth.profile.attributes.mood + 8,
      );
      growth.profile.attributes.curiosity = clampAttribute(
        growth.profile.attributes.curiosity + 3,
      );
      growth.profile.lastAttributeAt = now.toISOString();
      growth.profile.updatedAt = now.toISOString();
      this.savePetProfile(growth.profile);
      this.recordPetProgress('interaction', 1, now);
      return {
        ok: true,
        message: '好耶，这一局算我赢半局！',
        profile: growth.profile,
      };
    })();
  }

  /**
   * 摸摸增益，对应 desktop_pet attribute_system.pet 与每日 12 点心情上限
   * （pet_model.available_click_mood_gain）。
   */
  applyPettingGain(repeatedClicks: number, now = new Date()): PetProfile {
    return this.connection().transaction(() => {
      const profile = this.getPetProfile();
      const gain = Math.max(0.1, 2 / Math.max(1, repeatedClicks));
      const moodGain = Math.min(2, gain);
      const affectionGain = Math.min(0.8, gain * 0.35);
      const dailyKey = 'daily_click_mood';
      const stored = this.readMetadata(dailyKey);
      const today = localDateKey(now);
      let gainedToday = 0;
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as {
            date?: string;
            gained?: number;
          };
          if (parsed.date === today && Number.isFinite(parsed.gained)) {
            gainedToday = Math.max(0, Number(parsed.gained));
          }
        } catch {
          gainedToday = 0;
        }
      }
      const granted = Math.max(
        0,
        Math.min(moodGain, Math.max(0, 12 - gainedToday)),
      );
      this.saveMetadata(
        dailyKey,
        JSON.stringify({ date: today, gained: gainedToday + granted }),
        now,
      );
      profile.attributes.mood = clampAttribute(
        profile.attributes.mood + granted,
      );
      profile.attributes.affection = clampAttribute(
        profile.attributes.affection + affectionGain,
      );
      profile.updatedAt = now.toISOString();
      this.savePetProfile(profile);
      return profile;
    })();
  }

  /** 今日互动次数（状态面板展示），对应 pet_model.interaction_count_today。 */
  interactionCountToday(now = new Date()): number {
    const stored = this.readMetadata('daily_interaction_count');
    if (!stored) {
      return 0;
    }
    try {
      const parsed = JSON.parse(stored) as { date?: string; count?: number };
      if (parsed.date === localDateKey(now) && Number.isFinite(parsed.count)) {
        return Math.max(0, Math.trunc(Number(parsed.count)));
      }
    } catch {
      return 0;
    }
    return 0;
  }

  private bumpInteractionCount(now = new Date()): void {
    const today = localDateKey(now);
    const current = this.interactionCountToday(now);
    this.saveMetadata(
      'daily_interaction_count',
      JSON.stringify({ date: today, count: current + 1 }),
      now,
    );
  }

  advancePetAttributes(
    now = new Date(),
    options: { offline?: boolean; active?: boolean } = {},
  ): PetProfile {
    return this.connection().transaction(() => {
      const profile = this.getPetProfile();
      const last = Date.parse(profile.lastAttributeAt);
      const elapsedSeconds = Number.isFinite(last)
        ? Math.max(0, (now.getTime() - last) / 1000)
        : 0;
      const result = this.growthEngine.advance(profile, elapsedSeconds, {
        offline: options.offline ?? false,
        sleeping: profile.sleeping,
        active: options.active ?? false,
        unattendedSeconds: options.offline ? elapsedSeconds : 0,
      });
      result.profile.lastAttributeAt = now.toISOString();
      result.profile.updatedAt = now.toISOString();
      this.savePetProfile(result.profile);
      return result.profile;
    })();
  }

  setPetSleeping(sleeping: boolean, now = new Date()): PetProfile {
    return this.connection().transaction(() => {
      const profile = this.advancePetAttributes(now);
      profile.sleeping = sleeping;
      profile.updatedAt = now.toISOString();
      this.savePetProfile(profile);
      return profile;
    })();
  }

  listGameRecords(): GameRecord[] {
    const rows = this.connection()
      .prepare<[], GameRecordRow>(`
        SELECT
          game_id,
          high_score,
          play_count,
          best_combo,
          best_grade,
          best_accuracy,
          updated_at
        FROM game_records
        ORDER BY game_id
      `)
      .all();
    return rows
      .filter((row) =>
        GAME_IDS.includes(row.game_id as GameRecord['gameId'])
      )
      .map((row) => ({
        gameId: row.game_id as GameRecord['gameId'],
        highScore: row.high_score,
        playCount: row.play_count,
        bestCombo: row.best_combo,
        bestGrade: normalizeGrade(row.best_grade),
        bestAccuracy: row.best_accuracy,
        updatedAt: row.updated_at,
      }));
  }

  recordGameResult(result: GameResult): {
    record: GameRecord;
    rewards: GameRewards;
  } {
    return this.connection().transaction(() => {
      const now = new Date();
      const timestamp = now.toISOString();
      const existing = this.connection()
        .prepare<[string], GameRecordRow>(`
          SELECT
            game_id,
            high_score,
            play_count,
            best_combo,
            best_grade,
            best_accuracy,
            updated_at
          FROM game_records
          WHERE game_id = ?
        `)
        .get(result.gameId);
      const highScore = Math.max(existing?.high_score ?? 0, result.score);
      const bestGrade =
        !existing || result.score >= existing.high_score
          ? result.grade
          : normalizeGrade(existing.best_grade);
      const record: GameRecord = {
        gameId: result.gameId,
        highScore,
        playCount: (existing?.play_count ?? 0) + 1,
        bestCombo: Math.max(
          existing?.best_combo ?? 0,
          result.maxCombo,
        ),
        bestGrade,
        bestAccuracy: Math.max(
          existing?.best_accuracy ?? 0,
          result.accuracy,
        ),
        updatedAt: timestamp,
      };
      this.connection()
        .prepare(`
          INSERT INTO game_records (
            game_id,
            high_score,
            play_count,
            best_combo,
            best_grade,
            best_accuracy,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(game_id) DO UPDATE SET
            high_score = excluded.high_score,
            play_count = excluded.play_count,
            best_combo = excluded.best_combo,
            best_grade = excluded.best_grade,
            best_accuracy = excluded.best_accuracy,
            updated_at = excluded.updated_at
        `)
        .run(
          record.gameId,
          record.highScore,
          record.playCount,
          record.bestCombo,
          record.bestGrade,
          record.bestAccuracy,
          record.updatedAt,
        );

      const rewards = this.calculateGameRewards(result, now);
      const growth = this.growthEngine.applyGameRewards(
        this.getPetProfile(),
        rewards,
      );
      growth.profile.lastAttributeAt = timestamp;
      growth.profile.updatedAt = timestamp;
      this.savePetProfile(growth.profile);
      this.connection()
        .prepare(`
          INSERT INTO game_results (
            result_id,
            game_id,
            score,
            grade,
            duration_seconds,
            max_combo,
            accuracy,
            finish_reason,
            rewards_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          randomUUID(),
          result.gameId,
          result.score,
          result.grade,
          result.durationSeconds,
          result.maxCombo,
          result.accuracy,
          result.finishReason,
          JSON.stringify(rewards),
          timestamp,
        );
      if (result.finishReason === 'completed') {
        this.recordPetProgress('game', 1, now);
      }
      this.recordPetProgress('game_score', result.score, now);
      return { record, rewards };
    })();
  }

  private readMetadata(key: string): string | null {
    const row = this.connection()
      .prepare<[string], MetadataRow>(`
        SELECT value_json
        FROM app_metadata
        WHERE key = ?
      `)
      .get(key);
    return row?.value_json ?? null;
  }

  private ensurePetProfile(now: Date): void {
    const timestamp = now.toISOString();
    this.connection()
      .prepare(`
        INSERT OR IGNORE INTO pet_profile (
          id,
          name,
          level,
          experience,
          total_experience,
          relationship,
          affection_level,
          hunger,
          energy,
          mood,
          affection,
          cleanliness,
          curiosity,
          unlocked_actions_json,
          titles_json,
          sleeping,
          last_attribute_at,
          updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        DEFAULT_PET_PROFILE.name,
        DEFAULT_PET_PROFILE.level,
        DEFAULT_PET_PROFILE.experience,
        DEFAULT_PET_PROFILE.totalExperience,
        DEFAULT_PET_PROFILE.relationship,
        DEFAULT_PET_PROFILE.affectionLevel,
        DEFAULT_PET_PROFILE.attributes.hunger,
        DEFAULT_PET_PROFILE.attributes.energy,
        DEFAULT_PET_PROFILE.attributes.mood,
        DEFAULT_PET_PROFILE.attributes.affection,
        DEFAULT_PET_PROFILE.attributes.cleanliness,
        DEFAULT_PET_PROFILE.attributes.curiosity,
        JSON.stringify(DEFAULT_PET_PROFILE.unlockedActions),
        JSON.stringify(DEFAULT_PET_PROFILE.titles),
        DEFAULT_PET_PROFILE.sleeping ? 1 : 0,
        timestamp,
        timestamp,
      );
  }

  private ensureDefaultInventory(): void {
    const statement = this.connection().prepare(`
      INSERT OR IGNORE INTO inventory (
        item_id, item_type, display_name, quantity, metadata_json
      ) VALUES (?, ?, ?, ?, ?)
    `);
    statement.run(
      'bread',
      'food',
      '小面包',
      3,
      JSON.stringify({ foodId: 'bread' }),
    );
    statement.run(
      'fries',
      'food',
      '香脆薯条',
      1,
      JSON.stringify({ foodId: 'fries' }),
    );
    statement.run(
      'juice',
      'food',
      '能量果汁',
      1,
      JSON.stringify({ foodId: 'juice' }),
    );
    statement.run(
      'yarn-ball',
      'toy',
      '毛线球',
      1,
      JSON.stringify({ action: 'play' }),
    );
  }

  private ensureDailyTasks(taskDate: string): void {
    const existing = this.connection()
      .prepare<[string], CountRow>(`
        SELECT COUNT(*) AS amount FROM daily_tasks WHERE task_date = ?
      `)
      .get(taskDate)?.amount ?? 0;
    if (existing > 0) {
      return;
    }
    const statement = this.connection().prepare(`
      INSERT INTO daily_tasks (
        task_id,
        task_date,
        title,
        event_type,
        target,
        progress,
        reward_experience,
        reward_relationship,
        challenge,
        claimed
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 0)
    `);
    for (const task of createDailyTasks(taskDate)) {
      statement.run(
        task.taskId,
        task.taskDate,
        task.title,
        task.eventType,
        task.target,
        task.rewardExperience,
        task.rewardRelationship,
        task.challenge ? 1 : 0,
      );
    }
  }

  private listDailyTasks(taskDate: string): DailyTaskRecord[] {
    return this.connection()
      .prepare<[string], DailyTaskRow>(`
        SELECT
          task_id,
          task_date,
          title,
          event_type,
          target,
          progress,
          reward_experience,
          reward_relationship,
          challenge,
          claimed
        FROM daily_tasks
        WHERE task_date = ?
        ORDER BY challenge, task_id
      `)
      .all(taskDate)
      .map((row) => ({
        taskId: row.task_id,
        taskDate: row.task_date,
        title: row.title,
        eventType: PET_PROGRESS_TYPES.includes(
          row.event_type as PetProgressType,
        )
          ? row.event_type as PetProgressType
          : 'interaction',
        target: row.target,
        progress: row.progress,
        rewardExperience: row.reward_experience,
        rewardRelationship: row.reward_relationship,
        challenge: row.challenge === 1,
        claimed: row.claimed === 1,
      }));
  }

  private ensureAchievements(): void {
    const statement = this.connection().prepare(`
      INSERT INTO achievements (
        achievement_id, name, description, unlocked_at
      ) VALUES (?, ?, ?, NULL)
      ON CONFLICT(achievement_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description
    `);
    for (const definition of ACHIEVEMENT_DEFINITIONS) {
      statement.run(
        definition.achievementId,
        definition.name,
        definition.description,
      );
    }
  }

  private listAchievements(): AchievementRecord[] {
    return this.connection()
      .prepare<[], AchievementRow>(`
        SELECT achievement_id, name, description, unlocked_at
        FROM achievements
        ORDER BY achievement_id
      `)
      .all()
      .map((row) => ({
        achievementId: row.achievement_id,
        name: row.name,
        description: row.description,
        unlockedAt: row.unlocked_at,
      }));
  }

  private updateStatistics(eventType: PetProgressType, amount: number): void {
    const key = eventType === 'interaction'
      ? 'total_interactions'
      : eventType === 'feed'
        ? 'feed_count'
        : eventType === 'game'
          ? 'games_played'
          : eventType === 'focus'
            ? 'focus_completed'
            : eventType === 'memory'
              ? 'memory_count'
              : 'best_game_score';
    if (key === 'best_game_score') {
      this.connection()
        .prepare(`
          INSERT INTO pet_statistics(statistic_key, statistic_value)
          VALUES (?, ?)
          ON CONFLICT(statistic_key) DO UPDATE SET
            statistic_value = MAX(statistic_value, excluded.statistic_value)
        `)
        .run(key, amount);
      return;
    }
    this.connection()
      .prepare(`
        INSERT INTO pet_statistics(statistic_key, statistic_value)
        VALUES (?, ?)
        ON CONFLICT(statistic_key) DO UPDATE SET
          statistic_value = statistic_value + excluded.statistic_value
      `)
      .run(key, amount);
  }

  private statistic(key: string): number {
    return this.connection()
      .prepare<[string], StatisticRow>(`
        SELECT statistic_value FROM pet_statistics WHERE statistic_key = ?
      `)
      .get(key)?.statistic_value ?? 0;
  }

  private unlockAchievements(now: Date): AchievementRecord[] {
    const candidates: string[] = [];
    if (this.statistic('total_interactions') >= 1) candidates.push('first_touch');
    if (this.statistic('total_interactions') >= 30) candidates.push('friendly_hand');
    if (this.statistic('feed_count') >= 10) candidates.push('snack_keeper');
    if (this.statistic('consecutive_days') >= 7) candidates.push('week_together');
    if (this.statistic('memory_count') >= 1) candidates.push('first_memory');
    if (this.statistic('focus_completed') >= 1) candidates.push('first_focus');
    if (this.statistic('best_game_score') >= 500) candidates.push('game_500');
    const unlocked: AchievementRecord[] = [];
    for (const achievementId of candidates) {
      const result = this.connection()
        .prepare(`
          UPDATE achievements SET unlocked_at = ?
          WHERE achievement_id = ? AND unlocked_at IS NULL
        `)
        .run(now.toISOString(), achievementId);
      if (result.changes === 1) {
        const row = this.connection()
          .prepare<[string], AchievementRow>(`
            SELECT achievement_id, name, description, unlocked_at
            FROM achievements WHERE achievement_id = ?
          `)
          .get(achievementId);
        if (row) {
          unlocked.push({
            achievementId: row.achievement_id,
            name: row.name,
            description: row.description,
            unlockedAt: row.unlocked_at,
          });
        }
      }
    }
    return unlocked;
  }

  private recordDailyLaunch(now: Date): void {
    const today = localDateKey(now);
    const previous = this.readMetadata(LAST_LAUNCH_DATE_KEY);
    const storedDays = Number(this.readMetadata(CONSECUTIVE_DAYS_KEY) ?? 0);
    let consecutiveDays = Number.isFinite(storedDays)
      ? Math.max(0, Math.trunc(storedDays))
      : 0;
    if (!previous) {
      consecutiveDays = 1;
    } else if (previous !== today) {
      consecutiveDays = isPreviousDate(previous, today)
        ? consecutiveDays + 1
        : 1;
    }
    this.saveMetadata(LAST_LAUNCH_DATE_KEY, today, now);
    this.saveMetadata(CONSECUTIVE_DAYS_KEY, String(consecutiveDays), now);
    this.connection()
      .prepare(`
        INSERT INTO pet_statistics(statistic_key, statistic_value)
        VALUES ('consecutive_days', ?)
        ON CONFLICT(statistic_key) DO UPDATE SET
          statistic_value = excluded.statistic_value
      `)
      .run(consecutiveDays);
  }

  private saveMetadata(key: string, value: string, now = new Date()): void {
    this.connection()
      .prepare(`
        INSERT INTO app_metadata(key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run(key, value, now.toISOString());
  }

  private savePetProfile(profile: PetProfile): void {
    const normalized = normalizePetProfile(profile);
    this.connection()
      .prepare(`
        UPDATE pet_profile SET
          name = ?,
          level = ?,
          experience = ?,
          total_experience = ?,
          relationship = ?,
          affection_level = ?,
          hunger = ?,
          energy = ?,
          mood = ?,
          affection = ?,
          cleanliness = ?,
          curiosity = ?,
          unlocked_actions_json = ?,
          titles_json = ?,
          sleeping = ?,
          last_attribute_at = ?,
          updated_at = ?
        WHERE id = 1
      `)
      .run(
        normalized.name,
        normalized.level,
        normalized.experience,
        normalized.totalExperience,
        normalized.relationship,
        normalized.affectionLevel,
        normalized.attributes.hunger,
        normalized.attributes.energy,
        normalized.attributes.mood,
        normalized.attributes.affection,
        normalized.attributes.cleanliness,
        normalized.attributes.curiosity,
        JSON.stringify(normalized.unlockedActions),
        JSON.stringify(normalized.titles),
        normalized.sleeping ? 1 : 0,
        normalized.lastAttributeAt,
        normalized.updatedAt,
      );
  }

  private connection(): Database.Database {
    if (!this.database) {
      throw new Error('提醒数据库尚未初始化');
    }
    return this.database;
  }

  private calculateGameRewards(
    result: GameResult,
    now: Date,
  ): GameRewards {
    const empty: GameRewards = {
      experience: 0,
      affection: 0,
      hunger: 0,
      mood: 0,
      energy: 0,
    };
    if (result.finishReason !== 'completed') {
      return empty;
    }
    const rewardDate = localDateKey(now);
    const row = this.connection()
      .prepare<[string], DailyRewardRow>(`
        SELECT
          reward_date,
          experience_play_count,
          affection_play_count,
          attribute_gain
        FROM game_daily_rewards
        WHERE reward_date = ?
      `)
      .get(rewardDate) ?? {
        reward_date: rewardDate,
        experience_play_count: 0,
        affection_play_count: 0,
        attribute_gain: 0,
      };
    const rewards = { ...empty };
    if (row.experience_play_count < 3) {
      rewards.experience = Math.min(
        20,
        3 + Math.floor(Math.max(0, result.score) / 300),
      );
      row.experience_play_count += 1;
    }
    if (row.affection_play_count < 5) {
      rewards.affection = Math.min(
        4,
        1 + Math.floor(result.maxCombo / 15),
      );
      row.affection_play_count += 1;
    }
    const availableAttribute = Math.max(0, 30 - row.attribute_gain);
    if (result.gameId === 'catch_food') {
      const hunger = Math.min(
        8,
        2 + Math.floor(result.caughtCount / 8),
      );
      const mood = Math.min(
        10,
        2 + Math.floor(result.score / 500),
      );
      rewards.hunger = Math.min(hunger, availableAttribute);
      rewards.mood = Math.min(
        mood,
        Math.max(0, availableAttribute - rewards.hunger),
      );
      row.attribute_gain += rewards.hunger + rewards.mood;
    } else {
      rewards.energy = -Math.min(
        8,
        3 + Math.floor(result.durationSeconds / 15),
      );
      rewards.mood = Math.min(
        availableAttribute,
        Math.min(8, 2 + Math.floor(result.score / 700)),
      );
      row.attribute_gain += rewards.mood;
    }
    this.connection()
      .prepare(`
        INSERT INTO game_daily_rewards (
          reward_date,
          experience_play_count,
          affection_play_count,
          attribute_gain
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(reward_date) DO UPDATE SET
          experience_play_count = excluded.experience_play_count,
          affection_play_count = excluded.affection_play_count,
          attribute_gain = excluded.attribute_gain
      `)
      .run(
        row.reward_date,
        row.experience_play_count,
        row.affection_play_count,
        row.attribute_gain,
      );
    return rewards;
  }
}

function reminderFromRow(row: ReminderRow): ReminderRecord {
  return {
    reminderId: row.reminder_id,
    reminderType: normalizeReminderType(row.reminder_type),
    title: row.title,
    scheduleType: normalizeScheduleType(row.schedule_type),
    intervalMinutes: row.interval_minutes,
    dailyTimes: normalizeDailyTimes(parseJsonArray(row.daily_times_json)),
    enabled: row.enabled === 1,
    workdaysOnly: row.workdays_only === 1,
    nextDueAt: row.next_due_at,
    snoozedUntil: row.snoozed_until,
    disabledDate: row.disabled_date,
    builtIn: row.built_in === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeReminderType(value: string): ReminderType {
  return REMINDER_TYPES.includes(value as ReminderType)
    ? value as ReminderType
    : 'custom';
}

function normalizeScheduleType(value: string): ReminderScheduleType {
  return value === 'daily' ? 'daily' : 'interval';
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  return parseJsonArray(value)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function inventoryFromRow(row: InventoryRow): InventoryItem {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.metadata_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    metadata = {};
  }
  const itemType = VALID_INVENTORY_TYPES.has(
    row.item_type as InventoryItemType,
  )
    ? row.item_type as InventoryItemType
    : 'legacy';
  return {
    itemId: row.item_id,
    itemType,
    displayName: row.display_name,
    quantity: Math.max(0, row.quantity),
    metadata,
  };
}

function clampAttribute(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function memoryFromRow(row: MemoryRow): MemoryRecord {
  return {
    memoryId: row.memory_id,
    memoryType: MEMORY_TYPES.includes(row.memory_type as MemoryType)
      ? row.memory_type as MemoryType
      : 'USER_NOTE',
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parsePortableProfile(value: unknown): PetProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('档案必须是对象');
  }
  const source = value as Record<string, unknown>;
  const attributes = source.attributes;
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new Error('属性必须是对象');
  }
  const attributeSource = attributes as Record<string, unknown>;
  return normalizePetProfile({
    name: String(source.name ?? '土豆'),
    level: finiteNumber(source.level, 1),
    experience: finiteNumber(source.experience, 0),
    totalExperience: finiteNumber(source.totalExperience, 0),
    relationship: finiteNumber(source.relationship, 0),
    affectionLevel: finiteNumber(source.affectionLevel, 1),
    attributes: {
      hunger: finiteNumber(attributeSource.hunger, 78),
      energy: finiteNumber(attributeSource.energy, 82),
      mood: finiteNumber(attributeSource.mood, 80),
      affection: finiteNumber(attributeSource.affection, 35),
      cleanliness: finiteNumber(attributeSource.cleanliness, 90),
      curiosity: finiteNumber(attributeSource.curiosity, 68),
    },
    unlockedActions: Array.isArray(source.unlockedActions)
      ? source.unlockedActions.map(String)
      : [...DEFAULT_PET_PROFILE.unlockedActions],
    titles: Array.isArray(source.titles)
      ? source.titles.map(String)
      : [...DEFAULT_PET_PROFILE.titles],
    sleeping: Boolean(source.sleeping),
    lastAttributeAt: String(source.lastAttributeAt ?? new Date().toISOString()),
    updatedAt: String(source.updatedAt ?? new Date().toISOString()),
  });
}

function parsePortableInventoryItem(value: unknown): InventoryItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const itemId = String(source.itemId ?? '').trim();
  const itemType = String(source.itemType ?? '');
  const displayName = String(source.displayName ?? '').trim();
  const quantity = Math.trunc(Number(source.quantity));
  const metadata = source.metadata;
  if (
    !/^[a-z][a-z0-9._-]{1,63}$/.test(itemId)
    || !VALID_INVENTORY_TYPES.has(itemType as InventoryItemType)
    || !displayName
    || !Number.isFinite(quantity)
    || quantity < 0
    || !metadata
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
  ) {
    return null;
  }
  return {
    itemId,
    itemType: itemType as InventoryItemType,
    displayName: displayName.slice(0, 80),
    quantity,
    metadata: metadata as Record<string, unknown>,
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validateDatabaseFile(filePath: string): void {
  let database: Database.Database | null = null;
  try {
    database = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = String(
      database.pragma('integrity_check', { simple: true }) ?? '',
    );
    if (integrity !== 'ok') throw new Error('数据库完整性检查失败');
    const required = ['app_metadata', 'pet_profile'];
    const rows = database.prepare<[], { name: string }>(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all();
    const names = new Set(rows.map((row) => row.name));
    if (required.some((name) => !names.has(name))) {
      throw new Error('备份缺少必要的数据表');
    }
  } finally {
    database?.close();
  }
}

function replaceFile(source: string, target: string): void {
  if (!fs.existsSync(target)) {
    fs.renameSync(source, target);
    return;
  }
  const previous = `${target}.previous-${randomUUID()}`;
  fs.renameSync(target, previous);
  try {
    fs.renameSync(source, target);
    fs.rmSync(previous, { force: true });
  } catch (error) {
    if (!fs.existsSync(target) && fs.existsSync(previous)) {
      fs.renameSync(previous, target);
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeConversationPreferences(value: unknown): ConversationPreferences {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ConversationPreferences>
    : {};
  return {
    mode: source.mode === 'mixed' || source.mode === 'ai'
      ? source.mode
      : 'local',
    endpoint: typeof source.endpoint === 'string'
      ? source.endpoint.trim().slice(0, 500)
      : '',
    model: typeof source.model === 'string'
      ? source.model.trim().slice(0, 100)
      : '',
    shareMemoriesWithAi: source.shareMemoriesWithAi === true,
  };
}

function normalizeGrade(value: string): GameResult['grade'] {
  return ['S', 'A', 'B', 'C', 'D'].includes(value)
    ? value as GameResult['grade']
    : 'D';
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isPreviousDate(previous: string, current: string): boolean {
  const previousDate = new Date(`${previous}T12:00:00.000Z`);
  const currentDate = new Date(`${current}T12:00:00.000Z`);
  return Number.isFinite(previousDate.getTime())
    && Number.isFinite(currentDate.getTime())
    && currentDate.getTime() - previousDate.getTime() === 24 * 60 * 60 * 1000;
}
