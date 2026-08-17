---
name: "Daemon 客户端命令"
description: "`wave daemon list/status/send/respond/abort` — 查看、续聊、审批与中断 daemon 托管的远端后台会话"
order: 270
---

# 功能规格说明：Daemon 客户端命令

**创建日期**：2026-08-12

## 概述

`wave --daemon <socket>` 在远端主机上启动一个 JSON-RPC over unix socket 的 daemon，托管后台 agent 会话（桌面端经 SSH 隧道访问）。目前除了 `--daemon` 启动标志外，没有任何面向用户的 CLI 命令可以查看 daemon 里托管了哪些会话、会话进度如何、或向会话注入消息继续对话——这些能力只存在于 JSON-RPC 协议层，普通用户与脚本无法直接使用。本规格定义 `wave daemon` 子命令组，将已验证的协议流程（attach → 读消息 → 注入消息 → 审批挂起的权限请求 → 中断生成）封装为五条命令，供用户在远端主机直接执行（或经 `ssh <host> wave daemon ...` 在远端主机上执行）。

## 用户场景与测试 _（必填）_

### 用户故事：Daemon 命令组与默认 socket（优先级：P0）

作为在远端主机上使用 daemon 的用户，我希望通过 `wave daemon` 子命令组（`list` / `status` / `send` / `respond` / `abort`）访问 daemon，固定连接默认 socket，以便无需了解 JSON-RPC 协议即可查看、续聊、审批与中断后台会话。

**为什么是这个优先级**：这是整个命令组的地基——没有统一的命令入口与 socket 寻址规则，list/status/send/respond/abort 无从谈起；daemon 只监听本地 unix socket、不暴露网络端口，且只允许在远端主机上运行，因此客户端命令一律连接默认 socket（`~/.wave/daemon.sock`），不提供 `--socket` 覆盖参数，避免支持本地转发 socket 等非目标用法。

**独立测试**：在远端启动 daemon 后运行 `wave daemon list` 能列出会话；daemon 未运行时运行任一子命令会得到明确错误提示。

**验收场景**：

1. **假设** 远端 daemon 正在运行，**当** 用户运行 `wave daemon list` 时，**则** 命令连接默认 socket（`~/.wave/daemon.sock`）并列出该 daemon 当前托管的全部会话（进程内存中 live 的会话）。
2. **假设** daemon 未运行或 socket 文件不存在（含 daemon 空闲自动退出后），**当** 用户运行任一 `wave daemon` 子命令时，**则** 命令以非零退出码退出并给出明确错误（如「Cannot connect to daemon socket <路径>: is the daemon running?」，附空闲自动退出提示），不进入 TUI、不挂起。
3. **假设** 用户运行 `wave daemon list` 时，**当** 命令执行期间没有需要交互的输入，**则** 命令运行完即退出（非交互式），stdout 输出结果、stderr 输出诊断，便于脚本与管道消费。
4. **假设** 用户误以为 `wave daemon` 与 `wave --daemon <socket>` 相同，**当** 对比两者行为时，**则** `wave --daemon` 启动 daemon（服务端），`wave daemon <子命令>` 访问 daemon（客户端），两者语义不同、互不干扰，帮助文本中明确区分。

---

### 用户故事：列出 daemon 托管的会话（优先级：P0）

作为在远端主机检查后台任务进度的用户，我希望 `wave daemon list` 列出当前 daemon 托管的会话（会话 ID、工作目录、状态、消息数），以便找到目标会话并决定查看或续聊哪一条。

**为什么是这个优先级**：查看进度与继续对话都先要找到会话。会话不归属于某个 daemon 进程——daemon 空闲 60 秒自动退出是正常现象，退出后进程重启、内存清空，磁盘上的历史会话不会随 daemon 常驻。因此「daemon 托管」的准确语义是「当前 daemon 进程内存中 live 的会话」（经 `initialize`/`restoreSession` 载入且仍存活于该进程，即 agentBridge 的会话注册表），`list` 直接暴露该注册表即可，不扫磁盘索引、不需要新增 `listAllSessions` 协议方法，也天然不会列出 daemon 之外的对话（普通 `wave` TUI 创建的会话不在列表中）。

**独立测试**：在 daemon 中创建/恢复两条会话后运行 `wave daemon list`，验证两条会话都出现，且每条含会话 ID、工作目录、状态与消息数；daemon 空闲退出重启后运行 `wave daemon list` 显示 No sessions（退出码 0）。

**验收场景**：

1. **假设** daemon 进程内存中托管了多条会话（不同 workdir 下经 `initialize`/`restoreSession` 载入且仍存活），**当** 用户运行 `wave daemon list` 时，**则** 列出当前进程内存中的全部会话，每条显示会话 ID、工作目录、状态（generating/idle）与消息数，不扫磁盘索引、不列出 daemon 之外的对话。
2. **假设** daemon 托管了多条会话，**当** 用户运行 `wave daemon list` 时，**则** 会话按注册顺序展示（内存态无磁盘索引的 lastActiveAt，不做最后活跃时间排序）。
3. **假设** daemon 空闲退出后重启（进程内存清空）或尚无任何会话，**当** 用户运行 `wave daemon list` 时，**则** 输出空结果（显示 No sessions），退出码为 0——daemon 空闲自动退出是正常现象，列表为空符合预期而非错误。
4. **假设** 磁盘上存在历史会话（含 daemon 空闲退出前托管过、或普通 `wave` TUI 创建的会话），**当** 用户运行 `wave daemon list` 时，**则** 这些会话不出现于列表；用户知道 sessionId 时仍可经 `wave daemon status <sessionId>` / `send <sessionId>` attach（`restoreSession` 会重新载入内存），无需依赖 `list` 找回。

---

### 用户故事：查看会话进度与最近消息（优先级：P0）

作为在远端主机检查后台任务进度的用户，我希望 `wave daemon status <sessionId>` 展示指定会话的实时状态（是否正在生成）与最近消息，以便确认任务进展、判断是否可以继续对话。

**为什么是这个优先级**：这是「查看进度」的核心命令；实时状态只能通过 attach（`initialize {restoreSessionId}` → `restoreSession`）获取——restoreSession 会重放 `loadingChange` 快照，`getMessages` 返回全量消息，磁盘索引不提供这两个信息，因此该命令必须走 attach 流程。

**独立测试**：对一条正在生成回复的会话运行 `wave daemon status <sessionId>`，验证输出包含 generating 状态与最近消息文本；对一条空闲会话运行则显示 idle 状态。

**验收场景**：

1. **假设** 目标会话正在生成回复，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 命令经 `initialize {restoreSessionId}` + `restoreSession` attach 该会话，依据重放的 `loadingChange` 快照显示 generating（生成中）状态。
2. **假设** 目标会话空闲（未在生成、无排队消息、无后台任务），**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 显示 idle 状态。
3. **假设** 目标会话挂起等待权限审批，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 状态显示为 waiting for approval（`loadingChange` 保持 loading 即视为未空闲），与桌面端「待确认」语义一致。
4. **假设** 目标会话挂起等待权限审批，**当** 查看最近消息时，**则** 最后一条 assistant 消息含一个冻结在 `stage: "running"` 的 tool 块：有工具名与参数（`name`/`parameters`/`compactParams`），但无 `result`/`success`/`error`/`shortResult`/`timestamp`——这些字段只在工具完成后（`stage: "end"`）写入，无独立的 pending stage；消息形态上「等审批」与「执行中」无法区分，status 须同时列出 `listPendingPermissions` 返回的待审批请求（工具名 + 参数摘要），作为审批态的确凿信号。
5. **假设** 会话已有历史消息，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 经 `getMessages` 拉取并显示最近若干条消息的文本（含用户消息与助手回复，默认数量可经参数调整，如 `--lines 20`），足以判断任务进展。
6. **假设** 指定的 sessionId 不存在于该 daemon，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 以非零退出码退出并给出明确错误（Session not found or not hosted by this daemon）。
7. **假设** status 命令完成展示后，**当** 命令退出时，**则** 断开与 daemon 的连接（attach 是短暂查看，不常驻），daemon 与目标会话不受影响、继续运行。

---

### 用户故事：响应会话挂起的权限审批（优先级：P0）

作为在远端主机驱动后台会话的用户，我希望 `wave daemon respond <sessionId> <requestId> [--allow|--deny] [--answer <答案JSON>] [--rule <规则>] [--mode <模式>]` 处理会话挂起的权限请求（允许/拒绝、回答提问、记住规则、切换权限模式），以便推进卡在等待审批的会话。

**为什么是这个优先级**：等待审批的会话会一直保持 loading（等同未空闲），不处理就无法继续；协议已有 `permissionResponse` 通知方法（客户端 → 服务端，requestId 进程内全局唯一，见 protocol.ts / agentBridge.ts），无需新增协议方法，纯 CLI 封装即可解锁。审批决策并非单一 allow/deny——`PermissionDecision` 含 behavior/message/newPermissionMode/newPermissionRule 四个字段（桌面端按工具类型组合：EnterPlanMode 附带 `newPermissionMode:"plan"`、AskUserQuestion 用 message 携带答案 JSON、Bash 可带 `newPermissionRule`），命令须按工具智能补全并与桌面端语义一致。

**独立测试**：对一条挂起 Bash 审批的会话运行 `wave daemon respond <sessionId> <requestId> --allow`，验证工具继续执行、会话恢复生成；对一条挂起 AskUserQuestion 的会话运行 `--answer '{"问题":"答案"}'`，验证答案送达；对 EnterPlanMode 运行 `--allow`，验证自动附带 plan 模式切换。

**验收场景**：

1. **假设** 目标会话挂起 Edit/Bash/Write/mcp 等常规工具审批，**当** 用户运行 `wave daemon respond <sessionId> <requestId> --allow` 时，**则** 命令发送 `permissionResponse` 通知（`{requestId, decision:{behavior:"allow"}}`），工具继续执行、会话恢复生成。
2. **假设** 用户运行 `wave daemon respond <sessionId> <requestId> --deny [--reason "原因"]` 时，**则** 发送 `{behavior:"deny", message}`，工具返回「operation denied」错误结束该工具，会话回到空闲。
3. **假设** 目标会话挂起 EnterPlanMode 审批，**当** 用户运行 `wave daemon respond <sessionId> <requestId> --allow` 时，**则** 命令按工具智能补全为 `{behavior:"allow", newPermissionMode:"plan"}`，与会话的权限模式切换为 plan（与桌面端行为一致，无需用户显式传 `--mode`）。
4. **假设** 目标会话挂起 AskUserQuestion 审批，**当** 用户运行 `wave daemon respond <sessionId> <requestId> --answer '{"问题":"答案"}'` 时，**则** 发送 `{behavior:"allow", message: JSON.stringify(答案对象)}`，如同桌面端填写答案后确认；若只传 `--allow` 未传 `--answer`，命令报错提示需要提供答案。
5. **假设** 用户运行 `wave daemon respond <sessionId> <requestId> --allow --rule "Bash(ls)"` 时，**则** 决策附带 `newPermissionRule`，该规则被持久化为允许规则、后续同类调用不再询问（与桌面端「不再询问」语义一致）。
6. **假设** 用户运行 `wave daemon respond <sessionId> <requestId> --allow --mode acceptEdits` 时，**则** 决策附带 `newPermissionMode`，会话权限模式切换为 acceptEdits（后续 Edit/Write 不再询问，与桌面端「自动接受修改」语义一致）。
7. **假设** 指定的 requestId 不存在（已被其他客户端处理或已过期），**当** 用户运行 respond 时，**则** 命令提示「Request not found or already handled」并以非零退出码退出（服务端对未知 requestId 静默忽略，命令应先行校验避免误导）。
8. **假设** 指定的 sessionId 不存在于该 daemon，**当** 用户运行 `wave daemon respond <sessionId> <requestId> --allow` 时，**则** 以非零退出码退出并给出明确错误（Session not found or not hosted by this daemon），不发送任何通知。
9. **假设** respond 命令完成（成功或失败）后，**当** 命令退出时，**则** 断开与 daemon 的连接；会话恢复生成或回到空闲，不因客户端退出而终止。

---

### 用户故事：向会话注入消息继续对话（优先级：P0）

作为在远端主机续聊后台任务的用户，我希望 `wave daemon send <sessionId> <消息>` 向指定会话注入一条用户消息、等待回复完成，并输出助手最终回复，以便不打开完整 UI 即可驱动后台 agent 继续工作。

**为什么是这个优先级**：这是「继续对话」的核心命令，也是用户「本地电脑关机后从另一台机器驱动 daemon 会话」场景的最终诉求；复用已验证的 attach → `sendMessage` → 流式通知 → `loadingChange:false` 收尾流程，非交互式运行便于脚本调用。

**独立测试**：对一条空闲会话运行 `wave daemon send <sessionId> "继续"`，验证会话收到该消息、助手产出回复、命令输出最终回复文本后退出；对正在生成中的会话发送则消息进入队列、命令等待该消息对应的回复完成后退出。

**验收场景**：

1. **假设** 目标会话空闲，**当** 用户运行 `wave daemon send <sessionId> "继续"` 时，**则** 命令经 attach 后调用 `sendMessage` 注入消息，订阅流式通知（`assistantContentUpdated` 等），直到 `loadingChange:false` 表示该回复完成。
2. **假设** 助手回复完成，**当** 命令结束时，**则** stdout 输出该条消息对应的助手最终回复文本（与 `wave -p` 的纯净输出一致，不含子代理内部信息与流式杂讯），退出码为 0。
3. **假设** 目标会话正在生成中，**当** 用户运行 `wave daemon send <sessionId> "消息"` 时，**则** 消息按现有队列语义入队等待，命令持续等待直到该消息对应的回复完成（依据 `loadingChange` 与消息 ID 对应）后输出最终回复。
4. **假设** 目标会话挂起等待权限审批，**当** 用户运行 `wave daemon send <sessionId> "消息"` 时，**则** 命令不无限期挂起：等待超过 `--timeout`（默认 600 秒，`0` 表示不限制）后以非零退出码退出，并提示「Session is waiting for permission approval; handle it with `wave daemon respond <sessionId> <requestId>` and retry」。
5. **假设** 指定的 sessionId 不存在于该 daemon，**当** 用户运行 `wave daemon send <sessionId> "消息"` 时，**则** 以非零退出码退出并给出明确错误，不注入任何消息。
6. **假设** send 命令完成或失败退出后，**当** 命令结束时，**则** 断开与 daemon 的连接，会话在 daemon 中继续存活、不因客户端退出而终止（与 attach 语义一致）。

---

### 用户故事：中断会话正在生成的消息（优先级：P0）

作为在远端主机驱动后台会话的用户，我希望 `wave daemon abort <sessionId>` 中断指定会话正在生成的回复（含子代理、bash 命令与排队消息），以便在模型走偏、回复过长或需要及时止损时打断当前生成，而不必等待其自然完成。

**为什么是这个优先级**：这是「控制后台会话」的核心能力——`send` 能注入消息但无法打断；协议层已有 `abortMessage` 方法（agentBridge 已实现：统一中断 AI 消息、bash 命令、slash 命令与子代理，并清空消息队列，见 protocol.ts / agentBridge.ts），只缺 CLI 封装。中断是幂等操作——在空闲会话上调用是安全 no-op，命令仍成功返回，因此无需校验会话是否正在生成，`abort` 是短暂的 attach 访问、随用随断。

**独立测试**：对一条正在生成回复的会话运行 `wave daemon abort <sessionId>`，验证会话停止生成回到空闲、命令输出确认并以退出码 0 结束；对一条空闲会话运行同一命令，验证命令同样成功退出（幂等 no-op）且不报错。

**验收场景**：

1. **假设** 目标会话正在生成回复（含子代理运行中），**当** 用户运行 `wave daemon abort <sessionId>` 时，**则** 命令经 attach（`initialize {restoreSessionId}` + `restoreSession`）后调用协议 `abortMessage` 方法，会话中断当前生成（含子代理与排队消息）回到空闲，命令输出确认信息并以退出码 0 结束。
2. **假设** 目标会话空闲（未在生成），**当** 用户运行 `wave daemon abort <sessionId>` 时，**则** 中断是幂等 no-op，命令仍输出确认信息并以退出码 0 结束，不报错。
3. **假设** 指定的 sessionId 不存在于该 daemon，**当** 用户运行 `wave daemon abort <sessionId>` 时，**则** 以非零退出码退出并给出明确错误（Session not found or not hosted by this daemon），不调用中断。
4. **假设** abort 命令完成（成功或失败）后，**当** 命令退出时，**则** 断开与 daemon 的连接（attach 是短暂访问，不常驻），会话在 daemon 中继续存活、不因客户端退出而终止；中断不清除已完成的对话历史，只打断进行中的生成与排队消息。

---

### 边界情况

- **daemon 未运行 / socket 不存在**：任一子命令均应快速报错退出（非零退出码 + stderr 明确提示），不得挂起或进入 TUI；提示须覆盖「daemon 空闲 60 秒自动退出」这一正常现象。
- **默认 socket 固定**：所有 `wave daemon` 子命令一律连接 `~/.wave/daemon.sock`，不提供 `--socket` 覆盖参数；命令只在远端主机上运行，不面向本地转发的 socket。
- **`wave daemon` 与 `wave --daemon` 语义冲突**：前者是客户端子命令组（list/status/send/respond/abort），后者是服务端启动标志；帮助文本须写明差异，避免误用。
- **list 仅反映当前进程内存态**：`list` 展示的是当前 daemon 进程内 live 的会话（`initialize`/`restoreSession` 载入且仍存活），不扫磁盘索引；daemon 空闲退出/重启后内存清空、列表为空是正常现象。磁盘上的历史会话（含普通 `wave` TUI 创建的）不在列表中，但知道 sessionId 仍可经 `status`/`send` attach（`restoreSession` 重新载入），无需依赖 `list` 找回。
- **会话挂起等待审批**：daemon 语义下「等待审批」的会话保持 loading 状态（等同未空闲）；消息中该工具块冻结在 `stage: "running"`（有工具名与参数、无结果字段，结果字段只在 `stage: "end"` 写入），单凭消息无法区分「等审批」与「执行中」，须结合 `listPendingPermissions` 判断；`send` 须有 `--timeout` 兜底避免无限挂起，`status` 应如实显示该状态，`respond` 是处理挂起请求的入口。
- **respond 的决策并非单一 allow/deny**：`PermissionDecision` 含 behavior/message/newPermissionMode/newPermissionRule 四个字段；EnterPlanMode 的 allow 必须附带 `newPermissionMode:"plan"`（按工具智能补全），AskUserQuestion 必须用 `--answer` 提供答案（allow 且 message 为答案 JSON），Bash/Edit 可选 `--rule`/`--mode`；命令须与桌面端行为一致，不得把多选项压成裸 allow/deny。
- **requestId 幂等与过期**：服务端对未知 requestId 的 `permissionResponse` 静默忽略；respond 应先行校验（如经 `listPendingPermissions`）并在 requestId 已处理时明确提示，避免用户误以为审批已生效。
- **`send` 输出纯净性**：命令输出助手最终回复文本，流式通知与子代理内部信息不得泄漏到 stdout（与打印模式一致），诊断信息走 stderr。
- **`abort` 中断是幂等操作**：在空闲会话上是无害 no-op，命令仍成功返回；对正在生成（含子代理、bash 命令、slash 命令）或挂起审批的会话，中断后回到空闲（与桌面端中断按钮语义一致）。`abort` 不清除已完成的对话历史，只打断进行中的生成并清空消息队列；无需先经 `status` 确认是否正在生成。
- **attach 是短暂访问**：`status` / `send` / `respond` / `abort` 完成即断开连接，不常驻客户端；daemon 与会话的生命周期不受客户端连接影响（attach/detach 语义，会话持续运行至空闲自动退出或用户删除）。
