import fs from 'node:fs';
import path from 'node:path';
import type {
  PetPosition,
  PetPreferences,
  PetSettings,
} from '../shared/contracts';
import { safeNormalizeUpdateManifestUrl } from '../update/update-service';

export const DEFAULT_PET_SETTINGS: Readonly<PetSettings> = {
  scale: 1,
  alwaysOnTop: true,
  autoMove: true,
  chaseCursor: true,
  allowThrowing: true,
  activityFrequency: 55,
  launchAtStartup: false,
  selectedPetId: 'codex:tudou',
  codexHomeOverride: '',
  updateManifestUrl: '',
  soundEnabled: false,
  soundVolume: 35,
  desktopEffects: true,
  showStatusReminders: true,
  lowPowerMode: false,
  particlesEnabled: true,
  shadowsEnabled: true,
  trailsEnabled: true,
  autoPauseGames: true,
  quietNightMode: true,
  autoSleep: true,
  bubbleEnabled: true,
  dialogueFrequency: 45,
  gameTargetFps: 60,
  gameEffectLevel: 2,
  preferredScreen: '',
  personalityId: 'lime',
  anonymousAnalytics: false,
  appIcon: 'icon3',
};

export const DEFAULT_PET_POSITION: Readonly<PetPosition> = {
  displayId: '',
  xRatio: 0.82,
  yRatio: 0.78,
  valid: false,
};

export class PreferencesStore {
  constructor(private readonly filePath: string) {}

  load(): PetPreferences {
    try {
      const source = JSON.parse(
        fs.readFileSync(this.filePath, 'utf8'),
      ) as Partial<PetPreferences>;
      return normalizePreferences(source);
    } catch {
      return defaultPreferences();
    }
  }

  save(preferences: PetPreferences): void {
    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.tmp`;
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(normalizePreferences(preferences), null, 2)}\n`,
      'utf8',
    );
    fs.renameSync(temporaryPath, this.filePath);
  }
}

export function defaultPreferences(): PetPreferences {
  return {
    schemaVersion: 1,
    settings: { ...DEFAULT_PET_SETTINGS },
    position: { ...DEFAULT_PET_POSITION },
  };
}

function normalizePreferences(
  source: Partial<PetPreferences>,
): PetPreferences {
  const settings = source.settings ?? DEFAULT_PET_SETTINGS;
  const position = source.position ?? DEFAULT_PET_POSITION;
  return {
    schemaVersion: 1,
    settings: normalizeSettings(settings),
    position: {
      displayId:
        typeof position.displayId === 'string' ? position.displayId : '',
      xRatio: clampNumber(position.xRatio, 0, 1, 0.82),
      yRatio: clampNumber(position.yRatio, 0, 1, 0.78),
      valid: booleanValue(position.valid, false),
    },
  };
}

/**
 * 设置归一化，对应 desktop_pet PetSettings.normalize：
 * 数值裁剪到合法区间，枚举值回退默认。
 */
export function normalizeSettings(
  settings: Partial<PetSettings> | PetSettings,
): PetSettings {
  const base = { ...DEFAULT_PET_SETTINGS, ...settings };
  return {
    scale: clampNumber(base.scale, 0.65, 1.6, 1),
    alwaysOnTop: booleanValue(base.alwaysOnTop, true),
    autoMove: booleanValue(base.autoMove, true),
    chaseCursor: booleanValue(base.chaseCursor, true),
    allowThrowing: booleanValue(base.allowThrowing, true),
    activityFrequency: Math.round(clampNumber(base.activityFrequency, 0, 100, 55)),
    launchAtStartup: booleanValue(base.launchAtStartup, false),
    selectedPetId:
      typeof base.selectedPetId === 'string'
        ? base.selectedPetId.slice(0, 160)
        : 'codex:tudou',
    codexHomeOverride:
      typeof base.codexHomeOverride === 'string'
        ? base.codexHomeOverride.trim().slice(0, 1_000)
        : '',
    updateManifestUrl: safeNormalizeUpdateManifestUrl(base.updateManifestUrl),
    soundEnabled: booleanValue(base.soundEnabled, false),
    soundVolume: Math.round(clampNumber(base.soundVolume, 0, 100, 35)),
    desktopEffects: booleanValue(base.desktopEffects, true),
    showStatusReminders: booleanValue(base.showStatusReminders, true),
    lowPowerMode: booleanValue(base.lowPowerMode, false),
    particlesEnabled: booleanValue(base.particlesEnabled, true),
    shadowsEnabled: booleanValue(base.shadowsEnabled, true),
    trailsEnabled: booleanValue(base.trailsEnabled, true),
    autoPauseGames: booleanValue(base.autoPauseGames, true),
    quietNightMode: booleanValue(base.quietNightMode, true),
    autoSleep: booleanValue(base.autoSleep, true),
    bubbleEnabled: booleanValue(base.bubbleEnabled, true),
    dialogueFrequency: Math.round(clampNumber(base.dialogueFrequency, 0, 100, 45)),
    gameTargetFps: [30, 60, 90, 120].includes(Math.trunc(Number(base.gameTargetFps)))
      ? Math.trunc(Number(base.gameTargetFps))
      : 60,
    gameEffectLevel: Math.round(clampNumber(base.gameEffectLevel, 0, 2, 2)),
    preferredScreen:
      typeof base.preferredScreen === 'string'
        ? base.preferredScreen.slice(0, 160)
        : '',
    personalityId:
      typeof base.personalityId === 'string' && base.personalityId.trim().length > 0
        ? base.personalityId.trim().slice(0, 50)
        : 'lime',
    anonymousAnalytics: booleanValue(base.anonymousAnalytics, false),
    appIcon: ['icon1', 'icon2', 'icon3', 'pet'].includes(String(base.appIcon))
      ? (base.appIcon as 'icon1' | 'icon2' | 'icon3' | 'pet')
      : 'icon3',
  };
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
