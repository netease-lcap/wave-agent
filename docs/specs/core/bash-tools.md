---
name: "Bash 工具"
description: "`Bash` 前台/后台命令执行：超时上限与自动转后台、输出在结束时一次性下发、跨平台 bash/zsh 与 Git Bash 解析、登录 shell 环境注入与会话级 shell 快照、终止时清理整棵进程树、shell 退出后残留进程组的入账与会话销毁时回收"
order: 20
---

# 功能规格说明：Bash 工具

**规格文件**：`docs/specs/core/bash-tools.md`
**创建日期**：2024-12-19

## 用户场景与测试 _(必填)_

### 用户故事：执行前台命令（优先级：P1）

作为 AI 代理，我希望在前台执行 shell 命令，以便执行运行测试、管理 git 或执行构建脚本等任务并立即查看结果。

**优先级原因**：这是代理与系统进行非文件操作交互的主要方式。

**独立测试**：运行简单命令如 `echo "hello"` 并验证输出被返回。

**验收场景**：

1. **假设** 有要执行的命令，**当** 调用 `Bash` 工具时，**则** 它必须返回命令的输出（stdout 和 stderr）。
2. **假设** 前台命令耗时较长，**当** 超过超时时，**则** 它必须被自动转为后台（如果命令允许）或终止（如果不允许，例如 `sleep`），且返回结果必须标记为成功（`success: true`），不得视为错误。
3. **假设** 前台命令超时并被自动转为后台，**则** 代理必须收到一条消息，指示进程仍在后台运行、完成时会收到通知，并包含其任务 ID 和输出路径；消息不得使用 "timed out" 等暗示失败的措辞。
4. **假设** 命令把 shell 的当前目录 `cd` 到工作目录、或用户显式加入的附加目录（配置 `additionalDirectories`、`/add-dir`、会话内批准）之内，**当** 命令结束时，**则** 后续命令必须在该目录执行，并在结果里回告 `Shell working directory changed to <dir>`；PowerShell 会话同形——同一对文案、同一套安全区域判据，见 [powershell-tool.md](./powershell-tool.md)「工作目录追踪」。
5. **假设** `cd` 的目标落在上述目录之外——**包括自动记忆目录这类仅供免权限提示的内部目录**，**当** 命令结束时，**则** 后续命令必须回到会话原工作目录，并在结果里回告 `Shell cwd was reset to <dir>`；内部目录只是权限白名单，不构成 shell 可停留的目录（与 Claude Code 对齐：否则后续相对路径与注入的技能命令都会跑在记忆目录里）。

---

### 用户故事：退出码不是工具成败（优先级：P1）

作为读工具结果的模型，我希望命令一旦跑起来，不论退出码是几都拿到完整结果（输出 + 退出码），以便「`grep` 没匹配」「构建失败」这类正常会发生的答案不会被换成一句「命令失败」、把整份输出丢掉。

**优先级原因**：`success` 只回答「这次调用执行成了吗」，不回答「命令的答案是失败吗」。对齐 Claude Code 2.1.331：非零退出不产生 `is_error`——要标注时工具把 `Exit code <n>` 补进 `data.stdout`、读法进 `data.returnCodeInterpretation`，`is_error` 只由「命令根本没跑起来」与「命令被中断」产生。这同时修掉一处跨层不一致：REPL 里 `tools.Bash` 交的是工具的 `data`，一旦非零退出被判成失败，脚本拿到的就只有 `{ error }`、`r.stdout` 变成 `undefined`（spec core/repl-tool.md「工具调用的值」）。

**独立测试**：`tests/tools/shellExitCode.test.ts` 覆盖家族表、`git` 子命令、家族内 2 起（无解释句）、`&&` 链、管道与引号；`tests/tools/bashTool.test.ts` 覆盖四条端到端用例——`grep` 退 1（`success: true` + `data.returnCodeInterpretation`、正文不含 `Exit code`）、非家族命令退 1（`success: true` + `data.stdout` 末尾 `Exit code 1` + 兜底解释）、命令没跑起来（`success: false` + `error`）、被中断（`success: false` + 原因）。

**验收场景**：

1. **假设** 命令是 `grep` / `egrep` / `fgrep` / `rg` / `find` / `diff` / `test` / `[` 之一（取命令行里**最后一个命令词**，路径按 basename 读），或是 `git diff` / `git grep`，**当** 它以 **1** 退出时，**则** `success` 必须为 `true`、`error` 为空、`data.exitCode` 为 1、`data.returnCodeInterpretation` 给出那句解释（`No matches found` / `Some directories were inaccessible` / `Files differ` / `Condition is false`），正文**不**追加 `Exit code`——家族内 1 是正常作答，解释已在 `data` 里。
2. **假设** 命令以非零码退出但不在「家族内 1」这一格，**当** 工具返回时，**则** `success` 必须为 `true`，`data.exitCode` 是真实退出码，`data.stdout` **末尾**（先去掉尾部空白，照 Claude Code 的 `(stdout || "").trimEnd()`）多一行 `Exit code <n>`；`data.returnCodeInterpretation` 分两档——非家族的任何非零码是兜底句 `Command failed with exit code: <n>`，**家族内 2 及以上没有解释句**（照 Claude Code 的 `fU`：`message` 只在 `n === 1` 时给）。
3. **假设** 命令是 `&&` 链，**当** 判定家族时，**则** **不**豁免——家族只看最后一个命令词（`grep x f && echo ok` 退 1 时链尾是 `echo`，按场景 2 处理；`echo ok && grep x f` 退 1 时链尾是 `grep`，按场景 1 处理）。
4. **假设** 命令是管道，**当** 判定家族时，**则** 只看最后一个命令词（`rg x f | head` 退的是 `head` 的状态）；引号里的 `|` / `&&` 与前置的 `NAME=value` 都算数据。
5. **假设** 命令**根本没跑起来**（`command` 缺失或非字符串、找不到可用 shell、`timeout` 非法、沙箱起不来、后台任务管理器缺失、spawn 报错、权限被拒），**当** 工具返回时，**则** `success` 必须为 `false` 并带 `error`——这是 `success` 为 false 的唯一一类。
6. **假设** 命令被超时终止、或调用方中止了这次执行，**当** 工具收尾时，**则** `success` 必须为 `false` 且 `error` 是那句原因——中断**是**失败（对齐 Claude Code 2.1.331：`mapToolResultToToolResultBlockParam` 的 `is_error` 取自 `interrupted`，正文另追加 `<error>Command was aborted before completion</error>`）；`data` 仍完整交回（`data.interrupted: true` + `data.interruptedReason` + `data.exitCode: 130`），已产出的输出留在正文里。
7. **假设** 一条 shell 调用以非零退出结束，**当** 统计 `wave.commits` / PR-MR 计数时，**则** 不得计入——判据必须是 `data.exitCode === 0`（或没有 `exitCode` 字段），不得读 `success`。

---

### 用户故事：超时取值范围与工具说明（优先级：P1）

作为 AI 代理，我希望工具说明与参数 schema 给出**一致且真实**的 timeout 取值范围，以便给长任务设超时时有一个可信的天花板锚点，而不是凭自己的先验去猜。

**优先级原因**：函数的 `description`（工具说明）与参数 schema 是模型可见的取值范围唯一来源。若两处给出不同上限（曾出现说明写「up to 120000ms / 2 分钟」、而 schema 写 600000），模型就失去可信锚点、退回自身先验（实测高频取 `900000`/15 分钟）。上限值必须在说明与 schema 两处同源。

**独立测试**：读取 Bash 工具定义，验证函数说明与 `timeout` 参数描述给出的上限相同（600000ms / 10 分钟）且默认值单独说明为 120000ms / 2 分钟；以 `timeout: 900000` 调用，验证被接受并按该值执行。

**验收场景**：

1. **假设** 构造 Bash 工具定义，**当** 渲染函数说明与 `timeout` 参数描述时，**则** 两者给出的上限必须是同一个值（600000ms / 10 分钟），且默认值必须单独说明为 120000ms / 2 分钟——不得用默认值充当上限。
2. **假设** `timeout` 为 0 到 600000 之间的整数，**当** 调用 `Bash` 时，**则** 必须按该值执行，不得被拒绝或改写。
3. **假设** `timeout` 大于 600000，**当** 调用 `Bash` 时，**则** 必须按给定值执行，不得被拒绝、截断或改写（与 Claude Code 对齐：schema 与运行时均不设上限校验）。
4. **假设** `timeout` 为非数字或负数，**当** 调用 `Bash` 时，**则** 必须返回错误（类型校验与 Claude Code 由 `z.number()` 承担的行为对齐），且错误消息不得再声称上限为 600000——越界值已被接受。

---

### 用户故事：后台进程管理（优先级：P2）

作为 AI 代理，我希望在后台运行长时间运行的命令并在稍后获取其输出，以便在命令执行期间继续处理其他任务。

**优先级原因**：对于启动开发服务器或运行长时间测试套件而不阻塞代理等任务至关重要。

**独立测试**：使用 `sleep 5 && echo "done"` 启动后台进程，5 秒后使用 `Read` 工具检查其输出。

**验收场景**：

1. **假设** `run_in_background` 为 true，**当** 调用 `Bash` 时，**则** 它必须立即返回 `bash_id` 和指向实时日志文件的 `outputPath`。
2. **假设** `run_in_background` 为 true，**则** 命令必须在没有任何超时的情况下运行——它持续运行直到完成或手动停止。
3. **假设** 有运行中的后台进程，**当** 使用其 ID 调用 `TaskStop`（原 `KillBash`）时，**则** 进程必须被终止。
4. **假设** 后台进程已启动，**当** 我使用 `Read` 工具读取提供的 `outputPath` 文件时，**则** 我应该看到进程的实时输出。

---

### 用户故事：终止命令清理整棵进程树（优先级：P1）

作为用户，我希望中止 Bash 命令、停止后台任务或结束 subagent 会话时，命令派生出的**整棵进程树**（如 `npm → node → vitest worker ×N`）都被清理，以便不留下无人收尸的孤儿进程继续吃内存。

**优先级原因**：只杀直接子进程（`bash.exe`）时，孙进程会继续跑到自己结束——实测一次残留 4 个 vitest worker 约 2 分钟、峰值约 1.2 GB，多 agent 并行时把 16 GB 机器压到只剩 2 GB，而这些进程还在读写已关闭会话的 worktree，排查时容易被误认为新的一次运行（issue #2742）。

**独立测试**：启动一条会派生出多层的命令（`node -e` 中再 spawn 两个长 sleep 子进程），记录孙进程 pid；中止命令 2 秒后查询这些 pid —— 必须全部不存在。在 Windows 上对照验证：只调 `child.kill()` 时孙进程仍存活。另在一个 subagent 内派发一条后台任务，让该 subagent 正常结束与失败结束各一次，验证其后台任务在 subagent 释放时即被停止（而不是等到整个会话结束）。

**验收场景**：

1. **假设** 前台命令正在运行且已派生出孙进程，**当** 命令被中止（用户 stop、会话结束、不可自动转后台的超时终止）时，**则** 必须终止整棵进程树（shell 及其全部后代），不得只杀掉 shell 而留下孙进程。
2. **假设** 运行在 POSIX（macOS/Linux），**当** 终止时，**则** 必须以子进程所在的进程组为终止单位（`process.kill(-pid, sig)`；子进程以 `detached: true` 启动，自有进程组），并保持「先 SIGTERM、1 秒后 SIGKILL」的两段式。
3. **假设** 运行在 Windows，**当** 终止时，**则** 必须使用 `taskkill /PID <pid> /T /F` 终止整棵树；因为控制台进程没有窗口消息循环，不带 `/F` 的「温和终止」只会投递 `WM_CLOSE`（`bash.exe` 不响应），所以 Windows 上 SIGTERM 与 SIGKILL 两段退化为同一次强杀，第二次调用报「已不存在」。
4. **假设** 后台任务（`run_in_background` 启动、手动转后台、超时自动转后台、subagent 的后台任务）被 `TaskStop` 停止或随会话结束被清理，**则** 同样必须终止整棵进程树，与前台中止共用同一实现。
5. **假设** 一个 subagent（含 fork）在派生出后台任务后结束——正常完成、失败、被 abort 或实例被释放，**当** 该 subagent 的实例被清理时，**则** 必须同时停止它自己派生的全部后台任务（每个 subagent 持有隔离的 `BackgroundTaskManager`，会话级清理只在整个会话结束时才跑，因此必须以「实例释放」为触发点），不得让这些后台进程活到会话结束才被收尸（issue #2742，「agent 已结束、后台任务继续跑」）。
6. **假设** 目标进程（组）在终止时已不存在，**当** 终止发生时，**则** 不算错误（调用方不得因此报错或中断），但必须留下 debug 级日志；Windows 以 `taskkill` 退出码 128 表示「找不到进程」，不得像旧的 `ESRCH` 分支那样静默吞掉。
7. **假设** 终止本身失败（权限不足、`taskkill` 无法启动、非 128 的非零退出码），**当** 终止发生时，**则** 必须以 error 级日志记录进程标识与命令输出（`taskkill` 是唯一不经 shell provider 的 spawn，没人给它设代码页：中文在日志里是 `\uFFFD`，pid 与退出码这类 ASCII 信息照旧可读；日志是它唯一的去处，不为它单启一个进程去设代码页），并退回「只杀直接子进程」的兜底，不得抛给调用方。

---

### 用户故事：shell 退出后留下的进程组随会话销毁回收（优先级：P1）

作为用户，我希望模型用 `&` / `nohup` 把服务放到后台、外层 shell 正常退出之后，这个进程组**在会话内继续活着**，而**会话销毁时被收掉**，以便既不误杀合法的后台服务，又不留下一个 `ppid=1`、cwd 指向已删除 worktree、能活好几天的孤儿进程。

**优先级原因**：实测到 2026-11-13 起的一个 `node dist/server.js` 活到 11-23 才被手工 `kill -TERM`——它由 `... 2>&1 &` 起、外层 shell 六秒后正常退出。`bashTool` 的 `exit` 回调只做结果收尾，`Agent.destroy()` 手上只有「还在运行的任务」与「在飞工具」，这条命令早已 `completed`，于是没有任何一方还持有它的 pid。反过来「退出即杀」也不成立：`nohup` 起服务是本工具的正当用法，当场杀掉等于让 `npm run dev` 这类命令无法工作。所以形态是**退出时只探测入账、销毁时才终止**（与 Claude Code 同形：它的 shell 句柄默认留在 `liveShellCommands` 账本里，只有显式 `detach()` 才交出去；「shell 已退出但组里还有人」以 `leftRunningPgid` 交回账本）。

**独立测试**：`tests/integration/shellProcessReaper.test.ts`——前台执行 `nohup sleep 999 &` 后进程仍存活、账本恰有一条记录；真实 `Agent.destroy()` 后该进程组不再有成员；`echo hi` 这类组内无人的命令不留下账本条目。

**验收场景**：

1. **假设** 前台 Bash 命令以 `nohup <cmd> &` / `<cmd> &` 把进程放进后台，**当** 外层 shell 正常退出、工具返回结果时，**则** 该进程必须继续存活，不得被当场杀掉；同时它所在的进程组必须被登记进本会话的「残留进程组账本」（含 `pgid`、归属的工具调用 id、Linux 上的 starttime 令牌）。
2. **假设** 账本里已有条目，**当** 该会话被销毁（`Agent.destroy()`，含 daemon 的 `--remove-worktree` 路径）时，**则** 必须对该进程组发 `SIGTERM`、短 grace 后补 `SIGKILL`；销毁流程返回后该进程组不得还有成员存活。
3. **假设** 一条前台命令结束时它所在的进程组已经空了（普通 `echo` / `ls`），**当** 命令结束时，**则** 账本不得新增条目（不留空壳条目）。
4. **假设** `run_in_background` 启动的任务仍在运行，**当** 会话销毁时，**则** 仍按既有路径（停止仍在运行的后台任务）终止它，不得因为新增的账本而改变这条既有行为。
5. **假设** 账本条目对应的进程组在销毁前已经全部退出，**当** 回收发生时，**则** 不得视为错误，只记 debug 日志。
6. **假设** 命令用 `setsid` 把自己放进新的会话与进程组，**当** 外层 shell 退出时，**则** 该进程不在原进程组内，**不得**被登记、也不会被回收——这是明确接受的边界（`setsid` 主动脱离，任何按进程组记账的方案都看不到它；Claude Code 同样如此）。
7. **假设** 运行在 Windows，**当** shell 退出时，**则** 不得做这项探测、也不登记任何条目：Windows 没有进程组语义，shell 退出后那个 pid 已不能用于 `taskkill /T` 走子树（与 Claude Code 一致——它的退出清扫在 Windows 上直接返回）。
8. **假设** 回收前的身份校验（Linux 读 `/proc/<pid>/stat` 第 22 字段 starttime）与登记时不一致，**当** 回收发生时，**则** 不得向该进程组发信号（防 pid 复用误杀），并记 debug 日志。非 Linux 的 POSIX 没有这个字段，退化到「进程组是否还存在」。
9. **假设** 宿主进程自己退出（`process.on("exit")`），**当** 退出钩子运行时，**则** 必须对账本里通过身份校验的进程组同步发一次 `SIGTERM`（尽力而为）：退出钩子里没有事件循环，不做忙等、不发任何异步动作，也不因此宣称回收已完成——真正的回收仍是会话销毁那条路。

---

### 用户故事：后台状态结构化返回（优先级：P2）

作为 AI 代理，我希望 Bash 工具的结果包含结构化的后台状态字段，以便精确区分"用户手动转后台"、"超时自动转后台"和"显式后台启动"三种场景，而无需解析文本。

**优先级原因**：当前超时转后台的返回文本含 "timed out"，容易被模型误解为命令失败；结构化字段（与 Claude Code 输出 schema 对齐：`backgroundTaskId`、`backgroundedByUser`、`assistantAutoBackgrounded`）让模型与 UI 可机器可读地判断后台状态。

**独立测试**：运行 `sleep 60`（timeout 设为 2000ms），验证返回结果包含 `assistantAutoBackgrounded: true` 与 `backgroundTaskId`，且文本与 Claude Code 对齐（不含 "timed out"）。

**验收场景**：

1. **假设** 命令超时被自动转为后台，**当** Bash 工具返回结果时，**则** 结果必须包含 `backgroundTaskId` 与 `assistantAutoBackgrounded: true`，且 `success: true`。
2. **假设** 用户通过 Ctrl+B 手动将命令转为后台，**当** Bash 工具返回结果时，**则** 结果必须包含 `backgroundTaskId` 与 `backgroundedByUser: true`。
3. **假设** 命令通过 `run_in_background: true` 显式启动，**当** Bash 工具返回结果时，**则** 结果必须包含 `backgroundTaskId`，且 `backgroundedByUser` 与 `assistantAutoBackgrounded` 为 false 或省略。
4. **假设** 命令超时被自动转为后台，**当** 返回结果时，**则** 文本内容必须为（与 Claude Code 对齐，其中 X 为任务 ID、Y 为输出路径）：`Command exceeded the timeout (Xs) and was moved to the background with ID: X. It is still running — you will be notified when it completes. Output is being written to: Y`。
5. **假设** 命令通过 Ctrl+B 手动转为后台，**当** 返回结果时，**则** 文本内容必须为（与 Claude Code 同义：明说「仍在跑、会收到完成通知、别再起一次」，因为本轮不会因此结束）：`Command was manually backgrounded by user with ID: X. It is still running — you will be notified when it completes. Do not start it again. Output is being written to: Y`。
6. **假设** 命令通过 `run_in_background: true` 启动，**当** 返回结果时，**则** 文本内容必须为：`Command running in background with ID: X. Output is being written to: Y`。
7. **假设** 命令以任何方式转到后台（超时自动转、用户手动转），**则** 该结果都不得中断代理当前运行循环——转后台只改变「谁在等这条命令」（变成后台任务 + 完成通知），本轮照常推进到下一次模型调用；与 Claude Code 一致，它的 `backgroundedByUser` 只落在结果字段、回执文案与遥测上，从不参与「本轮是否继续」的判定。

---

### 用户故事：输出在命令结束时一次性下发（优先级：P2）

作为等待命令结果的用户，我希望前台命令运行期间只看到命令行和运行状态，输出在结束时一次性出现。

**优先级原因**：实际使用中命令几乎都以 `tail -n`、`| head`、重定向收尾，管道会把输出缓冲到结束才吐，运行期间本来就看不出滚动，实时下发换不到任何观感；而长输出命令每来一段就下发一次增量通知，是持续的序列化与中继带宽开销（远控页的每条回包都要走中继，见 [远程控制](../remote/remote-control.md)）。

**独立测试**：运行 `for i in {1..5}; do echo $i; sleep 1; done`，运行期间界面上只有命令行与运行状态、没有可滚动的输出区；命令结束后完整输出一次性出现。

**验收场景**：

1. **假设** AI 调用的 `Bash` 命令正在运行，**则** 运行期不下发 `result` / `shortResult`，增量通知里不携带运行中的输出内容。
2. **假设** AI 调用的 `Bash` 命令结束，**则** 完整输出随最终结果一次性下发并渲染。
3. **假设** 用户自己敲的 bash 模式命令（`!cmd`），**则** 同样只在结束时一次性写入输出（见 [bash 模式](../ui/bash-mode.md)），不因入口不同而留一条实时通道。

---

### 用户故事：Windows 平台 Git Bash 支持（优先级：P2）

作为 Windows 用户，我希望 Bash 工具能自动使用 Git Bash 执行命令，以便所有 POSIX 语法（如 `pwd`、`&&`、管道等）在 Windows 上正常工作。

**优先级原因**：当前 `spawn(cmd, { shell: true })` 在 Windows 上使用 `cmd.exe`，导致 POSIX 语法失败。这是 Windows 用户的基本可用性需求。

**独立测试**：在 Windows 系统上安装 Git Bash，运行 `echo "hello"` 验证输出正常；运行 `pwd` 验证 POSIX 命令可用。

**验收场景**：

1. **假设** 运行在 Windows 系统上，**当** Git Bash 已安装时，**则** Bash 工具必须使用 Git Bash 而非 cmd.exe 执行命令。
2. **假设** 运行在 Windows 系统上，**当** Git Bash 未安装时，**则** `Bash` 工具不得注册，命令改由 `PowerShell` 工具执行——无 Git Bash 时 PowerShell 工具默认开启（三态门控见 [powershell-tool.md](./powershell-tool.md)「三态 shell 门控」）；只有当 PowerShell 工具被显式关闭（`WAVE_USE_POWERSHELL_TOOL=0`）、或机器上找不到 `pwsh` / `powershell` 时，才由执行点返回「装什么」的清晰错误，任何情况下都不得静默降级到 cmd.exe。
3. **假设** 运行在 Windows 系统上，**当** 执行包含 POSIX 语法的命令（如 `pwd -P >| file`）时，**则** 命令必须正常执行并返回正确结果。
4. **假设** 运行在 Windows 系统上，**当** 命令执行后检测 CWD 时，**则** CWD 追踪机制必须正常工作——临时文件路径需转换为正斜杠格式以兼容 Git Bash，且临时文件在命令结束后必须被清理，不得残留在项目目录中。
5. **假设** Git 安装在非标准路径但 `git` 在 PATH 中，**当** 调用 Bash 工具时，**则** 系统必须通过从 `git` 可执行文件位置反推（`<git 目录>/../../bin/bash.exe`）定位 Git Bash，而非仅依赖常见安装路径。
6. **假设** 设置了 `WAVE_GIT_BASH_PATH` 环境变量指向 bash.exe，**当** 调用 Bash 工具时，**则** 必须优先使用该路径。
7. **假设** 运行在 Windows 系统上，**当** Git Bash 的 `pwd -P` 输出 POSIX 路径（如 `/c/Users/...`、`/cygdrive/c/...`）且命令结束后读取 CWD 追踪结果时，**则** 必须先将该 POSIX 路径转换为原生 Windows 路径（`C:\Users\...`）再校验存在性并回调 `onCwdChange`，不得将 `/c/...` 直接当作 Windows 路径校验（否则会解析为 `C:\c\...` 导致每次命令都 ENOENT）。
8. **假设** 命令结束后 CWD 追踪失败（如目标目录在命令执行期间被删除），**当** 返回命令结果时，**则** 该失败不得影响命令成功结果，也不得产生 WARN 日志（CWD 追踪为尽力而为，仅记录 debug 级日志）。

---

### 用户故事：跨平台显式 shell 解析（优先级：P1）

作为 AI 代理，我希望 Bash 工具在所有平台上都显式使用 bash 或 zsh 执行命令（而非系统默认 `/bin/sh`），以便 bash 特有语法（进程替换 `<()`、`[[ ]]`、数组等）在 macOS、Linux 上正常工作。

**优先级原因**：`/bin/sh` 在 Debian/Ubuntu 是 dash，不兼容 bashism；即使 macOS 上 `/bin/sh` 是 bash，也会以 POSIX 模式运行，导致 `eval '<()...'` 多行命令解析失败（报 `syntax error near unexpected token '('`）。这是命令执行的基本正确性需求。

**独立测试**：在 macOS/Linux 上运行 `comm -23 <(echo a) <(echo b)`，验证进程替换正常工作，无 syntax error。

**验收场景**：

1. **假设** 运行在 macOS/Linux，**当** 执行含进程替换的命令（如 `comm -23 <(echo a) <(echo b)`）时，**则** 命令必须正常执行，不得报 syntax error。
2. **假设** 设置了 `WAVE_SHELL` 环境变量指向可执行的 bash/zsh，**当** 调用 Bash 工具时，**则** 必须使用该 shell 执行命令。
3. **假设** 系统未安装 bash 和 zsh，**当** 调用 Bash 工具时，**则** 必须返回清晰错误消息而非静默回退到 `/bin/sh`。
4. **假设** `$SHELL` 指向 zsh，**当** 调用 Bash 工具时，**则** 必须优先使用 zsh。

---

### 用户故事：登录 shell 环境注入（优先级：P1）

作为 AI 代理，我希望 Bash 工具、后台任务、bash 模式命令（`!`）、MCP server、hooks、LSP server 与 git 调用都能拿到用户登录 shell 的环境——PATH 以及 shell 配置里 export 的变量（API key、企业代理、自签证书、`SSH_AUTH_SOCK`）——同时让 shell 命令用到用户配置里的 alias、函数与选项，且不逐条重跑 profile。

**优先级原因**：GUI 启动的宿主（Finder/Dock 启动的桌面端、VS Code 扩展与 JetBrains 插件）进程环境不完整：PATH 缺 nvm/Homebrew，shell 配置里除 PATH 之外的 export 全部丢失——表现为 MCP server 找不到 `npx`/`uvx`、`git push` 因缺 `SSH_AUTH_SOCK` 失败、企业代理与自签证书不生效。若在 SDK 层每条命令都用 `-c -l` 加载 profile，则每条命令都付一次 shell 启动与配置执行代价，还会把用户 rc 的输出混进命令结果。因此分两处收：宿主启动时一次性探测、把白名单变量写入进程环境，不经 shell 的子进程（MCP server、hooks、LSP、git）都靠它；shell 命令侧改用**会话级快照**——每个 shell provider 首次执行前用登录 shell 跑一次，把 alias、函数与选项落成一个文件，之后每条命令只 `source` 该文件，不再逐条 `-c -l`（对齐 Claude Code 的 shell snapshot）。

**独立测试**：用假 HOME 造 `~/.bashrc`（export 一个 marker 变量与一个 PATH 目录、定义一个 alias 与一个函数），断言：(a) 宿主探测后 marker 按白名单写入进程环境，(b) 不在白名单里的变量不被采纳，(c) `PATH` 按「探测值在前 + 继承值在后 + 去重」合并，(d) 会话内首条命令用 `<shell> -l -c` 生成快照、后续命令只 `source` 快照且不带 `-l`，(e) 命令能调用 rc 里的 alias 与函数，(f) rc 抛错或生成超时时命令仍正常执行、结果里不出现 rc 的输出。

**验收场景**：

1. **假设** 宿主（桌面端、VS Code 扩展、JetBrains 插件）启动，**当** 开始探测用户登录 shell 环境时，**则** 探测必须**异步**进行：桌面端窗口与首屏、VS Code 激活后的可用性、JB 的工具窗口都不得等待探测完成，探测不得写在模块加载/激活的同步路径上（现状桌面端在主进程模块顶层同步 `execFileSync`，最坏会阻塞启动 5 秒）。
2. **假设** 探测在 macOS/Linux 上执行，**当** 读取登录 shell 环境时，**则** 必须取**完整环境**而非只取 PATH：`<shell> -l -i -c 'echo "<起始标记>"; env -0 && echo "<结束标记>" || env'` 形式，优先按 NUL 分割解析，`env -0` 不可用时退化为按行解析并记录退化标记。
3. **假设** 需要选定用于探测的 shell，**当** 决定用哪个 shell 时，**则** 顺序必须是：`$SHELL`（绝对路径且可执行）→ `/bin/zsh`（存在且 `~/.zshrc` 存在）→ `/bin/bash`（存在且 `~/.bashrc` 存在）→ 第一个存在的 `/bin/zsh`/`/bin/bash`/`/bin/sh`；不得硬编码某一种 shell（否则 Linux 上只装 bash 的用户探测必失败）。
4. **假设** 探测成功，**当** 把结果写入宿主进程环境时，**则** 必须「白名单 + 不覆盖」：只写入白名单内的键，且只在该键当前未设置时写入（宿主或用户显式配置优先）。白名单至少覆盖 `PATH`、`SSH_AUTH_SOCK`、`WAVE_SHELL`、`WAVE_GIT_BASH_PATH`、代理类（`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` 及大写形式）、证书信任类（`NODE_EXTRA_CA_CERTS`、`SSL_CERT_FILE`、`SSL_CERT_DIR`、`REQUESTS_CA_BUNDLE`、`CURL_CA_BUNDLE`、`GIT_SSL_CAINFO`）；**不得**把用户 shell 配置里的全部变量灌进宿主进程（`NODE_OPTIONS`、`LD_PRELOAD`、`DYLD_*`、`GIT_*` 会改变 Electron / 扩展宿主自身的行为）。唯一例外是 `PATH`：宿主进程几乎必然已继承一个不完整的 `PATH`，严格「已设置即跳过」会让登录 PATH 永远进不来，因此 `PATH` 必须合并——探测值在前、继承值在后、按分隔符去重（Windows 上键名大小写不敏感，更新已存在的那个键而不是新增一个）。
5. **假设** 启动用于探测的 shell 子进程，**当** 构造它自身的环境时，**则** 必须是最小环境（`HOME`/`PATH`/`SHELL`/`USER`/`SSH_AUTH_SOCK` 加 locale 与 display 类变量），并附加防噪变量 `DISABLE_AUTO_UPDATE=true`、`ZSH_DISABLE_COMPFIX=true`、`SSH_ASKPASS_REQUIRE=never`、`DBUS_SESSION_BUS_ADDRESS=disabled:`，避免登录 shell 的自动更新、补全自检、askpass 弹窗拖慢或阻塞探测。
6. **假设** 解析探测输出，**当** 生成最终变量集合时，**则** 必须丢弃 `PWD`、`OLDPWD`、`SHLVL`、`_` 与本故事场景 5 的防噪变量；退化为按行解析时还必须丢弃值可能含换行的键，避免跨行污染。
7. **假设** 探测失败（超时、shell 缺失、输出不可解析、Git Bash 未安装等），**当** 继续运行宿主时，**则** 必须先按上限重试（带指数退避），仍失败则降级为「只采纳 PATH」或维持继承环境，并记录一次诊断日志；任何失败都不得阻塞宿主启动、不得弹错误、不得让会话不可用。预算口径三个宿主统一：单次探测超时 4 秒、最多 2 次尝试、退避 200ms 起（最坏约 8.4 秒），宿主等待探测落地的上界与之一致——再紧会把慢配置（冷网络挂载上的 nvm）误杀，再松会让挂住的 profile 明显拖慢首个会话。
8. **假设** 环境已注入，**当** Bash 工具、后台任务、`!` 命令、MCP server、hooks、LSP server 或 git 调用启动子进程时，**则** 它们都必须能解析到登录 shell 里的工具与变量——这些路径只继承进程环境（不经 shell），因此注入必须发生在宿主进程层，而不是某一条工具执行路径里。
9. **假设** 任一 shell provider 在会话内首次执行命令，**当** 执行前，**则** 必须生成一次 shell 快照：定位用户 rc（zsh `~/.zshrc`、bash `~/.bashrc`），用 `<shell> -l -c <生成脚本>` 显式 source 它并 dump `alias`、函数与 shell 选项（zsh `setopt`、bash `shopt`），写入临时目录下的单文件；生成阶段的输出（rc 的 echo、警告）必须全部丢弃，不得出现在任何命令结果里；生成有超时上限，超时按失败处理。
10. **假设** 运行在 Windows 上，**当** 探测环境时，**则** 沿用 Git Bash `-lic 'cygpath -pw "$PATH"'` 只采纳 PATH 并转回 Windows 原生形式；本期不要求 Windows 全量采纳环境变量（Git Bash 的变量语义与 Windows 原生进程不一致）。
11. **假设** 快照可用，**当** 执行任意命令时，**则** 命令串必须是「控制台代码页（仅 Windows，见「输出编码由源头决定」故事）→ `source <快照> 2>/dev/null || true` → 搜索影子注入 → `eval '<命令>'` → 写回 CWD」，spawn 参数里**不带 `-l`**；快照不可用（生成失败、超时、文件已被删除）时回落为纯 `-c` 的现状行为，命令照常执行、不报错、不重试。
12. **假设** 用户 rc 里定义了与搜索影子同名的 alias（如 `alias grep=...`），**当** 执行搜索命令时，**则** 快照的 source 必须在影子注入之前，工具自带的 `grep`/`find`/`rg` 影子优先——`.gitignore` 口径与退出码不受用户 alias 影响。
13. **假设** 用户在 zsh 下使用未加引号的通配符参数（如 `grep -r x . --include=*.ts`），**当** 快照生效时，**则** glob 语义必须仍由用户 shell 决定：zsh 的 `NOMATCH` 依旧生效（该命令报 `no matches found`），工具不得为它改写选项或吞掉错误——这与 Claude Code 一致，属用户 shell 行为，不是快照要修的缺陷。

---

### 用户故事：输出编码由源头决定（优先级：P1）

作为中文 Windows 用户，我希望命令输出里的本地化文本不要变成乱码，也不要在「猜对了大部分、猜错了某一段」之间摇摆，以便读到的信息是命令真的说了什么。

**优先级原因**：Windows 的每个控制台有自己的输出代码页，中文系统默认 936（GBK）。管道上的字节于是取决于写它的程序用什么代码页，而 wave 原本的做法是**收到字节后再猜**（先严格 UTF-8、失败则整条流改判 GBK，issue #1753）：这个判据在「流的头被截断」时必然猜错——`tail -c` 截在一个多字节字符中间时，首字节是续字节，整条 UTF-8 流被判成 GBK，整段中文变乱码（本机真实遇到）。Claude Code 从不猜：它固定按 UTF-8 收流，并在命令前把控制台代码页设成 65001（`chcp.com 65001 >nul`），让字节在源头就是 UTF-8（它拼的是 `%SYSTEMROOT%\System32\chcp.com` 的绝对路径，不是裸名走 PATH）。本仓库 2026-11-26 起改为同一形态，并删掉自创的 GBK 兜底。

**独立测试**：在真 Git Bash 下跑 (a) 输出本地化报错的原生程序（`taskkill //F //PID 999999`），核对结果里没有 `\uFFFD`；(b) 一条首字节是续字节的 UTF-8 流（`printf` 出被截断的字节），核对只有开头 1 个 `\uFFFD`、其余与原文逐字相同；(c) 70 KB 中文输出（必然跨过一次 64 KiB 读边界），核对 0 个 `\uFFFD` 且字符数与字节数严格对应——这份输出早已超过 30,000 字节预算，全文从落盘的持久化文件读回核对，工具返回的预览另判「字节数不超预算」（均在 `tests/integration/bashTool-real-spawn.test.ts`）。

**验收场景**：

1. **假设** 运行在 Windows，**当** 构造 spawn 的命令串时，**则** 必须以「切换代码页语句 + `; `」开头，且位置在 `eval '<命令>'` 包装**之前**——命令自身的字节保持原样，切换也进不了命令的退出码；输出丢弃是因为 `chcp.com` 会打印「Active code page: 65001」，分隔用 `;` 而不是 `&&` 是为了找不到 `chcp.com` 时命令照跑（`packages/agent-sdk/src/utils/shell/bashProvider.ts` 的 `withConsoleCodePage`）。POSIX 没有代码页，不加任何前缀。
2. **假设** 运行在 Windows，**当** 拼切换代码页的那句时，**则** `chcp.com` 必须是**解析出来的绝对路径**（`%SYSTEMROOT%` → `C:/Windows/System32/chcp.com`，正斜杠），不得裸名走 PATH：与 Claude Code 同一形态（它把 `join(SYSTEMROOT,'System32','chcp.com')` 拼进 cmd 启动串），目的是不让 PATH 上排在 System32 之前的同名可执行文件劫持这一步。该路径必须只含安全字符（盘符加冒号，其后不得出现 `"`、`%`、`!`、`^`、`&`、`|`、`<`、`>`、`(`、`)`）；`SYSTEMROOT`（大小写三种写法皆可，另认 `windir`）缺失或校验不过时**回落裸名** `chcp.com`——宁可让它被 PATH 解析，也不要因为拿不到路径而让代码页切换这一步整个不执行。
3. **假设** 收子进程的 stdout/stderr，**当** 解码时，**则** 只按 UTF-8 解码，且必须是**跨 chunk 连续**的那一种（给流挂 `setEncoding("utf8")`，由 Node 自带的流式解码器续完被管道读边界切开的汉字），不得出现「严格解码失败即改判 GBK」之类的代码页猜测与回退；被命令自己截断的多字节字符最多在开头留下 1–2 个 `\uFFFD`，其后的字符必须逐字正确。逐 chunk 的 `toString()` 不合格：管道按 64 KiB 读，边界落在汉字中间时每个边界落一个 `\uFFFD`（本机实测 100 KiB 中文输出 3 个），删掉自建解码器后最先暴露的就是这条。
4. **假设** 命令以 `run_in_background` 或超时转后台执行，**当** 启动后台 shell 时，**则** 同一句代码页必须同样在命令串前面（后台分支自己 spawn，不经过前台那一段），且任务展示、`TaskStop` 文本与模型看到的是模型写的那条命令（`displayCommand`），不是带前缀的执行串。
5. **假设** 某程序绕过控制台代码页输出（`ipconfig` 的网卡名、`net start` 的服务名走 ANSI API；或命令 `cat` 一个 GBK 文件），**当** 收流时，**则** 这段就是 `\uFFFD`，工具不恢复代码页猜测、也不为它二次解码——这是本设计的已知代价，Claude Code 相同。
6. **假设** 运行在 Windows，**当** 执行每条命令时，**则** 允许多付一次 `chcp.com` 进程（本机实测 +120~150ms，登录 shell 本身约 430ms），并接受原生程序在 65001 下可能退回英文文案（`taskkill` 的「找不到进程」变成 `The process ... not found`）。
7. **假设** 命令自己改了输出编码（`chcp`、`iconv`、`LANG`），**当** 收流时，**则** 以命令自己设的为准：工具只在命令之前设一次，事后不按字节反推。

---

### 用户故事：内嵌搜索命令（优先级：P1）

**适用范围**：本节描述的是 **Git Bash 会话**的行为；PowerShell 会话没有内嵌搜索工具（`grep` / `find` / `rg` 影子都不注入，`.gitignore` 口径也无从谈起），搜索走 `Grep` / `Glob`（无可用 bash 时自动注册回来，见 [fs-tools.md](./fs-tools.md)「高效代码探索」）或 PowerShell 自己的 `Get-ChildItem` / `Select-String`，见 [powershell-tool.md](./powershell-tool.md)。

作为 AI 代理，我希望 Bash 工具里的 `grep` / `find` / `rg` 是 wave 自带的可控实现，以便在不额外调用搜索工具的前提下，拿到与 `.gitignore` 一致的搜索结果。

**优先级原因**：默认工具集不再提供 `Grep` / `Glob`（有可用 bash 时；见 [fs-tools.md](./fs-tools.md)「高效代码探索」），搜索全部落在 Bash 上。若直接用系统命令，macOS 的 BSD grep 缺少 `--include` 等 GNU 参数、各平台 `find` 语法也不一致，同一条命令会在不同机器上出现不同的失败形态；固定一套内嵌实现能让同一命令在所有受支持平台上行为一致，也把「哪些文件算可搜索」收敛到与 `Grep` 工具相同的 `.gitignore` 口径。

**独立测试**：在一个含 `.gitignore`（列出 `dist/`）与二进制文件的测试目录里，分别在 Bash 工具内与 `bash -c` 里执行 `grep -rl <唯一串> .`，核对前者跳过 `dist/` 与二进制文件、后者不跳。

**验收场景**：

1. **假设** 运行在受支持平台（macOS/Linux/WSL，以及 Windows 的 Git Bash）且内嵌二进制可用，**当** 执行 `grep -r <pattern> .` 时，**则** 必须使用内嵌 `ugrep`：递归时应用沿途每个 `.gitignore` 的排除规则（不要求是 git 仓库）、跳过二进制文件、按目录排除 `.git` 等 VCS 名字、输出路径不带 `./` 前缀。
2. **假设** 同名命令出现在 `xargs`、`timeout`、`env`、`find -exec` 里，或出现在新起的 `bash -c` / `zsh -c` 中，**当** 这些位置查不到 shell 函数时，**则** 必须回落到系统同名命令——一次会话里允许同时存在两套 `grep`，这是已知且可接受的差异。
3. **假设** 系统 PATH 上已经有 `rg`，**当** 注入别名时，**则** 不得覆盖用户的 `rg`；只有系统没有 `rg` 时才注入指向 wave 内置 ripgrep 的别名。
4. **假设** 命令带有内嵌实现不支持的参数（`grep` 的 `-Z`、`-z`、`--null`、`--config` 等），**当** 执行时，**则** 必须回落系统同名命令，不得报错或静默丢参数。
5. **假设** 运行在 Windows 的 Git Bash 上，**当** 执行 `grep` 时，**则** 必须使用内嵌 `ugrep`（Windows 平台包只发 ugrep）：msys 自带的是 GNU grep，没有 `.gitignore` 概念，`dist/`、`node_modules`、并行的 worktree 都会被扫进来，仓库根一次 `grep -r` 实测比内嵌 ugrep 慢两个数量级且结果多出几倍；**当** 执行 `find` 时，**则** 必须使用 msys 自带的 GNU find（bfs 没有 Windows 构建，而 msys 的 find 本身就是 GNU 语义，正是 `find` 影子要复现的那一套）；`rg` 仍按场景 3 注入。
6. **假设** 注入生效，**当** 命令结束时，**则** 退出码语义必须保持命令本身的语义（无匹配为 1）；注入不得改变 `$?`，也不得影响 heredoc、重定向、管道与 `set -e`。
7. **假设** 内嵌二进制缺失（下载失败、私有化环境未携带、平台不支持），**当** 执行任意搜索命令时，**则** 必须静默回落系统命令并照常完成，不得返回「二进制未安装」之类的失败。

---

### 边界情况

- **输出截断**：命令产生大量输出时必须截断，防止 LLM 过载；多余输出持久化到临时文件。**预算按 UTF-8 字节计（30,000 字节），不按字符计**，与 Claude Code 的 `BASH_MAX_OUTPUT_LENGTH` 同口径（它按字节从输出文件读回首段再解码）：字符口径下同样 30,000 的预算，纯 ASCII 只放约 7.5k token，纯中文却放到约 30k token（约为按字节口径的 3 倍），「防止过载」这道闸恰好在最需要它的大段中文日志上失效。**切点必须退到一个字符的起始字节**，不得把多字节字符切成两半留下 `\uFFFD`——按字节硬切会留下一个，那是 Claude Code 的实现代价，不是要对齐的语义；截断后的字节数不得超出预算。工具说明与参数描述里的口径必须与常量一致，不得写成「字符」。
- **ANSI 颜色代码**：命令输出里的 ANSI 转义序列**原样保留**，不在收流处剥离——写入转录、转给模型、交给 UI 的是同一份带色原文（与 Claude Code 对齐：它从子进程收流到发模型全程不剥，只在纯文本出口清理）。终端颜色由 UI 解析渲染（见 `ui/message-rendering-system.md`「Bash 工具输出的终端颜色」）；需要纯文本的出口在**出口侧**剥离：本地斜杠命令输出（`<local-command-stdout>`）、CLI daemon 日志展示、Markdown 表格按可见宽度对齐。工具自身的错误文案（如后台任务失败时的 `Process error: …`）不是命令输出，仍在生成处剥离。实际噪音通常很小：子进程 stdout 是管道而非 tty，多数程序本就会自动降级为无色。
- **进程树终止（跨平台）**：终止前台命令或后台任务时，必须清理整棵进程树而非仅直接子进程——POSIX 以进程组为单位（`process.kill(-pid, sig)`），Windows 走 `taskkill /T /F`（Windows 没有进程组语义，`process.kill(-pid)` 恒为 ESRCH）。「目标已不存在」只记 debug；终止失败必须记 error，不得静默放过。
- **shell 退出后留下的进程组**：命令自己 `&` / `nohup` 放走的进程在 shell 退出后 `ppid=1`、但仍留在该 shell 的进程组里。这类进程**在会话内不被终止**（`nohup npm run dev` 是正当用法），只在 shell 退出那一刻按「组里还有没有活人」探测一次并登记；真正的终止发生在会话销毁与宿主进程退出两处。`setsid` 主动换组的进程连这一步也看不到，属已知边界；Windows 上这一层整体不做（沿用 `taskkill /T` 的子树语义，shell 退出后 pid 已不可用）。
- **无效任务 ID**：使用不存在或已过期的 ID 调用 `TaskStop` 应返回清晰的错误消息。
- **每次命令使用新 Shell，当前目录单独跟踪**：每次前台命令都会生成新的 shell，环境变量更改不会在调用之间持久化；当前目录由工具单独跟踪（见「执行前台命令」场景 4、5），只在工作目录与用户显式加入的附加目录内持久化，出界即复位回会话原工作目录。
- **stdin 恒为 /dev/null**：前台命令与后台任务的子进程 fd0 都指向 `/dev/null`，无人写入 stdin——读 stdin 的命令（`cat`、不带路径的 `rg`、分页器、编辑器）必须立即拿到 EOF，不得阻塞到超时。heredoc 不受影响（由 shell 自身投喂）。代价是这类命令的失败形态为「零输出 + 非零退出码」，应按「命令没跑对」而不是「没匹配到」解读。
- **超时自动转后台**：当前台命令超时时，系统必须自动将其转为后台（移至 `BackgroundTaskManager`）而不是终止，除非命令以 `sleep` 开头（仍按原方式终止）。
- **超时转后台措辞**：自动转后台的通知文本必须避免 "timed out" 等暗示失败的措辞，改用"超出超时预算并移至后台、命令仍在运行、完成时会收到通知"的语义，并携带任务 ID 与输出路径。
- **超时取值范围**：未指定时前台命令使用默认 120000ms（2 分钟），对外宣传的上限为 600000ms（10 分钟）。该上限必须在 schema 参数描述与函数说明两处引用同一常量，不得把默认值当作上限展示。运行时只校验类型与负值（非数字或负数报错），**不校验上限**——超过 600000 的值按给定值执行（与 Claude Code 对齐）。
- **后台无超时**：当 `run_in_background` 明确为 `true` 时，任何超时（默认或显式）必须被取消——进程无限期运行直到完成或手动停止。
- **Windows 路径转换**：在 Windows 上使用 Git Bash 时，临时 CWD 文件路径必须从 Windows 路径（`C:\Users\...`）转换为 POSIX 路径（`C:/Users/...`），否则 Bash 会将反斜杠视为转义字符导致路径损坏、临时文件泄漏到项目目录中；反向转换同样必要——`pwd -P` 输出的 POSIX 路径（`/c/Users/...`）必须转换回原生 Windows 路径后再校验与回调。
- **Git Bash 未安装**：Windows 上未检测到 Git Bash 时，`Bash` 工具不注册，命令改由 `PowerShell` 工具执行（见 [powershell-tool.md](./powershell-tool.md)）——会话实际用哪个 shell 由三态判定给出（`powershell` / `bash` / `none`）。cmd.exe 不再作为任何一条路径的兜底：hook、技能/命令注入、`otelHeadersHelper` 的 cmd.exe 降级都已删除，只有在「没有 Git Bash 且 PowerShell 工具也关掉（或机器上没有 PowerShell）」时才以带安装指引的错误失败。
- **搜索命令的退出码差异**：内嵌 `grep` 在「只命中被 `.gitignore` 忽略的文件」时退出码是 1（与「没匹配到」同一语义），系统 `grep` 在同一情形下是 0。依赖 `grep -q` 做门禁的脚本（例如部署前检查某个 key 是否泄漏到构建产物）在 Bash 工具里执行与在终端执行可能得到相反结论；工具不为此额外提示，输出与退出码原样透出——家族判定只按命令名给出「无匹配」这句 `returnCodeInterpretation`，它不区分「真的没有」与「只命中被忽略的文件」。
- **Windows 上 `grep` 影子的残留差异**：`ugrep` 的 Windows 构建无法用 `exec -a` 改写 `argv[0]`（Windows 创建进程时 `argv[0]` 恒为可执行文件路径），影子里的 `exec -a grep` 在 Git Bash 上是空操作，`ugrep` 以自身模式运行——BRE 口径由固定注入的 `-G` 保证，输出本就是 `file:line:内容` 形态，`-q`/`-l`/`-v`/`-i`/`-E`/`-c`/`-o`/`-A` 与退出码 0/1/2 实测一致。残留差异两处：路径分隔符可能混用（参数前缀保留正斜杠、子路径为反斜杠，如 `packages/agent-sdk/src\tools\bashTool.ts`），错误消息前缀是 `ugrep:` 而非 `grep:`（解析 stderr 字样的脚本会看到不同文本）。
- **`find -regex` 的 dialect**：内嵌 `bfs` 固定带 `-regextype findutils-default`，把默认方言对齐成 GNU `find` 的 emacs flavour（`\|` 表示或），因此 `find . -regex '.*\.\(js\|ts\)'` 在两边给出同样的结果；调用方后续再传 `-regextype` 仍以它为准。这份能力来自编译期静态链接的 Oniguruma，随二进制一起分发，不要求用户机器上存在 `libonig`。残留差异只有 alternation 的匹配策略：Oniguruma 取 leftmost-first，POSIX 取 leftmost-longest，当某一分支是另一分支的前缀（`\(ts\|tsx\)`）时结果可能与系统 `find` 不同——把较长的分支写在前面即可，工具不为此改写调用方的模式。
- **`grep <pattern> <目录>` 不带 `-r`**：`ugrep` 递归是默认行为，因此 `grep needle src/` 会直接给出结果；macOS 的 BSD grep 在同样输入下报 `grep: src: Is a directory` 并返回 2。把它当「必须先加 `-r`」的守卫的脚本，在内嵌实现下会拿到结果而不是错误。
- **`find -size` 的取整口径**：`bfs` 按 GNU 语义把大小向上取整到单位块（`-size -1k` 只匹配空文件），macOS 的 BSD `find` 不取整（`-size -1k` 匹配所有小于 1024 字节的文件）。`-size 0`、`-size +1k` 这类写法两边一致，其余带单位的小数/负数口径按各自方言解释。
- **worktree 里的 `.git` 仍然会被搜到**：VCS 名字只按目录排除（`--exclude-dir`），而 worktree 的 `.git` 是内容为 `gitdir: …` 的指针**文件**，因此从 worktree 根执行 `grep -rn` 会多出一行 `./.git:1:gitdir: …`。这是**有意与 Claude Code 对齐**的结果（它的影子同样只传 `--exclude-dir`，最新版实测亦如此），不是遗漏：只有当搜索词命中 `gitdir`、worktree 名或仓库路径时才会现形，输出仅一行；`Grep` 工具的 rg 走 `--glob '!.git'`（按名字整体排除）没有这一条，两者在此处的差异是有意的。

## 假设

- 代理具有在目标环境中执行 bash 命令所需的权限。
- 在 Linux/macOS 上，系统必须显式解析 bash 或 zsh 作为执行 shell；`/bin/sh` 可能是 dash 或 POSIX 模式 bash，不保证兼容 bashism。
- 在 Windows 上，用户已安装 Git for Windows（提供 Git Bash）时 `Bash` 是默认执行器；未安装时由 `PowerShell` 工具接管（见 [powershell-tool.md](./powershell-tool.md)）。
- 「命令环境」与「CLI 运行时解析」是两件事：宿主采纳登录 shell 环境只影响子进程的可执行文件与变量解析，不改变内置/托管 Node 运行时的选取——后者不读登录 shell（见 [stdio-transport.md](../ui/stdio-transport.md) 场景 10），两者不冲突。
- 登录 shell 环境的探测每个宿主进程只做一次（失败按上限重试），不随会话、不随命令重复。
- shell 快照每个会话、每个 shell provider 生成一次（失败只回落，不随命令重试），每个临时目录各一份文件（沙箱有自己的临时目录），宿主进程退出时删除；它与「宿主一次性探测」是两条独立的路：前者给 shell 命令（alias、函数、选项），后者给不经 shell 的子进程（进程环境）。
- `PermissionManager` 将在任何命令实际执行之前处理安全检查。
- 代理被指示在适当时优先使用专用工具（Read、Write 等）而非通用 bash 命令；内容搜索与文件名匹配在默认工具集下没有专用工具（前提是有可用的 bash，否则 `Grep` / `Glob` 会自动回到工具表），直接使用 Bash 里的 `grep` / `find`。
