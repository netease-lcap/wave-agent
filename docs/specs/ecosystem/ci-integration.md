---
name: "CI/CD 集成"
description: "在 GitHub Actions / GitLab CI 里跑 wave：可复用 workflow 与 job 模板、凭证注入、审查专用最小工具集、结果 JSON 产物"
order: 90
---

# 功能规格说明：CI/CD 集成

**规格文件**：`docs/specs/ecosystem/ci-integration.md`
**创建日期**：2026-10-30

## 用户场景与测试 _(必填)_

### 用户故事：在 GitHub Actions 里一条 `uses` 就触发 AI 审查（优先级：P0）

作为维护仓库的开发者，我希望在 PR 上加一段 `uses: netease-lcap/wave-agent/.github/workflows/review.yml@v1`、把模型凭证放进 repository secret，就自动跑一次 AI 审查并收到 PR 评论，以便不必自己拼「装 CLI + 认证 + 权限 + 回评论」这四步。

**优先级原因**：这是「CI/CD 流水线插件」的产品化封装本身；没有它，用户要手写安装、认证、权限模式与结果回传，等于没交付。

**独立测试**：在一个模板化的示例仓库里，只加一个 job 级 `uses` 与一个 `WAVE_API_KEY` secret，对含有变更的分支提一个 PR，断言：workflow 成功、PR 上出现审查评论、job 产物里有结果 JSON。

**验收场景**：

1. **假设** workflow 里使用 `uses: netease-lcap/wave-agent/.github/workflows/review.yml@v1` 并给了 `prompt`，**当** job 运行时，**则** 可复用 workflow 自行完成 Node 环境准备与 CLI 安装，调用方不需要写 `npm i -g wave-code`。
2. **假设** 只配了 `WAVE_API_KEY`（以及可选的 `WAVE_BASE_URL`）secret，**当** workflow 运行时，**则** 凭证通过环境变量注入到 CLI 的配置链，无需在 CI 里写 `~/.wave/settings.json`，也不出现在日志里。
3. **假设** 本次运行正常结束，**当** workflow 收尾时，**则** 结果 JSON（`--output-format json` 的信封）写入工作区文件并作为 job 产物上传，文件名与路径固定可引用。
4. **假设** 本次运行失败（模型不可用、凭证无效等），**当** workflow 收尾时，**则** job 失败（退出码非 0），且结果 JSON 里 `is_error` 为 `true`、失败原因在 `errors` 里。
5. **假设** 跑的是审查类提示词，**当** workflow 运行时，**则** 默认只放行只读工具集（读文件、搜内容、`git` 查询、`gh`/`glab` 查询与评论），不授予写文件、改配置、执行任意命令的能力。
6. **假设** 当前分支存在 PR，**当** 审查产出发现时，**则** 评论由内置技能自己发出（`gh pr comment`），workflow 不重复发一条。

---

### 用户故事：在 GitLab CI 里跑同一套（优先级：P1）

作为用 GitLab 的团队，我希望拿到一段可直接粘进 `.gitlab-ci.yml` 的 job，用 masked 变量提供凭证，以便不依赖 GitHub 专用能力。

**优先级原因**：GitLab 是私有化部署的主战场，模板体量小，但缺了就等于只支持一半客户。

**独立测试**：把模板段粘进示例仓库的 `.gitlab-ci.yml`，配置 `WAVE_API_KEY`（masked）与 `GITLAB_TOKEN`，对 MR 提一次提交，断言 pipeline 成功、MR 上出现评论、job artifacts 里有结果 JSON。

**验收场景**：

1. **假设** 用户粘贴模板段并配置了 masked 变量 `WAVE_API_KEY`，**当** pipeline 运行时，**则** job 完成 CLI 安装与调用，不需要额外的 before_script。
2. **假设** 环境里有 `glab` 与可用的 `GITLAB_TOKEN`，**当** 审查产出发现时，**则** 评论以 MR note 形式发出。
3. **假设** 用户没配 `GITLAB_TOKEN`，**当** 运行时，**则** 审查照常进行、结果落在 artifacts 里，只是不发评论（不因此失败）。

---

### 用户故事：把结果 JSON 当上游数据用（优先级：P1）

作为在流水线里聚合质量报告的工程师，我希望 workflow/job 的产物里有稳定的结果 JSON，以便后续步骤（门禁判定、报告归档）读它而不是解析日志。

**优先级原因**：这是「质量报告生成」那一项的输入；把产物约定死在文档里，后续步骤才可能加而不破坏用户。

**独立测试**：在 workflow 里断言该文件的路径存在、能 `jq` 出 `subtype` / `result` / `tool_calls` 字段。

**验收场景**：

1. **假设** 有下游步骤需要读取结果，**当** workflow 结束时，**则** 结果 JSON 位于约定的固定路径（见 FR-3），且 job outputs 提供 `result` / `subtype` / `is-error` / `result-file` 四项。
2. **假设** 用户把 `output-format` 设为 `stream-json`，**当** 运行时，**则** 产物是逐行事件流文件，末行仍是 `result` 事件，下游仍可用「取末行」的方式读到结果。

---

### 用户故事：在无交互环境里不卡在权限确认（优先级：P0）

作为在 CI 里跑 wave 的执行者，我希望在没有任何人值守的情况下不会因为权限确认而挂住或空转，以便流水线能稳定结束。

**优先级原因**：CI 里没有 stdin 交互；一旦某个工具调用进入「等待确认」，job 会一直卡到超时，这比失败更糟。

**独立测试**：在受限工具集下跑一个必然需要工具调用的提示词，断言运行在无 stdin 的环境里正常结束、没有权限等待。

**验收场景**：

1. **假设** 在 CI（无 TTY、无 stdin 输入）中运行，**当** 模型调用只读工具时，**则** 工具直接执行，不发出权限请求、不等待输入。
2. **假设** 模型尝试调用未被允许的工具，**当** 该调用发生时，**则** 权限被拒并作为工具结果返回给模型，运行继续结束（不挂起、不重试等待）。

---

### 边界情况

- **封装形态**：用主仓库的可复用 workflow（`uses: owner/repo/.github/workflows/<file>.yml@ref`）——它只取那一个 yml，不下载仓库快照，也就谈不上仓库越大越慢。**不为此新建独立仓库**：本仓库是 public，一条 `uses` 已经完成封装，独立仓库只会多出版本同步与内网镜像成本。**本轮也不提供 step 级的 composite action**：真要用「插进已有 job」时再按同一套输入与产物约定补，不另起一套设计。
- **CI 里的权限预设**：`--permission-mode dontAsk` + 收窄的 `--tools`。无 callback 时受限工具一律被拒、拒绝原因作为工具结果回到模型，运行照常收尾（不会等待输入）；技能自己在 frontmatter 里声明的 `allowed-tools` 在执行时注册为临时规则，所以审查需要的 `git` / `gh` 查询无需在模板里再抄一遍。
- **PR 来自 fork**：默认 `GITHUB_TOKEN` 对 fork PR 是只读的，发评论会失败。文档必须给出两条路径：改用 `pull_request_target`（注明风险：不要 checkout 不可信代码后执行）或使用带 `pull-requests: write` 的 token。
- **凭证缺失**：没有 `WAVE_API_KEY` 且没有登录态时报错退出（退出码 1），结果 JSON 的 `errors` 里有原因，而不是静默产出空结果。
- **CLI 版本固定**：默认装最新版会让流水线在别人发版后行为漂移，文档要求 pin 版本（`wave-version`），可复用 workflow 的默认值也必须是明确的版本号而不是隐式 latest。
- **结果文件已存在**：上次运行的产物不得被误读，每次运行先覆盖再写。
- **超时**：审查可能跑很久，模板给出 `timeout-minutes` 建议值，不写死到可复用 workflow 内部。
- **私有 npm / 内网模型网关**：`WAVE_BASE_URL` 与 registry 都可配置，模板不假设公网可达。
- **门禁（阻断合并）不在本规格内**：依赖 A2 的状态上报，见 issue #2663 第 3 步；本规格只保证「结果可读 + 退出码正确」，并给出「把它设成 required check」的说明。

## 需求 _(必填)_

### 功能需求

- **FR-1 可复用 workflow**：主仓库 `.github/workflows/` 提供带 `workflow_call` 的可复用 workflow，输入至少包含 `prompt`（必填）、`wave-version`、`output-format`、`permission-mode`、`tools`、`allowed-tools`、`api-key`（缺省读 `WAVE_API_KEY`）、`base-url`；输出至少包含 `result`、`subtype`、`is-error`、`result-file`。
- **FR-2 最小权限预设**：默认工具集覆盖「读文件 / 搜内容 / `git` 查询 / 平台 CLI 查询与评论」；需要写能力的场景必须由调用方显式放开。
- **FR-3 产物**：结果写入固定文件名（默认 `wave-result.json`）并上传为 artifact；同时通过 job outputs（可选形态为 step outputs）暴露 `result`、`subtype`、`is-error`、`result-file`。
- **FR-4 GitLab 模板**：文档提供可直接粘贴的 job 段（镜像、变量、artifacts），与 GitHub 侧共用同一套环境变量与产物约定。
- **FR-5 文档交付**：新增 `docs/ci.md`（认证、权限预设、两个平台的完整示例、产物约定、fork PR 注意事项），并在 `docs/tutorials.md` 增加一篇实操教程；示例必须可复制即跑。
- **FR-6 退出码透传**：沿用打印模式的失败判据（抛错或「有错且无正文」），封装层不另外发明判据。
