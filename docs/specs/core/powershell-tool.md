---
name: "PowerShell 工具"
description: "`PowerShell` 工具：三态 shell 门控、前台/后台执行与退出码恢复、cwd 追踪、UTF-8/GBK 输出解码、`PowerShell(...)` 规则与只读自动放行、edition 相关提示词"
order: 22
---

# 功能规格说明：PowerShell 工具

**规格文件**：`docs/specs/core/powershell-tool.md`
**创建日期**：2026-11-19

## 用户场景与测试 _(必填)_

### 用户故事：三态 shell 门控（优先级：P1）

作为没有安装 Git Bash 的 Windows 用户，我希望 wave 自动改用系统自带的 PowerShell 执行命令，以便不必先装 Git for Windows 才能用 agent；同时作为已装 Git Bash 的用户，我希望默认仍然是 bash，不被无声换掉。

**优先级原因**：这是工具能否被注册、模型看到哪条 `Shell:` 行、`!` 模式用哪个工具、hook 与技能命令在哪执行的总开关。判据若含糊（例如「Windows 上就是 PowerShell」或「env 未设就是 bash」），会在两端各错一次：无 Git Bash 的机器没有 shell 可用，有 Git Bash 的机器被执行器静默替换。

**独立测试**：对 `isPowerShellToolEnabled({ platform, envValue, hasGitBash })` 穷举平台 × env 取值 × 有无 Git Bash，核对返回值；再以 `WAVE_USE_POWERSHELL_TOOL=1` 与 `=0` 各启动一次真机会话，检查 `Shell:` 行与工具表。

**验收场景**：

1. **假设** 平台不是 Windows（`process.platform !== "win32"`），**当** 求值门控时，**则** 必须返回 false——任何环境变量取值都不改变这一点（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:77-79`）。
2. **假设** 运行在 Windows、没装 Git Bash、`WAVE_USE_POWERSHELL_TOOL` 未设置，**当** 求值门控时，**则** 必须启用 PowerShell 工具（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:80`；`hasGitBash` 的判定见 `packages/agent-sdk/src/utils/bashAvailability.ts:21-30`）。
3. **假设** 运行在 Windows、`WAVE_USE_POWERSHELL_TOOL` 为真值（`1` / `true` / `yes` / `on`，大小写与首尾空白不敏感），**当** 求值门控时，**则** 必须启用 PowerShell 工具——即使 Git Bash 存在也必须启用：显式开关优先于「有没有 Git Bash」这条默认判据（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:54-55`、`:62-69`、`:80`）。
4. **假设** 运行在 Windows、`WAVE_USE_POWERSHELL_TOOL` 为假值（`0` / `false` / `no` / `off`），**当** 求值门控时，**则** 必须关闭 PowerShell 工具——即使没有 Git Bash 也不回退到开启（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:67`、`:80`）。
5. **假设** `WAVE_USE_POWERSHELL_TOOL` 的值不在真/假两个词表里（例如拼错的 `maybe`）或为空串，**当** 求值门控时，**则** 必须按「未设置」处理，即回到「有没有 Git Bash」这条判据，而不是按「关闭」处理（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:65`、`:68`）。
6. **假设** 同时存在 `<workdir>/.wave/settings.json` 的 `env.WAVE_USE_POWERSHELL_TOOL` 与进程环境里的同名变量，**当** 收集门控输入时，**则** settings 必须优先，进程环境只作兜底（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:118`）。
7. **假设** 收集门控输入时**没有**传入 `workdir`，**当** 读该环境变量时，**则** 必须完全不读 `settings.json`、只看进程环境（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:108`）——插件 agent 的解析走的就是这条路径（`packages/agent-sdk/src/utils/subagentParser.ts:257`）。
8. **假设** 门控结论已知，**当** 问「本会话用哪个 shell」时，**则** 只能有三种答案且互斥：门控为真 → `powershell`；否则有 Git Bash → `bash`；否则 `none`（`packages/agent-sdk/src/utils/shell/shellToolGate.ts:90-93`）。

---

### 用户故事：shell 工具的注册与缺席（优先级：P1）

作为用户，我希望一个会话里清楚地只有一个 shell 工具，且它一定是能跑起来的那个；两者都不可用时要能看出「本会话不能跑 shell 命令」。

**优先级原因**：工具表是模型判断「能做什么」的第一依据。两个 shell 工具同时在表里，会让模型按工具名猜语法；一个都不在表里而不作说明，会让模型去猜 `Grep` / `Bash` 为什么不存在。

**独立测试**：分别在「无 Git Bash」「有 Git Bash」「有 Git Bash 且 env=1」「有 Git Bash 且 env=0」四种 Windows 配置下启动会话，列出工具表核对。

**验收场景**：

1. **假设** 会话有可用的 bash，**当** 注册内置工具时，**则** 必须注册 `Bash`（`packages/agent-sdk/src/managers/toolManager.ts:383-384`）。
2. **假设** 门控结论为启用 PowerShell，**当** 注册内置工具时，**则** 必须注册 `PowerShell`（`packages/agent-sdk/src/managers/toolManager.ts:401-402`）。
3. **假设** 两个条件都不成立（Windows、无 Git Bash、env=0），**当** 注册内置工具时，**则** 两个 shell 工具都不得注册（`packages/agent-sdk/src/managers/toolManager.ts:383-384`、`:401-402`），且提示词的 `Shell:` 行必须说明本会话没有可用的 shell（`packages/agent-sdk/src/prompts/index.ts:446-448`）。
4. **假设** 会话没有可用的 bash，**当** 注册内置工具时，**则** `Grep` 与 `Glob` 必须自动注册（`packages/agent-sdk/src/utils/searchToolsRegistration.ts:31-35`、`packages/agent-sdk/src/managers/toolManager.ts:393-394`）——判据只问「有没有可用 bash」，与 PowerShell 门控无关，因此 PowerShell 会话通常拿到这两个工具。
5. **假设** 用户用 `--tools` 点名了某个工具，**当** 计算注册集合时，**则** 点名不得绕过门控——`--tools` 只影响 `Grep` / `Glob` 这类默认摘除的工具，不影响 shell 工具的可注册性（`packages/agent-sdk/src/managers/toolManager.ts:386-392`）。
6. **假设** 门控为启用 PowerShell 但盘上找不到 `pwsh` / `powershell`，**当** 模型调用 `PowerShell` 时，**则** 工具仍须已注册，并在执行时返回可读错误 `PowerShell not found. Install PowerShell 7 (pwsh) or enable Windows PowerShell, then retry.`（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:156-164`）。
7. **假设** 查看 `PowerShell` 工具的定义，**当** 读工具名与并发声明时，**则** 名称必须是 `PowerShell`，且必须声明为非并发安全（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:93-95`；常量见 `packages/agent-sdk/src/constants/tools.ts:5`）。

---

### 用户故事：前台执行与退出码（优先级：P1）

作为 AI 代理，我希望在 PowerShell 里执行一条命令并拿到 stdout、stderr 与**真实退出码**，以便像在 bash 里一样判断成败；而不是因为 PowerShell 不传播原生命令退出码、或 `$?` 只看最后一条语句，被工具报成「成功」。

**优先级原因**：退出码是循环里唯一的机器可读成败信号（hook 的 `exit 2`、CI 脚本、`grep` 无匹配都是靠它）。PowerShell 的默认行为是「最后一条语句成功即进程退出 0」，若不额外拼接退出码探针，任何非零退出都会被吞成 0——这属于工具正确性，不是优化。

**独立测试**：在 Windows 上以 PowerShell 会话让模型执行 `cmd /c exit 2`、`Get-ChildItem C:\nope -ErrorAction SilentlyContinue`、`try { Get-ChildItem C:\nope -ErrorAction Stop } catch { $null }` 三种写法，核对工具返回的 `metadata.exitCode` 依次为 2、1、0。

**验收场景**：

1. **假设** 模型给出一条命令，**当** 工具构造实际执行的命令行时，**则** 必须在命令后追加退出码探针 `$_ec = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }`，最后以 `exit $_ec` 结束（`packages/agent-sdk/src/utils/shell/powershellProvider.ts:84-95`）。
2. **假设** 命令有输出，**当** 工具返回时，**则** 必须同时返回 stdout 与 stderr 的合并文本、`metadata.exitCode`，并以 `exitCode === 0` 决定 `success`（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:445-457`、`:510-522`）。
3. **假设** 退出码非 0，**当** 工具返回时，**则** 必须带上 `Command failed with exit code: <n>` 作为错误文本，且 `success` 为 false（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:517-520`）。
4. **假设** 命令完全没有任何输出，**当** 工具返回时，**则** 结果正文必须退化为 `Command executed with exit code: <n>`，不得返回空正文（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:497-502`）。
5. **假设** 模型用 `-ErrorAction SilentlyContinue` 吞掉错误输出，**当** 该 cmdlet 失败时，**则** 工具仍必须报退出码 1——错误**输出**被抑制不等于失败被忽略；提示词必须明确告知「要让失败真正无害，须 `-ErrorAction Stop` 并用 `catch { $null }` 吞掉」，且 `catch` 块不得为空（`packages/agent-sdk/src/tools/powershellTool/prompt.ts:166`）。**（无单测覆盖：这条语义只由提示词承载，靠真机验证）**
6. **假设** 调用方没有给 `timeout`，**当** 前台执行时，**则** 必须使用默认 120000ms（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:137-143`；常量见 `prompt.ts:67`）。
7. **假设** `timeout` 为非数字或负数，**当** 工具校验入参时，**则** 必须返回 `Timeout must be a non-negative number of milliseconds` 并且不 spawn（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:166-174`）。
8. **假设** `timeout` 大于 600000，**当** 执行时，**则** 必须按给定值执行，不得被拒绝或截断——上限（600000ms）只写在工具说明与参数描述里，运行时不做上限校验（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:166-168`、`packages/agent-sdk/src/tools/powershellTool/prompt.ts:186`）。
9. **假设** 命令超时、会话提供了后台任务管理器、且命令还有活干，**当** 到达 `timeout` 时，**则** 必须**不杀**进程：把它交给 `adoptProcess` 转成后台任务，返回 `success: true`、`assistantAutoBackgrounded: true` 与 `backgroundTaskId`，正文为 `Command exceeded the timeout (Ns) and was moved to the background with ID: <id>. It is still running — you will be notified when it completes.`（有输出路径时追加 `Output is being written to: <path>`）——与 Bash 工具的超时转后台同一契约（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:403-439`；是否允许的判据 `:261-265`）。
10. **假设** 命令的首个词是 `Start-Sleep` / `sleep`（含别名，先归一化再比较），或会话没有后台任务管理器，**当** 超时时，**则** 不得自动转后台，必须终止整棵进程树、返回 `metadata.exitCode: 130`，并带上 `Command timed out after Ns. Consider breaking the command into smaller steps or increasing the timeout.`（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:36-43`、`:441-444`、`:323-341`）。
11. **假设** 调用方中止了这次执行，**当** 工具收尾时，**则** 必须终止整棵进程树并返回 `metadata.exitCode: 130`——中止是用户的「停下」，不受自动转后台影响（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:393-401`、`:323-341`）。
12. **假设** 子进程根本起不来，**当** 工具返回时，**则** 必须返回 `Failed to execute command: <原因>` 而不是抛出（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:288-291`、`:571-586`）。
13. **假设** 执行一条命令，**当** 构造 spawn 调用时，**则** argv 必须是 `-NoProfile -NonInteractive -NoLogo -Command <命令串>`，并以 `shell: false`、`windowsHide: true`、`stdio: ["ignore","pipe","pipe"]` 启动（`packages/agent-sdk/src/utils/shell/powershellProvider.ts:21-26`、`:131-134`；`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:267-277`）。
14. **假设** 会话设置了 `settings.json` 的 `env`，**当** 前台命令启动时，**则** 子进程环境必须是进程环境叠加会话环境快照（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:276`；快照来源 `packages/agent-sdk/src/managers/toolManager.ts:761-767`）。
15. **假设** 会话提供了 `foregroundTaskManager`，**当** 前台执行期间用户按 Ctrl-B（或点 GUI 宿主在运行中工具块上的后台按钮，两者都落到 `backgroundCurrentTask`），**则** 必须把子进程交给 `backgroundTaskManager.adoptProcess`，返回 `success: true`、`backgroundedByUser: true` 与后台任务 ID，正文为 `Command was manually backgrounded by user with ID: <id>.`（有输出路径时追加 `Output is being written to: <path>`）；没有注册这一步时该快捷键在 PowerShell 会话里是静默空操作（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:343-391`；契约见 [task-background-execution.md](../multi-agent/task-background-execution.md)）。

---

### 用户故事：工作目录追踪（优先级：P2）

作为 AI 代理，我希望在 PowerShell 里 `cd` 过的目录对后续命令继续有效，且越界时被复位回会话工作目录，以便用相对路径连续操作，而不会在内部授权目录里跑命令。

**优先级原因**：PowerShell 侧命令与 bash 一样是「一条命令一个新进程」，`Set-Location` 不跨进程保留；不额外追踪，模型每次 `cd` 都会静默失效。而 cwd 又必须和 bash 一样受安全区域约束，否则一次 `cd` 之后的相对路径会落在工作目录之外。

**独立测试**：依次让模型执行 `cd <工作目录子目录>`、`Get-Location`，核对第二条命令的相对路径落在子目录、结果里出现 `Shell working directory changed to …`；再把 cwd 设到一个只在内部授权列表里的目录，核对出现 `Shell cwd was reset to …`。

**验收场景**：

1. **假设** 缓冲区可用，**当** 构造命令串时，**则** 必须在退出码探针之后追加 `(Get-Location).Path | Out-File -FilePath '<临时文件>' -Encoding utf8 -NoNewline`（`packages/agent-sdk/src/utils/shell/powershellProvider.ts:84-95`、`:122-129`）。
2. **假设** 命令结束时读到了新的 cwd 且它与本次执行目录不同，**当** 工具返回时，**则** 结果首行必须是 `Shell working directory changed to <dir>`，并回调 `onCwdChange`（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:481-495`）。
3. **假设** 新的 cwd 落在会话工作目录与用户显式加入的附加目录之外——**包括自动记忆目录这类只免权限提示、不构成「可停留目录」的内部目录**，**当** 工具返回时，**则** 必须复位回会话原工作目录，并在结果首行回告 `Shell cwd was reset to <dir>`（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:485-494`；「可停留目录」的判定排除系统附加目录，见 `packages/agent-sdk/src/managers/permissionManager.ts:652-657`）。
4. **假设** cwd 探测失败（临时目录不可写），**当** 执行命令时，**则** 必须照常执行命令、只是不做 cwd 追踪（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:251-258`）。
5. **假设** cwd 文件里的路径在读取时已不存在，**当** 收尾时，**则** 必须静默忽略这次追踪结果，不得报错也不得改动当前工作目录（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:61-65`）。
6. **假设** 读取 cwd 文件，**当** 解析内容时，**则** 必须先按 UTF-8 读取并剥掉 BOM——Windows PowerShell 5.1 的 `Out-File -Encoding utf8` 会写 BOM，PowerShell 7 不写（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:55-59`；写入侧理由见 `packages/agent-sdk/src/utils/shell/powershellProvider.ts:80-82`）。
7. **假设** 命令以非零退出结束，**当** 追踪 cwd 时，**则** 仍必须回写 cwd——cwd 探测排在退出码探针之后、`exit` 之前，失败的命令也会更新目录；这是有意与 Claude Code 对齐的行为（`packages/agent-sdk/src/utils/shell/powershellProvider.ts:86-95`）。**（无单测覆盖）**
8. **假设** 命令以 `run_in_background` 启动，**当** 构造命令串时，**则** 不得追加退出码探针与 cwd 追踪（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:214-217`、`:225`）。

---

### 用户故事：后台任务（优先级：P2）

作为 AI 代理，我希望把长命令放到后台并在稍后读输出，以便不阻塞当前回合。

**优先级原因**：PowerShell 分支不能照抄 bash 的后台启动方式——把 PowerShell 的二进制造交给 spawn 的 `shell` 选项会变成 cmd.exe 的 `/d /s /c`，而 `detached: true` 在 Windows 上会让 5.1 的子进程根本没有控制台。两处踩错的表现都是「命令静默地什么都没干、退出码 0」，比明确失败更难查。

**独立测试**：在 PowerShell 会话里以 `run_in_background: true` 启动 `Start-Sleep -Seconds 5; Get-Date`，核对返回的任务 ID、`outputPath`、日志文件内容；再用 `TaskStop` 停止一个长任务，核对整棵进程树消失。

**验收场景**：

1. **假设** `run_in_background` 为 true，**当** 工具返回时，**则** 必须立即返回后台任务 ID 与输出路径，正文为 `Command running in background with ID: <id>. Output is being written to: <path>`（无输出路径时改为提示用 `Read` 按 task_id 读取），结果里带 `backgroundTaskId`（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:234-244`）。
2. **假设** `run_in_background` 为 true，**当** 启动任务时，**则** 不得施加默认超时——只有调用方显式给出 `timeout` 才会计时（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:137-143`；计时逻辑 `packages/agent-sdk/src/managers/backgroundTaskManager.ts:231-242`）。
3. **假设** 后台任务启动，**当** 落日志时，**则** 日志文件必须是 `<临时目录>/wave-task-<id>.log`（`packages/agent-sdk/src/managers/backgroundTaskManager.ts:203-211`）。
4. **假设** 通过 PowerShell 工具启动后台任务，**当** 调 `BackgroundTaskManager` 时，**则** 必须传 `shell: { file, args, detached: false }` 这一显式启动描述，而不是让 manager 用自己的默认 shell（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:218-233`；`packages/agent-sdk/src/managers/backgroundTaskManager.ts:143-160`）。
5. **假设** PowerShell 后台任务的 `detached`，**当** 选定取值时，**则** 必须是 `false`——实测 `detached: true` 的 Windows PowerShell 5.1 子进程完全不执行命令（退出码 0、无输出、无副作用），因为它没有控制台而 5.1 的 `-Command` 随即什么都不做；保持 attached 后 `windowsHide` 才生效（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:226-233`；bash 分支仍是 `detached: true`，见 `packages/agent-sdk/src/managers/backgroundTaskManager.ts:180-189`）。
6. **假设** 停止后台任务，**当** 执行终止时，**则** 必须终止整棵进程树（Windows 走 `taskkill /PID <pid> /T /F`），与前台中止共用同一实现（`packages/agent-sdk/src/managers/backgroundTaskManager.ts:577-618`、`packages/agent-sdk/src/utils/killProcessTree.ts:106`）。
7. **假设** 后台任务的输出里有中文，**当** 读日志时，**则** 必须走与前台相同的解码器（UTF-8 严格解码失败即判 GBK），不得把 5.1 的 GBK 输出当 UTF-8 落到日志里（`packages/agent-sdk/src/managers/backgroundTaskManager.ts:246-256`、`:281-298`）。
8. **假设** 运行环境里没有可用的后台任务管理器，**当** 请求后台执行时，**则** 必须返回 `Background task manager not available`（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:208-211`）。

---

### 用户故事：输出解码与文件编码（优先级：P2）

作为中文 Windows 用户，我希望命令输出里的中文能正常显示，且写出的文件能被其他工具正确读回。

**优先级原因**：Windows PowerShell 5.1 与 7 的输出编码不同（5.1 对原生命令与常规输出走控制台代码页，典型为 GBK/cp936；7 走 UTF-8），而 wave 的子进程 stdout 是管道、不会做代码页转换。解码策略选错的表现是整段中文变乱码或 `\uFFFD`，属可用性而非体验问题。

**独立测试**：在 PowerShell 会话里执行会输出中文的原生命令（`git status`、`cmd /c dir`），核对结果文本无乱码；再让模型 `Out-File -Encoding utf8` 写文件后用 `Read` 读回，核对无 BOM 残留。

**验收场景**：

1. **假设** 运行在 Windows，**当** 工具接收子进程输出时，**则** 必须使用「先严格 UTF-8 解码、失败则整条流改判 GBK」的流式解码器，而不是固定 UTF-8 或固定 GBK（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:302-308`；实现 `packages/agent-sdk/src/utils/encoding.ts:1-20`、`:62`、`:73-88`）。
2. **假设** 命令自身改了输出编码，**当** 解码时，**则** 工具不做「预先设定代码页」的动作——没有 `chcp`、也不设置 `[Console]::OutputEncoding`，解码是对已收到的字节做的判定（`packages/agent-sdk/src/utils/encoding.ts:5-7`、`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:302-303`）。
3. **假设** 模型要让另一个工具读取自己写出的文件，**当** 提示词给出编码规则时，**则** 必须点明 `Out-File` / `Set-Content` 在 5.1 默认写 UTF-16 LE 带 BOM、要求 `-Encoding utf8`；未知 edition 时按 5.1 的保守规则给出同一句（`packages/agent-sdk/src/tools/powershellTool/prompt.ts:88`、`:91-93`）。
4. **假设** 模型用重定向运算符（`>` / `>>`）写文件，**当** 落盘时，**则** 编码由 PowerShell 自身决定（5.1 的 `>` 与 `Out-File` 同源，写 UTF-16 LE 带 BOM；7 写 UTF-8 无 BOM）——工具不拦截、不改写重定向的目标编码，提示词也没有单独就 `>` 给出规则，唯一的防线是模型按上一条显式指定 `-Encoding`。**（无单测覆盖：属 PowerShell 自身语义，工具侧不存在对应代码路径）**
5. **假设** 命令输出了 ANSI 颜色转义序列，**当** 结果落到模型与 UI 时，**则** 序列必须原样保留（与 Bash 工具同一口径），不在收流处剥离（`packages/agent-sdk/src/managers/backgroundTaskManager.ts:251-252`）。

---

### 用户故事：命令级权限判定（优先级：P1）

作为注重安全的用户，我希望 PowerShell 命令在执行前被判一遍：只读的自动放行、破坏性与不可静态还原的必须问我、真正危险的直接拒绝，以便 PowerShell 会话不会成为绕过权限的缺口。

**优先级原因**：PowerShell 的解析与 bash 完全不同（对象管道、脚本块、别名、参数缩写），把 bash 的判定套上去会既误放行又误拦；而「解析不了就放行」会让 `Invoke-Expression` 之类直接穿透。判定顺序与 fail-closed 口径必须先钉死。

**独立测试**：在 PowerShell 会话里依次让模型执行 `Get-ChildItem`、`Set-Content notes.txt x`、`Invoke-Expression $cmd`、`Get-Content C:\Windows\win.ini`、`powershell -EncodedCommand <base64>`，核对依次为「不问直接放行」「询问并给建议前缀」「询问且保留不再询问」「询问（路径越界）」「直接拒绝」。

**验收场景**：

1. **假设** 存在 `PowerShell(...)` 形式的规则，**当** 匹配该命令时，**则** 规则命名空间必须是 `PowerShell`，其余工具名的规则一律不匹配；通配符 `*` 转为 `.*`、其余字符转义、整体锚定、大小写不敏感（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:75-87`）。
2. **假设** 存在 deny 规则，**当** 判定开始时，**则** 必须先对**原始命令文本**跑一遍 deny 规则，再进入解析——这样解析器读不懂的命令也不会绕过 deny（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:192-203`）。
3. **假设** 解析失败（语法错、解析器超时、没有 PowerShell 可执行、输出不可解析等），**当** 判定时，**则** 永不自动放行：先按语句边界切分文本再跑一次 deny 规则，否则以 `hidePersistentOption: true` 询问（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:205-224`、`:120-140`）。
4. **假设** 解析成功，**当** 收集命令单元时，**则** 必须以每个 `CommandAst` 叶子为单位判定，子表达式与嵌套命令一并收集（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:227-229`）。
5. **假设** 命令没有任何可判定的叶子（例如只有 `using module` / `#Requires`），**当** 判定时，**则** 必须以 `hidePersistentOption: true` 询问（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:230-239`）。
6. **假设** 命令命中硬拒规则（`-EncodedCommand`/`-enc` 等隐藏参数、同一条语句里「下载并执行」），**当** 判定时，**则** 必须直接 deny 且不给「不再询问」选项（`packages/agent-sdk/src/tools/powershellTool/security.ts:114-162`、`packages/agent-sdk/src/tools/powershellTool/permissions.ts:242-250`）。
7. **假设** 命令命中「脚本块 / 动态执行」（`Invoke-Expression`、`Invoke-Command`、`Start-Job`、`Register-*Event`、`New-Object -ComObject` 等），**当** 判定时，**则** 必须询问，且**保留**「不再询问」——落盘的是这条精确命令，而不是通配前缀（`packages/agent-sdk/src/tools/powershellTool/security.ts:164-203`、`packages/agent-sdk/src/tools/powershellTool/permissions.ts:299-308`）。
8. **假设** 破坏性 cmdlet（`Remove-Item`、`Set-Content`、`Out-File`、`Move-Item` 等）的目标是文件系统根、用户主目录（含 `~`、`$HOME`、`%USERPROFILE%` 等等价写法）、或 `Windows`/`System32`/`Program Files` 这类系统目录本身，**当** 判定时，**则** 必须直接 deny；系统目录**之下**的普通路径不在此列（`packages/agent-sdk/src/tools/powershellTool/pathValidation.ts:27-61`、`:92-120`、`packages/agent-sdk/src/tools/powershellTool/permissions.ts:252-262`）。
9. **假设** 存在 allow 规则，**当** 命中时，**则** 必须要求**每个**叶子都被规则覆盖才对整条命令放行——一条规则不能带走复合命令里的第二条命令（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:268-283`）。
10. **假设** 所有叶子都是只读 cmdlet，**当** 判定时，**则** 自动放行的条件必须是：叶子名在只读白名单内、参数里没有脚本块/子表达式、抽出的每个路径都在安全区域内、且命令没有任何文件重定向（`2>&1` 不算写）（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:157-173`、`:287-294`；白名单 `packages/agent-sdk/src/tools/powershellTool/readOnly.ts:31-79`）。
11. **假设** 进入询问，**当** 给出建议前缀时，**则** 只有命令只含一个叶子时才给 `suggestedPrefix`，多叶子一律不给（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:299-304`）。
12. **假设** 命令为空串，**当** 判定时，**则** 必须以 `empty-command` 询问（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:187-190`）。
13. **假设** 权限模式为 `dontAsk` 且没有匹配的 allow 规则，**当** 判定结果为「询问」时，**则** 必须按拒绝处理（`packages/agent-sdk/src/managers/permissionManager.ts:1223-1286`；用例 `packages/agent-sdk/tests/managers/permissionManager.powershell.test.ts:249`）。
14. **假设** 用户为 bash 写过 `Bash(Get-ChildItem *)` 之类的规则，**当** 在 PowerShell 会话里判定同一条命令时，**则** 该规则不得生效——命名空间不同即互不可见（`packages/agent-sdk/tests/managers/permissionManager.powershell.test.ts:266`；CLI 侧同名理由见 `packages/code/src/reducers/confirmationReducer.ts:125-129`）。

---

### 用户故事：两套危险集合与「不再询问」的两级抑制（优先级：P1）

作为用户，我希望危险命令只失去「通配前缀」或（更危险时）失去「不再询问」，而不是让我彻底无法批准，以便一次性的破坏性操作仍可执行，同时又不会把 `del*` 这种通配规则写进配置。

**优先级原因**：这两套集合的语义极易被写成同一件事。若把「不给通配前缀」误实现成「不给持久化」，用户对 `Invoke-Expression` 就永远只能逐次点「是」；若反过来把「不给持久化」误实现成「只去掉前缀」，`Remove-Item*` 就会被一次点击永久放行。

**独立测试**：分别对 `Invoke-Expression $x`、`Get-ChildItem`（应给前缀）、`Remove-Item foo.txt`、`Set-Content a.txt x`、`Get-Date > out.txt` 走一遍询问，核对卡片上「不再询问」选项与建议前缀的两种组合。

**验收场景**：

1. **假设** 命令的叶子命中 `NO_PREFIX_SUGGEST`（危险 cmdlet 名与破坏性 cmdlet 的并集，含别名展开），**当** 生成建议前缀时，**则** 必须返回 `null`，即不给通配前缀——但询问与「不再询问」照常提供，落盘的是这条精确命令（`packages/agent-sdk/src/utils/powershellStructure/dangerousCmdlets.ts:257-261`、`packages/agent-sdk/src/utils/powershellStructure/staticPrefix.ts:93-95`、`:126-133`）。
2. **假设** 命令的叶子命中 `BLOCK_PERSIST`（破坏性 cmdlet 集合，含别名展开），**当** 生成询问时，**则** 必须同时隐藏「不再询问」选项（`packages/agent-sdk/src/utils/powershellStructure/dangerousCmdlets.ts:278-279`、`packages/agent-sdk/src/tools/powershellTool/permissions.ts:331-339`）。
3. **假设** 命令含文件重定向（`2>&1` 除外），**当** 生成询问时，**则** 必须隐藏「不再询问」——写重定向不构成可持久化的规则（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:143-148`、`:331-339`）。
4. **假设** 同一条命令的多个叶子里有一个命中 `BLOCK_PERSIST`，**当** 生成询问时，**则** 整条命令都必须隐藏「不再询问」（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:331-339`；用例 `packages/agent-sdk/tests/managers/permissionManager.powershell.test.ts:221`）。
5. **假设** 两个集合的关系，**当** 求值时，**则** `BLOCK_PERSIST` 必须是 `NO_PREFIX_SUGGEST` 的子集（用例 `packages/agent-sdk/tests/utils/powershellStructure/dangerousCmdlets.test.ts:127`）。
6. **假设** 询问被标记为隐藏持久化，**当** 卡片渲染时，**则** GUI 与交互式 CLI 都不得出现「不再询问」按钮/选项（`packages/agent-sdk/src/managers/permissionManager.ts:1266`、`packages/webview/src/components/ConfirmationDialog.tsx:1352-1361`、`packages/code/src/reducers/confirmationReducer.ts:202`）。
7. **假设** 询问给出建议前缀，**当** 用户选择「不再询问」时，**则** 写出的规则必须是 `PowerShell(<建议前缀>)`；没有建议前缀时改写 `PowerShell(<整条命令>)`（`packages/webview/src/components/ConfirmationDialog.tsx:695-702`、`packages/code/src/reducers/confirmationReducer.ts:130-132`）。
8. **假设** 查看 PowerShell 的确认卡片，**当** 渲染时，**则** 卡片与 `Bash` 完全同形（同一个「命令执行待确认」标题、同一段命令正文），不额外显示 shell 名（`packages/desktop/src/main/desktopHost.ts:3902-3905`、`packages/webview/src/components/ConfirmationDialog.tsx:1257-1266`、`packages/code/src/components/ConfirmationDetails.tsx:26-31`）。

---

### 用户故事：持久化规则按叶子拆分（优先级：P1）

作为用户，我希望「不再询问」为复合命令里的**每一条**子命令各写一条规则，以便它与判定逻辑（每个叶子都必须被覆盖）对齐，而不是写一条永远匹配不上的整串文本。

**优先级原因**：判定按叶子跑，落盘若按整串文本写，则 `Set-Variable …; Get-Date` 会写成一条既不等同于任何叶子、也不覆盖整串的规则——下一次同样的命令仍会被问，用户会以为「不再询问」失效（这是真实发生过的缺陷）。

**独立测试**：对 `Set-Variable -Name x -Value 1; Get-Date` 选择「不再询问」，核对落盘的是两条 `PowerShell(...)` 规则；重跑同一命令（同会话与全新进程各一次）必须不再询问。

**验收场景**：

1. **假设** 收到一条 shell 工具的持久化规则文本，**当** 展开规则时，**则** 必须按工具名分派：`Bash(...)` 走 bash 展开，其余 shell 工具名走 PowerShell 展开（`packages/agent-sdk/src/managers/permissionManager.ts:1979-1987`）。
2. **假设** 展开的是 PowerShell 命令，**当** 解析成功时，**则** 必须为每个 `CommandAst` 叶子各写一条 `PowerShell(<leaf.text>)`，而不是整串文本或通配前缀（`packages/agent-sdk/src/managers/permissionManager.ts:1941-1963`）。
3. **假设** 解析失败，**当** 展开规则时，**则** 必须一条规则都不写（返回空数组）——不可解析的命令在判定时本就隐藏了持久化选项，这条分支按构造不可达，仍须 fail-closed（`packages/agent-sdk/src/managers/permissionManager.ts:1946-1957`）。
4. **假设** 之后再判定同一命令，**当** 匹配规则时，**则** 每条叶子的三种文本形态（原样文本、去模块前缀的 canonical 形式、canonical 名 + 参数）都必须参与匹配，且 `*` 仍按通配处理（`packages/agent-sdk/src/tools/powershellTool/permissions.ts:95-104`、`:75-80`）。
5. **假设** 同一条规则已存在，**当** 再次写入时，**则** 不得产生重复项（`packages/agent-sdk/src/managers/permissionManager.ts:1993-2018`）。

---

### 用户故事：`!` 模式与技能/命令注入跟随会话 shell（优先级：P2）

作为用户，我希望我自己敲的 `!` 命令和技能正文里的 `!`cmd`` 都在本会话真正的 shell 里执行，以便 PowerShell 会话里不会有一条命令莫名跑在 bash 里（或反之）。

**优先级原因**：这两处是「用户自己写的命令」和「技能作者写的命令」，它们对语法的预期不同（用户按当前会话，技能作者按 bash）。若执行器与提示里声明的 shell 不一致，命令会以另一种语言的语法被解释，失败原因还看不出来。

**独立测试**：在 PowerShell 会话里敲 `!Get-Date`，核对工具块名为 `PowerShell` 且执行成功；再让一个含 `!`echo hi`` 的技能在本会话展开，核对它由 PowerShell 一次性 argv 执行且不做 POSIX 路径改写。

**验收场景**：

1. **假设** 会话 shell 为 PowerShell，**当** 用户敲 `!` 命令时，**则** 必须用 `PowerShell` 工具执行，且工具块名必须是 `PowerShell`（`packages/agent-sdk/src/managers/bashModeManager.ts:84-89`、`:107-111`）。
2. **假设** 会话没有任何 shell，**当** 用户敲 `!` 命令时，**则** 必须落到 bash 工具并返回它自己的「装什么」错误，而不是由 `!` 模式静默跳过（`packages/agent-sdk/src/managers/bashModeManager.ts:78-82`）。
3. **假设** `!` 模式执行命令，**当** 走权限链路时，**则** 不得经过权限检查——它是用户显式敲下的命令（`packages/agent-sdk/src/managers/bashModeManager.ts:116-117`、`:127-132`）。
4. **假设** 技能或斜杠命令体里有 `!`cmd``，**当** 会话 shell 为 PowerShell 时，**则** 必须用 `-NoProfile -NonInteractive -NoLogo -Command <命令>` 执行，且**不做** POSIX 路径改写、**不**追加 hook 用的退出码包装（`packages/agent-sdk/src/utils/markdownParser.ts:301-311`）。
5. **假设** 技能命令执行时没有可用 shell，**当** 展开内容时，**则** 必须抛出带安装指引的错误（`No shell is available …` / 缺 PowerShell 的那条），不得静默跳过或降级到 cmd.exe（`packages/agent-sdk/src/utils/markdownParser.ts:301-304`、`packages/agent-sdk/src/utils/shell/shellToolGate.ts:145-154`）。
6. **假设** 技能里写的 `!`cmd`` 需要权限判定，**当** 判定时，**则** 规则命名空间必须随会话 shell（`PowerShell`或`Bash`），每次判定现算（`packages/agent-sdk/src/utils/bashCommandGate.ts:58-63`）。

---

### 用户故事：提示词的 edition 三分与 bash 惯用法翻译（优先级：P1）

作为 AI 代理，我需要在提示词里明确看到「当前是哪个 PowerShell 版本、哪些 bash 写法在这里是语法错误、对应的写法是什么」，以便第一版就写对，而不是靠报错反复试。

**优先级原因**：PowerShell 7 与 5.1 的可用语法不同（`&&`/`||`/`?:`/`??` 只有 7 有），而 edition 判定失败时必须按 5.1 保守写。提示词是唯一能预防「模型写 `&&` → 解析错误 → 重试」的手段；`Shell:` 行则是模型每轮都能看到的唯一权威陈述。

**独立测试**：分别在 `pwsh`、`powershell.exe`、与 edition 判定失败三种环境下渲染工具提示词与系统提示词，核对 edition 段落与 `Shell:` 行一一对应；再核对内置技能里的 bash 惯用法在翻译表里各出现一次。

**验收场景**：

1. **假设** 会话 shell 为 bash，**当** 渲染系统提示词时，**则** `Shell:` 行必须来自 `$SHELL`（非 Windows），Windows 上的 Git Bash 还要追加「用 Unix 语法而不是 Windows 语法」的提示（`packages/agent-sdk/src/prompts/index.ts:461-470`）。
2. **假设** 会话 shell 为 PowerShell 7，**当** 渲染 `Shell:` 行时，**则** 必须是 ``Shell: PowerShell 7 (pwsh — `&&` and `||` are available)``，工具提示词的 edition 段还必须补充三元/空合并可用与「默认 UTF-8 无 BOM」（`packages/agent-sdk/src/prompts/index.ts:452-453`、`packages/agent-sdk/src/tools/powershellTool/prompt.ts:77-82`）。
3. **假设** 会话 shell 为 Windows PowerShell 5.1，**当** 渲染时，**则** `Shell:` 行必须写明没有 `&&` / `||` 并给出 `A; if ($?) { B }` 的替代，工具提示词还要额外警告不得对原生命令用 `2>&1`、`Out-File`/`Set-Content` 的 UTF-16 默认、以及 `ConvertFrom-Json` 返回 PSCustomObject（`packages/agent-sdk/src/prompts/index.ts:455-456`、`packages/agent-sdk/src/tools/powershellTool/prompt.ts:83-90`）。
4. **假设** edition 无法判定，**当** 渲染工具提示词时，**则** 必须按 5.1 的保守规则给一份合并段落（禁用 7 独有语法、`2>&1` 与 `-Encoding utf8` 两条提醒），`Shell:` 行必须写「版本未知、按 5.1 处理」（`packages/agent-sdk/src/tools/powershellTool/prompt.ts:70-75`、`:91-93`；`packages/agent-sdk/src/prompts/index.ts:458`）。
5. **假设** 渲染 PowerShell 工具提示词，**当** 给出 bash 惯用法对照时，**则** 必须覆盖 `head`/`tail`、`which`、`touch`、`wc -l`、`mkdir -p`、`rm -rf`、`ln -s`、`chmod`/`chown`、`2>/dev/null`、`VAR=x cmd` 与 bash 控制流（`test [ -f ]`、`for x in *`、反引号替换），且这些条目在提示词里各只出现一次（`packages/agent-sdk/src/tools/powershellTool/prompt.ts:153-164`）。
6. **假设** 渲染 PowerShell 工具提示词，**当** 给出退出码规则时，**则** 必须说明 `-ErrorAction SilentlyContinue` 不改变退出码、以及 `try { … -ErrorAction Stop } catch { $null }` 才是「让失败无害」的写法（`packages/agent-sdk/src/tools/powershellTool/prompt.ts:166`）。
7. **假设** 渲染 PowerShell 工具提示词，**当** 给出禁用清单时，**则** 必须点名 `-NonInteractive` 下会挂死的交互命令（`Read-Host`、`Get-Credential`、`Out-GridView`、`$Host.UI.PromptForChoice`、`pause`）与交互式 git 命令（`packages/agent-sdk/src/tools/powershellTool/prompt.ts:168-171`）。
8. **假设** 查看 PowerShell 工具是否提供精简提示词，**当** 检查工具定义时，**则** 必须没有 `leanPrompt`——与 Claude Code 一致（它同样没有），不得为了对齐 Bash 而补一个（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:126-128`、`packages/agent-sdk/src/tools/powershellTool/prompt.ts:42-49`）。
9. **假设** 会话没有 `Grep` / `Glob`，**当** 渲染工具提示词时，**则** 搜索指引必须指向本 shell 可用的命令（`Get-ChildItem -Recurse` / `Select-String`），而不是 bash 的 `grep` / `find`（`packages/agent-sdk/src/tools/powershellTool/prompt.ts:96-127`）。

---

### 用户故事：hook、子 agent 与遥测里的 shell（优先级：P2）

作为扩展与集成作者，我希望 hook 命令、子 agent 的只读指引、以及 `otelHeadersHelper` 命令都用同一套会话 shell 判定，以便 PowerShell 会话里没有一条路径悄悄退回 cmd.exe。

**优先级原因**：这三处都不是模型直接调用的工具，却都在替用户执行命令。历史上它们各自有一条 cmd.exe 兜底，行为不一致（`cmd /c` 不剥引号、不认 bash 语法）；现在统一到 `resolveSessionShell`，但只要有一条路径还能降级，PowerShell 或 bash 语法就会在那里失效且难以定位。

**独立测试**：在 PowerShell 会话里配一个 `PreToolUse` hook（含 `exit 2`）、一个 `otelHeadersHelper`、以及一个内置 Explore 子 agent，分别核对 hook 的阻断仍生效、helper 命令由 pwsh 执行、子 agent 指引讲的是 PowerShell。

**验收场景**：

1. **假设** 执行 hook 命令，**当** 选 shell 时，**则** 必须以 `context.sessionRoot ?? context.projectDir` 为准走三态判定（而不是漂移的 cwd）（`packages/agent-sdk/src/services/hook.ts:232-234`、`:264-268`）。
2. **假设** 会话 shell 为 PowerShell，**当** 执行 hook 时，**则** argv 必须是 `-NoProfile -NonInteractive -NoLogo -Command <命令 + 退出码包装>`，且不做 POSIX 路径转换（`packages/agent-sdk/src/services/hook.ts:252-258`）。
3. **假设** hook 命令以 `exit 2` 结束，**当** PowerShell 执行它时，**则** 必须把 2 恢复出来——追加 `if (-not $?) { if ($LASTEXITCODE -eq 2) { exit 2 } }`，否则 5.1 会把 2 压成 1，hook 的阻断协议失效（`packages/agent-sdk/src/utils/shell/powershellProvider.ts:28-58`、`packages/agent-sdk/src/services/hook.ts:255-258`）。
4. **假设** 会话没有任何可用 shell，**当** 执行 hook 时，**则** 必须以该问题的原文抛错（`No shell is available …` 或缺 PowerShell 的那条），不得降级到 cmd.exe（`packages/agent-sdk/src/services/hook.ts:235-237`、`packages/agent-sdk/src/utils/shell/shellToolGate.ts:145-154`）。
5. **假设** 执行 `otelHeadersHelper` 命令，**当** 会话 shell 为 PowerShell 时，**则** 必须用一次性 argv 执行，且**不**追加 hook 的退出码包装、**不**做路径转换——这条命令的退出码只决定「有没有 header」，任何非零都已足够（`packages/agent-sdk/src/telemetry/headersHelper.ts:132-144`）。
6. **假设** 没有可用 shell，**当** 执行 helper 时，**则** 该失败必须被归为 `spawn_failed` 而不是让整条遥测链路抛出（`packages/agent-sdk/src/telemetry/headersHelper.ts:135-159`、`:211-217`）。
7. **假设** 会话 shell 为 PowerShell，**当** 生成内置 Explore / Plan 子 agent 的提示词时，**则** 搜索指引必须改成 `Glob` / `Grep` 工具、只读命令白名单必须换成 PowerShell 版（`Get-ChildItem`、`git status`、`Select-Object -First/-Last` 等）、禁用清单换成 `New-Item` / `Remove-Item` / `Copy-Item` / `Move-Item`（`packages/agent-sdk/src/utils/subagentParser.ts:323`、`packages/agent-sdk/src/utils/shellPromptGuidance.ts:45-48`、`:52-92`、`:114-128`）。
8. **假设** 会话没有 shell，**当** 生成子 agent 提示词时，**则** 必须明确写「本会话没有 shell 工具，请用文件与搜索工具」（`packages/agent-sdk/src/utils/shellPromptGuidance.ts:89-91`）。

---

### 边界情况

- **一次性切换提示**：本实现**没有**任何「本会话改用 PowerShell 执行」的一次性提示（既没有 CC 的 `no_bash_shell` 文案，也没有工具结果头部的一次性 `Note:`）。模型获知执行器的渠道只有两处：系统提示词的 `Shell:` 行（`packages/agent-sdk/src/prompts/index.ts:443-470`）与 PowerShell 工具自己的提示词/错误文本。bash 工具在无 shell 时的报错也只讲 Git Bash，不提 PowerShell 开关（`packages/agent-sdk/src/tools/bashTool.ts:275-278`）。
- **Git Bash 缺席不再降级到 cmd.exe**：hook、技能/命令注入、`otelHeadersHelper` 三条路径都已删除 cmd.exe 兜底，没有 shell 时一律抛错（`packages/agent-sdk/src/services/hook.ts:220-237`、`packages/agent-sdk/src/utils/markdownParser.ts:294-310`、`packages/agent-sdk/src/telemetry/headersHelper.ts:119-144`）。
- **每次命令一个新进程**：`cd`（= `Set-Location`）、`$env:` 赋值、函数与 alias 都不跨调用保留；当前目录由 cwd 追踪单独维持（见「工作目录追踪」）。
- **cwd 追踪是尽力而为**：临时目录不可写、cwd 文件读不到、路径已不存在，都不影响命令结果的成败（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:61-65`、`:251-258`）。
- **后台 PowerShell 与 detached**：`detached: false` 是实测结论而非风格选择；它换来的是 `windowsHide` 生效、命令真的会执行（`packages/agent-sdk/src/tools/powershellTool/powershellTool.ts:226-233`）。`BackgroundTaskManager` 里描述「两处 spawn 都用 `detached: true`」的注释已与 PowerShell 分支不一致（`packages/agent-sdk/src/managers/backgroundTaskManager.ts:66-70`）。
- **解析器在权限路径上**：每次权限判定都要 spawn 一次 PowerShell 解析命令（超时 5 秒、超时重试一次），结果进 256 项 LRU 缓存；传输类失败（spawn 失败/超时/空输出/非 JSON）会把该条目逐出缓存，语法错误则保留（`packages/agent-sdk/src/utils/powershellStructure/psParser.ts:35-50`、`:63-69`、`:180-196`、`:251-279`）。
- **`settings.json` 的 `env` 并非所有子进程都拿到**：前台命令、后台任务、`!` 模式、hook 都带会话环境快照；技能注入命令（`packages/agent-sdk/src/utils/markdownParser.ts:313-323`）与 `otelHeadersHelper`（`packages/agent-sdk/src/telemetry/instrumentation.ts:247` 不传 env）不带。
- **hook 与技能注入在 PowerShell 下的不对称**：hook 做 POSIX 路径转换并且追加退出码包装；技能/命令注入**既不做路径转换、也不追加包装**，因为技能命令的执行结果直接作为正文返回，不承载 hook 的 `exit 2` 协议（`packages/agent-sdk/src/utils/markdownParser.ts:305-311`）。
- **只读白名单是保守集合**：任何接收 `ScriptBlock` 的 cmdlet（`ForEach-Object`、`Where-Object`）、任何写文件的 cmdlet、`Invoke-Item` 与「起进程」家族都刻意不在白名单里（`packages/agent-sdk/src/tools/powershellTool/readOnly.ts:11-21`）。
- **危险路径只拒「正好是」**：`C:\Windows` 本身被拒，`C:\Windows\System32\drivers\etc` 之下的普通文件仍走询问而不是硬拒（`packages/agent-sdk/src/tools/powershellTool/pathValidation.ts:22-26`、`:92-120`）。
- **不做沙箱**：PowerShell 工具没有沙箱分支（Windows 上沙箱本就不可用），也不使用 `-EncodedCommand` 传命令，以保证进程列表与授权卡上能看到真实命令（`packages/agent-sdk/src/utils/shell/powershellProvider.ts:8-20`）。

## 假设

- 会话运行在 Windows 11 / Windows Server 上，机器自带 Windows PowerShell 5.1（`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`）；PowerShell 7（`pwsh`）为可选项，安装了就优先使用（`packages/agent-sdk/src/utils/shell/powershellDetection.ts:29-30`、`:59-89`）。
- 探测按「先按可执行文件名、再按目录」扫描 PATH，避免 System32 靠前把会话钉死在 5.1；取不到时用 `%SystemRoot%` 兜底（`packages/agent-sdk/src/utils/shell/powershellDetection.ts:9-15`、`:71-86`）。
- 版本的判定只看可执行文件名：`pwsh*` 记为 `core`（7+），其余记为 `desktop`（5.1）（`packages/agent-sdk/src/utils/shell/powershellDetection.ts:103-110`）。
- 权限判定与提示词都接受「解析失败即询问」的代价：解析器需要真实 PowerShell，冷启动可能到秒级，偶尔会被杀软拦（`packages/agent-sdk/src/utils/powershellStructure/psParser.ts:35-47`）。
- 没有 Git Bash 的 Windows 上，`Grep` / `Glob` 会自动回到工具表，因此 PowerShell 会话的模型仍有结构化搜索手段（见 [fs-tools.md](./fs-tools.md)「高效代码探索」）。
- `PermissionManager` 在任何命令实际执行之前完成判定；`!` 模式是唯一的例外（`packages/agent-sdk/src/managers/bashModeManager.ts:116-117`）。
- 本规格描述的是当前代码的实际行为：与设计稿的差异（未实现的一次性提示、bash 工具报错不提 PowerShell、`BackgroundTaskManager` 的过期注释、技能注入与 helper 不带会话 env）在交付报告里单列，不在此处按设计意图书写。
