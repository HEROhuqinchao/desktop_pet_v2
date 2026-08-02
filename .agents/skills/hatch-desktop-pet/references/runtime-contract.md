# desktop_pet_v2 动作扩展契约

## 目录结构

```text
pet-package/
├── pet.json
├── spritesheet.webp
├── desktop-pet-actions.json
└── actions.webp
```

前两个文件保持 Codex v1/v2 契约。后两个文件是可选旁车；Codex 可以继续使用基础包，desktop_pet_v2 在旁车有效时优先播放专属动作。

## 基础 Codex v2

- `spriteVersionNumber: 2`
- 单元格 `192x208`
- 图集 `1536x2288`，即 8 列、11 行
- 行 0-8 为 9 个标准动作，行 9-10 为从上方开始顺时针排列的 16 向注视
- 中心/死区继续使用基础 idle 中性帧

## 旁车清单

```json
{
  "formatVersion": 1,
  "cellWidth": 192,
  "cellHeight": 208,
  "atlasPath": "actions.webp",
  "columns": 8,
  "rows": 2,
  "animations": {
    "sleep": {
      "loop": true,
      "frames": [
        { "row": 0, "column": 0, "durationMs": 220 },
        { "row": 0, "column": 1, "durationMs": 260 }
      ]
    }
  },
  "stateMap": {
    "SLEEP": "sleep"
  }
}
```

约束：

- 文件名固定为 `desktop-pet-actions.json`。
- `atlasPath` 必须是宠物目录内的 PNG 或 WebP 文件名。
- `columns` 为 1-16，`rows` 为 1-64。
- 动作名使用小写字母、数字和连字符，最多 64 字符。
- 每个动作包含 1-64 帧；`durationMs` 为 16-10000 的整数。
- 每帧显式声明 `row`、`column` 和 `durationMs`。
- 被引用单元格必须非空，未引用单元格必须全透明。
- `stateMap` 只能引用 `PET_BEHAVIOR_STATES` 中的真实状态和已定义动作。

## 播放优先级

```text
一次性 animationCue
  > Codex v2 16 向注视
  > stateMap 专属动作
  > Codex v1/v2 基础动作回退
```

一次性 cue 由运行时发送并播放一轮。目前固定 cue：

- `petting`
- `groom`
- `tickle`
- `focus-complete`
- `reminder`
- `game-celebrate`
- `game-finished`
- `event-play-dead`
- `event-steal-cursor`
- `event-zoomies`
- `event-office`
- `event-treasure`
- `event-weather`
- `event-holiday`
- `event-detective`
- `event-fake-update`
- `event-edge-adventure`

## 回退原则

- 旁车不存在：完整使用 Codex 基础图集。
- `stateMap` 未映射某状态：使用 `src/core/atlas.ts` 的基础映射。
- cue 动作不存在：忽略 cue，继续当前状态动作。
- 旁车结构或图集无效：整个宠物包验证失败，不静默加载损坏资源。

## 状态动作覆盖

完整包应映射 `src/shared/contracts.ts` 中全部 30 个 `PET_BEHAVIOR_STATES`。其中以下动作不得共用同一生成条带：

- `YAWN`、`PREPARE_SLEEP`、`SLEEP`、`WAKE_UP`
- `EAT`、`PLAY`
- `HUNGRY`、`HAPPY`、`ANGRY`、`SAD`、`SCARED`、`DIZZY`、`CURIOUS`
- `JUMP`、`FALL`、`LAND`、`THROWN`、`DRAGGED`

`petting` 是交互 cue，不是行为状态，必须独立于 `HAPPY`。
