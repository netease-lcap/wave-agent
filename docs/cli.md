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

**ACP 桥模式**（`--acp`）

以 Agent Communication Protocol 桥接方式运行，用于与其他 Agent 系统集成。

```bash
wave --acp
```

---

## 2. 命令行选项 {#cli-options}

### 2.1 会话控制 {#session-options}

| 选项 | 简写 | 描述 |
|---|---|---|
| `--restore <id>` | `-r` | 按 session ID 恢复会话；不指定 ID 则列出可用会话 |
| `--continue` | `-c` | 自动继续上次会话 |

```bash
# 列出可恢复的会话
wave -r

# 恢复指定会话
wave -r <session-id>

# 继续上次会话
wave -c
```

### 2.2 模型与工具 {#model-tool-options}

| 选项 | 描述 |
|---|---|
| `--model <name>` | 指定 AI 模型 |
| `--tools <list>` | 启用的工具列表（逗号分隔） |
| `--allowed-tools <list>` | 始终允许的工具列表 |
| `--disallowed-tools <list>` | 始终禁用的工具列表 |
| `--mcp-config <json>` | MCP 服务器配置（JSON 字符串） |

```bash
# 指定模型并限制工具
wave --model gpt-4o --disallowed-tools Bash,Write
```

### 2.3 权限与安全 {#permission-options}

| 选项 | 描述 |
|---|---|
| `--permission-mode <mode>` | 设置权限模式：`default`、`acceptEdits`、`bypassPermissions`、`dontAsk`、`plan` |
| `--dangerously-skip-permissions` | 跳过所有权限检查（危险） |

### 2.4 工作目录 {#worktree-options}

| 选项 | 简写 | 描述 |
|---|---|---|
| `--worktree [name]` | `-w` | 在 git worktree 中启动，可选指定名称 |

```bash
# 自动命名 worktree
wave -w

# 指定 worktree 名称
wave -w my-feature
```

### 2.5 其他 {#misc-options}

| 选项 | 简写 | 描述 |
|---|---|---|
| `--plugin-dir <path>` | | 从指定目录加载插件 |
| `--show-stats` | | 打印模式下显示耗时和 Token 统计 |
| `--version` | `-v` | 显示版本号 |
| `--help` | `-h` | 显示帮助信息 |

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

---

## 4. 斜杠命令 {#slash-commands}

在交互模式中，输入 `/` 可触发命令选择器，快速调用以下内置命令：

| 命令 | 描述 |
|---|---|
| `/help` | 显示帮助和快捷键 |
| `/status` | 显示 Agent 状态和配置信息 |
| `/model` | 切换 AI 模型 |
| `/tasks` | 管理后台任务 |
| `/mcp` | 管理 MCP 服务器连接 |
| `/plugin` | 管理插件 |
| `/workflows` | 查看和管理工作流运行 |
| `/rewind` | 回滚到历史检查点 |
| `/login` | SSO 企业认证登录 |
| `/logout` | 清除 SSO 认证 |
| `/clear` | 清除当前对话历史 |
| `/compact` | 压缩对话历史，减少 Token 占用 |
| `/goal` | 设置、检查或清除 AI 自主目标 |
| `/btw` | 旁路提问，不调用工具的快速问答 |

> 了解更多：详见 [SDK 文档 - 斜杠命令](/sdk#slash-commands)

---

## 5. 键盘快捷键 {#keyboard-shortcuts}

### 5.1 输入与导航 {#input-navigation}

| 快捷键 | 功能 |
|---|---|
| `Enter` | 发送消息 / 确认选择 |
| `Ctrl+J` | 输入换行（多行输入） |
| `↑` / `↓` | 浏览输入历史 / 选择器导航 |
| `@` | 触发文件选择器，将文件添加到上下文 |
| `/` | 触发命令选择器 |
| `!` | Shell 命令前缀（如 `!ls -la`） |
| `Ctrl+R` | 搜索 Prompt 历史 |
| `Ctrl+V` | 粘贴剪贴板图片 |

### 5.2 视图控制 {#view-control}

| 快捷键 | 功能 |
|---|---|
| `Ctrl+O` | 展开/折叠消息 |
| `Ctrl+T` | 切换任务列表显示 |
| `Ctrl+B` | 将当前任务放到后台执行 |

### 5.3 权限与确认 {#permission-control}

| 快捷键 | 功能 |
|---|---|
| `Shift+Tab` | 循环切换权限模式 |
| `Tab` | 在确认对话框中切换选项 |
| `Esc` | 中断 AI 响应 / 取消选择器 / 关闭帮助 |

---

## 6. 权限模式 {#permission-modes}

Wave 提供五种权限管理模式，控制 AI 调用工具时的确认行为：

| 模式 | 描述 |
|---|---|
| `default` | 受限工具需要用户确认，最安全的模式 |
| `acceptEdits` | 自动接受文件编辑操作，其他工具仍需确认 |
| `bypassPermissions` | 自动接受所有工具调用，无需任何确认（危险） |
| `plan` | 计划模式，AI 只能修改计划文件，适合项目规划阶段 |
| `dontAsk` | 自动拒绝受限工具，AI 不会请求确认也不会执行 |

**切换方式：**

- 交互模式中按 `Shift+Tab` 循环切换
- 启动时通过 `--permission-mode` 指定
- 使用 `--dangerously-skip-permissions` 等同于 `bypassPermissions`

---

## 7. 特色功能 {#features}

### 7.1 Bang 命令 {#bang-command}

在输入框中以 `!` 开头直接执行 Shell 命令，无需离开聊天界面。

```bash
!ls -la
!git status
!npm test
```

命令输出实时显示，长时间运行的命令支持随时中止。

### 7.2 BTW 旁路提问 {#btw}

`/btw <question>` 向 AI 快速提问，AI 不会调用任何工具，仅基于已有上下文直接回答。适合快速确认思路或获取解释，不产生工具调用开销。

```
/btw 这个函数的时间复杂度是多少？
```

### 7.3 Git Worktree {#worktree}

通过 `--worktree` 在隔离的 git worktree 中启动，安全实验新功能而不影响主分支。

```bash
wave -w my-feature
```

在交互模式中也可通过内置工具 `EnterWorktree` 切换到 worktree。

### 7.4 Goal 自主目标 {#goal}

`/goal` 设置 AI 自主追求的目标，AI 会在多轮对话中持续努力直到目标达成或触发断路器。

```
/goal 所有测试通过
/goal status    # 查看当前目标状态
/goal clear     # 清除目标
```

断路器限制：最多 50 轮对话、30 分钟运行时间、3 次评估失败。

### 7.5 Compact 压缩 {#compact}

`/compact` 压缩当前对话历史，将冗长的上下文总结为精简摘要，减少后续请求的 Token 占用。支持附加自定义指令引导压缩方向。

```
/compact 重点保留 API 设计相关的讨论
```

### 7.6 Rewind 回滚 {#rewind}

`/rewind` 将对话回滚到历史检查点，撤销后续的对话记录和文件更改。

### 7.7 图片粘贴 {#image-paste}

按 `Ctrl+V` 粘贴剪贴板中的图片，支持跨平台（macOS、Linux、Windows）。AI 可识别截图中的 UI 设计、错误信息或架构图。

### 7.8 MCP 集成 {#mcp}

通过 `/mcp` 管理 MCP（Model Context Protocol）服务器连接，扩展 AI 的外部工具能力。支持在项目根目录的 `.mcp.json` 中配置，或通过 `--mcp-config` 命令行传入。

### 7.9 插件系统 {#plugin}

通过插件扩展 AI 的 Skill 和命令。支持插件市场的发现、安装和管理，插件可在 user、project、local 三种作用域下激活。

详见 [第 3.1 节 插件管理](#plugin-commands)。

### 7.10 Workflow 工作流 {#workflow}

通过 `/workflows` 查看和管理正在运行的工作流。工作流支持多阶段编排、并行执行和确定性控制流。

### 7.11 后台任务 {#background-tasks}

通过 `/tasks` 查看后台任务列表，或通过 `Ctrl+B` 将当前前台任务放到后台执行。支持 shell 命令和子代理两种任务类型，任务完成后自动通知。

### 7.12 SSO 认证 {#sso}

通过 `/login` 进行企业 SSO 认证，授权码通过 localhost 回调自动交换为 JWT。登录后 API 请求自动通过 Wave AI 服务端代理路由，无需手动配置 API Key。通过 `/logout` 清除认证状态。

### 7.13 会话管理 {#session-management}

支持多会话的创建、恢复和管理：

```bash
wave              # 启动新会话
wave -c           # 继续上次会话
wave -r           # 列出可恢复的会话
wave -r <id>      # 恢复指定会话
```

### 7.14 Token 用量统计 {#token-stats}

在打印模式下配合 `--show-stats` 使用，输出结果末尾显示耗时和 Token 用量统计信息。

```bash
wave -p --show-stats "分析这个项目的依赖关系"
```

---

## 8. 环境变量 {#environment-variables}

| 变量 | 默认值 | 描述 |
|---|---|---|
| `LOG_LEVEL` | `INFO` | 日志级别：`DEBUG`、`INFO`、`WARN`、`ERROR` |
| `LOG_KEYWORDS` | - | 日志关键词过滤，仅输出包含指定关键词的日志 |
| `LOG_FILE` | `~/.wave/app.log` | 日志文件路径 |

> 了解更多：详见 [SDK 文档 - 环境变量](/sdk#settings-env)

---

## 9. 开发 {#development}

```bash
# 开发模式运行
pnpm wave

# 构建
pnpm -F wave-code build

# 运行测试
pnpm -F wave-code test
```
