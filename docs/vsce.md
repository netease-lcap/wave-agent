# VS Code 扩展 / JetBrains 插件使用文档

Wave 代码智聊是一款集成在 VS Code 与 JetBrains IDE（WebStorm、IntelliJ IDEA 等）中的 AI 辅助编程插件，两者共享同一聊天界面。本文档介绍插件的安装登录与差异化能力，其余 AI 能力与桌面端保持一致。

## 快速入门

### VS Code 扩展

在 VS Code 扩展市场搜索 **Wave Code Chat**（扩展 ID：`wave-codechat.wave-vscode`）安装。安装后可通过三种方式打开聊天面板：

- **侧边栏**：点击活动栏的 Wave 图标在侧边栏打开，或命令面板（`Cmd/Ctrl+Shift+P`）执行「在侧边栏打开代码智聊」。
- **新标签页**：执行「在新标签页打开代码智聊」，在编辑器区域以标签页形式打开，可与文件并排查看。
- **新窗口**：执行「在新窗口打开代码智聊」，在独立窗口打开，适合多显示器并行使用。

打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

![未登录欢迎页](/screenshots/spec-welcome-login.webp)

### JetBrains 插件

在 JetBrains 插件市场（IDE「设置 → 插件」）搜索 **Wave Code Chat** 安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

![欢迎页](/screenshots/spec-welcome.webp)

## AI 核心能力

所有操作和 AI 能力与桌面端保持同步，详见 [桌面端产品文档](/desktop)。

## 代码选择与引用

用户可以通过编辑器右键菜单中的"添加到 CodeWave"选项，将选中的代码手动添加到对话上下文中。选中的代码会以蓝色内联标签的形式插入到输入框当前光标位置。在消息历史中，点击该标签可快速跳转回编辑器中的对应文件及行号。

![输入框中的代码选中标签](/screenshots/spec-selection-inline-tag.webp)

![消息历史中的内联标签](/screenshots/spec-message-inline-tags.webp)

## 通过 Worktree 创建隔离环境

多个对话并行修改同一仓库时，直接在主线工作区改动容易互相冲突。此时可以让 AI 调用 `EnterWorktree` 工具，为每个对话创建独立的 git worktree——每个 worktree 拥有独立的分支与工作目录，互不影响。

在对话中直接以自然语言提出即可，例如：

> 把支付模块的重构放到独立的 worktree 里做，避免影响主线。

AI 会调用 `EnterWorktree` 工具，创建 `.wave/worktrees/<name>` 目录并将当前会话的工作目录切换到该 worktree：

![创建 Worktree](/screenshots/spec-worktree-enter.webp)

创建成功后，该对话的所有文件修改都会落在独立的 worktree 中，不会影响主线分支与其他对话。需要离开时，可要求 AI 调用 `ExitWorktree` 工具退出 worktree。

## 多对话并行

当需要并行推进多个任务时，可以同时开启多个对话，每个对话独立运行、互不干扰：

- **VS Code**：打开多个编辑器标签页（或独立窗口），每个标签页拥有独立的并行会话。
- **JetBrains**：在 Wave 工具窗口点击「+」按钮新建聊天标签页，多个标签页并行会话。

![标题栏与工具栏](/screenshots/spec-chat-header.webp)

多个对话并行处理同一仓库的不同任务时，为避免在主线工作区直接改动造成冲突，推荐结合 worktree 创建隔离环境使用。
