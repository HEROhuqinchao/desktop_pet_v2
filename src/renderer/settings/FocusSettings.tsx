import { useState } from 'react';
import type {
  FocusState,
  PetOperationResult,
} from '../../shared/contracts';

interface FocusSettingsProps {
  focus: FocusState;
  busy: boolean;
  onOperation: (
    operation: () => Promise<PetOperationResult>,
  ) => void;
}

export function FocusSettings({
  focus,
  busy,
  onOperation,
}: FocusSettingsProps) {
  const [customMinutes, setCustomMinutes] = useState(25);
  const active = focus.status !== 'idle';

  return (
    <section className="settings-card focus-card">
      <div className="section-heading">
        <div>
          <h2>专注计时</h2>
          <p>暂停期间不消耗时长，完成记录保存在本地 SQLite。</p>
        </div>
        <output className="focus-clock">
          {formatSeconds(focus.remainingSeconds)}
        </output>
      </div>

      <div className="focus-status-row">
        <span className={`status-pill ${focus.status}`}>
          {focusStatusLabel(focus.status)}
        </span>
        <span>已完成 {focus.completedCount} 次</span>
      </div>

      <div className="focus-presets">
        {[15, 25, 45, 60].map((minutes) => (
          <button
            className="secondary compact-button"
            type="button"
            key={minutes}
            disabled={busy || active}
            onClick={() =>
              onOperation(() => window.desktopPet.startFocus(minutes))
            }
          >
            {minutes} 分钟
          </button>
        ))}
      </div>

      <div className="inline-control">
        <label>
          <span>自定义分钟</span>
          <input
            aria-label="自定义专注分钟"
            type="number"
            min="1"
            max="180"
            value={customMinutes}
            disabled={busy || active}
            onChange={(event) => {
              setCustomMinutes(Number(event.target.value));
            }}
          />
        </label>
        <button
          className="secondary compact-button"
          type="button"
          disabled={busy || active}
          onClick={() =>
            onOperation(() =>
              window.desktopPet.startFocus(customMinutes),
            )
          }
        >
          开始
        </button>
      </div>

      <div className="focus-actions">
        {focus.status === 'running' ? (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              onOperation(() => window.desktopPet.pauseFocus())
            }
          >
            暂停
          </button>
        ) : null}
        {focus.status === 'paused' ? (
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              onOperation(() => window.desktopPet.resumeFocus())
            }
          >
            继续
          </button>
        ) : null}
        {active ? (
          <button
            className="danger"
            type="button"
            disabled={busy}
            onClick={() =>
              onOperation(() => window.desktopPet.stopFocus())
            }
          >
            停止
          </button>
        ) : null}
      </div>
    </section>
  );
}

function focusStatusLabel(status: FocusState['status']): string {
  if (status === 'running') {
    return '专注中';
  }
  if (status === 'paused') {
    return '已暂停';
  }
  return '未开始';
}

function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${
    String(seconds).padStart(2, '0')
  }`;
}
