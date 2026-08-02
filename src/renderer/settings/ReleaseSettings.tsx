import type { UpdateStatus } from '../../shared/contracts';

interface ReleaseSettingsProps {
  manifestUrl: string;
  status: UpdateStatus;
  busy: boolean;
  onManifestUrlChange: (value: string) => void;
  onManifestUrlCommit: (value: string) => void;
  onCheck: () => void;
  onOpenDownload: () => void;
}

export function ReleaseSettings({
  manifestUrl,
  status,
  busy,
  onManifestUrlChange,
  onManifestUrlCommit,
  onCheck,
  onOpenDownload,
}: ReleaseSettingsProps) {
  return (
    <section className="settings-card release-card">
      <div className="section-heading">
        <div>
          <h2>软件更新</h2>
          <p>读取受校验的 HTTPS 更新清单，不会静默下载或安装。</p>
        </div>
        <span className={`update-state ${status.state}`}>{status.state}</span>
      </div>
      <label className="field-label">
        <span>更新清单 URL</span>
        <input
          aria-label="更新清单 URL"
          type="url"
          value={manifestUrl}
          placeholder="https://example.com/release-manifest.json"
          onChange={(event) => onManifestUrlChange(event.target.value)}
          onBlur={(event) => onManifestUrlCommit(event.target.value)}
        />
      </label>
      <p className="update-message" role="status">{status.message}</p>
      <div className="library-actions">
        <button
          className="secondary"
          type="button"
          disabled={busy || status.state === 'checking'}
          onClick={onCheck}
        >
          检查更新
        </button>
        <button
          type="button"
          disabled={busy || status.state !== 'available'}
          onClick={onOpenDownload}
        >
          打开下载页
        </button>
      </div>
      <p className="update-version">
        当前 v{status.currentVersion}
        {status.latestVersion ? ` · 最新 v${status.latestVersion}` : ''}
      </p>
    </section>
  );
}
