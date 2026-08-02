# Desktop Pet V2

创建者：husu

Desktop Pet V2 是使用 TypeScript、Electron、React 和 Canvas 2D 重写的独立跨平台
桌面宠物与提醒助手。它不依赖 Codex 安装，同时保持对 Codex v1/v2 宠物包的兼容
方向。

当前已完成 P0 到 P6，并完成 desktop_pet 行为、菜单、设置表单、独立页面、
特效和小游戏的对齐改造；macOS arm64 unsigned 目录包已复验。正式签名发布与
Windows/Linux 真机验收仍等待仓库外条件。已建立：

- 原始 `192×208` Codex v2 土豆图集渲染
- 透明、无边框、关闭原生阴影的桌宠窗口
- 基于宠物 Alpha 的 macOS/Windows 点击穿透
- 最近八点加权速度采样
- 拖动方向动画、投掷、重力、反弹、摩擦和落地
- `65%` 到 `160%` 宠物大小控制
- 与 desktop_pet 顺序和层级一致的宠物右键菜单、托盘菜单
- 单页滚动设置表单、固定工具区和 9 个独立功能页面
- 单击、双击、滚轮、拖动、投掷、锁定、暂停和位置重置
- 原项目完整 30 态定义与受控状态转移
- 睡眠流程、属性情绪、主动台词、独立气泡和程序化状态/事件特效
- 自主散步、奔跑、跳跃、鼠标注视和追逐行为
- Codex v2 完整动作行与 17 向注视帧
- 设置和多屏归一化位置持久化
- Codex v1/v2 宠物包严格校验与独立本地宠物库
- Codex 自动发现、幂等同步、冲突保护和反向导出
- 宠物切换、系统托盘和 macOS/Windows/Linux 自启动
- SQLite 提醒、每日计划、免打扰、工作日和系统通知
- 专注计时、退出检查清单与宠物动作联动
- 接食物、躲避鼠标的三档难度、生成器/AI/特效、游戏记录和每日奖励
- 等级、经验、关系值、六维属性、喂食和睡眠
- 每日任务、连续陪伴、成就、背包和剧情随机事件
- 本地对话、可选 OpenAI 兼容提供方和系统 Keyring
- 明确确认的长期记忆、敏感信息拒绝和会话不落盘
- 严格校验的 ZIP 内容包、JSON 数据迁移和 SQLite 备份恢复
- HTTPS 更新清单、手动检查更新和安全下载入口
- macOS arm64/x64、Windows x64、Linux x64/arm64 的 GitHub Actions 打包矩阵
- Developer ID 公证与两阶段 SignPath 的正式发布失败关闭门禁
- SHA-256、SPDX 2.3 SBOM 和跨平台 Release manifest
- 运行时 JSON、TypeScript 单元测试、lint、类型检查和 Electron 构建门禁
- 打包后 5 个 renderer、8 个数据文件和原生模块 ABI 校验

## 运行

```bash
npm install
npm run dev
```

生产构建并运行：

```bash
npm run start
```

完整检查：

```bash
npm run check
```

仅校验台词、人格、事件、节日和小游戏运行时数据：

```bash
npm run verify:data
```

生产依赖与发布来源门禁：

```bash
npm ls --omit=dev --all
npm audit --omit=dev --registry=https://registry.npmjs.org
npm --silent run sbom > desktop-pet-v2.spdx.json
node scripts/release.mjs verify
```

构建当前平台的未签名测试目录：

```bash
npm run pack:dir
```

macOS arm64 本地验证产物位于：

```text
release/mac-arm64/Desktop Pet.app
```

## 原型操作

| 操作 | 行为 |
| --- | --- |
| 按住土豆拖动 | 移动窗口，并根据方向切换奔跑动作 |
| 快速拖动后松开 | 投掷土豆，触发重力、反弹与落地 |
| 单击或菜单“摸摸它” | 互动、连点反馈并按冷却累计经验 |
| 双击土豆 | 睡眠时叫醒，否则打开宠物状态面板 |
| 滚轮 | 顺毛/挠痒，并按连续滚动触发对应情绪 |
| 右键土豆 | 打开与 desktop_pet 层级一致的完整操作菜单 |
| 调节大小 | `100%` 对应 Codex 原始 `192×208` 单元格 |
| 自主行为设置 | 控制自主移动、追逐鼠标、投掷和活跃度 |
| 宠物库 | 导入、同步、导出和切换 Codex 兼容宠物 |
| 提醒 | 喝水、活动、远眺、吃饭、保存文件、收拾物品和自定义计划 |
| 专注 | 预设或自定义时长，支持暂停、继续与停止 |
| 小游戏 | 接食物、躲避鼠标、连击、最高分和每日奖励 |
| 成长与照料 | 喂食、睡眠、属性、任务、成就、背包和剧情事件 |
| 对话与记忆 | 默认离线，可选在线提供方，长期记忆必须确认 |
| 内容与数据 | 安装纯数据内容包，导入导出及数据库备份恢复 |
| 软件更新 | 配置 HTTPS release manifest，手动检查并打开对应平台下载页 |

## 平台边界

- macOS、Windows：透明像素可使用 Electron 鼠标转发实现点击穿透。
- Linux X11/XWayland：计划提供完整拖动和主动移动。
- Linux 原生 Wayland：普通应用可能无法主动定位和移动顶层窗口，将作为降级模式。
- 当前本地包尚未进行 Developer ID、notarization 或 Authenticode 签名，不能作为正式版发布。
- `v*` 正式发布流水线已设置为缺少 Apple/SignPath 配置即失败，不会降级上传未签名包。

## 文档

- [`docs/architecture.md`](docs/architecture.md)
- [`docs/migration-plan.md`](docs/migration-plan.md)
- [`docs/p0-tech-spike.md`](docs/p0-tech-spike.md)
- [`docs/p1-behavior-and-position.md`](docs/p1-behavior-and-position.md)
- [`docs/p2-pet-library-and-system-integration.md`](docs/p2-pet-library-and-system-integration.md)
- [`docs/p3-reminders-and-focus.md`](docs/p3-reminders-and-focus.md)
- [`docs/p4-games.md`](docs/p4-games.md)
- [`docs/p5-growth-content.md`](docs/p5-growth-content.md)
- [`docs/p6-release-distribution.md`](docs/p6-release-distribution.md)
- [`docs/alignment-audit.md`](docs/alignment-audit.md)
- [`docs/alignment-execution-plan.md`](docs/alignment-execution-plan.md)
- [`docs/asset-gaps.md`](docs/asset-gaps.md)
- [`docs/release-operations.md`](docs/release-operations.md)
- [`docs/licensing-and-provenance.md`](docs/licensing-and-provenance.md)

<!-- 创建者：husu -->
