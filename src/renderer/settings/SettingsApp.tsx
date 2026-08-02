import { useEffect, useState } from 'react';
import type {
  ConversationSettings,
  DisplayEntry,
  PetSettings,
  ReminderDashboard,
} from '../../shared/contracts';

/**
 * 设置窗口，结构与 desktop_pet ui/settings_window.py 1:1：
 * 单页滚动表单，复选框 → 滑杆 → 宠物大小 → 帧率/特效/显示器 →
 * 对话模式与文本项 → 密钥行 → 提示 → 工具按钮行 → 关闭。
 * 所有控件即时生效并保存。
 */
export function SettingsApp() {
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [reminder, setReminder] = useState<ReminderDashboard | null>(null);
  const [conversation, setConversation] =
    useState<ConversationSettings | null>(null);
  const [displays, setDisplays] = useState<DisplayEntry[]>([]);
  const [message, setMessage] = useState('');
  const [drafts, setDrafts] = useState({
    endpoint: '',
    model: '',
    quietStart: '22:00',
    quietEnd: '08:00',
    codexHome: '',
    secret: '',
  });

  useEffect(() => {
    void Promise.all([
      window.desktopPet.getSettings(),
      window.desktopPet.getReminderDashboard(),
      window.desktopPet.getConversationSettings(),
      window.desktopPet.listDisplays(),
    ]).then(([nextSettings, nextReminder, nextConversation, nextDisplays]) => {
      setSettings(nextSettings);
      setReminder(nextReminder);
      setConversation(nextConversation);
      setDisplays(nextDisplays);
      setDrafts({
        endpoint: nextConversation.endpoint,
        model: nextConversation.model,
        quietStart: nextReminder.preferences.quietStart,
        quietEnd: nextReminder.preferences.quietEnd,
        codexHome: nextSettings.codexHomeOverride,
        secret: '',
      });
    });
    const offSettings = window.desktopPet.onSettingsChanged(setSettings);
    const offReminder =
      window.desktopPet.onReminderDashboardChanged(setReminder);
    return () => {
      offSettings();
      offReminder();
    };
  }, []);

  if (!settings || !reminder || !conversation) {
    return <main className="settings-shell"><p>正在加载设置…</p></main>;
  }

  const patchSettings = (patch: Partial<PetSettings>) => {
    setSettings((current) =>
      current ? { ...current, ...patch } : current,
    );
    void window.desktopPet.updateSettings(patch).then(setSettings);
  };

  const patchReminder = (patch: {
    enabled?: boolean;
    workdaysOnly?: boolean;
    quietStart?: string;
    quietEnd?: string;
  }) => {
    void window.desktopPet
      .updateReminderPreferences(patch)
      .then(setReminder);
  };

  const patchConversation = (
    patch: Parameters<typeof window.desktopPet.updateConversationSettings>[0],
  ) => {
    void window.desktopPet
      .updateConversationSettings(patch)
      .then(setConversation);
  };

  const runTool = (operation: () => Promise<{ ok: boolean; message: string }>) => {
    setMessage('');
    void operation().then((result) => setMessage(result.message));
  };

  const secretPlaceholder = secretPlaceholderFor(conversation);

  const checkboxRows: Array<{
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }> = [
    {
      label: '开机启动',
      checked: settings.launchAtStartup,
      onChange: (checked) => patchSettings({ launchAtStartup: checked }),
    },
    {
      label: '始终置顶',
      checked: settings.alwaysOnTop,
      onChange: (checked) => patchSettings({ alwaysOnTop: checked }),
    },
    {
      label: '开启音效',
      checked: settings.soundEnabled,
      onChange: (checked) => patchSettings({ soundEnabled: checked }),
    },
    {
      label: '桌面特效',
      checked: settings.desktopEffects,
      onChange: (checked) => patchSettings({ desktopEffects: checked }),
    },
    {
      label: '允许追逐鼠标',
      checked: settings.chaseCursor,
      onChange: (checked) => patchSettings({ chaseCursor: checked }),
    },
    {
      label: '允许自动移动',
      checked: settings.autoMove,
      onChange: (checked) => patchSettings({ autoMove: checked }),
    },
    {
      label: '允许投掷',
      checked: settings.allowThrowing,
      onChange: (checked) => patchSettings({ allowThrowing: checked }),
    },
    {
      label: '显示状态提醒',
      checked: settings.showStatusReminders,
      onChange: (checked) => patchSettings({ showStatusReminders: checked }),
    },
    {
      label: '低性能模式',
      checked: settings.lowPowerMode,
      onChange: (checked) => patchSettings({ lowPowerMode: checked }),
    },
    {
      label: '小游戏粒子',
      checked: settings.particlesEnabled,
      onChange: (checked) => patchSettings({ particlesEnabled: checked }),
    },
    {
      label: '小游戏阴影',
      checked: settings.shadowsEnabled,
      onChange: (checked) => patchSettings({ shadowsEnabled: checked }),
    },
    {
      label: '小游戏残影',
      checked: settings.trailsEnabled,
      onChange: (checked) => patchSettings({ trailsEnabled: checked }),
    },
    {
      label: '小游戏失焦自动暂停',
      checked: settings.autoPauseGames,
      onChange: (checked) => patchSettings({ autoPauseGames: checked }),
    },
    {
      label: '夜间安静模式',
      checked: settings.quietNightMode,
      onChange: (checked) => patchSettings({ quietNightMode: checked }),
    },
    {
      label: '允许自动睡眠',
      checked: settings.autoSleep,
      onChange: (checked) => patchSettings({ autoSleep: checked }),
    },
    {
      label: '显示对话气泡',
      checked: settings.bubbleEnabled,
      onChange: (checked) => patchSettings({ bubbleEnabled: checked }),
    },
    {
      label: '启用健康提醒',
      checked: reminder.preferences.enabled,
      onChange: (checked) => patchReminder({ enabled: checked }),
    },
    {
      label: '仅工作日提醒',
      checked: reminder.preferences.workdaysOnly,
      onChange: (checked) => patchReminder({ workdaysOnly: checked }),
    },
    {
      label: '允许向在线对话共享记忆',
      checked: conversation.shareMemoriesWithAi,
      onChange: (checked) =>
        patchConversation({ shareMemoriesWithAi: checked }),
    },
    {
      label: '允许匿名统计',
      checked: settings.anonymousAnalytics,
      onChange: (checked) => patchSettings({ anonymousAnalytics: checked }),
    },
  ];

  const sliderRows: Array<{
    label: string;
    value: number;
    onChange: (value: number) => void;
  }> = [
    {
      label: '活动频率',
      value: settings.activityFrequency,
      onChange: (value) => patchSettings({ activityFrequency: value }),
    },
    {
      label: '对话频率',
      value: settings.dialogueFrequency,
      onChange: (value) => patchSettings({ dialogueFrequency: value }),
    },
    {
      label: '音效音量',
      value: settings.soundVolume,
      onChange: (value) => patchSettings({ soundVolume: value }),
    },
  ];

  return (
    <main className="settings-shell settings-form-page">
      <div className="settings-scroll" role="region" aria-label="设置表单">
        <div className="settings-form">
          {checkboxRows.map((row) => (
            <label className="form-row" key={row.label}>
              <span>{row.label}</span>
              <input
                aria-label={row.label}
                type="checkbox"
                checked={row.checked}
                onChange={(event) => row.onChange(event.target.checked)}
              />
            </label>
          ))}

          {sliderRows.map((row) => (
            <label className="form-row" key={row.label}>
              <span>{row.label}</span>
              <span className="slider-cell">
                <input
                  aria-label={row.label}
                  type="range"
                  min={0}
                  max={100}
                  value={row.value}
                  onChange={(event) => row.onChange(Number(event.target.value))}
                />
              </span>
            </label>
          ))}

          <label className="form-row">
            <span title="Codex 宠物在 100% 时使用原始 192×208 尺寸">
              宠物大小
            </span>
            <span className="slider-cell">
              <input
                aria-label="宠物大小"
                type="number"
                min={65}
                max={160}
                step={5}
                value={Math.round(settings.scale * 100)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) {
                    patchSettings({ scale: clampPercent(value) / 100 });
                  }
                }}
              />
              <output>%</output>
            </span>
          </label>

          <label className="form-row">
            <span>小游戏目标帧率</span>
            <select
              aria-label="小游戏目标帧率"
              value={settings.gameTargetFps}
              onChange={(event) =>
                patchSettings({ gameTargetFps: Number(event.target.value) })
              }
            >
              {[30, 60, 90, 120].map((fps) => (
                <option key={fps} value={fps}>
                  {fps} FPS
                </option>
              ))}
            </select>
          </label>

          <label className="form-row">
            <span>小游戏特效等级</span>
            <select
              aria-label="小游戏特效等级"
              value={settings.gameEffectLevel}
              onChange={(event) =>
                patchSettings({ gameEffectLevel: Number(event.target.value) })
              }
            >
              <option value={0}>关闭</option>
              <option value={1}>精简</option>
              <option value={2}>完整</option>
            </select>
          </label>

          <label className="form-row">
            <span>默认显示器</span>
            <select
              aria-label="默认显示器"
              value={settings.preferredScreen}
              onChange={(event) =>
                patchSettings({ preferredScreen: event.target.value })
              }
            >
              <option value="">自动选择</option>
              {displays.map((display) => (
                <option key={display.id} value={display.id}>
                  {display.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-row">
            <span>对话模式</span>
            <select
              aria-label="对话模式"
              value={conversation.mode}
              onChange={(event) =>
                patchConversation({
                  mode: event.target.value as 'local' | 'mixed' | 'ai',
                })
              }
            >
              <option value="local">本地离线</option>
              <option value="mixed">混合模式</option>
              <option value="ai">在线模式</option>
            </select>
          </label>

          <label className="form-row">
            <span>兼容接口地址</span>
            <input
              aria-label="兼容接口地址"
              type="text"
              placeholder="https://example.com/v1/chat/completions"
              value={drafts.endpoint}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  endpoint: event.target.value,
                }))
              }
              onBlur={() => patchConversation({ endpoint: drafts.endpoint })}
            />
          </label>

          <label className="form-row">
            <span>在线模型名称</span>
            <input
              aria-label="在线模型名称"
              type="text"
              placeholder="由接口服务商提供"
              value={drafts.model}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, model: event.target.value }))
              }
              onBlur={() => patchConversation({ model: drafts.model })}
            />
          </label>

          <label className="form-row">
            <span>免打扰开始</span>
            <input
              aria-label="免打扰开始"
              type="text"
              placeholder="22:00"
              value={drafts.quietStart}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  quietStart: event.target.value,
                }))
              }
              onBlur={() => patchReminder({ quietStart: drafts.quietStart })}
            />
          </label>

          <label className="form-row">
            <span>免打扰结束</span>
            <input
              aria-label="免打扰结束"
              type="text"
              placeholder="08:00"
              value={drafts.quietEnd}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  quietEnd: event.target.value,
                }))
              }
              onBlur={() => patchReminder({ quietEnd: drafts.quietEnd })}
            />
          </label>

          <label className="form-row">
            <span>Codex 目录</span>
            <input
              aria-label="Codex 目录"
              type="text"
              placeholder="留空时使用 CODEX_HOME 或 ~/.codex"
              value={drafts.codexHome}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  codexHome: event.target.value,
                }))
              }
              onBlur={() =>
                patchSettings({ codexHomeOverride: drafts.codexHome })
              }
            />
          </label>

          <div className="form-row">
            <span>在线接口密钥</span>
            <span className="secret-cell">
              <input
                aria-label="在线接口密钥"
                type="password"
                placeholder={secretPlaceholder}
                value={drafts.secret}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    secret: event.target.value,
                  }))
                }
              />
              <button
                type="button"
                disabled={drafts.secret.trim().length === 0}
                onClick={() => {
                  const secret = drafts.secret.trim();
                  setDrafts((current) => ({ ...current, secret: '' }));
                  runTool(() => window.desktopPet.setConversationSecret(secret));
                }}
              >
                保存密钥
              </button>
            </span>
          </div>

        </div>
      </div>

      <p className="settings-hint">
        设置会立即生效并保存。存档保存在当前用户的本地数据目录。
      </p>

      <div className="settings-tools">
        <button
          type="button"
          onClick={() => void window.desktopPet.openPanel('pet-library')}
        >
          宠物管理
        </button>
        <button
          type="button"
          onClick={() => void window.desktopPet.resetPosition()}
        >
          重置位置
        </button>
        <button
          type="button"
          onClick={() =>
            runTool(() => window.desktopPet.exportSaveArchive())
          }
        >
          导出存档
        </button>
        <button
          type="button"
          onClick={() =>
            runTool(() => window.desktopPet.importSaveArchive())
          }
        >
          导入存档
        </button>
        <button
          type="button"
          onClick={() => runTool(() => window.desktopPet.clearSaveArchive())}
        >
          清除存档
        </button>
      </div>

      {message ? (
        <p className="settings-message" role="status">
          {message}
        </p>
      ) : null}

      <div className="settings-close">
        <button type="button" onClick={() => window.close()}>
          关闭
        </button>
      </div>
    </main>
  );
}

function clampPercent(value: number): number {
  return Math.max(65, Math.min(160, Math.round(value / 5) * 5));
}

function secretPlaceholderFor(
  conversation: ConversationSettings,
): string {
  if (!conversation.secureStorageAvailable) {
    return '当前系统不支持安全密钥存储';
  }
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) {
    return '密钥仅保存到 macOS 钥匙串';
  }
  if (platform.includes('win')) {
    return '密钥仅保存到 Windows 凭据管理器';
  }
  if (platform.includes('linux')) {
    return '密钥仅保存到 Linux Secret Service';
  }
  return '密钥仅保存到系统安全存储';
}
