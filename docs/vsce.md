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

## AI 核心能力

所有操作和 AI 能力与桌面端保持同步，详见 [桌面端产品文档](/desktop)。

## 画廊

### 1. 核心聊天体验

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-welcome.webp" alt="欢迎页" /><figcaption>欢迎页</figcaption></figure>

<figure><img src="/screenshots/spec-welcome-login.webp" alt="未登录欢迎页" /><figcaption>未登录欢迎页</figcaption></figure>

<figure><img src="/screenshots/spec-basic-chat.webp" alt="基础对话" /><figcaption>基础对话</figcaption></figure>

<figure><img src="/screenshots/spec-reasoning.webp" alt="AI 思考过程" /><figcaption>AI 思考过程</figcaption></figure>

<figure><img src="/screenshots/spec-sticky-user-message.webp" alt="用户消息吸顶" /><figcaption>用户消息吸顶</figcaption></figure>

</div>

### 2. 智能输入与上下文

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-queue-collapsed.webp" alt="消息队列（收起）" /><figcaption>消息队列（收起）</figcaption></figure>

<figure><img src="/screenshots/spec-queued-message.webp" alt="消息队列（展开）" /><figcaption>消息队列（展开）</figcaption></figure>

<figure><img src="/screenshots/spec-queue-editing.webp" alt="编辑队列消息" /><figcaption>编辑队列消息</figcaption></figure>

<figure><img src="/screenshots/spec-plus-menu.webp" alt="通过&quot;+&quot;菜单打开历史提示词" /><figcaption>通过&quot;+&quot;菜单打开历史提示词</figcaption></figure>

<figure><img src="/screenshots/spec-history-search.webp" alt="历史提示词弹窗" /><figcaption>历史提示词弹窗</figcaption></figure>

<figure><img src="/screenshots/spec-selection-inline-tag.webp" alt="输入框中的代码选中标签" /><figcaption>输入框中的代码选中标签</figcaption></figure>

<figure><img src="/screenshots/spec-slash-commands.webp" alt="指令系统" /><figcaption>指令系统</figcaption></figure>

<figure><img src="/screenshots/spec-model-popup.webp" alt="模型选择菜单" /><figcaption>模型选择菜单</figcaption></figure>

<figure><img src="/screenshots/spec-file-suggestions.webp" alt="文件建议下拉列表" /><figcaption>文件建议下拉列表</figcaption></figure>

<figure><img src="/screenshots/spec-inline-mentions.webp" alt="输入框中的内联标签" /><figcaption>输入框中的内联标签</figcaption></figure>

<figure><img src="/screenshots/spec-image-preview.webp" alt="图片全屏预览模态框" /><figcaption>图片全屏预览模态框</figcaption></figure>

<figure><img src="/screenshots/spec-message-inline-tags.webp" alt="消息列表中的内联标签" /><figcaption>消息列表中的内联标签</figcaption></figure>

<figure><img src="/screenshots/bash-mode-success.webp" alt="Bash 模式命令执行成功" /><figcaption>Bash 模式命令执行成功</figcaption></figure>

<figure><img src="/screenshots/bash-mode-long-output.webp" alt="长输出展示" /><figcaption>长输出展示</figcaption></figure>

<figure><img src="/screenshots/spec-input-empty.webp" alt="输入框（空态）" /><figcaption>输入框（空态）</figcaption></figure>

<figure><img src="/screenshots/spec-input-focus.webp" alt="输入框（聚焦态）" /><figcaption>输入框（聚焦态）</figcaption></figure>

<figure><img src="/screenshots/spec-input-multiline.webp" alt="输入框（多行）" /><figcaption>输入框（多行）</figcaption></figure>

<figure><img src="/screenshots/spec-btw-panel.webp" alt="旁路提问面板" /><figcaption>旁路提问面板</figcaption></figure>

<figure><img src="/screenshots/spec-btw-usage.webp" alt="旁路提问使用提示" /><figcaption>旁路提问使用提示</figcaption></figure>

</div>

### 3. 代码理解与操作

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-bash.webp" alt="终端工具" /><figcaption>终端工具</figcaption></figure>

<figure><img src="/screenshots/spec-exploration.webp" alt="文件探索" /><figcaption>文件探索</figcaption></figure>

<figure><img src="/screenshots/spec-file-ops.webp" alt="文件操作" /><figcaption>文件操作</figcaption></figure>

<figure><img src="/screenshots/spec-diff-viewer.webp" alt="文件差异对比" /><figcaption>文件差异对比</figcaption></figure>

<figure><img src="/screenshots/spec-lsp.webp" alt="LSP 智能" /><figcaption>LSP 智能</figcaption></figure>

<figure><img src="/screenshots/spec-vision.webp" alt="视觉理解" /><figcaption>视觉理解</figcaption></figure>

</div>

### 4. 权限与安全

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-permission-mode-default.webp" alt="权限模式 - 默认" /><figcaption>权限模式 - 默认</figcaption></figure>

<figure><img src="/screenshots/spec-permission-mode-accept.webp" alt="权限模式 - 自动接受修改" /><figcaption>权限模式 - 自动接受修改</figcaption></figure>

<figure><img src="/screenshots/spec-permission-mode-plan.webp" alt="权限模式 - 计划模式" /><figcaption>权限模式 - 计划模式</figcaption></figure>

<figure><img src="/screenshots/spec-edit-confirm.webp" alt="代码修改确认" /><figcaption>代码修改确认</figcaption></figure>

<figure><img src="/screenshots/spec-bash-confirm.webp" alt="命令执行确认" /><figcaption>命令执行确认</figcaption></figure>

<figure><img src="/screenshots/spec-mcp-tool-confirm.webp" alt="MCP 工具确认" /><figcaption>MCP 工具确认</figcaption></figure>

<figure><img src="/screenshots/spec-plan-confirm.webp" alt="计划执行确认" /><figcaption>计划执行确认</figcaption></figure>

<figure><img src="/screenshots/spec-enter-plan-mode.webp" alt="进入计划模式确认" /><figcaption>进入计划模式确认</figcaption></figure>

<figure><img src="/screenshots/spec-ask-user.webp" alt="交互式提问表单" /><figcaption>交互式提问表单</figcaption></figure>

<figure><img src="/screenshots/spec-ask-user-multi.webp" alt="交互式提问（多个问题轮播）" /><figcaption>交互式提问（多个问题轮播）</figcaption></figure>

<figure><img src="/screenshots/spec-ask-user-multiselect.webp" alt="交互式提问（多选）" /><figcaption>交互式提问（多选）</figcaption></figure>

<figure><img src="/screenshots/ask-user-question-vertical.webp" alt="交互式提问结果（垂直布局）" /><figcaption>交互式提问结果（垂直布局）</figcaption></figure>

<figure><img src="/screenshots/tool-error-scrollable.webp" alt="工具执行错误" /><figcaption>工具执行错误</figcaption></figure>

<figure><img src="/screenshots/error-block-scrollable.webp" alt="通用错误消息" /><figcaption>通用错误消息</figcaption></figure>

</div>

### 5. 任务管理

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-task-list.webp" alt="任务列表（展开状态）" /><figcaption>任务列表（展开状态）</figcaption></figure>

<figure><img src="/screenshots/spec-task-list-collapsed.webp" alt="任务列表（折叠状态）" /><figcaption>任务列表（折叠状态）</figcaption></figure>

<figure><img src="/screenshots/spec-background-task-list.webp" alt="后台任务管理 - 列表" /><figcaption>后台任务管理 - 列表</figcaption></figure>

<figure><img src="/screenshots/spec-background-task-detail.webp" alt="后台任务管理 - 详情" /><figcaption>后台任务管理 - 详情</figcaption></figure>

<figure><img src="/screenshots/spec-workflow-list.webp" alt="工作流管理 - 列表" /><figcaption>工作流管理 - 列表</figcaption></figure>

<figure><img src="/screenshots/spec-workflow-detail.webp" alt="工作流管理 - 详情" /><figcaption>工作流管理 - 详情</figcaption></figure>

</div>

### 6. 多 Agents 与并发

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-agents-list.webp" alt="Agents - 列表" /><figcaption>Agents - 列表</figcaption></figure>

<figure><img src="/screenshots/spec-agents-detail.webp" alt="Agents - 详情" /><figcaption>Agents - 详情</figcaption></figure>

<figure><img src="/screenshots/spec-skills-list.webp" alt="技能 - 列表" /><figcaption>技能 - 列表</figcaption></figure>

<figure><img src="/screenshots/spec-subagent-concurrency.webp" alt="并发子代理" /><figcaption>并发子代理</figcaption></figure>

<figure><img src="/screenshots/spec-background-subagent.webp" alt="后台运行子代理" /><figcaption>后台运行子代理</figcaption></figure>

<figure><img src="/screenshots/spec-chat-header.webp" alt="标题栏与工具栏" /><figcaption>标题栏与工具栏</figcaption></figure>

<figure><img src="/screenshots/spec-worktree-enter.webp" alt="创建 Worktree" /><figcaption>创建 Worktree</figcaption></figure>

</div>

### 7. 能力扩展

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-subagent.webp" alt="子代理状态" /><figcaption>子代理状态</figcaption></figure>

<figure><img src="/screenshots/spec-skill.webp" alt="Skill 系统" /><figcaption>Skill 系统</figcaption></figure>

<figure><img src="/screenshots/spec-mcp.webp" alt="MCP 集成" /><figcaption>MCP 集成</figcaption></figure>

<figure><img src="/screenshots/spec-mcp-server-tab.webp" alt="MCP 服务器管理" /><figcaption>MCP 服务器管理</figcaption></figure>

</div>

### 8. 会话与持久化

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-rewind-button.webp" alt="用户消息上的回滚按钮" /><figcaption>用户消息上的回滚按钮</figcaption></figure>

<figure><img src="/screenshots/spec-rewind-popup.webp" alt="/rewind 检查点列表" /><figcaption>/rewind 检查点列表</figcaption></figure>

<figure><img src="/screenshots/spec-confirm-rewind.webp" alt="回滚确认对话框" /><figcaption>回滚确认对话框</figcaption></figure>

<figure><img src="/screenshots/spec-session-search.webp" alt="历史对话搜索与关键词高亮" /><figcaption>历史对话搜索与关键词高亮</figcaption></figure>

<figure><img src="/screenshots/spec-more-menu.webp" alt="更多菜单" /><figcaption>更多菜单</figcaption></figure>

</div>

### 9. 配置管理

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-status-dialog.webp" alt="状态信息" /><figcaption>状态信息</figcaption></figure>

</div>

### 10. 插件系统

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-plugin-explore.webp" alt="探索新插件（支持关键词搜索）" /><figcaption>探索新插件（支持关键词搜索）</figcaption></figure>

<figure><img src="/screenshots/plugin-search-filtered.webp" alt="关键词过滤效果" /><figcaption>关键词过滤效果</figcaption></figure>

<figure><img src="/screenshots/spec-plugin-installed.webp" alt="已激活插件管理" /><figcaption>已激活插件管理</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-plugin.webp" alt="内置 SDD 插件开关（项目设置）" /><figcaption>内置 SDD 插件开关（项目设置）</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-workflow-spec.webp" alt="规格编写阶段" /><figcaption>规格编写阶段</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-confirm-spec.webp" alt="规格决策" /><figcaption>规格决策</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-plan-preview-tab.webp" alt="技术方案预览" /><figcaption>技术方案预览</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-plan-approve.webp" alt="计划批准交互" /><figcaption>计划批准交互</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-tasklist-progress.webp" alt="编码阶段任务列表" /><figcaption>编码阶段任务列表</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-iterate-update.webp" alt="迭代需求-更新规格" /><figcaption>迭代需求-更新规格</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-iterate-confirm.webp" alt="迭代需求-规格确认" /><figcaption>迭代需求-规格确认</figcaption></figure>

<figure><img src="/screenshots/spec-sdd-iterate-continue.webp" alt="迭代需求-继续实现" /><figcaption>迭代需求-继续实现</figcaption></figure>

</div>
