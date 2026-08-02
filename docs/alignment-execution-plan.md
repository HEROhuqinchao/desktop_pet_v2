# desktop_pet_v2 对齐改造执行清单

创建者：husu

更新日期：2026-08-02

## 1. 目标与边界

- 唯一修改目标：`/Users/husu/Documents/AIProject/desktop_pet_v2`。
- 行为、菜单层级、设置表单和独立页面以 `desktop_pet` 为唯一基准。
- `mdataplus_fwaxl3` 仅作为已通过功能评测的实现参考，不迁移评测日志、会话文件或临时产物。
- 保留本项目现有 Electron Builder、SBOM、原生模块校验、macOS 公证和 Windows SignPath 发布主干。
- 不修改 `desktop_pet` 基准项目及评测目录。

## 2. 已确认的根因

当前项目不是单一交互错误，而是能力承载方式与基准不同：右键入口直接打开设置，成长、提醒、内容、游戏等能力集中在卡片式设置页，缺少基准的完整菜单、独立面板、气泡、情绪/睡眠系统和小游戏深层机制。发布链本身已较完整，但还没有把新增运行时数据和新增 renderer 入口纳入打包验证。

## 3. 执行任务

### A. 功能与交互

- [x] 完成本项目、基准项目、fwaxl3 三方只读审计。
- [x] 建立改造前验证基线：lint、类型检查、22 个测试文件/88 项测试、生产构建通过。
- [x] 迁移完整宠物右键菜单与托盘菜单，并对齐文案、顺序、层级和动态可用状态。
- [x] 对齐单击、双击、滚轮、拖动、投掷、锁定位置、暂停活动和重置位置行为。
- [x] 对齐睡眠、情绪、主动台词、独立气泡和程序化状态/事件特效。
- [x] 对齐两款小游戏的三个难度、AI、生成器、特效、暂停与结算。
- [x] 补齐 9 个独立功能面板与改名输入面板。
- [x] 补齐存档导出、导入、清除和个人数据处理入口。

### B. UI 与页面

- [x] 设置窗口恢复为基准的单页滚动表单，字段、顺序和即时保存行为一致。
- [x] 设置窗口宽度、行高、标签列、控件列、间距、滚动区、工具按钮和关闭按钮对齐 Qt 基准。
- [x] 状态、背包、成长、专注、聊天、记忆、隐私、内容包、宠物管理页面逐页对齐尺寸和布局。
- [x] 保留操作系统原生标题栏语义，不引入基准不存在的导航、卡片或装饰。
- [x] 完成设置页与 9 个独立页面的 Electron 实机截图复核。

### C. 打包与 GitHub Actions

- [x] 将台词、人格、事件、节日和小游戏配置纳入 `extraResources/data`。
- [x] 将 panel、bubble renderer 入口纳入 Vite 构建。
- [x] 确认源码校验、依赖审计、SPDX SBOM、macOS 双架构、Windows x64、Linux 双架构矩阵仍然有效。
- [x] 确认 macOS 正式标签签名/公证门禁与 Windows 两阶段 SignPath 门禁仍为 fail-closed。
- [x] 确认新增资源进入目录包，并执行 5 个 renderer、8 个 data 文件与 `better-sqlite3`/keyring ABI 校验。
- [x] 完成两个 GitHub Actions YAML 的本地解析与结构审计。
- [x] 使用 actionlint 1.7.12 校验两个工作流。
- [x] 在正式远程提交上完成 GitHub Actions：三平台 `Source Checks` 与 macOS arm64 预览打包均通过。

### D. 验证与收口

- [x] lint 无错误。
- [x] TypeScript 类型检查通过。
- [x] 原有测试与新增对齐测试全部通过：23 个测试文件、109 项测试。
- [x] 生产 main 与 pet/settings/game/panel/bubble 五个 renderer 构建通过。
- [x] macOS arm64 目录打包通过，应用可启动，IPC 可打开设置和状态面板，原生模块 ABI 148 可加载。
- [x] SPDX 2.3、生产依赖树和高危漏洞审计通过。
- [x] 更新素材缺口和真实平台验收边界。
- [x] 复核迁移范围，不包含评测日志、会话文件或评测构建产物。

## 4. 当前验证结论

- 当前本机可以确认功能源码、UI 渲染、单元测试、生产构建、macOS arm64
  unsigned 目录包和打包后启动有效。
- `build/sounds/*.wav` 仍是基准本身允许静默降级的素材缺口，详见
  `docs/asset-gaps.md`。
- Electron 与 PySide6 不共享同一套原生控件绘制器，因此可以对齐页面结构、
  尺寸、层级、字段顺序和系统深浅色，但不能用自动测试证明每个像素完全相同。
- GitHub Actions 已在提交 `55a90da` 上真实运行通过：
  [`Source Checks`](https://github.com/HEROhuqinchao/desktop_pet_v2/actions/runs/30733253809)
  覆盖 Linux x64、Windows x64、macOS arm64，
  [`Build, Sign & Release`](https://github.com/HEROhuqinchao/desktop_pet_v2/actions/runs/30733337367)
  生成 macOS arm64 unsigned 预览 Artifact 与 SPDX SBOM。
- macOS 正式签名/公证、Windows SignPath、Windows/Linux 真机安装与卸载仍属于外部环境验收项。

## 5. 不自动判定为完成的项目

- 未配置 Apple Developer ID、公证凭据时，不把 unsigned macOS 预览包称为正式发布包。
- 未配置 SignPath 且未在 Windows 真机验收时，不把 Windows 发布称为已签名或已验证。
- 后续工作流调整必须在正式远程提交上再次运行；不能仅凭本地 YAML 检查判定流水线成功。
- 缺少 `build/sounds/*.wav` 时仅验证静默降级和调用契约，素材本身保持待补齐。
