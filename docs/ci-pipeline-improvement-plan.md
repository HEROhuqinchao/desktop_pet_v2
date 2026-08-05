# GitHub Actions 流水线改造方案

创建者：husu

配套分析见 [`ci-pipeline-analysis.md`](./ci-pipeline-analysis.md)。
本方案按优先级给出具体改动、示例代码与验收标准；P0 已在分支
`fix/ci-cross-platform-release-gates`（commit `62f4aa2`）完成。

## 改造总览

| 优先级 | 目标 | 状态 |
| --- | --- | --- |
| P0 | Windows CI 转绿；发布前置条件文档化 | 已完成（代码）/ 凭据待配置 |
| P1 | 签名凭据加人工闸门；action 钉 SHA；构建溯源 | 待实施 |
| P2 | 去重门禁；消除魔法数字；清理死配置 | 待实施 |
| P3 | 自动更新通道；runner 风险预案；CODEOWNERS | 规划中 |
| 能力补齐 | CodeQL、依赖审查、每周依赖监控、打包冒烟、Dependabot | 已完成 |

## P0：止血（已完成）

### P0-A 换行符导致的 Windows CI 失败

- 新增 `.gitattributes`：`* text=auto eol=lf`，图片/`.node`/压缩包标记
  `binary`，保证 Windows runner 检出 LF。
- `tests/release-tools.test.ts` 增加 `readRepositoryText` 助手，读取仓库
  文本时统一 `replace(/\r\n/g, '\n')`，断言不再依赖 checkout 行为。

验收：PR 触发的 `Check windows-x64` 转绿；CRLF 模拟脚本验证旧逻辑失败、
新逻辑通过（已执行）。

### P0-B 发布凭据前置清单

`docs/release-operations.md` 新增"打标签前检查清单"与配置状态表，
明确 macOS 六项 Secrets、SignPath 一项 Secret + 五项 Variables 未配置前
不推 `v*` 标签。

验收（人工）：在 GitHub 仓库 Settings → Secrets and variables → Actions
补齐凭据后，将状态表更新为"已配置"，再推送下一个版本标签。

## 已实施：能力补齐流水线

在既有 Source Checks / Build, Sign & Release 之外新增四条流水线与一份
Dependabot 配置，覆盖安全扫描、依赖治理与回归预警：

1. **CodeQL（`.github/workflows/codeql.yml`）**：JavaScript/TypeScript
   静态安全扫描（`security-and-quality` 查询集），PR 与 main push 必跑，
   每周一 02:15 UTC 定时兜底。分析范围经 `.github/codeql-config.yml`
   排除 `dist/`、`release/`、`node_modules/`。结果上传到代码安全页
   （`security-events: write` 仅限该 job）。
2. **Dependency Review（`.github/workflows/dependency-review.yml`）**：
   PR 级依赖变更审查，`fail-on-severity: high`，阻断引入已知高危漏洞
   的依赖升级；与发布通道的 `npm audit --audit-level=high` 门禁对齐，
   把漏洞拦截点从发布前移到 PR。
3. **Dependency Monitor（`.github/workflows/dependency-monitor.yml`）**：
   每周一 03:00 UTC 定时执行生产依赖审计、Electron 版本落后检查
   （落后官方超过两个大版本即告警）与 SPDX 2.3 SBOM 重生成（保留
   14 天）。任一门禁失败自动创建 `dependencies` 标签的固定标题 Issue
   并附运行链接，恢复后自动评论并关闭。需要仓库开启 Issues。
4. **Package Smoke（`.github/workflows/package-smoke.yml`）**：每周一
   03:30 UTC 在 Linux x64 做一次 unsigned 预览打包冒烟，复用
   `verify-packaged-native.mjs` 与 `release.mjs metadata` 校验，提前
   暴露 Electron/原生模块 ABI 漂移与 electron-builder 回归；只跑单
   平台控制 Actions 配额，不触碰签名与发布通道。产物保留 7 天。
5. **Dependabot（`.github/dependabot.yml`）**：npm 与 github-actions
   生态每周一更新；生产/开发依赖的 minor+patch 分组提 PR；Electron
   大版本升级被 ignore（涉及原生模块 ABI 与发布验收，手工推进）。
   与 P1-2 的 action 钉 SHA 策略配套：SHA 升级由 Dependabot PR 承载。

验收：actionlint 全部通过；`npm run check` 全绿。新流水线在 PR 创建后
由 GitHub 侧实际运行确认（CodeQL/Dependency Review 随 PR 触发，两条
定时任务首个周一自动运行，也可手动 `workflow_dispatch` 提前验证）。

## P1：安全加固

### P1-1 签名 job 增加环境审批闸门

为消费签名凭据的 job 引入受保护 environment，进入 signed 发布模式
（仍由 `vX.Y.Z` 标签触发）后先经人工批准：

```yaml
# package.yml：build-macos、build-windows、release 三个 job 增加
    environment: release
```

随后在仓库 Settings → Environments → `release` 配置 Required reviewers。
preview 与 unsigned 模式不受影响，因为签名步骤只在
`release-mode == 'signed'` 时执行。

验收：推送测试 `vX.Y.Z` 标签后，signed 模式的签名 job 停在等待审批
状态，批准前不出现任何签名凭据调用日志。

### P1-2 第一方 action 统一钉 SHA

将 `actions/checkout`、`actions/setup-node`、`actions/upload-artifact`、
`actions/download-artifact` 全部改为完整 SHA + 版本注释，与 SignPath
action 的钉法一致，例如：

```yaml
- uses: actions/checkout@<full-sha> # v7.x.y
```

可同时为 `github-actions` 生态启用 Dependabot，保持 SHA 跟随上游更新
（已通过 `.github/dependabot.yml` 启用，见"已实施：能力补齐流水线"）。

验收：`grep -R "uses: actions/" .github` 不再出现裸大版本标签。

### P1-3 构建溯源证明

`release` job 增加 `id-token: write` 权限，对最终 13 个发布文件生成
构建来源证明，并与 SBOM 一起随 Release 发布：

```yaml
    permissions:
      actions: read
      contents: write
      id-token: write
    steps:
      # ...现有聚合步骤之后
      - uses: actions/attest-build-provenance@<full-sha> # v2.x.y
        with:
          subject-path: artifacts/DesktopPet-*
```

验收：Release 资产页可见 attestation；`gh api` 或 Sigstore 可验证产物
构建来源指向本仓库的 tag workflow。

## P2：结构优化

### P2-1 公共初始化抽成 composite action

新增 `.github/actions/setup-env/action.yml`，收敛 checkout + Node 22 +
`npm ci`，两个 workflow 引用同一实现，防止漂移：

```yaml
name: Setup environment
description: Checkout, install Node and locked npm dependencies
runs:
  using: composite
  steps:
    - uses: actions/checkout@<full-sha> # v7.x.y
      with: ${{ inputs.checkout-with }}
    - uses: actions/setup-node@<full-sha> # v7.x.y
      with:
        node-version: 22
        cache: npm
        registry-url: https://registry.npmjs.org
    - run: npm ci --registry=https://registry.npmjs.org
      shell: bash
```

Node 版本也随之有了单一事实来源。验收：两个 workflow 中不再出现重复
的 setup-node/npm ci 配置块。

### P2-2 消除魔法数字与首匹配陷阱

- `release` job 的"文件数应为 13"改为按 `--expected` 平台列表与
  `release-manifest.json` 中的 artifact 条目数推导：安装文件数 =
  manifest artifacts 数（10）+ `SHA256SUMS.txt` + `release-manifest.json`
  + `desktop-pet-v2.spdx.json`。
- `find release -maxdepth 4 -name "Desktop Pet.app" | head -1` 与
  PowerShell `Select-Object -First 1` 改为唯一性断言：匹配数必须为 1，
  否则报错退出，避免多产物时静默取错。

验收：单测/演练中故意多放一个同名文件，脚本显式失败。

### P2-3 清理死配置

删除 `.github/release.yml`（自动 notes 从未生效，Release 使用
`--notes-file RELEASE_NOTES.md`）。若未来想改回自动 notes，再连同
`gh release create --generate-notes` 一起引入。

验收：删除后正式发布流程演练不受影响。

### P2-4（可选）去重发布前置门禁

`verify-source` 目前串行重跑完整 check + 审计 + SBOM（约 4 分钟）。
两种思路，按成本择一：

1. 保守：维持现状，接受重复成本（当前方案，简单可靠）。
2. 进取：tag workflow 改为 `workflow_run` 监听 main 上 Source Checks
   成功后触发，`verify-source` 只保留版本/标签/lockfile 校验与 SBOM，
   审计结果复用 CI。需要处理"tag 不在 CI 成功的 commit 上"的边界
   （tag 指向的 commit 必须等于 CI 绿commit，否则回退全量检查）。

验收：tag 发布总时长下降且未放松任何既有校验。

## P3：能力补齐与风险预案

### P3-1 自动更新通道（需求确认后再做）

若产品规划接入 electron-updater：构建阶段改为生成 `latest-mac.yml` /
`latest.yml`（electron-builder `--publish` 或单独产出），随 Release 一并
上传，并在 `release-manifest.json` 中登记。当前应用只做手动检查更新
（下载 `release-manifest.json`），此项不阻塞现有发布。

### P3-2 Intel macOS runner 预案

关注 `macos-15-intel` 可用性公告。退路：x64 mac 包改为低频手动/本地
构建 + 公证，Release 矩阵收缩为 arm64；在 `release.mjs merge` 的
`--expected` 中同步移除 `darwin-x64`。

### P3-3 CODEOWNERS

新增 `.github/CODEOWNERS`：

```text
/.github/ @HEROhuqinchao
/scripts/release.mjs @HEROhuqinchao
```

配合分支保护要求评审，防止流水线与发布工具被无评审修改。

## 实施顺序建议

1. 合并 P0 分支，确认 PR 的三平台 CI 全绿。
2. 在 GitHub 后台补齐 macOS 与 SignPath 凭据，更新
   `release-operations.md` 状态表。
3. 单独分支实施 P1（environment 审批 + SHA 钉版本 + attestation），
   用一次 `v0.1.2` 真实发布作为端到端验收：首次走通签名、公证、
   SignPath 两阶段与 Release 创建。
4. P2 随日常迭代分批合入，每项独立提交便于回滚。
5. P3 按产品需求排期。

## 回归基线

每批改动合入后必须满足：

- `pull_request` 三平台 Source Checks 全绿；
- `workflow_dispatch` 全平台预览构建成功；
- `release.mjs verify` 本地通过；
- 正式发布（tag）端到端成功且 Release 资产为 13 个文件、
  `release-manifest.json` 哈希全部复核通过。
