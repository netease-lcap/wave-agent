---
name: "Daemon 客户端命令"
description: "`wave daemon create/list/status/send/respond/abort/destroy/stop/restart` — 按需创建、查看、续聊、审批、中断、销毁与优雅停止/重启 daemon 托管的远端后台会话"
order: 270
---

# 功能规格说明：Daemon 客户端命令

**创建日期**：2026-08-12

## 概述

`wave --daemon <socket>` 在远端主机上启动一个 JSON-RPC over unix socket 的 daemon，托管后台 agent 会话（桌面端经 SSH 隧道访问）。目前除了 `--daemon` 启动标志外，没有任何面向用户的 CLI 命令可以查看 daemon 里托管了哪些会话、会话进度如何、或向会话注入消息继续对话——这些能力只存在于 JSON-RPC 协议层，普通用户与脚本无法直接使用。本规格定义 `wave daemon` 子命令组，将已验证的协议流程（创建会话 → attach → 读消息 → 注入消息 → 审批挂起的权限请求 → 中断生成 → 销毁会话 → 优雅停止/重启 daemon 进程）封装为九条命令（`create` / `list` / `status` / `send` / `respond` / `abort` / `destroy` / `stop` / `restart`），供用户在远端主机直接执行（或经 `ssh <host> wave daemon ...` 在远端主机上执行）。daemon 一经拉起即常驻（空闲不退出，仅在被 stop/restart 优雅关闭、kill / 升级重启 / 机器重启后消失）——除 `stop` 外，任一子命令连接 socket 失败（daemon 未运行）时自动以 nohup 方式拉起 daemon（`wave --daemon ~/.wave/daemon.sock`）并重试连接，按需即用；`stop` 永不自动拉起，daemon 未运行时幂等成功（restart 未运行时等价于直接拉起）。

## 用户场景与测试 _（必填）_

### 用户故事：Daemon 命令组与默认 socket（优先级：P0）

作为在远端主机上使用 daemon 的用户，我希望通过 `wave daemon` 子命令组（`create` / `list` / `status` / `send` / `respond` / `abort` / `destroy` / `stop` / `restart`）访问 daemon，固定连接默认 socket，以便无需了解 JSON-RPC 协议即可创建、查看、续聊、审批、中断、销毁与优雅停止/重启后台会话。

**为什么是这个优先级**：这是整个命令组的地基——没有统一的命令入口与 socket 寻址规则，create/list/status/send/respond/abort/destroy/stop/restart 无从谈起；daemon 只监听本地 unix socket、不暴露网络端口，且只允许在远端主机上运行，因此客户端命令一律连接默认 socket（`~/.wave/daemon.sock`），不提供 `--socket` 覆盖参数，避免支持本地转发 socket 等非目标用法。daemon 一经拉起即常驻运行（空闲不退出）：除 `stop` 外任一子命令连接失败时自动以 nohup 方式拉起 daemon（`wave --daemon ~/.wave/daemon.sock`，nohup+重定向使启动器立即返回）并重试连接，按需即用——`stop` 不会拉起 daemon（未运行时幂等成功），`restart` 未运行时等价于直接拉起。

**独立测试**：在远端启动 daemon 后运行 `wave daemon list` 能列出会话；daemon 未运行时运行任一子命令会自动拉起 daemon 并重试连接（成功则命令照常执行，失败则给出明确错误提示）。

**验收场景**：

1. **假设** 远端 daemon 正在运行，**当** 用户运行 `wave daemon list` 时，**则** 命令连接默认 socket（`~/.wave/daemon.sock`）并列出该 daemon 当前托管的全部会话（进程内存中 live 的会话）。
2. **假设** daemon 未运行或 socket 文件不存在（含 daemon 被 stop / kill / 升级重启 / 机器重启后），**当** 用户运行任一除 `stop` 外的 `wave daemon` 子命令时，**则** 命令自动以 nohup 方式拉起 daemon（`wave --daemon ~/.wave/daemon.sock`，nohup+重定向使启动器立即返回）并重试连接——daemon 一经拉起即常驻（空闲不退出）、按需即用；仅当拉起的 daemon 在启动超时内仍未就绪时，命令才以非零退出码退出并给出明确错误，不进入 TUI、不挂起。`stop` 在 daemon 未运行时是幂等成功（不拉起 daemon），`restart` 未运行时等价于直接拉起（见「停止与重启 daemon」故事）。
3. **假设** 用户运行 `wave daemon list` 时，**当** 命令执行期间没有需要交互的输入，**则** 命令运行完即退出（非交互式），stdout 输出结果、stderr 输出诊断，便于脚本与管道消费。
4. **假设** 用户误以为 `wave daemon` 与 `wave --daemon <socket>` 相同，**当** 对比两者行为时，**则** `wave --daemon` 启动 daemon（服务端），`wave daemon <子命令>` 访问 daemon（客户端），两者语义不同、互不干扰，帮助文本中明确区分。
5. **假设** daemon 已拉起、托管的所有会话均已停止且无任何客户端连接（空闲状态持续远超原 60 秒宽限期），**当** 用户查看该 daemon，**则** daemon 必须保持运行不自动退出——进程内存中的会话注册表与挂起状态持续保留；daemon 只在被 kill / 升级重启 / 机器重启后消失，届时下一次子命令连接失败会再次自动拉起（场景 2）。

---

### 用户故事：创建新会话（优先级：P0）

作为在远端主机启动后台任务的用户，我希望 `wave daemon create` 在 daemon 中创建一个新会话（可指定 `--worktree` 把会话建在新的 git worktree 里）并输出 sessionId，以便将后续的 send/abort/destroy 等操作指向该会话。

**为什么是这个优先级**：在原有命令之外补全会话生命周期——此前会话只能由桌面端/IDE 经 `initialize` 创建，纯 CLI 用户没有入口；协议层 `initialize` 不带 `restoreSessionId` 即无条件新建会话（无 attach 分支，无需存在性检查），命令是参数转发 + 输出 sessionId 的薄封装。默认 `workdir=当前目录`、`permissionMode=bypassPermissions` 对齐 daemon 后台任务用例（与 `wave -p --dangerously-skip-permissions` 的批处理心智一致）。

**独立测试**：运行 `wave daemon create` 输出新 sessionId，随后 `wave daemon status <sessionId>` 能看到该会话；`--workdir` / `--permission-mode` / `--model` 参数正确透传到新会话；`--worktree [name]` 会先经协议 `createWorktree` 创建 git worktree，再用 worktree 路径作为 workdir 创建会话。

**验收场景**：

1. **假设** daemon 正在运行，**当** 用户运行 `wave daemon create` 时，**则** 命令经协议 `initialize`（不带 `restoreSessionId`，因此总是新建而非 attach）在 daemon 中创建一个新会话，stdout 输出新会话的 sessionId（退出码 0），供后续 `status` / `send` / `abort` / `destroy` 使用。
2. **假设** 用户未显式传参，**当** 运行 `wave daemon create` 时，**则** 新会话默认 `workdir` 为命令运行时的当前目录、默认 `permissionMode` 为 `bypassPermissions`（无需审批即可后台执行，对齐 `wave -p --dangerously-skip-permissions` 批处理心智）。
3. **假设** 用户传入 `--workdir <路径>` / `--permission-mode <模式>` / `--model <模型>`，**当** 运行 `wave daemon create` 时，**则** 新会话以对应值创建（`permissionMode` 支持 default/bypassPermissions/acceptEdits/plan/dontAsk，非法值报错并以非零退出码退出，校验先于连接、不会拉起 daemon）。
4. **假设** daemon 未运行，**当** 用户运行 `wave daemon create` 时，**则** 命令自动拉起 daemon 并重试连接（与其余子命令一致的按需启动语义）；仅当拉起的 daemon 在启动超时内未就绪时才以非零退出码退出。
5. **假设** 用户传入 `--worktree [name]`，**当** 运行 `wave daemon create --worktree` 时，**则** 命令先经协议 `createWorktree`（params: workdir + name，name 缺省时由服务端自动生成）在目标仓库创建新的 git worktree，再用返回的 worktree path 作为 workdir 调 `initialize` 创建会话；stdout 依次输出 sessionId（第一行，保持脚本兼容）与 `Worktree: <path> (branch: <branch>)`。会话的 workdir 是 worktree 路径本身（`git rev-parse --show-toplevel` 从该目录的返回，即链接 worktree 的顶层），与 `--workdir` 不共存（同时给出时 `--worktree` 优先）。

---

### 用户故事：列出 daemon 托管的会话（优先级：P0）

作为在远端主机检查后台任务进度的用户，我希望 `wave daemon list` 列出当前 daemon 托管的会话（会话 ID、工作目录、状态、消息数），以便找到目标会话并决定查看或续聊哪一条。

**为什么是这个优先级**：查看进度与继续对话都先要找到会话。会话不归属于某个 daemon 进程——daemon 进程退出/重启（被 kill / 升级重启 / 机器重启）会清空内存注册表，但磁盘上的历史会话转录仍会保留、可随时重新载入。因此「daemon 托管」的准确语义是「当前 daemon 进程内存中 live 的会话」（经 `initialize`/`restoreSession` 载入且仍存活于该进程，即 agentBridge 的会话注册表），`list` 直接暴露该注册表即可，不扫磁盘索引、不需要新增 `listAllSessions` 协议方法，也天然不会列出 daemon 之外的对话（普通 `wave` TUI 创建的会话不在列表中）。

**独立测试**：在 daemon 中创建/恢复两条会话后运行 `wave daemon list`，验证两条会话都出现，且每条含会话 ID、工作目录、状态与消息数；daemon 重启（被 kill / 升级重启 / 机器重启）后运行 `wave daemon list` 显示 No sessions（退出码 0）。

**验收场景**：

1. **假设** daemon 进程内存中托管了多条会话（不同 workdir 下经 `initialize`/`restoreSession` 载入且仍存活），**当** 用户运行 `wave daemon list` 时，**则** 列出当前进程内存中的全部会话，每条显示会话 ID、工作目录、状态（generating/idle）与消息数，不扫磁盘索引、不列出 daemon 之外的对话。
2. **假设** daemon 托管了多条会话，**当** 用户运行 `wave daemon list` 时，**则** 会话按注册顺序展示（内存态无磁盘索引的 lastActiveAt，不做最后活跃时间排序）。
3. **假设** daemon 重启后（进程内存清空；被 kill / 升级重启 / 机器重启）或尚无任何会话，**当** 用户运行 `wave daemon list` 时，**则** 输出空结果（显示 No sessions），退出码为 0——列表为空符合预期而非错误。
4. **假设** 磁盘上存在历史会话（含 daemon 重启前托管过、或普通 `wave` TUI 创建的会话），**当** 用户运行 `wave daemon list` 时，**则** 这些会话不出现于列表；用户知道 sessionId 时仍可经 `wave daemon status <sessionId>` / `send <sessionId>` attach（`restoreSession` 会重新载入内存），无需依赖 `list` 找回。

---

### 用户故事：查看会话进度与最近消息（优先级：P0）

作为在远端主机检查后台任务进度的用户，我希望 `wave daemon status <sessionId>` 展示指定会话的实时状态（是否正在生成）与最近消息，以便确认任务进展、判断是否可以继续对话。

**为什么是这个优先级**：这是「查看进度」的核心命令；实时状态只能通过 attach（`initialize {restoreSessionId}` → `restoreSession`）获取——restoreSession 会重放 `loadingChange` 快照，`getMessages` 返回全量消息，磁盘索引不提供这两个信息，因此该命令必须走 attach 流程。

**独立测试**：对一条正在生成回复的会话运行 `wave daemon status <sessionId>`，验证输出包含 generating 状态与最近消息文本；对一条空闲会话运行则显示 idle 状态。

**验收场景**：

1. **假设** 目标会话正在生成回复，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 命令经 `initialize {restoreSessionId}` + `restoreSession` attach 该会话，依据重放的 `loadingChange` 快照显示 generating（生成中）状态。
2. **假设** 目标会话空闲（未在生成、无排队消息、无后台任务），**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 显示 idle 状态。
3. **假设** 目标会话挂起等待权限审批，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 状态显示为 waiting for approval（`loadingChange` 保持 loading 即视为未空闲），与桌面端「待确认」语义一致。
4. **假设** 目标会话挂起等待权限审批，**当** 查看最近消息时，**则** 最后一条 assistant 消息含一个冻结在 `stage: "running"` 的 tool 块：有工具名与参数（`name`/`parameters`/`compactParams`），但无 `result`/`success`/`error`/`shortResult`/`timestamp`——这些字段只在工具完成后（`stage: "end"`）写入，无独立的 pending stage；消息形态上「等审批」与「执行中」无法区分，status 须同时列出 `listPendingPermissions` 返回的待审批请求（工具名 + 参数摘要），作为审批态的确凿信号；其中 AskUserQuestion 请求不做单行截断，改为与桌面确认弹窗同构的多行完整渲染——每题一行标题（含题号与 header 标签，如 `Q1 [删除文案] 删除会话后转录…`）、每选项一行（含从 0 起的序号与说明，如 `  0. 更新文案明示可恢复（推荐） — 说明…`），完整展示问题与选项；其余工具的请求仍按单行参数摘要展示。
5. **假设** 会话已有历史消息，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 经 `getMessages` 拉取并显示最近若干条消息的文本（含用户消息与助手回复，默认数量可经参数调整，如 `--lines 20`），足以判断任务进展。
6. **假设** 指定的 sessionId 不存在于该 daemon，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 以非零退出码退出并给出明确错误（Session not found or not hosted by this daemon）。
7. **假设** status 命令完成展示后，**当** 命令退出时，**则** 断开与 daemon 的连接（attach 是短暂查看，不常驻），daemon 与目标会话不受影响、继续运行。

---

### 用户故事：响应会话挂起的权限审批（优先级：P0）

作为在远端主机驱动后台会话的用户，我希望 `wave daemon respond <sessionId> <requestId> [--allow|--deny] [--answer <答案JSON|选项序号>] [--rule <规则>] [--mode <模式>]` 处理会话挂起的权限请求（允许/拒绝、回答提问、记住规则、切换权限模式），以便推进卡在等待审批的会话。

**为什么是这个优先级**：等待审批的会话会一直保持 loading（等同未空闲），不处理就无法继续；协议已有 `permissionResponse` 通知方法（客户端 → 服务端，requestId 进程内全局唯一，见 protocol.ts / agentBridge.ts），无需新增协议方法，纯 CLI 封装即可解锁。审批决策并非单一 allow/deny——`PermissionDecision` 含 behavior/message/newPermissionMode/newPermissionRule 四个字段（桌面端按工具类型组合：EnterPlanMode 附带 `newPermissionMode:"plan"`、AskUserQuestion 用 message 携带答案 JSON、Bash 可带 `newPermissionRule`），命令须按工具智能补全并与桌面端语义一致。

**独立测试**：对一条挂起 Bash 审批的会话运行 `wave daemon respond <sessionId> <requestId> --allow`，验证工具继续执行、会话恢复生成；对一条挂起 AskUserQuestion 的会话运行 `--answer '{"问题":"答案"}'` 或按 `wave daemon status` 渲染的选项序号运行 `--answer "0"`（多题逗号分隔，如 `--answer "1,0"`），验证答案送达且等价；对 EnterPlanMode 运行 `--allow`，验证自动附带 plan 模式切换。

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
10. **假设** 目标会话挂起 AskUserQuestion 审批、`wave daemon status` 已多行渲染题目与带序号的选项，**当** 用户运行 `wave daemon respond <sessionId> <requestId> --answer "1,0"`（逗号分隔的选项序号，第 i 个数字 = 第 i 题的选项序号、从 0 起，与 status 渲染的序号一致）时，**则** 命令将序号映射为该题对应选项的 label，构造与桌面端一致的答案对象（key=问题原文、value=选项 label；multiSelect 题取 label 数组）并经 `{behavior:"allow", message: JSON.stringify(答案对象)}` 送达；序号数量与题目数不符、含非数字或越界时以非零退出码报错并提示合法范围；`--answer` 为合法 JSON 对象（key=问题原文）时仍按既有格式解析（向后兼容），仅 JSON 解析失败或非对象内容才走序号解析。

---

### 用户故事：向会话注入消息派单（优先级：P0）

作为在远端主机派单后台任务的用户，我希望 `wave daemon send <sessionId> <消息>` 默认以异步派单方式向指定会话注入一条用户消息并立即返回（发完即退，不等待回复、不输出回复文本），需要同步收尾时再用 `--wait <秒>` 等待该消息对应的回复完成并输出助手最终回复，以便不打开完整 UI 即可驱动后台 agent 继续工作。

**为什么是这个优先级**：这是「继续对话/派单」的核心命令，也是用户「本地电脑关机后从另一台机器驱动 daemon 会话」场景的最终诉求；派单方（如主代理对委托会话转达消息）是 fire-and-forget 心智——消息送达即完成，进度用 `status` 盯——同步等待语义（默认 600 秒超时）反而让每条派单都阻塞到超时才返回，因此默认改为异步派单，`--wait <秒>` 保留显式等待能力（复用已验证的 attach → `sendMessage` → 流式通知 → `loadingChange:false` 收尾流程，非交互式运行便于脚本调用）。

**独立测试**：对一条空闲会话运行 `wave daemon send <sessionId> "继续"`（不带 `--wait`），验证会话收到该消息、命令立即以退出码 0 退出且不输出回复文本；对空闲会话运行 `--wait 5`，验证命令等待该消息对应的回复完成后输出最终回复文本再退出；对正在生成中的会话发送则消息进入队列、`--wait` 模式等待该消息对应的回复完成后退出。

**验收场景**：

1. **假设** 目标会话空闲、用户未传 `--wait`，**当** 用户运行 `wave daemon send <sessionId> "继续"` 时，**则** 命令经 attach 后调用 `sendMessage` 注入消息，注入成功即视为送达并立即返回：stdout 输出派单确认（`Sent message to session: <sessionId>`）、退出码为 0，不等待回复、不输出助手回复文本——send 默认是异步派单（fire-and-forget），后续进度经 `wave daemon status` / `wave daemon list` 查看。
2. **假设** 目标会话正在生成中、用户未传 `--wait`，**当** 用户运行 `wave daemon send <sessionId> "消息"` 时，**则** 消息按现有队列语义入队等待，命令同样在注入成功后立即返回（退出码 0），不等待该消息的回复完成。
3. **假设** 用户传入 `--wait <N>`（N 为秒数）且目标会话空闲，**当** 运行 `wave daemon send <sessionId> "继续" --wait 300` 时，**则** 命令注入消息后持续等待，直到该条消息对应的助手回复完成（订阅 `userMessageAdded` / `assistantMessageAdded` / `loadingChange`，按消息 ID 对应——前一轮次的 stale `loading:false` 不会提前结束等待），stdout 输出该条消息对应的助手最终回复文本（与 `wave -p` 的纯净输出一致，不含子代理内部信息与流式杂讯），退出码为 0。
4. **假设** 用户传入 `--wait <N>` 且目标会话正在生成中，**当** 运行 send 时，**则** 消息入队等待，命令持续等待直到该消息对应的回复完成后输出最终回复（与场景 3 同一套消息 ID 对应逻辑）。
5. **假设** 用户传入 `--wait <N>` 且目标会话挂起等待权限审批，**当** 等待超过 N 秒仍未收到回复时，**则** 命令以非零退出码退出（不无限期挂起），并提示「Session is waiting for permission approval; handle it with `wave daemon respond <sessionId> <requestId>` and retry」。
6. **假设** 用户传入 `--wait <N>` 且 N 秒内既无回复也无挂起审批（如模型卡死），**当** 命令超时时，**则** 以非零退出码退出并提示 `Timed out waiting for a reply (<N>s), no assistant reply received`。
7. **假设** 指定的 sessionId 不存在于该 daemon（无论是否传 `--wait`），**当** 用户运行 `wave daemon send <sessionId> "消息"` 时，**则** 以非零退出码退出并给出明确错误，不注入任何消息。
8. **假设** send 命令完成或失败退出后，**当** 命令结束时，**则** 断开与 daemon 的连接，会话在 daemon 中继续存活、不因客户端退出而终止（与 attach 语义一致；异步派单模式下回复仍在 daemon 中照常生成，可用 `status` 查看）。
9. **假设** 用户传入 `--wait <N>` 且等待期间回复被中断（如另一客户端对该会话运行 `wave daemon abort`，最终 assistant 消息只有 reasoning、无正文），**当** 命令收尾时，**则** 命令明确提示已中断（stderr 输出「Message aborted before producing a reply」）并以非零退出码退出，而不是静默以退出码 0 退出且无输出。

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

### 用户故事：销毁会话（优先级：P0）

作为在远端主机清理后台任务的用户，我希望 `wave daemon destroy <sessionId>` 销毁 daemon 中托管的指定会话（幂等，可加 `--remove-worktree` 连同会话所在 git worktree 一并移除），以便不再需要的后台会话能被及时清理、不占用资源。

**为什么是这个优先级**：补全会话生命周期闭环（create → 使用 → destroy）；协议层 `destroy` 已是幂等的纯注册表操作（按信封 sessionId 直接删除，未知会话静默 no-op），无需 attach，命令是薄封装。与桌面端「删除会话」入口共用同一协议方法。

**独立测试**：创建一条会话后运行 `wave daemon destroy <sessionId>`，验证 `wave daemon list` 不再列出该会话；对不存在的 sessionId 运行 destroy，验证命令仍以退出码 0 成功（幂等 no-op）。对建在 worktree 里的会话运行 `destroy --remove-worktree`，验证 git worktree 与分支被移除后会话被销毁；对普通会话（非 worktree）运行 `--remove-worktree` 会明确拒绝、不误删仓库。

**验收场景**：

1. **假设** 目标会话托管于该 daemon，**当** 用户运行 `wave daemon destroy <sessionId>` 时，**则** 命令经协议 `destroy` 销毁该会话（agent destroy + 从注册表移除），输出确认信息并以退出码 0 结束，随后 `list` 不再显示该会话。
2. **假设** 指定的 sessionId 不存在（会话已销毁、daemon 重启后内存清空或从未存在），**当** 用户运行 `wave daemon destroy <sessionId>` 时，**则** 销毁是幂等 no-op（无 attach、不会创建会话），命令仍输出确认信息并以退出码 0 结束。
3. **假设** destroy 命令完成后，**当** 命令退出时，**则** 断开与 daemon 的连接；其余会话不受影响、继续运行。
4. **假设** 用户运行 `wave daemon destroy <sessionId> --remove-worktree` 且会话**创建时**的 workingDirectory 位于某个 git worktree 内，**当** 命令执行时，**则** 命令先经 `getSessionInfo` 拿会话**创建时**的工作目录（创建后会话内 `cd` 到别处、或 daemon 重启后从 transcript 元数据头恢复，该值都锚定创建目录而非漂移后的 live `workingDirectory`），用 git 反查其 worktree 路径（`rev-parse --show-toplevel`）、分支（`branch --show-current`）与主仓根（`git worktree list` 第一项，repoRoot 语义与 `createWorktree` 返回值一致），随后调协议 `removeWorktree`（params: path/branch/repoRoot，hookBased 按该仓库是否配置 WorktreeCreate hook 判定，与 createWorktree 的返回一致）移除 worktree 与分支，最后销毁会话；stdout 依次输出 `Removed worktree: <path> (branch: <branch>)` 与 `Destroyed session: <sessionId>`，退出码 0。会话内 `cd` 到主仓根等漂移不影响解析——销毁仍落到会话自己的 worktree，不误拒也不误删主仓。
5. **假设** 会话创建时的 workingDirectory 等于主仓根（该会话是普通工作目录、并非链接 worktree），**当** 命令执行时，**则** 命令明确拒绝（报错「Refusing to remove the main working tree」）并以非零退出码退出，不调用 `removeWorktree`、不销毁会话——防止误删整个仓库。
6. **假设** 会话工作目录不在任何 git 仓库内（`rev-parse` 失败），**当** 用户运行 `wave daemon destroy <sessionId> --remove-worktree` 时，**则** 命令报错（「Cannot remove worktree: <路径> is not inside a git repository」）并以非零退出码退出，不调用 `removeWorktree`、不销毁会话。

---

### 用户故事：停止与重启 daemon（优先级：P1）

作为在远端主机管理常驻 daemon 的用户，我希望 `wave daemon stop` 优雅关闭 daemon（不是 pkill 强杀——先让各托管会话正常销毁、转录存盘），`wave daemon restart` 先优雅停掉旧 daemon 再以当前 CLI 拉起新 daemon，以便本地 CLI 升级后能让 daemon 运行新代码，或在不留孤儿进程的前提下回收/重启 daemon。

**为什么是这个优先级**：daemon 常驻后不再自退（见「Daemon 命令组与默认 socket」场景 5），回收只能靠外部手段；此前仓库用 pkill 脚本强杀（`daemon:kill`，已被本命令取代），强杀不会触发会话存盘收尾。daemon 常驻场景下 `stop` 单独使用不多，绝大多数是为了重启（CLI 升级后让 daemon 跑新代码、或进程异常后重置）——因此 `restart`（= stop + 拉起）是主命令，`stop` 是其组成部分也独立可用。实现沿用既有按需拉起链路（`startDaemon` + 等 socket 就绪），无需桌面端 SSH 那套 killRemoteDaemon（那是另一机制，覆盖远端 SSH 场景）。

**独立测试**：对运行中的 daemon 运行 `wave daemon stop`，验证托管会话全部销毁（agent destroy 各自存盘）后进程退出、socket 文件被删除，命令以退出码 0 结束且未自动拉起新 daemon；daemon 未运行时运行 `wave daemon stop` 输出「Daemon is not running」并以退出码 0 结束（幂等 no-op、不自动拉起）；对运行中的 daemon 运行 `wave daemon restart`，验证旧进程优雅退出后新 daemon（当前 CLI 版本）在相同 socket 就绪、命令以退出码 0 结束；daemon 未运行时运行 `wave daemon restart`，验证等价于直接拉起新 daemon。

**验收场景**：

1. **假设** daemon 正在运行（可能托管会话），**当** 用户运行 `wave daemon stop`，**则** 命令连接默认 socket 并发送协议 `shutdown` 请求；daemon 先销毁全部托管会话（每个 agent 正常 destroy：保存转录、排空 auto-memory、清理后台任务/子代理），再关闭 socket 监听、删除 socket 文件并退出进程；命令等待 socket 消失后输出「Daemon stopped」并以退出码 0 结束——优雅关闭而非 pkill 强杀，存盘收尾完整。
2. **假设** daemon 未运行（socket 不存在，含被 kill / 机器重启后），**当** 用户运行 `wave daemon stop`，**则** 命令不得自动拉起 daemon：输出「Daemon is not running」并以退出码 0 结束（幂等 no-op，脚本可直接调用）。
3. **假设** 运行中的 daemon 未能在停止超时（默认 10 秒）内退出（如会话 destroy 卡住），**当** 用户运行 `wave daemon stop`，**则** 命令以非零退出码退出并在 stderr 明确报错（`wave daemon stop failed: ...`），不无限等待。
4. **假设** daemon 正在运行，**当** 用户运行 `wave daemon restart`，**则** 命令先按 stop 语义优雅停止旧 daemon（发送 `shutdown` 并等待 socket 消失），随后以当前 CLI 按需拉起新 daemon 并等待其 socket 就绪，输出「Daemon restarted」并以退出码 0 结束——CLI 升级后重启 daemon 的主场景：新进程运行升级后的新代码，磁盘上的历史会话仍可从转录恢复，断线前正在进行的任务终止（与 daemon 退出的既有语义一致，不得出现幽灵「运行中」状态）。
5. **假设** daemon 未运行，**当** 用户运行 `wave daemon restart`，**则** 停止阶段是幂等 no-op，命令等价于按需直接拉起 daemon：等待 socket 就绪后输出「Daemon started」并以退出码 0 结束；拉起的 daemon 在启动超时（默认 10 秒）内未就绪时命令以非零退出码 + stderr 明确报错退出（与其它命令的按需拉起错误语义一致）。
6. **假设** stop/restart 的优雅停止正作用于一个尚有客户端连接（如桌面端/其它 CLI 命令）的 daemon，**当** shutdown 请求到达，**则** daemon 销毁全部会话后退出，不等待其它客户端断开；daemon 可能不回复 shutdown RPC 本身（销毁会话后即退出、连接随之关闭），客户端以「socket 消失」作为停止完成的判定依据，不得依赖 RPC 响应。

---

### 边界情况

- **daemon 未运行 / socket 不存在（按需即用）**：除 `stop` 外，任一子命令连接失败时自动以 nohup 方式拉起 daemon（`wave --daemon ~/.wave/daemon.sock`，nohup+重定向分离会话）并重试连接——daemon 一经拉起即常驻（空闲不退出），仅在被 stop/restart 优雅关闭、kill / 升级重启 / 机器重启后消失，届时下一次子命令连接失败会再次自动拉起；拉起的 daemon 在启动超时（默认 10 秒）内仍未就绪时，命令才以非零退出码 + stderr 明确提示退出，不得挂起或进入 TUI。`stop` 不自动拉起（未运行即幂等成功退出 0）；`restart` 未运行时等价于直接拉起。
- **默认 socket 固定**：所有 `wave daemon` 子命令一律连接 `~/.wave/daemon.sock`，不提供 `--socket` 覆盖参数；命令只在远端主机上运行，不面向本地转发的 socket。
- **`wave daemon` 与 `wave --daemon` 语义冲突**：前者是客户端子命令组（create/list/status/send/respond/abort/destroy/stop/restart），后者是服务端启动标志（也是客户端连接失败时自动拉起的后台进程）；帮助文本须写明差异，避免误用。
- **stop/restart 是优雅关闭，非强杀**：`stop`/`restart` 经协议 `shutdown` 让 daemon 先销毁全部会话（各自存盘收尾）再退出，取代仓库旧的 `daemon:kill` pkill 脚本；停止完成的判定是「socket 消失」而非 shutdown RPC 响应（daemon 销毁会话后即退出，可能来不及应答）。桌面端 SSH 远端 daemon 的升级重启走另一既有机制（ensureRemoteDaemon / killRemoteDaemon，见 desktop-shell.md「CLI 版本保障」），不受本命令影响。
- **list 仅反映当前进程内存态**：`list` 展示的是当前 daemon 进程内 live 的会话（`initialize`/`restoreSession` 载入且仍存活），不扫磁盘索引；daemon 重启（被 kill / 升级重启 / 机器重启）后内存清空、列表为空是正常现象。磁盘上的历史会话（含普通 `wave` TUI 创建的）不在列表中，但知道 sessionId 仍可经 `status`/`send` attach（`restoreSession` 重新载入），无需依赖 `list` 找回。
- **create 新建 vs attach 恢复**：`initialize` 不带 `restoreSessionId` 时总是新建会话（无 attach 分支，无需存在性检查）；`create` 打印的 sessionId 是后续 `status` / `send` / `respond` / `abort` / `destroy` 的寻址依据。`--permission-mode` 非法值校验先于连接——不会因参数错误拉起 daemon。
- **destroy 是幂等注册表操作**：协议 `destroy` 按信封 sessionId 直接删除注册表项（未知会话静默 no-op），无 attach、不创建会话；与 `abort` 不同，destroy 不检查会话是否存活、也不关心是否生成中，只负责销毁。
- **create --worktree 的 workdir 语义**：worktree 路径是链接 worktree 的顶层（`git rev-parse --show-toplevel` 从该目录的返回），而非主仓根；`--worktree` 与 `--workdir` 同时给出时以 `--worktree` 为准（workdir 仅作为 createWorktree 的源仓库起点）。name 缺省（裸 `--worktree`）时由服务端自动生成随机名。
- **destroy --remove-worktree 的守卫**：repoRoot 语义与 `createWorktree` 返回值一致（主仓根，`git worktree list --porcelain` 第一项），worktree 路径用 `rev-parse --show-toplevel`（从链接 worktree 返回其自身路径）；两者相等即普通工作目录而非链接 worktree——拒绝移除主工作树，防止 removeWorktree 的 fs.rmSync 回退删掉整个仓库。解析的锚点是会话**创建时**的工作目录（`getSessionInfo` 返回记录值而非会话内 `cd` 漂移后的 live 值；daemon 重启（被 kill / 升级重启 / 机器重启）后经 transcript 元数据头恢复会话时同样锚定创建目录），所以会话中途 `cd` 到主仓根等位置不会导致 worktree 被误判为主工作树而拒绝、也不会把解析导向错误目录。hookBased 按该仓库是否配置 WorktreeCreate hook 判定（与 createWorktree 的返回一致），hook 管理的工作树交给 WorktreeRemove hook 清理、wave 不跑 `git worktree remove`。git 反查失败（非 git 仓库）时报错退出，不销毁会话。
- **会话挂起等待审批**：daemon 语义下「等待审批」的会话保持 loading 状态（等同未空闲）；消息中该工具块冻结在 `stage: "running"`（有工具名与参数、无结果字段，结果字段只在 `stage: "end"` 写入），单凭消息无法区分「等审批」与「执行中」，须结合 `listPendingPermissions` 判断；`send` 默认异步派单不进入等待（不存在挂起风险），`--wait <N>` 模式的等待阶段以 N 秒为兜底避免无限挂起，`status` 应如实显示该状态（AskUserQuestion 请求多行完整渲染、其余工具单行摘要，见「查看会话进度与最近消息」场景 4），`respond` 是处理挂起请求的入口。
- **respond 的决策并非单一 allow/deny**：`PermissionDecision` 含 behavior/message/newPermissionMode/newPermissionRule 四个字段；EnterPlanMode 的 allow 必须附带 `newPermissionMode:"plan"`（按工具智能补全），AskUserQuestion 必须用 `--answer` 提供答案（allow 且 message 为答案 JSON），Bash/Edit 可选 `--rule`/`--mode`；命令须与桌面端行为一致，不得把多选项压成裸 allow/deny。`--answer` 支持两种格式：合法 JSON 对象（key=问题原文、value=选项 label，与桌面端提交的答案对象同构，向后兼容）或逗号分隔的选项序号（第 i 个数字 = 第 i 题的选项序号、从 0 起，与 `status` 渲染序号一致；仅 JSON 解析失败或非对象内容才走序号解析）。
- **requestId 幂等与过期**：服务端对未知 requestId 的 `permissionResponse` 静默忽略；respond 应先行校验（如经 `listPendingPermissions`）并在 requestId 已处理时明确提示，避免用户误以为审批已生效。
- **`send` 默认异步派单、`--wait` 模式输出纯净**：不带 `--wait` 时命令注入消息后立即退出码 0，stdout 仅输出派单确认（`Sent message to session: <sessionId>`），不输出助手回复文本；`--wait <N>` 模式输出助手最终回复文本，流式通知与子代理内部信息不得泄漏到 stdout（与打印模式一致），诊断信息走 stderr。
- **`abort` 中断是幂等操作**：在空闲会话上是无害 no-op，命令仍成功返回；对正在生成（含子代理、bash 命令、slash 命令）或挂起审批的会话，中断后回到空闲（与桌面端中断按钮语义一致）。`abort` 不清除已完成的对话历史，只打断进行中的生成并清空消息队列；无需先经 `status` 确认是否正在生成。
- **attach 是短暂访问**：`status` / `send` / `respond` / `abort` 完成即断开连接，不常驻客户端（`create` 为纯注册表操作、`destroy` 按信封 sessionId 无需 attach，仅 `destroy --remove-worktree` 额外调用 `getSessionInfo` 取工作目录）；daemon 与会话的生命周期不受客户端连接影响（attach/detach 语义；daemon 常驻、空闲不退出，会话持续运行至用户销毁、`stop`/`restart` 优雅关闭，或 daemon 被 kill / 升级重启 / 机器重启）。
