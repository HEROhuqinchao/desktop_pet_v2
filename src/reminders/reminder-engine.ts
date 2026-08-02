import type {
  ReminderDashboard,
  ReminderInput,
  ReminderPreferences,
  ReminderRecord,
  ReminderScheduleType,
  ReminderType,
} from '../shared/contracts';

export interface ReminderStorage {
  listReminders(): ReminderRecord[];
  findReminder(reminderId: string): ReminderRecord | null;
  saveReminder(reminder: ReminderRecord): void;
  deleteReminder(reminderId: string): boolean;
  getReminderPreferences(): ReminderPreferences;
  saveReminderPreferences(preferences: ReminderPreferences): void;
}

export const DEFAULT_REMINDER_PREFERENCES:
Readonly<ReminderPreferences> = {
  enabled: true,
  notificationsEnabled: true,
  workdaysOnly: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  defaultSnoozeMinutes: 10,
  shutdownChecklistEnabled: true,
  shutdownChecklistItems: [
    '工作文件是否已经保存',
    '随身物品是否已经收拾',
  ],
};

interface ReminderTemplate {
  reminderId: string;
  reminderType: ReminderType;
  title: string;
  scheduleType: ReminderScheduleType;
  intervalMinutes: number;
  dailyTimes: string[];
  enabled: boolean;
  workdaysOnly: boolean;
}

export const DEFAULT_REMINDERS: ReadonlyArray<ReminderTemplate> = [
  {
    reminderId: 'water',
    reminderType: 'water',
    title: '该喝水啦',
    scheduleType: 'interval',
    intervalMinutes: 45,
    dailyTimes: [],
    enabled: true,
    workdaysOnly: false,
  },
  {
    reminderId: 'sedentary',
    reminderType: 'sedentary',
    title: '起来活动一下吧',
    scheduleType: 'interval',
    intervalMinutes: 60,
    dailyTimes: [],
    enabled: true,
    workdaysOnly: false,
  },
  {
    reminderId: 'rest',
    reminderType: 'rest',
    title: '看看远处，让眼睛休息一下',
    scheduleType: 'interval',
    intervalMinutes: 30,
    dailyTimes: [],
    enabled: true,
    workdaysOnly: false,
  },
  {
    reminderId: 'meal',
    reminderType: 'meal',
    title: '记得按时吃饭',
    scheduleType: 'daily',
    intervalMinutes: 180,
    dailyTimes: ['12:00', '18:30'],
    enabled: true,
    workdaysOnly: false,
  },
  {
    reminderId: 'save-work',
    reminderType: 'save-work',
    title: '记得保存工作文件',
    scheduleType: 'interval',
    intervalMinutes: 30,
    dailyTimes: [],
    enabled: true,
    workdaysOnly: false,
  },
  {
    reminderId: 'tidy-up',
    reminderType: 'tidy-up',
    title: '下班前记得收拾物品',
    scheduleType: 'daily',
    intervalMinutes: 180,
    dailyTimes: ['18:00'],
    enabled: true,
    workdaysOnly: true,
  },
];

export class ReminderEngine {
  constructor(
    private readonly storage: ReminderStorage,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  ensureDefaults(): void {
    const now = this.clock();
    for (const template of DEFAULT_REMINDERS) {
      if (this.storage.findReminder(template.reminderId)) {
        continue;
      }
      const timestamp = now.toISOString();
      this.storage.saveReminder({
        ...template,
        nextDueAt: nextOccurrence(
          now,
          template.scheduleType,
          template.intervalMinutes,
          template.dailyTimes,
          template.workdaysOnly,
        ).toISOString(),
        snoozedUntil: null,
        disabledDate: null,
        builtIn: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  dashboard(): ReminderDashboard {
    const reminders = this.storage.listReminders();
    const nextReminderAt = reminders
      .filter((item) => item.enabled)
      .map((item) => item.snoozedUntil ?? item.nextDueAt)
      .filter(isValidIsoDate)
      .sort()[0] ?? null;
    return {
      reminders,
      preferences: this.storage.getReminderPreferences(),
      nextReminderAt,
    };
  }

  updatePreferences(
    patch: Partial<ReminderPreferences>,
  ): ReminderDashboard {
    const current = this.storage.getReminderPreferences();
    const next = normalizeReminderPreferences({ ...current, ...patch });
    this.storage.saveReminderPreferences(next);
    return this.dashboard();
  }

  save(input: ReminderInput): ReminderRecord {
    const now = this.clock();
    const existing = input.reminderId
      ? this.storage.findReminder(input.reminderId)
      : null;
    const normalized = normalizeReminderInput(input);
    const reminderId = existing?.reminderId
      ?? createReminderId(now, normalized.title);
    const scheduleChanged =
      !existing
      || existing.scheduleType !== normalized.scheduleType
      || existing.intervalMinutes !== normalized.intervalMinutes
      || existing.workdaysOnly !== normalized.workdaysOnly
      || existing.dailyTimes.join(',') !== normalized.dailyTimes.join(',');
    const timestamp = now.toISOString();
    const reminder: ReminderRecord = {
      ...normalized,
      reminderId,
      reminderType: existing?.builtIn
        ? existing.reminderType
        : normalized.reminderType,
      nextDueAt: scheduleChanged
        ? nextOccurrence(
          now,
          normalized.scheduleType,
          normalized.intervalMinutes,
          normalized.dailyTimes,
          normalized.workdaysOnly,
        ).toISOString()
        : existing.nextDueAt,
      snoozedUntil: scheduleChanged ? null : existing?.snoozedUntil ?? null,
      disabledDate: existing?.disabledDate ?? null,
      builtIn: existing?.builtIn ?? false,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.storage.saveReminder(reminder);
    return reminder;
  }

  delete(reminderId: string): boolean {
    const reminder = this.storage.findReminder(reminderId);
    if (!reminder || reminder.builtIn) {
      return false;
    }
    return this.storage.deleteReminder(reminderId);
  }

  due(): ReminderRecord[] {
    const now = this.clock();
    const preferences = this.storage.getReminderPreferences();
    if (
      !preferences.enabled
      || (preferences.workdaysOnly && isWeekend(now))
      || isInQuietHours(now, preferences.quietStart, preferences.quietEnd)
    ) {
      return [];
    }
    const today = localDateKey(now);
    return this.storage.listReminders().filter((reminder) => {
      if (
        !reminder.enabled
        || reminder.disabledDate === today
        || (reminder.workdaysOnly && isWeekend(now))
      ) {
        return false;
      }
      const dueAt = new Date(
        reminder.snoozedUntil ?? reminder.nextDueAt,
      );
      return Number.isFinite(dueAt.getTime()) && dueAt <= now;
    });
  }

  markDelivered(reminderId: string): boolean {
    const reminder = this.storage.findReminder(reminderId);
    if (!reminder) {
      return false;
    }
    const now = this.clock();
    this.storage.saveReminder({
      ...reminder,
      nextDueAt: nextOccurrence(
        now,
        reminder.scheduleType,
        reminder.intervalMinutes,
        reminder.dailyTimes,
        reminder.workdaysOnly,
      ).toISOString(),
      snoozedUntil: null,
      disabledDate: null,
      updatedAt: now.toISOString(),
    });
    return true;
  }

  snooze(reminderId: string, minutes?: number): boolean {
    const reminder = this.storage.findReminder(reminderId);
    if (!reminder) {
      return false;
    }
    const now = this.clock();
    const fallback =
      this.storage.getReminderPreferences().defaultSnoozeMinutes;
    const duration = clampInteger(minutes ?? fallback, 1, 240, fallback);
    this.storage.saveReminder({
      ...reminder,
      snoozedUntil: new Date(
        now.getTime() + duration * 60_000,
      ).toISOString(),
      updatedAt: now.toISOString(),
    });
    return true;
  }

  disableToday(reminderId: string): boolean {
    const reminder = this.storage.findReminder(reminderId);
    if (!reminder) {
      return false;
    }
    const now = this.clock();
    this.storage.saveReminder({
      ...reminder,
      snoozedUntil: null,
      disabledDate: localDateKey(now),
      updatedAt: now.toISOString(),
    });
    return true;
  }
}

export function normalizeReminderPreferences(
  source: Partial<ReminderPreferences>,
): ReminderPreferences {
  return {
    enabled: booleanValue(
      source.enabled,
      DEFAULT_REMINDER_PREFERENCES.enabled,
    ),
    notificationsEnabled: booleanValue(
      source.notificationsEnabled,
      DEFAULT_REMINDER_PREFERENCES.notificationsEnabled,
    ),
    workdaysOnly: booleanValue(
      source.workdaysOnly,
      DEFAULT_REMINDER_PREFERENCES.workdaysOnly,
    ),
    quietStart: normalizeTime(
      source.quietStart,
      DEFAULT_REMINDER_PREFERENCES.quietStart,
    ),
    quietEnd: normalizeTime(
      source.quietEnd,
      DEFAULT_REMINDER_PREFERENCES.quietEnd,
    ),
    defaultSnoozeMinutes: clampInteger(
      source.defaultSnoozeMinutes,
      1,
      240,
      DEFAULT_REMINDER_PREFERENCES.defaultSnoozeMinutes,
    ),
    shutdownChecklistEnabled: booleanValue(
      source.shutdownChecklistEnabled,
      DEFAULT_REMINDER_PREFERENCES.shutdownChecklistEnabled,
    ),
    shutdownChecklistItems: normalizeChecklist(
      source.shutdownChecklistItems,
    ),
  };
}

export function isInQuietHours(
  current: Date,
  start: string,
  end: string,
): boolean {
  const startMinutes = parseTime(start);
  const endMinutes = parseTime(end);
  if (startMinutes === null || endMinutes === null) {
    return false;
  }
  if (startMinutes === endMinutes) {
    return false;
  }
  const currentMinutes = current.getHours() * 60 + current.getMinutes();
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function nextOccurrence(
  now: Date,
  scheduleType: ReminderScheduleType,
  intervalMinutes: number,
  dailyTimes: string[],
  workdaysOnly: boolean,
): Date {
  if (scheduleType === 'interval') {
    return new Date(
      now.getTime()
      + clampInteger(intervalMinutes, 1, 10_080, 30) * 60_000,
    );
  }
  const times = normalizeDailyTimes(dailyTimes);
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    for (const value of times) {
      const minutes = parseTime(value);
      if (minutes === null) {
        continue;
      }
      const candidate = new Date(now);
      candidate.setHours(0, 0, 0, 0);
      candidate.setDate(candidate.getDate() + dayOffset);
      candidate.setMinutes(minutes);
      if (
        candidate > now
        && (!workdaysOnly || !isWeekend(candidate))
      ) {
        return candidate;
      }
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60_000);
}

export function normalizeDailyTimes(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return ['09:00'];
  }
  const normalized = Array.from(
    new Set(
      values
        .filter((item): item is string => typeof item === 'string')
        .map((item) => normalizeTime(item, ''))
        .filter(Boolean),
    ),
  ).sort();
  return normalized.length > 0 ? normalized.slice(0, 12) : ['09:00'];
}

function normalizeReminderInput(input: ReminderInput): Omit<
ReminderRecord,
| 'reminderId'
| 'nextDueAt'
| 'snoozedUntil'
| 'disabledDate'
| 'builtIn'
| 'createdAt'
| 'updatedAt'
> {
  const scheduleType: ReminderScheduleType =
    input.scheduleType === 'daily' ? 'daily' : 'interval';
  return {
    reminderType: input.reminderType === 'custom'
      ? 'custom'
      : input.reminderType,
    title: input.title.trim().slice(0, 80) || '自定义提醒',
    scheduleType,
    intervalMinutes: clampInteger(
      input.intervalMinutes,
      1,
      10_080,
      30,
    ),
    dailyTimes: scheduleType === 'daily'
      ? normalizeDailyTimes(input.dailyTimes)
      : [],
    enabled: Boolean(input.enabled),
    workdaysOnly: Boolean(input.workdaysOnly),
  };
}

function createReminderId(now: Date, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 9);
  return `custom-${now.getTime()}-${slug || suffix}-${suffix}`;
}

function normalizeChecklist(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_REMINDER_PREFERENCES.shutdownChecklistItems];
  }
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 100))
    .filter(Boolean)
    .slice(0, 20);
  return items.length > 0
    ? items
    : [...DEFAULT_REMINDER_PREFERENCES.shutdownChecklistItems];
}

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const minutes = parseTime(value.trim());
  if (minutes === null) {
    return fallback;
  }
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${
    String(minutes % 60).padStart(2, '0')
  }`;
}

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : null;
}

function isWeekend(value: Date): boolean {
  return value.getDay() === 0 || value.getDay() === 6;
}

function localDateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidIsoDate(value: string): boolean {
  return Number.isFinite(new Date(value).getTime());
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(minimum, Math.min(maximum, value)))
    : fallback;
}
