# P0 透明桌宠技术验证

创建者：husu

## 验证问题

1. Electron 透明无边框窗口能否保持土豆原始透明边缘，不产生黑边或锐化。
2. 移动原生窗口时，`192×208` 画布是否会裁掉拖动动作。
3. Renderer 指针捕获配合主进程全局光标采样能否连续拖动。
4. 快速释放后，主进程能否稳定执行投掷、边缘反弹和落地。
5. macOS/Windows 能否对透明像素开启鼠标穿透，同时保留宠物身体交互。
6. 高 DPI 下原始 Codex 图集是否保持清晰。

## 当前实现

- `BrowserWindow`: `transparent`, `frame: false`, `hasShadow: false`
- macOS 背景色使用 `#00ffffff`，并在页面加载后重新设置，规避 Electron 将
  `#00000000` 错误合成为白底的问题
- Canvas：按 `devicePixelRatio × pet scale` 设置 backing store
- 图像处理：高质量浏览器插值，不增加滤镜、阴影、锐化和轮廓
- 拖动：主进程每 16ms 读取 `screen.getCursorScreenPoint()`
- 释放速度：最近八点加权平均，最大速度 `1600px/s`
- 物理：重力 `1800px/s²`，空气阻力、边缘反弹和地面摩擦沿用 Python 基线
- 点击穿透：Alpha 低于 12 时调用 `setIgnoreMouseEvents`

## 手工验收

- [ ] 待机帧和奔跑帧四周没有黑色描边
- [ ] 拖动向左使用 `running_left`，向右使用 `running_right`
- [ ] 拖动过程中尾巴、耳朵、脚和身体不被窗口裁掉
- [ ] 快速释放后能够向释放方向运动
- [ ] 碰到屏幕左右边缘后反弹
- [ ] 落地后停止，且窗口仍位于可用工作区
- [ ] 双击可以播放挥手动作
- [ ] 右键可以打开设置
- [ ] `65%`、`100%`、`160%` 三档没有异常缩放和黑边
- [ ] 透明区域点击能落到后方窗口，宠物身体仍可拖动

## 2026-07-31 验证记录

- `npm run check` 通过：ESLint、TypeScript、10 个 Vitest 用例、主进程构建和
  Renderer 生产构建均通过。
- `npm run pack:dir` 通过：`better-sqlite3` 已针对 Electron arm64 ABI 重建，
  生成 `release/mac-arm64/Desktop Pet.app`。
- 已实际启动打包后的应用；右键能打开设置，宠物大小可在 `100%` 与 `105%`
  之间切换，置顶开关可切换并恢复，拖动手势可正常发送。
- Codex 的桌面控制截图会把透明 Electron 窗口合成到白底，无法据此判断系统桌面上
  的最终 Alpha 观感。因此黑边、透明区域点击穿透、投掷反弹仍保留为人工屏幕验收项，
  不把自动化截图误记为通过。

## 已知平台限制

- Electron 官方说明原生 Wayland 通常不允许应用主动移动或定位顶层窗口。
- Linux P0 不开启透明区域点击穿透，避免失去恢复鼠标事件的可靠路径。
- 当前构建未签名、未公证，只用于本地技术验证。
- 本地 P0 打包显式关闭证书自动发现，避免误用钥匙串里的 Apple Development
  证书；Developer ID 签名和公证在 P6 独立接入。
