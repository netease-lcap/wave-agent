# 功能规格说明：Code Review Skill

**特性分支**：`058-code-review-skill`
**创建日期**：2026-06-29

## 用户场景与测试 *（必填）*

### 用户故事 1 - 审查当前 diff 的正确性错误（优先级：P1）

作为开发者，我希望审查当前分支更改的正确性错误，以便在合并前发现问题，而不依赖外部 CI 或托管的 git 平台。

**为什么是这个优先级**：错误检测是代码审查的主要价值。使用 `git diff`（而非 `gh`）使 skill 适用于任何 git 主机——GitLab、自托管或仅本地仓库。

**独立测试**：在特性分支上进行带有明显错误的更改，运行 `/code-review`，并验证错误以文件和行范围报告。

**验收场景**：

1. **假设**当前分支有未提交或已提交但未合并的更改，**当**用户运行 `/code-review` 时，**则** skill 收集相对于 `main` 的 diff（或回退到 `HEAD~1`）并报告更改中发现的正确性错误。
2. **假设**当前分支没有更改，**当**用户运行 `/code-review` 时，**则** skill 停止并告知用户没有可审查的内容。
3. **假设**发现正确性错误，**当**渲染报告时，**则**每个发现包含简要描述和 `<file>:<line range>` 引用。

---

### 用户故事 2 - 可配置的努力级别（优先级：P2）

作为开发者，我希望控制审查的彻底程度——从快速的低置信度扫描到详尽的最大努力扫描——以便根据更改大小和风险在审查成本和覆盖率之间权衡。

**为什么是这个优先级**：不同的更改需要不同的审查深度。单行拼写修复需要快速扫描；大型重构受益于更广泛的覆盖，即使以更多噪音为代价。

**独立测试**：在同一 diff 上运行 `/code-review low` 和 `/code-review max`，验证 `max` 启动更多 agent 并显示 `low` 过滤掉的较低置信度发现。

**验收场景**：

1. **假设**用户运行 `/code-review low`，**当** skill 执行时，**则**它启动 2 个审查 agent 并过滤掉置信度低于 90 的发现。
2. **假设**用户运行不带参数的 `/code-review`，**当** skill 执行时，**则**它默认为 `medium` 努力：3 个 agent，置信度阈值 80。
3. **假设**用户运行 `/code-review high`，**当** skill 执行时，**则**它启动 4 个 agent，置信度阈值 70。
4. **假设**用户运行 `/code-review max`，**当** skill 执行时，**则**它启动 5 个 agent，置信度阈值 60，包括效率审查器。

---

### 用户故事 3 - 带置信度评分的并行多维审查（优先级：P2）

作为开发者，我希望审查并行覆盖多个独立维度（错误、AGENTS.md 合规性、git 历史、代码重用、效率），每个发现独立评分置信度，以便我可以专注于高信号问题。

**为什么是这个优先级**：并行审查减少延迟并扩大覆盖。独立置信度评分过滤单次审查会暴露的误报。

**独立测试**：在带有重用问题和效率问题的 diff 上运行 `/code-review max`，验证两个维度都产生发现，每个都有通过阈值的独立置信度评分。

**验收场景**：

1. **假设**努力级别启动 N 个 agent，**当**第 3 阶段执行时，**则**所有审查 agent 在单条消息中并发启动，每个接收完整 diff。
2. **假设**任何审查 agent 产生了发现，**当**第 4 阶段执行时，**则**单独的并行评分 agent 使用固定评分标准独立分配 0-100 置信度评分。
3. **假设**发现已被评分，**当**第 5 阶段执行时，**则**只报告达到或超过努力级别阈值的发现；其余被过滤。
4. **假设**没有发现通过阈值，**当**渲染报告时，**则** skill 如此说明并停止。

---

### 用户故事 4 - AGENTS.md 合规审计（优先级：P2）

作为项目维护者，我希望审查检查更改是否遵守仓库的 `AGENTS.md` 文件（根目录和目录级），以便 AI 编写的代码遵循项目约定。

**为什么是这个优先级**：AGENTS.md 编码项目特定指导；审计合规性保持 AI 生成的更改与团队标准一致。

**独立测试**：添加禁止某种模式的 `AGENTS.md` 规则，在更改中引入该模式，运行 `/code-review`，并验证发现引用 AGENTS.md 规则。

**验收场景**：

1. **假设**根 `AGENTS.md` 存在，**当** AGENTS.md 合规 agent 运行时，**则**它根据根 AGENTS.md 指导检查 diff。
2. **假设**被修改文件所在目录存在 AGENTS.md 文件，**当**合规 agent 运行时，**则**它还检查那些目录级 AGENTS.md 文件。
3. **假设**发现违反了 AGENTS.md 规则，**当**发现被报告时，**则**它包含引用 `(AGENTS.md says "<...>")`。

---

### 用户故事 5 - 向 PR/MR 发布审查评论（优先级：P2）

作为开发者，我希望当平台 CLI（`gh` 或 `glab`）可用时将审查发现作为评论发布在 pull/merge request 上，以便我的团队可以在代码旁边看到审查，而无需从终端复制粘贴。

**为什么是这个优先级**：发布到 PR/MR 使发现对整个团队可见，并与代码更改一起持久化。当没有 CLI 或 PR/MR 时，发现回退到直接终端输出。

**独立测试**：在安装了 `gh` 且有 PR 的 GitHub 仓库上运行 `/code-review`，验证评论出现在 PR 上且无终端输出。在没有 `gh` 的仓库上，验证发现直接输出到终端。

**验收场景**：

1. **假设**远程 URL 包含 `github` 且安装了 `gh` 且当前分支有 PR，**当**第 5 阶段执行时，**则**审查通过 `gh pr comment` 作为 PR 评论发布，不输出到终端。
2. **假设**远程 URL 包含 `gitlab` 且安装了 `glab` 且当前分支有 MR，**当**第 5 阶段执行时，**则**审查通过 `glab mr note` 作为 MR 注释发布，不输出到终端。
3. **假设**没有安装平台 CLI，**当**第 5 阶段执行时，**则**发现直接输出到终端。
4. **假设**安装了 CLI 但当前分支没有 PR/MR，**当**第 5 阶段执行时，**则**发现直接输出到终端。
5. **假设**没有发现通过阈值，**当**第 5 阶段执行时，**则** skill 显示"no issues"并停止——不发布评论也不输出发现。

---

### 边界情况

- **如果 diff 非常大怎么办？** skill 将完整 diff 传递给每个 agent；skill 本身不进行截断。大型 diff 可能达到模型上下文限制——这是可接受的，表现为 agent 错误。
- **如果 `main` 分支在本地不存在怎么办？** merge-base 命令回退到 `HEAD~1`，仅审查最后一次提交。
- **如果发现是误报怎么办？** 置信度评分阶段旨在过滤误报；skill 还列出显式排除的误报类别（预先存在的问题、linter 级别的挑剔、有意更改等）。
- **如果 AI 尝试自动触发 skill 怎么办？** frontmatter 中的 `disable-model-invocation: true` 阻止 AI 自动调用 skill；它仅通过 `/code-review` 由用户调用。
- **如果评分 agent 与审查 agent 意见不一致怎么办？** 评分 agent 的独立评分对过滤具有权威性；审查 agent 自己的评估不用于阈值判断。
- **如果远程是自托管 GitLab（不是 gitlab.com）怎么办？** 平台检测检查远程 URL 是否包含 `gitlab`；自定义域的自托管实例不被识别，skill 回退到直接输出。
- **如果 `gh` 或 `glab` 已安装但未认证怎么办？** 发布评论的 CLI 命令将失败；skill 将其视为"PR/MR 不存在"并静默跳过。
- **如果发布评论失败怎么办？** skill 回退到直接终端输出，确保不丢失信息。

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须提供通过 `/code-review [effort]` 调用的内置 `code-review` skill。
- **FR-002**：skill 必须使用 `git diff` 相对于 `HEAD` 和 `main` 的 merge-base 收集 diff，当 `main` 不可用时回退到 `HEAD~1`。不依赖 `gh`。
- **FR-003**：当没有可审查的更改时，skill 必须停止并通知用户。
- **FR-004**：skill 必须从 `$ARGUMENTS` 解析努力级别：`low`、`medium`（默认）、`high`、`max`。
- **FR-005**：每个努力级别必须映射到固定的 agent 数量和置信度阈值：low→2 个 agent/90、medium→3 个 agent/80、high→4 个 agent/70、max→5 个 agent/60。
- **FR-006**：skill 必须在单条消息中并发启动所有审查 agent，每个传递完整 diff。
- **FR-007**：skill 必须在所有努力级别包含 Bug Scanner agent，执行聚焦于大型错误的浅层扫描。
- **FR-008**：skill 必须在所有努力级别包含 AGENTS.md 合规 agent，审计根目录和修改目录的 AGENTS.md 文件。
- **FR-009**：skill 必须在 `medium` 及以上级别包含 Git History Context agent，使用 `git blame` 和历史。
- **FR-010**：skill 必须在 `high` 及以上级别包含 Code Reuse & Quality agent。
- **FR-011**：skill 必须仅在 `max` 级别包含 Efficiency Review agent。
- **FR-012**：skill 必须为每个发现启动单独的并行评分 agent，返回根据固定评分标准的 0-100 置信度评分。
- **FR-013**：skill 必须过滤掉置信度评分低于努力级别阈值的发现。
- **FR-014**：skill 必须以固定格式报告发现：带描述、可选 AGENTS.md 引用和 `<file>:<line range>` 引用的编号列表。
- **FR-015**：当没有发现通过阈值时，skill 必须报告"no issues"并停止——不发布评论，不输出发现。
- **FR-016**：skill 必须为每个发现引用文件和行范围。
- **FR-017**：skill 必须设置 `disable-model-invocation: true` 以防止 AI 自动触发。
- **FR-018**：skill 必须通过 `allowed-tools` 限制自己的工具为：git diff/status/log/show/blame/remote、command -v、gh pr comment/view、glab mr note/view、Read、Glob、Grep 和 Agent。
- **FR-019**：skill 不得检查构建信号或尝试构建或类型检查应用——这些单独运行。
- **FR-020**：skill 必须在执行审查阶段之前先创建 todo 列表。
- **FR-021**：skill 必须排除误报类别：预先存在的问题、非错误外观的问题、学究式挑剔、linter/类型检查器级别的问题、一般质量差距（除非 AGENTS.md 要求）、被静默的问题、有意更改和未修改行上的问题。
- **FR-022**：skill 必须通过检查远程 URL（`git remote get-url origin`）检测仓库平台——URL 中的 `github` → GitHub，URL 中的 `gitlab` → GitLab。
- **FR-023**：skill 必须在尝试发布评论之前检测相应的 CLI 是否已安装（`command -v gh` / `command -v glab`）。
- **FR-024**：skill 必须在发布之前检查当前分支是否有 PR/MR 存在（`gh pr view` / `glab mr view`）。
- **FR-025**：当平台为 GitHub 且安装了 `gh` 且有 PR 时，skill 必须通过 `gh pr comment --body` 将审查作为 PR 评论发布（首选）——且不得在此情况下将发现输出到终端。
- **FR-026**：当平台为 GitLab 且安装了 `glab` 且有 MR 时，skill 必须通过 `glab mr note --message` 将审查作为 MR 注释发布（首选）——且不得在此情况下将发现输出到终端。
- **FR-027**：当没有安装 CLI、没有 PR/MR 存在、平台无法识别或评论发布失败时，skill 必须将发现直接输出到终端（回退）。

### 关键实体

- **EffortLevel**：`low`、`medium`、`high`、`max` 之一——控制 agent 数量和置信度阈值。
- **ReviewAgent**：分配了审查维度（bug 扫描、合规、历史、重用、效率）的并行子 agent。接收完整 diff。
- **ScoringAgent**：独立的子 agent，使用固定评分标准为单个发现分配 0-100 置信度评分。
- **Finding**：带有描述、可选 AGENTS.md 引用、文件和行范围的报告问题。
- **ConfidenceScore**：0-100 的整数，在 0、25、50、75、100 处有固定评分标准锚点。
- **Platform**：检测到的仓库平台——`github` 或 `gitlab` 或 `unknown`（从远程 URL 推断）。
- **CommentTarget**：接收审查评论的 PR 或 MR，如果 CLI 可用且 PR/MR 存在。

### 假设

- skill 作为内置 skill 在 `packages/agent-sdk/builtin/skills/code-review/SKILL.md` 下实现。
- Agent 工具对 skill 可用（列在 `allowed-tools` 中）用于启动并行审查/评分子 agent。
- `$ARGUMENTS` 替换由现有 skill 参数系统处理（spec 006）。
- Bash 命令执行（`!`git diff``）由现有 skill bash 替换系统处理（spec 006）。
