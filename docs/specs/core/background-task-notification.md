---
name: "后台任务完成通知"
description: "Bash/Agent/Workflow 后台任务完成时注入主对话的 task-notification 消息语义（UI 隐藏、模型可见、持久化）"
order: 150
---

# 功能规格说明：后台任务完成通知

**创建日期**：2026-08-21

> 对齐 Claude Code 的后台任务完成通知行为：Bash 后台任务与 Agent 子代理（fork/subtask、后台化 subagent、后台 workflow）完成时，其完成通知作为 `task-notification` 消息注入主对话——该消息对 UI 消息流隐藏（`isMeta: true`），对模型上下文可见（包装为 "A background agent completed a task:" + XML），并照常持久化到会话 jsonl。用户感知路径为模型主动汇报、`/tasks` 面板与后台任务面板，不经消息流。

## 用户场景与测试 _（必填）_

### 用户故事：后台任务完成通知（优先级：P1）

作为用户，我希望后台任务（Bash 后台命令、后台子代理、后台 workflow）完成时，其完成通知注入主对话供模型感知并汇报，但不在 UI 消息流中打扰我，以便消息流只呈现真实对话，任务结果由模型归纳后呈现。

**验收场景**：

1. **假设** 后台任务完成，**当** 完成通知注入主对话时，**则** 通知成为 role:user 的 meta 消息（`isMeta: true`），在 CLI 与 Webview 消息流中均不显示。
2. **假设** 后台任务完成通知已注入，**当** 模型读取消息上下文时，**则** 模型看到包装文本 "A background agent completed a task:" 加 `<task-notification>` XML（含 task-id、task-type、status、summary、output-file）。
3. **假设** 后台任务完成通知已注入并触发新一轮 AI 应答，**当** 会话保存时，**则** 通知消息（isMeta）与随后的 assistant 消息一同写入会话 jsonl，恢复会话后模型上下文与通知行为不变。
4. **假设** 后台任务被手动终止（killed），**当** 任务结束时，**则** 不注入完成通知。
5. **假设** 多个后台任务同时完成，**当** 通知注入时，**则** 所有通知合并进同一轮 AI 应答（批量处理）。

### 边界情况

- **旧会话恢复**：历史会话 jsonl 中的通知消息若不含 `isMeta` 标记（本变更前写入），恢复后可能短暂可见——不做迁移，新写入的消息均带标记。
- **/clear 与 abort**：`MessageQueue.clear()` 保留 pending 通知（不丢弃后台结果）；abort 期间不注入通知（折叠进下一轮，防止孤儿循环）。
