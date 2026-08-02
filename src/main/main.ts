import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  nativeImage,
  Notification,
  protocol,
  screen,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from 'electron';
import { Entry } from '@napi-rs/keyring';
import {
  PetCatalog,
  type CatalogPackage,
} from '../content/pet-catalog';
import { PetLibrary } from '../content/pet-library';
import {
  ContentPackManager,
  ContentPackValidator,
} from '../content/content-pack';
import {
  PetPackageConflictError,
  type PetPackage,
} from '../content/pet-package';
import {
  BehaviorSelector,
} from '../core/behavior-selector';
import { lookFrameIndex } from '../core/atlas';
import { DragVelocityTracker } from '../core/drag-velocity-tracker';
import { DialogueSystem } from '../core/dialogue-system';
import { EmotionSystem, type PetEmotion } from '../core/emotion-system';
import { SleepSystem } from '../core/sleep-system';
import {
  PET_STATE_DEFINITIONS,
  PetStateMachine,
} from '../core/pet-state-machine';
import { PhysicsEngine } from '../core/physics';
import {
  buildConversationSystemPrompt,
  ConversationController,
  LocalConversationProvider,
  OpenAICompatibleProvider,
} from '../conversation/conversation';
import {
  EVENT_MESSAGES,
  StoryEventSystem,
  type HolidayDefinition,
} from '../events/story-event-system';
import { MemoryService } from '../memory/memory-service';
import { AssistantDatabase } from '../persistence/assistant-database';
import { FocusTimer } from '../reminders/focus-timer';
import { ReminderEngine } from '../reminders/reminder-engine';
import {
  clampWindowToWorkArea,
  normalizeWindowPosition,
  restoreWindowPosition,
  type DisplayWorkArea,
} from '../core/window-position';
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  GAME_DIFFICULTIES,
  GAME_IDS,
  REMINDER_TYPES,
  type FocusState,
  type ContentPackRecord,
  type ConversationPreferences,
  type ConversationSettings,
  type GameDifficulty,
  type GameId,
  type GameRecord,
  type GameResult,
  type GrowthDashboard,
  type MotionState,
  type PanelPage,
  type PetBehaviorState,
  type PetOverlayState,
  type PetPosition,
  type PetSettings,
  type PetStatusSummary,
  type PointerObservation,
  type ReminderDashboard,
  type ReminderInput,
  type ReminderPreferences,
  type StoryEventDefinition,
} from '../shared/contracts';
import {
  SystemKeyringCredentialStore,
  type CredentialStore,
} from './credential-store';
import {
  buildPetContextMenu,
  buildTrayMenu,
  isSleepingState,
} from './pet-menus';
import {
  DEFAULT_PET_POSITION,
  DEFAULT_PET_SETTINGS,
  PreferencesStore,
  normalizeSettings,
} from './preferences-store';
import { setLaunchAtStartup } from './startup-manager';
import { SoundSystem } from './sound-system';
import { SpeechBubbleController } from './speech-bubble';
import { UpdateService } from '../update/update-service';

const DEV_SERVER_URL = process.env.DESKTOP_PET_DEV_SERVER_URL?.replace(/\/$/, '');
const THROW_SPEED_THRESHOLD = 150;
const FRAME_INTERVAL_MS = 16;
const BEHAVIOR_MIN_INTERVAL_MS = 3_500;
const BEHAVIOR_MAX_INTERVAL_MS = 8_000;
const POSITION_SAVE_DELAY_MS = 900;
const ASSISTANT_TICK_MS = 1_000;
/** 属性推进周期，对应基准 ATTRIBUTE_INTERVAL_MS = 30s。 */
const ATTRIBUTE_TICK_MS = 30_000;
/** 提醒检查周期，对应基准 _check_reminders 60s。 */
const REMINDER_CHECK_INTERVAL_MS = 60_000;
const CLICK_MEMORY_WINDOW_MS = 3_000;
const WHEEL_MEMORY_WINDOW_MS = 2_000;
const CLICK_EXPERIENCE_COOLDOWN_MS = 12_000;
const TRANSPARENT_BACKGROUND =
  process.platform === 'darwin' ? '#00ffffff' : '#00000000';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pet-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

let petWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let gameWindow: BrowserWindow | null = null;
let activeGameId: GameId | null = null;
let activeGameDifficulty: GameDifficulty = 'standard';
let gamePaused = false;
let tray: Tray | null = null;
const panelWindows = new Map<PanelPage, BrowserWindow>();
let promptResolver: ((value: string | null) => void) | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let physicsTimer: NodeJS.Timeout | null = null;
let behaviorTimer: NodeJS.Timeout | null = null;
let autonomyTimer: NodeJS.Timeout | null = null;
let positionSaveTimer: NodeJS.Timeout | null = null;
let assistantTimer: NodeJS.Timeout | null = null;
let lastAttributeTickAt = 0;
let lastReminderCheckAt = 0;
let lastBackupDate = '';
let dragOffset = { x: 0, y: 0 };
let physicsVelocity = { x: 0, y: 0 };
let lastPhysicsTimestamp = 0;
let lastBehaviorTimestamp = 0;
let eventStartedAt = 0;
let nextChaseAt = Date.now() + randomBetween(180_000, 480_000);
let pointerHovering = false;
let paused = false;
let pausedBeforeGame = false;
let positionLocked = false;
let preferencesStore: PreferencesStore | null = null;
let petLibrary: PetLibrary | null = null;
let petCatalog: PetCatalog | null = null;
let catalogPackages: CatalogPackage[] = [];
let activePetPackage: PetPackage | null = null;
let assistantDatabase: AssistantDatabase | null = null;
let reminderEngine: ReminderEngine | null = null;
let focusTimer: FocusTimer | null = null;
let contentPackManager: ContentPackManager | null = null;
let memoryService: MemoryService | null = null;
let credentialStore: CredentialStore | null = null;
let conversationController: ConversationController | null = null;
let updateService: UpdateService | null = null;
let speechBubble: SpeechBubbleController | null = null;
let soundSystem: SoundSystem | null = null;
let gameConfigs: { catchFood: unknown; dodgeMouse: unknown } = {
  catchFood: null,
  dodgeMouse: null,
};
let personalities: Record<string, { name?: string; tone?: string }> = {};
let holidays: HolidayDefinition[] = [];
let storyEventSystem = new StoryEventSystem();
let activeEvent: StoryEventDefinition | null = null;
let activeEventVariant: string | null = null;
let activeFood: string | null = null;
let currentEmotion: PetEmotion = 'normal';
let temporaryEmotion: PetEmotion | null = null;
let temporaryEmotionUntil = 0;
const clickTimes: number[] = [];
const wheelTimes: number[] = [];
let lastClickExperienceAt = 0;
const cooldownReadyAt = new Map<string, number>();
let allowQuit = false;
let assistantClosed = false;
let welcomeShown = false;
const activeNotifications = new Set<Notification>();
const emotionSystem = new EmotionSystem();
const sleepSystem = new SleepSystem();
const dialogueSystem = new DialogueSystem();
let currentMotion: MotionState = {
  phase: 'idle',
  behaviorState: 'IDLE',
  velocityX: 0,
  velocityY: 0,
  lookFrame: null,
  overlay: createOverlay(),
};
let currentSettings: PetSettings = { ...DEFAULT_PET_SETTINGS };
let currentPosition: PetPosition = { ...DEFAULT_PET_POSITION };

const dragTracker = new DragVelocityTracker();
const physics = new PhysicsEngine();
const stateMachine = new PetStateMachine();
const behaviorSelector = new BehaviorSelector();
const recentBehaviors: PetBehaviorState[] = [];

/* ------------------------------ 数据与资源 ------------------------------ */

function dataDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'data')
    : path.join(app.getAppPath(), 'data');
}

function readDataJson(name: string): unknown {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dataDir(), name), 'utf8'),
    );
  } catch {
    return null;
  }
}

function loadRuntimeData(): void {
  const dialogues = readDataJson('dialogues.json');
  if (dialogues && typeof dialogues === 'object') {
    dialogueSystem.loadFromRecord(dialogues as Record<string, unknown>);
  }
  const events = readDataJson('events.json');
  if (Array.isArray(events)) {
    storyEventSystem = StoryEventSystem.fromRecords(
      events as Record<string, unknown>[],
    );
  }
  const holidayData = readDataJson('holidays.json');
  holidays = Array.isArray(holidayData)
    ? (holidayData as HolidayDefinition[]).filter(
      (item) =>
        item
        && typeof item.month === 'number'
        && typeof item.day === 'number'
        && typeof item.message === 'string',
    )
    : [];
  const personalityData = readDataJson('personalities.json');
  personalities =
    personalityData && typeof personalityData === 'object'
      ? (personalityData as Record<string, { name?: string; tone?: string }>)
      : {};
  gameConfigs = {
    catchFood: readDataJson('catch_food.json'),
    dodgeMouse: readDataJson('dodge_mouse.json'),
  };
}

function rendererPath(page: string): string {
  return path.join(__dirname, '..', 'renderer', page, 'index.html');
}

function applicationIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(process.cwd(), 'build', 'icon.png');
}

/* ------------------------------ 宠物目录 ------------------------------ */

async function initializePetContent(): Promise<void> {
  petLibrary = new PetLibrary(path.join(app.getPath('userData'), 'pets'));
  petCatalog = new PetCatalog(
    path.join(__dirname, '..', 'renderer', 'pets'),
    petLibrary,
  );
  await refreshPetCatalog();
  await protocol.handle('pet-asset', async (request) => {
    const url = new URL(request.url);
    if (
      url.host !== 'current'
      || url.pathname !== '/spritesheet'
      || !activePetPackage
    ) {
      return new Response('Not found', { status: 404 });
    }
    const upstream = await net.fetch(
      pathToFileURL(activePetPackage.spritesheet).toString(),
    );
    // 附带 CORS 头，渲染侧以 crossOrigin='anonymous' 加载后
    // Canvas getImageData 才不会因跨域被污染（命中检测依赖它）。
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/webp',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });
  });
}

async function refreshPetCatalog(): Promise<void> {
  if (!petCatalog) {
    catalogPackages = [];
    activePetPackage = null;
    return;
  }
  catalogPackages = await petCatalog.listPackages(
    currentSettings.selectedPetId,
    currentSettings.codexHomeOverride,
  );
  let active = catalogPackages.find(
    (item) =>
      !item.externalOnly
      && item.entry.selectionId === currentSettings.selectedPetId,
  );
  active ??= catalogPackages.find(
    (item) => item.entry.selectionId === 'codex:tudou',
  );
  active ??= catalogPackages.find((item) => !item.externalOnly);
  activePetPackage = active?.package ?? null;
  if (active) {
    currentSettings = {
      ...currentSettings,
      selectedPetId: active.entry.selectionId,
    };
  }
  catalogPackages = catalogPackages.map((item) => ({
    ...item,
    entry: {
      ...item.entry,
      active:
        item.entry.selectionId === currentSettings.selectedPetId,
    },
  }));
}

function publicPetCatalog() {
  return catalogPackages.map((item) => ({ ...item.entry }));
}

function broadcastPetCatalog(): void {
  const entries = publicPetCatalog();
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('pet:catalog-changed', entries);
    }
  }
  updateTrayMenu();
}

async function selectPet(selectionId: string) {
  const target = catalogPackages.find(
    (item) =>
      !item.externalOnly
      && item.entry.selectionId === selectionId,
  );
  if (!target) {
    return {
      ok: false,
      message: '宠物不存在或尚未导入本地宠物库',
    };
  }
  activePetPackage = target.package;
  currentSettings = {
    ...currentSettings,
    selectedPetId: target.entry.selectionId,
  };
  await refreshPetCatalog();
  persistPreferences();
  broadcastSettings();
  broadcastPetCatalog();
  say('happy', `换装完成，现在是${target.entry.displayName}。`, {
    emotion: 'happy',
  });
  return {
    ok: true,
    message: `已切换为${target.entry.displayName}`,
  };
}

/** 切换宠物（循环），对应基准 cycle_skin。 */
async function cycleSkin() {
  const selectable = catalogPackages.filter((item) => !item.externalOnly);
  if (selectable.length === 0) {
    return { ok: false, message: '没有可切换的宠物' };
  }
  const index = selectable.findIndex(
    (item) => item.entry.selectionId === currentSettings.selectedPetId,
  );
  const next = selectable[(index + 1) % selectable.length];
  if (!next) {
    return { ok: false, message: '没有可切换的宠物' };
  }
  return selectPet(next.entry.selectionId);
}

/* ------------------------------ 助手服务 ------------------------------ */

function initializeAssistant(): void {
  const now = new Date();
  assistantDatabase = new AssistantDatabase(
    path.join(app.getPath('userData'), 'assistant.db'),
  );
  assistantDatabase.initialize(now);
  assistantDatabase.advancePetAttributes(now, { offline: true });
  reminderEngine = new ReminderEngine(assistantDatabase);
  reminderEngine.ensureDefaults();
  focusTimer = new FocusTimer(assistantDatabase);
  focusTimer.initialize();
  contentPackManager = new ContentPackManager(
    path.join(app.getPath('userData'), 'content_packs'),
    assistantDatabase,
    new ContentPackValidator(app.getVersion()),
  );
  memoryService = new MemoryService(assistantDatabase);
  credentialStore = new SystemKeyringCredentialStore(
    new Entry('com.husu.desktoppet.v2.conversation', 'DesktopPet'),
  );
  rebuildConversationController();
  assistantClosed = false;
}

function petName(): string {
  try {
    return assistantDatabase?.getPetProfile().name ?? '土豆';
  } catch {
    return '土豆';
  }
}

function rebuildConversationController(): void {
  if (!assistantDatabase) {
    conversationController = null;
    return;
  }
  const preferences = assistantDatabase.getConversationPreferences();
  const local = new LocalConversationProvider(
    petName(),
    Math.random,
    () => contentPackManager?.dialogueLines() ?? [],
  );
  const remote = preferences.endpoint && preferences.model
    ? new OpenAICompatibleProvider(
        preferences.endpoint,
        preferences.model,
        () => credentialStore?.getSecret() ?? null,
      )
    : undefined;
  conversationController = new ConversationController(
    local,
    remote,
    preferences.mode,
  );
  const personality = personalities[currentSettings.personalityId] ?? {};
  conversationController.systemPrompt = buildConversationSystemPrompt(
    petName(),
    assistantDatabase.listMemories(),
    preferences.shareMemoriesWithAi,
    typeof personality.tone === 'string' && personality.tone.trim()
      ? personality.tone
      : '温柔、简洁、可爱',
  );
}

function secureStorageAvailable(): boolean {
  return credentialStore !== null;
}

function currentConversationSettings(): ConversationSettings {
  if (!assistantDatabase) {
    throw new Error('对话服务尚未初始化');
  }
  return {
    ...assistantDatabase.getConversationPreferences(),
    hasSecret: Boolean(credentialStore?.getSecret()),
    secureStorageAvailable: secureStorageAvailable(),
  };
}

/* ------------------------------ 对话气泡 ------------------------------ */

function createOverlay(): PetOverlayState {
  return {
    emotion: 'normal',
    activeEvent: null,
    eventVariant: null,
    activeFood: null,
    hungerLow: false,
    cleanlinessLow: false,
    sleeping: false,
  };
}

function refreshOverlay(): void {
  let profile: ReturnType<AssistantDatabase['getPetProfile']> | null;
  try {
    profile = assistantDatabase?.getPetProfile() ?? null;
  } catch {
    profile = null;
  }
  currentMotion = {
    ...currentMotion,
    overlay: {
      emotion: currentEmotion,
      activeEvent: activeEvent?.eventId ?? null,
      eventVariant: activeEventVariant,
      activeFood,
      hungerLow: (profile?.attributes.hunger ?? 100) < 25,
      cleanlinessLow: (profile?.attributes.cleanliness ?? 100) < 25,
      sleeping: stateMachine.currentState === 'SLEEP',
    },
  };
}

function isNightHour(now = new Date()): boolean {
  const hour = now.getHours();
  return hour >= 23 || hour < 7;
}

function updateNightMode(): void {
  speechBubble?.setNightMode(
    currentSettings.quietNightMode && isNightHour(),
  );
}

/**
 * 说一句话，对应基准 pet_controller._say：
 * 对话频率为 0 或气泡关闭时不显示，反馈台词带 0.9s 冷却，
 * 主动台词 60s 冷却（由 DialogueSystem 实现）。
 */
function say(
  category: string,
  fallback: string,
  options: { emotion?: string; proactive?: boolean } = {},
): void {
  if (
    currentSettings.dialogueFrequency <= 0
    || !currentSettings.bubbleEnabled
    || !speechBubble
    || !petWindow
    || petWindow.isDestroyed()
    || !petWindow.isVisible()
  ) {
    return;
  }
  const now = Date.now();
  if (!options.proactive) {
    const readyAt = cooldownReadyAt.get('dialogue:feedback') ?? 0;
    if (now < readyAt) {
      return;
    }
  }
  const text = dialogueSystem.pick(category, fallback, {
    proactive: options.proactive ?? false,
  });
  if (!text) {
    return;
  }
  if (!options.proactive) {
    cooldownReadyAt.set('dialogue:feedback', now + 900);
  }
  speechBubble.enqueue(
    { text, emotion: options.emotion ?? 'normal', durationMs: 3_200 },
    petWindow.getBounds(),
  );
}

function cooldownReady(key: string, now = Date.now()): boolean {
  return now >= (cooldownReadyAt.get(key) ?? 0);
}

function triggerCooldown(key: string, seconds: number, now = Date.now()): void {
  cooldownReadyAt.set(key, now + seconds * 1_000);
}

function setTemporaryEmotion(emotion: PetEmotion, seconds: number): void {
  temporaryEmotion = emotion;
  temporaryEmotionUntil = Date.now() + seconds * 1_000;
  currentEmotion = emotion;
  refreshOverlay();
  sendCurrentMotion();
}

/* ------------------------------ 助手循环 ------------------------------ */

function startAssistantLoop(): void {
  stopAssistantLoop();
  lastReminderCheckAt = 0;
  lastAttributeTickAt = Date.now();
  assistantTimer = setInterval(() => {
    assistantTick();
  }, ASSISTANT_TICK_MS);
  assistantTick();
}

function stopAssistantLoop(): void {
  if (assistantTimer) {
    clearInterval(assistantTimer);
    assistantTimer = null;
  }
}

function assistantTick(): void {
  if (focusTimer?.isRunning()) {
    const result = focusTimer.tick();
    broadcastFocusState(result.state);
    if (result.completed) {
      assistantDatabase?.addPetGrowth(25, 5);
      assistantDatabase?.recordPetProgress('focus', 1);
      showSystemNotification(
        '专注完成',
        '做得很好，起来活动一下、喝口水吧。',
      );
      if (!dragTimer && !physicsTimer) {
        setBehaviorState('HAPPY', true);
      }
      setTemporaryEmotion('happy', 4);
      say('happy', '专注完成啦，休息一下吧！', { emotion: 'happy' });
      updateTrayMenu();
      broadcastGrowthDashboard();
    }
  }
  const now = Date.now();
  if (now - lastAttributeTickAt >= ATTRIBUTE_TICK_MS) {
    lastAttributeTickAt = now;
    advanceAttributes();
  }
  if (now - lastReminderCheckAt >= REMINDER_CHECK_INTERVAL_MS) {
    lastReminderCheckAt = now;
    deliverDueReminders();
  }
  const today = new Date().toDateString();
  if (today !== lastBackupDate) {
    lastBackupDate = today;
    createDailyBackup();
  }
}

/**
 * 属性推进 + 情绪解析 + 自然醒，对应基准 _advance_attributes。
 */
function advanceAttributes(): void {
  if (!assistantDatabase) {
    return;
  }
  const state = stateMachine.currentState;
  updateNightMode();
  const profile = assistantDatabase.advancePetAttributes(new Date(), {
    active:
      state.startsWith('WALK')
      || state.startsWith('RUN')
      || state === 'PLAY'
      || state === 'CHASE_CURSOR',
  });
  if (
    state === 'SLEEP'
    && profile.sleeping
    && sleepSystem.shouldWake(profile.attributes)
  ) {
    petWake();
  }
  const temporary =
    temporaryEmotion !== null && Date.now() < temporaryEmotionUntil
      ? temporaryEmotion
      : null;
  if (temporary === null) {
    temporaryEmotion = null;
  }
  const result = emotionSystem.resolve(profile.attributes, {
    temporary,
  });
  currentEmotion = result.emotion;
  if (
    result.suggestedState
    && ['IDLE', 'BLINK', 'LOOK_AT_CURSOR'].includes(stateMachine.currentState)
  ) {
    if (result.suggestedState !== 'YAWN' || currentSettings.autoSleep) {
      setBehaviorState(result.suggestedState);
    }
  }
  refreshOverlay();
  sendCurrentMotion();
  broadcastGrowthDashboard();
}

/**
 * 提醒投递，对应基准 _check_reminders：60s 检查、每次最多 1 条。
 */
function deliverDueReminders(): void {
  if (!reminderEngine) {
    return;
  }
  const preferences = reminderEngine.dashboard().preferences;
  if (!preferences.enabled) {
    return;
  }
  const due = reminderEngine.due();
  const reminder = due[0];
  if (!reminder) {
    return;
  }
  if (preferences.notificationsEnabled) {
    showSystemNotification('土豆的健康提醒', reminder.title);
  }
  reminderEngine.markDelivered(reminder.reminderId);
  if (!dragTimer && !physicsTimer) {
    setBehaviorState('SPECIAL_EVENT', true);
  }
  broadcastReminderDashboard();
}

function showSystemNotification(title: string, body: string): boolean {
  if (!Notification.isSupported()) {
    return false;
  }
  const icon = nativeImage.createFromPath(applicationIconPath());
  const notification = new Notification({
    title,
    body,
    silent: false,
    icon: icon.isEmpty() ? undefined : icon,
  });
  activeNotifications.add(notification);
  const release = () => {
    activeNotifications.delete(notification);
  };
  notification.once('close', release);
  notification.once('failed', release);
  notification.on('click', () => {
    release();
    showSettingsWindow();
  });
  notification.show();
  return true;
}

/** 每日备份 preferences + assistant.db，保留最近 3 份。 */
function createDailyBackup(): void {
  try {
    const backupRoot = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    const target = path.join(backupRoot, `save-${stamp}`);
    fs.mkdirSync(target, { recursive: true });
    const prefsPath = path.join(app.getPath('userData'), 'preferences.json');
    if (fs.existsSync(prefsPath)) {
      fs.copyFileSync(prefsPath, path.join(target, 'preferences.json'));
    }
    const dbPath = path.join(app.getPath('userData'), 'assistant.db');
    if (fs.existsSync(dbPath) && assistantDatabase) {
      void assistantDatabase
        .backupDatabase(path.join(target, 'assistant.db'))
        .catch(() => undefined);
    }
    const entries = fs
      .readdirSync(backupRoot)
      .filter((name) => name.startsWith('save-'))
      .sort()
      .reverse();
    for (const expired of entries.slice(3)) {
      fs.rmSync(path.join(backupRoot, expired), {
        recursive: true,
        force: true,
      });
    }
  } catch {
    // 备份失败不影响主流程，与基准一致（仅记录日志）。
  }
}

function currentReminderDashboard(): ReminderDashboard {
  if (!reminderEngine) {
    throw new Error('提醒服务尚未初始化');
  }
  return reminderEngine.dashboard();
}

function currentFocusState(): FocusState {
  if (!focusTimer) {
    throw new Error('专注计时尚未初始化');
  }
  return focusTimer.snapshot();
}

function broadcastReminderDashboard(): void {
  if (!reminderEngine) {
    return;
  }
  const dashboard = reminderEngine.dashboard();
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('assistant:reminders-changed', dashboard);
    }
  }
  for (const window of panelWindows.values()) {
    if (!window.isDestroyed()) {
      window.webContents.send('assistant:reminders-changed', dashboard);
    }
  }
  updateTrayMenu();
}

function broadcastFocusState(state = focusTimer?.snapshot()): void {
  if (!state) {
    return;
  }
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('assistant:focus-changed', state);
    }
  }
  for (const window of panelWindows.values()) {
    if (!window.isDestroyed()) {
      window.webContents.send('assistant:focus-changed', state);
    }
  }
}

function currentGameRecords(): GameRecord[] {
  return assistantDatabase?.listGameRecords() ?? [];
}

function broadcastGameRecords(): void {
  const records = currentGameRecords();
  for (const window of [settingsWindow, gameWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('game:records-changed', records);
    }
  }
  updateTrayMenu();
}

function currentGrowthDashboard(): GrowthDashboard {
  if (!assistantDatabase) {
    throw new Error('成长服务尚未初始化');
  }
  return assistantDatabase.getGrowthDashboard();
}

function broadcastGrowthDashboard(): void {
  if (!assistantDatabase) return;
  const dashboard = assistantDatabase.getGrowthDashboard();
  for (const window of [petWindow, settingsWindow, gameWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('growth:dashboard-changed', dashboard);
    }
  }
  for (const window of panelWindows.values()) {
    if (!window.isDestroyed()) {
      window.webContents.send('growth:dashboard-changed', dashboard);
    }
  }
}

function broadcastAllAssistantState(): void {
  broadcastReminderDashboard();
  broadcastFocusState();
  broadcastGameRecords();
  broadcastGrowthDashboard();
}

function startFocusSession(minutes: number) {
  if (!focusTimer) {
    return { ok: false, message: '专注计时尚未初始化' };
  }
  try {
    const state = focusTimer.start(minutes);
    broadcastFocusState(state);
    updateTrayMenu();
    return {
      ok: true,
      message: `已开始 ${Math.round(state.plannedSeconds / 60)} 分钟专注`,
    };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function pauseFocusSession() {
  if (!focusTimer) {
    return { ok: false, message: '专注计时尚未初始化' };
  }
  const before = focusTimer.snapshot();
  const state = focusTimer.pause();
  broadcastFocusState(state);
  updateTrayMenu();
  return before.status === 'running'
    ? { ok: true, message: '专注计时已暂停' }
    : { ok: false, message: '当前没有可暂停的专注' };
}

function resumeFocusSession() {
  if (!focusTimer) {
    return { ok: false, message: '专注计时尚未初始化' };
  }
  const before = focusTimer.snapshot();
  const state = focusTimer.resume();
  broadcastFocusState(state);
  updateTrayMenu();
  return before.status === 'paused'
    ? { ok: true, message: '专注计时已继续' }
    : { ok: false, message: '当前没有已暂停的专注' };
}

function stopFocusSession() {
  if (!focusTimer) {
    return { ok: false, message: '专注计时尚未初始化' };
  }
  const before = focusTimer.snapshot();
  const state = focusTimer.stop();
  broadcastFocusState(state);
  updateTrayMenu();
  return before.status !== 'idle'
    ? { ok: true, message: '专注计时已停止' }
    : { ok: false, message: '当前没有进行中的专注' };
}

/* ------------------------------ 宠物行为 ------------------------------ */

function sendMotion(state: MotionState): void {
  currentMotion = state;
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('pet:motion-state', state);
    }
  }
}

function sendCurrentMotion(patch: Partial<MotionState> = {}): void {
  sendMotion({
    ...currentMotion,
    behaviorState: stateMachine.currentState,
    ...patch,
  });
}

function setBehaviorState(
  target: PetBehaviorState,
  force = false,
): boolean {
  const previous = stateMachine.currentState;
  const changed = stateMachine.changeState(target, force);
  if (!changed) {
    return false;
  }
  recentBehaviors.push(target);
  if (recentBehaviors.length > 8) {
    recentBehaviors.splice(0, recentBehaviors.length - 8);
  }
  // 睡眠流程状态维护，对应基准 _on_state_changed 的 is_sleeping 处理。
  if (target === 'SLEEP') {
    assistantDatabase?.setPetSleeping(true);
  } else if (previous === 'SLEEP') {
    assistantDatabase?.setPetSleeping(false);
  }
  if (previous === 'EAT' && target !== 'EAT') {
    activeFood = null;
  }
  if (target === 'JUMP') {
    soundSystem?.play('jump');
  } else if (target === 'HAPPY') {
    soundSystem?.play('happy');
  } else if (target === 'ANGRY') {
    soundSystem?.play('angry');
  }
  refreshOverlay();
  sendCurrentMotion({
    phase: target === 'LAND' ? 'landed' : 'idle',
    velocityX: 0,
    velocityY: 0,
    lookFrame:
      target === 'IDLE' || target === 'LOOK_AT_CURSOR'
        ? currentMotion.lookFrame
        : null,
  });
  updateTrayMenu();
  return true;
}

function chooseCompletionCandidate(): PetBehaviorState {
  const candidates = stateMachine.definition.completionCandidates;
  if (candidates.length === 0) {
    return 'IDLE';
  }
  return candidates[Math.floor(Math.random() * candidates.length)] ?? 'IDLE';
}

function broadcastSettings(): void {
  for (const window of [petWindow, settingsWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('pet:settings-changed', currentSettings);
    }
  }
  updateTrayMenu();
}

function stopDragTimer(): void {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

function stopPhysicsTimer(): void {
  if (physicsTimer) {
    clearInterval(physicsTimer);
    physicsTimer = null;
  }
}

function stopBehaviorLoop(): void {
  if (behaviorTimer) {
    clearInterval(behaviorTimer);
    behaviorTimer = null;
  }
  if (autonomyTimer) {
    clearTimeout(autonomyTimer);
    autonomyTimer = null;
  }
}

function startBehaviorLoop(): void {
  stopBehaviorLoop();
  lastBehaviorTimestamp = Date.now();
  behaviorTimer = setInterval(updateBehaviorMotion, FRAME_INTERVAL_MS);
  scheduleNextAutonomousBehavior();
}

/**
 * 行为帧，对应基准 _update_motion：
 * 暂停时停止移动，发疯事件折返跑，状态机完成后走候选状态。
 */
function updateBehaviorMotion(): void {
  const now = Date.now();
  const elapsedSeconds = clamp(
    (now - lastBehaviorTimestamp) / 1_000,
    0,
    0.1,
  );
  lastBehaviorTimestamp = now;
  if (
    !petWindow
    || petWindow.isDestroyed()
    || dragTimer
    || physicsTimer
    || paused
  ) {
    return;
  }

  const tick = stateMachine.update(elapsedSeconds);
  const bounds = petWindow.getBounds();
  const display = preferredDisplayFor(bounds);
  const minimumX = display.workArea.x;
  const maximumX = Math.max(
    minimumX,
    display.workArea.x + display.workArea.width - bounds.width,
  );
  let nextX = bounds.x + tick.deltaX;
  let nextY = bounds.y + tick.deltaY;

  if (activeEvent?.eventId === 'zoomies') {
    const eventElapsed = (now - eventStartedAt) / 1_000;
    const direction =
      Math.floor(eventElapsed / 0.48) % 2 === 0 ? 1 : -1;
    nextX += direction * 285 * elapsedSeconds;
  }

  if (stateMachine.currentState === 'CHASE_CURSOR') {
    const cursor = screen.getCursorScreenPoint();
    const distanceX = cursor.x - (bounds.x + bounds.width / 2);
    const distanceY = cursor.y - (bounds.y + bounds.height / 2);
    const distance = Math.hypot(distanceX, distanceY);
    if (distance > 60) {
      const step = Math.min(
        distance - 60,
        PET_STATE_DEFINITIONS.CHASE_CURSOR.moveSpeed * elapsedSeconds,
      );
      nextX += (distanceX / distance) * step;
      nextY += (distanceY / distance) * step;
    }
  }

  if (nextX <= minimumX) {
    nextX = minimumX;
    if (stateMachine.currentState === 'WALK_LEFT') {
      setBehaviorState('WALK_RIGHT', true);
    } else if (stateMachine.currentState === 'RUN_LEFT') {
      setBehaviorState('RUN_RIGHT', true);
    }
  } else if (nextX >= maximumX) {
    nextX = maximumX;
    if (stateMachine.currentState === 'WALK_RIGHT') {
      setBehaviorState('WALK_LEFT', true);
    } else if (stateMachine.currentState === 'RUN_RIGHT') {
      setBehaviorState('RUN_LEFT', true);
    }
  }

  nextY = clamp(
    nextY,
    display.workArea.y,
    Math.max(
      display.workArea.y,
      display.workArea.y + display.workArea.height - bounds.height,
    ),
  );
  if (
    Math.round(nextX) !== bounds.x
    || Math.round(nextY) !== bounds.y
  ) {
    petWindow.setPosition(Math.round(nextX), Math.round(nextY), false);
    speechBubble?.updateAnchor(petWindow.getBounds());
  }

  if (!tick.completed) {
    return;
  }
  if (stateMachine.currentState === 'CHASE_CURSOR') {
    nextChaseAt = Date.now() + randomBetween(180_000, 480_000);
    const floorY =
      display.workArea.y + display.workArea.height - bounds.height;
    if (nextY < floorY - 2) {
      startPhysics(0, 0, 'FALL');
    } else {
      setBehaviorState('IDLE', true);
    }
  } else if (!activeEvent) {
    const target = chooseCompletionCandidate();
    if (target === 'JUMP') {
      startPhysics(0, -520, 'JUMP');
    } else {
      setBehaviorState(target, true);
    }
  }
  schedulePreferencesSave();
}

function scheduleNextAutonomousBehavior(): void {
  if (autonomyTimer) {
    clearTimeout(autonomyTimer);
  }
  const frequency = currentSettings.activityFrequency / 100;
  const upper =
    BEHAVIOR_MAX_INTERVAL_MS
    - (BEHAVIOR_MAX_INTERVAL_MS - BEHAVIOR_MIN_INTERVAL_MS) * frequency;
  const delay = Math.max(1_800, randomBetween(upper * 0.72, upper * 1.28));
  autonomyTimer = setTimeout(() => {
    autonomyTimer = null;
    chooseAutonomousBehavior();
    scheduleNextAutonomousBehavior();
  }, delay);
}

/**
 * 自主行为选择，对应基准 _choose_autonomous_behavior：
 * 真实属性驱动 + 自动睡眠 + 随机事件概率触发。
 */
function chooseAutonomousBehavior(): void {
  if (
    paused
    || dragTimer
    || physicsTimer
    || activeEvent !== null
    || [
      'YAWN',
      'PREPARE_SLEEP',
      'SLEEP',
      'EAT',
      'DRAGGED',
      'THROWN',
      'FALL',
    ].includes(stateMachine.currentState)
  ) {
    return;
  }
  let attributes: {
    hunger: number;
    energy: number;
    mood: number;
    affection: number;
    cleanliness: number;
    curiosity: number;
  } | null;
  try {
    attributes = assistantDatabase?.getPetProfile().attributes ?? null;
  } catch {
    attributes = null;
  }
  if (attributes && sleepSystem.shouldAutoSleep(
    attributes,
    currentSettings.autoSleep,
  )) {
    petSleep();
    return;
  }
  const eventChance =
    0.018 + currentSettings.activityFrequency / 4_000;
  if (Math.random() < eventChance && assistantDatabase) {
    const level = assistantDatabase.getPetProfile().level;
    const recent = assistantDatabase.listRecentStoryEventIds(3);
    const event = storyEventSystem.choose(level, recent);
    if (event) {
      startSpecialEvent(event);
      return;
    }
  }
  let target = behaviorSelector.select({
    attributes: attributes ?? {
      hunger: 78,
      energy: 82,
      mood: 80,
      affection: 35,
      cleanliness: 90,
      curiosity: 68,
    },
    settings: currentSettings,
    recentBehaviors,
    quietNightMode: currentSettings.quietNightMode,
  });
  if (target === 'CHASE_CURSOR' && Date.now() < nextChaseAt) {
    target = 'IDLE';
  }
  if (target === 'JUMP') {
    startPhysics(0, -520, 'JUMP');
  } else {
    setBehaviorState(target);
  }
  // 饥饿/疲劳主动台词，对应基准行为结束后的 _say proactive 分支。
  if (attributes && attributes.hunger < 25 && Math.random() < 0.45) {
    say('hungry', '我没有催饭，只是刚好看向了小面包的方向。', {
      proactive: true,
    });
  } else if (attributes && attributes.energy < 22 && Math.random() < 0.4) {
    say('tired', '我的行动力没有消失，只是暂时存起来了。', {
      emotion: 'sleepy',
      proactive: true,
    });
  }
}

/* ------------------------------ 随机事件 ------------------------------ */

function startSpecialEvent(
  event: StoryEventDefinition,
  options: { message?: string } = {},
): void {
  if (paused || activeGameId !== null || !petWindow || petWindow.isDestroyed()) {
    return;
  }
  if (activeEvent) {
    finishSpecialEvent();
  }
  activeEvent = event;
  eventStartedAt = Date.now();
  activeEventVariant =
    event.eventId === 'weather' ? storyEventSystem.weatherVariant() : null;
  if (event.eventId === 'edge_adventure') {
    const bounds = petWindow.getBounds();
    const display = preferredDisplayFor(bounds);
    petWindow.setPosition(display.workArea.x, bounds.y, false);
  }
  setBehaviorState('SPECIAL_EVENT', true);
  const message =
    options.message
    ?? EVENT_MESSAGES[event.eventId]
    ?? `${event.name}开始了。`;
  say('special_event', message);
  refreshOverlay();
  sendCurrentMotion();
  setTimeout(() => {
    if (activeEvent?.eventId === event.eventId) {
      finishSpecialEvent();
    }
  }, event.durationSeconds * 1_000);
}

function finishSpecialEvent(rewardJson: string | null = null): void {
  const event = activeEvent;
  if (!event) {
    return;
  }
  activeEvent = null;
  activeEventVariant = null;
  if (assistantDatabase) {
    assistantDatabase.recordStoryEvent(event.eventId, rewardJson);
    assistantDatabase.addPetGrowth(5, 0);
  }
  setBehaviorState('IDLE', true);
  refreshOverlay();
  sendCurrentMotion();
  broadcastGrowthDashboard();
}

/**
 * 事件点击交互，对应基准 _handle_event_click：
 * 宝箱开奖、装死/假更新/侦探点击结束。
 */
function handleEventClick(): boolean {
  const event = activeEvent;
  if (!event || !assistantDatabase) {
    return false;
  }
  if (event.eventId === 'treasure') {
    const reward = storyEventSystem.treasureReward();
    let message = '箱子里装的是人生经验。';
    if (reward.kind === 'item') {
      assistantDatabase.grantInventory(
        reward.itemId,
        reward.itemId === 'bread' ? 'food' : 'toy',
        reward.name,
        reward.amount,
      );
      message = `宝箱里有${reward.name} × ${reward.amount}！`;
    } else if (reward.kind === 'experience') {
      assistantDatabase.addPetGrowth(reward.amount, 0);
      message = `找到 ${reward.amount} 点经验，知识也是宝藏。`;
    } else if (reward.kind === 'title') {
      assistantDatabase.grantTitle(reward.name);
      message = `获得称号：${reward.name}。`;
    }
    soundSystem?.play('treasure');
    say('special_event', message, { emotion: 'happy' });
    finishSpecialEvent(JSON.stringify(reward));
    return true;
  }
  if (event.eventId === 'play_dead') {
    const lines = [
      '演技怎么样？我给自己打九分。',
      '突袭！刚才只是测试你的观察力。',
      '检测到关心，立即恢复生命体征。',
    ];
    say('special_event', lines[Math.floor(Math.random() * lines.length)] ?? '', {
      emotion: 'happy',
    });
    finishSpecialEvent();
    setBehaviorState('HAPPY', true);
    return true;
  }
  if (event.eventId === 'fake_update') {
    say('special_event', '更新失败，已经很聪明了。', { emotion: 'happy' });
    finishSpecialEvent();
    return true;
  }
  if (event.eventId === 'detective') {
    say('special_event', '调查结论：鼠标刚才确实经过了这里。');
    finishSpecialEvent();
    return true;
  }
  return false;
}

/* ------------------------------ 宠物互动 ------------------------------ */

function recordInteraction(): void {
  assistantDatabase?.recordPetProgress('interaction', 1);
  broadcastGrowthDashboard();
}

/**
 * 单击（摸摸），对应基准 _on_clicked：
 * 3 秒窗口连点计数、睡眠打扰生气、6/10 次进入 ANGRY、12s 经验冷却。
 */
function handleSingleClick(relativeY: number): boolean {
  if (!assistantDatabase) {
    return false;
  }
  const now = Date.now();
  if (activeEvent && handleEventClick()) {
    recordInteraction();
    return true;
  }
  clickTimes.push(now);
  while (clickTimes.length > 0 && now - (clickTimes[0] ?? 0) > CLICK_MEMORY_WINDOW_MS) {
    clickTimes.shift();
  }
  const repeated = clickTimes.length;
  recordInteraction();

  if (isSleepingState(stateMachine.currentState)) {
    if (repeated >= 3) {
      setBehaviorState('ANGRY', true);
      setTemporaryEmotion('angry', 6);
      say('angry', '睡眠被连续刷新，我的起床气也刷新了。', {
        emotion: 'angry',
      });
    } else {
      say('sleep', '唔……这一声我假装没听见。', { emotion: 'sleepy' });
    }
    return true;
  }

  if (repeated >= 10) {
    setBehaviorState('ANGRY', true);
    setTemporaryEmotion('angry', 10);
    say('repeated_click', '暂停一下，我的脸颊已经进入高频保护模式。', {
      emotion: 'angry',
    });
  } else if (repeated >= 6) {
    setBehaviorState('ANGRY', true);
    setTemporaryEmotion('angry', 6);
    say('repeated_click', '再点下去，我要给鼠标开罚单了。', {
      emotion: 'angry',
    });
  } else {
    assistantDatabase.applyPettingGain(repeated);
    setBehaviorState('HAPPY', true);
    const category = relativeY < 0.62 ? 'happy' : 'clicked';
    const fallback =
      repeated >= 3
        ? '连续摸摸已收到，开心得有点站不稳。'
        : '收到一份摸摸，已妥善存档。';
    say(category, fallback, { emotion: 'happy' });
  }
  if (now - lastClickExperienceAt > CLICK_EXPERIENCE_COOLDOWN_MS) {
    lastClickExperienceAt = now;
    assistantDatabase.addPetGrowth(1, 0);
  }
  broadcastGrowthDashboard();
  return true;
}

/** 双击，对应基准 DOUBLE_CLICK：睡眠中叫醒，否则打开状态面板。 */
function handleDoubleClick(): boolean {
  if (isSleepingState(stateMachine.currentState)) {
    petWake();
  } else {
    void openPanel('status');
  }
  return true;
}

/**
 * 摸摸它（菜单/状态面板"互动"），对应基准 pet_controller.pet()：
 * 睡眠中拒绝，否则好感增益 + HAPPY + 固定台词。
 */
function petAction() {
  if (!assistantDatabase) {
    return { ok: false, message: '互动服务尚未初始化' };
  }
  if (isSleepingState(stateMachine.currentState)) {
    say('sleep', '唔……轻一点，我还在做梦。', { emotion: 'sleepy' });
    return { ok: false, message: '宠物正在睡觉' };
  }
  assistantDatabase.applyPettingGain(1);
  recordInteraction();
  setBehaviorState('HAPPY', true);
  say('happy', '嗯，就是那里，再轻一点。', { emotion: 'happy' });
  return { ok: true, message: '已摸摸' };
}

/** 滚轮，对应基准 _on_wheel：顺毛/挠痒，2 秒 8 次变晕。 */
function handleWheel(deltaY: number): boolean {
  if (!assistantDatabase) {
    return false;
  }
  const now = Date.now();
  wheelTimes.push(now);
  while (wheelTimes.length > 0 && now - (wheelTimes[0] ?? 0) > WHEEL_MEMORY_WINDOW_MS) {
    wheelTimes.shift();
  }
  if (wheelTimes.length >= 8) {
    if (cooldownReady('interaction:dizzy', now)) {
      triggerCooldown('interaction:dizzy', 3, now);
      setBehaviorState('DIZZY', true);
      say('clicked', '转得有点快，我的方向感申请休假。');
    }
    return true;
  }
  if (!cooldownReady('interaction:wheel', now)) {
    return true;
  }
  triggerCooldown('interaction:wheel', 0.3, now);
  recordInteraction();
  if (deltaY < 0) {
    assistantDatabase.applyPettingGain(1);
    setBehaviorState('HAPPY', true);
    say('happy', '头顶顺毛完成，蓬松度加一。', { emotion: 'happy' });
  } else {
    setBehaviorState('CURIOUS', true);
    say('clicked', '挠痒模式？这个角度很专业。');
  }
  return true;
}

/* ------------------------------ 照料动作 ------------------------------ */

function canFeed(): boolean {
  if (!assistantDatabase) {
    return false;
  }
  try {
    const profile = assistantDatabase.getPetProfile();
    return (
      profile.attributes.hunger <= 95
      && !isSleepingState(stateMachine.currentState)
    );
  } catch {
    return false;
  }
}

function feedPetAction(foodId: string) {
  if (!assistantDatabase) {
    return { ok: false, message: '喂食服务尚未初始化' };
  }
  if (isSleepingState(stateMachine.currentState)) {
    say('sleep', '我还在睡觉，先叫醒我再开饭吧。', { emotion: 'sleepy' });
    return { ok: false, message: '宠物正在睡觉' };
  }
  const result = assistantDatabase.feedPet(foodId);
  if (!result.ok) {
    say('hungry', result.message);
    return result;
  }
  activeFood = foodId;
  setBehaviorState('EAT', true);
  soundSystem?.play('eat');
  say('hungry', result.message, { emotion: 'happy' });
  broadcastGrowthDashboard();
  return result;
}

function playWithPetAction() {
  if (!assistantDatabase) {
    return { ok: false, message: '互动服务尚未初始化' };
  }
  const result = assistantDatabase.playWithPet();
  if (!result.ok) {
    say('tired', result.message, { emotion: 'sleepy' });
    return result;
  }
  setBehaviorState('PLAY', true);
  say('happy', '好耶，这一局算我赢半局！', { emotion: 'happy' });
  broadcastGrowthDashboard();
  return result;
}

/** 睡觉，对应基准 sleep()：走 YAWN → PREPARE_SLEEP → SLEEP 流程。 */
function petSleep() {
  if (isSleepingState(stateMachine.currentState)) {
    return { ok: true, message: '宠物已经在休息' };
  }
  setBehaviorState('YAWN', true);
  say('tired', '准备进入省电模式，梦里继续营业。', { emotion: 'sleepy' });
  return { ok: true, message: '宠物准备睡觉' };
}

function petWake() {
  if (!isSleepingState(stateMachine.currentState)) {
    return { ok: true, message: '宠物没有睡觉' };
  }
  setBehaviorState('WAKE_UP', true);
  assistantDatabase?.setPetSleeping(false);
  say('wake', '唔……启动完成，精神大概加载了七成。');
  return { ok: true, message: '宠物已醒来' };
}

function toggleSleepAction() {
  return isSleepingState(stateMachine.currentState)
    ? petWake()
    : petSleep();
}

async function renamePet(name: string) {
  const normalized = name.trim().slice(0, 20);
  if (!normalized || !assistantDatabase) {
    return { ok: false, message: '名字不能为空' };
  }
  const profile = assistantDatabase.getPetProfile();
  profile.name = normalized;
  assistantDatabase.addPetGrowth(0, 0);
  rebuildConversationController();
  say('happy', `收到，从现在起我叫${normalized}！`, { emotion: 'happy' });
  broadcastGrowthDashboard();
  return { ok: true, message: `已改名为${normalized}` };
}

function togglePauseAction() {
  if (activeGameId !== null && gameWindow && !gameWindow.isDestroyed()) {
    gameWindow.webContents.send('game:toggle-pause');
    updateTrayMenu();
    return { ok: true, message: '已切换小游戏暂停状态' };
  }
  paused = !paused;
  if (paused) {
    if (autonomyTimer) {
      clearTimeout(autonomyTimer);
      autonomyTimer = null;
    }
    say('idle', '暂停一下，我保持这个帅气姿势。');
  } else {
    lastBehaviorTimestamp = Date.now();
    scheduleNextAutonomousBehavior();
    say('idle', '活动恢复，先伸个懒腰。');
  }
  updateTrayMenu();
  return { ok: true, message: paused ? '宠物活动已暂停' : '宠物活动已恢复' };
}

function togglePositionLockAction() {
  positionLocked = !positionLocked;
  return {
    ok: true,
    message: positionLocked ? '位置已锁定' : '位置已解锁',
  };
}

function buildStatusSummary(): PetStatusSummary {
  const profile = assistantDatabase?.getPetProfile();
  return {
    name: profile?.name ?? '土豆',
    level: profile?.level ?? 1,
    stateLabel: stateMachine.currentState,
    interactionCountToday:
      assistantDatabase?.interactionCountToday() ?? 0,
    attributes: profile?.attributes ?? {
      hunger: 78,
      energy: 82,
      mood: 80,
      affection: 35,
      cleanliness: 90,
      curiosity: 68,
    },
    sleeping: stateMachine.currentState === 'SLEEP',
  };
}

/* ------------------------------ 窗口管理 ------------------------------ */

async function loadRenderer(
  window: BrowserWindow,
  page: string,
  query: Record<string, string> = {},
): Promise<void> {
  if (DEV_SERVER_URL) {
    const params = new URLSearchParams(query).toString();
    const suffix = params ? `?${params}` : '';
    await window.loadURL(`${DEV_SERVER_URL}/${page}/index.html${suffix}`);
    return;
  }
  await window.loadFile(rendererPath(page), { query });
}

function scaledPetSize(settings = currentSettings): {
  width: number;
  height: number;
} {
  return {
    width: Math.round(PET_CELL_WIDTH * settings.scale),
    height: Math.round(PET_CELL_HEIGHT * settings.scale),
  };
}

function preferredDisplay(): Electron.Display {
  if (currentSettings.preferredScreen) {
    const match = screen
      .getAllDisplays()
      .find((display) => String(display.id) === currentSettings.preferredScreen);
    if (match) {
      return match;
    }
  }
  return screen.getPrimaryDisplay();
}

function preferredDisplayFor(bounds: Electron.Rectangle): Electron.Display {
  return screen.getDisplayNearestPoint({
    x: bounds.x + Math.floor(bounds.width / 2),
    y: bounds.y + Math.floor(bounds.height / 2),
  });
}

/** 重置位置，对应基准 reset_position：首选屏右缘 -28、底部 +1。 */
function placeAtDefaultPosition(window: BrowserWindow): void {
  const display = preferredDisplay();
  const size = window.getBounds();
  const x =
    display.workArea.x + display.workArea.width - size.width - 28;
  const y = display.workArea.y + display.workArea.height - size.height + 1;
  window.setBounds({ ...size, x, y }, false);
}

function placeAtStoredPosition(window: BrowserWindow): void {
  const restored = restoreWindowPosition(
    currentPosition,
    displayWorkAreas(),
    String(preferredDisplay().id),
    window.getBounds(),
    // 与基准 reset_position 一致：首选屏右缘内缩 28px、贴底。
    28,
  );
  if (restored) {
    window.setBounds(restored, false);
  }
}

function displayWorkAreas(): DisplayWorkArea[] {
  return screen.getAllDisplays().map((display) => ({
    id: String(display.id),
    workArea: { ...display.workArea },
  }));
}

function updateCurrentPosition(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const bounds = petWindow.getBounds();
  const display = preferredDisplayFor(bounds);
  currentPosition = normalizeWindowPosition(bounds, {
    id: String(display.id),
    workArea: { ...display.workArea },
  });
}

function schedulePreferencesSave(): void {
  if (positionSaveTimer) {
    clearTimeout(positionSaveTimer);
  }
  positionSaveTimer = setTimeout(() => {
    positionSaveTimer = null;
    updateCurrentPosition();
    persistPreferences();
  }, POSITION_SAVE_DELAY_MS);
}

function persistPreferences(): void {
  try {
    preferencesStore?.save({
      schemaVersion: 1,
      settings: { ...currentSettings },
      position: { ...currentPosition },
    });
  } catch (error) {
    console.error('保存偏好设置失败', error);
  }
}

function ensurePetVisible(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const bounds = petWindow.getBounds();
  const display = preferredDisplayFor(bounds);
  petWindow.setBounds(
    clampWindowToWorkArea(bounds, display.workArea),
    false,
  );
  schedulePreferencesSave();
}

function applyAlwaysOnTop(): void {
  petWindow?.setAlwaysOnTop(currentSettings.alwaysOnTop);
  speechBubble?.setAlwaysOnTop(currentSettings.alwaysOnTop);
}

function applyPetScale(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  stopMotion();
  const previous = petWindow.getBounds();
  const size = scaledPetSize();
  const display = preferredDisplayFor(previous);
  const x = clamp(
    previous.x + Math.floor((previous.width - size.width) / 2),
    display.workArea.x,
    display.workArea.x + display.workArea.width - size.width,
  );
  const y = clamp(
    previous.y + previous.height - size.height,
    display.workArea.y,
    display.workArea.y + display.workArea.height - size.height,
  );
  petWindow.setBounds({ x, y, ...size }, false);
  schedulePreferencesSave();
}

function showPetWindow(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    petWindow = createPetWindow();
    return;
  }
  petWindow.showInactive();
  ensurePetVisible();
}

function hidePetWindow(): void {
  speechBubble?.hide();
  petWindow?.hide();
}

function createPetWindow(): BrowserWindow {
  const size = scaledPetSize();
  const window = new BrowserWindow({
    ...size,
    title: 'Desktop Pet',
    useContentSize: true,
    transparent: true,
    frame: false,
    backgroundColor: TRANSPARENT_BACKGROUND,
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: currentSettings.alwaysOnTop,
    show: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  window.setMenuBarVisibility(false);
  window.setHasShadow(false);
  window.setBackgroundColor(TRANSPARENT_BACKGROUND);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  placeAtStoredPosition(window);

  void loadRenderer(window, 'pet').then(() => {
    if (!window.isDestroyed()) {
      // macOS 的页面导航可能重置 Chromium backing layer，加载后再次应用。
      window.setBackgroundColor(TRANSPARENT_BACKGROUND);
      window.showInactive();
      sendMotion(currentMotion);
      broadcastSettings();
      // 欢迎语必须在窗口可见后触发（say 依赖 isVisible），对应基准 start()。
      if (!welcomeShown) {
        welcomeShown = true;
        if (stateMachine.currentState !== 'SLEEP') {
          say('welcome', '我来啦，桌面巡逻现在开始。', { emotion: 'happy' });
          setBehaviorState('HAPPY', true);
        }
      }
    }
  });

  window.on('closed', () => {
    stopMotion();
    stopBehaviorLoop();
    petWindow = null;
  });
  return window;
}

function createSettingsWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 460,
    height: 780,
    minWidth: 430,
    minHeight: 480,
    title: 'Desktop Pet 设置',
    show: false,
    backgroundColor: '#ececec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void loadRenderer(window, 'settings').then(() => {
    if (!window.isDestroyed()) {
      window.show();
      sendCurrentMotion();
      broadcastSettings();
      broadcastPetCatalog();
      broadcastReminderDashboard();
      broadcastFocusState();
      broadcastGameRecords();
      broadcastGrowthDashboard();
    }
  });
  window.on('closed', () => {
    settingsWindow = null;
  });
  return window;
}

function showSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = createSettingsWindow();
}

const PANEL_TITLES: Record<PanelPage, string> = {
  status: '宠物状态',
  inventory: '宠物背包',
  growth: '成长与今日任务',
  focus: '专注与健康提醒',
  conversation: `和${'土豆'}聊天`,
  memory: '长期记忆与隐私',
  privacy: '隐私与数据',
  'content-packs': '内容包管理',
  'pet-library': '宠物管理',
  prompt: '输入',
};

const PANEL_SIZES: Record<PanelPage, { width: number; height: number }> = {
  status: { width: 340, height: 350 },
  inventory: { width: 350, height: 340 },
  growth: { width: 580, height: 470 },
  focus: { width: 440, height: 320 },
  conversation: { width: 450, height: 560 },
  memory: { width: 620, height: 440 },
  privacy: { width: 450, height: 400 },
  'content-packs': { width: 580, height: 400 },
  'pet-library': { width: 580, height: 460 },
  prompt: { width: 380, height: 190 },
};

function openPanel(
  page: PanelPage,
  query: Record<string, string> = {},
): void {
  const existing = panelWindows.get(page);
  if (existing && !existing.isDestroyed() && page !== 'prompt') {
    existing.show();
    existing.focus();
    return;
  }
  const size = PANEL_SIZES[page];
  const window = new BrowserWindow({
    ...size,
    title: page === 'conversation' ? `和${petName()}聊天` : PANEL_TITLES[page],
    show: false,
    resizable: page !== 'status' && page !== 'prompt',
    backgroundColor: '#ececec',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  panelWindows.set(page, window);
  window.on('closed', () => {
    if (panelWindows.get(page) === window) {
      panelWindows.delete(page);
    }
    if (page === 'prompt') {
      resolvePrompt(null);
    }
  });
  void loadRenderer(window, 'panel', { page, ...query }).then(() => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
      if (page === 'focus') {
        broadcastFocusState();
        broadcastReminderDashboard();
      }
      if (page === 'growth' || page === 'inventory' || page === 'status') {
        broadcastGrowthDashboard();
      }
    }
  });
}

function resolvePrompt(value: string | null): void {
  const resolver = promptResolver;
  promptResolver = null;
  const window = panelWindows.get('prompt');
  if (window && !window.isDestroyed()) {
    window.close();
  }
  panelWindows.delete('prompt');
  if (resolver) {
    resolver(value);
  }
}

/** 输入对话框，对应基准 QInputDialog（更换名字）。 */
function showPrompt(options: {
  title: string;
  message: string;
  value: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    promptResolver = resolve;
    openPanel('prompt', {
      title: options.title,
      message: options.message,
      value: options.value,
    });
  });
}

/* ------------------------------ 托盘与菜单 ------------------------------ */

function createTray(): void {
  if (tray && !tray.isDestroyed()) {
    return;
  }
  let icon = nativeImage.createFromPath(applicationIconPath());
  if (process.platform === 'darwin' && !icon.isEmpty()) {
    icon = icon.resize({ width: 22, height: 22 });
  }
  if (icon.isEmpty()) {
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip('Desktop Pet · 土豆');
  tray.on('click', () => {
    showPetWindow();
  });
  updateTrayMenu();
}

function menuContextSnapshot() {
  return {
    behaviorState: stateMachine.currentState,
    paused,
    positionLocked,
    alwaysOnTop: currentSettings.alwaysOnTop,
    soundEnabled: currentSettings.soundEnabled,
    canFeed: canFeed(),
    gameActive: activeGameId !== null,
    gamePaused,
  };
}

function updateTrayMenu(): void {
  if (!tray || tray.isDestroyed()) {
    return;
  }
  tray.setContextMenu(
    buildTrayMenu(menuContextSnapshot(), {
      show: () => showPetWindow(),
      hide: () => hidePetWindow(),
      feed: () => feedPetAction('bread'),
      toggleSleep: () => toggleSleepAction(),
      status: () => openPanel('status'),
      conversation: () => openPanel('conversation'),
      growth: () => openPanel('growth'),
      focus: () => openPanel('focus'),
      petLibrary: () => openPanel('pet-library'),
      togglePause: () => togglePauseAction(),
      exitGame: () => exitActiveGame(),
      settings: () => showSettingsWindow(),
      resetPosition: () => {
        if (petWindow && !petWindow.isDestroyed()) {
          stopMotion();
          placeAtDefaultPosition(petWindow);
          updateCurrentPosition();
          persistPreferences();
          showPetWindow();
        }
      },
      quit: () => requestAppQuit(),
    }),
  );
}

function showPetContextMenu(): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  const menu = buildPetContextMenu(menuContextSnapshot(), {
    feedBread: () => feedPetAction('bread'),
    feedFries: () => feedPetAction('fries'),
    feedJuice: () => feedPetAction('juice'),
    play: () => playWithPetAction(),
    pet: () => petAction(),
    sleep: () => petSleep(),
    wake: () => petWake(),
    rename: () => {
      void showPrompt({
        title: '更换名字',
        message: '给宠物取个新名字：',
        value: petName(),
      }).then((value) => {
        if (value !== null) {
          void renamePet(value);
        }
      });
    },
    cycleSkin: () => {
      void cycleSkin();
    },
    petLibrary: () => openPanel('pet-library'),
    status: () => openPanel('status'),
    inventory: () => openPanel('inventory'),
    conversation: () => openPanel('conversation'),
    growth: () => openPanel('growth'),
    focus: () => openPanel('focus'),
    memory: () => openPanel('memory'),
    privacy: () => openPanel('privacy'),
    contentPacks: () => openPanel('content-packs'),
    catchFood: (difficulty) => {
      openGameWindow('catch_food', difficulty);
    },
    dodgeMouse: (difficulty) => {
      openGameWindow('dodge_mouse', difficulty);
    },
    settings: () => showSettingsWindow(),
    toggleLock: () => togglePositionLockAction(),
    toggleTopmost: () => {
      currentSettings = {
        ...currentSettings,
        alwaysOnTop: !currentSettings.alwaysOnTop,
      };
      applyAlwaysOnTop();
      broadcastSettings();
      persistPreferences();
    },
    togglePause: () => togglePauseAction(),
    toggleMute: () => {
      currentSettings = {
        ...currentSettings,
        soundEnabled: !currentSettings.soundEnabled,
      };
      soundSystem?.configure(
        currentSettings.soundEnabled,
        currentSettings.soundVolume,
      );
      broadcastSettings();
      persistPreferences();
    },
    resetPosition: () => {
      if (petWindow && !petWindow.isDestroyed()) {
        stopMotion();
        placeAtDefaultPosition(petWindow);
        updateCurrentPosition();
        persistPreferences();
        showPetWindow();
      }
    },
    quit: () => requestAppQuit(),
  });
  menu.popup({ window: petWindow });
}

/* ------------------------------ 小游戏 ------------------------------ */

function createGameWindow(gameId: GameId): BrowserWindow {
  const size =
    gameId === 'catch_food'
      ? { width: 880, height: 592 }
      : { width: 900, height: 592 };
  const window = new BrowserWindow({
    ...size,
    minWidth: 740,
    minHeight: 540,
    title: gameId === 'catch_food'
      ? '小游戏 · 接食物大作战'
      : '小游戏 · 抓住土豆',
    show: false,
    backgroundColor: '#101217',
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void loadRenderer(window, 'game', {
    gameId,
    difficulty: activeGameDifficulty,
  }).then(() => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
      broadcastGameRecords();
    }
  });
  window.on('closed', () => {
    if (gameWindow === window) {
      finishGameSession();
    }
  });
  return window;
}

function openGameWindow(gameId: GameId, difficulty: GameDifficulty = 'standard') {
  if (
    gameWindow
    && !gameWindow.isDestroyed()
    && activeGameId === gameId
  ) {
    gameWindow.show();
    gameWindow.focus();
    return { ok: true, message: '小游戏已经打开' };
  }
  if (gameWindow && !gameWindow.isDestroyed()) {
    const previous = gameWindow;
    gameWindow = null;
    previous.destroy();
  }
  // 开局快照并隐藏宠物，对应基准 start_game 的 pet_snapshot 处理。
  pausedBeforeGame = paused;
  paused = true;
  if (autonomyTimer) {
    clearTimeout(autonomyTimer);
    autonomyTimer = null;
  }
  activeGameId = gameId;
  activeGameDifficulty = GAME_DIFFICULTIES.includes(difficulty)
    ? difficulty
    : 'standard';
  speechBubble?.hide();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
  gameWindow = createGameWindow(gameId);
  updateTrayMenu();
  return {
    ok: true,
    message: gameId === 'catch_food'
      ? '已打开接食物大作战'
      : '已打开躲避鼠标挑战',
  };
}

function finishGameSession(): void {
  gameWindow = null;
  const restoring = activeGameId !== null;
  activeGameId = null;
  gamePaused = false;
  if (!restoring) {
    return;
  }
  paused = pausedBeforeGame;
  lastBehaviorTimestamp = Date.now();
  if (
    !isSleepingState(stateMachine.currentState)
    && !['DRAGGED', 'THROWN', 'FALL'].includes(stateMachine.currentState)
  ) {
    setBehaviorState('IDLE', true);
  }
  if (petWindow && !petWindow.isDestroyed() && !paused) {
    petWindow.showInactive();
  }
  if (!paused) {
    scheduleNextAutonomousBehavior();
  }
  updateTrayMenu();
}

function exitActiveGame(): void {
  if (gameWindow && !gameWindow.isDestroyed()) {
    gameWindow.webContents.send('game:cancel');
  }
}

function closeGameWindow(): void {
  if (gameWindow && !gameWindow.isDestroyed()) {
    gameWindow.close();
  }
}

/* ------------------------------ 拖动与物理 ------------------------------ */

function stopMotion(): void {
  stopDragTimer();
  stopPhysicsTimer();
  physicsVelocity = { x: 0, y: 0 };
  setBehaviorState('IDLE', true);
  sendCurrentMotion({
    phase: 'idle',
    velocityX: 0,
    velocityY: 0,
    lookFrame: null,
  });
}

function startDrag(): boolean {
  if (!petWindow || petWindow.isDestroyed()) {
    return false;
  }
  if (positionLocked || paused) {
    return false;
  }
  stopMotion();
  petWindow.setIgnoreMouseEvents(false);

  const cursor = screen.getCursorScreenPoint();
  const bounds = petWindow.getBounds();
  dragOffset = {
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y,
  };
  dragTracker.reset(cursor.x, cursor.y, Date.now());
  setBehaviorState('DRAGGED', true);
  say('dragged', '收到，我先把两只脚收好。');
  sendCurrentMotion({
    phase: 'dragging',
    velocityX: 0,
    velocityY: 0,
    lookFrame: null,
  });

  dragTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      stopDragTimer();
      return;
    }
    const point = screen.getCursorScreenPoint();
    dragTracker.add(point.x, point.y, Date.now());
    const velocity = dragTracker.velocity();
    const currentBounds = petWindow.getBounds();
    const display = screen.getDisplayNearestPoint(point);
    // 与基准一致：允许拖出屏幕，仅保留 30% 可见。
    const hiddenWidth = currentBounds.width * 0.7;
    const hiddenHeight = currentBounds.height * 0.7;
    const x = clamp(
      point.x - dragOffset.x,
      display.workArea.x - hiddenWidth,
      display.workArea.x + display.workArea.width - currentBounds.width + hiddenWidth,
    );
    const y = clamp(
      point.y - dragOffset.y,
      display.workArea.y - hiddenHeight,
      display.workArea.y + display.workArea.height - currentBounds.height + hiddenHeight,
    );
    petWindow.setPosition(Math.round(x), Math.round(y), false);
    speechBubble?.updateAnchor(petWindow.getBounds());
    sendCurrentMotion({
      phase: 'dragging',
      velocityX: velocity.x,
      velocityY: velocity.y,
      lookFrame: null,
    });
  }, FRAME_INTERVAL_MS);
  return true;
}

function endDrag(): boolean {
  if (!petWindow || petWindow.isDestroyed() || !dragTimer) {
    return false;
  }
  const point = screen.getCursorScreenPoint();
  dragTracker.add(point.x, point.y, Date.now());
  stopDragTimer();
  const velocity = dragTracker.velocity();

  const speed = Math.hypot(velocity.x, velocity.y);
  if (currentSettings.allowThrowing && speed >= THROW_SPEED_THRESHOLD) {
    startPhysics(
      clamp(velocity.x * 0.9, -1_450, 1_450),
      clamp(velocity.y * 0.9, -1_300, 1_300),
      'THROWN',
    );
    setTemporaryEmotion('scared', 5);
    say('thrown', '这段抛物线，我会写进简历。');
    assistantDatabase?.recordPetProgress('interaction', 1);
  } else {
    const bounds = petWindow.getBounds();
    const display = preferredDisplayFor(bounds);
    const floorY =
      display.workArea.y + display.workArea.height - bounds.height;
    if (bounds.y < floorY - 2) {
      startPhysics(0, 0, 'FALL');
    } else {
      setBehaviorState('HAPPY', true);
      say('happy', '平稳着陆，给你一个温柔搬运奖。', { emotion: 'happy' });
      sendCurrentMotion({
        phase: 'idle',
        velocityX: 0,
        velocityY: 0,
        lookFrame: null,
      });
    }
    assistantDatabase?.recordPetProgress('interaction', 1);
  }
  schedulePreferencesSave();
  return true;
}

function startPhysics(
  velocityX: number,
  velocityY: number,
  initialState: 'JUMP' | 'THROWN' | 'FALL',
): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }
  stopPhysicsTimer();
  physicsVelocity = { x: velocityX, y: velocityY };
  lastPhysicsTimestamp = Date.now();
  setBehaviorState(initialState, true);
  sendCurrentMotion({
    phase: 'thrown',
    velocityX,
    velocityY,
    lookFrame: null,
  });

  physicsTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed()) {
      stopPhysicsTimer();
      return;
    }
    const now = Date.now();
    const elapsedSeconds = (now - lastPhysicsTimestamp) / 1_000;
    lastPhysicsTimestamp = now;
    const stateTick = stateMachine.update(elapsedSeconds);
    const bounds = petWindow.getBounds();
    const display = preferredDisplayFor(bounds);
    const result = physics.step({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      velocityX: physicsVelocity.x,
      velocityY: physicsVelocity.y,
      elapsedSeconds,
      bounds: {
        left: display.workArea.x,
        top: display.workArea.y,
        right: display.workArea.x + display.workArea.width,
        bottom: display.workArea.y + display.workArea.height,
      },
    });
    physicsVelocity = {
      x: result.velocityX,
      y: result.velocityY,
    };
    petWindow.setPosition(Math.round(result.x), Math.round(result.y), false);
    if (
      (stateMachine.currentState === 'JUMP' && result.velocityY >= 0)
      || (stateMachine.currentState === 'THROWN' && stateTick.completed)
    ) {
      setBehaviorState('FALL', true);
    }
    sendCurrentMotion({
      phase: 'thrown',
      velocityX: result.velocityX,
      velocityY: result.velocityY,
      lookFrame: null,
    });

    if (result.settled) {
      stopPhysicsTimer();
      setBehaviorState('LAND', true);
      soundSystem?.play('land');
      sendCurrentMotion({
        phase: 'landed',
        velocityX: 0,
        velocityY: 0,
        lookFrame: null,
      });
      schedulePreferencesSave();
    }
  }, FRAME_INTERVAL_MS);
}

/* ------------------------------ IPC ------------------------------ */

function isPetSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    petWindow
      && !petWindow.isDestroyed()
      && event.sender.id === petWindow.webContents.id,
  );
}

function isGameSender(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    gameWindow
      && !gameWindow.isDestroyed()
      && event.sender.id === gameWindow.webContents.id,
  );
}

function isSettingsSender(event: IpcMainInvokeEvent): boolean {
  const fromSettings = Boolean(
    settingsWindow
      && !settingsWindow.isDestroyed()
      && event.sender.id === settingsWindow.webContents.id,
  );
  if (fromSettings) {
    return true;
  }
  for (const window of panelWindows.values()) {
    if (!window.isDestroyed() && event.sender.id === window.webContents.id) {
      return true;
    }
  }
  return false;
}

function parseReminderInput(value: unknown): ReminderInput | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (
    typeof source.title !== 'string'
    || !REMINDER_TYPES.includes(
      source.reminderType as ReminderInput['reminderType'],
    )
    || (source.scheduleType !== 'interval'
      && source.scheduleType !== 'daily')
    || typeof source.intervalMinutes !== 'number'
    || !Number.isFinite(source.intervalMinutes)
    || !Array.isArray(source.dailyTimes)
    || !source.dailyTimes.every((item) => typeof item === 'string')
    || typeof source.enabled !== 'boolean'
    || typeof source.workdaysOnly !== 'boolean'
  ) {
    return null;
  }
  const reminderId =
    typeof source.reminderId === 'string'
    && source.reminderId.length <= 200
      ? source.reminderId
      : undefined;
  return {
    reminderId,
    reminderType: source.reminderType as ReminderInput['reminderType'],
    title: source.title,
    scheduleType: source.scheduleType,
    intervalMinutes: source.intervalMinutes,
    dailyTimes: source.dailyTimes as string[],
    enabled: source.enabled,
    workdaysOnly: source.workdaysOnly,
  };
}

function parseReminderPreferencesPatch(
  value: unknown,
): Partial<ReminderPreferences> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const source = value as Record<string, unknown>;
  const patch: Partial<ReminderPreferences> = {};
  for (const key of [
    'enabled',
    'notificationsEnabled',
    'workdaysOnly',
    'shutdownChecklistEnabled',
  ] as const) {
    if (typeof source[key] === 'boolean') {
      patch[key] = source[key];
    }
  }
  if (typeof source.quietStart === 'string') {
    patch.quietStart = source.quietStart;
  }
  if (typeof source.quietEnd === 'string') {
    patch.quietEnd = source.quietEnd;
  }
  if (
    typeof source.defaultSnoozeMinutes === 'number'
    && Number.isFinite(source.defaultSnoozeMinutes)
  ) {
    patch.defaultSnoozeMinutes = source.defaultSnoozeMinutes;
  }
  if (
    Array.isArray(source.shutdownChecklistItems)
    && source.shutdownChecklistItems.every(
      (item) => typeof item === 'string',
    )
  ) {
    patch.shutdownChecklistItems =
      source.shutdownChecklistItems as string[];
  }
  return patch;
}

function parseGameResult(value: unknown): GameResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const source = value as Record<string, unknown>;
  const numericKeys = [
    'score',
    'durationSeconds',
    'maxCombo',
    'accuracy',
    'caughtCount',
    'droppedCount',
    'hitCount',
    'missCount',
  ] as const;
  if (
    !GAME_IDS.includes(source.gameId as GameId)
    || !['S', 'A', 'B', 'C', 'D'].includes(String(source.grade))
    || !['completed', 'cancelled', 'window-closed'].includes(
      String(source.finishReason),
    )
    || numericKeys.some(
      (key) =>
        typeof source[key] !== 'number'
        || !Number.isFinite(source[key]),
    )
  ) {
    return null;
  }
  return {
    gameId: source.gameId as GameId,
    score: Math.round(clamp(source.score as number, 0, 10_000_000)),
    grade: source.grade as GameResult['grade'],
    durationSeconds: clamp(
      source.durationSeconds as number,
      0,
      3_600,
    ),
    maxCombo: Math.round(
      clamp(source.maxCombo as number, 0, 100_000),
    ),
    accuracy: clamp(source.accuracy as number, 0, 1),
    caughtCount: Math.round(
      clamp(source.caughtCount as number, 0, 1_000_000),
    ),
    droppedCount: Math.round(
      clamp(source.droppedCount as number, 0, 1_000_000),
    ),
    hitCount: Math.round(
      clamp(source.hitCount as number, 0, 1_000_000),
    ),
    missCount: Math.round(
      clamp(source.missCount as number, 0, 1_000_000),
    ),
    finishReason: source.finishReason as GameResult['finishReason'],
  };
}

function registerIpcHandlers(): void {
  ipcMain.handle('pet:get-settings', () => ({ ...currentSettings }));
  ipcMain.handle('pet:get-motion-state', () => ({ ...currentMotion }));
  ipcMain.handle(
    'pet:update-settings',
    async (_event, patch: Partial<PetSettings>) => {
      if (!patch || typeof patch !== 'object') {
        return { ...currentSettings };
      }
      const previous = currentSettings;
      currentSettings = normalizeSettings({ ...currentSettings, ...patch });
      // selectedPetId 只通过宠物管理流程变更。
      currentSettings = {
        ...currentSettings,
        selectedPetId: previous.selectedPetId,
      };
      if (currentSettings.scale !== previous.scale) {
        applyPetScale();
      }
      if (currentSettings.launchAtStartup !== previous.launchAtStartup) {
        const applied = await setLaunchAtStartup(
          currentSettings.launchAtStartup,
        );
        currentSettings = {
          ...currentSettings,
          launchAtStartup: currentSettings.launchAtStartup ? applied : false,
        };
      }
      applyAlwaysOnTop();
      soundSystem?.configure(
        currentSettings.soundEnabled,
        currentSettings.soundVolume,
      );
      updateNightMode();
      rebuildConversationController();
      broadcastSettings();
      persistPreferences();
      if (currentSettings.activityFrequency !== previous.activityFrequency) {
        scheduleNextAutonomousBehavior();
      }
      if (currentSettings.codexHomeOverride !== previous.codexHomeOverride) {
        await refreshPetCatalog();
        broadcastPetCatalog();
      }
      if (currentSettings.updateManifestUrl !== previous.updateManifestUrl) {
        updateService?.configure(currentSettings.updateManifestUrl);
        updateTrayMenu();
      }
      return { ...currentSettings };
    },
  );
  ipcMain.handle('pet:drag-start', (event) =>
    isPetSender(event) ? startDrag() : false,
  );
  ipcMain.handle('pet:drag-end', (event) =>
    isPetSender(event) ? endDrag() : false,
  );
  ipcMain.handle('pet:interact', (event) => {
    if (!isPetSender(event) || dragTimer || physicsTimer) {
      return false;
    }
    return petAction().ok;
  });
  ipcMain.handle('pet:single-click', (event, relativeY: unknown) => {
    if (!isPetSender(event) || dragTimer || physicsTimer) {
      return false;
    }
    const y =
      typeof relativeY === 'number' && Number.isFinite(relativeY)
        ? clamp(relativeY, 0, 1)
        : 0.5;
    return handleSingleClick(y);
  });
  ipcMain.handle('pet:double-click', (event) => {
    if (!isPetSender(event)) {
      return false;
    }
    return handleDoubleClick();
  });
  ipcMain.handle('pet:wheel', (event, deltaY: unknown) => {
    if (!isPetSender(event) || dragTimer || physicsTimer) {
      return false;
    }
    const delta =
      typeof deltaY === 'number' && Number.isFinite(deltaY) ? deltaY : 0;
    return handleWheel(delta);
  });
  ipcMain.handle('pet:context-menu', (event) => {
    if (isPetSender(event)) {
      showPetContextMenu();
    }
  });
  ipcMain.handle('pet:play', () => playWithPetAction());
  ipcMain.handle('pet:sleep', () => petSleep());
  ipcMain.handle('pet:wake', () => petWake());
  ipcMain.handle('pet:rename', (_event, name: unknown) =>
    typeof name === 'string'
      ? renamePet(name)
      : { ok: false, message: '名字无效' },
  );
  ipcMain.handle('pet:cycle-skin', () => cycleSkin());
  ipcMain.handle('pet:toggle-pause', () => togglePauseAction());
  ipcMain.handle('pet:toggle-lock', () => togglePositionLockAction());
  ipcMain.handle('pet:status-summary', () => buildStatusSummary());
  ipcMain.handle('pet:list-displays', () =>
    screen.getAllDisplays().map((display, index) => ({
      id: String(display.id),
      label: `显示器 ${index + 1}（${display.bounds.width}×${display.bounds.height}）`,
    })),
  );
  ipcMain.handle(
    'pet:update-pointer',
    (event, observation: PointerObservation) => {
      if (
        !isPetSender(event)
        || !observation
        || typeof observation.hovering !== 'boolean'
        || typeof observation.relativeX !== 'number'
        || !Number.isFinite(observation.relativeX)
        || typeof observation.relativeY !== 'number'
        || !Number.isFinite(observation.relativeY)
      ) {
        return false;
      }
      const entered = observation.hovering && !pointerHovering;
      pointerHovering = observation.hovering;
      if (!observation.hovering) {
        sendCurrentMotion({ lookFrame: null });
        return true;
      }
      if (
        currentMotion.phase !== 'idle'
        || !['IDLE', 'LOOK_AT_CURSOR'].includes(stateMachine.currentState)
      ) {
        return false;
      }
      if (
        entered
        && stateMachine.currentState === 'IDLE'
        && Math.random() < 0.3
      ) {
        setBehaviorState('LOOK_AT_CURSOR');
      }
      const directionX = (clamp(observation.relativeX, 0, 1) - 0.5) * 2;
      const directionY = (clamp(observation.relativeY, 0, 1) - 0.5) * 2;
      sendCurrentMotion({
        lookFrame: lookFrameIndex(directionX, directionY),
      });
      return true;
    },
  );
  ipcMain.handle(
    'pet:pointer-passthrough',
    (event, ignored: boolean) => {
      if (!isPetSender(event) || !petWindow || petWindow.isDestroyed()) {
        return false;
      }
      if (currentMotion.phase === 'dragging') {
        petWindow.setIgnoreMouseEvents(false);
        return false;
      }
      if (process.platform === 'darwin' || process.platform === 'win32') {
        petWindow.setIgnoreMouseEvents(Boolean(ignored), {
          forward: Boolean(ignored),
        });
        return Boolean(ignored);
      }
      petWindow.setIgnoreMouseEvents(false);
      return false;
    },
  );
  ipcMain.handle('pet:list-pets', () => publicPetCatalog());
  ipcMain.handle('pet:select-pet', (_event, selectionId: unknown) =>
    typeof selectionId === 'string'
      ? selectPet(selectionId)
      : { ok: false, message: '宠物选择 ID 无效' },
  );
  ipcMain.handle('pet:import-pet-folder', async () => {
    if (!petLibrary) {
      return { ok: false, message: '宠物库尚未初始化' };
    }
    const options: Electron.OpenDialogOptions = {
      title: '选择 Codex 宠物目录',
      properties: ['openDirectory'],
    };
    const parent = panelWindows.get('pet-library');
    const result =
      parent && !parent.isDestroyed()
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
    const source = result.filePaths[0];
    if (result.canceled || !source) {
      return { ok: false, message: '已取消导入' };
    }
    try {
      const imported = await petLibrary.importFolder(source);
      await refreshPetCatalog();
      broadcastPetCatalog();
      return selectPet(`codex:${imported.manifest.id}`);
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof PetPackageConflictError
            ? error.message
            : `宠物导入失败：${errorMessage(error)}`,
      };
    }
  });
  ipcMain.handle('pet:sync-codex-pets', async () => {
    if (!petLibrary) {
      return { ok: false, message: '宠物库尚未初始化' };
    }
    const report = await petLibrary.syncFromCodex(
      currentSettings.codexHomeOverride,
    );
    await refreshPetCatalog();
    broadcastPetCatalog();
    return {
      ok: report.conflicts === 0 && report.invalid === 0,
      message: `Codex 同步完成：新增 ${report.imported}，未变化 ${report.unchanged}，冲突 ${report.conflicts}，无效 ${report.invalid}`,
      report,
    };
  });
  ipcMain.handle('pet:export-active-pet', async () => {
    if (!petLibrary || !activePetPackage) {
      return { ok: false, message: '当前没有可导出的宠物' };
    }
    try {
      const report = await petLibrary.exportPackage(
        activePetPackage,
        currentSettings.codexHomeOverride,
      );
      return {
        ok: report.conflicts === 0 && report.invalid === 0,
        message: `导出完成：新增 ${report.imported}，未变化 ${report.unchanged}，冲突 ${report.conflicts}，无效 ${report.invalid}`,
        report,
      };
    } catch (error) {
      return {
        ok: false,
        message: `导出失败：${errorMessage(error)}`,
      };
    }
  });
  ipcMain.handle('panel:open', (_event, page: unknown) => {
    if (typeof page === 'string') {
      openPanel(page as PanelPage);
    }
  });
  ipcMain.on('prompt:submit', (_event, value: unknown) => {
    resolvePrompt(typeof value === 'string' ? value : '');
  });
  ipcMain.on('prompt:cancel', () => {
    resolvePrompt(null);
  });
  ipcMain.handle(
    'assistant:get-reminder-dashboard',
    () => currentReminderDashboard(),
  );
  ipcMain.handle(
    'assistant:update-reminder-preferences',
    (_event, patch: unknown) => {
      if (!reminderEngine) {
        throw new Error('提醒服务尚未初始化');
      }
      const dashboard = reminderEngine.updatePreferences(
        parseReminderPreferencesPatch(patch),
      );
      broadcastReminderDashboard();
      return dashboard;
    },
  );
  ipcMain.handle('assistant:save-reminder', (_event, value: unknown) => {
    if (!reminderEngine) {
      return { ok: false, message: '提醒服务尚未初始化' };
    }
    const input = parseReminderInput(value);
    if (!input) {
      return { ok: false, message: '提醒配置无效' };
    }
    try {
      const reminder = reminderEngine.save(input);
      broadcastReminderDashboard();
      return { ok: true, message: `已保存提醒：${reminder.title}` };
    } catch (error) {
      return {
        ok: false,
        message: `提醒保存失败：${errorMessage(error)}`,
      };
    }
  });
  ipcMain.handle(
    'assistant:delete-reminder',
    (_event, reminderId: unknown) => {
      if (
        !reminderEngine
        || typeof reminderId !== 'string'
        || reminderId.length > 200
      ) {
        return { ok: false, message: '提醒 ID 无效' };
      }
      const deleted = reminderEngine.delete(reminderId);
      if (deleted) {
        broadcastReminderDashboard();
      }
      return deleted
        ? { ok: true, message: '自定义提醒已删除' }
        : { ok: false, message: '内置提醒不可删除或提醒不存在' };
    },
  );
  ipcMain.handle(
    'assistant:snooze-reminder',
    (_event, reminderId: unknown, minutes: unknown) => {
      if (
        !reminderEngine
        || typeof reminderId !== 'string'
        || (
          minutes !== undefined
          && (typeof minutes !== 'number' || !Number.isFinite(minutes))
        )
      ) {
        return { ok: false, message: '稍后提醒参数无效' };
      }
      const snoozed = reminderEngine.snooze(
        reminderId,
        typeof minutes === 'number' ? minutes : undefined,
      );
      if (snoozed) {
        broadcastReminderDashboard();
      }
      return snoozed
        ? { ok: true, message: '已设置稍后提醒' }
        : { ok: false, message: '提醒不存在' };
    },
  );
  ipcMain.handle(
    'assistant:disable-reminder-today',
    (_event, reminderId: unknown) => {
      if (!reminderEngine || typeof reminderId !== 'string') {
        return { ok: false, message: '提醒 ID 无效' };
      }
      const disabled = reminderEngine.disableToday(reminderId);
      if (disabled) {
        broadcastReminderDashboard();
      }
      return disabled
        ? { ok: true, message: '该提醒今天不再出现' }
        : { ok: false, message: '提醒不存在' };
    },
  );
  ipcMain.handle('assistant:test-reminder', () => {
    const preferences = reminderEngine?.dashboard().preferences;
    if (!preferences?.notificationsEnabled) {
      return { ok: false, message: '系统通知当前已关闭' };
    }
    const shown = showSystemNotification(
      '土豆测试提醒',
      '提醒功能工作正常，别忘了保存当前文件。',
    );
    return shown
      ? { ok: true, message: '测试提醒已发送' }
      : { ok: false, message: '当前系统不支持桌面通知' };
  });
  ipcMain.handle('assistant:get-focus-state', () => currentFocusState());
  ipcMain.handle('assistant:start-focus', (_event, minutes: unknown) =>
    typeof minutes === 'number' && Number.isFinite(minutes)
      ? startFocusSession(minutes)
      : { ok: false, message: '专注时长无效' },
  );
  ipcMain.handle('assistant:pause-focus', pauseFocusSession);
  ipcMain.handle('assistant:resume-focus', resumeFocusSession);
  ipcMain.handle('assistant:stop-focus', stopFocusSession);
  ipcMain.handle('growth:get-dashboard', () => currentGrowthDashboard());
  ipcMain.handle('growth:feed', (_event, foodId: unknown) => {
    if (typeof foodId !== 'string' || foodId.length > 80) {
      return { ok: false, message: '喂食参数无效' };
    }
    return feedPetAction(foodId);
  });
  ipcMain.handle('growth:set-sleeping', (_event, sleeping: unknown) => {
    if (typeof sleeping !== 'boolean') {
      return { ok: false, message: '睡眠参数无效' };
    }
    const result = sleeping ? petSleep() : petWake();
    broadcastGrowthDashboard();
    return result;
  });
  ipcMain.handle('growth:claim-task', (_event, taskId: unknown) => {
    if (
      !assistantDatabase
      || typeof taskId !== 'string'
      || taskId.length > 160
    ) {
      return { ok: false, message: '任务 ID 无效' };
    }
    const result = assistantDatabase.claimDailyTask(taskId);
    if (result.ok && !dragTimer && !physicsTimer) {
      setBehaviorState('HAPPY', true);
    }
    broadcastGrowthDashboard();
    return result;
  });
  ipcMain.handle('growth:run-story-event', () => {
    if (!assistantDatabase) {
      return { ok: false, message: '剧情事件服务尚未初始化' };
    }
    const level = assistantDatabase.getPetProfile().level;
    const recent = assistantDatabase.listRecentStoryEventIds(3);
    const event = storyEventSystem.choose(level, recent);
    if (!event) {
      return { ok: false, message: '当前没有可用的剧情事件' };
    }
    startSpecialEvent(event);
    broadcastGrowthDashboard();
    return {
      ok: true,
      message: EVENT_MESSAGES[event.eventId] ?? `${event.name}开始了。`,
      result: {
        event,
        behaviorState: storyEventSystem.behaviorFor(event.eventId),
        reward: null,
        message: EVENT_MESSAGES[event.eventId] ?? '',
      },
    };
  });
  ipcMain.handle('growth:reset', async () => {
    if (!assistantDatabase) {
      return { ok: false, message: '成长服务尚未初始化' };
    }
    const confirmation = await dialog.showMessageBox({
      type: 'question',
      title: '确认重置成长',
      message: '确定重置等级、经验和关系值吗？',
      buttons: ['取消', '重置'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) {
      return { ok: false, message: '已取消重置' };
    }
    assistantDatabase.resetGrowthData();
    broadcastGrowthDashboard();
    return { ok: true, message: '成长数据已重置' };
  });
  ipcMain.handle(
    'content:list-packs',
    (): ContentPackRecord[] => contentPackManager?.list() ?? [],
  );
  ipcMain.handle('content:install-pack', async (event) => {
    if (!isSettingsSender(event) || !contentPackManager) {
      return { ok: false, message: '内容包服务尚未初始化' };
    }
    const parent = panelWindows.get('content-packs') ?? settingsWindow;
    const result = await dialog.showOpenDialog(parent!, {
      title: '安装 ZIP 内容包',
      properties: ['openFile'],
      filters: [{ name: 'Desktop Pet 内容包', extensions: ['zip'] }],
    });
    const source = result.filePaths[0];
    if (result.canceled || !source) {
      return { ok: false, message: '已取消安装' };
    }
    try {
      const manifest = contentPackManager.installArchive(source);
      rebuildConversationController();
      return { ok: true, message: `已安装内容包：${manifest.name}` };
    } catch (error) {
      return { ok: false, message: `内容包安装失败：${errorMessage(error)}` };
    }
  });
  ipcMain.handle(
    'content:set-pack-enabled',
    (event, packId: unknown, enabled: unknown) => {
      if (
        !isSettingsSender(event)
        || !contentPackManager
        || typeof packId !== 'string'
        || typeof enabled !== 'boolean'
      ) {
        return { ok: false, message: '内容包参数无效' };
      }
      const changed = contentPackManager.setEnabled(packId, enabled);
      rebuildConversationController();
      return changed
        ? { ok: true, message: enabled ? '内容包已启用' : '内容包已停用' }
        : { ok: false, message: '内容包不存在' };
    },
  );
  ipcMain.handle('content:uninstall-pack', async (event, packId: unknown) => {
    if (
      !isSettingsSender(event)
      || !contentPackManager
      || typeof packId !== 'string'
    ) {
      return { ok: false, message: '内容包 ID 无效' };
    }
    const parent = panelWindows.get('content-packs') ?? settingsWindow;
    const confirmation = await dialog.showMessageBox(parent!, {
      type: 'warning',
      title: '确认卸载内容包',
      message: '确定卸载这个内容包吗？',
      buttons: ['取消', '卸载'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) {
      return { ok: false, message: '已取消卸载' };
    }
    try {
      const changed = contentPackManager.uninstall(packId);
      rebuildConversationController();
      return changed
        ? { ok: true, message: '内容包已卸载' }
        : { ok: false, message: '内容包不存在' };
    } catch (error) {
      return { ok: false, message: `内容包卸载失败：${errorMessage(error)}` };
    }
  });
  ipcMain.handle('conversation:get-settings', () => currentConversationSettings());
  ipcMain.handle('conversation:update-settings', (event, patch: unknown) => {
    if (
      !isSettingsSender(event)
      || !assistantDatabase
      || !patch
      || typeof patch !== 'object'
    ) {
      throw new Error('对话设置参数无效');
    }
    const current = assistantDatabase.getConversationPreferences();
    const source = patch as Partial<ConversationPreferences>;
    const preferences: ConversationPreferences = {
      mode: source.mode === 'mixed' || source.mode === 'ai'
        ? source.mode
        : source.mode === 'local'
          ? 'local'
          : current.mode,
      endpoint: typeof source.endpoint === 'string'
        ? source.endpoint.trim().slice(0, 500)
        : current.endpoint,
      model: typeof source.model === 'string'
        ? source.model.trim().slice(0, 100)
        : current.model,
      shareMemoriesWithAi: typeof source.shareMemoriesWithAi === 'boolean'
        ? source.shareMemoriesWithAi
        : current.shareMemoriesWithAi,
    };
    assistantDatabase.saveConversationPreferences(preferences);
    rebuildConversationController();
    return currentConversationSettings();
  });
  ipcMain.handle('conversation:set-secret', (event, secret: unknown) => {
    if (
      !isSettingsSender(event)
      || !credentialStore
      || typeof secret !== 'string'
      || secret.length > 10_000
    ) {
      return { ok: false, message: '在线对话密钥无效' };
    }
    try {
      credentialStore.setSecret(secret);
      rebuildConversationController();
      return { ok: true, message: '在线对话密钥已保存到系统加密存储' };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  });
  ipcMain.handle('conversation:delete-secret', (event) => {
    if (!isSettingsSender(event) || !credentialStore) {
      return { ok: false, message: '密钥存储尚未初始化' };
    }
    credentialStore.deleteSecret();
    rebuildConversationController();
    return { ok: true, message: '在线对话密钥已删除' };
  });
  ipcMain.handle('conversation:send', async (event, text: unknown) => {
    if (
      !isSettingsSender(event)
      || !conversationController
      || typeof text !== 'string'
      || text.length > 500
    ) {
      throw new Error('对话内容无效');
    }
    const response = await conversationController.send(text);
    if (response.memoryCandidate && memoryService) {
      const proposed = memoryService.propose(
        response.memoryCandidate.memoryType,
        response.memoryCandidate.content,
      );
      if (!proposed.ok) {
        return {
          ...response,
          text: proposed.message,
          memoryCandidate: null,
        };
      }
      // 长期记忆必须用户确认，对应基准 _handle_conversation_response。
      const parent = panelWindows.get('conversation') ?? settingsWindow;
      const confirmation = await dialog.showMessageBox(parent!, {
        type: 'question',
        title: '确认长期记忆',
        message: '是否允许我长期记住这条信息？',
        detail: response.memoryCandidate.content,
        buttons: ['否', '是'],
        defaultId: 1,
        cancelId: 0,
      });
      if (confirmation.response === 1) {
        try {
          memoryService.confirm();
          rebuildConversationController();
          broadcastGrowthDashboard();
        } catch {
          memoryService.reject();
        }
      } else {
        memoryService.reject();
      }
    }
    if (response.commandName === 'start_focus') {
      const minutes = Number(response.commandArguments.minutes);
      if (Number.isFinite(minutes)) {
        startFocusSession(minutes);
        openPanel('focus');
      }
    } else if (response.commandName === 'show_reminders') {
      openPanel('focus');
    } else if (response.commandName === 'show_inventory') {
      openPanel('inventory');
    } else if (response.commandName === 'show_growth') {
      openPanel('growth');
    }
    return response;
  });
  ipcMain.handle('conversation:clear', (event) => {
    if (isSettingsSender(event)) conversationController?.clearHistory();
  });
  ipcMain.handle('memory:get-pending', () => memoryService?.pendingCandidate() ?? null);
  ipcMain.handle('memory:confirm', (event) => {
    if (!isSettingsSender(event) || !memoryService) {
      return { ok: false, message: '记忆服务尚未初始化' };
    }
    try {
      const memory = memoryService.confirm();
      rebuildConversationController();
      broadcastGrowthDashboard();
      if (!dragTimer && !physicsTimer) setBehaviorState('HAPPY', true);
      return { ok: true, message: `已记住：${memory.content}` };
    } catch (error) {
      return { ok: false, message: errorMessage(error) };
    }
  });
  ipcMain.handle('memory:reject', (event) => {
    if (isSettingsSender(event)) memoryService?.reject();
  });
  ipcMain.handle('memory:list', () => memoryService?.list() ?? []);
  ipcMain.handle('memory:update', (event, memoryId: unknown, content: unknown) => {
    if (
      !isSettingsSender(event)
      || !memoryService
      || typeof memoryId !== 'number'
      || !Number.isInteger(memoryId)
      || typeof content !== 'string'
    ) {
      return { ok: false, message: '记忆更新参数无效' };
    }
    const result = memoryService.update(memoryId, content);
    rebuildConversationController();
    return result;
  });
  ipcMain.handle('memory:delete', (event, memoryId: unknown) => {
    if (
      !isSettingsSender(event)
      || !memoryService
      || typeof memoryId !== 'number'
      || !Number.isInteger(memoryId)
    ) {
      return { ok: false, message: '记忆 ID 无效' };
    }
    const deleted = memoryService.delete(memoryId);
    rebuildConversationController();
    return deleted
      ? { ok: true, message: '长期记忆已删除' }
      : { ok: false, message: '长期记忆不存在' };
  });
  ipcMain.handle('memory:clear', async (event) => {
    if (!isSettingsSender(event) || !memoryService) {
      return { ok: false, message: '记忆服务尚未初始化' };
    }
    const parent = panelWindows.get('memory') ?? settingsWindow;
    const confirmation = await dialog.showMessageBox(parent!, {
      type: 'warning',
      title: '确认清空长期记忆',
      message: '确定清空全部长期记忆吗？此操作无法撤销。',
      buttons: ['取消', '清空'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) {
      return { ok: false, message: '已取消清空' };
    }
    const count = memoryService.clear();
    rebuildConversationController();
    return { ok: true, message: `已清空 ${count} 条长期记忆` };
  });
  ipcMain.handle('data:export', async (event) => {
    if (!isSettingsSender(event) || !assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const parent = panelWindows.get('privacy') ?? settingsWindow;
    const result = await dialog.showSaveDialog(parent!, {
      title: '导出个人数据',
      defaultPath: path.join(app.getPath('documents'), 'desktop-pet-data.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: '已取消导出' };
    }
    try {
      assistantDatabase.exportPersonalData(result.filePath);
      return { ok: true, message: '个人数据已导出' };
    } catch (error) {
      return { ok: false, message: `导出失败：${errorMessage(error)}` };
    }
  });
  ipcMain.handle('data:import', async (event) => {
    if (!isSettingsSender(event) || !assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const parent = panelWindows.get('privacy') ?? settingsWindow;
    const selected = await dialog.showOpenDialog(parent!, {
      title: '导入个人数据',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    const source = selected.filePaths[0];
    if (selected.canceled || !source) {
      return { ok: false, message: '已取消导入' };
    }
    const result = assistantDatabase.importPersonalData(source);
    if (result.ok) {
      rebuildConversationController();
      broadcastGrowthDashboard();
    }
    return result;
  });
  ipcMain.handle('data:backup', async (event) => {
    if (!isSettingsSender(event) || !assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const parent = panelWindows.get('privacy') ?? settingsWindow;
    const result = await dialog.showSaveDialog(parent!, {
      title: '备份 Desktop Pet 数据库',
      defaultPath: path.join(app.getPath('documents'), 'desktop-pet-backup.db'),
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: '已取消备份' };
    }
    try {
      await assistantDatabase.backupDatabase(result.filePath);
      return { ok: true, message: '数据库一致性备份已完成' };
    } catch (error) {
      return { ok: false, message: `备份失败：${errorMessage(error)}` };
    }
  });
  ipcMain.handle('data:restore', async (event) => {
    if (!isSettingsSender(event) || !assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const parent = panelWindows.get('privacy') ?? settingsWindow;
    const selected = await dialog.showOpenDialog(parent!, {
      title: '选择 Desktop Pet 数据库备份',
      properties: ['openFile'],
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }],
    });
    const source = selected.filePaths[0];
    if (selected.canceled || !source) {
      return { ok: false, message: '已取消恢复' };
    }
    const confirmation = await dialog.showMessageBox(parent!, {
      type: 'warning',
      title: '确认恢复数据库',
      message: '恢复会替换当前业务数据，程序会先保留自动回滚副本。',
      buttons: ['取消', '恢复'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) {
      return { ok: false, message: '已取消恢复' };
    }
    try {
      focusTimer?.stop();
      await assistantDatabase.restoreDatabase(source);
      reminderEngine = new ReminderEngine(assistantDatabase);
      reminderEngine.ensureDefaults();
      focusTimer = new FocusTimer(assistantDatabase);
      focusTimer.initialize();
      memoryService = new MemoryService(assistantDatabase);
      contentPackManager = new ContentPackManager(
        path.join(app.getPath('userData'), 'content_packs'),
        assistantDatabase,
        new ContentPackValidator(app.getVersion()),
      );
      rebuildConversationController();
      broadcastAllAssistantState();
      return { ok: true, message: '数据库恢复完成' };
    } catch (error) {
      return { ok: false, message: `恢复失败：${errorMessage(error)}` };
    }
  });
  ipcMain.handle('data:export-save', async () => {
    if (!assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const result = await dialog.showSaveDialog({
      title: '导出宠物存档',
      defaultPath: path.join(
        app.getPath('home'),
        'DesktopPet-save.json',
      ),
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: '已取消导出' };
    }
    try {
      const payload = {
        pet_state: assistantDatabase.exportArchive(),
        settings: { ...currentSettings },
        position: { ...currentPosition },
        exported_at: new Date().toISOString(),
      };
      fs.writeFileSync(
        result.filePath,
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf8',
      );
      return { ok: true, message: '宠物存档已安全导出' };
    } catch (error) {
      return { ok: false, message: `导出存档失败：${errorMessage(error)}` };
    }
  });
  ipcMain.handle('data:import-save', async () => {
    if (!assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const selected = await dialog.showOpenDialog({
      title: '导入宠物存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
    });
    const source = selected.filePaths[0];
    if (selected.canceled || !source) {
      return { ok: false, message: '已取消导入' };
    }
    try {
      const payload = JSON.parse(fs.readFileSync(source, 'utf8')) as {
        pet_state?: unknown;
        settings?: unknown;
        position?: unknown;
      };
      const result = assistantDatabase.importArchive(payload.pet_state);
      if (!result.ok) {
        return result;
      }
      if (payload.settings && typeof payload.settings === 'object') {
        currentSettings = normalizeSettings({
          ...DEFAULT_PET_SETTINGS,
          ...(payload.settings as Partial<PetSettings>),
        });
      }
      if (payload.position && typeof payload.position === 'object') {
        currentPosition = {
          ...DEFAULT_PET_POSITION,
          ...(payload.position as Partial<typeof currentPosition>),
        };
      }
      rebuildConversationController();
      applyAlwaysOnTop();
      applyPetScale();
      broadcastSettings();
      broadcastAllAssistantState();
      persistPreferences();
      ensurePetVisible();
      return { ok: true, message: '宠物存档已恢复' };
    } catch (error) {
      return { ok: false, message: `导入存档失败：${errorMessage(error)}` };
    }
  });
  ipcMain.handle('data:clear-save', async () => {
    if (!assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const confirmation = await dialog.showMessageBox({
      type: 'question',
      title: '确认清除存档',
      message: '这会重置宠物成长、属性和所有设置。是否继续？',
      buttons: ['取消', '清除'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) {
      return { ok: false, message: '已取消清除' };
    }
    assistantDatabase.clearAllPersonalData();
    currentSettings = normalizeSettings({ ...DEFAULT_PET_SETTINGS });
    currentPosition = { ...DEFAULT_PET_POSITION };
    rebuildConversationController();
    applyAlwaysOnTop();
    applyPetScale();
    if (petWindow && !petWindow.isDestroyed()) {
      stopMotion();
      placeAtDefaultPosition(petWindow);
    }
    broadcastSettings();
    broadcastAllAssistantState();
    persistPreferences();
    return { ok: true, message: '存档已清除并恢复默认' };
  });
  ipcMain.handle('data:delete-all', async () => {
    if (!assistantDatabase) {
      return { ok: false, message: '数据服务尚未初始化' };
    }
    const confirmation = await dialog.showMessageBox({
      type: 'warning',
      title: '确认删除全部数据',
      message:
        '这会删除长期记忆、成长、任务、成就、专注记录和内容包。是否继续？',
      buttons: ['取消', '删除'],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirmation.response !== 1) {
      return { ok: false, message: '已取消删除' };
    }
    for (const pack of contentPackManager?.list() ?? []) {
      contentPackManager?.uninstall(pack.packId);
    }
    assistantDatabase.clearAllPersonalData();
    conversationController?.clearHistory();
    credentialStore?.deleteSecret();
    reminderEngine = new ReminderEngine(assistantDatabase);
    reminderEngine.ensureDefaults();
    rebuildConversationController();
    broadcastAllAssistantState();
    return { ok: true, message: '全部数据已重置' };
  });
  ipcMain.handle('update:get-status', (event) =>
    isSettingsSender(event)
      ? updateService?.status() ?? {
          state: 'error' as const,
          currentVersion: app.getVersion(),
          latestVersion: null,
          message: '更新服务尚未初始化',
          manifestUrl: '',
          releaseUrl: null,
          artifactUrl: null,
          checkedAt: null,
        }
      : {
          state: 'error' as const,
          currentVersion: app.getVersion(),
          latestVersion: null,
          message: '更新请求来源无效',
          manifestUrl: '',
          releaseUrl: null,
          artifactUrl: null,
          checkedAt: null,
        },
  );
  ipcMain.handle('update:check', (event) =>
    isSettingsSender(event)
      ? checkForUpdates(false)
      : Promise.resolve({
          state: 'error' as const,
          currentVersion: app.getVersion(),
          latestVersion: null,
          message: '更新请求来源无效',
          manifestUrl: '',
          releaseUrl: null,
          artifactUrl: null,
          checkedAt: new Date().toISOString(),
        }),
  );
  ipcMain.handle('update:open-download', (event) =>
    isSettingsSender(event)
      ? openUpdateDownload()
      : { ok: false, message: '更新请求来源无效' },
  );
  ipcMain.handle('game:open', (_event, gameId: unknown, difficulty: unknown) =>
    GAME_IDS.includes(gameId as GameId)
      ? openGameWindow(
        gameId as GameId,
        GAME_DIFFICULTIES.includes(difficulty as GameDifficulty)
          ? (difficulty as GameDifficulty)
          : 'standard',
      )
      : { ok: false, message: '小游戏 ID 无效' },
  );
  ipcMain.handle('game:get-active', () => activeGameId);
  ipcMain.handle('game:get-setup', (event) => {
    if (!isGameSender(event)) {
      return null;
    }
    return {
      gameId: activeGameId,
      difficulty: activeGameDifficulty,
      petName: petName(),
      catchFoodConfig: gameConfigs.catchFood,
      dodgeMouseConfig: gameConfigs.dodgeMouse,
      effectSettings: {
        targetFps: currentSettings.gameTargetFps,
        effectLevel: currentSettings.gameEffectLevel,
        particlesEnabled: currentSettings.particlesEnabled,
        shadowsEnabled: currentSettings.shadowsEnabled,
        trailsEnabled: currentSettings.trailsEnabled,
        autoPauseGames: currentSettings.autoPauseGames,
        lowPowerMode: currentSettings.lowPowerMode,
      },
    };
  });
  ipcMain.handle('game:get-records', () => currentGameRecords());
  ipcMain.handle('game:finish', (event, value: unknown) => {
    if (!isGameSender(event) || !assistantDatabase) {
      return { ok: false, message: '小游戏会话无效' };
    }
    const result = parseGameResult(value);
    if (!result || result.gameId !== activeGameId) {
      return { ok: false, message: '小游戏结果无效' };
    }
    try {
      const completion = assistantDatabase.recordGameResult(result);
      if (result.finishReason === 'completed') {
        soundSystem?.play('game_score');
        setTemporaryEmotion('happy', 4);
        say(
          'happy',
          `小游戏结束，得到 ${result.score} 分！`,
          { emotion: 'happy' },
        );
      } else {
        say('idle', '小游戏先存档，下次继续挑战。');
      }
      broadcastGameRecords();
      broadcastGrowthDashboard();
      return {
        ok: true,
        message: result.finishReason === 'completed'
          ? `游戏完成，得分 ${result.score}`
          : '游戏已结束',
        ...completion,
      };
    } catch (error) {
      return {
        ok: false,
        message: `游戏记录保存失败：${errorMessage(error)}`,
      };
    }
  });
  ipcMain.handle('game:close', (event) => {
    if (isGameSender(event)) {
      closeGameWindow();
    }
  });
  ipcMain.on('game:phase-changed', (event, pausedState: unknown) => {
    if (
      gameWindow
      && !gameWindow.isDestroyed()
      && event.sender.id === gameWindow.webContents.id
    ) {
      gamePaused = pausedState === 'paused';
      updateTrayMenu();
    }
  });
  ipcMain.handle('pet:open-settings', () => {
    showSettingsWindow();
  });
  ipcMain.handle('pet:reset-position', () => {
    if (petWindow && !petWindow.isDestroyed()) {
      stopMotion();
      placeAtDefaultPosition(petWindow);
      updateCurrentPosition();
      persistPreferences();
      showPetWindow();
    }
  });
  ipcMain.handle('pet:quit', () => {
    requestAppQuit();
  });
}

async function checkForUpdates(interactive = false) {
  const status = updateService
    ? await updateService.check()
    : {
        state: 'error' as const,
        currentVersion: app.getVersion(),
        latestVersion: null,
        message: '更新服务尚未初始化',
        manifestUrl: '',
        releaseUrl: null,
        artifactUrl: null,
        checkedAt: new Date().toISOString(),
      };
  updateTrayMenu();
  if (interactive) {
    const canOpen = status.state === 'available' && Boolean(
      status.artifactUrl || status.releaseUrl,
    );
    const response = await dialog.showMessageBox({
      type: status.state === 'error' ? 'warning' : 'info',
      title: 'Desktop Pet 更新',
      message: status.message,
      detail: `当前版本：v${status.currentVersion}`,
      buttons: canOpen ? ['关闭', '打开下载页'] : ['关闭'],
      defaultId: canOpen ? 1 : 0,
      cancelId: 0,
    });
    if (canOpen && response.response === 1) {
      await openUpdateDownload();
    }
  }
  return status;
}

async function openUpdateDownload() {
  const status = updateService?.status();
  const target = status?.artifactUrl ?? status?.releaseUrl;
  if (status?.state !== 'available' || !target) {
    return { ok: false, message: '当前没有可下载的新版本' };
  }
  try {
    await shell.openExternal(target);
    return { ok: true, message: '已在浏览器打开新版本下载地址' };
  } catch (error) {
    return { ok: false, message: `无法打开下载地址：${errorMessage(error)}` };
  }
}

/* ------------------------------ 生命周期 ------------------------------ */

function handleDisplayConfigurationChanged(): void {
  setTimeout(() => {
    ensurePetVisible();
  }, 150);
}

function requestAppQuit(): void {
  allowQuit = true;
  app.quit();
}

function prepareForQuit(): void {
  if (assistantClosed) {
    return;
  }
  assistantClosed = true;
  if (positionSaveTimer) {
    clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
  updateCurrentPosition();
  persistPreferences();
  stopAssistantLoop();
  focusTimer?.stop();
  focusTimer = null;
  reminderEngine = null;
  conversationController?.clearHistory();
  conversationController = null;
  memoryService?.reject();
  memoryService = null;
  contentPackManager = null;
  credentialStore = null;
  updateService = null;
  assistantDatabase?.close();
  assistantDatabase = null;
  stopBehaviorLoop();
  stopMotion();
  speechBubble?.close();
  speechBubble = null;
  for (const notification of activeNotifications) {
    notification.close();
  }
  activeNotifications.clear();
  tray?.destroy();
  tray = null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showPetWindow();
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.husu.desktoppet.v2');
    loadRuntimeData();
    preferencesStore = new PreferencesStore(
      path.join(app.getPath('userData'), 'preferences.json'),
    );
    const preferences = preferencesStore.load();
    currentSettings = preferences.settings;
    currentPosition = preferences.position;
    soundSystem = new SoundSystem(
      app.isPackaged
        ? path.join(process.resourcesPath, 'sounds')
        : path.join(app.getAppPath(), 'build', 'sounds'),
    );
    soundSystem.configure(
      currentSettings.soundEnabled,
      currentSettings.soundVolume,
    );
    updateService = new UpdateService(
      app.getVersion(),
      currentSettings.updateManifestUrl,
      process.platform,
      process.arch,
      (input, init) => net.fetch(input, init),
    );
    await initializePetContent();
    initializeAssistant();
    if (currentSettings.launchAtStartup) {
      currentSettings = {
        ...currentSettings,
        launchAtStartup: await setLaunchAtStartup(true),
      };
      persistPreferences();
    }
    registerIpcHandlers();
    speechBubble = new SpeechBubbleController(
      (window, page) => loadRenderer(window, page),
    );
    speechBubble.setAlwaysOnTop(currentSettings.alwaysOnTop);
    updateNightMode();
    petWindow = createPetWindow();
    createTray();
    startBehaviorLoop();
    startAssistantLoop();
    // 节日彩蛋，对应基准 start()（欢迎语已移至窗口显示后）。
    const holiday = storyEventSystem.todayHoliday(holidays);
    if (holiday) {
      setTimeout(() => {
        const event = storyEventSystem.find('holiday');
        if (event) {
          startSpecialEvent(event, { message: holiday.message });
        }
      }, 2_600);
    }
    screen.on('display-added', handleDisplayConfigurationChanged);
    screen.on('display-removed', handleDisplayConfigurationChanged);
    screen.on('display-metrics-changed', handleDisplayConfigurationChanged);
  });

  app.on('activate', () => {
    showPetWindow();
  });

  app.on('before-quit', () => {
    if (!allowQuit) {
      return;
    }
    prepareForQuit();
  });

  app.on('will-quit', () => {
    prepareForQuit();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function randomBetween(minimum: number, maximum: number): number {
  return minimum + Math.random() * Math.max(0, maximum - minimum);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
