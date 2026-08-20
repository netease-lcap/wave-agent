---
name: "Workflow 编排"
description: "确定性多子代理编排，支持 pipeline、parallel 和 phase 控制流"
order: 80
---

# 功能规格说明：Workflow — 确定性多子 Agent 编排

**创建日期**：2026-06-07

## 用户场景与测试 _（必填）_

### 用户故事：运行工作流探索代码库（优先级：P1）

作为用户，我希望要求 agent"使用工作流"探索代码库，以便它并行编排多个子 agent（扫描、逐文件分析、综合），而不是在一个上下文中顺序执行。

**为什么是这个优先级**：这是核心用例——单个对话轮次无法协调的大规模并行多 agent 工作。

**独立测试**：创建示例项目，发送消息要求 agent"use a workflow to explore this project"，验证 Workflow 工具被调用，脚本包含 `agent()`、`pipeline()` 和 `phase()`，最终结果是综合的概览。

**验收场景**：

1. **假设**有包含源文件的项目目录，**当**用户说"use a workflow to explore this project"时，**则** agent 调用 Workflow 工具，使用包含 `agent()`、`pipeline()` 和 `phase()` 的 JS 脚本。
2. **假设**有运行中的工作流，**当**工作流完成时，**则** `<task-notification>` 被注入对话中（meta 消息，UI 消息流隐藏、仅模型可见，见 `core/background-task-notification`），agent 报告结果。
3. **假设**有包含多个阶段的工作流，**当**用户运行 `/workflows` 时，**则**系统列出运行记录，包含名称、状态、agent 计数和 token 使用量。

---

### 用户故事：选择加入强制执行（优先级：P1）

作为用户，我希望 Workflow 工具仅在我显式请求多 agent 编排时才被调用，以便 agent 不会为简单任务默默生成数十个 agent。

**为什么是这个优先级**：没有选择加入，工作流可能在用户不知情的情况下消耗大量 token。

**独立测试**：发送不请求工作流的简单问题，验证 agent 使用 Agent 工具或直接回答——不使用 Workflow 工具。

**验收场景**：

1. **假设**用户说"find all TODO comments"，**当** agent 处理请求时，**则** agent 不调用 Workflow 工具（使用 Agent 工具或直接回答）。
2. **假设**用户说"use a workflow to find all TODO comments"，**当** agent 处理请求时，**则** agent 调用 Workflow 工具。
3. **假设**用户调用 `/deep-research <question>`，**当**斜杠命令执行时，**则** Workflow 工具被调用并附带 deep-research 脚本。

---

### 用户故事：从日志恢复工作流（优先级：P2）

作为用户，我希望从中断处恢复停止的工作流，以便已完成的 agent 不重新运行且不浪费 token。

**为什么是这个优先级**：恢复为被中断或需要在运行中编辑的长工作流节省大量 token。

**独立测试**：运行工作流，在执行中停止，使用 `resumeFromRunId` 调用 Workflow，验证缓存的 agent 结果立即返回，只有新/更改的 agent 实时运行。

**验收场景**：

1. **假设**工作流运行在停止前完成了 10 个 agent 中的 5 个，**当**用户使用 `resumeFromRunId` 恢复时，**则** agent 0-4 立即返回缓存结果，agent 5-9 实时运行。
2. **假设**有恢复的工作流，**当**脚本相同且参数相同时，**则** 100% 的 agent 调用返回缓存结果（完全缓存命中）。

---

### 用户故事：来自 agent 的结构化输出（优先级：P2）

作为用户，我希望工作流 agent 返回匹配 schema 的结构化 JSON，以便下游阶段可以可靠地处理结果而无需脆弱的文本解析。

**为什么是这个优先级**：多阶段管道需要阶段之间的机器可读数据流。

**独立测试**：调用 `agent('List all files', {schema: {type: 'object', properties: {files: {type: 'array'}}, required: ['files']}})`，验证结果是经过验证的对象而非字符串。

**验收场景**：

1. **假设** agent 调用带有 `opts.schema`，**当**子 agent 完成时，**则**结果是匹配 schema 的经过验证的对象。
2. **假设** agent 调用带有 `opts.schema` 但子 agent 没有调用 StructuredOutput，**当** agent 完成时，**则**系统回退到对最终文本进行 JSON.parse。
3. **假设** agent 调用不带 `opts.schema`，**当**子 agent 完成时，**则**结果是 agent 的最终文本字符串。

---

### 用户故事：IDE 插件工作流管理对话框（优先级：P2）

作为 IDE 用户，我希望通过 `/workflows` 斜杠命令打开对话框查看工作流运行详情（名称、状态、阶段、agent 数、token、经过时间），并能停止运行中的工作流，以便在不切换到 CLI 的情况下监控多 agent 编排。

**为什么是这个优先级**：CLI 已有 `/workflows`；IDE 用户需要对等能力以在工作流运行时观察进度与资源消耗。

**独立测试**：在 IDE 中输入 `/workflows`，验证弹出对话框列出工作流运行；选中运行中的工作流进入详情视图显示阶段列表与 token 统计；点击停止按钮终止运行。

**验收场景**：

1. **假设** 存在工作流运行，**当** 用户在 IDE 输入 `/workflows`，**则** 打开工作流管理对话框，列表显示每个运行的名称、状态、agent 数、token、经过时间。
2. **假设** 对话框已打开且工作流有阶段，**当** 用户选中某个运行，**则** 详情视图显示 runId、描述、状态、起止时间、运行时长、agent 数、token、脚本路径、错误（若有）及阶段列表（每阶段标题/agent 数/token/经过时间）。
3. **假设** 选中运行中的工作流，**当** 用户点击停止，**则** 通过 `stopWorkflowRun` 请求终止该运行，列表随后反映新状态。
4. **假设** 工作流后台任务状态变化，**当** 客户端收到 `backgroundTasksChange` 通知，**则** 自动调用 `getWorkflowRuns` 刷新运行列表并推送 `updateWorkflowRuns` 给 webview。

---

### 边界情况

- **脚本中的禁止模式**：包含 `require()`、`process.env`、`Date.now()`、`Math.random()`、`import`、`eval()` 的脚本在验证时被拒绝。
- **常见英语单词允许**：描述中的"process"（例如 `{title: 'Process', detail: 'process each item'}`）不触发禁止模式检查——只有 `process.`（属性访问）被禁止。
- **超出 agent 限制**：如果脚本生成超过 1000 个 agent，第 1001 个 agent() 调用抛出错误。
- **超出预算**：如果设置了 token 预算并超出，进一步的 agent() 调用抛出。
- **运行中中止**：如果用户停止工作流，所有飞行中的 agent 被取消，运行状态设置为"aborted"。
- **子 agent 中的 Workflow 工具**：Workflow 工具在子 agent 中被禁止（防止无限递归）。
- **脚本持久化**：每次 Workflow 调用都将脚本持久化到会话目录，即使执行失败。
