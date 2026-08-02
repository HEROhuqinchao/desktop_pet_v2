import fs from 'node:fs';

/**
 * 台词选择系统，行为与 desktop_pet systems/dialogue_system.py 一致：
 * 按场景分类选择台词，30 分钟内不重复同一句，主动台词 60 秒冷却。
 */
export class DialogueSystem {
  private dialogues: Map<string, string[]> = new Map();
  private recent: string[] = [];
  private spokenAt: Map<string, number> = new Map();
  private lastProactiveAt = -60_000;

  constructor(
    private readonly clock: () => number = () => Date.now(),
  ) {}

  loadFromFile(path: string): void {
    try {
      const payload: unknown = JSON.parse(fs.readFileSync(path, 'utf8'));
      this.loadFromRecord(
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {},
      );
    } catch {
      this.dialogues = new Map();
    }
  }

  loadFromRecord(record: Record<string, unknown>): void {
    const next = new Map<string, string[]>();
    for (const [category, value] of Object.entries(record)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const lines = value
        .map((item) => String(item).trim())
        .filter((item) => item.length > 0);
      if (lines.length > 0) {
        next.set(category, lines);
      }
    }
    this.dialogues = next;
  }

  categories(): string[] {
    return [...this.dialogues.keys()];
  }

  pick(
    category: string,
    fallback: string,
    options: { proactive?: boolean; random?: () => number } = {},
  ): string {
    const now = this.clock();
    const random = options.random ?? Math.random;
    if (options.proactive && now - this.lastProactiveAt < 60_000) {
      return '';
    }
    const values = this.dialogues.get(category) ?? [];
    let available = values.filter(
      (text) => now - (this.spokenAt.get(text) ?? -1_800_000) >= 1_800_000,
    );
    if (available.length === 0) {
      available = values.filter((text) => !this.recent.includes(text));
    }
    if (available.length === 0) {
      available = values;
    }
    const text = available.length > 0
      ? available[Math.min(available.length - 1, Math.floor(random() * available.length))]
      : fallback;
    this.recent.push(text);
    if (this.recent.length > 8) {
      this.recent.splice(0, this.recent.length - 8);
    }
    this.spokenAt.set(text, now);
    if (options.proactive) {
      this.lastProactiveAt = now;
    }
    for (const [value, spokenAt] of this.spokenAt) {
      if (now - spokenAt > 1_800_000) {
        this.spokenAt.delete(value);
      }
    }
    return text;
  }
}
