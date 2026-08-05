# CI/CD 流水线能力总览

创建者：husu

基线：分支 `fix/ci-cross-platform-release-gates`（2026-08-05）。
项目当前共有 6 条 GitHub Actions 流水线、3 份 `.github/` 配置与 2 个发布
脚本工具。本文逐一说明它们的定位、触发方式、执行内容与相互协作关系；
优缺点评估与改造路线见 [`ci-pipeline-analysis.md`](./ci-pipeline-analysis.md)
与 [`ci-pipeline-improvement-plan.md`](./ci-pipeline-improvement-plan.md)。

## 清单速览

| # | 流水线 / 配置 | 类型 | 一句话定位 |
| --- | --- | --- | --- |
| 1 | `workflows/ci.yml`（Source Checks） | workflow | 三平台源码门禁，代码质量的守门员 |
| 2 | `workflows/codeql.yml`（CodeQL） | workflow | JS/TS 静态安全扫描 |
| 3 | `workflows/dependency-review.yml`（Dependency Review） | workflow | PR 级依赖漏洞阻断 |
| 4 | `workflows/package.yml`（Build, Sign & Release） | workflow | 全平台构建、签名、公证与正式发布的唯一通道 |
| 5 | `workflows/dependency-monitor.yml`（Dependency Monitor） | workflow | 每周依赖健康巡检与自动告警闭环 |
| 6 | `workflows/package-smoke.yml`（Package Smoke） | workflow | 每周打包冒烟，提前暴露打包链路回归 |
| 7 | `dependabot.yml` | 配置 | npm 与 Actions 依赖的周度自动更新 |
| 8 | `codeql-config.yml` | 配置 | CodeQL 分析范围（排除产物目录） |
| 9 | `release.yml` | 配置 | 自动 Release Notes 分类（当前为死配置，见文末） |

## 阶段协作视图

按开发→发布的生命周期看，各流水线的站位：

| 阶段 | 触发的流水线 | 承担职责 |
| --- | --- | --- |
| 开 PR | Source Checks、CodeQL、Dependency Review | 代码质量、安全扫描、依赖漏洞三道门禁 |
| 合并入 main | Source Checks、CodeQL | 主干回归兜底 |
| 手动预览 | Build, Sign & Release（dispatch） | unsigned 预览包，验证打包链路 |
| 推 `v*` 标签 | Build, Sign & Release（tag） | 签名、公证、校验、创建正式 GitHub Release |
| 每周一 | CodeQL（定时）、Dependency Monitor、Package Smoke、Dependabot | 安全兜底、依赖巡检、打包预演、更新提案 |

## 1. Source Checks（ci.yml）

**作用**：所有代码变更的质量门禁。保证进入 main 与 PR 的代码都通过
完整的静态检查与测试，并在 Linux 腿承担生产依赖治理。

触发：`pull_request`（任意 PR）、push `main`、`workflow_dispatch`。

执行内容：矩阵为 `ubuntu-24.04` / `windows-2022` / `macos-15`
（`fail-fast: false`），每个 job 依次执行 `npm ci`（显式锁定
registry.npmjs.org）与 `npm run check`——即 lint、typecheck、
`verify:data`（运行时数据契约）、vitest 全量测试、Electron 构建。
Linux 腿额外执行三项依赖治理：

- `npm ls --omit=dev --all`：生产依赖树清单；
- `npm audit --omit=dev --audit-level=high`：高危漏洞门禁；
- SPDX 2.3 SBOM 生成并校验版本号，作为 `ci-sbom` Artifact 保留 7 天。

设计要点：顶层权限仅 `contents: read`；concurrency 取消同分支旧运行，
PR 快速反馈；Windows 腿的存在曾在 2026-08-02 捕获换行符兼容性缺陷。

## 2. CodeQL（codeql.yml）

**作用**：JavaScript/TypeScript 静态安全扫描，发现注入、路径穿越、
不安全 API 使用等代码级安全缺陷，结果沉淀到仓库 Security 页持续跟踪。

触发：`pull_request`、push `main`、每周一 02:15 UTC 定时兜底、手动。

执行内容：`github/codeql-action` v4，语言 `javascript-typescript`，
查询集 `security-and-quality`；分析范围由 `codeql-config.yml` 排除
`dist/`、`release/`、`node_modules/`（构建产物与第三方代码不参与
分析）。结果通过 `security-events: write`（仅该 job 授权）上传。

仓库为 public，CodeQL 免费可用。定时触发的意义：即使没有新 PR，
查询集升级后也能对存量代码重新出报告。

## 3. Dependency Review（dependency-review.yml）

**作用**：依赖漏洞的第一道拦截。PR 只要触碰 `package.json` /
lockfile，就对比 base 分支分析新增/变更依赖的已知漏洞与许可变更，
把风险拦在合并之前。

触发：仅 `pull_request`。

执行内容：`actions/dependency-review-action@v4`，
`fail-on-severity: high`——高危漏洞阻断 PR，中低危仅提示。与发布
通道的 `npm audit --audit-level=high` 门禁标准一致，等于把同一标准
前移到了 PR 阶段。未变更依赖清单的 PR 直接通过，无额外成本。

## 4. Build, Sign & Release（package.yml）

**作用**：从源码到可分发安装包的唯一通道，也是正式发布的唯一入口。
预览模式产出 unsigned 短期 Artifact 供验证；tag 模式强制完成签名、
公证与 Release 创建，任何凭据缺失都会失败关闭而不是降级发布。

触发：`workflow_dispatch`（可选平台：all / macos-arm64 / macos-x64 /
windows-x64 / windows-store-x64 / linux-x64 / linux-arm64）；
push `v*` 标签。

### verify-source（所有构建的前置）

解析不可变的版本与来源：读取 `package.json` 版本，执行
`scripts/release.mjs verify`（tag 触发时追加 `--tag` 标签一致性与
`--require-clean` 工作区校验）；输出精确 commit 与动态平台矩阵 JSON；
重跑完整 `npm run check`、依赖树/审计门禁与发布版 SBOM（`release-sbom`
Artifact）。所有下游 job 一律 checkout 它输出的精确 commit，保证
"验证过的源码 == 打包的源码"。

### build-macos

arm64（`macos-15`）与 x64（`macos-15-intel`）双架构矩阵。tag 触发时
先强制校验六个 Apple 凭据（`MAC_CSC_*` + `APPLE_API_*`）齐全，再以
Developer ID 签名 + hardenedRuntime + 公证构建；分支触发为 unsigned
预览。打包后统一执行 `verify-packaged-native.mjs` 校验原生模块；tag
构建追加 `codesign --verify`、`spctl --assess`、`xcrun stapler
validate` 三重验证。产出 DMG + ZIP + checksums + build-meta。

### build-windows

两阶段 SignPath 开源签名流程：

1. 先构建 unsigned unpacked app 并上传，提交 SignPath 签署主 exe 与
   全部 `.node` PE 文件；
2. 用已签目录通过 `--prepackaged` 生成 NSIS 安装器与 portable，再
   第二次提交 SignPath 签署外层安装包。

每个阶段返回后都用 Windows SDK SignTool `verify /pa /all /tw` 逐文件
做 Authenticode + 时间戳验证。tag 触发时 SignPath 的 Secret 与五个
Repository Variables 缺一即失败。分支触发为 unsigned 预览。产出
Setup.exe + Portable.exe + checksums + build-meta。

### build-windows-store

仅手动触发、独立于 Release 与 SignPath 通道。构建 Microsoft Store
AppX：支持 Partner Center 正式产品标识（三个 `MS_STORE_*` Variables
覆盖，必须同时配置），构建后用 `makeappx unpack` 解包校验 Manifest 的
Identity Name / Publisher / PublisherDisplayName 三件套。AppX 不签名，
上传商店后由 Microsoft 重签名。产出 Store.appx + checksum + build-meta。

### build-linux

x64（`ubuntu-24.04`）与 arm64（`ubuntu-24.04-arm`）双架构矩阵，安装
`libsecret-1-0` 运行时库，产出 AppImage + DEB + checksums + build-meta，
并执行原生模块校验。Linux 包不签名（`--signed false`）。

### release（仅 tag 触发）

聚合全部 `distribution-*` Artifact 与 SBOM，执行
`scripts/release.mjs merge`：按 SHA-256 逐文件复核哈希与大小、强制五
平台（darwin-arm64/x64、win32-x64、linux-x64/arm64）齐全、darwin 与
win32 必须标记已签名，生成 `release-manifest.json` 与 `SHA256SUMS.txt`；
最后 `gh release create --verify-tag` 发布 13 个文件（10 个安装包 +
checksums 清单 + manifest + SBOM），防止覆盖已有 Release。该 job 是全
workflow 唯一持有 `contents: write` 的位置。

## 5. Dependency Monitor（dependency-monitor.yml）

**作用**：依赖健康的每周巡检与告警闭环。弥补"门禁只在变更时运行"的
盲区——漏洞数据库是持续更新的，不改代码也可能从合规变为不合规。

触发：每周一 03:00 UTC、`workflow_dispatch`。

执行内容（ubuntu-24.04）：

- `npm audit --omit=dev --audit-level=high`：生产依赖高危审计；
- Electron 版本落后检查：对照 electron/electron 最新 release，落后
  超过两个大版本即告警（提醒规划升级，原生模块 ABI 随之评估）；
- SPDX 2.3 SBOM 重生成并校验，作为 `weekly-sbom` Artifact 保留 14 天。

告警闭环：任一门禁失败，通过 `actions/github-script` 创建固定标题
`[Dependency Monitor] 每周依赖监控告警`、带 `dependencies` 标签的
Issue 并附运行链接；若已存在同类 Issue 则追加评论；全部恢复后自动
评论并关闭。依赖仓库开启 Issues 功能。

## 6. Package Smoke（package-smoke.yml）

**作用**：正式发布前的每周打包预演。Electron 应用的打包链路
（electron-builder、原生模块 prebuild/rebuild、asar 打包）与源码
测试相互独立，依赖升级或工具链变化可能只在打包阶段暴露；冒烟把这类
回归的发现时间从"发布当天"提前到"每周一"。

触发：每周一 03:30 UTC、`workflow_dispatch`。

执行内容（ubuntu-24.04，仅 Linux x64 单平台以控制 Actions 配额）：
安装 `libsecret-1-0` → `npm ci` → `npm run build` → unsigned 预览打包
（AppImage + DEB）→ `verify-packaged-native.mjs` 校验原生模块平台与
ABI → 唯一性断言（AppImage/DEB 各恰好 1 个）→ `release.mjs metadata`
生成元数据与 checksums。产物作为 `smoke-linux-x64` Artifact 保留 7 天。

与 package.yml 的 build-linux 复用同一套校验脚本，但不触碰签名凭据
与发布通道，失败不影响任何发布流程，只作为预警。

## 7. Dependabot（dependabot.yml）

**作用**：依赖更新引擎，让 lockfile 与 Actions 版本保持新鲜，为
漏洞修复与 action SHA 钉版本策略（改造方案 P1-2）提供持续的更新载体。

策略：

- npm 生态，每周一 04:00 UTC：生产依赖与开发依赖的 minor+patch 各自
  分组提 PR；上限 10 个并行 PR；
- `electron` 的大版本升级被 ignore——Electron 大版本牵动原生模块 ABI、
  打包验收与发布流程，必须手工推进（Dependency Monitor 会持续提醒
  落后幅度）；
- github-actions 生态，每周一：上限 5 个并行 PR，用于跟进
  checkout/setup-node/artifact 等 action 的版本与 SHA 更新。

## 8. release.yml（自动 Release Notes 配置）

定义了按标签分类（新功能/修复/其他变更）的自动变更日志。**当前为死
配置**：正式 Release 由 `gh release create --notes-file
RELEASE_NOTES.md` 创建，不会使用自动 notes。改造方案 P2-3 建议删除；
若未来改回 `--generate-notes`，此配置才会生效。

## 发布脚本工具（被流水线复用）

- `scripts/release.mjs`：三个子命令——`verify`（SemVer/tag/lockfile
  一致性、发布必需文件清单、工作区干净校验）、`metadata`（平台产物
  SHA-256 与 build-meta JSON）、`merge`（聚合复核 + manifest +
  SHA256SUMS，含 HTTPS/凭据 URL 安全检查）。
- `scripts/verify-packaged-native.mjs`：在打包产物内部校验
  better-sqlite3 与 @napi-rs/keyring 的平台文件与 Electron ABI，被
  package.yml 三个构建 job 与 Package Smoke 复用。

## 防线与闭环总结

漏洞治理形成三段防线：Dependency Review 在 PR 阶段拦截新增高危依赖；
Source Checks 与 Build, Sign & Release 的 `npm audit` 门禁在每次变更
与发布时复核；Dependency Monitor 每周对存量依赖兜底并自动建单跟踪。

依赖更新闭环：Dependabot 每周提更新 PR → 同一 PR 自动经过 Dependency
Review、Source Checks、CodeQL 三道门禁 → 合并后进入发布通道。

发布质量闭环：main 保持 CI 全绿 → 手动 dispatch 预览验证打包 → 每周
Package Smoke 持续预演打包链路 → 凭据就绪后推 tag → 失败关闭的签名/
公证/哈希复核 → 不可变的 GitHub Release。

已知限制（详见改造方案）：签名 job 尚无 environment 审批闸门；第一方
action 尚未全部钉 SHA；无构建溯源 attestation；`release` job 存在
"13 个文件"硬编码；无 electron-updater 更新 feed。
