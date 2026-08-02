import { useState } from 'react';
import type {
  ContentPackRecord,
  ConversationMessage,
  ConversationPreferences,
  ConversationSettings,
  MemoryCandidate,
  MemoryRecord,
  PetOperationResult,
} from '../../shared/contracts';

interface CompanionSettingsProps {
  packs: ContentPackRecord[];
  conversation: ConversationSettings;
  memories: MemoryRecord[];
  busy: boolean;
  onOperation: (
    operation: () => Promise<PetOperationResult>,
  ) => void;
  onUpdateConversation: (patch: Partial<ConversationPreferences>) => void;
}

export function CompanionSettings({
  packs,
  conversation,
  memories,
  busy,
  onOperation,
  onUpdateConversation,
}: CompanionSettingsProps) {
  const [draft, setDraft] = useState('');
  const [secret, setSecret] = useState('');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [pending, setPending] = useState<MemoryCandidate | null>(null);
  const [sending, setSending] = useState(false);

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    setMessages((current) => [...current, { role: 'user', content: text }]);
    setSending(true);
    void window.desktopPet.sendConversation(text)
      .then(async (response) => {
        setMessages((current) => [
          ...current,
          { role: 'assistant', content: response.text },
        ]);
        const authoritativeCandidate =
          await window.desktopPet.getPendingMemory();
        setPending(authoritativeCandidate ?? response.memoryCandidate);
      })
      .finally(() => setSending(false));
  };

  return (
    <>
      <section className="settings-card conversation-card">
        <div className="section-heading">
          <div>
            <h2>和土豆聊天</h2>
            <p>默认离线；完整聊天仅保留在本次运行中。</p>
          </div>
          <span className="count-badge">{conversation.mode}</span>
        </div>
        <div className="conversation-log" aria-live="polite">
          {messages.length === 0 ? (
            <p>可以问候土豆、说“专注 25 分钟”，或明确说“请记住……”。</p>
          ) : messages.map((message, index) => (
            <p className={message.role} key={`${message.role}-${index}`}>
              <strong>{message.role === 'user' ? '你' : '土豆'}：</strong>
              {message.content}
            </p>
          ))}
        </div>
        <div className="conversation-input">
          <input
            aria-label="对话内容"
            type="text"
            maxLength={500}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') send();
            }}
          />
          <button
            className="secondary compact-button"
            type="button"
            disabled={sending || !draft.trim()}
            onClick={send}
          >
            {sending ? '回复中' : '发送'}
          </button>
        </div>
        {pending ? (
          <div className="memory-confirmation">
            <p>是否保存长期记忆：{pending.content}</p>
            <div className="focus-actions">
              <button
                className="secondary compact-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  onOperation(() => window.desktopPet.confirmMemory());
                  setPending(null);
                }}
              >
                确认保存
              </button>
              <button
                className="secondary compact-button"
                type="button"
                onClick={() => {
                  void window.desktopPet.rejectMemory();
                  setPending(null);
                }}
              >
                不保存
              </button>
            </div>
          </div>
        ) : null}
        <button
          className="secondary compact-button clear-chat-button"
          type="button"
          onClick={() => {
            void window.desktopPet.clearConversation();
            setMessages([]);
          }}
        >
          清除当前会话
        </button>
      </section>

      <section className="settings-card conversation-provider-card">
        <div className="section-heading">
          <div>
            <h2>在线对话提供方</h2>
            <p>可选 OpenAI 兼容接口；不可用时自动回退离线回复。</p>
          </div>
        </div>
        <label className="field-label">
          <span>模式</span>
          <select
            value={conversation.mode}
            onChange={(event) => onUpdateConversation({
              mode: event.target.value as ConversationPreferences['mode'],
            })}
          >
            <option value="local">仅本地</option>
            <option value="mixed">优先在线，失败降级</option>
            <option value="ai">在线模式，失败降级</option>
          </select>
        </label>
        <label className="field-label">
          <span>HTTPS Endpoint</span>
          <input
            type="text"
            value={conversation.endpoint}
            placeholder="https://example.com/v1/chat/completions"
            onChange={(event) => onUpdateConversation({ endpoint: event.target.value })}
          />
        </label>
        <label className="field-label">
          <span>模型</span>
          <input
            type="text"
            value={conversation.model}
            onChange={(event) => onUpdateConversation({ model: event.target.value })}
          />
        </label>
        <label className="compact-toggle provider-memory-toggle">
          <input
            type="checkbox"
            checked={conversation.shareMemoriesWithAi}
            onChange={(event) => onUpdateConversation({
              shareMemoriesWithAi: event.target.checked,
            })}
          />
          明确允许向在线提供方发送最多 10 条长期记忆
        </label>
        <div className="conversation-input">
          <input
            aria-label="在线对话密钥"
            type="password"
            value={secret}
            placeholder={conversation.hasSecret ? '已安全保存' : 'API Key'}
            disabled={!conversation.secureStorageAvailable}
            onChange={(event) => setSecret(event.target.value)}
          />
          <button
            className="secondary compact-button"
            type="button"
            disabled={busy || !secret.trim() || !conversation.secureStorageAvailable}
            onClick={() => {
              onOperation(() => window.desktopPet.setConversationSecret(secret));
              setSecret('');
            }}
          >
            保存密钥
          </button>
        </div>
        {!conversation.secureStorageAvailable ? (
          <p>系统加密存储不可用，已禁止保存在线密钥。</p>
        ) : null}
        {conversation.hasSecret ? (
          <button
            className="secondary compact-button clear-chat-button"
            type="button"
            disabled={busy}
            onClick={() => onOperation(() =>
              window.desktopPet.deleteConversationSecret()
            )}
          >
            删除已保存密钥
          </button>
        ) : null}
      </section>

      <section className="settings-card memory-card">
        <div className="section-heading">
          <div>
            <h2>长期记忆</h2>
            <p>仅保存明确确认且通过敏感信息检查的内容。</p>
          </div>
          <span className="count-badge">{memories.length}</span>
        </div>
        <div className="memory-list">
          {memories.map((memory) => (
            <article key={memory.memoryId}>
              <div>
                <strong>{memory.memoryType}</strong>
                <span>{memory.content}</span>
              </div>
              <button
                className="secondary compact-button"
                type="button"
                disabled={busy}
                onClick={() => onOperation(() =>
                  window.desktopPet.deleteMemory(memory.memoryId)
                )}
              >
                删除
              </button>
            </article>
          ))}
        </div>
        {memories.length > 0 ? (
          <button
            className="secondary compact-button clear-chat-button"
            type="button"
            disabled={busy}
            onClick={() => onOperation(() => window.desktopPet.clearMemories())}
          >
            清空全部长期记忆
          </button>
        ) : null}
      </section>

      <section className="settings-card content-pack-card">
        <div className="section-heading">
          <div>
            <h2>内容包</h2>
            <p>仅安装经过路径、类型、体积和 JSON 校验的 ZIP 资源包。</p>
          </div>
          <span className="count-badge">{packs.length}</span>
        </div>
        <div className="pack-list">
          {packs.map((pack) => (
            <article key={pack.packId}>
              <div>
                <strong>{pack.name} · {pack.version}</strong>
                <span>{pack.description || pack.packId}</span>
              </div>
              <div className="pack-actions">
                <button
                  className="secondary compact-button"
                  type="button"
                  disabled={busy}
                  onClick={() => onOperation(() =>
                    window.desktopPet.setContentPackEnabled(
                      pack.packId,
                      !pack.enabled,
                    )
                  )}
                >
                  {pack.enabled ? '停用' : '启用'}
                </button>
                <button
                  className="secondary compact-button"
                  type="button"
                  disabled={busy}
                  onClick={() => onOperation(() =>
                    window.desktopPet.uninstallContentPack(pack.packId)
                  )}
                >
                  卸载
                </button>
              </div>
            </article>
          ))}
        </div>
        <button
          className="secondary clear-chat-button"
          type="button"
          disabled={busy}
          onClick={() => onOperation(() => window.desktopPet.installContentPack())}
        >
          安装 ZIP 内容包
        </button>
      </section>

      <section className="settings-card data-card">
        <div className="section-heading">
          <div>
            <h2>数据迁移与备份</h2>
            <p>JSON 用于可读迁移，SQLite 备份用于完整恢复。</p>
          </div>
        </div>
        <div className="data-actions">
          <button className="secondary" type="button" disabled={busy}
            onClick={() => onOperation(() => window.desktopPet.exportPersonalData())}>
            导出 JSON
          </button>
          <button className="secondary" type="button" disabled={busy}
            onClick={() => onOperation(() => window.desktopPet.importPersonalData())}>
            导入 JSON
          </button>
          <button className="secondary" type="button" disabled={busy}
            onClick={() => onOperation(() => window.desktopPet.backupDatabase())}>
            备份数据库
          </button>
          <button className="secondary" type="button" disabled={busy}
            onClick={() => onOperation(() => window.desktopPet.restoreDatabase())}>
            恢复数据库
          </button>
        </div>
      </section>
    </>
  );
}
