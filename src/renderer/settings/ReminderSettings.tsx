import { useState } from 'react';
import type {
  PetOperationResult,
  ReminderDashboard,
  ReminderInput,
  ReminderPreferences,
  ReminderRecord,
} from '../../shared/contracts';

interface ReminderSettingsProps {
  dashboard: ReminderDashboard;
  busy: boolean;
  onUpdatePreferences: (
    patch: Partial<ReminderPreferences>,
  ) => void;
  onOperation: (
    operation: () => Promise<PetOperationResult>,
  ) => void;
}

const EMPTY_CUSTOM_REMINDER: ReminderInput = {
  reminderType: 'custom',
  title: '',
  scheduleType: 'interval',
  intervalMinutes: 30,
  dailyTimes: ['09:00'],
  enabled: true,
  workdaysOnly: false,
};

export function ReminderSettings({
  dashboard,
  busy,
  onUpdatePreferences,
  onOperation,
}: ReminderSettingsProps) {
  const preferences = dashboard.preferences;
  const [custom, setCustom] = useState(EMPTY_CUSTOM_REMINDER);

  return (
    <>
      <section className="settings-card reminder-preferences-card">
        <div className="section-heading">
          <div>
            <h2>提醒中心</h2>
            <p>
              支持间隔、每日多时刻、工作日、免打扰和系统通知。
            </p>
          </div>
          <span className="count-badge">{dashboard.reminders.length}</span>
        </div>

        <div className="compact-toggle-grid">
          <CompactToggle
            title="启用提醒"
            checked={preferences.enabled}
            onChange={(enabled) => onUpdatePreferences({ enabled })}
          />
          <CompactToggle
            title="系统通知"
            checked={preferences.notificationsEnabled}
            onChange={(notificationsEnabled) =>
              onUpdatePreferences({ notificationsEnabled })
            }
          />
          <CompactToggle
            title="全部仅工作日"
            checked={preferences.workdaysOnly}
            onChange={(workdaysOnly) =>
              onUpdatePreferences({ workdaysOnly })
            }
          />
        </div>

        <div className="time-grid">
          <label>
            <span>免打扰开始</span>
            <input
              aria-label="免打扰开始"
              type="time"
              value={preferences.quietStart}
              onChange={(event) =>
                onUpdatePreferences({ quietStart: event.target.value })
              }
            />
          </label>
          <label>
            <span>免打扰结束</span>
            <input
              aria-label="免打扰结束"
              type="time"
              value={preferences.quietEnd}
              onChange={(event) =>
                onUpdatePreferences({ quietEnd: event.target.value })
              }
            />
          </label>
          <label>
            <span>默认稍后分钟</span>
            <input
              aria-label="默认稍后提醒分钟"
              type="number"
              min="1"
              max="240"
              value={preferences.defaultSnoozeMinutes}
              onChange={(event) =>
                onUpdatePreferences({
                  defaultSnoozeMinutes: Number(event.target.value),
                })
              }
            />
          </label>
        </div>

        <button
          className="secondary test-reminder-button"
          type="button"
          disabled={busy}
          onClick={() =>
            onOperation(() => window.desktopPet.sendTestReminder())
          }
        >
          发送测试提醒
        </button>

        <p className="next-reminder">
          下次计划：{formatDateTime(dashboard.nextReminderAt)}
        </p>
      </section>

      <section className="settings-card reminder-list-card">
        <div className="section-heading">
          <div>
            <h2>提醒列表</h2>
            <p>内置模板可修改或关闭；只有自定义提醒可以删除。</p>
          </div>
        </div>
        <div className="reminder-list">
          {dashboard.reminders.map((reminder) => (
            <ReminderEditor
              key={`${reminder.reminderId}:${reminder.updatedAt}`}
              reminder={reminder}
              busy={busy}
              snoozeMinutes={preferences.defaultSnoozeMinutes}
              onOperation={onOperation}
            />
          ))}
        </div>
      </section>

      <section className="settings-card custom-reminder-card">
        <h2>新增自定义提醒</h2>
        <ReminderFields
          value={custom}
          onChange={setCustom}
          titlePlaceholder="例如：提交日报"
        />
        <button
          className="secondary"
          type="button"
          disabled={busy || !custom.title.trim()}
          onClick={() => {
            onOperation(() => window.desktopPet.saveReminder(custom));
            setCustom(EMPTY_CUSTOM_REMINDER);
          }}
        >
          添加提醒
        </button>
      </section>

      <section className="settings-card shutdown-card">
        <CompactToggle
          title="退出与关机前检查"
          checked={preferences.shutdownChecklistEnabled}
          onChange={(shutdownChecklistEnabled) =>
            onUpdatePreferences({ shutdownChecklistEnabled })
          }
        />
        <p>
          macOS/Linux 关机与 Windows 会话结束采用尽力拦截；操作系统仍可能强制结束。
        </p>
        <label className="field-label">
          <span>每行一个确认项</span>
          <textarea
            key={preferences.shutdownChecklistItems.join('\n')}
            aria-label="退出前检查清单"
            defaultValue={preferences.shutdownChecklistItems.join('\n')}
            onBlur={(event) => {
              onUpdatePreferences({
                shutdownChecklistItems:
                  event.currentTarget.value.split('\n'),
              });
            }}
          />
        </label>
      </section>
    </>
  );
}

interface ReminderEditorProps {
  reminder: ReminderRecord;
  busy: boolean;
  snoozeMinutes: number;
  onOperation: (
    operation: () => Promise<PetOperationResult>,
  ) => void;
}

function ReminderEditor({
  reminder,
  busy,
  snoozeMinutes,
  onOperation,
}: ReminderEditorProps) {
  const [draft, setDraft] = useState<ReminderInput>(
    reminderToInput(reminder),
  );

  return (
    <details className="reminder-editor">
      <summary>
        <span>{reminder.title}</span>
        <span className={reminder.enabled ? 'enabled-label' : 'muted-label'}>
          {reminder.enabled ? scheduleLabel(reminder) : '已关闭'}
        </span>
      </summary>
      <ReminderFields value={draft} onChange={setDraft} />
      <div className="reminder-actions">
        <button
          className="secondary compact-button"
          type="button"
          disabled={busy}
          onClick={() =>
            onOperation(() => window.desktopPet.saveReminder(draft))
          }
        >
          保存
        </button>
        <button
          className="secondary compact-button"
          type="button"
          disabled={busy}
          onClick={() =>
            onOperation(() =>
              window.desktopPet.snoozeReminder(
                reminder.reminderId,
                snoozeMinutes,
              ),
            )
          }
        >
          稍后 {snoozeMinutes} 分钟
        </button>
        <button
          className="secondary compact-button"
          type="button"
          disabled={busy}
          onClick={() =>
            onOperation(() =>
              window.desktopPet.disableReminderToday(
                reminder.reminderId,
              ),
            )
          }
        >
          今日停用
        </button>
        {!reminder.builtIn ? (
          <button
            className="danger compact-button"
            type="button"
            disabled={busy}
            onClick={() =>
              onOperation(() =>
                window.desktopPet.deleteReminder(reminder.reminderId),
              )
            }
          >
            删除
          </button>
        ) : null}
      </div>
    </details>
  );
}

interface ReminderFieldsProps {
  value: ReminderInput;
  onChange: (value: ReminderInput) => void;
  titlePlaceholder?: string;
}

function ReminderFields({
  value,
  onChange,
  titlePlaceholder,
}: ReminderFieldsProps) {
  return (
    <div className="reminder-fields">
      <label>
        <span>标题</span>
        <input
          aria-label="提醒标题"
          type="text"
          value={value.title}
          placeholder={titlePlaceholder}
          onChange={(event) =>
            onChange({ ...value, title: event.target.value })
          }
        />
      </label>
      <div className="time-grid">
        <label>
          <span>计划类型</span>
          <select
            aria-label="提醒计划类型"
            value={value.scheduleType}
            onChange={(event) =>
              onChange({
                ...value,
                scheduleType:
                  event.target.value === 'daily' ? 'daily' : 'interval',
              })
            }
          >
            <option value="interval">按间隔</option>
            <option value="daily">每日时刻</option>
          </select>
        </label>
        {value.scheduleType === 'interval' ? (
          <label>
            <span>间隔分钟</span>
            <input
              aria-label="提醒间隔分钟"
              type="number"
              min="1"
              max="10080"
              value={value.intervalMinutes}
              onChange={(event) =>
                onChange({
                  ...value,
                  intervalMinutes: Number(event.target.value),
                })
              }
            />
          </label>
        ) : (
          <label className="wide-field">
            <span>每日时刻（逗号分隔）</span>
            <input
              aria-label="每日提醒时刻"
              type="text"
              value={value.dailyTimes.join(', ')}
              placeholder="09:00, 18:00"
              onChange={(event) =>
                onChange({
                  ...value,
                  dailyTimes: event.target.value
                    .split(',')
                    .map((item) => item.trim()),
                })
              }
            />
          </label>
        )}
      </div>
      <div className="compact-toggle-grid">
        <CompactToggle
          title="启用"
          checked={value.enabled}
          onChange={(enabled) => onChange({ ...value, enabled })}
        />
        <CompactToggle
          title="仅工作日"
          checked={value.workdaysOnly}
          onChange={(workdaysOnly) =>
            onChange({ ...value, workdaysOnly })
          }
        />
      </div>
    </div>
  );
}

interface CompactToggleProps {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function CompactToggle({
  title,
  checked,
  onChange,
}: CompactToggleProps) {
  return (
    <label className="compact-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{title}</span>
    </label>
  );
}

function reminderToInput(reminder: ReminderRecord): ReminderInput {
  return {
    reminderId: reminder.reminderId,
    reminderType: reminder.reminderType,
    title: reminder.title,
    scheduleType: reminder.scheduleType,
    intervalMinutes: reminder.intervalMinutes,
    dailyTimes: reminder.dailyTimes,
    enabled: reminder.enabled,
    workdaysOnly: reminder.workdaysOnly,
  };
}

function scheduleLabel(reminder: ReminderRecord): string {
  return reminder.scheduleType === 'daily'
    ? reminder.dailyTimes.join(' / ')
    : `每 ${reminder.intervalMinutes} 分钟`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '暂无';
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '未知';
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
