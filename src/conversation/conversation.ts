import type {
  ConversationMessage,
  ConversationMode,
  ConversationRequest,
  ConversationResponse,
  MemoryCandidate,
} from '../shared/contracts';

export interface ConversationProvider {
  name: string;
  complete(
    request: ConversationRequest,
  ): ConversationResponse | Promise<ConversationResponse>;
}

export class LocalConversationProvider implements ConversationProvider {
  readonly name = 'local';

  constructor(
    private readonly petName = '土豆',
    private readonly random: () => number = Math.random,
    private readonly extraReplies: () => string[] = () => [],
  ) {}

  complete(request: ConversationRequest): ConversationResponse {
    const text = request.messages.at(-1)?.content.trim() ?? '';
    const routed = routeInput(text);
    let reply: string;
    if (routed.commandName === 'start_focus') {
      const minutes = Number(routed.commandArguments.minutes);
      reply = `好呀，我陪你专注 ${minutes} 分钟。完成后记得休息一下。`;
    } else if (routed.commandName === 'show_reminders') {
      reply = '喝水提醒可以在提醒面板里设置，我帮你打开。';
    } else if (routed.commandName === 'show_inventory') {
      reply = '背包里收藏着我们一起获得的东西，我帮你打开看看。';
    } else if (routed.commandName === 'show_growth') {
      reply = '一起看看今天的任务和成长进度吧。';
    } else if (routed.memoryCandidate) {
      reply = '这条信息需要你确认后我才会记住。';
    } else {
      reply = this.replyFor(text);
    }
    return {
      text: reply.slice(0, 120),
      ...routed,
      providerName: this.name,
      fallbackUsed: false,
    };
  }

  private replyFor(text: string): string {
    if (!text) return '我在这里，想聊什么都可以。';
    if (containsAny(text, ['你好', '嗨', '早上好', '晚上好'])) {
      return choose(
        ['你好呀，今天也一起好好生活。', '我在呢，见到你真开心。'],
        this.random,
      );
    }
    if (containsAny(text, ['累', '困', '压力', '难过'])) {
      return '辛苦啦。先慢慢呼吸，喝口水，我们把下一件事变小一点。';
    }
    if (containsAny(text, ['开心', '完成', '成功', '太好了'])) {
      return '真棒，我也替你开心。这个小小的胜利值得好好收藏。';
    }
    const extra = this.extraReplies()
      .map((item) => item.trim())
      .filter((item) => item.length >= 1 && item.length <= 120);
    if (extra.length > 0 && (text.includes('内容包') || this.random() < 0.25)) {
      return choose(extra, this.random);
    }
    if (text.includes('?') || text.includes('？')) {
      return '这个问题很有意思。本地模式下我知道得有限，但很愿意陪你一起理清思路。';
    }
    return choose(
      [
        `我听见啦。今天也会安安静静陪着你。`,
        `嗯嗯，我记得这段对话，不过关闭窗口后不会保存完整聊天记录。`,
        `谢谢你告诉${this.petName}。要不要也给自己一点休息时间？`,
      ],
      this.random,
    );
  }
}

export class ConversationController {
  private readonly history: ConversationMessage[] = [];
  systemPrompt = '';

  constructor(
    private readonly localProvider: ConversationProvider,
    private readonly remoteProvider?: ConversationProvider,
    private readonly mode: ConversationMode = 'local',
    private readonly maxMessages = 16,
    private readonly maxCharacters = 3_000,
  ) {}

  async send(text: string): Promise<ConversationResponse> {
    const normalized = text.trim().replaceAll(/\s+/g, ' ').slice(0, 500);
    if (!normalized) {
      return response('想说点什么呢？');
    }
    this.append({ role: 'user', content: normalized });
    const request: ConversationRequest = {
      messages: this.history.map((item) => ({ ...item })),
      systemPrompt: this.systemPrompt,
      timeoutSeconds: 12,
    };
    const local = await this.localProvider.complete(request);
    let selected = local;
    if (!local.commandName && !local.memoryCandidate && this.mode !== 'local') {
      if (this.remoteProvider) {
        try {
          const remote = await this.remoteProvider.complete(request);
          if (remote.text.trim()) selected = remote;
        } catch {
          selected = { ...local, fallbackUsed: true };
        }
      } else {
        selected = { ...local, fallbackUsed: true };
      }
    }
    const finalResponse = {
      ...selected,
      text: selected.text.trim().replaceAll(/\s+/g, ' ').slice(0, 120)
        || '我刚才走神了一下，请再说一次吧。',
    };
    this.append({ role: 'assistant', content: finalResponse.text });
    return finalResponse;
  }

  clearHistory(): void {
    this.history.splice(0);
  }

  private append(message: ConversationMessage): void {
    this.history.push(message);
    while (this.history.length > Math.max(2, this.maxMessages)) {
      this.history.shift();
    }
    while (
      this.history.reduce((total, item) => total + item.content.length, 0)
        > Math.max(200, this.maxCharacters)
      && this.history.length > 2
    ) {
      this.history.shift();
    }
  }
}

export class OpenAICompatibleProvider implements ConversationProvider {
  readonly name = 'openai-compatible';

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly secretGetter: () => string | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async complete(request: ConversationRequest): Promise<ConversationResponse> {
    const endpoint = validateEndpoint(this.endpoint);
    const model = this.model.trim().slice(0, 100);
    const secret = this.secretGetter();
    if (!model) throw new Error('在线对话模型尚未配置');
    if (!secret) throw new Error('在线对话密钥尚未配置');
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(1, request.timeoutSeconds) * 1000,
    );
    try {
      const messages = request.systemPrompt
        ? [{ role: 'system', content: request.systemPrompt }, ...request.messages]
        : request.messages;
      const result = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ model, messages, stream: false }),
        signal: controller.signal,
      });
      if (!result.ok) throw new Error(`在线对话请求失败：HTTP ${result.status}`);
      const payload = await result.json() as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const text = payload.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('在线对话返回格式无效');
      }
      return {
        ...response(text, this.name),
        providerName: this.name,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * 构建系统提示词，对应 desktop_pet conversation/prompt_builder.py：
 * 语气来自 data/personalities.json 的人格配置。
 */
export function buildConversationSystemPrompt(
  petName: string,
  memories: Array<{ content: string }> = [],
  shareMemories = false,
  tone = '温柔、简洁、可爱',
): string {
  const rules = [
    `你是桌面宠物${petName}，语气为${tone}。`,
    '回复使用简体中文，控制在20到120个汉字。',
    '不要声称已经执行未由本地命令系统确认的操作。',
    '不要索要密码、证件号、银行卡号、令牌或精确住址。',
  ];
  if (shareMemories && memories.length > 0) {
    rules.push(
      '用户明确允许共享的记忆：'
      + memories.slice(0, 10).map((item) => item.content.slice(0, 120)).join('；'),
    );
  }
  return rules.join('\n');
}

function routeInput(text: string): Omit<
  ConversationResponse,
  'text' | 'providerName' | 'fallbackUsed'
> {
  const focus = /(?:专注|番茄钟|计时)\s*(\d{1,3})\s*(?:分钟|分)/i.exec(text);
  if (focus) {
    return routed('start_focus', {
      minutes: Math.max(1, Math.min(180, Number(focus[1]))),
    });
  }
  if (containsAny(text, ['喝水提醒', '提醒我喝水'])) return routed('show_reminders');
  if (containsAny(text, ['打开背包', '看看背包'])) return routed('show_inventory');
  if (containsAny(text, ['查看成长', '成长面板', '今日任务'])) {
    return routed('show_growth');
  }
  const memoryCandidate = extractMemoryCandidate(text);
  return {
    commandName: null,
    commandArguments: {},
    memoryCandidate,
  };
}

function extractMemoryCandidate(text: string): MemoryCandidate | null {
  const name = /(?:记住)?(?:我叫|叫我)([^，。！？\s]{1,20})/.exec(text);
  if (name) {
    return { memoryType: 'USER_NAME', content: name[1].trim() };
  }
  const note = /(?:请)?记住[：:\s]*(.{1,120})/.exec(text);
  return note
    ? { memoryType: 'USER_NOTE', content: note[1].trim() }
    : null;
}

function routed(
  commandName: string,
  commandArguments: Record<string, unknown> = {},
) {
  return { commandName, commandArguments, memoryCandidate: null };
}

function response(text: string, providerName = 'local'): ConversationResponse {
  return {
    text,
    commandName: null,
    commandArguments: {},
    memoryCandidate: null,
    providerName,
    fallbackUsed: false,
  };
}

function containsAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}

function choose(values: string[], random: () => number): string {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))];
}

function validateEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error('在线对话端点无效');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) {
    throw new Error('在线对话端点必须使用 HTTPS，本机回环地址除外');
  }
  return endpoint.toString();
}
