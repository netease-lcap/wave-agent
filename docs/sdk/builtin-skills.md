---
title: 内置 Skills
description: 内置 Skills：settings、init、loop、simplify、code-review、artifact、wave-daemon、workflow-authoring
---

# 内置 Skills {#builtin-skills}

## settings — 配置管理 {#skill-settings}

详见 [Settings Skill](./settings#settings-skill)。用户可通过 `/settings` 以自然语言管理所有 Wave 设置。

## init — 代码库初始化 {#skill-init}

分析代码库并创建 `AGENTS.md` 文件，为后续 Agent 会话提供项目上下文指引。

- **名称**: `init`
- **特性**: 不会被 AI 自动调用，需用户通过 `/init` 手动触发

## loop — 定时循环任务 {#skill-loop}

按指定间隔重复执行提示词或斜杠命令。

- **名称**: `loop`
- **使用方式**: `/loop [interval] <prompt>`
- **间隔格式**: `Ns`, `Nm`, `Nh`, `Nd`（如 `5m`, `30m`, `2h`, `1d`），最小粒度为 1 分钟，默认 10 分钟

**示例**:

- `/loop 5m /babysit-prs` — 每 5 分钟执行 `/babysit-prs`
- `/loop 30m check the deploy` — 每 30 分钟检查部署
- `/loop check the deploy` — 默认每 10 分钟执行

**底层工具**：由 `CronCreate`、`CronDelete`、`CronList` 三个工具实现。

**限制**：循环任务 7 天后自动过期；最多支持 50 个定时任务。

## simplify — 代码简化与清理 {#skill-simplify}

审查已变更代码，从代码复用、代码质量和执行效率三个维度进行深度分析，并直接应用优化修改。

- **名称**: `simplify`
- **使用方式**: `/simplify`
- **特性**: 专注代码质量提升与重构，**不用于寻找功能性 Bug**（寻找 Bug 请使用 `/code-review`）

### 执行阶段

1. **识别变更** — 通过 `git diff`（或 `git diff HEAD`）获取当前修改。若无 git 变更，则审查最近编辑过的文件。
2. **并行子代理审查** — 并行启动 3 个专用子代理：
   - **代码复用代理 (Code Reuse Review)**：搜索现有工具函数、公共模块或相邻逻辑，标记重复实现的新函数和可使用已有工具的内联逻辑。
   - **代码质量代理 (Code Quality Review)**：检查冗余状态、参数膨胀、复制粘贴变体、抽象泄漏、硬编码字符串、无意义的 JSX 嵌套和无效注释（仅保留解释 "WHY" 的非直观注释）。
   - **执行效率代理 (Efficiency Review)**：检查重复计算、多余文件 I/O、缺失并发、热路径膨胀、无保护的轮询更新、TOCTOU 反模式、内存/事件监听泄漏以及过度读取。
3. **自动修复** — 聚合 3 个子代理的建议并直接应用修改，最后向用户简要汇报修复成果（或确认代码已经很干净）。

## code-review — 代码审查 {#skill-code-review}

对当前分支的变更执行多维度的正确性 Bug 与代码质量审查，并自动将结果提交为 PR/MR 评论。

- **名称**: `code-review`
- **使用方式**: `/code-review [effort]`
- **选项**:
  - `low`：启动 2 个代理，可信度阈值 90（仅输出几乎确定的发现，噪声最少）
  - `medium`（默认）：启动 3 个代理，可信度阈值 80
  - `high`：启动 4 个代理，可信度阈值 70
  - `max`：启动 5 个代理，可信度阈值 60（覆盖面最广，可能含有较低可信度的发现）

### 执行阶段

1. **收集上下文** — 获取 `git status`、自 `main` 合并基点以来的修改文件列表、提交日志和完整 diff 内容。若无变更则停止。
2. **并行审查** — 依据 `effort` 级别并行分发任务给子代理：
   - **Bug 扫描代理**（全级别）：浅层扫描，专注于大型、明显的功能 Bug，避免细枝末节。
   - **AGENTS.md 规范审计代理**（全级别）：审计变更是否符合仓库根目录及修改文件所在目录的 `AGENTS.md` 规范。
   - **Git 历史代理**（中级及以上）：结合 `git blame` 与修改行的历史上下文，评估代码变更带来的隐患。
   - **代码复用与质量代理**（高级及以上）：审查重复工具代码、参数膨胀、抽象泄漏、多余注释等质量坏味道。
   - **效率审查代理**（仅限 `max`）：深入评估性能损耗、缺失的并发和内存泄漏等。
3. **可信度评分 (Confidence Scoring)** — 为发现的每个缺陷启动独立代理，对照 PR diff 和 `AGENTS.md` 给出 0-100 的置信度评分（0=几乎肯定是误报；100=绝对确定且会高频触发）。评分同时过滤历史遗留缺陷、类型系统/编译器能自动捕获的问题、非修改行的缺陷等干扰项。
4. **结果交付** — 过滤低于阈值的分数。优先通过 GitHub CLI (`gh pr comment`) 或 GitLab CLI (`glab mr note`) 将审查意见以 **PR/MR 评论** 形式发表；若 CLI 不可用或无对应 PR/MR，则直接在对话中输出。

## artifact — 发布可分享网页 {#skill-artifact}

将本地 `.html`/`.md` 文件发布为**默认私有**的可分享网页，并返回可传播的 URL。

- **名称**: `artifact`
- **使用方式**: `/artifact` 或 `/artifact <文件路径>`
- **特性**: 与 [Artifact 工具](./tool-artifact#tool-artifact) 同 gate（`enableArtifact` + 登录态），gate 关闭时不注册；声明 `disable-model-invocation: true`，仅人工触发、模型不可自动调用。技能内容仅指示模型调用 `Artifact` 工具——无参数时由模型根据对话上下文推断要发布的文件（不确定则询问用户），带参数时经 `$ARGUMENTS` 原样透传给工具的 `file_path`；发布 / 校验 / 权限确认 / 会话映射全部由工具完成，技能不含也不绕过这些逻辑。

## wave-daemon — 后台会话委托 {#skill-wave-daemon}

将开发 / 调研类长任务委托给后台 daemon 会话执行（无 UI 窗口，客户端断开后继续生成），并覆盖中断、改范围、监控、权限审批与收尾的完整委托流程。

- **名称**: `wave-daemon`
- **使用方式**: 由模型在需要委托长任务时自动调用，无需用户手动触发
- **要点**: 会话经 `wave daemon create --worktree` 建立在隔离 worktree 中，默认 `bypassPermissions`（不产生审批）；`wave daemon send` 默认异步派单，进度与最终汇报用 `wave daemon status [--lines N]` 查看（默认只展示最后 1 条消息，`--lines 0` 只看状态行）；盯会话改用 `wave daemon wait <sessionId>` 阻塞等到空闲并直接把最终快照打到 stdout（退出码 0=空闲 / 3=挂起等审批 / 1=错误，含等待期间该会话被其它客户端销毁——不挂住也不误报完成；三种终止已覆盖无人值守监控的全部情形，替代自建 shell 轮询脚本，`status` 仍是「取一次快照、立刻返回」）；子命令语法细节见 [Daemon 客户端命令](/cli/subcommands#daemon-commands)
- **主要经验**: 被中断的 `send` 不等于消息没送达（先 `status` 复核再决定是否重发）；紧跟异步 `send` 之后 `wait` 要加 `--from-busy`（否则 turn 尚未开始的 stale `loading:false` 会让 wait 提前结束）；改范围先 `abort`；审批刷屏的根因是 daemon 进程重启后权限模式回落，用 `respond <id> --allow --mode bypassPermissions` 一步恢复；`destroy --remove-worktree` 是两步操作，中断会部分执行

## workflow-authoring — 工作流脚本编写参考 {#skill-workflow-authoring}

承载 Workflow 脚本的完整编写参考：钩子签名与 `opts`、`meta` 形状、`args` / `budget` 语义、恢复（resume）规则、并发与规模上限、质量模式（对抗验证、评审团、循环至无新发现等）以及一份可运行示例。

- **名称**: `workflow-authoring`
- **使用方式**: 由模型在编写 Workflow 脚本前自行加载，无需用户手动触发
- **要点**: [Workflow 工具](./tools#builtin-tools)的描述按需披露——模型可加载本技能时，描述只给"形状与签名要点 + 本技能指针"；不可加载时（技能未注册或声明了 `disable-model-invocation`）把参考正文**内联**进描述，两种模式下信息都不缺失。参考正文是单一事实源：SKILL.md 正文与工具描述的内联兜底取自同一常量，不会各自漂移。误读签名的代价不是报错而是"返回值莫名是 `undefined`/空值"，所以写脚本前应先加载本技能。
