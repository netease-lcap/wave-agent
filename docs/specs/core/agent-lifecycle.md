---
name: "Agent 生命周期"
description: "destroy() 的确定性排空语义：存活工作注册表、destroy 后公开 API 抛错、destroy 终态守卫（防幽灵 dispatch）"
order: 145
---

# 功能规格说明：Agent 生命周期

**创建日期**：2026-08-18

## 用户场景与测试 _（必填）_

### 用户故事：destroy 后公开 API 抛错（优先级：P1）

作为 Agent SDK 的使用者，我希望在调用 `destroy()` 之后继续调用 `sendMessage` / `bang` / `askBtw` 等公开 API 时得到一个明确的 `Agent destroyed` 错误，而不是被静默丢弃或在新生命周期上执行，以便在开发阶段就能立即发现生命周期误用（destroy 是终态操作，之后不允许任何新工作开始）。

**为什么是这个优先级**：这是生命周期契约显式化的最小改动（几行 guard）。当前 destroy 后 `sendMessage` 会因 `isLoading=false` 直接走 `InteractionService.sendMessage` 在已销毁的 agent 上启动新的 AI 回合（幽灵的另一条路径），静默丢弃只会让误用靠幽灵暴露。

**独立测试**：创建 Agent、调用 `destroy()`，随后分别调用 `sendMessage`、`bang`、`askBtw`，验证每个调用都同步抛出 `Error("Agent destroyed")`，且不产生任何 AI 调用。

**验收场景**：

1. **假设** agent 已调用 `destroy()`，**当** 调用 `sendMessage("hello")` 时，**则** 抛出 `Error("Agent destroyed")`，且不会调用 `InteractionService.sendMessage` / `aiManager.sendAIMessage`
2. **假设** agent 已调用 `destroy()`，**当** 调用 `bang("ls")` 时，**则** 抛出 `Error("Agent destroyed")`，且不会执行 bash 命令
3. **假设** agent 已调用 `destroy()`，**当** 调用 `askBtw("question")` 时，**则** 抛出 `Error("Agent destroyed")`
4. **假设** agent 尚未销毁，**当** 调用上述任一公开 API 时，**则** 行为与现状完全一致（不抛错，正常入队或执行）

---

### 用户故事：destroy 确定性排空存活工作（优先级：P1）

作为 Agent SDK 的使用者，我希望 `destroy()` 在返回前等待所有已注册的存活异步工作（dispatch、subagent 等 fire-and-forget 工作）排空，以便销毁后不存在任何跨生命周期存活的异步副作用（幽灵物理上不可能存在）。

**为什么是这个优先级**：这是 #1808（destroy 后幽灵 dispatch）的治本方案。当前 destroy 仅等待 `dispatchPromise`，subagent 的 fire-and-forget IIFE（`subagentManager.executeAgent` 后台执行）不在等待范围内——它们通过 `backgroundTaskManager.cleanup()` 被中止但未被 await。将「尽力清理」升级为「注册 → 中止 → await 排空（带超时兜底）→ 断言工作集为空」。

**独立测试**：注册一个手动控制的存活工作（延迟 resolve 的 promise），调用 `destroy()`，验证 destroy 在控制 promise resolve 之前不返回；resolve 后 destroy 正常返回且工作集为空。

**验收场景**：

1. **假设** agent 有已注册的存活异步工作（如进行中的 subagent），**当** 调用 `destroy()` 时，**则** destroy 等待所有存活工作排空后才返回，工作集最终为空
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

### 用户故事：中断只中止当前轮，排队消息保留并继续执行（优先级：P1）

作为 CLI / 桌面端 / 插件端用户，我希望在 AI 正在回答时按 Esc / Stop 只中止当前这一轮，已经排好的消息不被清空，并在中断后按原顺序继续发出去（第一条立刻开始），以便我不敢"停一下"也不会把自己刚打出的内容静默丢掉。

**为什么是这个优先级**：对齐 Claude Code（2.1.325 实测：父会话流式中输入 `/subtask …` 会入队并提示 `Press up to edit queued messages`；Esc 打断当前轮后，队列里那条命令照常执行）。现状 `Agent.abortMessage()` 在忙碌时 `messageQueue.clear()` 把用户排队项整批抹掉，而这条路径是四端共用的（CLI 的 Esc、桌面端 / VS Code / JetBrains 的 Stop、确认卡无理由关闭触发的 `deny → abort`），所以一次 Stop 会把用户已经打出的内容无声丢弃。

**独立测试**：让一轮回答处于生成中，发送两条消息入队，调用 `abortMessage()`，验证队列两条都还在、中断结束后第一条开始新回合、第二条在它之后出队。

**验收场景**：

1. **假设** 当前轮正在生成、队列里有两条用户消息，**当** 用户中断（Esc / Stop）时，**则** 只中止当前轮，两条排队消息都保留（`onQueuedMessagesChange` 报告的数量不减少）
2. **假设** 中断已经完成、agent 回到空闲，**当** 队列非空时，**则** 队首立刻出队开始新回合，其余按原顺序继续（与未中断时的出队节奏一致）
3. **假设** 队列里还有后台任务完成通知，**当** 用户中断时，**则** 通知同样保留，且中断本身不额外触发一轮 AI 回答
4. **假设** 中断发生时正在 dispatch 一条排队消息（该条已出队），**当** 中断生效时，**则** 这条不会重新入队，避免同一条消息被发两次
5. **假设** 用户中断后队列为空，**当** 中断收尾时，**则** 不产生任何新回合
6. **假设** `destroy()` 被调用，**当** 生命周期终结时，**则** 与中断语义无关：遗留队列不会被派发（沿用上面 destroy 终态守卫的故事）
7. **假设** 宿主正在换掉这场对话（清空对话 / 恢复历史会话 / 配置重建），**当** 它中断并显式要求丢弃队列时，**则** 排队中的用户消息被丢弃且不续跑；这个开关只属于「对话被替换」的路径，Stop 不传

---

## 边界情况

- 中断后的「继续执行」由中断收尾显式触发一次 dispatch：`abortMessage()` 期间 `isAborting` 会拦住 `onLoadingChange(false)` 引起的派发，若不显式补一次，队列会停在那里直到下一条用户输入
- 「只中断当前轮」是 Stop 的唯一语义：本地 Stop 与远控页 Stop 走同一条 RPC，都不接「清空队列的全停入口」，避免四端出现两种 Stop
- 唯一的例外是「对话被替换」：VS Code 的 `clearChat` / `restoreSession` / `updateConfig` 与桌面端的配置重建会传 `{ clearQueue: true, resumeQueue: false }` —— 那些排队消息属于已经不存在的对话，跑到新会话里就是串台（RPC 参数由 `abortMessage` 透传，JetBrains 不传即默认保留）

- `destroy()` 可被多次调用：第二次调用不抛错（幂等），已置位的 `isDestroyed` 保持为 true
- `sendMessage` 在 destroy 后调用：立即抛错，不修改消息队列、不调用 `InteractionService`
- 存活工作注册表不限制工作数量；排空使用 deadline 超时（默认 10s）避免 destroy 无限挂起
- 注册的 promise 在排空前 reject：注册器内部吞掉错误（保证不产生 unhandled rejection），工作集条目正常移除
- 排空循环在 await 点之间可能注册新工作：循环条件为「工作集非空」，持续排空直到空或超时
- 超时后仍存在的存活工作：destroy 照常返回（兜底），记录错误日志便于排查；这些工作不再受 agent 生命周期管理
- destroy 与 abortMessage 的守卫区分：`isDestroyed` 是终态（destroy 设置后永不重置），`isAborting` 是瞬时态（abortMessage 设置、finally 复位）

### 测试验证需求

- 必须通过 spy `aiManager.sendAIMessage` / `InteractionService.sendMessage` / `bashModeManager.executeCommand` 验证 destroy 后公开 API 抛错且不产生调用
- 必须通过注册一个手动控制 resolve 的 promise 验证 destroy 等待排空；通过永不 resolve 的 promise + 短超时验证超时兜底与错误日志
- 必须通过 message queue 遗留消息场景验证 destroy 后 `sendAIMessage` 调用次数为 0（#1817 回归测试保留）
