import path from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { SpeechPayload } from '../shared/contracts';

const BUBBLE_WIDTH = 288;
const BUBBLE_HEIGHT = 128;

interface QueuedSpeech extends SpeechPayload {
  petBounds: Electron.Rectangle;
}

/**
 * 对话气泡窗口，对应 desktop_pet ui/speech_bubble.py：
 * 独立透明窗口、串行队列（最多 3 条）、自动避开屏幕边界、
 * 淡入淡出后自动消失。
 */
export class SpeechBubbleController {
  private window: BrowserWindow | null = null;
  private queue: QueuedSpeech[] = [];
  private current: QueuedSpeech | null = null;
  private hideTimer: NodeJS.Timeout | null = null;
  private alwaysOnTop = true;
  private nightMode = false;
  private ready = false;

  constructor(private readonly rendererLoader: (window: BrowserWindow, page: string) => Promise<void>) {}

  setAlwaysOnTop(enabled: boolean): void {
    this.alwaysOnTop = enabled;
    if (this.window && !this.window.isDestroyed()) {
      this.window.setAlwaysOnTop(enabled, 'screen-saver');
    }
  }

  setNightMode(enabled: boolean): void {
    this.nightMode = enabled;
  }

  enqueue(
    payload: SpeechPayload,
    petBounds: Electron.Rectangle,
  ): void {
    const text = payload.text.trim();
    if (!text) {
      return;
    }
    if (this.current?.text === text && this.window?.isVisible()) {
      return;
    }
    if (this.queue.some((item) => item.text === text)) {
      return;
    }
    if (this.current !== null) {
      if (this.queue.length < 3) {
        this.queue.push({ ...payload, text, petBounds });
      }
      return;
    }
    this.display({ ...payload, text, petBounds });
  }

  updateAnchor(petBounds: Electron.Rectangle): void {
    if (!this.current || !this.window || this.window.isDestroyed()) {
      return;
    }
    if (!this.window.isVisible()) {
      return;
    }
    this.current.petBounds = petBounds;
    this.window.setBounds(this.positionFor(petBounds), false);
  }

  hide(): void {
    this.queue = [];
    this.current = null;
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  close(): void {
    this.hide();
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.ready = false;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }
    const window = new BrowserWindow({
      width: BUBBLE_WIDTH,
      height: BUBBLE_HEIGHT,
      title: 'Desktop Pet 气泡',
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: this.alwaysOnTop,
      show: false,
      backgroundColor: process.platform === 'darwin' ? '#00ffffff' : '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setIgnoreMouseEvents(true);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.ipc.on('speech:ready', () => {
      this.ready = true;
      if (this.current) {
        this.renderCurrent();
      }
    });
    void this.rendererLoader(window, 'bubble');
    this.window = window;
    return window;
  }

  private display(speech: QueuedSpeech): void {
    this.current = speech;
    const window = this.ensureWindow();
    window.setBounds(this.positionFor(speech.petBounds), false);
    window.setAlwaysOnTop(this.alwaysOnTop, 'screen-saver');
    if (this.ready) {
      this.renderCurrent();
    }
    window.showInactive();
    const duration = Math.max(2_500, Math.min(4_000, speech.durationMs));
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
    }
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.fadeOutCurrent();
    }, duration);
  }

  private renderCurrent(): void {
    if (!this.current || !this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send('speech:show', {
      text: this.current.text,
      emotion: this.current.emotion,
      nightMode: this.nightMode,
    });
  }

  private fadeOutCurrent(): void {
    if (!this.window || this.window.isDestroyed()) {
      this.showNext();
      return;
    }
    this.window.webContents.send('speech:hide');
    setTimeout(() => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.hide();
      }
      this.showNext();
    }, 220);
  }

  private showNext(): void {
    this.current = null;
    const next = this.queue.shift();
    if (next) {
      this.display(next);
    }
  }

  private positionFor(petBounds: Electron.Rectangle): Electron.Rectangle {
    const display = screen.getDisplayNearestPoint({
      x: petBounds.x + Math.floor(petBounds.width / 2),
      y: petBounds.y + Math.floor(petBounds.height / 2),
    });
    const workArea = display.workArea;
    let x = petBounds.x + Math.floor(petBounds.width / 2) - Math.floor(BUBBLE_WIDTH / 2);
    let y = petBounds.y - BUBBLE_HEIGHT + 15;
    if (y < workArea.y) {
      y = petBounds.y + petBounds.height - 20;
    }
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - BUBBLE_WIDTH));
    y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - BUBBLE_HEIGHT));
    return { x, y, width: BUBBLE_WIDTH, height: BUBBLE_HEIGHT };
  }
}
