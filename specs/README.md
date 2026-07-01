# 功能规格说明

本目录包含功能规格说明文件，作为功能设计和实现的唯一真实来源。

每个规格是一个独立的 markdown 文件（`NNN-功能名称.md`），包含用户故事、验收标准和功能需求。

## 为什么没有 Plan？

Wave Agent 和 Claude Code 的内置 Plan 与 Task 能力已经足够完善，不再需要单独维护 plan/research/data-model/tasks 等工作流文档：

1. **内置能力足够强大。** Plan 模式结合权限系统控制读写范围，Task 系统对多 Agent 协作友好且自带系统提示防止上下文丢失。
2. **无法仅靠思考设计出完美方案。** 边界情况、API 怪癖、集成问题只有在实现中才会暴露，静态 plan 注定频繁改动、迅速过时，不如交给 Agent 用完即弃。

取而代之，依赖**大量测试**来驱动正确的实现。先写规格，再写测试，然后实现。

## 统计

| 指标 | 数量 |
|------|------|
| 规格文件 | 59 |
| 用户故事 | 252 |
| 功能需求 | 971 |
| 测试文件 | 317 |
| 测试用例 | 4,143 |

## 规格列表

| 功能 | 描述 | 用户故事 | 功能需求 | 链接 |
|------|------|----------|----------|------|
| 文件系统工具 | Read, Write, Edit, Glob, Grep 文件操作工具 | 3 | 19 | [规格](001-fs-tools.md) |
| Bash 工具 | Bash, BashOutput, KillBash shell 命令执行工具 | 3 | 18 | [规格](002-bash-tools.md) |
| MCP | Model Context Protocol 外部工具和上下文源支持 | 4 | 23 | [规格](003-mcp.md) |
| 会话管理 | 高性能、基于项目的会话管理系统 | 3 | 17 | [规格](004-session-management.md) |
| 钩子系统 | 扩展 Wave 行为的事件钩子系统 | 16 | 62 | [规格](005-hooks.md) |
| Agent 技能 | 可发现的技能包，通过 SKILL.md 文件提供模型可调用的能力 | 8 | 25 | [规格](006-agent-skills.md) |
| Agent 配置 | 基于构造函数的配置替代环境变量，支持 max output tokens 和自定义 headers | 9 | 32 | [规格](007-agent-config.md) |
| 斜杠命令 | 用户可调用的自定义斜杠命令系统 | 6 | 22 | [规格](008-slash-commands.md) |
| 子代理 | 将任务委派给预配置 AI 人格的子代理支持 | 5 | 24 | [规格](009-subagent.md) |
| 用量追踪 | SDK 用量追踪回调（`onUsagesChange`），用于 AI 调用和压缩 | 4 | 15 | [规格](010-usage-tracking-callback.md) |
| 流式输出 | 助手消息和工具参数的实时内容流式传输 | 5 | 22 | [规格](011-stream-content-updates.md) |
| AI 错误处理 | 处理输出 token 限制超限，提示 agent 将工作拆分为更小的块 | 6 | 10 | [规格](012-ai-error-handling.md) |
| 消息压缩 | 对话历史和用户输入大小管理 | 6 | 23 | [规格](013-message-compact.md) |
| 图片粘贴 | 从剪贴板粘贴图片到聊天输入，支持占位符和附件 | 3 | 10 | [规格](014-image-pasting.md) |
| 文件选择器 | 快速文件/目录选择器 UI 组件 | 3 | 8 | [规格](015-file-selector.md) |
| WebFetch 工具 | 获取 URL 内容，HTML 转 markdown，AI 模型处理，支持缓存 | 5 | 14 | [规格](016-web-fetch-tool.md) |
| 记忆管理 | 通过记忆文件在对话间持久化信息 | 8 | 26 | [规格](017-memory-management.md) |
| Markdown 渲染 | 终端 Markdown 渲染，Ink 组件支持标题、列表、代码块、表格 | 3 | 8 | [规格](018-markdown-rendering-system.md) |
| Prompt 缓存控制 | Claude 模型的 `cache_control` 标记，用于系统消息、用户消息和工具 | 4 | 7 | [规格](019-prompt-cache-control.md) |
| Prompt 工程 | Prompt 构建和管理框架 | 5 | 13 | [规格](020-prompt-engineering.md) |
| 长文本占位符 | 用 `[LongText#ID]` 占位符替换粘贴的长文本，提交时展开 | 1 | 5 | [规格](021-long-text-placeholder.md) |
| 工具权限系统 | 权限系统，支持模式、通配符、拒绝规则、信任、acceptEdits、dontAsk、安全区 | 18 | 55 | [规格](022-tool-permission-system.md) |
| 内置子代理 | Explore agent 内置子代理支持 | 2 | 10 | [规格](023-builtin-subagent.md) |
| Clear 命令 | `/clear` 命令重置对话历史和会话 | 2 | 6 | [规格](024-clear-command.md) |
| 消息渲染 | 基于 Ink 的消息/块渲染——静态历史 + 动态工具执行 | 3 | 8 | [规格](025-message-rendering-system.md) |
| Bang Shell 命令 | `!` 前缀直接从聊天输入执行 shell 命令 | 3 | 9 | [规格](026-bang-shell-command.md) |
| Help 命令 | `/help` 交互式帮助，显示快捷键、内置命令和插件命令 | 3 | 10 | [规格](027-help-command.md) |
| 状态栏 | 提取的 StatusLine 组件，用于模式和 shell 命令状态显示 | 2 | 10 | [规格](028-status-line.md) |
| Update 命令 | `wave update` / `wave-code update` 更新到最新版本 | 2 | 7 | [规格](029-update-command.md) |
| BTW 命令 | `/btw` 旁路问题，绕过主消息队列 | 2 | 10 | [规格](030-btw-command.md) |
| Model 命令 | `/model` 交互式 UI 切换已配置的 AI 模型 | 3 | 13 | [规格](031-model-command.md) |
| 确认 UI | 工具权限审批的确认对话框 UI 组件 | 5 | 13 | [规格](032-confirm-ui.md) |
| Print 模式 | `-p` 模式下的纯净响应输出，抑制所有子代理内部信息 | 3 | 7 | [规格](033-print-mode.md) |
| LSP 集成 | Language Server Protocol 代码智能（定义跳转、引用查找、悬停信息） | 3 | 8 | [规格](034-lsp-integration.md) |
| 插件系统 | 插件系统，支持 marketplace、作用域、技能、LSP、MCP、钩子、代理 | 6 | 28 | [规格](035-plugin.md) |
| Plan 模式 | Shift+Tab plan 模式，只读分析并增量编辑 plan 文件 | 8 | 25 | [规格](036-plan-mode.md) |
| AskUserQuestion 工具 | 结构化用户交互工具，支持选项 | 3 | 11 | [规格](037-ask-user-tool.md) |
| Init 命令 | `/init` 斜杠命令，使用 init-prompt.md 进行项目初始化 | 2 | 7 | [规格](038-init-slash-command.md) |
| Rewind 命令 | `/rewind` 回退对话到上一条用户消息，同时回退文件变更 | 3 | 10 | [规格](039-rewind-command.md) |
| 历史搜索 | Ctrl+R 历史搜索，复用 `~/.wave/history.jsonl` 中的历史提示 | 2 | 10 | [规格](040-history-search-prompt.md) |
| 通用代理 | 内置子代理，用于复杂研究、代码搜索和多步骤任务 | 2 | 7 | [规格](041-general-purpose-agent.md) |
| 任务后台执行 | `run_in_background`、`TaskOutput`/`TaskStop` 工具，`/tasks` 命令替代 `/bashes` | 6 | 24 | [规格](042-task-background-execution.md) |
| 任务管理工具 | TaskCreate/TaskGet/TaskUpdate/TaskList，`~/.wave/tasks/` 存储和任务列表 UI | 5 | 22 | [规格](043-task-management-tools.md) |
| Plan 子代理 | 内置 Plan 子代理，在编码前设计实现方案 | 4 | 16 | [规格](044-plan-subagent.md) |
| Bash 子代理 | 内置 Bash 子代理，执行 shell 命令 | 1 | 7 | [规格](045-bash-subagent.md) |
| 工具选择 | CLI `--tools` 标志限制 agent 使用特定工具集 | 4 | 8 | [规格](046-tools-selection.md) |
| CLI Worktree | `-w/--worktree` 隔离的 git worktree，位于 `.wave/worktrees/`，支持安全退出 | 7 | 40 | [规格](047-worktree.md) |
| Status 命令 | `/status` 显示版本、会话 ID、cwd、模型和运行时信息 | 1 | 9 | [规格](048-status-command.md) |
| ACP Bridge | Agent Communication Protocol 桥接，用于连接外部客户端 | 5 | 17 | [规格](049-acp-bridge.md) |
| 内置 Settings 技能 | 引导用户配置 `settings.json`、钩子和 Wave 设置管理 | 3 | 8 | [规格](050-builtin-settings-skill.md) |
| Loop 命令 | `/loop` 通过 cron 调度循环提示（如 `/loop 5m check the build`），支持持久化和多会话调度锁 | 2 | 10 | [规格](051-loop-slash-command.md) |
| OpenTelemetry 集成 | OpenTelemetry 指标、追踪和日志插桩，支持多种导出器（jsonl、OTLP） | 3 | 16 | [规格](052-opentelemetry.md) |
| SSO 认证 | /login 浏览器 SSO 登录、token 存储、自动 API 代理路由 | 3 | 27 | [规格](053-sso-auth.md) |
| 自定义工具 buildTool() | buildTool() 工厂方法，供 SDK 用户定义自定义工具 | 3 | 11 | [规格](054-custom-tools.md) |
| 服务端托管配置 | 从 Wave AI 下载并应用托管设置，支持校验和缓存和合并优先级 | 3 | 11 | [规格](055-server-managed-config.md) |
| /goal 命令 | 自主多轮目标追求，快速模型评估和熔断机制 | 3 | 17 | [规格](056-goal-command.md) |
| Workflow 编排 | 确定性多子代理编排，支持 pipeline、parallel 和 phase 控制流 | 4 | 20 | [规格](057-workflow.md) |
| Code Review 技能 | 审查当前 `git diff` 的正确性 bug，附带文件/行号引用 | 5 | 27 | [规格](058-code-review-skill.md) |
| Simplify 技能 | 审查已变更代码的质量问题（重复、低效）并通过 `/simplify` 自动修复 | 3 | 14 | [规格](059-simplify-skill.md) |
