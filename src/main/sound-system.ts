import fs from 'node:fs';
import path from 'node:path';

/**
 * 音效系统，与 desktop_pet systems/sound_system.py 行为一致：
 * 未开启或素材缺失时安静降级（缺失素材只记录一次日志）。
 * 基准项目同样未接入实际音频后端（注释：正式素材接入后可替换），
 * 这里保持同样的"节流 + 素材探测 + 预留播放"契约，素材缺口见
 * docs/asset-gaps.md。
 */
export class SoundSystem {
  enabled = false;
  volume = 35;
  private lastPlayedAt: Map<string, number> = new Map();
  private missingLogged: Set<string> = new Set();
  private log: (message: string) => void;

  constructor(
    private readonly assetsDir: string,
    log: (message: string) => void = console.info,
    private readonly clock: () => number = () => Date.now(),
  ) {
    this.log = log;
  }

  configure(enabled: boolean, volume: number): void {
    this.enabled = Boolean(enabled);
    this.volume = Math.max(0, Math.min(100, Math.trunc(volume)));
  }

  /** 返回是否应当播放（素材存在且通过节流），供后续音频后端接入。 */
  play(name: string, minimumIntervalSeconds = 1.2): boolean {
    if (!this.enabled) {
      return false;
    }
    const now = this.clock();
    const last = this.lastPlayedAt.get(name) ?? -Number.MAX_SAFE_INTEGER;
    if ((now - last) / 1000 < minimumIntervalSeconds) {
      return false;
    }
    const target = path.join(this.assetsDir, `${name}.wav`);
    if (!fs.existsSync(target)) {
      if (!this.missingLogged.has(name)) {
        this.missingLogged.add(name);
        this.log(`音效素材不存在，已忽略：${target}`);
      }
      return false;
    }
    this.lastPlayedAt.set(name, now);
    return true;
  }
}
