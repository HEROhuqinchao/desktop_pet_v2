import type {
  GrowthDashboard,
  PetOperationResult,
} from '../../shared/contracts';

interface GrowthSettingsProps {
  dashboard: GrowthDashboard;
  busy: boolean;
  onOperation: (
    operation: () => Promise<PetOperationResult>,
  ) => void;
}

const ATTRIBUTE_LABELS: ReadonlyArray<[
  keyof GrowthDashboard['profile']['attributes'],
  string,
]> = [
  ['hunger', '饱食'],
  ['energy', '体力'],
  ['mood', '心情'],
  ['cleanliness', '清洁'],
  ['curiosity', '好奇'],
];

export function GrowthSettings({
  dashboard,
  busy,
  onOperation,
}: GrowthSettingsProps) {
  const { profile } = dashboard;
  return (
    <section className="settings-card growth-card">
      <div className="section-heading">
        <div>
          <h2>成长与照料</h2>
          <p>等级、关系值和五维属性按真实经过时间持久化。</p>
        </div>
        <span className="count-badge">Lv.{profile.level}</span>
      </div>
      <div className="growth-summary">
        <div>
          <span>经验</span>
          <strong>{profile.experience}</strong>
        </div>
        <div>
          <span>累计经验</span>
          <strong>{profile.totalExperience}</strong>
        </div>
        <div>
          <span>关系值</span>
          <strong>{profile.relationship} / 1000</strong>
        </div>
        <div>
          <span>连续陪伴</span>
          <strong>{dashboard.consecutiveDays} 天</strong>
        </div>
      </div>
      <div className="attribute-list">
        {ATTRIBUTE_LABELS.map(([key, label]) => (
          <div className="attribute-row" key={key}>
            <span>{label}</span>
            <progress value={profile.attributes[key]} max="100" />
            <output>{Math.round(profile.attributes[key])}</output>
          </div>
        ))}
      </div>
      <div className="focus-actions">
        <button
          className="secondary compact-button"
          type="button"
          disabled={busy}
          onClick={() => onOperation(() => window.desktopPet.setPetSleeping(
            !profile.sleeping,
          ))}
        >
          {profile.sleeping ? '唤醒土豆' : '让土豆睡觉'}
        </button>
        <button
          className="secondary compact-button"
          type="button"
          disabled={busy}
          onClick={() => onOperation(() => window.desktopPet.runStoryEvent())}
        >
          触发剧情事件
        </button>
      </div>
      <div className="inventory-list">
        {dashboard.inventory.map((item) => (
          <article className="inventory-item" key={item.itemId}>
            <div>
              <strong>{item.displayName}</strong>
              <span>{item.itemType} · × {item.quantity}</span>
            </div>
            {item.itemType === 'food' ? (
              <button
                className="secondary compact-button"
                type="button"
                disabled={busy || item.quantity <= 0}
                onClick={() => onOperation(() =>
                  window.desktopPet.feedPet(item.itemId)
                )}
              >
                喂食
              </button>
            ) : null}
          </article>
        ))}
      </div>
      <h3 className="subsection-title">今日任务</h3>
      <div className="task-list">
        {dashboard.tasks.map((task) => {
          const ready = task.progress >= task.target;
          return (
            <article className="task-item" key={task.taskId}>
              <div>
                <strong>{task.challenge ? '挑战 · ' : ''}{task.title}</strong>
                <span>
                  {task.progress} / {task.target} · 经验 {task.rewardExperience}
                  {' '}· 关系 {task.rewardRelationship}
                </span>
              </div>
              <button
                className="secondary compact-button"
                type="button"
                disabled={busy || !ready || task.claimed}
                onClick={() => onOperation(() =>
                  window.desktopPet.claimDailyTask(task.taskId)
                )}
              >
                {task.claimed ? '已领取' : '领取'}
              </button>
            </article>
          );
        })}
      </div>
      <h3 className="subsection-title">成就</h3>
      <div className="achievement-grid">
        {dashboard.achievements.map((achievement) => (
          <span
            className={achievement.unlockedAt ? 'unlocked' : ''}
            key={achievement.achievementId}
            title={achievement.description}
          >
            {achievement.name}
          </span>
        ))}
      </div>
    </section>
  );
}
