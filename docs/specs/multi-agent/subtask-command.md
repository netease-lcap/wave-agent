---
name: "子任务派发（/subtask）"
description: "`/subtask <task>` 斜杠命令：把任务连同当前对话的完整上下文派给一个后台 subagent，当前对话不中断，结果以 task notification 回到这里"
order: 96
---

# 功能规格说明：子任务派发（/subtask）

**创建日期**：2026-11-18

## 概述

今天 CLI 用户没法把一个任务「带着当前对话的上下文」派给后台去做：Agent 工具是**模型**发起的，而内置 subagent（Explore / general-purpose / Plan / vision）一律**零上下文起步**——`subagentManager.ts:611-620` 给子实例建的是独立 MessageManager，`internalExecute` 只往里塞一条 prompt，模型以外的东西它一概不知道。用户想「这段对话聊到这儿了，你带着这些上下文去把这事办了，我接着聊」，只能自己复述一遍前情。

本规格补一条用户级入口：**`/subtask <task>`**——把当前对话的完整上下文连同这句任务描述派给一个后台 subagent，当前对话**不中断**、可以继续聊，子任务跑完后结果以 task notification 回到当前对话。

对齐 Claude Code 2.1.325 的同名命令（二进制里的定义）：

```js
{ type:"local-jsx", name:"subtask",
  description:"Send a subagent off with your full context; its result comes back here",
  argumentHint:"<task>" }
```

底层是 CC 的 fork 型 subagent（`subagent_type: "fork"`），二进制里的契约：

- `A type of "fork" forks yourself, allowing the fork to inherit your full conversation and context, and ensuring that it runs on the same model that you are running on (a model override is ignored for forks)`
- `Any agent other than a fork starts with zero context.`
- `Each agent you launch has a budget of {N} tokens. For a fork, the budget does not count the context it starts with.`
- `After launching a background fork, you know nothing about what it found.`（结果靠通知回传，不是同步返回值）
- `Cannot start a subtask before the first conversation turn`

**非目标（本轮不做）**：`/fork`（把整段对话复制成一个新的后台会话、当前继续）、`/branch`（在当前消息处开对话分支）、`/background`（daemon 托管 + 释放终端）、把 fork 型 agent 暴露成 Agent 工具的 `subagent_type` 选项、跨进程/跨机器子任务、子任务之间的消息互通。

**与既有能力的分工**：`task-background-execution.md` 的 Ctrl+B / `/tasks` 管的是「让已经在跑的工具调用脱离当前回合」；`subagent.md` / `general-purpose-agent.md` 是模型经 Agent 工具发起的零上下文子代理。本规格是唯一一条**用户发起、带父上下文**的入口。

## 用户场景与测试 _（必填）_

### 用户故事：/subtask 带上下文派发一个后台子任务（优先级：P0）

作为已经和 Claude 聊了很久、把问题摸清楚的用户，我希望能把接下来的活儿连同这段对话的上下文一起派出去，让它自己在后台干，而我继续在这条对话里聊别的。

**为什么是这个优先级**：这是本规格的全部内容。判断标准有三条：**子任务真的拿到了上下文**、**当前对话确实没被占用**、**结果最后回到这里**。

**独立测试**：在一段已有若干轮对话的会话里执行 `/subtask 按我们刚讨论的方案把那个接口改了`，主输入框立刻恢复可用；用 `/tasks` 能看到这个子任务在跑；它结束后主对话里出现一条带结果的 task notification，内容体现出它知道前文讨论的方案。

**验收场景**：

1. **假设** 当前会话已经至少有一轮对话，**当** 用户执行 `/subtask <task>` 时，**则** 系统以当前对话消息的快照为初始上下文起一个后台 subagent（run-in-background），主对话**不进入 loading 状态**、输入框保持可用，用户马上能继续提问。
2. **假设** 当前对话有 M 条消息，**当** 子任务被派发时，**则** 子 agent 的初始消息列表逐条等于这 M 条消息的内容与顺序（时间戳与 id 不要求一致），且父会话之后新增的消息不会流进这个子任务。
3. **假设** 子任务在后台跑完（完成或失败），**当** 它结束时，**则** 结果以 `<task-notification>` 的形式出现在父对话里（task-id、task-type=agent、status、summary、子任务最终回答所在的 `<result>`、本次运行的 `<usage>`），与现有后台 subagent 的通知形态一致；通知超过 100 000 字符时保留首尾、中间以 `[truncated N characters]` 标记；子任务**不**写入父会话的 transcript。
4. **假设** 用户在子任务跑着的时候继续在主对话里发消息，**当** 这些消息被处理时，**则** 它们只属于主对话，不进入子任务的上下文，也不触发子任务的额外回合。
5. **假设** 用户执行 `/subtask` 但没给任务描述，**当** 命令执行时，**则** 拒绝执行并提示用法（`/subtask <task>`），不派发空任务。
6. **假设** 用户在新的会话里（还没有任何一轮对话）执行 `/subtask <task>`，**当** 命令执行时，**则** 拒绝执行并说明「第一轮对话之后才能派发子任务」（对齐 CC 的 `Cannot start a subtask before the first conversation turn`）。
7. **假设** 子任务正在跑，**当** 用户在 `/tasks`（或 `/agents`）里查看时，**则** 能找到它、看到状态与输出，并能用已有的停止手段把它停掉（复用 `BackgroundTaskManager` 既有能力，不新增入口）。
8. **假设** 用户在主对话里执行 `/clear` 或 `/compact`，**当** 子任务仍在跑时，**则** 子任务继续跑完并照常回报（对齐 `/clear` 不会杀掉后台任务的既有语义）。

---

### 用户故事：子任务的上下文继承边界（优先级：P0）

作为实现与排查的人，我需要说清「继承上下文」到底继承了什么、什么不算，以便用户能预期它的行为，也避免把父会话越搞越脏。

**为什么是这个优先级**：这是这个功能唯一的技术难点——把父对话喂给子 agent，一旦方向搞错（比如让子 agent 反向写回父 transcript、或者让子 agent 的 tool 噪声回流），父会话就被污染了，而用户看不到污染是怎么来的。

**独立测试**：跑一个 `/subtask`，事后检查父会话的 transcript，除了那一条 task notification 之外没有新增内容；子任务自己的消息在它自己的记录里。

**验收场景**：

1. **假设** 子任务启动时继承了 M 条消息，**当** 它开始跑时，**则** 这 M 条消息按 CC 的口径**不计入**它的 token 预算上限（预算只约束它自己新产生的回合），但会计入它实际发送给模型的上下文。
2. **假设** 子任务继承的上下文快照包含工具调用与工具结果，**当** 它执行时，**则** 这些历史块原样作为历史消息存在，不重新执行任何工具。
3. **假设** 子任务跑完后用户查看父会话，**当** 检查转录时，**则** 父会话只多了一条 task notification——子任务的中间消息、工具输出一律不写进父 transcript。
4. **假设** 父会话处于 plan 或 dontAsk 等权限模式，**当** 子任务被派发时，**则** 子任务沿用父会话的权限模式，不重新推断、也不能自行切换出 plan 模式。
5. **假设** 父会话当前用的是模型 X，**当** 子任务运行时，**则** 它用同一个模型（不支持为该子任务单独指定模型）。
6. **假设** 用户在子任务跑到一半时手动中断它（`/tasks` 里的 stop），**当** 中断生效时，**则** 父对话收到一条失败/中断状态的 task notification，父会话本身不受影响。

---

### 用户故事：四个入口看到的是同一条命令（优先级：P1）

作为在终端、桌面端、VS Code、JetBrains 和手机远控页之间来回切换的用户，我希望 `/subtask` 在哪一端都在、都按同样的规则工作，而不是「桌面端有、插件端没有」。

**为什么是这个优先级**：这条命令**不需要任何宿主界面**——它起的是 SDK 里的 subagent，结果回到对话里。所以它属于 SDK 的命令表，不是宿主本地命令。做成 SDK 命令是一次注册全体生效；反过来如果做成宿主本地命令，四个宿主各写一遍、各测一遍，必然漂移。

**独立测试**：四端 + 远控页的 `/` 弹窗里都能看到 `/subtask`；从任一端执行都能起子任务，结果都回到当前对话。

**验收场景**：

1. **假设** SDK 侧注册了 `/subtask`，**当** 任一入口（CLI / 桌面 / VS Code / JetBrains / 远控页）拉取命令表时，**则** 它出现在列表里——命令表由 `agent.getSlashCommands()` 与宿主本地表合并下发，这条走前者，因此不需要改任何宿主。
2. **假设** 用户从任一端执行 `/subtask <task>`，**当** 执行时，**则** 走的是同一个 SDK handler，上下文继承、后台运行、结果回报的行为完全一致。
3. **假设** 子任务在某一端被派发，**当** 用户在该端打开 `/tasks` 时，**则** 能看到它的状态与输出并停掉它（桌面端右栏面板，其他端弹窗——既有承载，不新增界面）。
4. **假设** 将来某个入口不该有这条命令，**当** 需要收窄时，**则** 在宿主本地表里按入口过滤即可，不改 SDK 注册。
5. **假设** CLI 用户输入 `/subtask`，**当** 命令识别时，**则**它列在内置命令表里以获得补全提示；即便不在表里，消息也会作为斜杠命令落到 agent 执行，不会当成普通提问发给模型。

---

### 边界情况

- **上下文大小**：父对话接近上下文上限时派发子任务，继承的快照可能让子 agent 第一次请求就超限；此时报错并说明原因，不静默截断历史（要不要截断留给以后）。
- **重复派发**：同一段对话可以连派多个 `/subtask`，每个子任务拿到的是各自派发时刻的快照，彼此不知道对方。
- **worktree**：子任务默认在父会话的当前工作目录里跑，不自动开 worktree；要隔离由用户在任务描述里自行说明（本轮不提供 `/subtask --worktree`）。
- **子任务的续聊**：本轮不支持「继续跟这个子任务对话」；它是一次性派发，结果回来就结束。
- **父会话被关闭**：CLI 退出时按既有 `Agent.destroy()` 语义处理后台任务（中止并落盘），子任务不跨进程存活——需要跨进程存活用 daemon 那套（`daemon-command.md`），不在本规格范围。
