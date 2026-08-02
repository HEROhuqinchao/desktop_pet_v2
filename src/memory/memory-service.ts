import {
  MEMORY_TYPES,
  type MemoryCandidate,
  type MemoryRecord,
  type MemoryType,
  type PetOperationResult,
} from '../shared/contracts';
import { MemoryPolicy } from './memory-policy';

export interface MemoryStore {
  createMemory(
    memoryType: MemoryType,
    content: string,
    now?: Date,
  ): MemoryRecord;
  listMemories(): MemoryRecord[];
  updateMemory(memoryId: number, content: string, now?: Date): boolean;
  deleteMemory(memoryId: number): boolean;
  clearMemories(): number;
}

export class MemoryService {
  private pending: MemoryCandidate | null = null;

  constructor(
    private readonly store: MemoryStore,
    private readonly policy = new MemoryPolicy(),
  ) {}

  propose(memoryType: string, content: string): PetOperationResult {
    if (!MEMORY_TYPES.includes(memoryType as MemoryType)) {
      return { ok: false, message: '不支持的记忆类型' };
    }
    const validation = this.policy.validate(content);
    if (!validation.ok) {
      return validation;
    }
    this.pending = {
      memoryType: memoryType as MemoryType,
      content: validation.message,
    };
    return { ok: true, message: '等待用户确认' };
  }

  pendingCandidate(): MemoryCandidate | null {
    return this.pending ? { ...this.pending } : null;
  }

  confirm(now = new Date()): MemoryRecord {
    if (!this.pending) {
      throw new Error('没有等待确认的记忆');
    }
    const candidate = this.pending;
    const memory = this.store.createMemory(
      candidate.memoryType,
      candidate.content,
      now,
    );
    this.pending = null;
    return memory;
  }

  reject(): void {
    this.pending = null;
  }

  list(): MemoryRecord[] {
    return this.store.listMemories();
  }

  update(memoryId: number, content: string, now = new Date()): PetOperationResult {
    const validation = this.policy.validate(content);
    if (!validation.ok) {
      return validation;
    }
    const changed = this.store.updateMemory(
      memoryId,
      validation.message,
      now,
    );
    return {
      ok: changed,
      message: changed ? '已更新' : '未找到这条记忆',
    };
  }

  delete(memoryId: number): boolean {
    return this.store.deleteMemory(memoryId);
  }

  clear(): number {
    this.pending = null;
    return this.store.clearMemories();
  }
}
