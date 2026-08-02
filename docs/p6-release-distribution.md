# P6 发布、签名与全平台分发

创建者：husu

## 目标

在 P0–P5 功能保持不变的前提下，为 Desktop Pet V2 建立可审计、失败关闭的
跨平台发布链。预览构建可以无证书产出短期 Artifact；`v*` 正式标签必须验证
版本、原生模块、签名配置、产物完整性、SHA-256 和 SBOM 后才能创建 Release。

```mermaid
flowchart LR
    SOURCE["不可变标签源码"] --> GATE["lint / typecheck / test / build"]
    GATE --> MATRIX["macOS / Windows / Linux 原生构建"]
    MATRIX --> SIGN["Developer ID / SignPath"]
    SIGN --> VERIFY["签名、ABI、安装器结构验证"]
    VERIFY --> META["SHA-256 / SPDX SBOM / 更新清单"]
    META --> RELEASE["GitHub Release"]
    RELEASE --> CHECK["应用内手动检查更新"]
```

## 规格场景

### 源码与版本门禁

- PR 和主分支推送必须在 macOS、Windows、Linux 上执行 `npm ci` 和完整检查。
- `vX.Y.Z` 标签必须与 `package.json`、lockfile 根版本完全一致。
- 正式发布必须来自不可变提交，缺少预期平台产物、SBOM 或校验和时停止。
- 生产依赖审计、`npm ls --omit=dev --all` 和 SPDX SBOM 生成必须成功。

### 平台产物

- macOS arm64/x64 分别生成 DMG 和 ZIP。
- Windows x64 生成 NSIS 安装器和 portable 单文件版本，文件名不得冲突。
- Linux x64/arm64 分别生成 AppImage 和 DEB。
- 每个平台必须验证打包后的 `better-sqlite3` 与系统 Keyring 原生模块存在；能在
  当前 runner 执行的架构还必须实际加载模块。

### 签名与公证

- 手动预览构建允许无证书，但要明确标记 unsigned，且不得创建稳定 Release。
- `v*` macOS 构建缺少 Developer ID 或 Apple 公证凭据时失败；成功后验证
  codesign、Gatekeeper 和 stapling。
- `v*` Windows 构建必须经 SignPath 开源项目签名策略处理，并用 SignTool 验证
  Authenticode 与时间戳；缺少任一 SignPath secret/variable 时失败。
- 证书、私钥、Token 和密码只来自 GitHub Secrets，不进入仓库、Artifact 或日志。

### 完整性与更新

- 每个发布文件必须记录平台、架构、字节数和 SHA-256。
- 发布必须附带 SPDX 2.3 JSON SBOM、合并的 `SHA256SUMS.txt` 和版本化更新清单。
- 更新清单地址由用户配置，必须是 HTTPS（仅 localhost 允许 HTTP）。
- 手动检查更新只读取受限 JSON；无配置、网络失败、清单无效、无对应平台产物、
  已是最新版和发现新版都必须返回明确状态。
- 应用只打开清单中的 HTTPS 下载页/产物地址，不静默下载或安装。

### 验收边界

- macOS 在当前机器完成目录包、DMG/ZIP、启动与更新面板验收。
- Windows 和 Linux 的安装、升级、卸载及系统 Keyring 需在对应真实 runner/机器
  验收；仅有交叉编译产物不得标记为真实平台通过。

## 执行任务

- [x] 6.1 跨平台 CI、版本单一来源和生产依赖门禁
- [ ] 6.2 macOS、Windows、Linux 原生安装器矩阵
- [ ] 6.3 原生模块 ABI、产物结构和平台元数据验证
- [ ] 6.4 Developer ID、公证、stapling 和 SignPath 失败关闭流程
- [x] 6.5 SHA-256、SPDX SBOM、Release 聚合和更新清单
- [x] 6.6 应用内更新源配置、手动检查和安全下载入口
- [ ] 6.7 本机验收、跨平台验收清单和发布运维文档

## 参考实现取舍

- 复用 `cli_ui_pliot` 的标签/版本一致性、平台原生构建、原生 ABI 检查、Artifact
  聚合和稳定版门禁。
- 复用旧 `desktop_pet` 的 SignPath fail-closed 结构和 Linux arm64 runner。
- 不迁移 Python/MSIX 专用打包脚本，也不迁移 CodePilot 的 Next.js server 检查。
- 正式仓库为 `HEROhuqinchao/desktop_pet_v2`；更新清单 URL 仍需在首次稳定 Release 前明确配置。

## 当前合规矩阵

| 场景 | 状态 | 证据/剩余条件 |
| --- | --- | --- |
| 三平台源码检查矩阵 | 通过 | [远程运行 30733253809](https://github.com/HEROhuqinchao/desktop_pet_v2/actions/runs/30733253809) 覆盖 Linux x64、Windows x64、macOS arm64 |
| 标签、package、lockfile 版本一致 | 通过 | `release-tools.test.ts`、`release.mjs verify` |
| 生产依赖树、官方源、审计、SPDX | 通过 | `npm ls` 通过，官方审计 0，SPDX 2.3/15 包 |
| macOS arm64 DMG/ZIP | 通过（unsigned） | 本机与 [远程预览运行 30733337367](https://github.com/HEROhuqinchao/desktop_pet_v2/actions/runs/30733337367) 均通过，远程 Artifact 约 291 MB |
| macOS x64 DMG/ZIP | 待验证 | 需要 `macos-15-intel` workflow |
| Windows NSIS/portable | 待验证 | 需要 Windows runner 和两阶段 SignPath 项目配置 |
| Linux x64/arm64 AppImage/DEB | 待验证 | 需要对应 GitHub runner |
| macOS Developer ID/公证/stapling | 待验证 | workflow 已 fail-closed，缺少 Apple 凭据 |
| Windows Authenticode/时间戳 | 待验证 | workflow 已 fail-closed，缺少 SignPath 凭据/配置 |
| 发布文件哈希重算与聚合 | 通过 | 发布工具覆盖正常与篡改拒绝分支 |
| 更新源 HTTPS/localhost 约束 | 通过 | `update-service.test.ts` 与偏好测试 |
| 更新状态完整分支 | 通过 | 6 个单元场景，packaged 本地清单发现 v0.2.0 |
| 系统浏览器下载入口 | 代码通过，未点击 | 避免在验收中打开伪造测试下载地址 |

## 本轮验证结果

- 23 个测试文件、109 个测试用例通过。
- lint、TypeScript 类型检查、Vite/Electron 构建通过。
- `npm ls --omit=dev --all` 通过；npm 官方生产依赖审计 0 个漏洞。
- SPDX 2.3 SBOM 成功生成，包含 15 个生产包。
- actionlint 1.7.12 与本机 YAML 解析均通过。
- packaged Electron ABI 148 实际加载 better-sqlite3 和 Keyring 成功。
- macOS arm64 DMG、ZIP、平台 metadata 和逐文件 SHA-256 成功生成。
- GitHub Actions 三平台源码检查成功；macOS arm64 预览打包、原生模块验证、Artifact 与 SPDX SBOM 上传成功。
- packaged P6 面板实际验证 unconfigured、idle、available 和恢复空配置。

P6 尚未完成的原因是 macOS x64、Windows/Linux 安装验收、Apple Developer ID
和 SignPath 属于仓库外部状态；这些条件未满足前，相关正式发布项保持未勾选。
