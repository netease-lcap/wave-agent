---
name: "内置子代理"
description: "内置 `Explore` 只读子代理，与用户自定义子代理共用同一套调用接口"
order: 20
---

# 功能规格说明：内置子 Agent 支持

**创建日期**：2025-12-08

## 用户场景与测试 _（必填）_

### 用户故事：基本子 Agent 访问（优先级：P1）

用户可以访问预配置的内置子 agent，而无需创建或配置自己的子 agent 文件。他们可以在安装系统后立即将任务委派给专门的 agent。

**为什么是这个优先级**：核心功能，无需用户配置即可提供即时价值并展示子 agent 系统的能力。

**独立测试**：可以通过使用内置子 agent 名称调用 Task 工具来全面测试，验证子 agent 成功执行并交付专门的任务完成。

**验收场景**：

1. **假设**全新安装且没有用户配置的子 agent，**当**用户使用 "Explore" 子 agent 类型调用 Task 工具时，**则**内置的 explore agent 成功执行并返回搜索结果
2. **假设**内置子 agent 可用，**当**用户调用 Task 工具但未提供有效的 subagent_type 时，**则**系统列出可用的子 agent，包括内置和用户配置的

---

---

### 用户故事：一致的子 Agent 接口（优先级：P2）

内置子 agent 与用户配置的子 agent 工作方式完全相同，在所有子 agent 类型中提供一致的体验。

**为什么是这个优先级**：确保架构一致性，防止用户对内置和自定义子 agent 产生混淆。

**独立测试**：可以通过验证内置子 agent 产生与用户配置的子 agent 相同的消息结构、工具限制和执行行为来测试。

**验收场景**：

1. **假设**一个内置子 agent 和一个用户子 agent，**当**两者执行类似任务时，**则**它们的输出格式、状态报告和生命周期管理是相同的
2. **假设**内置子 agent 被执行，**当**任务完成时，**则**它们创建与用户配置的子 agent 相同的 SubagentBlock 结构

---

### 用户故事：Explore 的模型、上下文与工具面对齐 Claude Code（优先级：P2）

作为用户，我希望内置 Explore 的表现与 Claude Code 一致：跑在主会话当前模型上、不携带项目记忆、能用到网页抓取这类新工具，这样它的搜索质量与成本都跟主会话同档，而不是被钉死在快模型和固定的五个工具上。

**为什么是这个优先级**：Explore 是自动委派最频繁的子代理，它的模型档位直接决定搜索结果质量；白名单把它锁在 `Glob/Grep/Read/Bash/LSP` 上，导致它读不了 URL（Claude Code 的 Explore 工具池里有 `WebFetch`/`WebSearch`）。这两条都是对齐 Claude Code 现有行为的修正，不改架构。

**独立测试**：在未配置 `WAVE_FAST_MODEL` 的环境里派一个 Explore 任务，验证它正常跑完（不再报缺少 fastModel）、请求所用模型等于主会话模型、system prompt 与首条消息里没有 `AGENTS.md` 内容、工具列表里有 `WebFetch` 而没有 `Edit`/`Write`。

**验收场景**：

1. **假设** 用户没有显式配置 Explore 的模型，**当** 主代理派发 Explore，**则** Explore 使用主会话当前模型（`model: inherit`），thinking 等模型参数与主模型一致，不再叠加 fastModel 的「禁用思考」参数。
2. **假设** 环境没有配置 `WAVE_FAST_MODEL`，**当** 主代理派发 Explore，**则** 子代理正常启动，不得因缺少 fastModel 而报配置错误。
3. **假设** 派发 Explore 或 Plan，**当** 子代理启动，**则** 不注入项目 `AGENTS.md`（含 `CLAUDE.md` 回退）与 `.wave/rules` 的无条件规则（定义文件带 `omitAgentsMd: true`）。
4. **假设** Explore/Plan 运行中，**当** 模型看到工具列表，**则** 除 `Agent`、`Artifact`、`ExitPlanMode`、`Edit`、`Write` 以及恒定拒绝的 Task 工具之外的工具都可用，包括 `WebFetch`、`WebSearch`、`Skill`、`LSP`、`Bash`。
5. **假设** Explore/Plan 尝试调用 `Write` 或 `Edit`，**则** 工具根本不在列表中，调用返回 not found。
6. **假设** 主模型读 `Agent` 工具描述里的 Explore 条目，**则** 描述说明它是「定位代码的只读搜索代理」，并明确不应用于 code review、设计文档审计、跨文件一致性检查与开放式分析（它只读片段、会漏掉读取窗口之外的内容）。

---

### 边界情况

- 当内置子 agent 名称与用户配置的子 agent 名称冲突时会发生什么？
- 当源文件缺失或损坏时，系统如何处理加载内置子 agent？
- 当内置子 agent 引用不存在的工具时会发生什么？
