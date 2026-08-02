import { Menu, type MenuItemConstructorOptions } from 'electron';

/**
 * 宠物右键菜单与托盘菜单，结构/文案/可用性条件与 desktop_pet
 * ui/context_menu.py、ui/tray_icon.py 保持一致。
 * 模板构建为纯函数（可测试），Menu 组装在 build*Menu 中完成。
 */

export interface PetMenuContext {
  behaviorState: string;
  paused: boolean;
  positionLocked: boolean;
  alwaysOnTop: boolean;
  soundEnabled: boolean;
  canFeed: boolean;
  gameActive: boolean;
  gamePaused: boolean;
}

export interface PetMenuCallbacks {
  feedBread: () => void;
  feedFries: () => void;
  feedJuice: () => void;
  play: () => void;
  pet: () => void;
  sleep: () => void;
  wake: () => void;
  rename: () => void;
  cycleSkin: () => void;
  petLibrary: () => void;
  status: () => void;
  inventory: () => void;
  conversation: () => void;
  growth: () => void;
  focus: () => void;
  memory: () => void;
  privacy: () => void;
  contentPacks: () => void;
  catchFood: (difficulty: 'easy' | 'standard' | 'challenge') => void;
  dodgeMouse: (difficulty: 'easy' | 'standard' | 'challenge') => void;
  settings: () => void;
  toggleLock: () => void;
  toggleTopmost: () => void;
  togglePause: () => void;
  toggleMute: () => void;
  resetPosition: () => void;
  quit: () => void;
}

const SLEEPING_STATES = new Set(['YAWN', 'PREPARE_SLEEP', 'SLEEP']);
const PLAY_BLOCKED_STATES = new Set(['YAWN', 'PREPARE_SLEEP', 'SLEEP', 'DRAGGED']);

export function isSleepingState(state: string): boolean {
  return SLEEPING_STATES.has(state);
}

/** 右键菜单模板，对应 desktop_pet build_pet_menu。 */
export function buildPetMenuTemplate(
  context: PetMenuContext,
  callbacks: PetMenuCallbacks,
): MenuItemConstructorOptions[] {
  const sleeping = SLEEPING_STATES.has(context.behaviorState);
  const playEnabled =
    !PLAY_BLOCKED_STATES.has(context.behaviorState) && !context.gameActive;
  const feedEnabled =
    context.behaviorState !== 'EAT' && context.canFeed && !context.gameActive;
  return [
    {
      label: '喂食',
      enabled: feedEnabled,
      submenu: [
        { label: '小面包', click: callbacks.feedBread },
        { label: '香脆薯条', click: callbacks.feedFries },
        { label: '能量果汁', click: callbacks.feedJuice },
      ],
    },
    { label: '玩耍', enabled: playEnabled, click: callbacks.play },
    { label: '摸摸它', click: callbacks.pet },
    {
      label: sleeping ? '叫醒它' : '让它睡觉',
      click: sleeping ? callbacks.wake : callbacks.sleep,
    },
    { type: 'separator' },
    { label: '更换名字', click: callbacks.rename },
    { label: '切换宠物', click: callbacks.cycleSkin },
    { label: '宠物管理', click: callbacks.petLibrary },
    { label: '打开状态面板', click: callbacks.status },
    { label: '打开宠物背包', click: callbacks.inventory },
    { label: '和宠物聊天', click: callbacks.conversation },
    { label: '成长与今日任务', click: callbacks.growth },
    { label: '专注与健康提醒', click: callbacks.focus },
    { label: '长期记忆', click: callbacks.memory },
    { label: '隐私与数据', click: callbacks.privacy },
    { label: '内容包管理', click: callbacks.contentPacks },
    {
      label: '开始小游戏',
      enabled: playEnabled,
      submenu: [
        {
          label: '接食物',
          submenu: [
            {
              label: '轻松 · 45 秒',
              click: () => callbacks.catchFood('easy'),
            },
            {
              label: '标准 · 60 秒',
              click: () => callbacks.catchFood('standard'),
            },
            {
              label: '挑战 · 90 秒',
              click: () => callbacks.catchFood('challenge'),
            },
          ],
        },
        {
          label: '躲避鼠标',
          submenu: [
            {
              label: '轻松',
              click: () => callbacks.dodgeMouse('easy'),
            },
            {
              label: '标准',
              click: () => callbacks.dodgeMouse('standard'),
            },
            {
              label: '挑战',
              click: () => callbacks.dodgeMouse('challenge'),
            },
          ],
        },
      ],
    },
    { label: '设置', click: callbacks.settings },
    { type: 'separator' },
    {
      label: '锁定位置',
      type: 'checkbox',
      checked: context.positionLocked,
      click: callbacks.toggleLock,
    },
    {
      label: '始终置顶',
      type: 'checkbox',
      checked: context.alwaysOnTop,
      click: callbacks.toggleTopmost,
    },
    {
      label: '暂停宠物活动',
      type: 'checkbox',
      checked: context.paused,
      click: callbacks.togglePause,
    },
    {
      label: '静音',
      type: 'checkbox',
      checked: !context.soundEnabled,
      click: callbacks.toggleMute,
    },
    { label: '重置宠物位置', click: callbacks.resetPosition },
    { type: 'separator' },
    { label: '退出程序', click: callbacks.quit },
  ];
}

export function buildPetContextMenu(
  context: PetMenuContext,
  callbacks: PetMenuCallbacks,
): Menu {
  return Menu.buildFromTemplate(buildPetMenuTemplate(context, callbacks));
}

export interface TrayMenuCallbacks {
  show: () => void;
  hide: () => void;
  feed: () => void;
  toggleSleep: () => void;
  status: () => void;
  conversation: () => void;
  growth: () => void;
  focus: () => void;
  petLibrary: () => void;
  togglePause: () => void;
  exitGame: () => void;
  settings: () => void;
  resetPosition: () => void;
  quit: () => void;
}

/** 托盘菜单模板，对应 desktop_pet PetTrayIcon。 */
export function buildTrayMenuTemplate(
  context: PetMenuContext,
  callbacks: TrayMenuCallbacks,
): MenuItemConstructorOptions[] {
  const sleeping = SLEEPING_STATES.has(context.behaviorState);
  const feedEnabled =
    context.behaviorState !== 'EAT' && !sleeping && !context.gameActive;
  const pauseLabel = context.gameActive
    ? context.gamePaused
      ? '继续小游戏'
      : '暂停小游戏'
    : context.paused
      ? '继续活动'
      : '暂停活动';
  const template: MenuItemConstructorOptions[] = [
    { label: '显示宠物', click: callbacks.show },
    { label: '隐藏宠物', click: callbacks.hide },
    { type: 'separator' },
    { label: '喂食', enabled: feedEnabled, click: callbacks.feed },
    {
      label: sleeping ? '叫醒它' : '让它睡觉',
      click: callbacks.toggleSleep,
    },
    { label: '查看状态', click: callbacks.status },
    { label: '和宠物聊天', click: callbacks.conversation },
    { label: '成长与任务', click: callbacks.growth },
    { label: '开始专注', click: callbacks.focus },
    { label: '宠物管理', click: callbacks.petLibrary },
    { label: pauseLabel, click: callbacks.togglePause },
  ];
  if (context.gameActive) {
    template.push({ label: '退出当前小游戏', click: callbacks.exitGame });
  }
  template.push(
    { label: '设置', click: callbacks.settings },
    { label: '重置位置', click: callbacks.resetPosition },
    { type: 'separator' },
    { label: '退出', click: callbacks.quit },
  );
  return template;
}

export function buildTrayMenu(
  context: PetMenuContext,
  callbacks: TrayMenuCallbacks,
): Menu {
  return Menu.buildFromTemplate(buildTrayMenuTemplate(context, callbacks));
}
