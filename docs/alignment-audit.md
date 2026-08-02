# desktop_pet → desktop_pet_v2 对齐审计与差异清单

审计方式：逐文件阅读两侧源码（基准 ~16.9k 行 Python，V2 ~16.1k 行 TS），
以"基准行为 → V2 现状 → 差距 → 修改点"组织。基准证据均给出源文件。

## 0. 任务理解

- 基准 `desktop_pet`（PySide6）：单进程 Qt 应用。宠物窗口 + 托盘 + 右键菜单 +
  设置对话框 + 9 个子窗口（状态面板/背包/成长/专注/对话/记忆/隐私/内容包/宠物管理）
  + 2 个小游戏窗口 + 气泡窗口。数据：save.json + settings.json + SQLite(desktop_pet.db)。
- V2（Electron/React/Canvas）：宠物窗口 + 托盘 + 设置窗口（深色卡片式，含 6 个区块）
  + 游戏窗口。数据：preferences.json + assistant.db。
- 目标：V2 的入口、菜单、设置界面、全部用户可达能力与基准 1:1；保留 V2 的
  Electron Builder 发布链；不新增基准不存在的能力。

## 1. 入口与界面（用户重点强调）

| # | 基准行为（证据） | V2 现状 | 差距/修改点 |
|---|---|---|---|
| 1.1 | 右键宠物弹出完整菜单：喂食(小面包/香脆薯条/能量果汁)、玩耍、摸摸它、让它睡觉/叫醒它、分隔、更换名字、切换宠物、宠物管理、打开状态面板、打开宠物背包、和宠物聊天、成长与今日任务、专注与健康提醒、长期记忆、隐私与数据、内容包管理、开始小游戏(接食物 轻松/标准/挑战、躲避鼠标 轻松/标准/挑战)、设置、分隔、锁定位置√、始终置顶√、暂停宠物活动√、静音√、重置宠物位置、分隔、退出程序（ui/context_menu.py 全文） | 右键直接打开设置窗口（PetApp.tsx onContextMenu→openSettings） | 新增 Electron 右键菜单，层级/文案/顺序/可用性条件（喂食：非EAT且hunger≤95且非睡眠流程；玩耍/小游戏：非YAWN/PREPARE_SLEEP/SLEEP/DRAGGED）与基准一致；4 个 checkable 项 |
| 1.2 | 托盘菜单：显示宠物、隐藏宠物、分隔、喂食、让它睡觉(睡觉时变"叫醒它")、查看状态、和宠物聊天、成长与任务、开始专注、宠物管理、暂停活动(游戏中变"暂停小游戏/继续小游戏")、退出当前小游戏(仅游戏时可见)、设置、重置位置、分隔、退出；托盘单击/双击=显示宠物（ui/tray_icon.py） | 托盘为另一套：状态行、宠物radio子菜单、打开设置、小游戏(无难度)、专注子菜单、下次提醒行、测试提醒、重置位置、Codex同步、开机自启动√、检查更新、退出；点击=开设置 | 重建托盘菜单 1:1；点击=显示宠物；游戏期间动态项联动 |
| 1.3 | 设置窗口：单页滚动表单（非 tab），标题"莱姆桌面宠物设置"，minWidth 430；20 个复选框（开机启动/始终置顶/开启音效/桌面特效/允许追逐鼠标/允许自动移动/允许投掷/显示状态提醒/低性能模式/小游戏粒子/小游戏阴影/小游戏残影/小游戏失焦自动暂停/夜间安静模式/允许自动睡眠/显示对话气泡/启用健康提醒/仅工作日提醒/允许向在线对话共享记忆/允许匿名统计）→3 滑杆(活动频率/对话频率/音效音量 0-100)→宠物大小(65-160% step5, tooltip"Codex 宠物在 100% 时使用原始 192×208 尺寸")→小游戏目标帧率(30/60/90/120 FPS)→小游戏特效等级(关闭/精简/完整)→默认显示器(自动选择+屏幕名)→对话模式(本地离线/混合模式/在线模式)→文本(兼容接口地址/在线模型名称/免打扰开始22:00/免打扰结束08:00/Codex目录)→在线接口密钥(密码框+"保存密钥"按钮, 平台化 placeholder)→提示"设置会立即生效并保存。存档保存在当前用户的本地数据目录。"→工具按钮行(宠物管理/重置位置/导出存档/导入存档/清除存档)→关闭(右对齐)；任意控件变更立即 emit 保存（ui/settings_window.py） | 深色卡片 UI：宠物库卡片+成长+陪伴+专注+游戏记录+提醒+发布+宠物大小+活跃度+5 开关+实时状态+操作说明+底部按钮；仅 10 个设置字段 | 重写设置窗口为基准单页表单；新增字段：soundEnabled/soundVolume/desktopEffects/showStatusReminders/lowPowerMode/particlesEnabled/shadowsEnabled/trailsEnabled/autoPauseGames/quietNightMode/autoSleep/bubbleEnabled/dialogueFrequency/reminderEnabled/quietStart/quietEnd/workdaysOnly/shareMemoriesWithAi/anonymousAnalytics/conversationMode/gameTargetFps/gameEffectLevel/preferredScreen/personalityId；密钥行复用现有 keyring IPC；品牌词随 V2（标题"Desktop Pet 设置"、宠物名"土豆"），其余文案 1:1 |
| 1.4 | 设置窗口工具行：导出存档/导入存档/清除存档（save.json+settings.json 打包 JSON，导入替换模型+设置，清除带确认）（pet_controller._export_save/_import_save/_clear_save） | 无存档导出/导入/清除（只有个人数据 JSON 与 db 备份/恢复） | 新增存档档案导出/导入/清除 IPC（preferences + assistant.db 数据合并为 JSON 档案） |
| 1.5 | 双击宠物=打开状态面板（睡眠中=叫醒）；单击=摸摸（连点计数：≥6/≥10 变 ANGRY+临时情绪+台词；睡眠中 ≥3 次生气；12s 冷却 +1 经验）；滚轮=顺毛/挠痒（2s 内 ≥8 次→DIZZY；0.3s 冷却；上滚 HAPPY 下滚 CURIOUS）（pet_controller._on_clicked/_on_wheel/_handle_pet_event DOUBLE_CLICK→show_status） | 双击=挥手互动(interact)；无单击逻辑；无滚轮 | PetApp 增加单击（含双击等待定时器）、滚轮、双击开状态面板；main 实现连点/滚轮状态机与经验冷却 |
| 1.6 | 气泡：独立透明窗口，队列 maxlen3，190ms 淡入淡出，2.5-4s 自动消失，避开屏幕边界，情绪配色(angry/happy/sleepy/normal)，夜间模式(23-7点)；dialogue_frequency≤0 或 bubble_enabled=false 不显示；反馈 0.9s 冷却、主动对话 60s 冷却、同句 30 分钟抑制（ui/speech_bubble.py + systems/dialogue_system.py + pet_controller._say） | 完全没有气泡/对话台词系统 | 新增气泡窗口（独立 renderer 入口）+ DialogueSystem（复制基准 data/dialogues.json 全部 20 类×5 句）+ 全部 _say 触发点（欢迎/喂食/玩耍/摸/睡眠/叫醒/拖拽/投掷/连点/升级/成就/事件/专注完成/饥饿疲劳主动台词等） |
| 1.7 | 子窗口 9 个：状态面板(320 固定宽：头像+名字Lv+状态中文映射+今日互动次数+饱食/体力/心情/好感 4 进度条+喂食/睡觉/互动按钮)、宠物背包(330x300：类型·名称×数量、0 数量灰色、称号区、汇总行)、成长与今日任务(560x430：等级/经验/关系值+任务表(任务/进度/奖励/领取)+成就表)、专注与健康提醒(420x280：42px 计时+15/25/45/60 预设+自定义1-180+暂停/继续/结束+说明行+提醒表(提醒/下次时间/稍后10分钟·今天不再提醒))、和{名字}聊天(430x520：离线提示+消息区+500字输入+发送/思考中…+清除当前会话+本地降级标记)、长期记忆与隐私(600x400：类型/内容/更新时间表+双击编辑+删除选中/导出个人数据/清空全部记忆)、隐私与数据(430x360：说明+5 按钮)、内容包管理(560x360：提示行+名称/版本/状态/操作表+安装ZIP)、宠物管理(560x420：标题+路径提示+列表+设为当前宠物/导入文件夹/从Codex同步/导出到Codex+状态行+刷新/关闭) | 全部功能挤在设置窗口的卡片里，无独立窗口；状态面板/背包/隐私窗口完全不存在 | 新增独立面板窗口（单一 panel renderer 入口按 query 渲染 9 种面板），UI 结构/文案与基准 1:1；状态面板需好感度条→profile 增加 affection 属性列（schema v3→v4 兼容升级） |

## 2. 宠物核心行为

| # | 基准行为 | V2 现状 | 修改点 |
|---|---|---|---|
| 2.1 | 拖动：DRAGGED+按速度方向切换 running_left/right 动画；位置允许拖出屏幕 30% 可见（visible_fraction 0.30）；台词"收到，我先把两只脚收好。" | 有拖拽+方向动画；clamp 在 workArea 内（不允许出屏）；无台词 | clamp 改 0.30 可见约束；接台词 |
| 2.2 | 投掷：速度>150 触发，0.9 系数，±1450/±1300 clamp，THROWN+SCARED 临时情绪5s+台词；否则高空→FALL，地面→HAPPY+"平稳着陆…" | 有投掷物理（参数一致）；无情绪/台词 | 补临时情绪+台词 |
| 2.3 | 物理：gravity 1800/bounce 0.42/friction 0.82/drag 0.985/max 1600，落地>165 反弹、<85 停、|vx|<8 归零，JUMP 初速 -520 | physics.ts 完全一致 | 无 |
| 2.4 | 状态机 29 状态+转移表+完成候选；YAWN→PREPARE_SLEEP→SLEEP 自然流程；WAKE_UP；SLEEP 时 is_sleeping/sleep_started_at | 定义表一致；但睡眠是直接 set SLEEP/WAKE_UP，无 YAWN 流程 | 睡觉命令走 YAWN 流程；进入/离开 SLEEP 维护 sleeping 标记 |
| 2.5 | 自动睡眠：auto_sleep 且 (energy<18 或 夜间<42) → sleep()；energy≥92 自然醒（systems/sleep_system.py） | 无 | 新增 SleepSystem 判定，接入属性 tick |
| 2.6 | 属性：6 属性(含 affection)，30s tick 按小时速率推进，离线≤12h 补偿，无人照看>90min 掉心情；喂食/玩耍/摸的增量公式（systems/attribute_system.py） | 5 属性(无 affection)，60s tick，速率一致 | 增 affection 列；tick 改 30s；补玩耍/摸增量 |
| 2.7 | 情绪：属性推导(energy<20→YAWN, hunger<20→HUNGRY, mood<25→SAD, mood>80&affection>40→HAPPY)+临时情绪(投掷SCARED/游戏完成HAPPY/连点ANGRY)（systems/emotion_system.py） | 无情绪机制 | 新增 EmotionSystem+临时情绪 |
| 2.8 | 玩耍：energy<12 拒绝"电量不足…"，PLAY+属性+4exp+台词 | 无玩耍入口 | 菜单/IPC 新增 |
| 2.9 | 改名：输入框 ≤20 字+台词 | 无 | 新增 prompt 面板+IPC |
| 2.10 | 暂停活动：停自主行为+台词；锁定位置：禁拖；静音：sound_enabled 开关；重置位置：首选屏右缘-28 底部+1 | 均无；重置位置用 0.82/0.78 比例 | 全部新增；重置位置逻辑对齐 |
| 2.11 | 注视：悬停 30% 进 LOOK_AT_CURSOR；codex v2 16 向注视帧；非 codex 用 look_direction 旋转 | 有（仅 codex 路径，与基准一致） | 无 |
| 2.12 | 自主行为：3.5-8s 间隔×活跃度，权重表(含夜间/饥饿/疲劳/好奇修正)，追逐冷却 180-480s，事件概率 0.018+freq/4000 | 间隔/权重一致；用默认属性而非真实属性；无事件概率触发 | 用真实属性；接入随机事件自动触发 |

## 3. 随机事件（V2 仅有手动按钮，缺自动触发与全部视觉/交互）

基准（systems/event_system.py + pet_controller._start_special_event/_handle_event_click + animation.py._draw_event_effects/_draw_state_effects）：
- 10 事件（装死/偷鼠标/发疯/打工/宝箱/天气/节日/侦探/假更新/边缘探险），等级门槛、权重、时长、近 3 次抑制；发疯事件 0.48s 折返 285px/s；边缘探险移到左缘；宝箱点击开奖（小饼干×2/毛线球/经验12/称号箱子研究员/空，权重30/18/22/10/20）；天气按季节选 rain/snow/sun/wind/leaves；节日按 holidays.json 启动 2.6s 后触发。
- 事件/状态视觉全部程序化绘制：睡眠 Z、生气怒气线+蒸汽、开心爱心、EAT 食物道具(面包/薯条/果汁)、饥饿饼干思想泡、脏点、10 种事件覆盖物。
- V2 现状：STORY_EVENTS 定义+宝箱奖励已移植；仅设置面板手动 runStoryEvent；无自动触发、无视觉、无点击交互、无天气变体/节日。
- 修改：main 自动触发+计时结束；宠物 Canvas 重绘全部状态/事件覆盖物；宝箱/装死/假更新/侦探点击交互；数据复制 events.json/holidays.json。

## 4. 小游戏

| # | 基准 | V2 | 修改点 |
|---|---|---|---|
| 4.1 | 菜单 3 难度×2 游戏；窗口：接食物 880x560(min 720x460)"小游戏 · 接食物大作战"、躲避 900x560"小游戏 · 抓住莱姆"；开局隐藏宠物+暂停活动，结束恢复位置/状态；Esc 暂停、F3 性能层、失焦自动暂停；托盘"退出当前小游戏/暂停小游戏" | 无难度；窗口 920x690；不隐藏宠物；无托盘联动；关闭游戏会打开设置窗口 | 难度参数+data/catch_food.json、dodge_mouse.json 配置外置（extraResources）；窗口尺寸/标题对齐；游戏期间隐藏宠物+暂停+托盘动态项；结算后"返回桌面宠物"（不开设置） |
| 4.2 | 接食物：8 种生成模式(SINGLE/DOUBLE/WAVE/ZIGZAG/LEFT_RAIN/RIGHT_RAIN/BONUS_LINE/DANGER_MIX)、5s 换模式、自适应难度(进度0.5+表现0.3+模式基线0.2, 8% 趋近)、重力70+风25、预警线0.15-0.25s、扫掠碰撞、狂热(20连击+8s无危险→6s×1.5+结束后1s危险保护)、6 特殊事件(大胃王/真假食物/篮球投食/巨型汉堡/食物暴风雨/老板巡视)、道具(磁铁180半径/盾牌/双倍/加时≤15s)、反向控制3s、阶段名(热身/提速/混合/最终冲刺)、浮动文字 | 简化版：单难度60s、无模式/自适应/预警/扫掠/特殊事件/重力风、狂热=20连击里程碑 | 完整移植 spawn_director/difficulty_director/特殊事件/物理/碰撞到 TS 引擎 |
| 4.3 | 躲避鼠标：光标预测器(0.64/0.36 平滑)、反应延迟(140-420ms×难度×状态)、10 AI 状态(观察/走开/预测逃脱/冲刺/假动作/刹车/边缘躲藏/挑衅/眩晕/疲劳)、体力(100/冲25/回12/≤16疲劳2.2s)、冲刺(950速/280ms/140ms前摇/1.8s冷却)、点击判定(当前+上一帧椭圆×1.08)、挑衅+50/冲刺+100、6 特殊事件(影分身诱饵/急刹/反向假动作/墨镜挑衅/篮球/舞台唱歌) | 简化版：直线逃离+强度速度、无反应延迟/假动作/疲劳/诱饵，特殊事件只有挑衅 | 完整移植 DodgeAI/CursorPredictor/特殊事件 |
| 4.4 | 结算对话框：评价(26px 橙)、本局分数/历史最高(+新纪录)/最大连击/接取率或命中率/奖励明细、评论文案(S/A:"我怀疑你的鼠标偷偷练过。"等)、再来一局/返回桌面宠物（ui/game_result_dialog.py） | 游戏内嵌面板：缺评论/新纪录/奖励明细，"返回设置"文案错误 | 结算内容 1:1（游戏窗口内模态层） |
| 4.5 | 奖励：每日经验≤3次/好感≤5次/属性≤30；接食物补饥饿+心情，躲避耗体力+心情；记录最高分/连击/评价/精度 | 完全一致（assistant-database.calculateGameRewards） | 无 |
| 4.6 | 成绩记录：play_count/high_score/max_combo/best_grade/best_accuracy | 一致 | 无 |

## 5. 成长/任务/成就/背包

- 等级公式 100×level^1.35、解锁表(2:JUMP,CURIOUS 3:RUN 4:CHASE+称号桌面巡逻员 5:SPECIAL_EVENT+土豆搭档)：V2 一致。
- 每日任务模板(3 普通+1 挑战)：V2 一致（含 progress/claim）。
- 成就：基准两套共 7 个（统计型4+事件型3），V2 定义一致；需核对 unlock 判定条件与触发点（互动/喂食/连续天数/记忆/专注/500分）。
- 经验触发点：基准=点击1(12s冷却)/喂食5/玩耍4/事件完成5/宝箱/成就10/专注25/任务奖励；V2 缺玩耍/事件/成就经验与点击冷却 → 补齐。
- 背包窗口：基准独立窗口（物品+称号+汇总）；V2 无窗口 → 新增。宝箱物品入背包（V2 已有 grantInventory）。

## 6. 对话/记忆/隐私/内容包

- 对话控制器/本地规则/路由/记忆提取/密钥存储/OpenAI 兼容：V2 已移植且一致（含 HTTPS 校验增强）。缺：personality_id（基准 data/personalities.json 3 种人格）→补；对话命令 show_reminders/show_inventory/show_growth 打开对应窗口（V2 仅执行 start_focus）→补；记忆确认对话框（基准在对话回复前弹确认）→补。
- 记忆窗口/隐私窗口/内容包窗口：V2 功能在设置卡片内 → 迁到独立面板窗口；隐私窗口"重置成长数据/删除全部四期数据"流程 V2 缺失 → 新增（含确认、清 db+preferences+keyring+重建）。
- 内容包安装/启停/卸载/台词聚合：V2 与基准一致。

## 7. 提醒/专注

- 内置提醒：基准 3 个(喝水45/久坐60/休息30)；V2 有 6 个(多 meal/save-work/tidy-up，为 V2 既有能力，保留不删)。
- 触发周期：基准 60s 检查、每次最多 1 条通知；V2 15s 且全部发送 → 对齐 60s/单条。
- 免打扰/仅工作日/稍后10分钟/今天不再提醒：两侧一致。
- 专注窗口：基准独立窗口(预设+自定义+控制+提醒表)；V2 在设置卡片+托盘子菜单 → 独立面板；托盘"开始专注"为单一项（基准无子菜单）。
- 专注完成：+25exp+5关系+通知+台词：V2 有（缺台词）→补。

## 8. 持久化/多显示器/平台

- 存档：基准 save.json+settings.json 原子写+每日备份(留3)+损坏恢复+V3→V4 迁移；V2 preferences.json 原子写、db WAL、无每日备份 → 补每日备份(db+preferences，留3)。
- 多显示器：基准 preferred_screen 设置+比例坐标恢复+屏幕变化 clamp；V2 有比例恢复与 clamp，缺 preferred_screen → 补。
- 单实例：两侧一致。开机自启：两侧均有（实现方式随平台）。
- 音效：基准 SoundSystem 为开关+音量+节流+缺素材静默降级（无实际后端，注释说明待接入）→ V2 实现等价模块并记录素材缺口。

## 9. 素材缺口（需用户补齐，将单独出 asset-gaps.md）

- sounds/*.wav：eat、land、jump、happy、angry、level_up、treasure、game_score（8 个）。
- 事件/状态视觉全部程序化绘制，无图片缺口；宠物图集沿用 Codex v1/v2 契约（tudou 已内置）。

## 10. V2 既有但基准不存在的能力（处理原则）

更新检查(update-service)、关机清单、测试提醒、自定义提醒、每日时刻提醒、db 备份/恢复：
后端代码全部保留（不删代码），但托盘/设置/退出流程按基准 1:1 重建，上述能力的入口
在基准式 UI 中不出现（关机清单默认关闭以对齐基准退出行为）。备份/恢复与个人数据
导出/导入保留在"隐私与数据"面板（对应基准同名按钮位）。

## 11. 实施结果（2026-08-01）

### 已完成对齐（代码级）

| 模块 | 基准证据 | V2 落点 |
|---|---|---|
| 右键菜单 1:1（喂食子菜单/玩耍/摸摸它/睡觉叫醒/13 个功能入口/小游戏 2×3 难度/4 个勾选项/重置/退出） | ui/context_menu.py | src/main/pet-menus.ts + main.ts showPetContextMenu |
| 托盘菜单 1:1（显示/隐藏/喂食/睡觉切换/状态/聊天/成长/专注/宠物管理/暂停活动(游戏时=暂停小游戏)/退出当前小游戏(仅游戏时)/设置/重置/退出；单击=显示宠物） | ui/tray_icon.py | src/main/pet-menus.ts + main.ts updateTrayMenu |
| 设置窗口单页表单：20 复选框+3 滑杆+宠物大小(65-160%)+帧率(30/60/90/120)+特效等级(关闭/精简/完整)+默认显示器+对话模式+5 文本项+密钥行(平台化占位符)+提示行+工具行(宠物管理/重置位置/导出存档/导入存档/清除存档)+关闭 | ui/settings_window.py | src/renderer/settings/SettingsApp.tsx（重写） |
| 9 个子窗口（状态面板/背包/成长与今日任务/专注与健康提醒/聊天/长期记忆/隐私与数据/内容包管理/宠物管理）+ 改名输入框 | ui/*.py | src/renderer/panel/PanelApp.tsx + main.ts openPanel |
| 气泡：队列≤3、淡入淡出、边界规避、情绪配色、夜间模式、20 类台词×5 句、30 分钟抑制、反馈 0.9s/主动 60s 冷却 | ui/speech_bubble.py + systems/dialogue_system.py + data/dialogues.json | src/main/speech-bubble.ts + src/core/dialogue-system.ts + src/renderer/bubble/ |
| 单击摸摸（3s 连点计数、6/10 次生气、睡眠打扰 3 次生气、12s 经验冷却）、双击=状态面板(睡眠=叫醒)、滚轮(2s 8 次眩晕)、菜单"摸摸它"=独立 pet() | pet/pet_controller.py + pet/pet_window.py | main.ts handleSingleClick/handleDoubleClick/handleWheel/petAction |
| 睡眠完整流程 YAWN→PREPARE_SLEEP→SLEEP→WAKE_UP、自动睡眠(energy<18 或夜间<42)、自然醒(≥92) | systems/sleep_system.py + 状态机 | main.ts petSleep/petWake/advanceAttributes + core/sleep-system.ts |
| 情绪推导+临时情绪（投掷SCARED/游戏完成HAPPY/连点ANGRY） | systems/emotion_system.py | src/core/emotion-system.ts + main.ts |
| 属性 30s tick（6 属性含好感，速率与基准一致）、离线 12h 补偿 | systems/attribute_system.py | growth/pet-growth.ts（+affection 列 schema v4） |
| 随机事件自动触发（概率 0.018+freq/4000、等级门槛、近 3 次抑制）、发疯折返、边缘探险、宝箱点击开奖、天气季节变体、节日启动 2.6s、10 种事件+状态特效 Canvas 绘制 | systems/event_system.py + data/events.json + data/holidays.json + animation.py | main.ts startSpecialEvent/handleEventClick + renderer/pet/pet-overlays.ts |
| 小游戏 2×3 难度（45/60/90s、速度/危险/奖励/反应缩放）、8 种生成模式、自适应难度、狂热+危险保护、6+6 特殊事件、道具、扫掠碰撞、光标预测、10 状态 AI、体力/冲刺/假动作/疲劳 | games/* + data/catch_food.json + data/dodge_mouse.json | src/games/（game-configs/spawn-director/difficulty-director/dodge-ai/cursor-predictor + 两引擎重写） |
| 结算对话框：评价/本局分数/历史最高(新纪录)/最大连击/接取率或命中率/奖励明细/评论文案/再来一局/返回桌面宠物；游戏期间隐藏宠物+暂停活动+托盘联动；奖励每日上限 | ui/game_result_dialog.py + games/reward_system.py | renderer/game/GameApp.tsx + persistence（奖励逻辑原已一致） |
| 成长/任务/成就/背包：7 成就双套判定、每日 3+1 任务、经验触发点（点击1/喂食5/玩耍4/事件5/成就10/专注25）、称号 | growth/* + systems/* | persistence/assistant-database.ts（原有逻辑基本一致，补 grantTitle/recordStoryEvent/玩耍/摸摸） |
| 对话：3 模式、人格(personalities.json)、命令路由(start_focus/show_reminders/show_inventory/show_growth 均打开对应窗口)、记忆确认对话框 | conversation/* + data/personalities.json | conversation/conversation.ts + main.ts |
| 存档：导出/导入/清除档案、每日备份留 3、损坏恢复、偏好即时生效 | systems/save_system.py + persistence/backup_service.py | main.ts data:export-save/import-save/clear-save + createDailyBackup |
| 多显示器 preferred_screen、单实例 SHOW、重置位置=首选屏右缘 28 贴底、拖拽 30% 可见、投掷物理 | pet/pet_controller.py + app/* | main.ts + core/window-position.ts |

### 基准有但按"素材缺口"处理

- sounds/*.wav 8 个音效：SoundSystem 契约已实现（开关/音量/节流/缺失静默降级，
  与基准相同——基准亦无实际音频后端），见 docs/asset-gaps.md。

### V2 既有、基准不存在的能力（后端保留，UI 入口按基准重建后不再暴露）

- 应用内更新检查（update-service + IPC 保留）、关机清单（默认不再拦截退出，
  代码保留）、测试提醒、自定义/每日时刻提醒（提醒引擎能力保留）。

### 运行时验证证据（2026-08-01，CDP 实测打包产物）

通过 `--remote-debugging-port` 对打包产物注入真实输入事件验证：

- 单击×2 + 滚轮：`interactionCountToday` 0→3，状态 IDLE→HAPPY，
  心情 80→85、好感 35→37（摸摸增益公式端到端生效），宠物页零异常。
- 双击：状态面板窗口打开，4 条属性进度条（饱食/体力/心情/好感）+
  喂食/睡觉/互动/知道了 按钮，文案与基准一致。
- 气泡窗口：自动触发随机事件台词与唤醒台词，队列/淡入淡出正常。
- 修复并经复验消除的缺陷：
  1. 打包版 `pet-asset://` 图集使 Canvas 跨域污染，`getImageData`
     命中检测抛 SecurityError（点击/拖动失效）→ 协议响应补
     `Access-Control-Allow-Origin` + 图像 `crossOrigin='anonymous'`。
  2. 欢迎语在窗口异步加载完成前调用 `say()` 被丢弃 → 移至窗口显示后。
