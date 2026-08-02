# 素材缺口清单（desktop_pet_v2 对齐 desktop_pet）

以下素材在基准项目中即为"缺失时安全降级"的占位入口（基准 `systems/sound_system.py`
注释：音效后端保持独立，正式素材接入后可替换），V2 已按相同契约实现调用点，
补齐素材后无需改代码即可生效。

## 1. 音效（WAV）

接入位置：`build/sounds/`（打包后位于 resources/sounds/，由 main 进程
`src/main/sound-system.ts` 加载；缺失时记录一次日志并静默忽略，与基准一致）。
播放受设置"开启音效/音效音量"控制，同名音效最小间隔 1.2s。

| 素材文件 | 触发条件（基准映射） | 建议时长 | 格式 |
|---|---|---|---|
| eat.wav | 喂食成功（feed() 进入 EAT 状态） | ≤1s | WAV 44.1kHz |
| land.wav | 投掷/跳跃落地进入 LAND | ≤0.5s | WAV |
| jump.wav | 进入 JUMP 状态 | ≤0.5s | WAV |
| happy.wav | 进入 HAPPY 状态 | ≤1s | WAV |
| angry.wav | 进入 ANGRY 状态 | ≤1s | WAV |
| level_up.wav | 升级（_award_experience 检测到 leveled_up） | ≤2s | WAV |
| treasure.wav | 宝箱事件点击开奖 | ≤1s | WAV |
| game_score.wav | 小游戏正常完成结算 | ≤1.5s | WAV |

帧数/尺寸：不适用（音频）。基准未提供原始音频文件，仅预留 assets/sounds/ 目录。

## 2. 视觉素材

无缺口。基准的全部状态特效（睡眠 Z、怒气、爱心、食物道具、饥饿思想泡、脏点）
与 10 种随机事件视觉（装死旋转、偷鼠标箭头、发疯速度线、打工领带+电脑、宝箱、
天气雨/雪/晴/风/落叶、节日帽、侦探放大镜、假更新进度框、边缘探险文字）均为
程序化绘制，V2 已在 `src/renderer/pet/pet-overlays.ts` 以 Canvas 等价复刻。

## 3. 宠物图集

沿用 Codex v1/v2 图集契约（192×208 单元格，v1 9 行 / v2 11 行），内置
`src/renderer/public/pets/tudou/`（spriteVersionNumber 2）。动作到图集行的映射
见 `src/core/atlas.ts`，与基准 `pet/codex_sprite_repository.py` 完全一致，
无缺失动作。若新增宠物包，只需放入符合 pet.json 契约的目录并通过"宠物管理"导入。
