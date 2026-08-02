import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopPetApi,
  FocusState,
  GameRecord,
  MotionState,
  PointerObservation,
  ReminderDashboard,
  PetSettings,
  SpeechShowPayload,
} from '../shared/contracts';

const api: DesktopPetApi = {
  getSettings: () => ipcRenderer.invoke('pet:get-settings'),
  getMotionState: () => ipcRenderer.invoke('pet:get-motion-state'),
  updateSettings: (patch) => ipcRenderer.invoke('pet:update-settings', patch),
  beginDrag: () => ipcRenderer.invoke('pet:drag-start'),
  endDrag: () => ipcRenderer.invoke('pet:drag-end'),
  interact: () => ipcRenderer.invoke('pet:interact'),
  updatePointer: (observation: PointerObservation) =>
    ipcRenderer.invoke('pet:update-pointer', observation),
  setPointerPassthrough: (ignored) =>
    ipcRenderer.invoke('pet:pointer-passthrough', ignored),
  listPets: () => ipcRenderer.invoke('pet:list-pets'),
  selectPet: (selectionId) =>
    ipcRenderer.invoke('pet:select-pet', selectionId),
  importPetFolder: () => ipcRenderer.invoke('pet:import-pet-folder'),
  syncCodexPets: () => ipcRenderer.invoke('pet:sync-codex-pets'),
  exportActivePetToCodex: () =>
    ipcRenderer.invoke('pet:export-active-pet'),
  getReminderDashboard: () =>
    ipcRenderer.invoke('assistant:get-reminder-dashboard'),
  updateReminderPreferences: (patch) =>
    ipcRenderer.invoke('assistant:update-reminder-preferences', patch),
  saveReminder: (input) =>
    ipcRenderer.invoke('assistant:save-reminder', input),
  deleteReminder: (reminderId) =>
    ipcRenderer.invoke('assistant:delete-reminder', reminderId),
  snoozeReminder: (reminderId, minutes) =>
    ipcRenderer.invoke('assistant:snooze-reminder', reminderId, minutes),
  disableReminderToday: (reminderId) =>
    ipcRenderer.invoke('assistant:disable-reminder-today', reminderId),
  sendTestReminder: () =>
    ipcRenderer.invoke('assistant:test-reminder'),
  getFocusState: () =>
    ipcRenderer.invoke('assistant:get-focus-state'),
  startFocus: (minutes) =>
    ipcRenderer.invoke('assistant:start-focus', minutes),
  pauseFocus: () =>
    ipcRenderer.invoke('assistant:pause-focus'),
  resumeFocus: () =>
    ipcRenderer.invoke('assistant:resume-focus'),
  stopFocus: () =>
    ipcRenderer.invoke('assistant:stop-focus'),
  openGame: (gameId, difficulty) =>
    ipcRenderer.invoke('game:open', gameId, difficulty),
  getActiveGame: () =>
    ipcRenderer.invoke('game:get-active'),
  getGameRecords: () =>
    ipcRenderer.invoke('game:get-records'),
  finishGame: (result) =>
    ipcRenderer.invoke('game:finish', result),
  closeGame: () =>
    ipcRenderer.invoke('game:close'),
  getGameSetup: () => ipcRenderer.invoke('game:get-setup'),
  reportGamePhase: (phase) => ipcRenderer.send('game:phase-changed', phase),
  onGameTogglePause: (listener) => {
    const handler = () => {
      listener();
    };
    ipcRenderer.on('game:toggle-pause', handler);
    return () => ipcRenderer.removeListener('game:toggle-pause', handler);
  },
  onGameCancel: (listener) => {
    const handler = () => {
      listener();
    };
    ipcRenderer.on('game:cancel', handler);
    return () => ipcRenderer.removeListener('game:cancel', handler);
  },
  getGrowthDashboard: () =>
    ipcRenderer.invoke('growth:get-dashboard'),
  feedPet: (foodId) =>
    ipcRenderer.invoke('growth:feed', foodId),
  setPetSleeping: (sleeping) =>
    ipcRenderer.invoke('growth:set-sleeping', sleeping),
  claimDailyTask: (taskId) =>
    ipcRenderer.invoke('growth:claim-task', taskId),
  runStoryEvent: () =>
    ipcRenderer.invoke('growth:run-story-event'),
  listContentPacks: () =>
    ipcRenderer.invoke('content:list-packs'),
  installContentPack: () =>
    ipcRenderer.invoke('content:install-pack'),
  setContentPackEnabled: (packId, enabled) =>
    ipcRenderer.invoke('content:set-pack-enabled', packId, enabled),
  uninstallContentPack: (packId) =>
    ipcRenderer.invoke('content:uninstall-pack', packId),
  getConversationSettings: () =>
    ipcRenderer.invoke('conversation:get-settings'),
  updateConversationSettings: (patch) =>
    ipcRenderer.invoke('conversation:update-settings', patch),
  setConversationSecret: (secret) =>
    ipcRenderer.invoke('conversation:set-secret', secret),
  deleteConversationSecret: () =>
    ipcRenderer.invoke('conversation:delete-secret'),
  sendConversation: (text) =>
    ipcRenderer.invoke('conversation:send', text),
  clearConversation: () =>
    ipcRenderer.invoke('conversation:clear'),
  getPendingMemory: () =>
    ipcRenderer.invoke('memory:get-pending'),
  confirmMemory: () =>
    ipcRenderer.invoke('memory:confirm'),
  rejectMemory: () =>
    ipcRenderer.invoke('memory:reject'),
  listMemories: () =>
    ipcRenderer.invoke('memory:list'),
  updateMemory: (memoryId, content) =>
    ipcRenderer.invoke('memory:update', memoryId, content),
  deleteMemory: (memoryId) =>
    ipcRenderer.invoke('memory:delete', memoryId),
  clearMemories: () =>
    ipcRenderer.invoke('memory:clear'),
  exportPersonalData: () =>
    ipcRenderer.invoke('data:export'),
  importPersonalData: () =>
    ipcRenderer.invoke('data:import'),
  backupDatabase: () =>
    ipcRenderer.invoke('data:backup'),
  restoreDatabase: () =>
    ipcRenderer.invoke('data:restore'),
  getUpdateStatus: () =>
    ipcRenderer.invoke('update:get-status'),
  checkForUpdates: () =>
    ipcRenderer.invoke('update:check'),
  openUpdateDownload: () =>
    ipcRenderer.invoke('update:open-download'),
  openSettings: () => ipcRenderer.invoke('pet:open-settings'),
  resetPosition: () => ipcRenderer.invoke('pet:reset-position'),
  quit: () => ipcRenderer.invoke('pet:quit'),
  showPetContextMenu: () => ipcRenderer.invoke('pet:context-menu'),
  petSingleClick: (relativeY) =>
    ipcRenderer.invoke('pet:single-click', relativeY),
  petDoubleClick: () => ipcRenderer.invoke('pet:double-click'),
  petWheel: (deltaY) => ipcRenderer.invoke('pet:wheel', deltaY),
  petPlay: () => ipcRenderer.invoke('pet:play'),
  petSleep: () => ipcRenderer.invoke('pet:sleep'),
  petWake: () => ipcRenderer.invoke('pet:wake'),
  petRename: (name) => ipcRenderer.invoke('pet:rename', name),
  petCycleSkin: () => ipcRenderer.invoke('pet:cycle-skin'),
  petTogglePause: () => ipcRenderer.invoke('pet:toggle-pause'),
  petTogglePositionLock: () => ipcRenderer.invoke('pet:toggle-lock'),
  openPanel: (page) => ipcRenderer.invoke('panel:open', page),
  getStatusSummary: () => ipcRenderer.invoke('pet:status-summary'),
  listDisplays: () => ipcRenderer.invoke('pet:list-displays'),
  exportSaveArchive: () => ipcRenderer.invoke('data:export-save'),
  importSaveArchive: () => ipcRenderer.invoke('data:import-save'),
  clearSaveArchive: () => ipcRenderer.invoke('data:clear-save'),
  resetGrowthData: () => ipcRenderer.invoke('growth:reset'),
  deleteAllPersonalData: () => ipcRenderer.invoke('data:delete-all'),
  sendSpeechReady: () => ipcRenderer.send('speech:ready'),
  onSpeechShow: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: SpeechShowPayload,
    ) => {
      listener(payload);
    };
    ipcRenderer.on('speech:show', handler);
    return () => ipcRenderer.removeListener('speech:show', handler);
  },
  onSpeechHide: (listener) => {
    const handler = () => {
      listener();
    };
    ipcRenderer.on('speech:hide', handler);
    return () => ipcRenderer.removeListener('speech:hide', handler);
  },
  submitPrompt: (value) => ipcRenderer.send('prompt:submit', value),
  cancelPrompt: () => ipcRenderer.send('prompt:cancel'),
  onMotionState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: MotionState) => {
      listener(state);
    };
    ipcRenderer.on('pet:motion-state', handler);
    return () => ipcRenderer.removeListener('pet:motion-state', handler);
  },
  onSettingsChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: PetSettings) => {
      listener(settings);
    };
    ipcRenderer.on('pet:settings-changed', handler);
    return () => ipcRenderer.removeListener('pet:settings-changed', handler);
  },
  onPetCatalogChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      entries: Parameters<typeof listener>[0],
    ) => {
      listener(entries);
    };
    ipcRenderer.on('pet:catalog-changed', handler);
    return () => ipcRenderer.removeListener('pet:catalog-changed', handler);
  },
  onReminderDashboardChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      dashboard: ReminderDashboard,
    ) => {
      listener(dashboard);
    };
    ipcRenderer.on('assistant:reminders-changed', handler);
    return () =>
      ipcRenderer.removeListener('assistant:reminders-changed', handler);
  },
  onFocusStateChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: FocusState,
    ) => {
      listener(state);
    };
    ipcRenderer.on('assistant:focus-changed', handler);
    return () =>
      ipcRenderer.removeListener('assistant:focus-changed', handler);
  },
  onGameRecordsChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      records: GameRecord[],
    ) => {
      listener(records);
    };
    ipcRenderer.on('game:records-changed', handler);
    return () =>
      ipcRenderer.removeListener('game:records-changed', handler);
  },
  onGrowthDashboardChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      dashboard: Parameters<typeof listener>[0],
    ) => {
      listener(dashboard);
    };
    ipcRenderer.on('growth:dashboard-changed', handler);
    return () =>
      ipcRenderer.removeListener('growth:dashboard-changed', handler);
  },
};

contextBridge.exposeInMainWorld('desktopPet', api);
