# VS Code 扩展使用文档

Wave 代码智聊是一款集成在 VS Code 中的 AI 辅助编程扩展，旨在通过强大的 AI 能力提升开发者的编码效率。本文档详细介绍了该产品的所有核心功能。

---

## 1. 核心聊天体验 {#core-chat-experience}

### 1.1 欢迎界面 {#welcome-interface}

当用户首次打开 Wave 代码智聊时，会看到亲切的欢迎信息，引导用户开始对话。

![欢迎界面](/screenshots/spec-welcome.png)
_欢迎界面_

### 1.2 基础对话 {#basic-chat}

支持 Markdown 格式的文本交互，能够生成带有语法高亮的代码块，方便用户直接阅读和复制。

![基础对话](/screenshots/spec-basic-chat.png)
_基础对话_

### 1.3 工具提示 (Tooltips) {#tooltips}

为了提供一致且可靠的用户体验，Wave 实现了自定义的工具提示组件。当用户将鼠标悬停在图标或特定元素上时，会显示功能说明文案。

**主要特性：**

- **智能定位**：工具提示会根据元素在屏幕上的位置自动选择最佳显示方向（如 `top-left`, `bottom-left` 等），确保文案始终在 Webview 边界内显示，避免被遮挡。
- **视觉一致性**：使用 VS Code 官方主题变量，完美适配深色和浅色模式。
- **覆盖全面**：涵盖了发送、停止、清除聊天、权限模式切换、设置以及文件标签等所有核心交互元素。

![发送按钮工具提示](/screenshots/tooltip-send.png)
_发送按钮工具提示_



---

## 2. 智能输入与上下文 {#intelligent-input-context}

Wave 提供了一个强大的富文本输入框，支持内联标签、指令补全和图片附件，让用户能够高效地构建复杂的上下文。

### 2.1 消息队列 {#message-queuing}

当 AI 正在处理当前请求并进行流式输出时，用户仍然可以发送新消息。这些消息会自动进入队列，并在当前任务完成后按顺序自动执行。

**主要特性：**

- **忙碌时发送**：在 AI 运行时，发送按钮会变为"加入队列"图标，点击即可将消息加入队列。
- **视觉反馈**：排队中的消息会显示在消息列表末尾，并带有"已排队"标识和半透明效果。**支持富文本渲染**，包括文件提及标签、代码选择标签和图片标签，且样式与主聊天窗口保持一致但更为紧凑。
- **自动执行**：当前任务完成后，下一条排队消息会自动开始处理，无需用户手动干预。
- **队列管理**：
  - **折叠面板**：消息队列以可折叠面板的形式固定在输入框上方，方便在消息较多时进行管理，且不会随聊天记录滚动。
  - **优先发送逻辑**：
    - 当任务不在运行时，新发送的消息将优先于队列中的消息执行。
    - 当任务在运行时，新消息将正常进入队列末尾。
  - **空输入发送**：当输入框为空且用户再次按下 `Enter` 键时，系统会自动发送队列中的第一条消息。
  - **立即发送图标**：队列中的第一条消息带有"播放"图标，点击可中止当前任务并立即发送该消息。
  - **删除单条消息**：点击排队消息右侧的垃圾桶图标，可将其从队列中移除。
  - **清空队列**：点击"清除聊天"会同时清空当前会话和所有排队消息。注意：手动点击"停止"按钮中止当前任务时，**不会**清空消息队列。

![加入队列按钮](/screenshots/spec-queue-button.png)
_加入队列按钮_

![已排队的消息](/screenshots/spec-queued-message.png)
_已排队的消息_


### 2.2 历史记录搜索 (History Search) {#history-search}

Wave 支持通过快捷键快速搜索并重用之前的 Prompt，提高交互效率。

**主要特性：**

- **快捷键触发**：在输入框中按下 `Ctrl+R` (或 `Cmd+R`) 即可弹出历史记录搜索界面。
- **实时过滤**：支持按关键词实时搜索历史记录，结果按时间倒序排列。
- **键盘导航**：支持使用上下箭头键选择记录，按下 `Enter` 键将选中的 Prompt 填入输入框。
- **智能拦截**：当焦点在聊天输入框时，`Ctrl+R` 和 `Ctrl+T` 等快捷键会被 Webview 优先拦截，防止触发 VS Code 的默认行为（如"打开最近项目"），确保流畅的聊天体验。

![历史记录搜索弹窗](/screenshots/spec-history-search.png)
_历史记录搜索弹窗_

---


### 2.3 代码选择与引用 {#code-selection-reference}

用户可以通过编辑器右键菜单中的"添加到 Wave"选项，将选中的代码手动添加到对话上下文中。选中的代码会以蓝色内联标签的形式插入到输入框当前光标位置。在消息历史中，点击该标签可快速跳转回编辑器中的对应文件及行号。


![输入框中的代码选中标签](/screenshots/spec-selection-inline-tag.png)
_输入框中的代码选中标签_


### 2.4 指令系统 (Slash Commands) {#slash-commands}

通过输入 `/`，用户可以快速调用预设的指令，如 `/explain`、`/fix` 等提高操作效率。此外，Wave 还提供以下内置指令来快速打开管理弹窗：

- **`/config`**：打开常规设置弹窗（详见 [第 10.1 节 配置设置](#configuration-settings)）
- **`/plugin`**：打开插件管理弹窗（详见 [第 11 章 插件系统](#plugin-system)）
- **`/mcp`**：打开 MCP 服务器管理弹窗（详见 [第 6.3 节 MCP 协议集成](#mcp-integration)）
- **`/model`**：打开模型设置弹窗，快速切换主模型和快速模型（详见 [第 10.1 节 配置设置](#configuration-settings)）
- **`/status`**：打开状态信息弹窗，查看版本、会话 ID、工作目录、模型配置和认证状态
- **`/login`**：打开 SSO 认证弹窗，进行登录/登出操作（详见 [第 10.1 节 配置设置](#configuration-settings)）

选择这些指令后会直接弹出对应弹窗，无需按回车发送。

![指令系统](/screenshots/spec-slash-commands.png)
_指令系统_


### 2.5 文件建议与预览 (@ 提及) {#file-suggestions}

通过输入 `@`，用户可以轻松地将项目中的文件添加到对话上下文中。标签会内联显示在输入框和消息中。对于图片类型的文件，支持点击标签直接在编辑器中预览。

![文件建议下拉列表](/screenshots/spec-file-suggestions.png)
_文件建议下拉列表_

![输入框中的内联标签](/screenshots/spec-inline-mentions.png)
_输入框中的内联标签_

![图片全屏预览模态框](/screenshots/spec-image-preview.png)
_图片全屏预览模态框_

![消息列表中的内联标签](/screenshots/spec-message-inline-tags.png)
_消息列表中的内联标签_



### 2.6 快捷终端命令 (Bang Command) {#bang-shell-command}

用户可以通过在输入框中以 `!` 开头直接执行终端命令。这允许用户在不离开聊天界面的情况下快速执行系统操作、运行脚本或检查环境。

**主要特性：**

- **快速触发**：只需在命令前加上 `!` 即可触发，如 `!ls -la`。
- **实时输出**：命令执行过程中的输出会实时显示在专用的 Bang 块中，风格与 AI 触发的终端工具保持一致。
- **状态反馈**：通过图标直观展示命令的运行状态（运行中、退出代码等）。
- **可中止性**：对于长时间运行的命令，用户可以点击"停止"按钮随时中止执行。

![Bang 命令执行成功](/screenshots/bang-command-success.png)
_Bang 命令执行成功_

![长输出展示](/screenshots/bang-command-long-output.png)
_长输出展示_

---

## 3. 代码理解与操作 {#code-understanding-operations}

### 3.1 终端工具 (Bash Tool) {#bash-tool}

AI 可以执行终端命令并实时展示输入与输出，帮助用户完成自动化任务、运行测试或安装依赖。

![终端工具](/screenshots/spec-bash.png)
_终端工具_

### 3.2 文件搜索与探索 {#file-exploration}

AI 可以使用多种工具来探索项目代码库，这些工具的执行过程和结果都会以直观的工具块形式展示，并在标题栏显示关键参数（Compact Parameters）：

- **Task (Explore)**: 启动专门的子代理进行深度探索，标题显示任务描述（如 `Explore: 查找所有 API 定义`）
- **Glob**: 按模式搜索文件，标题显示搜索模式和路径（如 `src/**/*.ts in src`）
- **Grep**: 在文件中搜索文本内容，标题显示搜索模式、文件类型和路径（如 `interface.*API ts in src`）
- **Read**: 读取文件内容，标题显示文件路径及读取范围（如 `src/main.ts 1:2000`）

![文件探索](/screenshots/spec-exploration.png)
_文件探索_

### 3.3 文件操作工具 {#file-operations}

除了基础的编辑，AI 还可以执行更复杂的文件操作，工具标题会显示操作的文件路径和摘要：

- **Write**: 创建新文件并写入内容，标题显示文件路径及内容摘要（如 `src/new-file.ts 1 lines, 29 chars`）
- **Edit**: 在文件中进行精确的字符串替换，标题显示文件路径（如 `src/app.tsx`）

![文件操作](/screenshots/spec-file-ops.png)
_文件操作_

### 3.4 文件差异对比 (Diff Viewer) {#diff-viewer}

当 AI 建议修改文件时，会通过直观的 Diff 视图展示更改内容，用户可以清晰地看到每一行代码的变化。

![文件差异对比](/screenshots/spec-diff-viewer.png)
_文件差异对比_

### 3.5 LSP 代码智能 {#lsp-intelligence}

Wave 集成了 Language Server Protocol (LSP)，使 AI 能够像 IDE 一样理解代码。工具标题会显示具体的操作和位置（如 `goToDefinition src/main.ts:10:5`）：

- **Go to Definition**: 查找符号定义
- **Find References**: 查找所有引用
- **Hover**: 获取类型信息和文档
- **Call Hierarchy**: 分析函数调用链

![LSP 智能](/screenshots/spec-lsp.png)
_LSP 智能_

### 3.6 视觉理解 {#vision-understanding}

当用户上传图片后，AI 可以识别图片中的 UI 设计、架构图或错误截图，并结合代码提供针对性的建议。

![视觉理解](/screenshots/spec-vision.png)
_视觉理解_

---

## 4. 权限与安全 {#permissions-security}

### 4.1 权限模式管理 {#permission-modes}

Wave 代码智聊 提供五种权限管理模式，用户可以根据需要灵活切换：

#### 默认模式（修改前询问）

![权限模式 - 默认](/screenshots/spec-permission-mode-default.png)
_权限模式 - 默认_

在默认模式下，AI 执行任何涉及文件修改或系统操作的工具之前，都会先向用户请求确认。这是最安全的模式，适合初次使用或处理重要项目时使用。

#### 自动接受修改模式

![权限模式 - 自动接受修改](/screenshots/spec-permission-mode-accept.png)
_权限模式 - 自动接受修改_

在此模式下，AI 可以自动执行文件编辑、创建和删除操作，无需每次确认。适合在信任 AI 建议且希望提高效率的场景下使用。

#### 计划模式

![权限模式 - 计划模式](/screenshots/spec-permission-mode-plan.png)
_权限模式 - 计划模式_

计划模式是一种特殊的工作模式，AI 只能修改计划文件（通常是 `.wave/plans/` 目录下的文件），用于协作制定和完善开发计划，而不会直接修改项目代码。这种模式特别适合项目规划阶段。

#### 完全跳过权限模式（bypassPermissions）

最高权限模式，完全跳过所有权限检查，所有工具无需确认直接执行。仅在完全受控环境中使用。

#### 安全区域（Safe Zone）

用户可通过 `settings.json` 中的 `permissions.additionalDirectories` 配置，将额外目录纳入安全区域。在安全区域内的文件操作可被自动接受，无需逐次确认。

**特点**：
- 下拉切换：点击输入框左下角的权限模式按钮即可弹出下拉菜单切换模式
- 视觉区分：每种模式都有不同的图标和颜色标识
- 实时生效：切换后立即应用到当前会话中

### 4.2 代码修改确认 (Code Edit Confirmation) {#code-edit-confirmation}

在进行代码编辑、文件写入或删除操作前，系统会显示具体的修改内容供用户确认。

**主要特性：**
- 显示文件路径和修改的具体内容
- 集成差异对比器显示代码变更
- 支持批准单次修改或设置自动批准规则
- 提供反馈机制让用户指导修改方向

![代码修改确认](/screenshots/spec-edit-confirm.png)
_代码修改确认_

### 4.3 命令执行确认 (Bash Command Confirmation) {#bash-command-confirmation}

执行系统命令前会显示具体的命令内容，确保用户了解将要执行的操作。

**主要特性：**
- 清晰显示即将执行的 Bash 命令
- 提供命令描述和执行目的说明
- 支持单次批准或设置持久化规则
- 可按命令前缀或具体命令设置自动批准

![命令执行确认](/screenshots/spec-bash-confirm.png)
_命令执行确认_

### 4.4 MCP 工具确认 (MCP Tool Confirmation) {#mcp-tool-confirmation}

当 AI 调用通过 MCP（Model Context Protocol）连接的外部服务工具时，确认框会展示该工具的完整参数，让用户了解即将传递给 MCP 服务器的数据。

**主要特性：**
- **参数展示**：以格式化的 JSON 显示 MCP 工具的全部输入参数，方便用户审核。
- **持久化规则**：支持为特定 MCP 工具设置"不再询问"规则（按工具名匹配，如 `mcp__wave_requirements__create_requirement`）。
- **反馈机制**：支持用户拒绝并提供反馈，指导 AI 调整参数后重新调用。

![MCP 工具确认](/screenshots/spec-mcp-tool-confirm.png)
_MCP 工具确认_

### 4.5 计划执行确认 (Plan Confirmation) {#plan-confirmation}

当 AI 制定了详细的执行计划并准备退出计划模式时，会向用户展示计划内容并请求确认。用户可以选择批准执行、自动接受后续修改，或提供反馈意见。

**主要特性：**
- 清晰显示完整的执行计划内容
- 支持 Markdown 格式的计划展示
- 提供"批准并继续"和"批准并自动接受后续修改"选项
- 支持用户反馈和计划修改建议

![计划执行确认](/screenshots/spec-plan-confirm.png)
_计划执行确认_

### 4.6 进入计划模式确认 (Enter Plan Mode Confirmation) {#enter-plan-mode}

当 AI 判断当前任务较为复杂时，会主动请求用户确认是否进入计划模式。与计划执行确认不同，进入计划模式确认仅提供两个选项：批准进入计划模式，或拒绝并直接开始实现。

**主要特性：**

- **简洁选项**：仅显示"批准并继续"和"不，现在开始实现"两个按钮，匹配 Claude Code 的交互风格。
- **无"不再询问"选项**：不会显示持久化权限选项，确保每次计划模式转换都需要用户明确确认。
- **无反馈输入**：不提供反馈输入框，用户只能选择批准或拒绝。
- **无计划预览**：此确认不展示计划内容（计划内容仅在退出计划模式时展示）。
- **权限模式切换**：批准后，会话权限模式自动切换为 `plan` 模式。
- **拒绝处理**：拒绝后，AI 收到"不，现在开始实现"的反馈消息，直接开始执行任务。

![进入计划模式确认](/screenshots/spec-enter-plan-mode.png)
_进入计划模式确认_

### 4.7 错误消息展示 {#error-message-display}

当工具执行出错或 AI 返回错误信息时，Wave 会以醒目的方式展示错误内容。为了防止过长的错误消息占据过多屏幕空间，错误消息区域设置了最大高度，并支持内部滚动。

**主要特性：**
- 醒目的错误样式标识
- 自动限制最大高度（200px）
- 支持内部垂直滚动，方便查看完整错误信息
- 保持原始格式（如换行和空格）

![工具执行错误](/screenshots/tool-error-scrollable.png)
_工具执行错误_

![通用错误消息](/screenshots/error-block-scrollable.png)
_通用错误消息_

---

## 5. 任务管理 {#task-management}

### 5.1 任务列表 (Task List) {#task-list}

AI 会根据任务目标自动规划并管理任务列表，实时展示任务进度（待办、进行中、已完成、已删除）以及任务间的依赖关系。任务列表集成在输入框上方，支持折叠以节省空间。用户可以通过快捷键 `Ctrl+T` 随时查看或隐藏任务列表。

**主要特性：**

- **集成布局**：任务列表紧贴在输入框上方，视觉上融为一体。
- **可折叠设计**：点击任务列表 Header（显示 "Plan" 和任务计数）即可在展开和折叠状态间切换。
- **自动展开**：当新任务首次创建时，列表会自动展开以提醒用户。
- **状态指示**：Header 左侧的 Chevron 图标直观展示当前折叠状态。

![任务列表（展开状态）](/screenshots/spec-task-list.png)
_任务列表（展开状态）_

![任务列表（折叠状态）](/screenshots/spec-task-list-collapsed.png)
_任务列表（折叠状态）_

### 5.2 后台任务通知 (Task Notification) {#task-notification}

当后台任务（如 Shell 命令或子代理）完成执行时，Wave 会在聊天消息中显示任务通知块，告知用户任务的状态和结果摘要。

**主要特性：**

- **状态指示**：通过不同的图标和颜色直观展示任务状态——绿色对勾表示已完成，红色叉号表示失败，灰色斜杠表示已终止。
- **任务摘要**：简洁地展示任务的执行结果，如测试通过情况或代理错误信息。
- **输出文件链接**：如果有输出文件，会显示文件路径方便用户查看。

![后台任务通知](/screenshots/task-notification.png)
_后台任务通知_

### 5.3 后台任务系统 {#mechanism-background-tasks}

Wave 支持前台和后台两种任务执行模式：

- **Foreground Task**：前台执行的任务（如正在进行的 Bash 命令），用户可将其退化为后台
- **Background Task**：后台执行的任务，包括：
  - `shell` 类型：后台 Bash 命令（`run_in_background: true`）
  - `subagent` 类型：后台子代理
  - 状态流转：`running` → `completed` / `failed` / `killed`
- **Notification Queue**：后台任务完成后自动将通知注入聊天消息，显示任务状态和结果摘要
- 支持 `TaskStop` 工具通过 `task_id` 中止指定后台任务

> 了解更多：详见 [SDK 文档 - 工具系统](/sdk#工具系统)

---

## 6. 能力扩展 {#capability-extensions}

### 6.1 子代理状态 (Subagent Display) {#subagent-display}

对于复杂的任务，Wave 会启动子代理（如 Explore 代理）进行深度探索。子代理的执行过程会以工具块的形式展示，实时显示其正在使用的工具和进度（如 `...Read, Write (2 tools | 1,234 tokens)`）。

> 了解更多：详见 [SDK 文档 - 内置 Subagents](/sdk#内置-subagents)

![子代理状态](/screenshots/spec-subagent.png)
_子代理状态_

### 6.2 Skill 技能系统 {#skill-system}

Skill 是预设的自动化任务模板，用于处理特定的复杂任务（如文档处理、PDF 解析等）。AI 可以根据需要调用这些技能来扩展其能力。

> 了解更多：详见 [SDK 文档 - 内置 Skills](/sdk#内置-skills)

**提示：**用户可以通过内置的 `/settings` skill 来管理 Skill，例如输入 `/settings 帮我写个skill，具体做xxx` 即可快速创建自定义 Skill。

![Skill 系统](/screenshots/spec-skill.png)
_Skill 系统_

### 6.3 MCP 协议集成 {#mcp-integration}

支持 Model Context Protocol (MCP)，允许 AI 连接到外部的 MCP 服务器，从而获取更多的上下文信息或调用外部工具。用户可通过 `/mcp` 命令唤起的 MCP 服务器管理弹窗查看和管理所有已配置的 MCP 服务器。

**主要特性：**

- **服务器列表**：展示所有通过 `.mcp.json` 配置的 MCP 服务器，包括名称、连接状态（○ 未连接 / ● 已连接 / ⟳ 连接中 / ✗ 错误）和工具数量。
- **连接/断开控制**：支持一键连接或断开 MCP 服务器，连接状态实时刷新。
- **错误信息展示**：连接失败的服务器会显示具体错误原因。
- **空状态引导**：未配置任何服务器时，提示用户创建 `.mcp.json` 文件。
- **配置方式**：在项目根目录创建 `.mcp.json` 文件，支持 stdio（本地进程）和 SSE/HTTP（远程服务）两种连接方式。
- **工具确认**：AI 调用 MCP 工具时，确认框会展示格式化的 JSON 参数，用户可审核后再批准（详见 [第 4.4 节 MCP 工具确认](#mcp-tool-confirmation)）。

**提示：**用户也可以通过内置的 `/settings` skill 来管理 MCP 配置，例如输入 `/settings 增加mcp：xxx` 即可快速添加新的 MCP 服务。

![MCP 集成](/screenshots/spec-mcp.png)
_MCP 集成_

![MCP 服务器管理](/screenshots/spec-mcp-server-tab.png)
_MCP 服务器管理（通过 `/mcp` 命令唤起）_

---

## 7. AI 表达与交互 {#ai-expression-interaction}

### 7.1 Mermaid 图表渲染 {#mermaid-rendering}

支持在聊天中直接渲染 Mermaid 流程图、时序图等。提供预览和源码切换，并支持全屏查看、缩放平移以及下载为 SVG 或 PNG 格式。

![Mermaid 图表](/screenshots/spec-mermaid.png)
_Mermaid 图表_

![Mermaid 全屏](/screenshots/spec-mermaid-fullscreen.png)
_Mermaid 全屏_

### 7.2 交互式提问 (Ask User) {#ask-user}

当 AI 需要更多信息或需要用户做出决策时，会通过交互式表单向用户提问。用户回答后，问题与答案将以垂直布局展示，确保在窄屏下也能清晰阅读。

![交互式提问表单](/screenshots/spec-ask-user.png)
_交互式提问表单_

![交互式提问结果（垂直布局）](/screenshots/ask-user-question-vertical.png)
_交互式提问结果（垂直布局）_

### 7.3 AI 思考过程 {#ai-reasoning}

对于支持推理的模型（如 DeepSeek R1, OpenAI o1），Wave 可以展示 AI 的思考过程，让用户了解 AI 是如何得出结论的。

![AI 思考过程](/screenshots/spec-reasoning.png)
_AI 思考过程_

---

## 8. 会话与持久化 {#session-persistence}

### 8.1 对话回滚 (Rewind) {#rewind-feature}

Wave 支持将对话回滚到之前的任意用户消息状态。这不仅会删除该消息及其之后的所有对话记录，还会自动撤销 AI 在这些回合中所做的所有文件更改，并将被回滚的消息内容重新填充到输入框中，方便用户修改后重新发送。

**主要特性：**

- **悬停触发**：当鼠标悬停在历史记录中的用户消息上时，右上方会出现"回滚"图标。
- **一键回滚**：点击图标并确认后，系统会自动清理后续消息、恢复文件状态，并将该消息内容回填至输入框。
- **安全确认**：执行回滚前会弹出二次确认对话框，防止误操作导致数据丢失。
- **状态同步**：回滚后，任务列表、会话元数据以及输入框内容会自动同步到回滚后的状态。

![用户消息上的回滚按钮](/screenshots/spec-rewind-button.png)
_用户消息上的回滚按钮_

### 8.2 会话管理 {#session-management}

扩展提供完整的会话管理功能，支持多个对话会话的创建、切换和管理。

**主要特性：**
- 智能会话切换器，支持下拉选择历史会话
- 优先显示会话的首条消息内容作为会话标题
- 支持主会话和子代理会话的分类管理
- 实时同步会话状态和令牌使用统计
- 会话元数据包括工作目录、最后活跃时间等
- 当会话标题过长时自动截断并显示省略号

> 了解更多：详见 [SDK 文档 - 记忆系统](/sdk#记忆系统)

![会话管理](/screenshots/spec-sessions.png)
_会话管理_

---

## 10. 配置管理 {#config-management}

### 10.1 配置设置 {#configuration-settings}

用户可以自定义 AI 模型、API Key、Base URL 等关键参数，以适配不同的 AI 服务提供商。通过 `/config`、`/model`、`/login`、`/status`、`/plugin`、`/mcp` 六个斜杠命令分别唤起独立的弹窗进行管理。配置界面中的表单字段仅显示用户手动输入的值，不会被环境变量填充；但如果设置了相应的环境变量（如 `WAVE_BASE_URL`），其值会作为 placeholder 提示显示在输入框中。服务端链接字段默认 placeholder 为"请联系管理员获取"。

**主要特性：**

- **常规设置（`/config`）**：配置服务端链接、API Key、Base URL、Headers、语言等。
  - **服务端链接**：配置 Wave AI 服务端地址，用于 SSO 认证。支持环境变量 `WAVE_SERVER_URL` 作为 fallback，默认 placeholder 提示"请联系管理员获取"。
- **模型设置（`/model`）**：快速切换主模型和快速模型，支持环境变量 `WAVE_MODEL` / `WAVE_FAST_MODEL` 作为 placeholder 提示。

![模型设置](/screenshots/spec-model-dialog.png)
_模型设置弹窗_

- **SSO 认证（`/login`）**：当配置了服务端链接后，用户可通过 SSO 认证进行登录，无需手动配置 API Key。登录后所有 API 请求自动通过 Wave AI 代理路由。
  - **浏览器登录**：点击"SSO 登录"后自动打开浏览器，用户在 Wave AI 登录页完成认证（支持 SSO 企业身份提供商或账号密码登录），授权码通过 localhost 回调自动交换为 JWT 并保存。VS Code Remote SSH 环境会自动转发端口，远程服务器体验与本地一致。
  - **登录状态显示**：已认证时显示用户邮箱/ID 和登出按钮；登出后自动恢复为直接 LLM API 模式。

![SSO 认证](/screenshots/spec-login-dialog.png)
_SSO 认证弹窗_

- **状态信息（`/status`）**：查看当前 Wave 的运行状态，包括版本号、Session ID、工作目录、服务端链接、Base URL、Model、Fast Model 及认证状态。

![状态信息](/screenshots/spec-status-dialog.png)
_状态信息弹窗_

- **插件管理（`/plugin`）**：管理插件的安装、更新、卸载和插件市场（详见 [第 11 章 插件系统](#plugin-system)）。
- **MCP 服务器（`/mcp`）**：查看和管理 MCP 服务器连接状态（详见 [第 6.3 节 MCP 协议集成](#mcp-integration)）。

![配置设置](/screenshots/spec-configuration.png)
_配置设置_

### 10.2 语言设置 {#language-settings}

用户可以在常规设置弹窗（通过 `/config` 命令唤起）中选择偏好的语言（中文或英文），AI 代理将根据该设置使用相应的语言进行回复。

![语言设置](/screenshots/language-config-ui.png)
_语言设置_

---

## 11. 插件系统 {#plugin-system}

### 11.1 概述 {#plugin-overview}

Wave 通过插件系统扩展 AI 能力，用户可以通过 `/plugin` 命令唤起的插件管理弹窗管理插件的安装、更新和卸载。

**主要特性：**

- **插件探索**：浏览和搜索可用的插件，支持从不同的插件市场安装。即使插件已安装，如果尚未在当前项目或全局激活，也会显示在探索列表中。
- **作用域选择**：安装插件时可选择作用域（User、Project、Local），灵活控制插件的可用范围。
- **已激活插件管理**：查看当前已激活的插件列表，支持一键更新或卸载插件。
- **插件更新**：支持对已安装的插件进行更新，确保使用最新版本的功能。
- **插件市场管理**：添加、更新和移除插件市场源（支持 GitHub 仓库、本地路径等）。

### 11.2 探索新插件 {#explore-plugins}

在插件管理弹窗的"探索新插件"选项卡中，用户可以通过顶部的搜索框按关键词过滤插件列表。搜索支持对插件名称和描述进行不区分大小写的匹配。对于尚未在当前环境激活的插件，用户可以选择安装作用域后点击"安装"按钮。已安装但未在当前作用域激活的插件也会在此列出，并带有"已安装"标识。

![探索新插件（支持关键词搜索）](/screenshots/spec-plugin-explore.png)
_探索新插件（支持关键词搜索）_

![关键词过滤效果](/screenshots/plugin-search-filtered.png)
_关键词过滤效果_

### 11.3 已激活插件 {#installed-plugins}

在插件管理弹窗的"已激活插件"选项卡中，用户可以查看当前作用域下所有已激活的插件。用户可以对这些插件进行"更新"或"卸载"操作。每个插件会显示其激活的作用域（User、Project 或 Local）。

![已激活插件管理](/screenshots/spec-plugin-installed.png)
_已激活插件管理_

---

## 产品特色总结 {#product-features-summary}

Wave 代码智聊致力于成为开发者的智能编程伙伴，在提升开发效率的同时确保代码质量和项目安全。
