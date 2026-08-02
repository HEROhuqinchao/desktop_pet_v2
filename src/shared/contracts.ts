export const PET_CELL_WIDTH = 192;
export const PET_CELL_HEIGHT = 208;

export type MotionPhase = 'idle' | 'dragging' | 'thrown' | 'landed';

export const PET_BEHAVIOR_STATES = [
  'IDLE',
  'BLINK',
  'WALK_LEFT',
  'WALK_RIGHT',
  'RUN_LEFT',
  'RUN_RIGHT',
  'JUMP',
  'FALL',
  'LAND',
  'THROWN',
  'HUNGRY',
  'YAWN',
  'PREPARE_SLEEP',
  'SLEEP',
  'WAKE_UP',
  'EAT',
  'PLAY',
  'DRAGGED',
  'ANGRY',
  'HAPPY',
  'SAD',
  'SCARED',
  'DIZZY',
  'CURIOUS',
  'HIDE',
  'CLIMB',
  'LOOK_AT_CURSOR',
  'CHASE_CURSOR',
  'SPECIAL_ACTION',
  'SPECIAL_EVENT',
] as const;

export type PetBehaviorState = (typeof PET_BEHAVIOR_STATES)[number];

export interface PetAnimationCue {
  id: number;
  action: string;
}

export interface PetActionFrame {
  row: number;
  column: number;
  durationMs: number;
}

export interface PetActionDefinition {
  loop: boolean;
  frames: PetActionFrame[];
}

/**
 * desktop_pet_v2 的可选扩展动作清单。基础 spritesheet 仍保持 Codex v1/v2
 * 契约；该清单只描述项目专属动作旁车，缺失时运行时自动回退到基础图集。
 */
export interface PetActionManifest {
  formatVersion: 1;
  cellWidth: typeof PET_CELL_WIDTH;
  cellHeight: typeof PET_CELL_HEIGHT;
  atlasPath: string;
  columns: number;
  rows: number;
  animations: Record<string, PetActionDefinition>;
  stateMap: Partial<Record<PetBehaviorState, string>>;
}

export interface MotionState {
  phase: MotionPhase;
  behaviorState: PetBehaviorState;
  velocityX: number;
  velocityY: number;
  lookFrame: number | null;
  animationCue?: PetAnimationCue | null;
  overlay: PetOverlayState;
}

/**
 * 宠物窗口覆盖物状态，对应 desktop_pet PetRenderer 的状态特效与事件特效
 * （睡眠 Z、怒气、爱心、食物道具、饥饿思想泡、脏点与 10 种随机事件视觉）。
 */
export interface PetOverlayState {
  emotion: string;
  activeEvent: string | null;
  eventVariant: string | null;
  activeFood: string | null;
  hungerLow: boolean;
  cleanlinessLow: boolean;
  sleeping: boolean;
}

export interface PetSettings {
  scale: number;
  alwaysOnTop: boolean;
  autoMove: boolean;
  chaseCursor: boolean;
  allowThrowing: boolean;
  activityFrequency: number;
  launchAtStartup: boolean;
  selectedPetId: string;
  codexHomeOverride: string;
  updateManifestUrl: string;
  /** 以下字段与 desktop_pet PetSettings 一一对应（对话/提醒相关项除外，
   * 它们沿用 V2 现有的 assistant.db 存储）。 */
  soundEnabled: boolean;
  soundVolume: number;
  desktopEffects: boolean;
  showStatusReminders: boolean;
  lowPowerMode: boolean;
  particlesEnabled: boolean;
  shadowsEnabled: boolean;
  trailsEnabled: boolean;
  autoPauseGames: boolean;
  quietNightMode: boolean;
  autoSleep: boolean;
  bubbleEnabled: boolean;
  dialogueFrequency: number;
  gameTargetFps: number;
  gameEffectLevel: number;
  preferredScreen: string;
  personalityId: string;
  anonymousAnalytics: boolean;
  appIcon?: 'icon1' | 'icon2' | 'icon3' | 'pet';
}

export interface PetPosition {
  displayId: string;
  xRatio: number;
  yRatio: number;
  valid: boolean;
}

export interface PetPreferences {
  schemaVersion: 1;
  settings: PetSettings;
  position: PetPosition;
}

export interface PointerObservation {
  hovering: boolean;
  relativeX: number;
  relativeY: number;
}

export type PetSource = 'bundled' | 'library' | 'codex';

export interface PetCatalogEntry {
  selectionId: string;
  petId: string;
  displayName: string;
  description: string;
  spriteVersionNumber: 1 | 2;
  actionManifest: PetActionManifest | null;
  source: PetSource;
  contentHash: string;
  active: boolean;
}

export interface PetSyncItem {
  petId: string;
  status: 'imported' | 'exported' | 'unchanged' | 'conflict' | 'invalid';
  detail: string;
}

export interface PetSyncReport {
  imported: number;
  unchanged: number;
  conflicts: number;
  invalid: number;
  items: PetSyncItem[];
}

export interface PetOperationResult {
  ok: boolean;
  message: string;
  report?: PetSyncReport;
}

export const REMINDER_TYPES = [
  'water',
  'sedentary',
  'rest',
  'meal',
  'save-work',
  'tidy-up',
  'custom',
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];
export type ReminderScheduleType = 'interval' | 'daily';

export interface ReminderRecord {
  reminderId: string;
  reminderType: ReminderType;
  title: string;
  scheduleType: ReminderScheduleType;
  intervalMinutes: number;
  dailyTimes: string[];
  enabled: boolean;
  workdaysOnly: boolean;
  nextDueAt: string;
  snoozedUntil: string | null;
  disabledDate: string | null;
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderInput {
  reminderId?: string;
  reminderType: ReminderType;
  title: string;
  scheduleType: ReminderScheduleType;
  intervalMinutes: number;
  dailyTimes: string[];
  enabled: boolean;
  workdaysOnly: boolean;
}

export interface ReminderPreferences {
  enabled: boolean;
  notificationsEnabled: boolean;
  workdaysOnly: boolean;
  quietStart: string;
  quietEnd: string;
  defaultSnoozeMinutes: number;
  shutdownChecklistEnabled: boolean;
  shutdownChecklistItems: string[];
}

export interface ReminderDashboard {
  reminders: ReminderRecord[];
  preferences: ReminderPreferences;
  nextReminderAt: string | null;
}

export type FocusStatus = 'idle' | 'running' | 'paused';

export interface FocusState {
  status: FocusStatus;
  sessionId: string | null;
  plannedSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  completedCount: number;
}

export const GAME_IDS = ['catch_food', 'dodge_mouse'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const GAME_DIFFICULTIES = ['easy', 'standard', 'challenge'] as const;
export type GameDifficulty = (typeof GAME_DIFFICULTIES)[number];
export type GameFinishReason =
  | 'completed'
  | 'cancelled'
  | 'window-closed';

export interface GameResult {
  gameId: GameId;
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  durationSeconds: number;
  maxCombo: number;
  accuracy: number;
  caughtCount: number;
  droppedCount: number;
  hitCount: number;
  missCount: number;
  finishReason: GameFinishReason;
}

export interface GameRewards {
  experience: number;
  affection: number;
  hunger: number;
  mood: number;
  energy: number;
}

export interface GameRecord {
  gameId: GameId;
  highScore: number;
  playCount: number;
  bestCombo: number;
  bestGrade: GameResult['grade'];
  bestAccuracy: number;
  updatedAt: string;
}

export interface GameCompletionResult extends PetOperationResult {
  rewards?: GameRewards;
  record?: GameRecord;
}

export interface PetAttributes {
  hunger: number;
  energy: number;
  mood: number;
  affection: number;
  cleanliness: number;
  curiosity: number;
}

export interface PetProfile {
  name: string;
  level: number;
  experience: number;
  totalExperience: number;
  relationship: number;
  affectionLevel: number;
  attributes: PetAttributes;
  unlockedActions: string[];
  titles: string[];
  sleeping: boolean;
  lastAttributeAt: string;
  updatedAt: string;
}

export interface GrowthChange {
  profile: PetProfile;
  levelsGained: number;
  experienceAdded: number;
  relationshipAdded: number;
  unlocked: string[];
}

export type InventoryItemType =
  | 'food'
  | 'toy'
  | 'skin'
  | 'decoration'
  | 'legacy';

export interface InventoryItem {
  itemId: string;
  itemType: InventoryItemType;
  displayName: string;
  quantity: number;
  metadata: Record<string, unknown>;
}

export interface PetCareResult extends PetOperationResult {
  profile?: PetProfile;
  item?: InventoryItem;
  cooldownRemaining?: number;
}

export const PET_PROGRESS_TYPES = [
  'interaction',
  'feed',
  'game',
  'game_score',
  'focus',
  'memory',
] as const;

export type PetProgressType = (typeof PET_PROGRESS_TYPES)[number];

export interface DailyTaskRecord {
  taskId: string;
  taskDate: string;
  title: string;
  eventType: PetProgressType;
  target: number;
  progress: number;
  rewardExperience: number;
  rewardRelationship: number;
  challenge: boolean;
  claimed: boolean;
}

export interface AchievementRecord {
  achievementId: string;
  name: string;
  description: string;
  unlockedAt: string | null;
}

export interface GrowthDashboard {
  profile: PetProfile;
  consecutiveDays: number;
  tasks: DailyTaskRecord[];
  achievements: AchievementRecord[];
  inventory: InventoryItem[];
}

export interface PetProgressResult {
  dashboard: GrowthDashboard;
  unlockedAchievements: AchievementRecord[];
}

export interface ContentPackManifest {
  packId: string;
  name: string;
  version: string;
  formatVersion: 1;
  appMinVersion: string;
  description: string;
}

export interface ContentPackRecord extends ContentPackManifest {
  enabled: boolean;
  installedAt: string;
}

export const MEMORY_TYPES = [
  'USER_NAME',
  'USER_PREFERENCE',
  'USER_ROUTINE',
  'SHARED_MILESTONE',
  'USER_NOTE',
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryCandidate {
  memoryType: MemoryType;
  content: string;
}

export interface MemoryRecord extends MemoryCandidate {
  memoryId: number;
  createdAt: string;
  updatedAt: string;
}

export type ConversationMode = 'local' | 'mixed' | 'ai';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationRequest {
  messages: ConversationMessage[];
  systemPrompt: string;
  timeoutSeconds: number;
}

export interface ConversationResponse {
  text: string;
  commandName: string | null;
  commandArguments: Record<string, unknown>;
  memoryCandidate: MemoryCandidate | null;
  providerName: string;
  fallbackUsed: boolean;
}

export interface ConversationPreferences {
  mode: ConversationMode;
  endpoint: string;
  model: string;
  shareMemoriesWithAi: boolean;
}

export interface ConversationSettings extends ConversationPreferences {
  hasSecret: boolean;
  secureStorageAvailable: boolean;
}

export interface StoryEventDefinition {
  eventId: string;
  name: string;
  minimumLevel: number;
  weight: number;
  durationSeconds: number;
}

export type TreasureReward =
  | { kind: 'item'; itemId: string; name: string; amount: number }
  | { kind: 'experience'; name: string; amount: number }
  | { kind: 'title'; name: string; amount: number }
  | { kind: 'empty'; name: string; amount: 0 };

export interface StoryEventResult {
  event: StoryEventDefinition;
  behaviorState: PetBehaviorState;
  reward: TreasureReward | null;
  message: string;
}

export interface StoryEventOperationResult extends PetOperationResult {
  result?: StoryEventResult;
}

/**
 * 独立面板页面，对应 desktop_pet 的 9 个子窗口
 * （ui/status_panel.py、inventory_window.py、growth_window.py、focus_window.py、
 * conversation_window.py、memory_window.py、privacy_window.py、
 * content_pack_window.py、pet_library_window.py）。
 */
export const PANEL_PAGES = [
  'status',
  'inventory',
  'growth',
  'focus',
  'conversation',
  'memory',
  'privacy',
  'content-packs',
  'pet-library',
  'prompt',
] as const;

export type PanelPage = (typeof PANEL_PAGES)[number];

/** 状态面板数据，对应 desktop_pet StatusPanel.refresh。 */
export interface PetStatusSummary {
  name: string;
  level: number;
  stateLabel: string;
  interactionCountToday: number;
  attributes: PetAttributes;
  sleeping: boolean;
}

/** 气泡消息（main → 气泡窗口）。 */
export interface SpeechPayload {
  text: string;
  emotion: string;
  durationMs: number;
}

/** 气泡渲染载荷（含夜间模式）。 */
export interface SpeechShowPayload {
  text: string;
  emotion: string;
  nightMode: boolean;
}

/** 小游戏启动配置（main → 游戏窗口），对应基准 GameContext。 */
export interface GameSetupPayload {
  gameId: GameId;
  difficulty: GameDifficulty;
  petName: string;
  catchFoodConfig: unknown;
  dodgeMouseConfig: unknown;
  effectSettings: {
    targetFps: number;
    effectLevel: number;
    particlesEnabled: boolean;
    shadowsEnabled: boolean;
    trailsEnabled: boolean;
    autoPauseGames: boolean;
    lowPowerMode: boolean;
  };
}

/** 显示器条目（设置窗口"默认显示器"下拉）。 */
export interface DisplayEntry {
  id: string;
  label: string;
}

export interface UpdateArtifact {
  platform: 'darwin' | 'win32' | 'linux';
  arch: string;
  fileName: string;
  size: number;
  sha256: string;
  signed: boolean;
  url: string;
}

export interface UpdateManifest {
  schemaVersion: 1;
  version: string;
  publishedAt: string;
  releaseUrl: string;
  notes: string;
  artifacts: UpdateArtifact[];
}

export type UpdateState =
  | 'unconfigured'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'error';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string;
  latestVersion: string | null;
  message: string;
  manifestUrl: string;
  releaseUrl: string | null;
  artifactUrl: string | null;
  checkedAt: string | null;
}

export interface DesktopPetApi {
  getSettings: () => Promise<PetSettings>;
  getMotionState: () => Promise<MotionState>;
  updateSettings: (patch: Partial<PetSettings>) => Promise<PetSettings>;
  beginDrag: () => Promise<boolean>;
  endDrag: () => Promise<boolean>;
  interact: () => Promise<boolean>;
  updatePointer: (observation: PointerObservation) => Promise<boolean>;
  setPointerPassthrough: (ignored: boolean) => Promise<boolean>;
  listPets: () => Promise<PetCatalogEntry[]>;
  selectPet: (selectionId: string) => Promise<PetOperationResult>;
  importPetFolder: () => Promise<PetOperationResult>;
  syncCodexPets: () => Promise<PetOperationResult>;
  exportActivePetToCodex: () => Promise<PetOperationResult>;
  getReminderDashboard: () => Promise<ReminderDashboard>;
  updateReminderPreferences: (
    patch: Partial<ReminderPreferences>,
  ) => Promise<ReminderDashboard>;
  saveReminder: (
    input: ReminderInput,
  ) => Promise<PetOperationResult>;
  deleteReminder: (reminderId: string) => Promise<PetOperationResult>;
  snoozeReminder: (
    reminderId: string,
    minutes?: number,
  ) => Promise<PetOperationResult>;
  disableReminderToday: (
    reminderId: string,
  ) => Promise<PetOperationResult>;
  sendTestReminder: () => Promise<PetOperationResult>;
  getFocusState: () => Promise<FocusState>;
  startFocus: (minutes: number) => Promise<PetOperationResult>;
  pauseFocus: () => Promise<PetOperationResult>;
  resumeFocus: () => Promise<PetOperationResult>;
  stopFocus: () => Promise<PetOperationResult>;
  openGame: (
    gameId: GameId,
    difficulty?: GameDifficulty,
  ) => Promise<PetOperationResult>;
  getActiveGame: () => Promise<GameId | null>;
  getGameSetup: () => Promise<GameSetupPayload | null>;
  reportGamePhase: (phase: string) => void;
  onGameTogglePause: (listener: () => void) => () => void;
  onGameCancel: (listener: () => void) => () => void;
  getGameRecords: () => Promise<GameRecord[]>;
  finishGame: (
    result: GameResult,
  ) => Promise<GameCompletionResult>;
  closeGame: () => Promise<void>;
  getGrowthDashboard: () => Promise<GrowthDashboard>;
  feedPet: (foodId: string) => Promise<PetCareResult>;
  setPetSleeping: (sleeping: boolean) => Promise<PetCareResult>;
  claimDailyTask: (taskId: string) => Promise<PetOperationResult>;
  runStoryEvent: () => Promise<StoryEventOperationResult>;
  listContentPacks: () => Promise<ContentPackRecord[]>;
  installContentPack: () => Promise<PetOperationResult>;
  setContentPackEnabled: (
    packId: string,
    enabled: boolean,
  ) => Promise<PetOperationResult>;
  uninstallContentPack: (packId: string) => Promise<PetOperationResult>;
  getConversationSettings: () => Promise<ConversationSettings>;
  updateConversationSettings: (
    patch: Partial<ConversationPreferences>,
  ) => Promise<ConversationSettings>;
  setConversationSecret: (secret: string) => Promise<PetOperationResult>;
  deleteConversationSecret: () => Promise<PetOperationResult>;
  sendConversation: (text: string) => Promise<ConversationResponse>;
  clearConversation: () => Promise<void>;
  getPendingMemory: () => Promise<MemoryCandidate | null>;
  confirmMemory: () => Promise<PetOperationResult>;
  rejectMemory: () => Promise<void>;
  listMemories: () => Promise<MemoryRecord[]>;
  updateMemory: (
    memoryId: number,
    content: string,
  ) => Promise<PetOperationResult>;
  deleteMemory: (memoryId: number) => Promise<PetOperationResult>;
  clearMemories: () => Promise<PetOperationResult>;
  exportPersonalData: () => Promise<PetOperationResult>;
  importPersonalData: () => Promise<PetOperationResult>;
  backupDatabase: () => Promise<PetOperationResult>;
  restoreDatabase: () => Promise<PetOperationResult>;
  getUpdateStatus: () => Promise<UpdateStatus>;
  checkForUpdates: () => Promise<UpdateStatus>;
  openUpdateDownload: () => Promise<PetOperationResult>;
  openSettings: () => Promise<void>;
  resetPosition: () => Promise<void>;
  quit: () => Promise<void>;
  /** 以下为对齐 desktop_pet 右键菜单/托盘/子窗口新增的接口。 */
  showPetContextMenu: () => Promise<void>;
  petSingleClick: (relativeY: number) => Promise<boolean>;
  petDoubleClick: () => Promise<boolean>;
  petWheel: (deltaY: number) => Promise<boolean>;
  petPlay: () => Promise<PetCareResult>;
  petSleep: () => Promise<PetCareResult>;
  petWake: () => Promise<PetCareResult>;
  petRename: (name: string) => Promise<PetOperationResult>;
  petCycleSkin: () => Promise<PetOperationResult>;
  petTogglePause: () => Promise<PetOperationResult>;
  petTogglePositionLock: () => Promise<PetOperationResult>;
  openPanel: (page: PanelPage) => Promise<void>;
  getStatusSummary: () => Promise<PetStatusSummary>;
  listDisplays: () => Promise<DisplayEntry[]>;
  exportSaveArchive: () => Promise<PetOperationResult>;
  importSaveArchive: () => Promise<PetOperationResult>;
  clearSaveArchive: () => Promise<PetOperationResult>;
  resetGrowthData: () => Promise<PetOperationResult>;
  deleteAllPersonalData: () => Promise<PetOperationResult>;
  /** 气泡窗口专用通道。 */
  sendSpeechReady: () => void;
  onSpeechShow: (listener: (payload: SpeechShowPayload) => void) => () => void;
  onSpeechHide: (listener: () => void) => () => void;
  /** 输入框面板（更换名字）专用通道。 */
  submitPrompt: (value: string) => void;
  cancelPrompt: () => void;
  onMotionState: (listener: (state: MotionState) => void) => () => void;
  onSettingsChanged: (listener: (settings: PetSettings) => void) => () => void;
  onPetCatalogChanged: (
    listener: (entries: PetCatalogEntry[]) => void,
  ) => () => void;
  onReminderDashboardChanged: (
    listener: (dashboard: ReminderDashboard) => void,
  ) => () => void;
  onFocusStateChanged: (
    listener: (state: FocusState) => void,
  ) => () => void;
  onGameRecordsChanged: (
    listener: (records: GameRecord[]) => void,
  ) => () => void;
  onGrowthDashboardChanged: (
    listener: (dashboard: GrowthDashboard) => void,
  ) => () => void;
}
