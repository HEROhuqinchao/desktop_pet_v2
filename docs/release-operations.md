# 发布与签名运维手册

创建者：husu

## 发布通道

| 触发方式 | 用途 | 签名要求 | GitHub Release |
| --- | --- | --- | --- |
| `workflow_dispatch` | 指定平台预览包 | 允许 unsigned | 不创建，仅保留 7 天 Artifact |
| 推送 `vX.Y.Z` 标签 | 稳定版 | macOS 与 Windows 强制签名 | 全平台通过后创建 |

正式标签必须等于 `package.json` 中的 `v${version}`，lockfile 的两个版本字段也必须
一致。发布 job 期待 10 个安装文件：macOS arm64/x64 各 DMG+ZIP，Windows x64
NSIS+portable，Linux x64/arm64 各 AppImage+DEB。

## GitHub 配置

### macOS Secrets

| 名称 | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | Developer ID Application `.p12` 的 base64 或安全 URL |
| `MAC_CSC_KEY_PASSWORD` | `.p12` 密码 |
| `APPLE_API_KEY` | App Store Connect API `.p8` 内容/路径，按 electron-builder 要求配置 |
| `APPLE_API_KEY_ID` | API Key ID |
| `APPLE_API_ISSUER` | Issuer ID |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

正式构建会启用 Hardened Runtime、Developer ID 签名与 notarization，并依次运行
`codesign --verify`、`spctl --assess` 和 `xcrun stapler validate`。任一凭据为空或任一
验证失败，都不会创建 Release。

### Windows SignPath

先向 SignPath Foundation 申请开源项目签名，并把 GitHub 仓库配置为 Trusted Build
System。开源签名要求 origin verification，因此正式产物必须由受信任 workflow 从
仓库源码构建，不能在本机编译后再手工替换。

Secret：

- `SIGNPATH_API_TOKEN`

Repository Variables：

- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_APP_ARTIFACT_CONFIGURATION_SLUG`
- `SIGNPATH_DISTRIBUTION_ARTIFACT_CONFIGURATION_SLUG`

需要在 SignPath 后台依据首次 workflow Artifact 创建两份配置：

1. App 配置：输入/输出根均保留 `unpacked/`，签署主 `.exe` 和本项目携带的
   `.node` PE 文件；可由 SignPath 分析样本后生成，再人工核对匹配数量。
2. Distribution 配置：输入/输出根均保留 `distribution/`，必须精确匹配并签署
   `DesktopPet-*-Setup.exe` 与 `DesktopPet-*-Portable.exe` 两个文件。

workflow 会先签 unpacked app，再从已签目录生成 NSIS/portable，随后第二次签发布
文件。两个阶段都用 Windows SDK SignTool 的 `/pa /all /tw` 做 Authenticode 和
时间戳验证。首次接入仍必须在真实 Windows 安装后检查主程序、卸载器和 portable；
没有这次验收不能把 Windows 正式签名标记为完成。

## SBOM、校验和与更新清单

发布包含：

- `desktop-pet-v2.spdx.json`：npm 生产依赖生成的 SPDX 2.3 JSON。
- `SHA256SUMS.txt`：10 个正式安装文件的 SHA-256。
- `release-manifest.json`：版本、发布时间、发布页及各平台/架构下载地址、大小、
  SHA-256 和签名标记。

正式仓库建立后，在应用设置中填写：

```text
https://github.com/OWNER/REPO/releases/latest/download/release-manifest.json
```

应用只接受 HTTPS（本地调试允许 localhost HTTP），只做手动检查并打开下载地址，
不会静默替换程序。更换仓库时无需重编译应用。

## 本地门禁

```bash
npm ci --registry=https://registry.npmjs.org
npm run check
npm ls --omit=dev --all
npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org
npm --silent run sbom > desktop-pet-v2.spdx.json
node scripts/release.mjs verify
```

macOS 未签名预览：

```bash
npm run pack:mac
```

打包产物通过 `electron-builder.yml` 的 `extraResources` 携带 `data/` 运行时数据
（台词、人格、事件、节日和小游戏配置），在 macOS 包内位于
`Contents/Resources/data/`。新增或调整数据文件后必须同步更新
`scripts/verify-runtime-data.mjs` 的契约清单。

目录包完成后执行打包内容与原生 ABI 门禁：

```bash
node scripts/verify-packaged-native.mjs \
  "release/mac-arm64/Desktop Pet.app/Contents/MacOS/Desktop Pet" \
  "release/mac-arm64/Desktop Pet.app/Contents/Resources"
```

不要把证书、私钥、Token、Apple 密码或 SignPath 输出的临时签名输入提交到仓库。

## 真实平台验收

| 平台 | 安装 | 启动/Keyring | 升级 | 卸载 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| macOS arm64 | unsigned DMG/ZIP 结构通过；2026-08-02 本机目录包与 GitHub Actions 预览打包复验通过 | packaged 启动、5 个 renderer、8 个 data 文件、Keyring/better-sqlite3 ABI 148 通过 | 待正式签名版 | 待正式签名版 | unsigned 预览通过 |
| macOS x64 | 待 GitHub runner/Intel 机器 | 待验证 | 待验证 | 待验证 | 未完成 |
| Windows x64 | 待 SignPath 后真实机器 | 待验证 | 待验证 | 待验证 | 未完成 |
| Linux x64 | 待 X11/Wayland 真机 | 待验证 | 手动下载 | 待验证 | 未完成 |
| Linux arm64 | 待 arm64 runner/真机 | 待验证 | 手动下载 | 待验证 | 未完成 |

正式私有仓库为 <https://github.com/HEROhuqinchao/desktop_pet_v2>。2026-08-02 已完成：

- [`Source Checks`](https://github.com/HEROhuqinchao/desktop_pet_v2/actions/runs/30733253809)：Linux x64、Windows x64、macOS arm64 全部通过。
- [`Build, Sign & Release`](https://github.com/HEROhuqinchao/desktop_pet_v2/actions/runs/30733337367)：`workflow_dispatch` 的 macOS arm64 unsigned 预览通过，生成 `distribution-darwin-arm64` 与 `release-sbom` Artifact。

本次未创建 `v*` 标签，因此正式签名、公证、SignPath 和 GitHub Release 步骤按设计跳过。
