---
name: "Daemon 客户端命令"
description: "`wave daemon create/list/status/wait/send/respond/abort/destroy/stop/restart` — 按需创建、查看、阻塞等待空闲、续聊、审批、中断、销毁与优雅停止/重启 daemon 托管的远端后台会话"
order: 270
---

# 功能规格说明：Daemon 客户端命令

**创建日期**：2026-08-12

## 概述

`wave --daemon <socket>` 在远端主机上启动一个 JSON-RPC over unix socket 的 daemon，托管后台 agent 会话（桌面端经 SSH 隧道访问）。目前除了 `--daemon` 启动标志外，没有任何面向用户的 CLI 命令可以查看 daemon 里托管了哪些会话、会话进度如何、或向会话注入消息继续对话——这些能力只存在于 JSON-RPC 协议层，普通用户与脚本无法直接使用。本规格定义 `wave daemon` 子命令组，将已验证的协议流程（创建会话 → attach → 读消息 → 阻塞等待空闲 → 注入消息 → 审批挂起的权限请求 → 中断生成 → 销毁会话 → 优雅停止/重启 daemon 进程）封装为十条命令（`create` / `list` / `status` / `wait` / `send` / `respond` / `abort` / `destroy` / `stop` / `restart`），供用户在远端主机直接执行（或经 `ssh <host> wave daemon ...` 在远端主机上执行）。daemon 一经拉起即常驻（空闲不退出，仅在被 stop/restart 优雅关闭、kill / 升级重启 / 机器重启后消失）——除 `stop` 外，任一子命令连接 socket 失败（daemon 未运行）时自动以 nohup 方式拉起 daemon（`wave --daemon ~/.wave/daemon.sock`）并重试连接，按需即用；`stop` 永不自动拉起，daemon 未运行时幂等成功（restart 未运行时等价于直接拉起）。

## 用户场景与测试 _（必填）_

### 用户故事：Daemon 命令组与默认 socket（优先级：P0）

作为在远端主机上使用 daemon 的用户，我希望通过 `wave daemon` 子命令组（`create` / `list` / `status` / `wait` / `send` / `respond` / `abort` / `destroy` / `stop` / `restart`）访问 daemon，固定连接默认 socket，以便无需了解 JSON-RPC 协议即可创建、查看、阻塞等待空闲、续聊、审批、中断、销毁与优雅停止/重启后台会话。

**为什么是这个优先级**：这是整个命令组的地基——没有统一的命令入口与 socket 寻址规则，create/list/status/wait/send/respond/abort/destroy/stop/restart 无从谈起；daemon 只监听本地 unix socket、不暴露网络端口，且只允许在远端主机上运行，因此客户端命令一律连接默认 socket（`~/.wave/daemon.sock`），不提供 `--socket` 覆盖参数，避免支持本地转发 socket 等非目标用法。daemon 一经拉起即常驻运行（空闲不退出）：除 `stop` 外任一子命令连接失败时自动以 nohup 方式拉起 daemon（`wave --daemon ~/.wave/daemon.sock`，nohup+重定向使启动器立即返回）并重试连接，按需即用——`stop` 不会拉起 daemon（未运行时幂等成功），`restart` 未运行时等价于直接拉起。

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
5. **假设** 会话已有历史消息，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 经 `getMessages` 拉取并显示最近若干条消息的文本（含用户消息与助手回复，默认只显示最后 1 条，可经 `--lines N` 调整），足以判断任务进展；消息正文完整不截断，因此默认输出必须与历史长度无关地有界。
6. **假设** 指定的 sessionId 不存在于该 daemon，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 以非零退出码退出并给出明确错误（Session not found or not hosted by this daemon）。
7. **假设** status 命令完成展示后，**当** 命令退出时，**则** 断开与 daemon 的连接（attach 是短暂查看，不常驻），daemon 与目标会话不受影响、继续运行。
8. **假设** 会话历史很长（含一条数千字符的最终汇报）且其后再无新消息，**当** 用户运行 `wave daemon status <sessionId>` 而不传 `--lines` 时，**则** 只渲染最后 1 条消息（输出 `Recent messages (1)`），不因历史消息多而输出随之膨胀；需要更多上下文时显式传 `--lines N`。
9. **假设** 监控脚本每次轮询只关心状态行，**当** 用户运行 `wave daemon status <sessionId> --lines 0` 时，**则** 输出仅含 session 头与 `Status:` 行（不含 `Recent messages` 段与任何消息正文），退出码 0。`--lines 0` 按「不展示消息」处理，不得因 0 为 falsy 而被当作「未传」或退化为展示全部历史（`slice(-0)` 等价于 `slice(0)`，即全量）。`status` 始终是「取一次快照、立刻返回」的契约；需要阻塞等到状态变化（生成中 → 空闲，或挂起审批）时应改用 `wave daemon wait <sessionId>`（见「阻塞等待会话空闲」故事）——`wait` 是该 shell 轮询用法的正式替代，二者的 `--lines` 语义与 `slice(-0)` 守卫完全一致。
10. **假设** daemon 里同时还有**另一个**会话，其 `loadingChange` 在 `status` attach 期间被广播到本连接，**当** 用户运行 `wave daemon status <sessionId>` 时，**则** 命令只采信**本会话**的推送（按信封上的 sessionId 过滤：订阅早于 `initialize`/`restoreSession` 以接住重放快照，过滤在 `initialize` 返回后绑定到本次 attach 的 sessionId），`Status:` 不得被别的会话的忙闲翻转——`status` 是监控脚本的取值入口，一次假 `generating`/假 `idle` 会被下游当成事实。

---

### 用户故事：阻塞等待会话空闲（优先级：P0）

作为在远端主机等后台会话收尾的用户，我希望 `wave daemon wait <sessionId> [--lines N] [--from-busy] [--timeout <秒>]` 阻塞盯住指定会话，等它空闲（或挂起等待审批）就退出，并在退出时把最终快照（与 `status` 同格式，含最后一条汇报）打到 stdout，以便用一条命令（`msg=$(wave daemon wait <id>)`）替代仓库外自建的 shell 轮询脚本取汇报——单进程、退出码即契约、跨传输（`ssh <host> wave daemon wait ...` 亦可用）。

**为什么是这个优先级**：这是「盯会话」的正式入口。`status` 是「一次性快照、立刻返回」的契约（很多脚本依赖它），不能改成 `status --watch`；而「等到空闲」此前只能由调用方自建 shell 轮询（`while ...; wave daemon status <id> --lines 0; sleep 30; done`），既有轮询延迟、又把等待逻辑散落在每个调用方。`loadingChange` 本就由 daemon 推送（`status` 即靠订阅它判生成中），因此「生成中 → 空闲」可由推送驱动做到零轮询；**只有两类事实施信不了推送**：权限审批（不推送，只能查 `listPendingPermissions`，spec：单凭消息无法区分等审批与执行中）与会话是否仍存活（销毁会话虽会伴随一次 `loadingChange:false` 推送——那是 destroy 内部 abort 的副产物——但 `loading:false` 与「本轮生成结束」完全同形，正是不能采信的那类信号，且只在销毁那一刻发生一次，之后不会再有任何事件），二者共用同一个低频兜底查询 tick（默认 2 秒）——这是「去问没有推送通道的事实」，不是「每 N 秒轮询一次 status」那种状态轮询。会话挂起等待审批时 `loading` 保持 true（等同未空闲），若不单独识别就会永远等下去——因此挂起审批是「立刻返回」的独立终态（退出码 3），而不是继续等待；同理，被另一个客户端 `destroy` 掉的会话既不会空闲也不会等审批：采信那次 `loadingChange:false` 会**误报「已完成」**，不采信则再无事件可等、**永久挂住**——两条都要靠查注册表才能避免。

**推送必须先按 sessionId 过滤**：daemon 把每条会话级通知广播给**所有**已连接客户端，只在信封上标注 `sessionId`，多路分解是客户端的事（一个连接承载多个会话正是 desktop 远端 / vscode / JetBrains 的常态，host 侧早有 `NotificationRouter` 按 sessionId 丢弃未注册会话的通知）。所以 `wait` / `status` 的每个订阅（`loadingChange` / `userMessageAdded` / `assistantMessageAdded`）都必须先过滤再写本地状态，否则**另一个会话本轮结束**（`loadingChange:false`）会把正在等待的会话判成空闲、**另一个会话开始生成**（`loadingChange:true`）会替 `--from-busy` 满足「观察到忙」。过滤后 `loadingChange` 只作唤醒信号，**空闲与否一律读注册表**（与存在性检查同一次查询，判定与那次查询自洽），`--from-busy` 的「忙」同样只认本会话：本会话的 `loadingChange:true`，或注册表里该会话的 `isLoading` 为 true。

**订阅早于 attach、过滤在 attach 后绑定**：订阅必须早于 `initialize`/`restoreSession`（attach 重放的 loading 快照就是 settle 现场），而 `sessionId` 要等 `initialize` 返回才知道，因此过滤在 `initialize` 与 `restoreSession` 之间绑定；绑定前不会有本会话的推送，直接丢弃是正确行为。无 `sessionId` 的通知是全局通知（如 `authUrl`），不属于任何会话，照常放行。

**独立测试**：对一条空闲会话运行 `wave daemon wait <sessionId>`，验证立即以退出码 0 退出且 stdout 为快照；对一条「生成中 → 随后空闲」的会话运行，验证命令在空闲推送到达后才退出、stdout 含最后一条消息；对一条挂起 Bash 审批（及一条挂起 AskUserQuestion）的会话运行，验证立即以退出码 3 退出并打印待审批清单；对不存在的 sessionId 运行，验证退出码 1；对空闲会话加 `--from-busy` 再触发「忙 → 闲」，验证命令不因调用瞬间的 stale 快照提前退出；对一条等待中的会话在另一客户端 `destroy` 后运行，验证命令以退出码 1 退出（既不挂住、也不因随后的 idle 推送误报退出码 0），而对「另一个会话」被销毁的情况验证等待不受影响、照常等到空闲退出 0；对一条正在等待的会话注入**另一条会话**的 `loadingChange:true` 与 `loadingChange:false`，验证命令既不退出、`--from-busy` 也不被满足，直到目标会话自己空闲才以退出码 0 退出且快照与 `status --lines N` 逐字节一致；对**目标会话自己**先推 `false` 再推 `true`（注册表始终为生成中）的情况，验证命令不 settle；对一条正在等待的会话在另一客户端**换键**（`sessionIdChange`，如 `clearMessages`）后运行，验证命令继续盯住同一会话、不报「已不存在」，在换键后的会话空闲时以退出码 0 退出且快照的 `Session:` 行是新 id（`send --wait` 期间换键同理：验证仍能拿到回复、不假报超时）；对一条正在等待的会话在另一客户端 `updateConfig` **就地重建**期间（旧 agent 销毁尚未结束）运行，验证命令不退出、注册表仍列出该会话且 `isLoading` 为 true、写类请求被拒绝而读类请求照常，重建完成后以退出码 0 退出；重建失败时验证该会话不再出现在注册表中且命令以退出码 1 退出。

**验收场景**：

1. **假设** 目标会话在命令调用时已空闲（无挂起审批），**当** 用户运行 `wave daemon wait <sessionId>` 时，**则** 命令立即（不等待、不挂起）以退出码 0 退出，并在 stdout 打印与 `wave daemon status <sessionId> --lines N` 完全一致的最终快照（`Session:` / `Working directory:` / `Status: idle` + `Recent messages`）——「调用时已空闲就立刻返回」优先于消除竞态。
2. **假设** 目标会话正在生成回复，**当** 用户运行 `wave daemon wait <sessionId>` 时，**则** 命令订阅 daemon 推送的 `loadingChange`（订阅早于 `initialize`/`restoreSession`，以接收 attach 时重放的 loading 快照，与 `status` 同一姿势；订阅只认本会话的 sessionId，见「推送必须先按 sessionId 过滤」）并阻塞，直到本会话空闲才以退出码 0 退出；等待期间不得轮询 `status`（生成→空闲这一路必须推送驱动）。推送只作**唤醒**：每次醒来都读一次注册表（与存在性检查同一次查询）拿权威 `isLoading`，「空闲」由它判定而非由单条推送判定，因此同一会话的瞬时抖动（如 abort 清掉 loading 后队列立刻重派下一轮，先 `false` 后 `true`）不会把仍在生成的会话判成空闲。
3. **假设** 目标会话挂起等待权限审批（`loading` 保持 true，消息中该工具块冻结在 `stage: "running"`，单凭消息无法与执行中区分），**当** 用户运行 `wave daemon wait <sessionId>` 时，**则** 命令在低频兜底查询（默认 2 秒一次，不得快于 1 秒，不在本地 socket 上忙轮询）发现待审批请求后立刻返回、不继续等待：打印最终快照（`Status: waiting for approval` + 与 `status` 同构的待审批清单，AskUserQuestion 多行完整渲染、其余工具单行参数摘要）并以退出码 3 退出（用户 `respond` 后可重新 `wait`）。
4. **假设** 目标会话已生成完毕（`loading` 转为 false）且此刻恰有挂起审批，**当** 命令判定「已空闲」时，**则** 命令须先查一次 `listPendingPermissions` 再决定：有待审批则以退出码 3 退出并打印待审批清单，无待审批才以退出码 0 退出——避免 loading 刚转 false 时的竞态把挂起会话误判为已完成（待审批优先于空闲）。
5. **假设** 用户传入 `--from-busy`，**当** 命令调用时会话空闲、随后才出现「忙 → 闲」时，**则** 命令必须先观察到至少一次**本会话的**非空闲（attach 时重放的 loading 快照为 true、等待期间收到本会话的 `loadingChange:true`，或某次注册表查询里本会话的 `isLoading` 为 true）才接受空闲，不得因调用瞬间的 stale `loading:false` 快照提前以退出码 0 退出——用于消除紧跟 `wave daemon send`（异步派单，turn 可能尚未开始）之后立刻 `wait` 的竞态。**其它会话**的 `loadingChange:true` 不算观察到忙：daemon 会把别的会话的推送也广播过来，若采信它，紧跟 `send` 之后的 `wait` 会在目标会话尚未开始生成时就接受「忙已出现 + 现在空闲」而以退出码 0 假报完成。
6. **假设** 用户传入 `--timeout <秒>`，**当** 到点仍未达「空闲」或「挂起审批」时，**则** 命令以退出码 1 退出并在 stderr 给出明确文案（含等待秒数与 sessionId），不无限期挂起；不传 `--timeout` 时默认无限等待。
7. **假设** 指定的 sessionId 不存在于该 daemon，**当** 用户运行 `wave daemon wait <sessionId>` 时，**则** 以退出码 1 退出并给出明确错误（Session not found or not hosted by this daemon），与其它子命令一致（并销毁 `initialize` 静默创建的空会话）；daemon 连不上时同样以退出码 1 退出。
8. **假设** 用户传入 `--lines N`（默认 1，与 `status` 对齐），**当** 命令退出打印最终快照时，**则** 只渲染最近 N 条消息；`--lines 0` 只打印 session 头与 `Status:` 行、不含 `Recent messages` 段与任何消息正文（复用 `status --lines 0` 的语义与 `slice(-0)` 守卫，不重写）。
9. **假设** wait 命令完成（退出码 0 / 1 / 3）后，**当** 命令退出时，**则** 断开与 daemon 的连接（attach 是短暂访问，不常驻），daemon 与目标会话不受影响、继续运行；stdout 只承载最终快照（便于 `msg=$(wave daemon wait <id>)` 直接捕获汇报），过程中的进度提示（如等待中）走 stderr。
10. **假设** 等待期间目标会话被另一个客户端 `wave daemon destroy` 销毁（daemon 进程仍存活、socket 未断；销毁会伴随一次 `loadingChange:false` 推送，但它与「本轮生成结束」同形，不构成「会话已消失」的可信信号），**当** 命令在下一次低频兜底查询中发现该 sessionId 已不在 daemon 的 live 注册表中时，**则** 命令不得继续等待（此前会永久挂住）——以退出码 1 退出并在 stderr 给出明确文案（`Session <sessionId> no longer exists (destroyed while waiting)`）；stdout 不得打印任何快照。**不新增退出码**：「会话已被销毁」本来就属于「sessionId 不存在」这一类，退出码契约仍是 `0` = 空闲 / `1` = 错误（含会话已不存在）/ `3` = 等待审批。判定顺序必须是**存在性 → 挂起审批(3) → 空闲(0) → 超时(1)**，存在性放最前：销毁期间 destroy 内部的 abort 会把该会话的 loading 清掉，于是「注册表里还在」与「这条会话已经空闲」会同时成立，若先判空闲就会为一条正在被销毁的会话**假报成功 0**——谎报完成比挂住更糟。存在性检查与权威 `isLoading` 取自**同一次注册表查询**，判定与那次查询自洽（不会出现「用上一轮读到的忙闲去匹配这一轮的存在性」）。存在性检查与会话审批共用同一个早已存在的 2 秒低频兜底 tick（见「为什么是这个优先级」），`status` 仍是「取一次快照、立刻返回」，`wait` 的生成→空闲这一路仍必须推送驱动。**daemon 侧的配套保证**：`destroy` 先摘掉注册表条目、再 `await` agent 销毁（销毁内部的 abort 推送因此发生在条目已摘除之后），所以整个销毁窗口内该会话对 `status` / `wait` / `send` 等一律按「已不存在」处理，客户端读不到「条目仍在 + 已空闲」这个组合——上面的判定顺序是纵深防御（同样适用于从磁盘重新托管、attach 重放等路径），而不是依赖销毁窗口的时序。
11. **假设** 等待期间被销毁的是**另一个**会话（目标会话仍在 live 注册表中），**当** 命令复查注册表时，**则** 只按「目标 sessionId 是否仍在注册表」判定，其它会话的销毁不影响本次等待：命令继续阻塞，直至目标会话自身空闲（退出码 0）或挂起审批（退出码 3）。
12. **假设** 命令调用时目标会话已空闲且确实存在于 live 注册表，**当** 命令做第一次存在性检查时，**则** 必须照常以退出码 0 立刻退出（存在性检查不得把「正常空闲」误判为「会话不存在」——检查的是 live 注册表里有没有这个 sessionId，与会话忙闲无关）。
13. **假设** daemon 里同时还有**另一个**会话在活动，其 `loadingChange`（先 true 后 false）在等待期间被广播到本连接，**当** 目标会话仍在生成回复时，**则** 命令必须继续阻塞（不得退出、stdout 不得打印任何快照），且这两条推送**不得**替 `--from-busy` 满足「观察到忙」——目标会话自己空闲后（本会话的 `loadingChange:false`，或注册表 `isLoading` 转 false）才以退出码 0 退出，stdout 快照与 `wave daemon status <sessionId> --lines N` 逐字节一致。**不认推送也意味着不能省掉唤醒**：过滤后的推送只用于唤醒，空闲一律读注册表，因此过滤不会让 wait 漏掉目标会话自己的状态变化。
14. **假设** 等待期间目标会话被**换了 sessionId**（同一 daemon 会话换键：会话内 `clearMessages` 铸出新 id、按另一个 id `initializeFromSession`，或 `updateConfig` 重建时无法恢复原转录——daemon 会广播 `sessionIdChange`，信封是旧 id、载荷是新 id，并把注册表条目一并挪到新 id），**当** 命令收到该通知时，**则** 命令必须把跟踪的 sessionId **重绑到新 id**（过滤器与后续所有注册表查询、快照读取都用新 id）继续盯**同一个会话**：换键不是销毁，不得因此以退出码 1 报「Session <旧 id> no longer exists」——此后该会话空闲/挂起审批时照常以 0/3 退出，stdout 快照的 `Session:` 行是新 id。存在性判定仍排在判定序最前，只是查询用的 id 已随换键更新。**以旧 id 发出、在换键之后才被答复的读请求不算证据**：daemon 是先写通知再挪注册表条目，但一个早于换键发出的请求可能到换键之后才被处理，其答复已经描述不了任何东西（会给出「旧 id 不存在」或「Session not found」）——这类答复必须丢弃并改按新 id 重读，否则一条活着的会话又会被误报成「已不存在」。无信封的 `sessionIdChange`（会话创建过程中发出，此时其上下文尚无 id）不参与重绑，attach 回复里的 id 才是权威。**已知边界**：换键若恰好落在 attach 握手中（`initialize` 与随后的 `restoreSession` 之间），attach 本身会以「Session not found」退出 1——那是 attach 语义的既有缺口、对所有子命令一致，不属于本规格覆盖的判定逻辑。
15. **假设** 等待期间目标会话被**就地重建**（另一客户端 `updateConfig`：先销毁旧 agent、再按新配置重建，会话本身没有被销毁），**当** 命令在重建窗口内复查注册表时，**则** 该会话必须仍在注册表中，且**不得**被读成「条目在 + 未生成」（重建期间它的 agent 正在被替换，旧 agent 的 `isLoading` 已随 abort 清掉，与「已空闲」无关）——命令继续阻塞；重建完成后按新 agent 的忙闲照常判定（空闲则退出码 0 并打印快照）。重建**失败**（销毁或重建抛错）时不留下「可达但已坏死」的半死条目：该会话从注册表移除，命令照常以退出码 1 报「`Session <sessionId> no longer exists`」。重建窗口内的读类请求（`getMessages`、`getMcpServers`、`getSlashCommands` 等）仍照常返回，看到的是旧 agent 的同一份转录；**写类请求**（`sendMessage`、`abortMessage`、`setPermissionMode`、`rewindToMessage`、`compact`、`clearMessages` 等）一律拒绝并给出可重试的明确错误（消息发往即将被销毁的 agent 会静默丢失），把另一条会话 restore 进即将被销毁的 agent 同样拒绝。

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

**独立测试**：创建一条会话后运行 `wave daemon destroy <sessionId>`，验证 `wave daemon list` 不再列出该会话；对不存在的 sessionId 运行 destroy，验证命令仍以退出码 0 成功（幂等 no-op）。对建在 worktree 里的会话运行 `destroy --remove-worktree`，验证 git worktree 与分支被移除后会话被销毁；对普通会话（非 worktree）运行 `--remove-worktree` 会明确拒绝、不误删仓库。对一条**销毁收尾尚未结束**（abort 推送已发出、agent 销毁仍在进行）的会话，验证阻塞中的 `wait` 以退出码 1 退出、stdout 无快照，绝不假报退出码 0。

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
- **`wave daemon` 与 `wave --daemon` 语义冲突**：前者是客户端子命令组（create/list/status/wait/send/respond/abort/destroy/stop/restart），后者是服务端启动标志（也是客户端连接失败时自动拉起的后台进程）；帮助文本须写明差异，避免误用。
- **stop/restart 是优雅关闭，非强杀**：`stop`/`restart` 经协议 `shutdown` 让 daemon 先销毁全部会话（各自存盘收尾）再退出，取代仓库旧的 `daemon:kill` pkill 脚本；停止完成的判定是「socket 消失」而非 shutdown RPC 响应（daemon 销毁会话后即退出，可能来不及应答）。桌面端 SSH 远端 daemon 的升级重启走另一既有机制（ensureRemoteDaemon / killRemoteDaemon，见 desktop-shell.md「内置 CLI 一致保障」），不受本命令影响。
- **list 仅反映当前进程内存态**：`list` 展示的是当前 daemon 进程内 live 的会话（`initialize`/`restoreSession` 载入且仍存活），不扫磁盘索引；daemon 重启（被 kill / 升级重启 / 机器重启）后内存清空、列表为空是正常现象。磁盘上的历史会话（含普通 `wave` TUI 创建的）不在列表中，但知道 sessionId 仍可经 `status`/`send` attach（`restoreSession` 重新载入），无需依赖 `list` 找回。
- **create 新建 vs attach 恢复**：`initialize` 不带 `restoreSessionId` 时总是新建会话（无 attach 分支，无需存在性检查）；`create` 打印的 sessionId 是后续 `status` / `send` / `respond` / `abort` / `destroy` 的寻址依据。`--permission-mode` 非法值校验先于连接——不会因参数错误拉起 daemon。
- **destroy 是幂等注册表操作**：协议 `destroy` 按信封 sessionId 直接删除注册表项（未知会话静默 no-op），无 attach、不创建会话；与 `abort` 不同，destroy 不检查会话是否存活、也不关心是否生成中，只负责销毁。摘除注册表条目发生在 `await` agent 销毁**之前**（顺序固定为「先摘条目、再做耗时收尾：转录存盘、子代理/MCP 清理、auto-memory 排空」）：销毁内部的 abort 推送因此只在条目已摘除之后才发出，销毁窗口内该会话对所有客户端一律按「已不存在」处理——被那次推送唤醒的 `wait` 会走「会话已不存在」（退出码 1）而不是把一条正在消失的会话判成空闲。销毁抛错时条目同样已被摘除（错误照常回给调用方），不会留下半销毁条目。
- **create --worktree 的 workdir 语义**：worktree 路径是链接 worktree 的顶层（`git rev-parse --show-toplevel` 从该目录的返回），而非主仓根；`--worktree` 与 `--workdir` 同时给出时以 `--worktree` 为准（workdir 仅作为 createWorktree 的源仓库起点）。name 缺省（裸 `--worktree`）时由服务端自动生成随机名。
- **destroy --remove-worktree 的守卫**：repoRoot 语义与 `createWorktree` 返回值一致（主仓根，`git worktree list --porcelain` 第一项），worktree 路径用 `rev-parse --show-toplevel`（从链接 worktree 返回其自身路径）；两者相等即普通工作目录而非链接 worktree——拒绝移除主工作树，防止 removeWorktree 的 fs.rmSync 回退删掉整个仓库。解析的锚点是会话**创建时**的工作目录（`getSessionInfo` 返回记录值而非会话内 `cd` 漂移后的 live 值；daemon 重启（被 kill / 升级重启 / 机器重启）后经 transcript 元数据头恢复会话时同样锚定创建目录），所以会话中途 `cd` 到主仓根等位置不会导致 worktree 被误判为主工作树而拒绝、也不会把解析导向错误目录。hookBased 按该仓库是否配置 WorktreeCreate hook 判定（与 createWorktree 的返回一致），hook 管理的工作树交给 WorktreeRemove hook 清理、wave 不跑 `git worktree remove`。git 反查失败（非 git 仓库）时报错退出，不销毁会话。
- **会话挂起等待审批**：daemon 语义下「等待审批」的会话保持 loading 状态（等同未空闲）；消息中该工具块冻结在 `stage: "running"`（有工具名与参数、无结果字段，结果字段只在 `stage: "end"` 写入），单凭消息无法区分「等审批」与「执行中」，须结合 `listPendingPermissions` 判断；`send` 默认异步派单不进入等待（不存在挂起风险），`--wait <N>` 模式的等待阶段以 N 秒为兜底避免无限挂起，`status` 应如实显示该状态（AskUserQuestion 请求多行完整渲染、其余工具单行摘要，见「查看会话进度与最近消息」场景 4），`wait` 遇到该状态立刻以退出码 3 返回、不继续等（见「阻塞等待会话空闲」故事），`respond` 是处理挂起请求的入口。
- **respond 的决策并非单一 allow/deny**：`PermissionDecision` 含 behavior/message/newPermissionMode/newPermissionRule 四个字段；EnterPlanMode 的 allow 必须附带 `newPermissionMode:"plan"`（按工具智能补全），AskUserQuestion 必须用 `--answer` 提供答案（allow 且 message 为答案 JSON），Bash/Edit 可选 `--rule`/`--mode`；命令须与桌面端行为一致，不得把多选项压成裸 allow/deny。`--answer` 支持两种格式：合法 JSON 对象（key=问题原文、value=选项 label，与桌面端提交的答案对象同构，向后兼容）或逗号分隔的选项序号（第 i 个数字 = 第 i 题的选项序号、从 0 起，与 `status` 渲染序号一致；仅 JSON 解析失败或非对象内容才走序号解析）。
- **requestId 幂等与过期**：服务端对未知 requestId 的 `permissionResponse` 静默忽略；respond 应先行校验（如经 `listPendingPermissions`）并在 requestId 已处理时明确提示，避免用户误以为审批已生效。
- **`send` 默认异步派单、`--wait` 模式输出纯净**：不带 `--wait` 时命令注入消息后立即退出码 0，stdout 仅输出派单确认（`Sent message to session: <sessionId>`），不输出助手回复文本；`--wait <N>` 模式输出助手最终回复文本，流式通知与子代理内部信息不得泄漏到 stdout（与打印模式一致），诊断信息走 stderr。
- **`abort` 中断是幂等操作**：在空闲会话上是无害 no-op，命令仍成功返回；对正在生成（含子代理、bash 命令、slash 命令）或挂起审批的会话，中断后回到空闲（与桌面端中断按钮语义一致）。`abort` 不清除已完成的对话历史，只打断进行中的生成并清空消息队列；无需先经 `status` 确认是否正在生成。
- **通知是多播、客户端按 sessionId 分路**：daemon 把每条会话级通知广播给**所有**已连接客户端，只在信封上标注 `sessionId`，分路是客户端的职责（一个连接承载多个会话是 desktop 远端 / vscode / JetBrains 的常态，host 侧有 `NotificationRouter` 按 sessionId 丢弃未注册会话的通知）。`status` / `wait` / `send` 的订阅必须先按本次 attach 的 sessionId 过滤再写本地状态（订阅早于 `initialize`/`restoreSession` 以接住重放快照，过滤在 `initialize` 返回后绑定），无 `sessionId` 的全局通知（如 `authUrl`）照常放行；否则别的会话的 `loadingChange` / `userMessageAdded` / `assistantMessageAdded` 会被当成自己的状态。
- **`wait` 的退出码是契约**：`0` = 等到空闲、`3` = 会话挂起等待权限审批（立刻返回、不继续等）、`1` = 错误（daemon 连不上 / sessionId 不存在或等待期间被销毁 / `--timeout` 到点）。stdout 只承载最终快照（与 `status --lines N` 同格式），便于 `msg=$(wave daemon wait <id>)` 直接捕获汇报；进度提示走 stderr。等待由**本会话**的 `loadingChange` 唤醒（订阅早于 attach，订阅先按 sessionId 过滤再写状态），醒来后读注册表拿权威 `isLoading` 判定空闲——推送只作唤醒、不作判定，因此别的会话的推送既不能结束等待也不能替 `--from-busy` 满足「忙」。只有**两类事实施信不了推送**、走低频兜底查询（默认 2 秒、不得快于 1 秒）：权限审批（挂起时 `loading` 保持 true，无法从 loading 变化中识别）与会话是否仍在 live 注册表中（销毁只伴随一次 `loadingChange:false`，与「本轮生成结束」同形，既不能当「已完成」也不能当「已消失」）——这是去问没有推送通道的事实，不是「每 N 秒查一次 status」的状态轮询。三者的判定顺序固定为**存在性 → 挂起审批(3) → 空闲(0) → 超时(1)**：销毁期间 destroy 内部的 abort 会清掉该会话的 loading（注册表读数与那条 `loadingChange:false` 都指向「已空闲」），空闲判定必须让位于存在性，否则会为一条正在被销毁的会话假报退出码 0（详见「阻塞等待会话空闲」场景 10）。`status` 保持「取一次快照、立刻返回」的契约不变，`wait` 是脚本轮询用法的正式替代而非 `status --watch`。
- **换键与就地重建都不是销毁**：会话可以在存活期间**换 sessionId**（`clearMessages` 铸出新 id、按另一个 id `initializeFromSession`、`updateConfig` 重建时无法恢复原转录）。daemon 会广播 `sessionIdChange`（信封 = 旧 id，载荷 = 新 id）并把注册表条目一起挪到新 id，因此 `wait` / `send` 这类**长时间 attach** 的命令必须跟着换键重绑（过滤器 + 后续查询/快照都用新 id），否则会把一条活着的会话判成「已不存在」（`wait` 退出码 1 / `send --wait` 假超时）。同理，`updateConfig` 的**就地重建**期间会话不摘注册表：它被标记为 `transitioning` 并对外报 `isLoading: true`，保证任何读者都读不到「条目在 + 未生成」这个会被误判成空闲的组合；读类请求照常（旧 agent 仍是同一份转录），写类请求与「把别处会话 restore 进来」一律以可重试的明确错误拒绝；重建失败则直接从注册表移除（不留半死条目，走「已不存在」语义）。这两个状态的唯一可观察面就是「会话仍在 + 未空闲」，不新增退出码、不改判定顺序。
- **attach 是短暂访问**：`status` / `wait` / `send` / `respond` / `abort` 完成即断开连接，不常驻客户端（`create` 为纯注册表操作、`destroy` 按信封 sessionId 无需 attach，仅 `destroy --remove-worktree` 额外调用 `getSessionInfo` 取工作目录）；daemon 与会话的生命周期不受客户端连接影响（attach/detach 语义；daemon 常驻、空闲不退出，会话持续运行至用户销毁、`stop`/`restart` 优雅关闭，或 daemon 被 kill / 升级重启 / 机器重启）。`wait` 的阻塞发生在客户端，命令退出（含被 `Ctrl-C` 中断）后会话照常在 daemon 中继续生成。
