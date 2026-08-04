import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ContentPackRecord,
  ConversationMessage,
  FocusState,
  GrowthDashboard,
  MemoryRecord,
  PetCatalogEntry,
  PetOperationResult,
  PetStatusSummary,
  ReminderDashboard,
} from '../../shared/contracts';

/**
 * 独立面板页面集合，逐一对应 desktop_pet 的 9 个子窗口
 * （状态面板/背包/成长/专注/对话/记忆/隐私/内容包/宠物管理），
 * 外加改名输入框（对应 QInputDialog）。
 */
export function PanelApp() {
  const page = new URLSearchParams(window.location.search).get('page') ?? '';
  switch (page) {
    case 'status':
      return <StatusPanel />;
    case 'inventory':
      return <InventoryPanel />;
    case 'growth':
      return <GrowthPanel />;
    case 'focus':
      return <FocusPanel />;
    case 'conversation':
      return <ConversationPanel />;
    case 'memory':
      return <MemoryPanel />;
    case 'privacy':
      return <PrivacyPanel />;
    case 'content-packs':
      return <ContentPacksPanel />;
    case 'pet-library':
      return <PetLibraryPanel />;
    case 'prompt':
      return <PromptPanel />;
    default:
      return <main className="panel-shell"><p>未知面板</p></main>;
  }
}

function useAsyncRefresh(
  refresh: () => Promise<void>,
  deps: unknown[] = [],
): void {
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ------------------------------ 状态面板 ------------------------------ */

const STATE_LABELS: Record<string, string> = {
  IDLE: '待机',
  BLINK: '眨眼',
  HAPPY: '开心',
  ANGRY: '生气',
  HUNGRY: '饿了',
  YAWN: '困倦',
  PREPARE_SLEEP: '准备睡觉',
  SLEEP: '睡眠',
  WAKE_UP: '醒来',
  EAT: '进食',
  DRAGGED: '被抱起',
  THROWN: '飞行中',
  FALL: '下落中',
  LAND: '刚落地',
  CHASE_CURSOR: '追逐鼠标',
  DIZZY: '晕乎乎',
};

function StatusPanel() {
  const [summary, setSummary] = useState<PetStatusSummary | null>(null);
  const [operationMessage, setOperationMessage] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const refresh = useCallback(async () => {
    setSummary(await window.desktopPet.getStatusSummary());
  }, []);
  useAsyncRefresh(refresh, []);
  const runOperation = useCallback(async (
    operation: () => Promise<PetOperationResult | boolean>,
  ) => {
    const result = await operation();
    setOperationMessage(
      typeof result === 'boolean'
        ? result ? '互动完成' : '当前无法互动'
        : result.message,
    );
    await refresh();
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }
      context.clearRect(0, 0, 76, 76);
      context.drawImage(image, 0, 0, 192, 208, 4, 0, 68, 74);
    };
    image.src = 'pet-asset://current/spritesheet';
  }, []);

  const attributes = summary?.attributes ?? null;
  const bars: Array<[string, number]> = attributes
    ? [
        ['饱食', attributes.hunger],
        ['体力', attributes.energy],
        ['心情', attributes.mood],
        ['好感', attributes.affection],
      ]
    : [];
  return (
    <main className="panel-shell status-panel">
      <header className="status-header">
        <canvas ref={canvasRef} width={76} height={76} className="status-avatar" />
        <div>
          <h1 className="status-name">
            {summary?.name ?? '…'}
            {summary ? `  Lv.${summary.level}` : ''}
          </h1>
          <p className="status-summary">
            当前状态：
            {summary ? STATE_LABELS[summary.stateLabel] ?? '活动中' : '…'}
            <br />
            今日互动：{summary?.interactionCountToday ?? 0} 次
          </p>
        </div>
      </header>
      <section className="panel-group">
        <h2>今日状态</h2>
        {bars.map(([label, value]) => (
          <div className="bar-row" key={label}>
            <span>{label}</span>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{ width: `${Math.round(value)}%` }}
              />
              <output>{Math.round(value)} / 100</output>
            </div>
          </div>
        ))}
      </section>
      {operationMessage ? (
        <p className="panel-hint" role="status">{operationMessage}</p>
      ) : null}
      <footer className="panel-actions">
        <button
          type="button"
          onClick={() => void runOperation(() =>
            window.desktopPet.feedPet('bread')
          )}
        >
          喂食
        </button>
        <button
          type="button"
          onClick={() => void runOperation(() =>
            summary?.sleeping
              ? window.desktopPet.petWake()
              : window.desktopPet.petSleep()
          )}
        >
          {summary?.sleeping ? '叫醒' : '睡觉'}
        </button>
        <button
          type="button"
          onClick={() => void runOperation(() => window.desktopPet.interact())}
        >
          互动
        </button>
      </footer>
      <footer className="panel-actions right">
        <button type="button" onClick={() => window.close()}>
          知道了
        </button>
      </footer>
    </main>
  );
}

/* ------------------------------ 宠物背包 ------------------------------ */

const ITEM_TYPE_NAMES: Record<string, string> = {
  food: '食物',
  toy: '玩具',
  skin: '皮肤',
  decoration: '装饰',
  legacy: '收藏',
};

function InventoryPanel() {
  const [dashboard, setDashboard] = useState<GrowthDashboard | null>(null);
  const refresh = useCallback(async () => {
    setDashboard(await window.desktopPet.getGrowthDashboard());
  }, []);
  useAsyncRefresh(refresh, []);

  const items = dashboard?.inventory ?? [];
  const total = items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
  const titles = dashboard?.profile.titles ?? [];
  const achievements = dashboard?.achievements ?? [];
  return (
    <main className="panel-shell inventory-panel">
      <h1 className="panel-title">土豆的小背包</h1>
      <p className="panel-hint">
        共 {total} 件物品，{achievements.length} 项成就。
      </p>
      <ul className="inventory-list">
        {items.map((item) => (
          <li
            key={item.itemId}
            data-empty={item.quantity === 0 ? 'true' : 'false'}
          >
            {ITEM_TYPE_NAMES[item.itemType] ?? '物品'} · {item.displayName}
            {'　'}× {Math.max(0, item.quantity)}
          </li>
        ))}
        {titles.length > 0 ? (
          <>
            <li className="inventory-separator">── 已解锁称号 ──</li>
            {titles.map((title) => (
              <li key={title}>称号 · {title}</li>
            ))}
          </>
        ) : null}
      </ul>
      <footer className="panel-actions right">
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
        <button type="button" onClick={() => window.close()}>
          关闭
        </button>
      </footer>
    </main>
  );
}

/* --------------------------- 成长与今日任务 --------------------------- */

function GrowthPanel() {
  const [dashboard, setDashboard] = useState<GrowthDashboard | null>(null);
  const [tab, setTab] = useState<'tasks' | 'achievements'>('tasks');
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    setDashboard(await window.desktopPet.getGrowthDashboard());
  }, []);
  useAsyncRefresh(refresh, []);

  const profile = dashboard?.profile;
  const required = profile
    ? Math.floor(100 * Math.max(1, profile.level) ** 1.35)
    : 0;
  return (
    <main className="panel-shell growth-panel">
      <section className="growth-summary">
        <span>等级：{profile?.level ?? 1}</span>
        <span>
          经验：{profile?.experience ?? 0} / {required}
        </span>
        <span>关系值：{profile?.relationship ?? 0} / 1000</span>
      </section>
      <nav className="panel-tabs">
        <button
          type="button"
          data-active={tab === 'tasks'}
          onClick={() => setTab('tasks')}
        >
          今日任务
        </button>
        <button
          type="button"
          data-active={tab === 'achievements'}
          onClick={() => setTab('achievements')}
        >
          成就
        </button>
      </nav>
      {tab === 'tasks' ? (
        <div className="table-viewport">
          <table className="panel-table">
            <thead>
              <tr>
                <th>任务</th>
                <th>进度</th>
                <th>奖励</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard?.tasks ?? []).map((task) => {
                const ready = task.progress >= task.target;
                return (
                  <tr key={task.taskId}>
                    <td>{task.title}</td>
                    <td>
                      {task.progress} / {task.target}
                    </td>
                    <td>
                      经验 {task.rewardExperience}，关系 {task.rewardRelationship}
                    </td>
                    <td>
                      <button
                        type="button"
                        disabled={!ready || task.claimed}
                        onClick={() => {
                          void window.desktopPet
                            .claimDailyTask(task.taskId)
                            .then((result) => {
                              setMessage(result.message);
                              return refresh();
                            });
                        }}
                      >
                        {task.claimed ? '已领取' : '领取'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-viewport">
          <table className="panel-table">
            <thead>
              <tr>
                <th>成就</th>
                <th>说明</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard?.achievements ?? []).map((achievement) => (
                <tr key={achievement.achievementId}>
                  <td>{achievement.name}</td>
                  <td>{achievement.description}</td>
                  <td>{achievement.unlockedAt ? '已解锁' : '未解锁'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message ? <p className="panel-hint">{message}</p> : null}
    </main>
  );
}

/* --------------------------- 专注与健康提醒 --------------------------- */

function FocusPanel() {
  const [focus, setFocus] = useState<FocusState | null>(null);
  const [reminders, setReminders] = useState<ReminderDashboard | null>(null);
  const [minutes, setMinutes] = useState(25);

  const refresh = useCallback(async () => {
    setFocus(await window.desktopPet.getFocusState());
    setReminders(await window.desktopPet.getReminderDashboard());
  }, []);
  useAsyncRefresh(refresh, []);
  useEffect(() => {
    const off = window.desktopPet.onFocusStateChanged((state) => {
      setFocus(state);
    });
    return off;
  }, []);

  const remaining = focus?.remainingSeconds ?? 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  const stateLabel =
    focus?.status === 'running'
      ? '专注中'
      : focus?.status === 'paused'
        ? '已暂停'
        : '准备开始';
  useEffect(() => {
    document.title = `专注与健康提醒 · ${stateLabel}`;
  }, [stateLabel]);

  return (
    <main className="panel-shell focus-panel">
      <p className="focus-timer">
        {mm}:{ss}
      </p>
      <div className="panel-actions">
        {[15, 25, 45, 60].map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={focus?.status !== 'idle'}
            onClick={() =>
              void window.desktopPet.startFocus(preset).then(() => refresh())
            }
          >
            {preset} 分钟
          </button>
        ))}
      </div>
      <div className="panel-actions">
        <input
          aria-label="自定义专注时长（分钟）"
          type="number"
          min={1}
          max={180}
          value={minutes}
          onChange={(event) =>
            setMinutes(
              Math.max(1, Math.min(180, Number(event.target.value) || 1)),
            )
          }
        />
        <button
          type="button"
          disabled={focus?.status !== 'idle'}
          onClick={() =>
            void window.desktopPet.startFocus(minutes).then(() => refresh())
          }
        >
          开始自定义专注
        </button>
      </div>
      <div className="panel-actions">
        <button
          type="button"
          disabled={focus?.status !== 'running'}
          onClick={() => void window.desktopPet.pauseFocus().then(() => refresh())}
        >
          暂停
        </button>
        <button
          type="button"
          disabled={focus?.status !== 'paused'}
          onClick={() => void window.desktopPet.resumeFocus().then(() => refresh())}
        >
          继续
        </button>
        <button
          type="button"
          disabled={focus?.status === 'idle'}
          onClick={() => void window.desktopPet.stopFocus().then(() => refresh())}
        >
          结束
        </button>
      </div>
      <p className="panel-hint">
        喝水、久坐和休息提醒默认开启，并遵守免打扰时段。
      </p>
      <div className="table-viewport">
        <table className="panel-table">
          <thead>
            <tr>
              <th>提醒</th>
              <th>下次时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {(reminders?.reminders ?? []).map((reminder) => (
              <tr key={reminder.reminderId}>
                <td>{reminder.title}</td>
                <td>
                  {(reminder.snoozedUntil ?? reminder.nextDueAt ?? '')
                    .replace('T', ' ')
                    .slice(0, 16)}
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void window.desktopPet
                        .snoozeReminder(reminder.reminderId, 10)
                        .then(() => refresh())
                    }
                  >
                    稍后 10 分钟
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.desktopPet
                        .disableReminderToday(reminder.reminderId)
                        .then(() => refresh())
                    }
                  >
                    今天不再提醒
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/* ----------------------------- 和宠物聊天 ----------------------------- */

function ConversationPanel() {
  const [petName, setPetName] = useState('土豆');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void window.desktopPet
      .getStatusSummary()
      .then((summary) => setPetName(summary.name));
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) {
      return;
    }
    setInput('');
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setBusy(true);
    void window.desktopPet
      .sendConversation(text)
      .then((response) => {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content:
              response.text
              + (response.fallbackUsed ? ' （本地降级）' : ''),
          },
        ]);
      })
      .catch((error: unknown) => {
        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: `对话失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ]);
      })
      .finally(() => setBusy(false));
  };

  return (
    <main className="panel-shell conversation-panel">
      <p className="panel-hint">默认离线对话。完整聊天仅保留在本次会话中。</p>
      <div className="conversation-log" ref={scrollRef}>
        {messages.map((message, index) => (
          <p key={index} data-role={message.role}>
            <b>{message.role === 'user' ? '你：' : `${petName}：`}</b>
            {message.content}
          </p>
        ))}
      </div>
      <div className="conversation-input">
        <input
          aria-label="聊天输入"
          maxLength={500}
          placeholder="和宠物说点什么……"
          value={input}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              submit();
            }
          }}
        />
        <button type="button" disabled={busy} onClick={submit}>
          {busy ? '思考中…' : '发送'}
        </button>
      </div>
      <button
        type="button"
        className="danger-plain"
        onClick={() => {
          setMessages([]);
          void window.desktopPet.clearConversation();
        }}
      >
        清除当前会话
      </button>
    </main>
  );
}

/* ---------------------------- 长期记忆与隐私 ---------------------------- */

function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setMemories(await window.desktopPet.listMemories());
  }, []);
  useAsyncRefresh(refresh, []);

  const commitEdit = (memoryId: number) => {
    setEditing(null);
    void window.desktopPet
      .updateMemory(memoryId, draft)
      .then((result) => {
        setMessage(result.message);
        return refresh();
      });
  };

  return (
    <main className="panel-shell memory-panel">
      <div className="table-viewport">
        <table className="panel-table selectable">
          <thead>
            <tr>
              <th>类型</th>
              <th>内容</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {memories.map((memory) => (
              <tr
                key={memory.memoryId}
                data-selected={selectedId === memory.memoryId}
                onClick={() => setSelectedId(memory.memoryId)}
                onDoubleClick={() => {
                  setEditing(memory.memoryId);
                  setDraft(memory.content);
                }}
              >
                <td>{memory.memoryType}</td>
                <td>
                  {editing === memory.memoryId ? (
                    <input
                      aria-label="编辑记忆内容"
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onBlur={() => commitEdit(memory.memoryId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitEdit(memory.memoryId);
                        }
                      }}
                    />
                  ) : (
                    memory.content
                  )}
                </td>
                <td>
                  {memory.updatedAt.replace('T', ' ').slice(0, 19)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message ? <p className="panel-hint">{message}</p> : null}
      <footer className="panel-actions">
        <button
          type="button"
          disabled={selectedId === null}
          onClick={() => {
            if (selectedId === null) {
              return;
            }
            void window.desktopPet.deleteMemory(selectedId).then(() => {
              setSelectedId(null);
              return refresh();
            });
          }}
        >
          删除选中
        </button>
        <button
          type="button"
          onClick={() => void window.desktopPet.exportPersonalData()}
        >
          导出个人数据
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="danger"
          onClick={() =>
            void window.desktopPet.clearMemories().then(() => refresh())
          }
        >
          清空全部记忆
        </button>
      </footer>
    </main>
  );
}

/* ------------------------------ 隐私与数据 ------------------------------ */

function PrivacyPanel() {
  const [message, setMessage] = useState('');
  const run = (operation: () => Promise<{ ok: boolean; message: string }>) => {
    void operation().then((result) => setMessage(result.message));
  };
  return (
    <main className="panel-shell privacy-panel">
      <p className="panel-hint">
        默认使用离线对话；长期记忆必须确认；默认不向在线服务共享记忆；
        不记录完整聊天内容；匿名统计默认关闭。
      </p>
      <button
        type="button"
        onClick={() => run(() => window.desktopPet.exportPersonalData())}
      >
        导出个人数据
      </button>
      <button
        type="button"
        onClick={() =>
          run(async () => {
            await window.desktopPet.clearConversation();
            return { ok: true, message: '当前聊天已清除' };
          })
        }
      >
        清除当前聊天
      </button>
      <button
        type="button"
        onClick={() => run(() => window.desktopPet.clearMemories())}
      >
        清空长期记忆
      </button>
      <button
        type="button"
        onClick={() => run(() => window.desktopPet.resetGrowthData())}
      >
        重置成长数据
      </button>
      <button
        type="button"
        className="danger"
        onClick={() => run(() => window.desktopPet.deleteAllPersonalData())}
      >
        删除全部四期数据
      </button>
      {message ? <p className="panel-hint">{message}</p> : null}
    </main>
  );
}

/* ------------------------------ 内容包管理 ------------------------------ */

function ContentPacksPanel() {
  const [packs, setPacks] = useState<ContentPackRecord[]>([]);
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    setPacks(await window.desktopPet.listContentPacks());
  }, []);
  useAsyncRefresh(refresh, []);

  return (
    <main className="panel-shell content-panel">
      <p className="panel-hint">
        内容包只允许 JSON、图片、音频和文本资源，安装前会进行安全校验。
      </p>
      <div className="table-viewport">
        <table className="panel-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>版本</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {packs.map((pack) => (
              <tr key={pack.packId}>
                <td>{pack.name}</td>
                <td>{pack.version}</td>
                <td>{pack.enabled ? '已启用' : '已停用'}</td>
                <td className="row-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void window.desktopPet
                        .setContentPackEnabled(pack.packId, !pack.enabled)
                        .then((result) => {
                          setMessage(result.message);
                          return refresh();
                        })
                    }
                  >
                    {pack.enabled ? '停用' : '启用'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void window.desktopPet
                        .uninstallContentPack(pack.packId)
                        .then((result) => {
                          setMessage(result.message);
                          return refresh();
                        })
                    }
                  >
                    卸载
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message ? <p className="panel-hint">{message}</p> : null}
      <button
        type="button"
        onClick={() =>
          void window.desktopPet.installContentPack().then((result) => {
            setMessage(result.message);
            return refresh();
          })
        }
      >
        安装 ZIP 内容包
      </button>
    </main>
  );
}

/* ------------------------------ 宠物管理 ------------------------------ */

function sourceLabel(entry: PetCatalogEntry): string {
  if (entry.selectionId.startsWith('codex-external:')) {
    return 'Codex 外部目录（未同步）';
  }
  if (entry.source === 'bundled') {
    return '应用内置';
  }
  if (entry.source === 'codex') {
    return '已从 Codex 同步';
  }
  return '本地宠物库';
}

function PetLibraryPanel() {
  const [entries, setEntries] = useState<PetCatalogEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('尚未刷新');
  const refresh = useCallback(async () => {
    const list = await window.desktopPet.listPets();
    setEntries(list);
    setStatus(`已发现 ${list.length} 个可用角色`);
    setSelectedId((current) => {
      if (current && list.some((entry) => entry.selectionId === current)) {
        return current;
      }
      const active = list.find((entry) => entry.active);
      return active?.selectionId ?? list[0]?.selectionId ?? null;
    });
  }, []);
  useAsyncRefresh(refresh, []);

  const selected = entries.find((entry) => entry.selectionId === selectedId);
  const exportDisabled =
    !selected || selected.selectionId.startsWith('codex-external:');
  return (
    <main className="panel-shell library-panel">
      <h1 className="panel-title">Codex 宠物与桌面宠物</h1>
      <p className="panel-hint">
        Codex 宠物目录：~/.codex/pets。外部宠物只有在选择或同步后才复制到本地，
        冲突不会覆盖。
      </p>
      <ul className="library-list">
        {entries.map((entry) => (
          <li
            key={entry.selectionId}
            data-selected={selectedId === entry.selectionId}
            onClick={() => setSelectedId(entry.selectionId)}
            onDoubleClick={() => {
              if (!entry.selectionId.startsWith('codex-external:')) {
                void window.desktopPet
                  .selectPet(entry.selectionId)
                  .then((result) => {
                    setStatus(result.message);
                    return refresh();
                  });
              }
            }}
          >
            <strong>
              {entry.displayName}
              {entry.active ? ' · 当前' : ''}
            </strong>
            <span>
              {sourceLabel(entry)} · Codex v{entry.spriteVersionNumber}
            </span>
            <span>{entry.description}</span>
          </li>
        ))}
      </ul>
      <footer className="panel-actions">
        <button
          type="button"
          disabled={!selected || selected.selectionId.startsWith('codex-external:')}
          onClick={() => {
            if (!selected) {
              return;
            }
            void window.desktopPet
              .selectPet(selected.selectionId)
              .then((result) => {
                setStatus(result.message);
                return refresh();
              });
          }}
        >
          设为当前宠物
        </button>
        <button
          type="button"
          onClick={() =>
            void window.desktopPet.importPetFolder().then((result) => {
              setStatus(result.message);
              return refresh();
            })
          }
        >
          导入文件夹
        </button>
        <button
          type="button"
          onClick={() =>
            void window.desktopPet.syncCodexPets().then((result) => {
              setStatus(result.message);
              return refresh();
            })
          }
        >
          从 Codex 同步
        </button>
        <button
          type="button"
          disabled={exportDisabled}
          onClick={() =>
            void window.desktopPet.exportActivePetToCodex().then((result) => {
              setStatus(result.message);
              return refresh();
            })
          }
        >
          导出到 Codex
        </button>
      </footer>
      <footer className="panel-actions">
        <p className="panel-hint library-status">{status}</p>
        <span className="spacer" />
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
        <button type="button" onClick={() => window.close()}>
          关闭
        </button>
      </footer>
    </main>
  );
}

/* ------------------------------ 改名输入框 ------------------------------ */

function PromptPanel() {
  const params = new URLSearchParams(window.location.search);
  const title = params.get('title') ?? '输入';
  const message = params.get('message') ?? '';
  const initial = params.get('value') ?? '';
  const [value, setValue] = useState(initial);
  return (
    <main className="panel-shell prompt-panel">
      <h1 className="panel-title">{title}</h1>
      {message ? <p className="panel-hint">{message}</p> : null}
      <input
        aria-label={title}
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            window.desktopPet.submitPrompt(value);
          }
        }}
      />
      <footer className="panel-actions right">
        <button
          type="button"
          onClick={() => window.desktopPet.submitPrompt(value)}
        >
          确定
        </button>
        <button type="button" onClick={() => window.desktopPet.cancelPrompt()}>
          取消
        </button>
      </footer>
    </main>
  );
}
