---
name: "Bash 工具"
description: "Bash, BashOutput, KillBash shell 命令执行工具"
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

### 用户故事：实时前台流式传输（优先级：P2）

作为 AI 代理，我希望实时查看前台命令的输出，以便监控进度并为长时间运行的任务获得即时反馈。

**优先级原因**：提供更响应式和交互式的体验，特别是对于产生增量输出的命令。

**独立测试**：运行类似 `for i in {1..5}; do echo $i; sleep 1; done` 的命令并验证输出每秒在 UI 中更新。

**验收场景**：

1. **假设** 前台命令正在运行，**当** 它产生输出时，**则** `shortResult` 必须实时更新，显示最后 3 行输出。
2. **假设** 前台命令正在运行，**当** 它产生输出时，**则** 完整的 `result` 必须实时更新，显示累积输出。
3. **假设** 前台命令正在运行，**当** 发生更新时，**则** 它们必须被节流（例如每秒一次）以避免 UI 过载。

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

作为 AI 代理，我希望 Bash 工具、后台任务与 bang 命令（`!`）执行的命令能拿到用户登录 shell 的完整 PATH（含 nvm、Homebrew 等），且无需每条命令都加载一次用户 profile。

**优先级原因**：GUI 启动的宿主（Finder/Dock 启动的桌面端、VS Code 扩展与 JetBrains 插件）进程 PATH 不完整，且 Windows 上 Git Bash 的 profile 永远不会被 GUI 进程加载；若在 SDK 层每条命令都通过 `-c -l` 加载 profile，首次 login-shell spawn 存在启动开销与输出丢失竞态。登录 PATH 由宿主启动时注入一次，SDK 执行器纯 `-c` 继承即可。

**独立测试**：在 agent-sdk 集成测试中执行 `echo $PATH`，验证命令非登录 shell 执行（无 `-l`）且输出与宿主注入的 PATH 一致。

**验收场景**：

1. **假设** 宿主（桌面端、VS Code 扩展、JetBrains 插件）启动，**当** 宿主初始化时，**则** 必须单次探测用户登录 shell 的 PATH（macOS/Linux：登录 shell `-lic 'echo $PATH'`；Windows：Git Bash `-lic 'cygpath -pw "$PATH"'`）并注入 wave 进程环境——Bash 工具、后台任务与 bang 命令通过继承获得该 PATH，且每条命令都以纯 `-c` 执行，不得为每条命令 spawn 登录 shell（`-c -l`）。
2. **假设** 登录 shell PATH 探测成功，**当** 执行任意 shell 命令时，**则** 子进程的 PATH 必须包含登录 shell 中的路径（如 nvm/Homebrew/Git Bash）。
3. **假设** 登录 shell PATH 探测失败（超时、shell 缺失、Git Bash 未安装等），**当** 执行 shell 命令时，**则** 命令必须正常执行并回退到继承环境（探测失败不阻塞、不报错）。
4. **假设** 同一会话内执行多条命令，**当** 每条命令启动时，**则** 不得重新加载用户 profile——PATH 来自宿主启动时的一次注入。

---

### 边界情况

- **输出截断**：如果命令产生大量输出（例如 > 30,000 个字符），系统必须截断以防止 LLM 过载。多余输出被持久化到临时文件。
- **ANSI 颜色代码**：包含 ANSI 转义序列的颜色输出应被去除，以确保 LLM 能清晰读取文本。
- **进程组终止**：终止后台进程时，应终止整个进程组以避免留下孤儿进程。
- **无效任务 ID**：使用不存在或已过期的 ID 调用 `TaskStop` 应返回清晰的错误消息。
- **每次命令使用新 Shell**：每次前台命令都会生成新的 shell；`cd` 和环境变量更改不会在调用之间持久化。
- **超时自动转后台**：当前台命令超时时，系统必须自动将其转为后台（移至 `BackgroundTaskManager`）而不是终止，除非命令以 `sleep` 开头（仍按原方式终止）。
- **超时转后台措辞**：自动转后台的通知文本必须避免 "timed out" 等暗示失败的措辞，改用"超出超时预算并移至后台、命令仍在运行、完成时会收到通知"的语义，并携带任务 ID 与输出路径。
- **后台无超时**：当 `run_in_background` 明确为 `true` 时，任何超时（默认或显式）必须被取消——进程无限期运行直到完成或手动停止。
- **Windows 路径转换**：在 Windows 上使用 Git Bash 时，临时 CWD 文件路径必须从 Windows 路径（`C:\Users\...`）转换为 POSIX 路径（`C:/Users/...`），否则 Bash 会将反斜杠视为转义字符导致路径损坏、临时文件泄漏到项目目录中。
- **Git Bash 未安装**：Windows 上未检测到 Git Bash 时，必须返回错误而非静默降级到 cmd.exe。

## 假设

- 代理具有在目标环境中执行 bash 命令所需的权限。
- 在 Linux/macOS 上，系统必须显式解析 bash 或 zsh 作为执行 shell；`/bin/sh` 可能是 dash 或 POSIX 模式 bash，不保证兼容 bashism。
- 在 Windows 上，用户已安装 Git for Windows（提供 Git Bash）。
- `PermissionManager` 将在任何命令实际执行之前处理安全检查。
- 代理被指示在适当时优先使用专用工具（Read、Write 等）而非通用 bash 命令。
