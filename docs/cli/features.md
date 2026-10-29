---
title: 特色功能
description: 安全区域、worktree、会话恢复、图像输入等 CLI 专有能力的用法
---

# 特色功能

## Bash 模式 {#bash-mode}

在输入框中以 `!` 开头直接执行 Shell 命令，无需离开聊天界面。

```bash
!ls -la
!git status
!npm test
```

命令以 user 消息 + bash tool block 形态显示在消息流中，输出实时显示、全量展示；失败时在输出前标注 `[exit code: N]`。长时间运行的命令支持随时中止。

## BTW 旁路提问 {#btw}

`/btw <question>` 向 AI 快速提问，AI 不会调用任何工具，仅基于已有上下文直接回答。适合快速确认思路或获取解释，不产生工具调用开销。

```
/btw 这个函数的时间复杂度是多少？
```

回答期间显示 `✻ Answering` 加载提示，其后实时展示当前流式文本的最后 30 个字符（超出截断、换行折叠），按 `Esc` 可中止请求。

回答较长时显示在固定高度的视口中，用 `↑`/`↓`（或 `Ctrl+P`/`Ctrl+N`）每次滚动 3 行，按 `Esc` 关闭。

## Git Worktree {#worktree}

通过 `--worktree` 在隔离的 git worktree 中启动，安全实验新功能而不影响主分支。

```bash
wave -w my-feature
```

在交互模式中也可通过内置工具 `EnterWorktree` 切换到 worktree。

在退出对话框选择 "Remove worktree"（或打印模式 `-p` 正常退出清理、`WorktreeRemove` hook 接管）删除 worktree 时，会显示 `Deleting worktree ...` 进度提示，完成后显示 `Done.`；删除失败显示错误信息而非完成提示。选择 "Keep worktree" 保留时无提示。

## Compact 压缩 {#compact}

`/compact` 压缩当前对话历史，将冗长的上下文总结为精简摘要，减少后续请求的 Token 占用。支持附加自定义指令引导压缩方向。

```
/compact 重点保留 API 设计相关的讨论
```

压缩进行中消息列表下方显示 `✻ Compacting` 提示，其后实时展示当前流式文本的最后 30 个字符（超出截断、换行折叠），压缩完成后提示消失。

## Rewind 回滚 {#rewind}

`/rewind` 将对话回滚到历史检查点，撤销后续的对话记录和文件更改。

## 图片粘贴 {#image-paste}

按 `Ctrl+V` 粘贴剪贴板中的图片，支持跨平台（macOS、Linux、Windows）。AI 可识别截图中的 UI 设计、错误信息或架构图。Windows 终端将 `Ctrl+V` 保留为系统文本粘贴，按键不会到达 CLI，因此 Windows 下使用 `Alt+V`（与 Claude Code 一致）。

## MCP 集成 {#mcp}

通过 `/mcp` 管理 MCP（Model Context Protocol）服务器连接，扩展 AI 的外部工具能力。支持在项目根目录的 `.mcp.json` 中配置，或通过 `--mcp-config` 命令行传入。

## 插件系统 {#plugin}

通过插件扩展 AI 的 Skill 和命令。支持插件市场的发现、安装和管理，插件可在 user、project、local 三种作用域下激活。

详见 [第 3.1 节 插件管理](./subcommands#plugin-commands)。

## Workflow 工作流 {#workflow}

通过 `/workflows` 查看和管理正在运行的工作流。工作流支持多阶段编排、并行执行和确定性控制流。

## 后台任务 {#background-tasks}

通过 `/tasks` 查看后台任务列表，或通过 `Ctrl+B` 将当前前台任务放到后台执行。支持 shell 命令和子代理两种任务类型，任务完成后自动通知。

## SSO 认证 {#sso}

通过 `/login` 进行企业 SSO 认证，授权码通过 localhost 回调自动交换为 JWT。登录后 API 请求自动通过 Wave AI 服务端代理路由，无需手动配置 API Key。通过 `/logout` 清除认证状态。

## 会话管理 {#session-management}

支持多会话的创建、恢复和管理：

```bash
wave              # 启动新会话
wave -c           # 继续上次会话
wave -r           # 列出可恢复的会话
wave -r <id>      # 恢复指定会话
```

会话文件的元数据头持久化真实的创建时间、工作目录与 git 分支；`wave -r` 选择器中会话行尾显示 git 分支标签（如 `[main]`），多 worktree 场景下可区分同仓库不同分支的会话。

## 附加工作目录 {#additional-working-directories}

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

## Token 用量统计 {#token-stats}

在打印模式下配合 `--show-stats` 使用，输出结果末尾显示耗时和 Token 用量统计信息。

```bash
wave -p --show-stats "分析这个项目的依赖关系"
```

## 会话内热切换 {#resume}

`/resume` 在 TUI 内打开会话选择器，切换到另一段对话，不必退出进程重开：

```
/resume
```

选择器与 `wave -r` 共用同一组件与同一套会话归属判定（`↑` `↓` 选择、`Enter` 确认、`Esc` 取消）：

- **范围**：默认列出当前目录的会话；`Ctrl+W` 展开同仓库的全部 worktree（含主仓库），`Ctrl+A` 展开全部项目——展开时行尾显示会话所属项目路径。
- **原地恢复**：选中当前目录的会话即原地恢复，工作目录不变。
- **自动切换工作目录**：选中同仓库其它 worktree 的会话时直接恢复，并把会话转录文件、项目规则与记忆改按该目录解析。
- **跨项目**：选中其它项目的会话时不在当前进程恢复，选择器内显示可复制的 `cd <路径> && wave --restore <sessionId>`（同时写入剪贴板），按 `Esc` 返回——关闭提示后原会话与内容不受影响。目标 worktree 目录已被删除时按同样方式处理。
- **运行中**：正在生成回复时按 `/resume` 提示 `Cannot resume a conversation while the agent is running.`（`Esc` 返回），不中断当前回合。
- **切换后**：当前会话先自动存盘，消息流、Token 用量与任务列表整体换成目标会话的状态，输入框草稿清空。
- **失败**：目标会话记录不存在或损坏时不切换，提示失败原因，当前会话保持可用。

切换会触发 `SessionEnd` / `SessionStart` 钩子（来源为 `resume`），与 `wave -r` 启动时一致。

## 会话重命名 {#rename}

给当前对话设一个自定义标题，替代默认的「首条用户消息截断」显示：

```
/rename 修复登录页样式
```

不带标题执行 `/rename` 只打印用法（`Usage: /rename <title>`），成功时回显 `Conversation renamed to "…".`。

会话选择器（`/resume` 与 `wave -r` 共用同一组件）里也能就地改名：`↑` / `↓` 选中某行后按 `Ctrl+R`，该行标题变成输入框并全选原标题，`Enter` 保存、`Esc` 取消——选择器内 `Ctrl+R` 是重命名，与输入框里的 `Ctrl+R`（搜索 Prompt 历史）互不冲突。

- **显示优先级**：自定义标题 > 首条用户消息截断（30 字符）> `新对话`；已设的自定义标题不会被后续消息按「首条消息」重新推导覆盖。
- **存储与一致性**：标题以 `custom-title` 保留条目追加在会话自己的 JSONL 文件里（唯一权威来源），因此 `wave -r`、插件端与桌面端读到的都是同一个标题。
- **空标题**：`trim` 后为空时只提示用法、不作改动（没有「清除标题」语义）。
- **失败**：写盘失败时报错并保持原标题不变（不静默）。
