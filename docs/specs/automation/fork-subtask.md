---
name: "Fork 子代理"
description: "`/subtask` 手动触发继承父完整上下文的后台子代理，结果回主对话"
order: 30
---

# 功能规格说明：Fork 子代理

**创建日期**：2026-08-12

> 对齐 Claude Code v2.1.212+ 的 `/subtask` 命令（fork 子代理正式化：继承父完整对话上下文 + 系统提示词 + 工具 + 模型的子代理，后台运行，结果回主对话，与主会话共享 prompt cache）。
> wave 复用现有 fork 引擎：`aiManager.runForkLoop` 家族（compaction / 自动记忆 / btw 已在用）保证 perfect-fork 语义（相同系统提示词、工具、模型、消息前缀 → 命中模型 prompt 缓存），`BackgroundTaskManager` + task-notification 机制（subagent 后台执行在用）负责后台注册与结果回传。
> 范围仅限稳定路径：手动命令触发。Agent 工具隐式触发（省略 subagent_type 自动 fork）与 `/fork` 别名属实验路径，本期不做。

## 用户场景与测试 *（必填）*

### 用户故事：手动触发 fork 子代理（优先级：P1）

作为用户，我希望输入 `/subtask <任务描述>` 触发一个继承当前对话完整上下文的子代理在后台执行任务，以便在不打断主对话的情况下并行推进工作，任务结果最终回到主对话。

**验收场景**：

1. **假设**用户处于主对话模式，**当**用户输入 `/subtask <任务描述>` 并按下 Enter 时，**则** fork 子代理在后台启动，主对话立即空闲可继续使用。
2. **假设** `/subtask` 请求发出，**则** 请求复用主对话的 system prompt、工具列表、模型与消息历史（fork 请求前缀与主对话字节级一致，命中模型 prompt 缓存）。
3. **假设** `/subtask` 请求发出，**则** 后台任务出现在任务列表（`/tasks`）中，类型为 subagent，日志写入 `os.tmpdir()/wave-subagent-<taskId>.log`。
4. **假设** fork 子代理运行期间主对话仍在工作，**则** 两者互不阻塞（fork 使用独立的消息副本与 read 状态，不污染主对话）。
5. **假设** fork 子代理需要调用工具，**则** 允许执行除 Agent 工具与 Task 工具之外的工具（继承父工具集与父权限规则），工具在剥离上下文中执行（不触发权限弹窗）。
6. **假设** fork 子代理完成，**则** 任务状态置为 completed，最终回复通过 task-notification（含 `<result>`）注入主对话，主对话的 AI 可见结果并可继续应答。
7. **假设** fork 子代理失败（如 API 错误、达到 maxTurns 无结果），**则** 任务状态置为 failed，错误信息通过 task-notification 注入主对话，主对话不中断。

### 用户故事：fork 内禁止递归（优先级：P1）

作为系统，我希望 fork 子代理不能再 fork 子代理，以便保证调用深度有界。

**验收场景**：

1. **假设** fork 子代理尝试调用 Agent 工具，**则** 工具调用被拒绝并回喂模型（不执行），模型被告知该工具不可用。
2. **假设** fork 子代理尝试调用 Task 创建/查询/更新/列表工具，**则** 工具调用被拒绝（不共享主代理任务列表）。
3. **假设** fork 子代理的消息副本中包含历史 slash 命令（如 `/subtask`），**则** 该历史仅作为上下文文本，不会被再次解析执行。

### 用户故事：命令参数与输入（优先级：P2）

作为用户，我希望 `/subtask` 在无参数时给出明确的用法提示，以便我了解正确输入方式。

**验收场景**：

1. **假设**用户输入裸 `/subtask` 并按下 Enter，**则** 不启动 fork，主对话显示用法提示 `Usage: /subtask <task description>`（错误块）。
2. **假设**主对话 AI 忙时输入 `/subtask <任务描述>`，**则** 命令进入消息队列，待当前轮结束后执行（非立即命令）。

### 边界情况

- **fork 期间主对话进行 `/clear` 或 `/compact` 怎么办？** fork 使用独立的消息副本，不受影响；fork 完成的通知仍会注入主对话（`MessageQueue.clear()` 保留 notification 类型消息）。
- **fork 结果过长怎么办？** 通知携带完整 `<result>`，同时完整内容写入任务日志，主对话可自行决定如何利用。
- **maxTurns 耗尽怎么办？** 任务标记为 failed（"Reached max turns"），错误注入主对话。
- **用户主动终止 fork 怎么办？** `/tasks` 中 kill 后台任务 → abort 底层请求与清理，任务状态为 killed。
- **/subtask 会出现在哪些入口？** CLI 斜杠命令选择器与 Webview 斜杠命令弹窗均列出（经 `getSlashCommands` 自动生效，无需前端改动）。
- **fork 与 compaction / 自动记忆 / btw 的关系？** 四者共用 `runForkLoop` 引擎，但业务语义独立：compaction/btw 单轮、自动记忆 5 轮、fork 子代理 200 轮（对齐 Claude Code `forkSubagent.ts` 的宽松上限，实际不构成约束）。
