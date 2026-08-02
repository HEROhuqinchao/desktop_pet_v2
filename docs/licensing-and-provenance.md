# 许可证与来源边界

创建者：husu

## 新项目许可证

Desktop Pet V2 使用 MIT License。

## 可迁移来源

### desktop_pet

- 许可证：MIT
- 用途：桌宠行为、Codex 宠物格式、提醒、成长和小游戏的迁移基线
- 处理：TypeScript 重写，保留 MIT 许可和来源说明

### 土豆资源

- 所有权：项目维护者已明确拥有
- 用途：作为 V2 唯一内置默认宠物公开分发
- 要求：保留宠物目录中的 `ASSET_LICENSE.md` 和 SHA-256

应用图标同样来自项目维护者拥有的土豆资源：

| 文件 | SHA-256 |
| --- | --- |
| `build/icon.icns` | `af1fbc713f8deca936cddf1ab41249058c57e332c0078276228aed65c272e904` |
| `build/icon.ico` | `5801b83916ae066a7cec4adc1b936b4446be9e2e72ddccac59592bb1240fd914` |
| `build/icon.png` | `22b5010e35d33255653a46be4e96e8f65b545ad47567925170f3939f35aefba9` |

## 不复制来源

### cli_ui_pliot / CodePilot

- 当前许可证：BUSL-1.1
- 只借鉴：Electron/React/TypeScript 技术方向、进程职责和发布门禁思想
- 不复制：产品源码、React 组件、Electron 主进程、构建脚本和 workflow 实现
- 新代码以 Electron、Vite、electron-builder 官方文档和本项目需求重新实现

该边界用于保持 Desktop Pet V2 的 MIT 清晰度，并避免影响 SignPath Foundation
免费开源签名方案的申请资格。

## P5 新增第三方组件

| 组件 | 许可证 | 用途 |
| --- | --- | --- |
| `adm-zip` | MIT | 跨平台 ZIP 内容包读取与受控解压 |
| `@napi-rs/keyring` | MIT | macOS Keychain、Windows Credential Manager、Linux Secret Service |
| `@emnapi/runtime` | MIT | Sharp WASM 可选回退依赖的显式可复现运行时 |
| `@emnapi/wasi-threads` | MIT | WASI 线程运行时和可生成 SBOM 的完整依赖树 |

前两项业务组件只在 Electron 主进程使用；Emscripten/WASI 组件用于补全 Sharp 的
跨平台可选依赖树。内容包数据和在线密钥不会直接暴露给 Renderer。
