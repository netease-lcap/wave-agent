---
name: "Bash 工具"
description: "`Bash` 前台/后台命令执行：超时上限与自动转后台、输出在结束时一次性下发、跨平台 bash/zsh 与 Git Bash 解析、登录 shell 环境注入、终止时清理整棵进程树"
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
4. **假设** 命令把 shell 的当前目录 `cd` 到工作目录、或用户显式加入的附加目录（配置 `additionalDirectories`、`/add-dir`、会话内批准）之内，**当** 命令结束时，**则** 后续命令必须在该目录执行，并在结果里回告 `Shell working directory changed to <dir>`。
5. **假设** `cd` 的目标落在上述目录之外——**包括自动记忆目录这类仅供免权限提示的内部目录**，**当** 命令结束时，**则** 后续命令必须回到会话原工作目录，并在结果里回告 `Shell cwd was reset to <dir>`；内部目录只是权限白名单，不构成 shell 可停留的目录（与 Claude Code 对齐：否则后续相对路径与注入的技能命令都会跑在记忆目录里）。

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
7. **假设** 终止本身失败（权限不足、`taskkill` 无法启动、非 128 的非零退出码），**当** 终止发生时，**则** 必须以 error 级日志记录进程标识与命令输出（`taskkill` 输出为 GBK，须按系统代码页解码），并退回「只杀直接子进程」的兜底，不得抛给调用方。

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
5. **假设** 命令通过 Ctrl+B 手动转为后台，**当** 返回结果时，**则** 文本内容必须为：`Command was manually backgrounded by user with ID: X. Output is being written to: Y`。
6. **假设** 命令通过 `run_in_background: true` 启动，**当** 返回结果时，**则** 文本内容必须为：`Command running in background with ID: X. Output is being written to: Y`。
7. **假设** 命令超时被自动转为后台，**则** 该结果不得中断代理当前运行循环——只有用户手动转后台（`backgroundedByUser`）才停止循环。

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
2. **假设** 运行在 Windows 系统上，**当** Git Bash 未安装时，**则** 系统必须返回清晰的错误消息，提示用户安装 Git for Windows。
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

作为 AI 代理，我希望 Bash 工具、后台任务、bash 模式命令（`!`）、MCP server、hooks、LSP server 与 git 调用都能拿到用户登录 shell 的环境——PATH 以及 shell 配置里 export 的变量（API key、企业代理、自签证书、`SSH_AUTH_SOCK`）——且任何一条命令都不加载用户 profile。

**优先级原因**：GUI 启动的宿主（Finder/Dock 启动的桌面端、VS Code 扩展与 JetBrains 插件）进程环境不完整：PATH 缺 nvm/Homebrew，shell 配置里除 PATH 之外的 export 全部丢失——表现为 MCP server 找不到 `npx`/`uvx`、`git push` 因缺 `SSH_AUTH_SOCK` 失败、企业代理与自签证书不生效。若在 SDK 层每条命令都用 `-c -l` 加载 profile，则每条命令都付一次 shell 启动与配置执行代价，还会把用户 rc 的输出混进命令结果。因此改为「宿主启动时一次性探测、写入进程环境、所有子进程继承」，SDK 执行器保持纯 `-c`。

**独立测试**：用假 HOME 造 `~/.bashrc`（guard 前 export 一个 marker 变量与一个 PATH 目录），断言宿主探测后：(a) marker 在白名单里且被写入进程环境，(b) 不在白名单里的变量不被采纳，(c) 已由宿主显式设置的键不被覆盖、而 `PATH` 按「探测值在前 + 继承值在后 + 去重」合并，(d) 子进程执行 `echo $PATH` 时无 `-l`、不 source profile。

**验收场景**：

1. **假设** 宿主（桌面端、VS Code 扩展、JetBrains 插件）启动，**当** 开始探测用户登录 shell 环境时，**则** 探测必须**异步**进行：桌面端窗口与首屏、VS Code 激活后的可用性、JB 的工具窗口都不得等待探测完成，探测不得写在模块加载/激活的同步路径上（现状桌面端在主进程模块顶层同步 `execFileSync`，最坏会阻塞启动 5 秒）。
2. **假设** 探测在 macOS/Linux 上执行，**当** 读取登录 shell 环境时，**则** 必须取**完整环境**而非只取 PATH：`<shell> -l -i -c 'echo "<起始标记>"; env -0 && echo "<结束标记>" || env'` 形式，优先按 NUL 分割解析，`env -0` 不可用时退化为按行解析并记录退化标记。
3. **假设** 需要选定用于探测的 shell，**当** 决定用哪个 shell 时，**则** 顺序必须是：`$SHELL`（绝对路径且可执行）→ `/bin/zsh`（存在且 `~/.zshrc` 存在）→ `/bin/bash`（存在且 `~/.bashrc` 存在）→ 第一个存在的 `/bin/zsh`/`/bin/bash`/`/bin/sh`；不得硬编码某一种 shell（否则 Linux 上只装 bash 的用户探测必失败）。
4. **假设** 探测成功，**当** 把结果写入宿主进程环境时，**则** 必须「白名单 + 不覆盖」：只写入白名单内的键，且只在该键当前未设置时写入（宿主或用户显式配置优先）。白名单至少覆盖 `PATH`、`SSH_AUTH_SOCK`、`WAVE_SHELL`、`WAVE_GIT_BASH_PATH`、代理类（`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` 及大写形式）、证书信任类（`NODE_EXTRA_CA_CERTS`、`SSL_CERT_FILE`、`SSL_CERT_DIR`、`REQUESTS_CA_BUNDLE`、`CURL_CA_BUNDLE`、`GIT_SSL_CAINFO`）；**不得**把用户 shell 配置里的全部变量灌进宿主进程（`NODE_OPTIONS`、`LD_PRELOAD`、`DYLD_*`、`GIT_*` 会改变 Electron / 扩展宿主自身的行为）。唯一例外是 `PATH`：宿主进程几乎必然已继承一个不完整的 `PATH`，严格「已设置即跳过」会让登录 PATH 永远进不来，因此 `PATH` 必须合并——探测值在前、继承值在后、按分隔符去重（Windows 上键名大小写不敏感，更新已存在的那个键而不是新增一个）。
5. **假设** 启动用于探测的 shell 子进程，**当** 构造它自身的环境时，**则** 必须是最小环境（`HOME`/`PATH`/`SHELL`/`USER`/`SSH_AUTH_SOCK` 加 locale 与 display 类变量），并附加防噪变量 `DISABLE_AUTO_UPDATE=true`、`ZSH_DISABLE_COMPFIX=true`、`SSH_ASKPASS_REQUIRE=never`、`DBUS_SESSION_BUS_ADDRESS=disabled:`，避免登录 shell 的自动更新、补全自检、askpass 弹窗拖慢或阻塞探测。
6. **假设** 解析探测输出，**当** 生成最终变量集合时，**则** 必须丢弃 `PWD`、`OLDPWD`、`SHLVL`、`_` 与本故事场景 5 的防噪变量；退化为按行解析时还必须丢弃值可能含换行的键，避免跨行污染。
7. **假设** 探测失败（超时、shell 缺失、输出不可解析、Git Bash 未安装等），**当** 继续运行宿主时，**则** 必须先按上限重试（带指数退避），仍失败则降级为「只采纳 PATH」或维持继承环境，并记录一次诊断日志；任何失败都不得阻塞宿主启动、不得弹错误、不得让会话不可用。预算口径三个宿主统一：单次探测超时 4 秒、最多 2 次尝试、退避 200ms 起（最坏约 8.4 秒），宿主等待探测落地的上界与之一致——再紧会把慢配置（冷网络挂载上的 nvm）误杀，再松会让挂住的 profile 明显拖慢首个会话。
8. **假设** 环境已注入，**当** Bash 工具、后台任务、`!` 命令、MCP server、hooks、LSP server 或 git 调用启动子进程时，**则** 它们都必须能解析到登录 shell 里的工具与变量——这些路径只继承进程环境（不经 shell），因此注入必须发生在宿主进程层，而不是某一条工具执行路径里。
9. **假设** 任意一条 shell 命令执行，**当** 该命令启动时，**则** 都必须以纯 `-c` 执行：不得为单条命令 spawn 登录 shell（`-c -l`）、不得 source 用户 profile；因此用户 shell 里的 alias、函数与 `shopt` 选项对命令不生效（这是有意的取舍，换来每条命令零额外启动开销、结果不被 rc 输出污染）。
10. **假设** 运行在 Windows 上，**当** 探测环境时，**则** 沿用 Git Bash `-lic 'cygpath -pw "$PATH"'` 只采纳 PATH 并转回 Windows 原生形式；本期不要求 Windows 全量采纳环境变量（Git Bash 的变量语义与 Windows 原生进程不一致）。

---

### 用户故事：内嵌搜索命令（优先级：P1）

作为 AI 代理，我希望 Bash 工具里的 `grep` / `find` / `rg` 是 wave 自带的可控实现，以便在不额外调用搜索工具的前提下，拿到与 `.gitignore` 一致的搜索结果。

**优先级原因**：默认工具集不再提供 `Grep` / `Glob`（见 [fs-tools.md](./fs-tools.md)「高效代码探索」），搜索全部落在 Bash 上。若直接用系统命令，macOS 的 BSD grep 缺少 `--include` 等 GNU 参数、各平台 `find` 语法也不一致，同一条命令会在不同机器上出现不同的失败形态；固定一套内嵌实现能让同一命令在所有受支持平台上行为一致，也把「哪些文件算可搜索」收敛到与 `Grep` 工具相同的 `.gitignore` 口径。

**独立测试**：在一个含 `.gitignore`（列出 `dist/`）与二进制文件的测试目录里，分别在 Bash 工具内与 `bash -c` 里执行 `grep -rl <唯一串> .`，核对前者跳过 `dist/` 与二进制文件、后者不跳。

**验收场景**：

1. **假设** 运行在受支持平台（macOS/Linux/WSL，以及 Windows 的 Git Bash）且内嵌二进制可用，**当** 执行 `grep -r <pattern> .` 时，**则** 必须使用内嵌 `ugrep`：递归时应用沿途每个 `.gitignore` 的排除规则（不要求是 git 仓库）、跳过二进制文件、输出路径不带 `./` 前缀。
2. **假设** 同名命令出现在 `xargs`、`timeout`、`env`、`find -exec` 里，或出现在新起的 `bash -c` / `zsh -c` 中，**当** 这些位置查不到 shell 函数时，**则** 必须回落到系统同名命令——一次会话里允许同时存在两套 `grep`，这是已知且可接受的差异。
3. **假设** 系统 PATH 上已经有 `rg`，**当** 注入别名时，**则** 不得覆盖用户的 `rg`；只有系统没有 `rg` 时才注入指向 wave 内置 ripgrep 的别名。
4. **假设** 命令带有内嵌实现不支持的参数（`grep` 的 `-Z`、`-z`、`--null`、`--config` 等），**当** 执行时，**则** 必须回落系统同名命令，不得报错或静默丢参数。
5. **假设** 运行在 Windows 的 Git Bash 上，**当** 执行 `grep` 时，**则** 必须使用内嵌 `ugrep`（Windows 平台包只发 ugrep）：msys 自带的是 GNU grep，没有 `.gitignore` 概念，`dist/`、`node_modules`、并行的 worktree 都会被扫进来，仓库根一次 `grep -r` 实测比内嵌 ugrep 慢两个数量级且结果多出几倍；**当** 执行 `find` 时，**则** 必须使用 msys 自带的 GNU find（bfs 没有 Windows 构建，而 msys 的 find 本身就是 GNU 语义，正是 `find` 影子要复现的那一套）；`rg` 仍按场景 3 注入。
6. **假设** 注入生效，**当** 命令结束时，**则** 退出码语义必须保持命令本身的语义（无匹配为 1）；注入不得改变 `$?`，也不得影响 heredoc、重定向、管道与 `set -e`。
7. **假设** 内嵌二进制缺失（下载失败、私有化环境未携带、平台不支持），**当** 执行任意搜索命令时，**则** 必须静默回落系统命令并照常完成，不得返回「二进制未安装」之类的失败。

---

### 边界情况

- **输出截断**：如果命令产生大量输出（例如 > 30,000 个字符），系统必须截断以防止 LLM 过载。多余输出被持久化到临时文件。
- **ANSI 颜色代码**：命令输出里的 ANSI 转义序列**原样保留**，不在收流处剥离——写入转录、转给模型、交给 UI 的是同一份带色原文（与 Claude Code 对齐：它从子进程收流到发模型全程不剥，只在纯文本出口清理）。终端颜色由 UI 解析渲染（见 `ui/message-rendering-system.md`「Bash 工具输出的终端颜色」）；需要纯文本的出口在**出口侧**剥离：本地斜杠命令输出（`<local-command-stdout>`）、CLI daemon 日志展示、Markdown 表格按可见宽度对齐。工具自身的错误文案（如后台任务失败时的 `Process error: …`）不是命令输出，仍在生成处剥离。实际噪音通常很小：子进程 stdout 是管道而非 tty，多数程序本就会自动降级为无色。
- **进程树终止（跨平台）**：终止前台命令或后台任务时，必须清理整棵进程树而非仅直接子进程——POSIX 以进程组为单位（`process.kill(-pid, sig)`），Windows 走 `taskkill /T /F`（Windows 没有进程组语义，`process.kill(-pid)` 恒为 ESRCH）。「目标已不存在」只记 debug；终止失败必须记 error，不得静默放过。
- **无效任务 ID**：使用不存在或已过期的 ID 调用 `TaskStop` 应返回清晰的错误消息。
- **每次命令使用新 Shell，当前目录单独跟踪**：每次前台命令都会生成新的 shell，环境变量更改不会在调用之间持久化；当前目录由工具单独跟踪（见「执行前台命令」场景 4、5），只在工作目录与用户显式加入的附加目录内持久化，出界即复位回会话原工作目录。
- **stdin 恒为 /dev/null**：前台命令与后台任务的子进程 fd0 都指向 `/dev/null`，无人写入 stdin——读 stdin 的命令（`cat`、不带路径的 `rg`、分页器、编辑器）必须立即拿到 EOF，不得阻塞到超时。heredoc 不受影响（由 shell 自身投喂）。代价是这类命令的失败形态为「零输出 + 非零退出码」，应按「命令没跑对」而不是「没匹配到」解读。
- **超时自动转后台**：当前台命令超时时，系统必须自动将其转为后台（移至 `BackgroundTaskManager`）而不是终止，除非命令以 `sleep` 开头（仍按原方式终止）。
- **超时转后台措辞**：自动转后台的通知文本必须避免 "timed out" 等暗示失败的措辞，改用"超出超时预算并移至后台、命令仍在运行、完成时会收到通知"的语义，并携带任务 ID 与输出路径。
- **超时取值范围**：未指定时前台命令使用默认 120000ms（2 分钟），对外宣传的上限为 600000ms（10 分钟）。该上限必须在 schema 参数描述与函数说明两处引用同一常量，不得把默认值当作上限展示。运行时只校验类型与负值（非数字或负数报错），**不校验上限**——超过 600000 的值按给定值执行（与 Claude Code 对齐）。
- **后台无超时**：当 `run_in_background` 明确为 `true` 时，任何超时（默认或显式）必须被取消——进程无限期运行直到完成或手动停止。
- **Windows 路径转换**：在 Windows 上使用 Git Bash 时，临时 CWD 文件路径必须从 Windows 路径（`C:\Users\...`）转换为 POSIX 路径（`C:/Users/...`），否则 Bash 会将反斜杠视为转义字符导致路径损坏、临时文件泄漏到项目目录中；反向转换同样必要——`pwd -P` 输出的 POSIX 路径（`/c/Users/...`）必须转换回原生 Windows 路径后再校验与回调。
- **Git Bash 未安装**：Windows 上未检测到 Git Bash 时，必须返回错误而非静默降级到 cmd.exe。
- **搜索命令的退出码差异**：内嵌 `grep` 在「只命中被 `.gitignore` 忽略的文件」时退出码是 1（与「没匹配到」同一语义），系统 `grep` 在同一情形下是 0。依赖 `grep -q` 做门禁的脚本（例如部署前检查某个 key 是否泄漏到构建产物）在 Bash 工具里执行与在终端执行可能得到相反结论；工具不为此额外提示，输出与退出码原样透出。
- **Windows 上 `grep` 影子的残留差异**：`ugrep` 的 Windows 构建无法用 `exec -a` 改写 `argv[0]`（Windows 创建进程时 `argv[0]` 恒为可执行文件路径），影子里的 `exec -a grep` 在 Git Bash 上是空操作，`ugrep` 以自身模式运行——BRE 口径由固定注入的 `-G` 保证，输出本就是 `file:line:内容` 形态，`-q`/`-l`/`-v`/`-i`/`-E`/`-c`/`-o`/`-A` 与退出码 0/1/2 实测一致。残留差异两处：路径分隔符可能混用（参数前缀保留正斜杠、子路径为反斜杠，如 `packages/agent-sdk/src\tools\bashTool.ts`），错误消息前缀是 `ugrep:` 而非 `grep:`（解析 stderr 字样的脚本会看到不同文本）。
- **`find -regex` 的 dialect**：内嵌 `bfs` 固定带 `-regextype findutils-default`，把默认方言对齐成 GNU `find` 的 emacs flavour（`\|` 表示或），因此 `find . -regex '.*\.\(js\|ts\)'` 在两边给出同样的结果；调用方后续再传 `-regextype` 仍以它为准。这份能力来自编译期静态链接的 Oniguruma，随二进制一起分发，不要求用户机器上存在 `libonig`。残留差异只有 alternation 的匹配策略：Oniguruma 取 leftmost-first，POSIX 取 leftmost-longest，当某一分支是另一分支的前缀（`\(ts\|tsx\)`）时结果可能与系统 `find` 不同——把较长的分支写在前面即可，工具不为此改写调用方的模式。

## 假设

- 代理具有在目标环境中执行 bash 命令所需的权限。
- 在 Linux/macOS 上，系统必须显式解析 bash 或 zsh 作为执行 shell；`/bin/sh` 可能是 dash 或 POSIX 模式 bash，不保证兼容 bashism。
- 在 Windows 上，用户已安装 Git for Windows（提供 Git Bash）。
- 「命令环境」与「CLI 运行时解析」是两件事：宿主采纳登录 shell 环境只影响子进程的可执行文件与变量解析，不改变内置/托管 Node 运行时的选取——后者不读登录 shell（见 [stdio-transport.md](../ui/stdio-transport.md) 场景 10），两者不冲突。
- 登录 shell 环境的探测每个宿主进程只做一次（失败按上限重试），不随会话、不随命令重复。
- `PermissionManager` 将在任何命令实际执行之前处理安全检查。
- 代理被指示在适当时优先使用专用工具（Read、Write 等）而非通用 bash 命令；内容搜索与文件名匹配在默认工具集下没有专用工具，直接使用 Bash 里的 `grep` / `find`。
