# 功能规格说明：Bash 工具

**规格文件**：`specs/002-bash-tools.md`
**创建日期**：2024-12-19

## 用户场景与测试 *(必填)*

### 用户故事 1 - 执行前台命令（优先级：P1）

作为 AI 代理，我希望在前台执行 shell 命令，以便执行运行测试、管理 git 或执行构建脚本等任务并立即查看结果。

**优先级原因**：这是代理与系统进行非文件操作交互的主要方式。

**独立测试**：运行简单命令如 `echo "hello"` 并验证输出被返回。

**验收场景**：

1. **假设** 有要执行的命令，**当** 调用 `Bash` 工具时，**则** 它必须返回命令的输出（stdout 和 stderr）。
2. **假设** 前台命令耗时较长，**当** 超过超时时，**则** 它必须被自动转为后台（如果命令允许）或终止（如果不允许，例如 `sleep`）。
3. **假设** 前台命令超时并被自动转为后台，**则** 代理必须收到一条消息，指示进程已被移至后台，并包含其任务 ID 和输出路径。

---

### 用户故事 2 - 后台进程管理（优先级：P2）

作为 AI 代理，我希望在后台运行长时间运行的命令并在稍后获取其输出，以便在命令执行期间继续处理其他任务。

**优先级原因**：对于启动开发服务器或运行长时间测试套件而不阻塞代理等任务至关重要。

**独立测试**：使用 `sleep 5 && echo "done"` 启动后台进程，5 秒后使用 `Read` 工具检查其输出。

**验收场景**：

1. **假设** `run_in_background` 为 true，**当** 调用 `Bash` 时，**则** 它必须立即返回 `bash_id` 和指向实时日志文件的 `outputPath`。
2. **假设** `run_in_background` 为 true，**则** 命令必须在没有任何超时的情况下运行——它持续运行直到完成或手动停止。
3. **假设** 有运行中的后台进程，**当** 使用其 ID 调用 `TaskStop`（原 `KillBash`）时，**则** 进程必须被终止。
4. **假设** 后台进程已启动，**当** 我使用 `Read` 工具读取提供的 `outputPath` 文件时，**则** 我应该看到进程的实时输出。

---

### 用户故事 3 - 实时前台流式传输（优先级：P2）

作为 AI 代理，我希望实时查看前台命令的输出，以便监控进度并为长时间运行的任务获得即时反馈。

**优先级原因**：提供更响应式和交互式的体验，特别是对于产生增量输出的命令。

**独立测试**：运行类似 `for i in {1..5}; do echo $i; sleep 1; done` 的命令并验证输出每秒在 UI 中更新。

**验收场景**：

1. **假设** 前台命令正在运行，**当** 它产生输出时，**则** `shortResult` 必须实时更新，显示最后 3 行输出。
2. **假设** 前台命令正在运行，**当** 它产生输出时，**则** 完整的 `result` 必须实时更新，显示累积输出。
3. **假设** 前台命令正在运行，**当** 发生更新时，**则** 它们必须被节流（例如每秒一次）以避免 UI 过载。

---

### 用户故事 4 - Windows 平台 Git Bash 支持（优先级：P2）

作为 Windows 用户，我希望 Bash 工具能自动使用 Git Bash 执行命令，以便所有 POSIX 语法（如 `pwd`、`&&`、管道等）在 Windows 上正常工作。

**优先级原因**：当前 `spawn(cmd, { shell: true })` 在 Windows 上使用 `cmd.exe`，导致 POSIX 语法失败。这是 Windows 用户的基本可用性需求。

**独立测试**：在 Windows 系统上安装 Git Bash，运行 `echo "hello"` 验证输出正常；运行 `pwd` 验证 POSIX 命令可用。

**验收场景**：

1. **假设** 运行在 Windows 系统上，**当** Git Bash 已安装时，**则** Bash 工具必须使用 Git Bash 而非 cmd.exe 执行命令。
2. **假设** 运行在 Windows 系统上，**当** Git Bash 未安装时，**则** 系统必须返回清晰的错误消息，提示用户安装 Git for Windows。
3. **假设** 运行在 Windows 系统上，**当** 执行包含 POSIX 语法的命令（如 `pwd -P >| file`）时，**则** 命令必须正常执行并返回正确结果。
4. **假设** 运行在 Windows 系统上，**当** 命令执行后检测 CWD 时，**则** CWD 追踪机制必须正常工作（使用 POSIX 路径格式）。

---

### 边界情况

- **输出截断**：如果命令产生大量输出（例如 > 30,000 个字符），系统必须截断以防止 LLM 过载。多余输出被持久化到临时文件。
- **ANSI 颜色代码**：包含 ANSI 转义序列的颜色输出应被去除，以确保 LLM 能清晰读取文本。
- **进程组终止**：终止后台进程时，应终止整个进程组以避免留下孤儿进程。
- **无效任务 ID**：使用不存在或已过期的 ID 调用 `TaskStop` 应返回清晰的错误消息。
- **每次命令使用新 Shell**：每次前台命令都会生成新的 shell；`cd` 和环境变量更改不会在调用之间持久化。
- **超时自动转后台**：当前台命令超时时，系统必须自动将其转为后台（移至 `BackgroundTaskManager`）而不是终止，除非命令以 `sleep` 开头（仍按原方式终止）。
- **后台无超时**：当 `run_in_background` 明确为 `true` 时，任何超时（默认或显式）必须被取消——进程无限期运行直到完成或手动停止。
- **Windows 路径转换**：在 Windows 上使用 Git Bash 时，`cwd` 参数可能需要从 Windows 路径（`C:\Users\...`）转换为 POSIX 路径（`/c/Users/...`）。
- **Git Bash 未安装**：Windows 上未检测到 Git Bash 时，必须返回错误而非静默降级到 cmd.exe。

## 需求 *(必填)*

### 功能需求

- **FR-001**：系统必须提供用于执行 shell 命令的 `Bash` 工具。
- **FR-002**：`Bash` 工具必须支持可选的 `timeout` 参数（前台默认 120 秒）。当 `run_in_background` 为 true 时，超时必须被取消（不应用超时）——后台进程运行直到完成或手动停止。
- **FR-003**：`Bash` 工具必须支持 `run_in_background` 参数。
- **FR-019**：当前台命令超时时，系统必须自动将其转为后台（通过 `adoptProcess`）而不是终止，除非命令的基础命令在 `DISALLOWED_AUTO_BACKGROUND_COMMANDS`（当前为 `["sleep"]`）中，在这种情况下必须按原方式终止。
- **FR-004**：系统必须不提供 `TaskOutput`（原 `BashOutput`）工具；代理应使用 `Read` 工具读取 `outputPath`。
- **FR-006**：系统必须提供 `TaskStop`（原 `KillBash`）工具来终止后台进程。
- **FR-007**：所有 bash 输出必须去除 ANSI 颜色代码。
- **FR-008**：前台 bash 输出如果超过 30,000 个字符必须被截断。
- **FR-009**：后台 bash 任务在运行时不得更新其 `shortResult`，以防止不必要的消息更新和 UI 中的 "unknown" 工具块。
- **FR-010**：每次 `Bash` 调用都会生成一个新的 shell 进程，`cwd: context.workdir` 和 `process.env` 的副本。在一个命令中设置的环境变量不会持久化到后续命令。
- **FR-011**：当 `run_in_background` 为 true 时，系统必须返回指向实时日志文件的 `outputPath`。
- **FR-012**：系统必须将 `stdout` 和 `stderr` 实时管道传输到 `outputPath` 日志文件。
- **FR-013**：前台 `Bash` 工具必须支持对 `shortResult` 和完整 `result` 内容的实时流式更新。
- **FR-014**：前台 `Bash` 工具的实时更新必须节流为每秒一次。
- **FR-015**：前台 `Bash` 工具的实时 `shortResult` 必须显示最后 3 行输出。
- **FR-016**：`Read` 工具必须能够读取后台进程的 `outputPath`。
- **FR-017**：系统必须在 Bash 执行后通过检查 shell 的最终工作目录来检测 CWD 更改。如果 CWD 发生更改（例如通过 `cd`），系统必须更新代理的 `workdir` 上下文以供后续工具调用使用。
- **FR-018**：Bash 工具提示必须告知代理"工作目录在命令之间持久化"（当使用 `cd` 时），与实际行为一致。
- **FR-020**：在 Windows 系统上，系统必须检测并使用 Git Bash 作为 shell，而非 cmd.exe。检测顺序：`$GIT_BASH_PATH` 环境变量 → 常见安装路径（`C:\Program Files\Git\bin\bash.exe` 等）。
- **FR-021**：在 Windows 系统上，如果未检测到 Git Bash，系统必须返回错误消息，提示用户安装 Git for Windows 或设置 `GIT_BASH_PATH` 环境变量。
- **FR-022**：在 Windows 系统上使用 Git Bash 时，`spawn` 调用必须将 shell 参数设置为检测到的 Git Bash 可执行文件路径，而非 `true`。
- **FR-023**：在 Windows 系统上，CWD 追踪命令（`pwd -P >| tempfile`）必须使用 Git Bash 执行，确保输出为 POSIX 路径格式。

### 关键实体

- **前台命令**：通过 `spawn()` 进行的单次 shell 执行，`cwd: context.workdir`；每次调用使用新 shell。
- **后台任务**：由 `BackgroundTaskManager` 管理的长时间运行 shell 进程，输出管道传输到日志文件。
- **命令输出**：命令执行的组合 stdout 和 stderr，已去除 ANSI 且可能被截断。

## 假设

- 代理具有在目标环境中执行 bash 命令所需的权限。
- 在 Linux/macOS 上，系统默认 shell（`/bin/sh` 或 `$SHELL`）与 Bash 语法兼容。
- 在 Windows 上，用户已安装 Git for Windows（提供 Git Bash）。
- `PermissionManager` 将在任何命令实际执行之前处理安全检查。
- 代理被指示在适当时优先使用专用工具（Read、Write 等）而非通用 bash 命令。
