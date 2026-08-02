import { useEffect, useState } from 'react';
import type {
  ConversationSettings,
  DisplayEntry,
  PetSettings,
  ReminderDashboard,
} from '../../shared/contracts';

type TabType = 'basic' | 'reminders' | 'conversation' | 'system';

/**
 * 美化后的设置窗口组件：
 * 支持 4 大 Tab 分页，700px 宽度卡片网格布局，开关 Toggle Switch 化，支持 Light/Dark 模式。
 */
export function SettingsApp() {
  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [reminder, setReminder] = useState<ReminderDashboard | null>(null);
  const [conversation, setConversation] =
    useState<ConversationSettings | null>(null);
  const [displays, setDisplays] = useState<DisplayEntry[]>([]);
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({});
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
    void window.desktopPet.getAppIconDataUrls().then(setIconUrls);
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
    return (
      <main className="settings-shell loading-shell">
        <div className="loading-spinner" />
        <p>正在加载设置选项…</p>
      </main>
    );
  }

  const patchSettings = (patch: Partial<PetSettings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
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

  const runTool = (
    operation: () => Promise<{ ok: boolean; message: string }>,
  ) => {
    setMessage('');
    void operation().then((result) => setMessage(result.message));
  };

  const secretPlaceholder = secretPlaceholderFor(conversation);

  const renderToggle = (
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    hint?: string,
  ) => (
    <label className="toggle-row" key={label}>
      <div className="toggle-info">
        <span className="toggle-label">{label}</span>
        {hint ? <span className="toggle-hint">{hint}</span> : null}
      </div>
      <span className="switch-toggle">
        <input
          aria-label={label}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="switch-slider" />
      </span>
    </label>
  );

  return (
    <main className="settings-shell">
      {/* 顶部 Header 与 Tab 导航 */}
      <header className="settings-header">
        <div className="header-title">
          <h1>Desktop Pet 设置</h1>
          <span className="version-badge">v2.0</span>
        </div>
        <nav className="settings-tabs" aria-label="设置分类">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            ⚙️ 基本设置
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'reminders' ? 'active' : ''}`}
            onClick={() => setActiveTab('reminders')}
          >
            ⏰ 健康提醒
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'conversation' ? 'active' : ''}`}
            onClick={() => setActiveTab('conversation')}
          >
            💬 在线对话
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
          >
            🎮 游戏与系统
          </button>
        </nav>
      </header>

      {/* 主体滚动表单 */}
      <div className="settings-scroll-view" role="region" aria-label="设置表单内容">
        {activeTab === 'basic' && (
          <div className="tab-pane">
            <section className="settings-card">
              <h2 className="card-title">通用行为与视觉</h2>
              <div className="card-grid">
                {renderToggle('开机启动', settings.launchAtStartup, (c) =>
                  patchSettings({ launchAtStartup: c }),
                )}
                {renderToggle('始终置顶', settings.alwaysOnTop, (c) =>
                  patchSettings({ alwaysOnTop: c }),
                )}
                {renderToggle('允许追逐鼠标', settings.chaseCursor, (c) =>
                  patchSettings({ chaseCursor: c }),
                )}
                {renderToggle('允许自动移动', settings.autoMove, (c) =>
                  patchSettings({ autoMove: c }),
                )}
                {renderToggle('允许投掷', settings.allowThrowing, (c) =>
                  patchSettings({ allowThrowing: c }),
                )}
                {renderToggle('桌面特效', settings.desktopEffects, (c) =>
                  patchSettings({ desktopEffects: c }),
                )}
                {renderToggle('允许自动睡眠', settings.autoSleep, (c) =>
                  patchSettings({ autoSleep: c }),
                )}
                {renderToggle('显示对话气泡', settings.bubbleEnabled, (c) =>
                  patchSettings({ bubbleEnabled: c }),
                )}
              </div>
            </section>

            <section className="settings-card">
              <h2 className="card-title">应用图标设置</h2>
              <p className="card-hint">选择您喜欢的应用桌面/Dock图标（默认：方案三）</p>
              <div className="icon-selector-grid">
                {[
                  { id: 'icon3', name: '方案三：Dock猫咪', isDefault: true },
                  { id: 'icon1', name: '方案一：显示器猫' },
                  { id: 'icon2', name: '方案二：窗口招手猫' },
                  { id: 'pet', name: '当前宠物头像' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`icon-option-card ${(settings.appIcon ?? 'icon3') === item.id ? 'selected' : ''}`}
                    onClick={() => patchSettings({ appIcon: item.id as 'icon1' | 'icon2' | 'icon3' | 'pet' })}
                  >
                    <div className="icon-preview-box">
                      <img src={iconUrls[item.id] || `pet-asset://app-icon/${item.id}`} alt={item.name} />
                    </div>
                    <span className="icon-option-name">{item.name}</span>
                    {item.isDefault ? <span className="icon-default-badge">默认</span> : null}
                  </button>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <h2 className="card-title">声音与调整参数</h2>
              <div className="card-form">
                {renderToggle('开启音效', settings.soundEnabled, (c) =>
                  patchSettings({ soundEnabled: c }),
                )}

                <div className="form-item">
                  <div className="form-item-header">
                    <span>音效音量</span>
                    <span className="item-val">{settings.soundVolume}%</span>
                  </div>
                  <input
                    aria-label="音效音量"
                    type="range"
                    min={0}
                    max={100}
                    value={settings.soundVolume}
                    onChange={(e) =>
                      patchSettings({ soundVolume: Number(e.target.value) })
                    }
                  />
                </div>

                <div className="form-item">
                  <div className="form-item-header">
                    <span>活动频率</span>
                    <span className="item-val">{settings.activityFrequency}</span>
                  </div>
                  <input
                    aria-label="活动频率"
                    type="range"
                    min={10}
                    max={100}
                    value={settings.activityFrequency}
                    onChange={(e) =>
                      patchSettings({ activityFrequency: Number(e.target.value) })
                    }
                  />
                </div>

                <div className="form-item">
                  <div className="form-item-header">
                    <span>对话频率</span>
                    <span className="item-val">{settings.dialogueFrequency}</span>
                  </div>
                  <input
                    aria-label="对话频率"
                    type="range"
                    min={10}
                    max={100}
                    value={settings.dialogueFrequency}
                    onChange={(e) =>
                      patchSettings({ dialogueFrequency: Number(e.target.value) })
                    }
                  />
                </div>

                <div className="form-item-row">
                  <label htmlFor="pet-scale-input">宠物大小 (65% ~ 160%)</label>
                  <div className="input-with-unit">
                    <input
                      id="pet-scale-input"
                      type="number"
                      min={65}
                      max={160}
                      step={5}
                      value={Math.round(settings.scale * 100)}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          patchSettings({ scale: clampPercent(val) / 100 });
                        }
                      }}
                    />
                    <span className="unit">%</span>
                  </div>
                </div>

                <div className="form-item-row">
                  <label htmlFor="preferred-screen-select">默认显示器</label>
                  <select
                    id="preferred-screen-select"
                    value={settings.preferredScreen}
                    onChange={(e) =>
                      patchSettings({ preferredScreen: e.target.value })
                    }
                  >
                    <option value="">自动选择</option>
                    {displays.map((display) => (
                      <option key={display.id} value={display.id}>
                        {display.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'reminders' && (
          <div className="tab-pane">
            <section className="settings-card">
              <h2 className="card-title">健康提醒开关</h2>
              <div className="card-grid">
                {renderToggle(
                  '启用健康提醒',
                  reminder.preferences.enabled,
                  (c) => patchReminder({ enabled: c }),
                  '定时提醒喝水、久坐与休息',
                )}
                {renderToggle(
                  '仅工作日提醒',
                  reminder.preferences.workdaysOnly,
                  (c) => patchReminder({ workdaysOnly: c }),
                  '周末自动暂停定时提醒',
                )}
                {renderToggle(
                  '显示状态提醒',
                  settings.showStatusReminders,
                  (c) => patchSettings({ showStatusReminders: c }),
                  '当饱食度或体力较低时提示',
                )}
              </div>
            </section>

            <section className="settings-card">
              <h2 className="card-title">免打扰时段设置</h2>
              <div className="card-form">
                <div className="form-item-row">
                  <label htmlFor="quiet-start-input">免打扰开始时间</label>
                  <input
                    id="quiet-start-input"
                    type="text"
                    placeholder="22:00"
                    value={drafts.quietStart}
                    onChange={(e) =>
                      setDrafts((cur) => ({ ...cur, quietStart: e.target.value }))
                    }
                    onBlur={() => patchReminder({ quietStart: drafts.quietStart })}
                  />
                </div>
                <div className="form-item-row">
                  <label htmlFor="quiet-end-input">免打扰结束时间</label>
                  <input
                    id="quiet-end-input"
                    type="text"
                    placeholder="08:00"
                    value={drafts.quietEnd}
                    onChange={(e) =>
                      setDrafts((cur) => ({ ...cur, quietEnd: e.target.value }))
                    }
                    onBlur={() => patchReminder({ quietEnd: drafts.quietEnd })}
                  />
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'conversation' && (
          <div className="tab-pane">
            <section className="settings-card">
              <h2 className="card-title">对话模式与安全</h2>
              <div className="card-form">
                <div className="form-item-row">
                  <label htmlFor="conv-mode-select">对话模式</label>
                  <select
                    id="conv-mode-select"
                    value={conversation.mode}
                    onChange={(e) =>
                      patchConversation({
                        mode: e.target.value as 'local' | 'mixed' | 'ai',
                      })
                    }
                  >
                    <option value="local">本地离线 (无需网络)</option>
                    <option value="mixed">混合模式 (优先本地，AI辅助)</option>
                    <option value="ai">在线 API 模式</option>
                  </select>
                </div>

                <div className="form-item-row">
                  <label htmlFor="conv-endpoint-input">兼容 API 接口地址</label>
                  <input
                    id="conv-endpoint-input"
                    type="text"
                    placeholder="https://api.openai.com/v1/chat/completions"
                    value={drafts.endpoint}
                    onChange={(e) =>
                      setDrafts((cur) => ({ ...cur, endpoint: e.target.value }))
                    }
                    onBlur={() => patchConversation({ endpoint: drafts.endpoint })}
                  />
                </div>

                <div className="form-item-row">
                  <label htmlFor="conv-model-input">在线模型名称</label>
                  <input
                    id="conv-model-input"
                    type="text"
                    placeholder="gpt-4o-mini / deepseek-chat"
                    value={drafts.model}
                    onChange={(e) =>
                      setDrafts((cur) => ({ ...cur, model: e.target.value }))
                    }
                    onBlur={() => patchConversation({ model: drafts.model })}
                  />
                </div>

                <div className="form-item-row">
                  <label htmlFor="conv-secret-input">API 密钥 (API Key)</label>
                  <div className="secret-input-group">
                    <input
                      id="conv-secret-input"
                      type="password"
                      placeholder={secretPlaceholder}
                      value={drafts.secret}
                      onChange={(e) =>
                        setDrafts((cur) => ({ ...cur, secret: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={drafts.secret.trim().length === 0}
                      onClick={() => {
                        const sec = drafts.secret.trim();
                        setDrafts((cur) => ({ ...cur, secret: '' }));
                        runTool(() => window.desktopPet.setConversationSecret(sec));
                      }}
                    >
                      保存密钥
                    </button>
                  </div>
                </div>

                <div className="card-grid border-top">
                  {renderToggle(
                    '向在线服务共享记忆',
                    conversation.shareMemoriesWithAi,
                    (c) => patchConversation({ shareMemoriesWithAi: c }),
                    '允许 AI 了解宠物的长期记忆',
                  )}
                  {renderToggle(
                    '允许匿名统计',
                    settings.anonymousAnalytics,
                    (c) => patchSettings({ anonymousAnalytics: c }),
                    '帮助改善软件质量',
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'system' && (
          <div className="tab-pane">
            <section className="settings-card">
              <h2 className="card-title">小游戏与性能配置</h2>
              <div className="card-form">
                <div className="form-item-row">
                  <label htmlFor="game-fps-select">小游戏目标帧率</label>
                  <select
                    id="game-fps-select"
                    value={settings.gameTargetFps}
                    onChange={(e) =>
                      patchSettings({ gameTargetFps: Number(e.target.value) })
                    }
                  >
                    {[30, 60, 90, 120].map((fps) => (
                      <option key={fps} value={fps}>
                        {fps} FPS
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-item-row">
                  <label htmlFor="game-effect-select">小游戏特效等级</label>
                  <select
                    id="game-effect-select"
                    value={settings.gameEffectLevel}
                    onChange={(e) =>
                      patchSettings({ gameEffectLevel: Number(e.target.value) })
                    }
                  >
                    <option value={0}>关闭特效</option>
                    <option value={1}>精简特效</option>
                    <option value={2}>完整特效</option>
                  </select>
                </div>

                <div className="card-grid border-top">
                  {renderToggle('小游戏粒子特效', settings.particlesEnabled, (c) =>
                    patchSettings({ particlesEnabled: c }),
                  )}
                  {renderToggle('小游戏阴影特效', settings.shadowsEnabled, (c) =>
                    patchSettings({ shadowsEnabled: c }),
                  )}
                  {renderToggle('小游戏残影特效', settings.trailsEnabled, (c) =>
                    patchSettings({ trailsEnabled: c }),
                  )}
                  {renderToggle('失焦自动暂停', settings.autoPauseGames, (c) =>
                    patchSettings({ autoPauseGames: c }),
                  )}
                  {renderToggle('低性能省电模式', settings.lowPowerMode, (c) =>
                    patchSettings({ lowPowerMode: c }),
                  )}
                  {renderToggle('夜间安静模式', settings.quietNightMode, (c) =>
                    patchSettings({ quietNightMode: c }),
                  )}
                </div>
              </div>
            </section>

            <section className="settings-card">
              <h2 className="card-title">系统路径与数据备份</h2>
              <div className="card-form">
                <div className="form-item-row">
                  <label htmlFor="codex-home-input">Codex 覆盖目录</label>
                  <input
                    id="codex-home-input"
                    type="text"
                    placeholder="留空时默认使用 ~/.codex"
                    value={drafts.codexHome}
                    onChange={(e) =>
                      setDrafts((cur) => ({ ...cur, codexHome: e.target.value }))
                    }
                    onBlur={() =>
                      patchSettings({ codexHomeOverride: drafts.codexHome })
                    }
                  />
                </div>
              </div>
            </section>
          </div>
        )}
      </div>

      {/* 消息提示栏 */}
      {message ? (
        <div className="settings-toast-msg" role="status">
          ℹ️ {message}
        </div>
      ) : (
        <div className="settings-footer-hint">
          💡 设置变更会自动生效并存储于本地磁盘。点击窗口外部任意处即可关闭面板。
        </div>
      )}

      {/* 底部工具操作按钮 */}
      <footer className="settings-action-bar">
        <button
          type="button"
          className="tool-btn"
          onClick={() => void window.desktopPet.openPanel('pet-library')}
        >
          🐾 宠物管理
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={() => void window.desktopPet.resetPosition()}
        >
          📍 重置位置
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={() => runTool(() => window.desktopPet.exportSaveArchive())}
        >
          📤 导出存档
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={() => runTool(() => window.desktopPet.importSaveArchive())}
        >
          📥 导入存档
        </button>
        <button
          type="button"
          className="tool-btn danger"
          onClick={() => runTool(() => window.desktopPet.clearSaveArchive())}
        >
          🗑️ 清除存档
        </button>
        <button
          type="button"
          className="tool-btn close-btn"
          onClick={() => window.close()}
        >
          关闭
        </button>
      </footer>
    </main>
  );
}

function clampPercent(value: number): number {
  return Math.max(65, Math.min(160, Math.round(value / 5) * 5));
}

function secretPlaceholderFor(conversation: ConversationSettings): string {
  if (!conversation.secureStorageAvailable) {
    return '当前系统不支持安全密钥存储';
  }
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('mac')) {
    return '密钥保存于 macOS 钥匙串';
  }
  if (platform.includes('win')) {
    return '密钥保存于 Windows 凭据管理器';
  }
  if (platform.includes('linux')) {
    return '密钥保存于 Linux Secret Service';
  }
  return '密钥保存于系统安全存储';
}
