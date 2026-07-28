# 功能规格说明

本目录包含功能规格说明文件，作为功能设计和实现的唯一真实来源。

每个规格是一个独立的 markdown 文件（按主题分组存放于子目录），包含用户故事、验收标准和功能需求。

## 为什么没有 Plan？

1. **内置能力足够强大。** Plan 模式结合权限系统控制读写范围，Task 系统对多 Agent 协作友好且自带系统提示防止上下文丢失。
2. **无法仅靠思考设计出完美方案。** 边界情况、API 怪癖、集成问题只有在实现中才会暴露，静态 plan 注定频繁改动、迅速过时，不如交给 Agent 用完即弃。

## 统计

| 指标 | 数量 |
|------|------|
| 规格文件 | 61 |
| 用户故事 | 290 |
| 功能需求 | 1,191 |
| 测试用例 | 4,365 |

## 规格列表

### Agent 核心

| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |
|------|------|----------|----------|------|
| 文件系统工具 | Read, Write, Edit, Glob, Grep 文件操作工具 | 3 | 21 | [规格](core/fs-tools.md) |
| Bash 工具 | Bash, BashOutput, KillBash shell 命令执行工具 | 5 | 29 | [规格](core/bash-tools.md) |
| WebFetch 工具 | 获取 URL 内容，HTML 转 markdown，AI 模型处理，支持缓存 | 5 | 14 | [规格](core/web-fetch-tool.md) |
| LSP 集成 | Language Server Protocol 代码智能（定义跳转、引用查找、悬停信息） | 3 | 8 | [规格](core/lsp-integration.md) |
| 自定义工具 buildTool() | buildTool() 工厂方法，供 SDK 用户定义自定义工具 | 3 | 11 | [规格](core/custom-tools.md) |
| Agent 配置 | 基于构造函数的配置替代环境变量，支持 max output tokens 和自定义 headers | 10 | 40 | [规格](core/agent-config.md) |
| 消息压缩 | 对话历史和用户输入大小管理 | 7 | 29 | [规格](core/message-compact.md) |
| Prompt 工程 | Prompt 构建和管理框架 | 5 | 13 | [规格](core/prompt-engineering.md) |
| Prompt 缓存控制 | 基于正则匹配的显式缓存标记，支持 Claude、Qwen 等多种模型 | 5 | 8 | [规格](core/prompt-cache-control.md) |
| 记忆管理 | 通过记忆文件在对话间持久化信息 | 8 | 26 | [规格](core/memory-management.md) |
| 流式输出 | 助手消息和工具参数的实时内容流式传输 | 6 | 26 | [规格](core/stream-content-updates.md) |
| AI 错误处理 | 处理输出 token 限制超限，提示 agent 将工作拆分为更小的块 | 6 | 10 | [规格](core/ai-error-handling.md) |
| 工具权限系统 | 权限系统，支持模式、通配符、拒绝规则、信任、acceptEdits、dontAsk、安全区 | 18 | 54 | [规格](core/tool-permission-system.md) |
| Plan 模式 | Shift+Tab plan 模式，只读分析并增量编辑 plan 文件 | 9 | 29 | [规格](core/plan-mode.md) |

### 交互与 UI

| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |
|------|------|----------|----------|------|
| 会话管理 | 高性能、基于项目的会话管理系统 | 4 | 23 | [规格](ui/session-management.md) |
| Markdown 渲染 | 终端 Markdown 渲染，Ink 组件支持标题、列表、代码块、表格 | 3 | 8 | [规格](ui/markdown-rendering-system.md) |
| 消息渲染 | 基于 Ink 的消息/块渲染——静态历史 + 动态工具执行 | 5 | 19 | [规格](ui/message-rendering-system.md) |
| 图片粘贴 | 从剪贴板粘贴图片到聊天输入，支持占位符和附件 | 3 | 10 | [规格](ui/image-pasting.md) |
| 文件选择器 | 快速文件/目录选择器 UI 组件 | 4 | 18 | [规格](ui/file-selector.md) |
| 长文本占位符 | 用 `[LongText#ID]` 占位符替换粘贴的长文本，提交时展开 | 1 | 5 | [规格](ui/long-text-placeholder.md) |
| 确认 UI | 工具权限审批的确认对话框 UI 组件 | 6 | 17 | [规格](ui/confirm-ui.md) |
| AskUserQuestion 工具 | 结构化用户交互工具，支持选项 | 3 | 11 | [规格](ui/ask-user-tool.md) |
| Clear 命令 | `/clear` 命令重置对话历史和会话 | 2 | 6 | [规格](ui/clear-command.md) |
| Rewind 命令 | `/rewind` 回退对话到上一条用户消息，同时回退文件变更 | 3 | 10 | [规格](ui/rewind-command.md) |
| Print 模式 | `-p` 模式下的纯净响应输出，抑制所有子代理内部信息 | 4 | 10 | [规格](ui/print-mode.md) |
| 工具选择 | CLI `--tools` 标志限制 agent 使用特定工具集 | 4 | 8 | [规格](ui/tools-selection.md) |
| 斜杠命令 | 用户可调用的自定义斜杠命令系统 | 6 | 22 | [规格](ui/slash-commands.md) |
| Bang Shell 命令 | `!` 前缀直接从聊天输入执行 shell 命令 | 3 | 9 | [规格](ui/bang-shell-command.md) |
| Help 命令 | `/help` 交互式帮助，显示快捷键、内置命令和插件命令 | 3 | 10 | [规格](ui/help-command.md) |
| Model 命令 | `/model` 交互式 UI 切换已配置的 AI 模型 | 3 | 13 | [规格](ui/model-command.md) |
| BTW 命令 | `/btw` 旁路问题，绕过主消息队列 | 2 | 10 | [规格](ui/btw-command.md) |
| 状态栏 | 提取的 StatusLine 组件，用于模式和 shell 命令状态显示 | 2 | 10 | [规格](ui/status-line.md) |
| Status 命令 | `/status` 显示版本、会话 ID、cwd、模型和运行时信息 | 1 | 9 | [规格](ui/status-command.md) |
| Update 命令 | `wave update` / `wave-code update` 更新到最新版本 | 2 | 7 | [规格](ui/update-command.md) |
| 历史搜索 | Ctrl+R 历史搜索，复用 `~/.wave/history.jsonl` 中的历史提示 | 2 | 10 | [规格](ui/history-search-prompt.md) |
| Stdio 传输层 | 编辑器插件与 `wave --stdio` 子进程的 JSON-RPC 通信，CLI 解析/安装/升级、多会话路由、错误诊断 | 8 | 54 | [规格](ui/stdio-transport.md) |
| IDE 插件 | VS Code/JetBrains 共享 React webview 的横切关注点：主题变量、共享包与构建产物、生命周期与消息协议、IDE 专属对话框 | 4 | 23 | [规格](ui/ide-plugin.md) |
| Wave Desktop（Electron 桌面应用） |  | 9 | 25 | [规格](ui/desktop-app.md) |

### 多 Agent 与并发

| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |
|------|------|----------|----------|------|
| 子代理 | 将任务委派给预配置 AI 人格的子代理支持 | 5 | 25 | [规格](multi-agent/subagent.md) |
| 内置子代理 | Explore agent 内置子代理支持 | 2 | 10 | [规格](multi-agent/builtin-subagent.md) |
| 通用代理 | 内置子代理，用于复杂研究、代码搜索和多步骤任务 | 2 | 7 | [规格](multi-agent/general-purpose-agent.md) |
| Plan 子代理 | 内置 Plan 子代理，在编码前设计实现方案 | 4 | 16 | [规格](multi-agent/plan-subagent.md) |
| Bash 子代理 | 内置 Bash 子代理，执行 shell 命令 | 1 | 7 | [规格](multi-agent/bash-subagent.md) |
| 任务后台执行 | `run_in_background`、`TaskOutput`/`TaskStop` 工具，`/tasks` 命令替代 `/bashes` | 7 | 42 | [规格](multi-agent/task-background-execution.md) |
| 任务管理工具 | TaskCreate/TaskGet/TaskUpdate/TaskList，`~/.wave/tasks/` 存储和任务列表 UI | 6 | 35 | [规格](multi-agent/task-management-tools.md) |
| Workflow 编排 | 确定性多子代理编排，支持 pipeline、parallel 和 phase 控制流 | 5 | 29 | [规格](multi-agent/workflow.md) |
| CLI Worktree | `-w/--worktree` 隔离的 git worktree，位于 `.wave/worktrees/`，支持安全退出 | 9 | 46 | [规格](multi-agent/worktree.md) |

### 扩展与生态

| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |
|------|------|----------|----------|------|
| Agent 技能 | 可发现的技能包，通过 SKILL.md 文件提供模型可调用的能力 | 8 | 26 | [规格](ecosystem/agent-skills.md) |
| 内置 Settings 技能 | 引导用户配置 `settings.json`、钩子和 Wave 设置管理 | 3 | 8 | [规格](ecosystem/builtin-settings-skill.md) |
| Init 命令 | `/init` 斜杠命令，使用 init-prompt.md 进行项目初始化 | 2 | 7 | [规格](ecosystem/init-slash-command.md) |
| Code Review 技能 | 审查当前 `git diff` 的正确性 bug，附带文件/行号引用 | 5 | 27 | [规格](ecosystem/code-review-skill.md) |
| Simplify 技能 | 审查已变更代码的质量问题（重复、低效）并通过 `/simplify` 自动修复 | 3 | 14 | [规格](ecosystem/simplify-skill.md) |
| MCP | Model Context Protocol 外部工具和上下文源支持 | 4 | 26 | [规格](ecosystem/mcp.md) |
| 插件系统 | 插件系统，支持 marketplace、作用域、技能、LSP、MCP、钩子、代理 | 7 | 36 | [规格](ecosystem/plugin.md) |

### 自动化

| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |
|------|------|----------|----------|------|
| 钩子系统 | 扩展 Wave 行为的事件钩子系统 | 18 | 66 | [规格](automation/hooks.md) |
| Loop 命令 | `/loop` 通过 cron 调度循环提示（如 `/loop 5m check the build`），支持持久化和多会话调度锁 | 2 | 10 | [规格](automation/loop-slash-command.md) |
| /goal 命令 | 自主多轮目标追求，快速模型评估和熔断机制 | 3 | 17 | [规格](automation/goal-command.md) |

### 企业管控

| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |
|------|------|----------|----------|------|
| SSO 认证 | /login 浏览器 SSO 登录、token 存储、自动 API 代理路由 | 5 | 37 | [规格](enterprise/sso-auth.md) |
| 服务端托管配置 | 从 Wave AI 下载并应用托管设置，支持校验和缓存和合并优先级 | 3 | 11 | [规格](enterprise/server-managed-config.md) |
| OpenTelemetry 集成 | OpenTelemetry 指标、追踪和日志插桩，支持多种导出器（jsonl、OTLP） | 3 | 16 | [规格](enterprise/opentelemetry.md) |
| 用量追踪 | SDK 用量追踪回调（`onUsagesChange`），用于 AI 调用和压缩 | 4 | 15 | [规格](enterprise/usage-tracking-callback.md) |

## 上下文消息结构总览

发送给 AI 模型的 `messages` 数组按以下顺序组装：

| 位置 | 角色 | 内容 | 缓存标记 | 持久化 | 用户可见 | 说明 |
|------|------|------|----------|--------|----------|------|
| [0] | system | 基础系统提示词 + 任务执行准则 + 行动准则 + 工具策略 + 输出效率 + 语气风格 | 有 | 不持久化 | 否 | 子代理替换基础系统提示词，其余相同 |
| | | 语言指令 + `<env>` 环境信息 + 自动记忆 (MEMORY.md) | 无 | 不持久化 | 否 | |
| [1] | user (meta) | `<system-reminder>`: 项目 AGENTS.md + 用户 AGENTS.md + 无条件规则 | 无 | 不持久化，每轮插入头部 | 否 | 唯一每轮注入 |
| 历史 | user / assistant / tool | 文本块 / 图片块 / 工具块 / 后台任务通知块 / 推理块 | 最后一条有 | 持久化到 session JSONL | 是 | |
| | user (isMeta) | 计划模式提醒 / 条件规则 / 任务提醒 / Goal 消息 / SessionStart Hook 上下文 / 后台任务通知 / Token 限制续写 | 同上 | 同上 | 否 | 触发时插入当时的结尾，各类型有独立触发条件 |

**专用调用**（独立系统提示词，不经过主系统提示词组装）：压缩、网页内容提取、BTW 旁路问题、Goal 评估、Workflow 结构化输出。
