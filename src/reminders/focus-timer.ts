import type { FocusState } from '../shared/contracts';

export interface FocusStorage {
  startFocusSession(
    sessionId: string,
    plannedSeconds: number,
    startedAt: string,
  ): void;
  finishFocusSession(
    sessionId: string,
    elapsedSeconds: number,
    status: 'completed' | 'cancelled' | 'interrupted',
    endedAt: string,
  ): void;
  countCompletedFocusSessions(): number;
  interruptOpenFocusSessions(endedAt: string): void;
}

export interface FocusTick {
  state: FocusState;
  completed: boolean;
}

export class FocusTimer {
  private status: FocusState['status'] = 'idle';
  private sessionId: string | null = null;
  private plannedSeconds = 0;
  private startedAt = 0;
  private pausedAt = 0;
  private pausedTotal = 0;
  private elapsedBeforePause = 0;

  constructor(
    private readonly storage: FocusStorage,
    private readonly monotonicClock: () => number =
      () => performance.now() / 1_000,
    private readonly wallClock: () => Date = () => new Date(),
  ) {}

  initialize(): void {
    this.storage.interruptOpenFocusSessions(
      this.wallClock().toISOString(),
    );
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  snapshot(): FocusState {
    const elapsedSeconds = this.elapsedSeconds();
    return {
      status: this.status,
      sessionId: this.sessionId,
      plannedSeconds: this.plannedSeconds,
      elapsedSeconds,
      remainingSeconds: Math.max(
        0,
        this.plannedSeconds - elapsedSeconds,
      ),
      completedCount: this.storage.countCompletedFocusSessions(),
    };
  }

  start(minutes: number): FocusState {
    if (this.status !== 'idle') {
      throw new Error('已有专注计时正在进行');
    }
    const normalizedMinutes = clampInteger(minutes, 1, 180, 25);
    this.sessionId = createSessionId();
    this.plannedSeconds = normalizedMinutes * 60;
    this.startedAt = this.monotonicClock();
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.elapsedBeforePause = 0;
    this.status = 'running';
    this.storage.startFocusSession(
      this.sessionId,
      this.plannedSeconds,
      this.wallClock().toISOString(),
    );
    return this.snapshot();
  }

  pause(): FocusState {
    if (this.status !== 'running') {
      return this.snapshot();
    }
    this.elapsedBeforePause = this.elapsedSeconds();
    this.pausedAt = this.monotonicClock();
    this.status = 'paused';
    return this.snapshot();
  }

  resume(): FocusState {
    if (this.status !== 'paused') {
      return this.snapshot();
    }
    this.pausedTotal += Math.max(
      0,
      this.monotonicClock() - this.pausedAt,
    );
    this.status = 'running';
    return this.snapshot();
  }

  stop(): FocusState {
    if (this.status === 'idle' || !this.sessionId) {
      return this.snapshot();
    }
    const elapsedSeconds = this.elapsedSeconds();
    this.storage.finishFocusSession(
      this.sessionId,
      elapsedSeconds,
      'cancelled',
      this.wallClock().toISOString(),
    );
    this.reset();
    return this.snapshot();
  }

  tick(): FocusTick {
    if (this.status !== 'running' || !this.sessionId) {
      return { state: this.snapshot(), completed: false };
    }
    if (this.elapsedSeconds() < this.plannedSeconds) {
      return { state: this.snapshot(), completed: false };
    }
    const completedSessionId = this.sessionId;
    const elapsedSeconds = Math.max(
      this.plannedSeconds,
      this.elapsedSeconds(),
    );
    this.storage.finishFocusSession(
      completedSessionId,
      elapsedSeconds,
      'completed',
      this.wallClock().toISOString(),
    );
    this.reset();
    return { state: this.snapshot(), completed: true };
  }

  private elapsedSeconds(): number {
    if (this.status === 'idle') {
      return 0;
    }
    if (this.status === 'paused') {
      return this.elapsedBeforePause;
    }
    return Math.max(
      0,
      Math.floor(
        this.monotonicClock() - this.startedAt - this.pausedTotal,
      ),
    );
  }

  private reset(): void {
    this.status = 'idle';
    this.sessionId = null;
    this.plannedSeconds = 0;
    this.startedAt = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.elapsedBeforePause = 0;
  }
}

function createSessionId(): string {
  return `focus-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(minimum, Math.min(maximum, value)))
    : fallback;
}
