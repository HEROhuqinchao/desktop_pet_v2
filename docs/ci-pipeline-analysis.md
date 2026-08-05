# GitHub Actions 流水线现状分析

创建者：husu

分析基线：分支 `fix/ci-cross-platform-release-gates`（基于 `18ff20b` v0.1.1 发布提交），
结合 2026-07-31 至 2026-08-04 的 GitHub Actions 真实运行记录。

各流水线"做什么"的完整功能说明见 [`ci-pipelines-overview.md`](./ci-pipelines-overview.md)；
本文聚焦优点、缺点与真实运行证据。

## 流水线构成

| 文件 | 名称 | 触发方式 | 职责 |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | Source Checks | `pull_request`、push `main`、手动 | 三平台源码门禁（lint/typecheck/verify:data/test/build），Linux 额外做依赖树、审计与 SBOM |
| `.github/workflows/package.yml` | Build, Sign & Release | `workflow_dispatch`（预览）、push `v*` 标签（正式） | 全平台构建、签名、公证、校验与 GitHub Release |
| `.github/workflows/codeql.yml` | CodeQL | `pull_request`、push `main`、每周一、手动 | JavaScript/TypeScript 静态安全扫描（security-and-quality） |
| `.github/workflows/dependency-review.yml` | Dependency Review | `pull_request` | 阻断引入已知高危漏洞依赖的 PR |
| `.github/workflows/dependency-monitor.yml` | Dependency Monitor | 每周一、手动 | 生产依赖审计、Electron 版本落后检查、SBOM 重生成；失败自动建 Issue，恢复自动关闭 |
| `.github/workflows/package-smoke.yml` | Package Smoke | 每周一、手动 | Linux x64 unsigned 预览打包冒烟，提前暴露原生模块 ABI / electron-builder 回归 |
| `.github/release.yml` | 自动 Release Notes 配置 | — | 按标签分类生成变更日志（当前未生效，见缺点 D4） |
| `.github/dependabot.yml` | Dependabot 配置 | 每周一 | npm 与 github-actions 依赖更新 PR（Electron 大版本除外） |
| `scripts/release.mjs` | 发布工具 | 被 workflow 调用 | 版本/标签/lockfile 一致性校验、平台元数据、SHA-256、清单聚合 |
| `scripts/verify-packaged-native.mjs` | 打包校验 | 被 workflow 调用 | 校验打包产物中原生模块（better-sqlite3 / keyring）的平台与 ABI |

### Source Checks（ci.yml）

矩阵为 `ubuntu-24.04` / `windows-2022` / `macos-15`，`fail-fast: false`，
顶层权限 `contents: read`，concurrency 取消同分支旧运行。每个 job 执行
`npm ci` + `npm run check`；Linux 腿追加 `npm ls --omit=dev --all`、
`npm audit --omit=dev --audit-level=high` 与 SPDX 2.3 SBOM 生成及版本校验，
SBOM 作为 `ci-sbom` Artifact 保留 7 天。

### Build, Sign & Release（package.yml）

共 7 个 job，依赖链为 `verify-source → build-* → release`。自
`7bbed85` 起采用三模式发布：`verify-source` 解析出 `release-mode`
（preview / unsigned / signed），各签名步骤以 `release-mode == 'signed'`
为条件而非 ref 类型：

- `verify-source`：fetch-depth 0，解析 package.json 版本、精确 commit
  与 release-mode（`vX.Y.Z`→signed、`vX.Y.Z-unsigned`→unsigned、
  dispatch 默认 preview）；Release 模式执行 `release.mjs verify --tag
  --release-mode --require-clean`；重跑完整 `npm run check`、依赖审计
  与 SBOM；输出动态平台矩阵 JSON。
- `build-macos`：arm64（`macos-15`）/ x64（`macos-15-intel`）矩阵。signed
  模式强制六个 Apple 凭据非空，使用 Developer ID 签名 + hardenedRuntime +
  公证；preview/unsigned 为未签名包。打包后校验原生模块，signed 构建追加
  `codesign --verify`、`spctl --assess`、`xcrun stapler validate`。
- `build-windows`：signed 模式两阶段 SignPath 开源签名——先签 unpacked
  app（主 exe 与 `.node` PE 文件），再用已签目录通过 `--prepackaged` 生成
  NSIS/portable，第二次签外层安装包。每阶段用 Windows SDK SignTool
  `verify /pa /all /tw` 逐文件做 Authenticode + 时间戳验证。preview/unsigned
  直接以未签名目录产出。
- `build-windows-store`：仅手动触发且仅 preview 模式，独立于
  Release/SignPath 通道。AppX 不签名（商店重签名），但会用
  `makeappx unpack` 解包校验 Manifest 的 Identity Name / Publisher /
  PublisherDisplayName 三件套，支持 Repository Variables 覆盖
  Partner Center 正式产品标识（三项必须同时配置）。
- `build-linux`：x64（`ubuntu-24.04`）/ arm64（`ubuntu-24.04-arm`）矩阵，
  安装 `libsecret-1-0`，产出 AppImage + DEB。
- `release`：signed 与 unsigned 模式触发，聚合全部 `distribution-*`
  Artifact 与 SBOM，`release.mjs merge` 按 SHA-256 重新校验每个文件、
  强制五平台齐全；signed 模式追加 `--require-signed darwin,win32`。
  `gh release create --verify-tag` 发布 13 个文件；unsigned 模式追加
  `--prerelease` 并生成未签名警示 notes。

## 实际运行证据（截至 2026-08-04）

| 现象 | 证据 | 结论 |
| --- | --- | --- |
| Source Checks 自 2026-08-02 下午起 push main 全部失败 | 每次仅 `Check windows-x64` 失败，注解指向 `tests/release-tools.test.ts:254` | Windows runner 默认检出 CRLF，对 `electron-builder.yml` 的 LF 子串断言必然失败；仓库无 `.gitattributes` |
| v0.1.0、v0.1.1 两次 tag 发布失败 | macOS job 失败于 `正式 macOS 发布缺少 CSC_LINK`；Windows job 失败于 SignPath 配置门禁；`release` 被跳过 | 签名凭据从未在仓库配置，正式发布通道未打通 |
| GitHub Releases 列表为空 | `gh api repos/.../releases` 返回空 | 从未成功产出过一次正式 Release |
| `workflow_dispatch` 预览多次成功 | 08-02、08-04 多次 success | 预览链路健康，问题集中在 Windows 测试与签名配置 |

## 优点

1. **最小权限模型**。顶层 `permissions: contents: read`，只有 `release` job
   单独提升到 `contents: write`；SignPath action 钉死 commit SHA；
   全程 `npm ci` 并显式 `--registry=https://registry.npmjs.org`。
2. **供应链门禁**。lockfile 驱动的依赖安装、`npm audit --omit=dev
   --audit-level=high` 只审计生产依赖、SPDX 2.3 SBOM 生成并校验版本号、
   生产依赖树清单，均在 CI 与发布双通道执行。
3. **签名与验证深度超出一般水准**。macOS 走 hardenedRuntime + 公证 +
   `stapler`/`spctl`/`codesign` 三重验证；Windows 两阶段 SignPath 后对
   主 exe、全部 `.node` 与外层安装包逐一 Authenticode 验证；Store AppX
   解包校验 Manifest 身份。正式构建缺凭据时先显式失败而不是静默跳过。
4. **产物完整性闭环**。tag ↔ package.json ↔ lockfile 版本一致性校验、
   tag 发布要求工作区干净、下游 job 一律 checkout `verify-source` 输出的
   精确 commit；每平台 checksums + build-meta JSON，聚合时按 SHA-256
   复核每个文件，产出 `release-manifest.json`、`SHA256SUMS.txt`，
   `gh release create --verify-tag` 防止覆盖已有 Release。
5. **预览与正式彻底分离**。手动触发只产出 7 天留存的 unsigned Artifact，
   tag 触发强制签名凭据，杜绝 unsigned 产物混入正式渠道。
6. **工程细节规范**。runner 标签钉版本、所有 job 有 timeout、发布
   concurrency 不取消在跑构建（`cancel-in-progress: false`）、矩阵覆盖
   mac arm64/x64 + linux x64/arm64 + win x64 并启用 `ubuntu-24.04-arm`。
7. **发布工具自身有测试**。`tests/release-tools.test.ts` 覆盖标签校验、
   元数据、哈希复核、原生模块选择与 Store 配置等 13 个用例。

## 缺点与风险

按严重程度排序，P0 两项已在本分支修复：

### P0-A Windows CI 持续失败（已修复）

无 `.gitattributes`，Windows runner 检出 CRLF，`readFileSync` 后断言
LF 子串必然失败。main 自 2026-08-02 起一直是红的，任何依赖 CI 信号的
流程（合并判断、发布门禁）都不可信。修复：`.gitattributes` 强制 LF +
测试侧换行归一化（commit `62f4aa2`）。

### P0-B 正式发布被签名凭据卡死（文档已补，凭据待配置）

六个 Apple 凭据与 SignPath Secret/Variables 全部未配置，v0.1.0/v0.1.1
均中途失败。凭据只能由仓库管理员在 GitHub 后台配置，本分支已在
`docs/release-operations.md` 增加"打标签前检查清单"与配置状态表。

### P1 安全加固空间

1. **签名凭据无人工闸门**。`MAC_CSC_LINK`、`SIGNPATH_API_TOKEN` 直接暴露给
   tag push 触发的 job，任何能推 tag 的身份都能消费签名凭据；未使用
   `environment:` + 必填审批人。
2. **第一方 action 未钉 SHA**。checkout/setup-node/upload/download-artifact
   使用 `@v7`/`@v8` 大版本标签，与 SignPath 的钉法不一致，供应链标准不统一。
3. **缺少构建溯源**。无 `actions/attest-build-provenance` 证明；SBOM 只覆盖
   npm 生产依赖，不含 Electron 二进制本体。

### P2 结构与维护性

1. **重复门禁**。`verify-source` 串行重跑 `npm run check` + 审计 + SBOM
   （约 4 分钟），与 main CI 完全重复；tag push 时两个 workflow 还会并行
   重复执行同样的检查。
2. **会腐烂的魔法数字**。`release` job 硬编码"文件数应为 13"，新增平台或
   产物形态需手工同步；`find ... | head -1`、`Select-Object -First 1`
   在多匹配时静默取第一个而不是报错。
3. **死配置**。`.github/release.yml` 的自动 release notes 分类永不生效
   （`gh release create` 使用 `--notes-file RELEASE_NOTES.md`）。
4. **次要项**。package.yml 顶层 `actions: read` 权限未见使用点；Node 版本
   在两个 workflow 各写一份，缺少单一事实来源。

### P3 能力缺口

1. **无自动更新通道**。所有 electron-builder 均 `--publish never`，未生成
   `latest*.yml` 更新 feed；若未来接入 electron-updater，流水线需要补
   更新元数据产出与发布。
2. **Intel macOS runner 依赖**。`macos-15-intel` 依赖 GitHub 的 Intel mac
   runner 供给，该系列在 GitHub 路线图中持续收缩，需要关注可用性并准备
   降级方案（如仅保留 arm64 + 本地 x64 验证）。
3. `.github/workflows/` 无 CODEOWNERS 保护，流水线变更无强制评审人。
