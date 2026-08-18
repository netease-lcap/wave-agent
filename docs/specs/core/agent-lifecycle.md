---
name: "Agent 生命周期"
description: "destroy() 的确定性排空语义：存活工作注册表、destroy 后公开 API 抛错、destroy 终态守卫（防幽灵 dispatch）"
order: 145
---

# 功能规格说明：Agent 生命周期

**创建日期**：2026-08-18

## 用户场景与测试 _（必填）_

### 用户故事：destroy 后公开 API 抛错（优先级：P1）

作为 Agent SDK 的使用者，我希望在调用 `destroy()` 之后继续调用 `sendMessage` / `bang` / `askBtw` / `forkSubagent` 等公开 API 时得到一个明确的 `Agent destroyed` 错误，而不是被静默丢弃或在新生命周期上执行，以便在开发阶段就能立即发现生命周期误用（destroy 是终态操作，之后不允许任何新工作开始）。

**为什么是这个优先级**：这是生命周期契约显式化的最小改动（几行 guard）。当前 destroy 后 `sendMessage` 会因 `isLoading=false` 直接走 `InteractionService.sendMessage` 在已销毁的 agent 上启动新的 AI 回合（幽灵的另一条路径），静默丢弃只会让误用靠幽灵暴露。

**独立测试**：创建 Agent、调用 `destroy()`，随后分别调用 `sendMessage`、`bang`、`askBtw`、`forkSubagent`，验证每个调用都同步抛出 `Error("Agent destroyed")`，且不产生任何 AI 调用。

**验收场景**：

1. **假设** agent 已调用 `destroy()`，**当** 调用 `sendMessage("hello")` 时，**则** 抛出 `Error("Agent destroyed")`，且不会调用 `InteractionService.sendMessage` / `aiManager.sendAIMessage`
2. **假设** agent 已调用 `destroy()`，**当** 调用 `bang("ls")` 时，**则** 抛出 `Error("Agent destroyed")`，且不会执行 bash 命令
3. **假设** agent 已调用 `destroy()`，**当** 调用 `askBtw("question")` 时，**则** 抛出 `Error("Agent destroyed")`
4. **假设** agent 已调用 `destroy()`，**当** 调用 `forkSubagent(prompt, { description })` 时，**则** 抛出 `Error("Agent destroyed")`
5. **假设** agent 尚未销毁，**当** 调用上述任一公开 API 时，**则** 行为与现状完全一致（不抛错，正常入队或执行）

---

### 用户故事：destroy 确定性排空存活工作（优先级：P1）

作为 Agent SDK 的使用者，我希望 `destroy()` 在返回前等待所有已注册的存活异步工作（dispatch、subagent、fork subagent 等 fire-and-forget 工作）排空，以便销毁后不存在任何跨生命周期存活的异步副作用（幽灵物理上不可能存在）。

**为什么是这个优先级**：这是 #1808（destroy 后幽灵 dispatch）的治本方案。当前 destroy 仅等待 `dispatchPromise`，subagent / fork subagent 的 fire-and-forget IIFE（`subagentManager.executeAgent` 后台执行、`aiManager.runForkSubagent`）不在等待范围内——它们通过 `backgroundTaskManager.cleanup()` 被中止但未被 await。将「尽力清理」升级为「注册 → 中止 → await 排空（带超时兜底）→ 断言工作集为空」。

**独立测试**：注册一个手动控制的存活工作（延迟 resolve 的 promise），调用 `destroy()`，验证 destroy 在控制 promise resolve 之前不返回；resolve 后 destroy 正常返回且工作集为空。

**验收场景**：

1. **假设** agent 有已注册的存活异步工作（如进行中的 fork subagent），**当** 调用 `destroy()` 时，**则** destroy 等待所有存活工作排空后才返回，工作集最终为空
2. **假设** 存活工作在超时时间内未排空（如挂起的 promise），**当** destroy 等待超时后，**则** destroy 仍返回（超时兜底），但记录错误日志说明仍有 N 个存活工作（`Async work did not drain`）
3. **假设** 存活工作排空后又有新的工作被注册（注册发生在 await 点之后），**当** destroy 的排空循环运行时，**则** 排空循环持续等待直到工作集为空或超时（循环直到空）
4. **假设** agent 无任何存活工作，**当** 调用 `destroy()` 时，**则** 排空步骤立即返回，不引入额外延迟
5. **假设** 注册的工作 promise reject，**当** 排空等待时，**则** reject 不产生未处理的 promise rejection（注册器吞掉错误，不影响工作集移除）

---

### 用户故事：destroy 终态守卫防止幽灵 dispatch（优先级：P1，回归保护）

作为 Agent SDK 的使用者，我希望 `destroy()` 置为终态后不再触发任何新的 dispatch，以便 destroy 期间由 `abortAIMessage()` 触发的 `onLoadingChange(false)` 或 dispatch `.finally` 重查不会把遗留的排队消息作为新 AI 回合派发出去（#1808 幽灵回归）。

**为什么是这个优先级**：这是 #1817 已修复行为的回归保护。destroy 是终态：`isDestroyed` 一旦设置永不重置，区别于 `abortMessage()` 的临时 `isAborting` 守卫。

**独立测试**：在 message queue 中遗留一条未投递消息（断开 enqueue 回调），调用 `destroy()`，验证 `sendAIMessage` 未被调用、队列保持原样（回归测试已在 agent.abort.test.ts）。

**验收场景**：

1. **假设** message queue 有遗留消息且 agent 调用 `destroy()`，**当** destroy 内 `abortAIMessage()` 触发 `onLoadingChange(false)` 时，**则** `tryDispatch` 被 `isDestroyed` 守卫拦截，不派发新 AI 回合（`sendAIMessage` 调用次数为 0）
2. **假设** dispatch 正在运行中调用 `destroy()`，**当** dispatch `.finally` 执行重查时，**则** 重查被 `isDestroyed` 拦截，不启动新 dispatch
3. **假设** agent 调用 `abortMessage()`（非 destroy），**当** abort 完成后，**则** 若队列有遗留消息仍可正常恢复 dispatch（`isDestroyed` 为 false 时 `isAborting` 复位后行为不变）

---

## 边界情况

- `destroy()` 可被多次调用：第二次调用不抛错（幂等），已置位的 `isDestroyed` 保持为 true
- `sendMessage` 在 destroy 后调用：立即抛错，不修改消息队列、不调用 `InteractionService`
- 存活工作注册表不限制工作数量；排空使用 deadline 超时（默认 10s）避免 destroy 无限挂起
- 注册的 promise 在排空前 reject：注册器内部吞掉错误（保证不产生 unhandled rejection），工作集条目正常移除
- 排空循环在 await 点之间可能注册新工作：循环条件为「工作集非空」，持续排空直到空或超时
- 超时后仍存在的存活工作：destroy 照常返回（兜底），记录错误日志便于排查；这些工作不再受 agent 生命周期管理
- destroy 与 abortMessage 的守卫区分：`isDestroyed` 是终态（destroy 设置后永不重置），`isAborting` 是瞬时态（abortMessage 设置、finally 复位）

### 测试验证需求

- 必须通过 spy `aiManager.sendAIMessage` / `InteractionService.sendMessage` / `bangManager.executeCommand` 验证 destroy 后公开 API 抛错且不产生调用
- 必须通过注册一个手动控制 resolve 的 promise 验证 destroy 等待排空；通过永不 resolve 的 promise + 短超时验证超时兜底与错误日志
- 必须通过 message queue 遗留消息场景验证 destroy 后 `sendAIMessage` 调用次数为 0（#1817 回归测试保留）
