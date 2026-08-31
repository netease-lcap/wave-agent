# Wave Code CLI

基于 React Ink 构建的 CLI 终端界面，提供交互式 AI 编程助手体验。

---

## 1. 安装与启动 {#installation}

### 1.1 安装 {#install}

```bash
npm install wave-code -g
```

### 1.2 运行模式 {#run-modes}

Wave CLI 提供三种运行模式，适用于不同场景：

**交互模式**（默认）

启动基于 React Ink 的终端 UI，支持实时对话、流式输出和完整的交互体验。

```bash
wave
```

**打印模式**（`--print` / `-p`）

非交互式运行，接收输入并一次性输出结果，适用于脚本集成和自动化流水线。

```bash
wave -p "解释这个项目的架构"
echo "分析这段代码的问题" | wave -p
```

配合 `--show-stats` 可在输出末尾显示耗时和 Token 用量统计。

---

## 2. 命令行选项 {#cli-options}

### 2.1 会话控制 {#session-options}

| 选项             | 简写 | 描述                                             |
| ---------------- | ---- | ------------------------------------------------ |
| `--restore <id>` | `-r` | 按 session ID 恢复会话；不指定 ID 则列出可用会话 |
| `--continue`     | `-c` | 自动继续上次会话                                 |

```bash
# 列出可恢复的会话
wave -r

# 恢复指定会话
wave -r <session-id>

# 继续上次会话
wave -c
```

### 2.2 模型与工具 {#model-tool-options}

| 选项                        | 描述                          |
| --------------------------- | ----------------------------- |
| `--model <name>`            | 指定 AI 模型                  |
| `--tools <list>`            | 启用的工具列表（逗号分隔）    |
| `--allowed-tools <list>`    | 始终允许的工具列表            |
| `--disallowed-tools <list>` | 始终禁用的工具列表            |
| `--mcp-config <json>`       | MCP 服务器配置（JSON 字符串） |

```bash
# 指定模型并限制工具
wave --model gpt-4o --disallowed-tools Bash,Write
```

### 2.3 权限与安全 {#permission-options}

| 选项                             | 描述                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `--permission-mode <mode>`       | 设置权限模式：`default`、`acceptEdits`、`bypassPermissions`、`dontAsk`、`plan` |
| `--dangerously-skip-permissions` | 跳过所有权限检查（危险）                                                       |
| `--add-dir <path>`               | 将目录加入会话安全区域，可重复指定（仅当前会话生效）                           |

```bash
# 将 /data/exports 加入当前会话的安全区域
wave --add-dir /data/exports
```

### 2.4 工作目录 {#worktree-options}

| 选项                | 简写 | 描述                                 |
| ------------------- | ---- | ------------------------------------ |
| `--worktree [name]` | `-w` | 在 git worktree 中启动，可选指定名称 |

```bash
# 自动命名 worktree
wave -w

# 指定 worktree 名称
wave -w my-feature
```

### 2.5 其他 {#misc-options}

| 选项                  | 简写 | 描述                            |
| --------------------- | ---- | ------------------------------- |
| `--plugin-dir <path>` |      | 从指定目录加载插件              |
| `--show-stats`        |      | 打印模式下显示耗时和 Token 统计 |
| `--version`           | `-v` | 显示版本号                      |
| `--help`              | `-h` | 显示帮助信息                    |

---

## 3. 子命令 {#subcommands}

### 3.1 插件管理 {#plugin-commands}

```bash
# 市场管理
wave plugin marketplace add <input>          # 添加插件市场
wave plugin marketplace update [name]        # 更新已注册的市场
wave plugin marketplace list                 # 列出所有已注册市场

# 插件操作
wave plugin install <plugin>                 # 从市场安装插件
wave plugin list                             # 列出市场中可用插件
wave plugin uninstall <plugin>               # 卸载插件
wave plugin update <plugin>                  # 更新插件（卸载后重新安装）
```

安装插件时支持指定作用域：

```bash
wave plugin install my-plugin@official --scope user     # 全局安装
wave plugin install my-plugin@official --scope project  # 项目级安装
wave plugin install my-plugin@official --scope local    # 本地安装
```

### 3.2 更新 {#update-command}

```bash
wave update    # 更新 Wave CLI 到最新版本
```

Windows 上更新时提示「更新将在后台完成」并立即退出当前进程，由分离的后台子进程完成安装，避免更新程序自身占用 bin 文件句柄导致安装失败（EPERM/EBUSY）。

### 3.3 Daemon 客户端命令 {#daemon-commands}

`wave --daemon <socket>` 在远端主机上以守护进程方式启动 Wave，托管后台 agent 会话（桌面端经 SSH 隧道访问）。与之对应，`wave daemon <子命令>` 是访问该 daemon 的客户端命令组，可在远端主机上（或经 `ssh <host> wave daemon ...`）查看、续聊与审批 daemon 托管的会话，无需打开完整 UI。所有子命令非交互式运行：结果输出到 stdout、诊断输出到 stderr，便于脚本与管道消费。

```bash
# 列出 daemon 当前托管（进程内存中 live）的全部会话：会话 ID、工作目录、状态、消息数
wave daemon list

# 查看指定会话的实时状态（生成中/空闲/等待审批）与最近消息
wave daemon status <sessionId> [--lines 20]

# 向会话注入一条消息并等待回复完成，输出助手最终回复
wave daemon send <sessionId> "继续" [--timeout 600]

# 处理会话挂起的权限请求：允许 / 拒绝（可附原因）
wave daemon respond <sessionId> <requestId> --allow
wave daemon respond <sessionId> <requestId> --deny --reason "原因"

# 中断会话正在生成的回复（含子代理、bash 命令与排队消息）
wave daemon abort <sessionId>
```

要点：

- 所有子命令固定连接默认 socket（`~/.wave/daemon.sock`），不提供 `--socket` 覆盖参数
- **语义区分**：`wave --daemon <socket>` 是启动 daemon（服务端），`wave daemon <子命令>` 是访问 daemon（客户端），两者互不干扰
- daemon 空闲 60 秒自动退出属正常现象；daemon 未运行时任一子命令快速报错退出（非零退出码），不进入 TUI、不挂起
- `wave daemon list` 仅展示当前 daemon 进程内存中 live 的会话（不扫磁盘索引）；知道 sessionId 时即使不在列表中，也可经 `status` / `send` 重新载入
- `wave daemon send` 默认 600 秒超时等待回复（`--timeout 0` 不限制）；会话挂起等待审批时超时退出，提示先经 `wave daemon respond` 处理
- `wave daemon respond` 按工具智能补全决策：`EnterPlanMode` 的 `--allow` 自动附带 plan 模式切换；`AskUserQuestion` 需用 `--answer '{"问题":"答案"}'` 提供答案；`--rule "Bash(ls)"` 持久化允许规则（后续同类调用不再询问）；`--mode acceptEdits` 切换会话权限模式
- `wave daemon abort` 中断指定会话正在生成的回复（含子代理、bash 命令与排队消息），不清除已完成的对话历史；对空闲会话是幂等 no-op（仍成功退出）；sessionId 不存在时以非零退出码报错；attach 是短暂访问、随用随断，中断后会话在 daemon 中继续存活

---

## 4. 斜杠命令 {#slash-commands}

在交互模式中，输入 `/` 可触发命令选择器，快速调用以下内置命令：

| 命令         | 描述                                                       |
| ------------ | ---------------------------------------------------------- |
| `/help`      | 显示帮助和快捷键                                           |
| `/status`    | 显示 Agent 状态和配置信息                                  |
| `/model`     | 切换 AI 模型                                               |
| `/tasks`     | 管理后台任务                                               |
| `/mcp`       | 管理 MCP 服务器连接                                        |
| `/plugin`    | 管理插件                                                   |
| `/workflows` | 查看和管理工作流运行                                       |
| `/rewind`    | 回滚到历史检查点                                           |
| `/login`     | SSO 企业认证登录                                           |
| `/logout`    | 清除 SSO 认证                                              |
| `/clear`     | 清除当前对话历史                                           |
| `/compact`   | 压缩对话历史，减少 Token 占用                              |
| `/add-dir`   | 将目录加入会话安全区域（可带 `--remember` 持久化）         |
| `/agents`    | 查看当前会话可见的所有 agent（子代理）定义，按来源分组展示 |
| `/skills`    | 查看当前会话可见的所有技能，按来源分组展示并可查看详情     |
| `/btw`       | 旁路提问，不调用工具的快速问答                             |

> 了解更多：详见 [SDK 文档 - 斜杠命令](/sdk#slash-commands)

---

## 5. 键盘快捷键 {#keyboard-shortcuts}

### 5.1 输入与导航 {#input-navigation}

| 快捷键                        | 功能                               |
| ----------------------------- | ---------------------------------- |
| `Enter`                       | 发送消息 / 确认选择                |
| `Ctrl+J`                      | 输入换行（多行输入）               |
| `↑` / `↓`                     | 浏览输入历史 / 选择器导航          |
| `@`                           | 触发文件选择器，将文件添加到上下文 |
| `/`                           | 触发命令选择器                     |
| `!`                           | Shell 命令前缀（如 `!ls -la`）     |
| `Ctrl+R`                      | 搜索 Prompt 历史                   |
| `Ctrl+V` / `Alt+V`（Windows） | 粘贴剪贴板图片                     |
| `Ctrl+A`                      | 光标移到行首                       |
| `Ctrl+E`                      | 光标移到行尾                       |
| `Ctrl+U`                      | 删除光标前到行首的内容             |
| `Ctrl+K`                      | 删除光标后到行尾的内容             |
| `Ctrl+W`                      | 删除光标前一个词                   |

**占位符整块删除：** 粘贴长文本或图片会生成 `[LongText#N]` / `[Image #N]` 占位符。当光标位于占位符末尾且其后为空白或行尾时，按 `Backspace` 会整块删除占位符（连同对应的长文本/图片附件），不会留下残缺片段；`Ctrl+U`/`Ctrl+K`/`Ctrl+W` 等行编辑键仍按普通字符串处理。

### 5.2 视图控制 {#view-control}

| 快捷键   | 功能                   |
| -------- | ---------------------- |
| `Ctrl+O` | 展开/折叠消息          |
| `Ctrl+T` | 切换任务列表显示       |
| `Ctrl+B` | 将当前任务放到后台执行 |

### 5.3 权限与确认 {#permission-control}

| 快捷键            | 功能                                 |
| ----------------- | ------------------------------------ |
| `Shift+Tab`       | 循环切换权限模式                     |
| `Tab`             | 在确认对话框中切换选项               |
| `PgUp`/`PgDn`     | 确认详情超高时翻页滚动内容区         |
| `Ctrl+U`/`Ctrl+D` | 确认详情超高时上/下滚半页            |
| `Esc`             | 中断 AI 响应 / 取消选择器 / 关闭帮助 |
| `Esc ×2`          | 空闲时双击清空输入（并保存到历史）   |

确认详情（超长 plan 或大 diff）超高时，内容区可独立滚动（`PgUp`/`PgDn` 翻页、`Ctrl+U`/`Ctrl+D` 半页），选项列表固定底部始终可见，底部显示滚动快捷键提示（内容不超高时不显示）。

---

## 6. 权限模式 {#permission-modes}

Wave 提供五种权限管理模式，控制 AI 调用工具时的确认行为：

| 模式                | 描述                                            |
| ------------------- | ----------------------------------------------- |
| `default`           | 受限工具需要用户确认，最安全的模式              |
| `acceptEdits`       | 自动接受文件编辑操作，其他工具仍需确认          |
| `bypassPermissions` | 自动接受所有工具调用，无需任何确认（危险）      |
| `plan`              | 计划模式，AI 只能修改计划文件，适合项目规划阶段 |
| `dontAsk`           | 自动拒绝受限工具，AI 不会请求确认也不会执行     |

**切换方式：**

- 交互模式中按 `Shift+Tab` 循环切换
- 启动时通过 `--permission-mode` 指定
- 使用 `--dangerously-skip-permissions` 等同于 `bypassPermissions`

**默认自动放行的只读命令：**

`default` 模式下，以下只读 git 命令默认直接执行、不触发权限确认：`git status`、`git diff`、`git log`、`git show`、`git branch`（含 `--list` / `-a` / `-r` / `-v` 等变体）、`git tag`、`git remote`、`git ls-files`、`git rev-parse`、`git config --list`、`git cat-file`、`git count-objects`。命令带全局作用域参数（如 `git -C <path> status`、`git --work-tree <path> diff`）时同样匹配自动放行；写操作（`git push`、`git commit`、`git branch -D` 等）不受影响，仍按正常权限流程确认。

---

## 7. 特色功能 {#features}

### 7.1 Bash 模式 {#bash-mode}

在输入框中以 `!` 开头直接执行 Shell 命令，无需离开聊天界面。

```bash
!ls -la
!git status
!npm test
```

命令以 user 消息 + bash tool block 形态显示在消息流中，输出实时显示、全量展示；失败时在输出前标注 `[exit code: N]`。长时间运行的命令支持随时中止。

### 7.2 BTW 旁路提问 {#btw}

`/btw <question>` 向 AI 快速提问，AI 不会调用任何工具，仅基于已有上下文直接回答。适合快速确认思路或获取解释，不产生工具调用开销。

```
/btw 这个函数的时间复杂度是多少？
```

回答期间显示 `✻ Answering` 加载提示，其后实时展示当前流式文本的最后 30 个字符（超出截断、换行折叠），按 `Esc` 可中止请求。

### 7.3 Git Worktree {#worktree}

通过 `--worktree` 在隔离的 git worktree 中启动，安全实验新功能而不影响主分支。

```bash
wave -w my-feature
```

在交互模式中也可通过内置工具 `EnterWorktree` 切换到 worktree。

在退出对话框选择 "Remove worktree"（或打印模式 `-p` 正常退出清理、`WorktreeRemove` hook 接管）删除 worktree 时，会显示 `Deleting worktree ...` 进度提示，完成后显示 `Done.`；删除失败显示错误信息而非完成提示。选择 "Keep worktree" 保留时无提示。

### 7.4 Compact 压缩 {#compact}

`/compact` 压缩当前对话历史，将冗长的上下文总结为精简摘要，减少后续请求的 Token 占用。支持附加自定义指令引导压缩方向。

```
/compact 重点保留 API 设计相关的讨论
```

压缩进行中消息列表下方显示 `✻ Compacting` 提示，其后实时展示当前流式文本的最后 30 个字符（超出截断、换行折叠），压缩完成后提示消失。

### 7.5 Rewind 回滚 {#rewind}

`/rewind` 将对话回滚到历史检查点，撤销后续的对话记录和文件更改。

### 7.6 图片粘贴 {#image-paste}

按 `Ctrl+V` 粘贴剪贴板中的图片，支持跨平台（macOS、Linux、Windows）。AI 可识别截图中的 UI 设计、错误信息或架构图。Windows 终端将 `Ctrl+V` 保留为系统文本粘贴，按键不会到达 CLI，因此 Windows 下使用 `Alt+V`（与 Claude Code 一致）。

### 7.7 MCP 集成 {#mcp}

通过 `/mcp` 管理 MCP（Model Context Protocol）服务器连接，扩展 AI 的外部工具能力。支持在项目根目录的 `.mcp.json` 中配置，或通过 `--mcp-config` 命令行传入。

### 7.8 插件系统 {#plugin}

通过插件扩展 AI 的 Skill 和命令。支持插件市场的发现、安装和管理，插件可在 user、project、local 三种作用域下激活。

详见 [第 3.1 节 插件管理](#plugin-commands)。

### 7.9 Workflow 工作流 {#workflow}

通过 `/workflows` 查看和管理正在运行的工作流。工作流支持多阶段编排、并行执行和确定性控制流。

### 7.10 后台任务 {#background-tasks}

通过 `/tasks` 查看后台任务列表，或通过 `Ctrl+B` 将当前前台任务放到后台执行。支持 shell 命令和子代理两种任务类型，任务完成后自动通知。

### 7.11 SSO 认证 {#sso}

通过 `/login` 进行企业 SSO 认证，授权码通过 localhost 回调自动交换为 JWT。登录后 API 请求自动通过 Wave AI 服务端代理路由，无需手动配置 API Key。通过 `/logout` 清除认证状态。

### 7.12 会话管理 {#session-management}

支持多会话的创建、恢复和管理：

```bash
wave              # 启动新会话
wave -c           # 继续上次会话
wave -r           # 列出可恢复的会话
wave -r <id>      # 恢复指定会话
```

会话文件的元数据头持久化真实的创建时间、工作目录与 git 分支；`wave -r` 选择器中会话行尾显示 git 分支标签（如 `[main]`），多 worktree 场景下可区分同仓库不同分支的会话。

### 7.13 附加工作目录 {#additional-working-directories}

默认情况下，Agent 只能在当前工作目录内读写文件。通过附加目录（additional working directories）将安全区域扩展到工作目录之外，目录内的文件操作不再触发权限确认，并在系统提示词中列出。

```bash
# 启动时加入（仅当前会话生效，可重复指定）
wave --add-dir /data/exports

# 会话进行中加入（--remember 追加到 .wave/settings.local.json 的
# permissions.additionalDirectories，后续会话自动加载）
/add-dir /data/exports
/add-dir --remember /data/exports
```

无参数执行 `/add-dir` 显示用法及当前会话的附加目录列表。此功能为 CLI 专属入口；配置键 `permissions.additionalDirectories` 为通用配置，各端（CLI、VS Code 等）均生效。

### 7.14 Token 用量统计 {#token-stats}

在打印模式下配合 `--show-stats` 使用，输出结果末尾显示耗时和 Token 用量统计信息。

```bash
wave -p --show-stats "分析这个项目的依赖关系"
```

---

## 8. 环境变量 {#environment-variables}

| 变量           | 默认值                 | 描述                                                                       |
| -------------- | ---------------------- | -------------------------------------------------------------------------- |
| `LOG_LEVEL`    | `INFO`                 | 日志级别：`DEBUG`、`INFO`、`WARN`、`ERROR`                                 |
| `LOG_KEYWORDS` | -                      | 日志关键词过滤，仅输出包含指定关键词的日志                                 |
| `LOG_FILE`     | `~/.wave/logs/cli.log` | 日志文件路径（桌面端/IDE 插件分别为 desktop.log/vscode.log/jetbrains.log） |

> 了解更多：详见 [SDK 文档 - 环境变量](/sdk#settings-env)
