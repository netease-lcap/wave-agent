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

---

## 6. 能力扩展 {#capability-extensions}

### 6.1 子代理状态 (Subagent Display) {#subagent-display}

对于复杂的任务，Wave 会启动子代理（如 Explore 代理）进行深度探索。子代理的执行过程会以工具块的形式展示，实时显示其正在使用的工具和进度（如 `...Read, Write (2 tools | 1,234 tokens)`）。

![子代理状态](/screenshots/spec-subagent.png)
_子代理状态_

### 6.2 Skill 技能系统 {#skill-system}

Skill 是预设的自动化任务模板，用于处理特定的复杂任务（如文档处理、PDF 解析等）。AI 可以根据需要调用这些技能来扩展其能力。

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

### 6.4 内置 Skills {#builtin-skills}

#### settings — 配置管理 {#skill-settings}

详见 [第 11.3 节 Settings Skill](#settings-skill)。用户可通过 `/settings` 以自然语言管理所有 Wave 设置。

#### init — 代码库初始化 {#skill-init}

分析代码库并创建 `AGENTS.md` 文件，为后续 Agent 会话提供项目上下文指引。

- **名称**: `init`
- **特性**: 不会被 AI 自动调用，需用户通过 `/init` 手动触发

#### loop — 定时循环任务 {#skill-loop}

按指定间隔重复执行提示词或斜杠命令。

- **名称**: `loop`
- **使用方式**: `/loop [interval] <prompt>`
- **间隔格式**: `Ns`, `Nm`, `Nh`, `Nd`（如 `5m`, `30m`, `2h`, `1d`），最小粒度为 1 分钟，默认 10 分钟

**示例**:
- `/loop 5m /babysit-prs` — 每 5 分钟执行 `/babysit-prs`
- `/loop 30m check the deploy` — 每 30 分钟检查部署
- `/loop check the deploy` — 默认每 10 分钟执行

**底层工具**：由 `CronCreate`、`CronDelete`、`CronList` 三个工具实现：
- `CronCreate`：创建定时任务，支持 5 字段 cron 表达式（本地时区）、recurring（循环，默认）和一次性（`recurring: false`）任务
- `CronDelete`：按 `id` 删除指定定时任务
- `CronList`：列出所有已注册的定时任务

**限制**：循环任务 7 天后自动过期；最多支持 50 个定时任务。

### 6.5 内置 Subagents {#builtin-subagents}

#### Bash — 命令执行 {#subagent-bash}

专门用于执行 bash 命令的代理，适用于 git 操作、命令执行、终端任务等。

- **工具**: `[Bash]`
- **模型**: 继承主代理模型

#### Explore — 代码库探索 {#subagent-explore}

快速探索代码库的文件搜索专家，支持三种细致程度：`quick`、`medium`、`very thorough`。

- **工具**: `[Glob, Grep, Read, Bash, LSP]`
- **模型**: 快速模型（fastModel）
- **模式**: 只读，禁止任何文件修改操作

#### Plan — 软件架构师 {#subagent-plan}

设计实现方案的软件架构师代理，返回分步策略、识别关键文件、考虑架构权衡。

- **工具**: `[Glob, Grep, Read, Bash, LSP]`
- **模型**: 继承主代理模型
- **模式**: 只读，禁止任何文件修改操作

#### General-Purpose 代理 {#subagent-general-purpose}

用于研究复杂问题、搜索代码和执行多步骤任务的通用代理。

- **模型**: 继承主代理模型

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

![会话管理](/screenshots/spec-sessions.png)
_会话管理_

---

## 9. 记忆系统 {#memory-system}

### 9.1 AGENTS.md 文件 {#agents-md}

Wave 使用 `AGENTS.md` 文件作为持久化的项目级和用户级指令，帮助 AI 在不同会话间保持一致的行为和上下文：

- **项目级**：`[project-root]/AGENTS.md`，存放在项目根目录，随代码库共享给所有协作者
- **用户级**：`~/.wave/AGENTS.md`，存放在用户全局目录，跨所有项目生效
- 内容在每次会话加载时自动注入系统提示词，确保 AI 始终遵循这些指令
- 与自动记忆系统互补：AGENTS.md 侧重长期稳定的项目指南和约定，自动记忆侧重会话过程中动态积累的项目洞察
- 自动记忆提取时会避免与 AGENTS.md 内容产生重复

### 9.2 消息压缩 (Message Compression) {#mechanism-context-management}

Wave 采用多层压缩机制管理对话历史，确保在长对话中不超出模型 token 限制：

**自动压缩 (Auto-Compact)**
- 每次 AI 响应后监控 token 使用量（含 cache 读取/写入 tokens）
- 当总 token 数超过 `getMaxInputTokens()` 时，自动触发压缩流程
- 使用快速模型（fastModel）生成对话摘要，`max_tokens: 8192`，`temperature: 0.1`
- 压缩前从消息中剥离图片以降低 token 消耗
- 按 API round 边界分组消息，保留最后 2 个 API round，避免拆分 tool_use/tool_result 对
- 被压缩的消息替换为 `compress` 块（类型为 `compress`，内容为摘要文本）
- `compress` 块在发送 API 请求时转换为 user 角色消息
- 压缩后创建新会话，通过 `parentSessionId` 链接到旧会话，保持历史可追溯
- 递归压缩时，旧摘要连同整个历史被新摘要替换

**时间压缩 (Microcompact)**
- 每次 API 调用前检查距离最近完成的 tool block 是否超过 30 分钟
- 若超时，清理旧 tool result 内容，仅保留最近 3 条结果
- 被清理的结果替换为 `[Old tool result content cleared]`
- 若无 assistant tool 消息或未超时，则消息保持不变

**熔断机制 (Circuit Breaker)**
- 跟踪连续压缩失败次数
- 连续 3 次失败后跳过压缩并记录警告，避免在损坏的上下文中浪费 API 调用
- 压缩成功后失败计数器重置为 0

**压缩后上下文恢复 (Post-Compact Context Restoration)**
- 最近读取的文件：最多 5 个文件，每个 5000 tokens
- 当前工作目录路径
- 计划模式状态及计划文件路径
- 已调用的 Skill 列表（名称和描述，总预算 25k tokens，单个 5k）
- 后台子代理的描述和运行状态
- 上述内容以 `[Context Restoration]` 章节追加到摘要末尾

**摘要格式**
AI 生成的摘要包含 9 个结构化章节：Primary Request and Intent、Key Technical Concepts、Files and Code Sections、Errors and Fixes、Problem Solving、All User Messages、Pending Tasks、Current Work、Optional Next Step。

### 9.3 自动记忆系统 (Auto Memory) {#mechanism-auto-memory}

Wave 在后台自动维护项目记忆，帮助 AI 持续了解项目演变：

- 每 N 轮对话触发一次记忆提取（`autoMemoryFrequency` 配置，默认每 1 轮）
- 使用 `general-purpose` 子代理在后台异步执行，不影响主对话
- 自动检测 AI 是否已手动更新 `.wave/memory/` 目录下的文件，若有则跳过避免重复
- 提取代理仅允许写入 `.wave/memory/` 目录，使用快速模型，最多 5 轮，越权写入自动拒绝
- 支持 `autoMemoryEnabled` 开关（默认开启）
- 记忆文件存储在 `~/.wave/projects/{项目编码}/memory/` 目录，确保 git worktree 间共享同一记忆

### 9.4 记忆规则 (Memory Rules) {#mechanism-memory-rules}

记忆规则提供上下文特定的行为指南，确保 AI 在不同场景下遵循预期模式：

- 存放在 `.wave/rules/` 目录下的多个独立 `.md` 文件（项目级）和 `~/.wave/rules/`（用户级）
- 支持子目录递归扫描和符号链接跟随
- 每个文件是一个独立规则，支持 YAML frontmatter：
  - `paths`：glob 模式数组，仅当相关文件在上下文中时规则才激活（空则始终激活）
  - `priority`：优先级数字，控制冲突时的覆盖顺序
- 项目规则可覆盖用户规则

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

### 10.3 Settings Skill {#settings-skill}

Wave 提供了一个强大的内置 `/settings` skill，作为用户与 Wave 配置系统交互的自然语言入口。用户无需手动编辑配置文件，只需用自然语言描述需求，AI 即可帮助查看、修改和引导配置。

**主要特性：**

- **自然语言配置**：通过对话方式管理所有 Wave 设置，如"显示我的当前设置"、"更新项目设置启用自动记忆"等。
- **三级作用域**：配置支持用户级（`~/.wave/settings.json`）、项目级（`.wave/settings.json`）和本地级（`.wave/settings.local.json`）。
- **热加载**：所有配置修改立即生效，无需重启 Wave。

#### settings.json 配置中心 {#settings-json}

`settings.json` 是 Wave 的中央配置文件，支持自定义钩子、环境变量、工具权限等功能。

**使用示例：**

- "显示我当前的项目设置"
- "帮我在项目级设置里开启自动记忆"
- "用本地配置文件覆盖某个全局设置"

#### 钩子 (Hooks) {#settings-hooks}

钩子允许在特定事件发生时自动执行任务，实现工作流自动化。Wave 支持以下 7 种钩子事件：

| 事件名称 | 触发时机 |
|----------|----------|
| `PreToolUse` | 工具执行前（可用于校验、拦截或预处理） |
| `PostToolUse` | 工具执行完成后（可用于后处理或日志记录） |
| `UserPromptSubmit` | 用户提交 Prompt 时 |
| `PermissionRequest` | Wave 请求工具权限时 |
| `Stop` | Wave 完成响应周期（无更多工具调用）时 |
| `SubagentStop` | 子代理完成响应周期时 |
| `WorktreeCreate` | 创建新 worktree 时 |
| `WorktreeRemove` | 离开或删除 worktree 时 |
| `SessionStart` | 会话开始时（来源：`startup` 启动 / `resume` 恢复 / `compact` 压缩后新会话） |
| `SessionEnd` | 会话结束时（来源：`exit` 退出 / `stop` 中止 / `compact` 压缩） |

**钩子配置要点：**

- **模式匹配**：支持通过 `matcher` 匹配工具名（如 `Write`、`Read*`、`/^Edit/`），适用于 `PreToolUse`、`PostToolUse` 和 `PermissionRequest`。
- **异步执行**：支持 `async` 字段配置后台异步执行，避免阻塞工作流。
- **超时控制**：支持 `timeout` 字段设置最大执行时间（默认 600 秒）。
- **退出码控制**：
  - `0`：成功，Wave 继续正常执行
  - `2`：阻塞错误，Wave 阻止当前操作并反馈错误信息
  - 其他（如 `1`）：非阻塞错误，Wave 继续执行但向用户显示警告
- **输入上下文**：Wave 通过 `stdin` 向钩子进程传递 JSON 格式的详细信息，包括会话 ID、工具名称、工具参数、工具响应等上下文。
- **热加载**：配置文件修改后即时生效，无需重启 Wave。

**使用示例：**

- "在 Write 工具执行前自动运行 pnpm lint"
- "每次用户提交 Prompt 时记录到日志文件"
- "给 Bash 工具的权限请求添加异步日志 hook"

#### 环境变量 {#settings-env}

通过 `env` 字段设置对所有工具和钩子可用的环境变量。常用 `WAVE_*` 变量包括：

- `WAVE_MODEL`、`WAVE_FAST_MODEL`：模型选择
- `WAVE_MAX_INPUT_TOKENS`、`WAVE_MAX_OUTPUT_TOKENS`：Token 限制
- `WAVE_API_KEY`、`WAVE_BASE_URL`：API 配置

**使用示例：**

- "帮我设置默认模型为 claude-3-7-sonnet-20250219"
- "把最大输出 tokens 调到 4096"
- "添加一个自定义环境变量 NODE_ENV=development"

#### 工具权限 {#settings-permissions}

管理工具权限并定义"安全区域"（Safe Zone），支持 `allow`、`deny` 列表以及 `permissionMode` 配置。权限修改立即生效。

**使用示例：**

- "把权限模式改成自动接受修改"
- "允许 Read 和 Bash 工具无需确认"
- "扩展安全区域，把 /tmp/wave-exports 目录加进去"

#### 模型配置 {#settings-models}

在 `models` 字段中定义 AI 模型及其专属参数，支持任意模型参数（以下为常见示例）：

- `temperature`：控制输出的随机性
- `reasoning_effort`：推理强度（`low`/`medium`/`high`），适用于支持推理的模型
- `thinking`：是否开启思考模式及预算 tokens，如 `{"type": "enabled", "budget_tokens": 2048}`

此外还支持 `fastModel` 配置，用于子代理（Explore）和网页抓取摘要等轻量场景，可通过 `WAVE_FAST_MODEL` 环境变量设置。

**使用示例：**

- "给 claude-3-7-sonnet 开启 thinking，预算设为 2048 tokens"
- "把 o3-mini 的推理强度设为 high"
- "帮我查看当前有哪些模型配置"
- "设置快速模型为 claude-3-5-haiku"

#### Prompt 缓存 {#settings-prompt-cache}

SDK 默认对名称包含 `claude` 的模型自动启用 Prompt Cache（提示词缓存），通过在消息内容中插入 `ephemeral` 缓存标记来复用上下文，降低 API 调用成本。

对于其他支持 Prompt Cache 的模型（如 qwen3.6-plus 等），可通过设置环境变量 `WAVE_PROMPT_CACHE_REGEX` 来匹配模型名称，例如：

- `WAVE_PROMPT_CACHE_REGEX="qwen"` — 匹配 qwen 系列模型
- `WAVE_PROMPT_CACHE_REGEX="(qwen|claude)"` — 同时匹配 qwen 和 claude

#### MCP 协议 {#settings-mcp}

配置外部 MCP 服务器连接，为 AI 提供额外的工具和上下文能力。支持两种连接方式：

- **本地进程（stdio）**：通过命令启动本地 MCP 服务，如 `npx`、`uvx`、`python` 等
- **远程 HTTP/SSE**：通过 URL 连接到远程 MCP 服务器，如 `https://example.com/sse`

用户可通过 `/settings 增加mcp：xxx` 快速添加。

**使用示例：**

- "增加一个 MCP 服务，用 npx 运行 github MCP 服务器"
- "添加一个远程 MCP 服务，URL 是 https://mcp.example.com/sse"
- "帮我查看当前配置了哪些 MCP 服务器"
- "移除某个不再使用的 MCP 连接"

#### 记忆规则 {#settings-memory}

为 Agent 提供上下文特定的指令和指南，确保 AI 在不同场景下遵循预期的行为模式。

**使用示例：**

- "添加一条记忆规则：始终用中文回答"
- "帮我查看当前的记忆规则有哪些"
- "删除那条关于代码风格的记忆"

#### 自定义 Skill {#settings-skills}

创建自定义 skill 以扩展 Wave 功能，处理特定复杂任务。用户可通过 `/settings 帮我写个skill，具体做xxx` 快速创建。

**使用示例：**

- "帮我写个 skill，自动把当前分支的代码部署到测试服务器"
- "创建一个 skill，用于定期生成项目文档"
- "列出我所有的自定义 skill"

#### 子代理 {#settings-subagents}

定义专用的 AI 个性代理，将特定任务委托给专业化的子代理执行。

**使用示例：**

- "创建一个专门负责代码审查的子代理"
- "定义一个专注于前端 UI 设计的子代理"
- "帮我查看所有已配置的子代理"

#### 插件配置 {#settings-plugins}

通过 `enabledPlugins` 启用或禁用插件。插件的 skill、hook、MCP 和 LSP 服务器可使用 `${WAVE_PLUGIN_ROOT}` 占位符引用其父插件目录。

**使用示例：**

- "禁用 xxx 插件"
- "帮我查看所有已启用的插件"
- "在插件的 hook 中使用 ${WAVE_PLUGIN_ROOT} 引用插件目录"

#### 其他设置 {#settings-other}

- `language`：AI 通信首选语言（如 `"zh"`、`"en"`）。
- `autoMemoryEnabled`：启用或禁用自动记忆（默认：`true`）。
- `autoMemoryFrequency`：自动记忆提取频率（默认：`1`）。

**使用示例：**

- "把 AI 回复语言改为英文"
- "关闭自动记忆功能"
- "调整自动记忆的触发频率"

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

### 11.4 官方插件市场 {#plugin-marketplaces}

SDK 内置默认插件市场 `wave-plugins-official`（来源：[netease-lcap/wave-plugins-official](https://github.com/netease-lcap/wave-plugins-official)），自动启用且支持自动更新。该市场提供以下插件：

#### 11.4.1 document-skills {#plugin-document-skills}

文档处理套件，包含 **docx**（Word）、**xlsx**（Excel）、**pptx**（PowerPoint）和 **pdf** 四个技能组。AI 可以读取、创建和编辑各类办公文档，支持内容提取、格式转换和数据操作。

#### 11.4.2 typescript-lsp {#plugin-typescript-lsp}

TypeScript/JavaScript 语言服务器，通过 `typescript-language-server --stdio` 提供代码智能支持。包括代码补全、跳转定义、查找引用、符号搜索、类型提示和错误诊断等功能。

#### 11.4.3 chrome-devtools {#plugin-chrome-devtools}

Chrome DevTools Protocol MCP 服务器，通过 `npx chrome-devtools-mcp` 启动。支持浏览器自动化操作，包括页面导航、元素检查、截图、网络请求监控、控制台执行等。

#### 11.4.4 code2spec {#plugin-code2spec}

从代码生成规格说明文档的工具集。基于代码库自动创建 requirements、plan、tasks 等技术规格模板，帮助团队建立代码与文档的对应关系。

#### 11.4.5 code2cwspec {#plugin-code2cwspec}

从现有代码（.NET、Java 等老系统）逆向生成为 CodeWave 格式的规范模板。包含 **4 个子代理**：cw-architect（架构分析）、cw-researcher（代码调研）、cw-validator（规范校验）、cw-writer（文档生成），输出 requirements/plan/tasks 完整规范。

#### 11.4.6 commit-skills {#plugin-commit-skills}

简化的 Git 工作流技能集，包含 **5 个技能**：commit（提交）、commit-push-mr（提交并推送 MR）、commit-push-pr（提交并推送 PR）、watch-merge-mr（等待合并 MR）、watch-merge-pr（等待合并 PR）。支持从代码审查到合并的全流程自动化。

#### 11.4.7 speckit {#plugin-speckit}

规范驱动开发工具包（中文版），包含 **8 个技能**：analyze（需求分析）、checklist（检查清单）、clarify（需求澄清）、constitution（项目章程）、implement（实现指导）、plan（项目规划）、specify（规格编写）、tasks（任务分解）。适用于软件工程任务的规格说明与规划。

#### 11.4.8 deep-wiki {#plugin-deep-wiki}

AI 驱动的 Wiki 生成器，支持 Mermaid 图表、源码引用、入职指南和 llms.txt 生成。包含 **3 个子代理**（wiki-architect、wiki-researcher、wiki-writer）和 **3 个命令**（ask、build、generate），可自动生成项目文档知识库。

#### 11.4.9 tavily-search {#plugin-tavily-search}

Tavily AI 驱动的搜索引擎 MCP 服务器，通过 `https://mcp.tavily.com/mcp/` 提供网络搜索能力。支持实时信息检索、新闻查询、技术文档查找等场景。

#### 11.4.10 lcap-extension-component {#plugin-lcap-extension-component}

LCAP 低代码平台扩展组件开发指南。包含约 **17 个技能**，覆盖 ElementUI、ElementPlus、AntD、Mobile UI、Cloud UI 等平台组件，以及工作流护栏、图标、无障碍访问等专项能力。

#### 11.4.11 frontend-design {#plugin-frontend-design}

创建独特的、生产级前端界面设计技能。注重美学品质，避免千篇一律的 AI 审美风格，生成具有设计感的 Web 前端代码。

在插件管理弹窗的"插件市场"选项卡中，用户还可以添加自定义的插件市场源，支持 GitHub 仓库（owner/repo 格式）、Git URL 或本地文件路径。添加后可以从该市场源安装插件，也可以更新或移除市场源。

![插件市场管理](/screenshots/spec-plugin-marketplaces.png)
_插件市场管理_

---

## 12. OpenTelemetry 遥测 {#opentelemetry-telemetry}

Wave 支持 OpenTelemetry 可观测性标准，提供结构化的遥测数据（Traces、Metrics、Logs），帮助开发者观察 Agent 行为、调试性能问题并分析会话模式。

### 12.1 导出器 (Exporters) {#otel-exporters}

Wave 支持为每种信号类型（Traces、Metrics、Logs）配置不同的导出目标：

- **OTLP 导出器**：将遥测数据发送到标准 OTLP 收集器（如 Jaeger、Grafana Tempo、Honeycomb）。通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 设置收集器地址。
- **JSONL 文件导出器**：将遥测数据写入 `~/.wave/telemetry.jsonl`，每行一条独立的 JSON 记录。

**配置方式**：通过 `OTEL_*` 环境变量或 `settings.json` 中的 `monitoring.telemetry` 字段配置，环境变量优先。

```json
{
  "monitoring": {
    "telemetry": {
      "enabled": true,
      "tracesExporter": "otlp",
      "metricsExporter": "jsonl",
      "logsExporter": "jsonl",
      "endpoint": "https://your-collector.example.com",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

### 12.2 Span 体系 {#otel-spans}

Wave 创建三层 Span 结构，完整记录用户交互到工具执行的全链路：

| Span 类型 | 说明 | 关键属性 |
|-----------|------|----------|
| **InteractionSpan** | 包裹一次完整的用户消息 → Agent 响应周期 | `user_prompt`（可选）、`user_prompt_length`、`interaction.sequence` |
| **LLMRequestSpan** | Interaction 的子 Span，表示单次 API 调用 | `model`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`、`ttft_ms`、`ttlt_ms`、`success`、`has_tool_call` |
| **ToolSpan** | Interaction 的子 Span，表示单次工具执行 | `tool_name`、`tool_input`（可选）、`success`、`error`、`duration_ms` |

- **父子关系**：一个 InteractionSpan 包含多个 LLMRequestSpan（多轮递归时）和多个 ToolSpan（并行工具调用时）
- **并行隔离**：使用 `AsyncLocalStorage` 确保并行工具执行时 Span 上下文不混淆
- **资源属性**：包含 `service.name: 'wave'`、`service.version`、`os.type`、`host.arch`

### 12.3 事件日志 (Event Logging) {#otel-events}

Wave 在关键会话生命周期节点记录结构化事件：

| 事件 | 触发时机 | 关键属性 |
|------|----------|----------|
| `session_start` | 会话启动 | `sessionId`、`model`、`workdir` |
| `session_end` | 会话结束 | `duration`、`totalTokens`、`exitReason` |
| `user_prompt` | 用户发送消息 | `prompt_length`、`prompt`（若启用） |
| `tool_decision` | 工具权限决策 | `tool_name`、`decision`、`source` |
| `compaction` | 自动压缩触发 | `beforeTokens`、`afterTokens`、`model` |
| `error` | 错误发生 | `error_type`、`message`、`stack`（截断） |

### 12.4 PII 保护 {#otel-privacy}

默认情况下，用户提示文本和工具内容**不包含**在遥测数据中。需显式启用：

- `OTEL_LOG_USER_PROMPTS=1`：在事件中包含用户提示文本
- `OTEL_LOG_TOOL_CONTENT=1`：在事件中包含工具输入/输出内容

### 12.5 可靠性保障 {#otel-reliability}

- **优雅降级**：遥测初始化或导出失败时，Agent 正常运行不受影响，仅记录警告日志
- **关闭刷新**：进程退出时自动刷新遥测数据，超时时间可配置（默认 2 秒）
- **内存保护**：超过 30 分钟的活跃 Span 自动清理，防止长会话内存泄漏
- **懒加载**：遥测模块懒加载，不增加启动延迟

---

## 13. 完整工具清单 {#complete-tool-reference}

Wave 提供 19 个内置工具，涵盖代码探索、文件操作、任务管理、网页抓取和定时任务等能力。每个工具在执行时以工具块形式展示，标题栏显示关键参数（Compact Parameters）。

### 13.1 Bash — 终端命令执行 {#tool-bash}

| 参数 | 类型 | 说明 |
|------|------|------|
| `command` | string | 必需，要执行的命令 |
| `timeout` | number | 超时时间（秒） |
| `description` | string | 命令描述 |
| `run_in_background` | boolean | 是否后台执行 |

执行后显示 `shortResult`（输出最后 3 行摘要）。后台执行时返回任务 ID，可通过任务通知查看结果。

### 13.2 Read — 读取文件 {#tool-read}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `offset` | number | 起始行号（默认 1） |
| `limit` | number | 最大读取行数（默认 2000） |

**特性**：支持图片读取（PNG/JPEG/GIF/WebP），自动检测二进制文档（PDF/DOCX 等返回错误提示），超长行自动截断（2000 字符）。对未变更的文件返回 "File unchanged" 避免重复内容。

Compact Parameters 格式：`src/main.ts 1:2000`

### 13.3 Glob — 文件名模式匹配 {#tool-glob}

| 参数 | 类型 | 说明 |
|------|------|------|
| `pattern` | string | 必需，glob 模式（如 `**/*.ts`） |
| `path` | string | 搜索根目录 |
| `limit` | number | 最大返回数量（默认 100） |

Compact Parameters 格式：`src/**/*.ts in src`

### 13.4 Grep — 文本内容搜索 {#tool-grep}

| 参数 | 类型 | 说明 |
|------|------|------|
| `pattern` | string | 必需，正则表达式 |
| `path` | string | 搜索目录 |
| `glob` | string | 文件过滤模式（如 `*.ts`） |
| `type` | string | 文件类型（如 `ts`、`py`） |
| `output_mode` | string | `content`（显示内容）、`files_with_matches`（仅文件名）、`count`（计数） |
| `-A/-B/-C` | number | 匹配后/前/前后上下文行数 |
| `-i` | boolean | 大小写无关搜索 |
| `head_limit` | number | 限制输出行数 |
| `multiline` | boolean | 多行匹配模式 |

Compact Parameters 格式：`interface.*API ts in src`

### 13.5 Write — 写入文件 {#tool-write}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `content` | string | 必需，写入内容 |

**规则**：写入已存在文件前必须先 Read 确认当前内容；自动创建不存在的父目录。

Compact Parameters 格式：`src/new-file.ts 1 lines, 29 chars`

### 13.6 Edit — 精确字符串替换 {#tool-edit}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `old_string` | string | 必需，要替换的原文 |
| `new_string` | string | 必需，替换后的新文 |
| `replace_all` | boolean | 是否批量替换所有匹配项 |

**规则**：非 `replace_all` 时若 `old_string` 在文件中出现多次则报错，提示提供更多上下文或使用 `replace_all=true`。

### 13.7 LSP — 代码智能 {#tool-lsp}

支持操作：`goToDefinition`（查找定义）、`findReferences`（查找引用）、`hover`（悬停信息）、`documentSymbol`（文档符号）、`workspaceSymbol`（全局符号搜索）、`goToImplementation`（查找实现）、`prepareCallHierarchy`/`incomingCalls`/`outgoingCalls`（调用层级分析）。

Compact Parameters 格式：`goToDefinition src/main.ts:10:5`

### 13.8 AskUserQuestion — 交互式提问 {#tool-askuser}

| 参数 | 类型 | 说明 |
|------|------|------|
| `questions` | array | 必需，问题列表 |
| `questions[].question` | string | 问题内容 |
| `questions[].header` | string | 简短标签（最多 12 字符） |
| `questions[].options` | array | 选项列表（2-4 个），每项含 `label` 和可选 `description` |
| `questions[].multiSelect` | boolean | 是否允许多选 |

### 13.9 WebFetch — 网页内容抓取 {#tool-webfetch}

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 必需，要抓取的 URL |
| `prompt` | string | 必需，对抓取内容的处理指令 |

**特性**：内置 15 分钟 LRU 缓存（最大 50MB），自动将 HTTP 升级为 HTTPS，HTML 自动转 Markdown，使用快速模型处理摘要。内容上限 100K 字符。GitHub URL 提示使用 `gh` CLI。跨域重定向自动拦截并提示。

### 13.10 ToolSearch — 延迟加载工具发现 {#tool-toolsearch}

| 参数 | 类型 | 说明 |
|------|------|------|
| `query` | string | 必需，搜索查询 |
| `max_results` | number | 最大返回数量（默认 5） |

**查询格式**：
- `select:ToolName` — 按名称精确匹配（逗号分隔多个）
- `notebook jupyter` — 关键词搜索
- `+slack send` — `+` 前缀表示必需匹配项

用于发现延迟加载工具（deferred tools）的完整 schema，获取后即可调用。

### 13.11 EnterWorktree / ExitWorktree — Git Worktree 隔离 {#tool-worktree}

**EnterWorktree 参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | string | worktree 名称（可选，自动生成） |

**特性**：在 `.wave/worktrees/` 下创建独立分支工作区。要求当前在 git 仓库且不在已有 worktree 中。

**ExitWorktree 参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `keep` | boolean | 是否保留 worktree（默认 false） |
| `discard_changes` | boolean | 是否丢弃未提交更改（`keep=false` 时若存在未提交内容需确认） |

### 13.12 CronCreate / CronDelete / CronList — 定时任务 {#tool-cron}

**CronCreate 参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `cron` | string | 必需，5 字段 cron 表达式（本地时区） |
| `prompt` | string | 必需，要执行的内容 |
| `recurring` | boolean | 是否循环（默认 true） |

**CronDelete 参数**：`id` — 任务 ID
**CronList 参数**：无

**限制**：最多 50 个任务，循环任务 7 天自动过期。

### 13.13 TaskCreate / TaskGet / TaskUpdate / TaskList — 任务管理 {#tool-task}

**TaskCreate 参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `subject` | string | 必需，任务主题 |
| `description` | string | 任务描述 |
| `status` | string | 初始状态（默认 `pending`） |
| `activeForm` | string | 进行中的动词形式（如 "正在编写测试"） |
| `owner` | string | 负责人 |
| `blocks` | string[] | 被此任务阻塞的任务 ID 列表 |
| `blockedBy` | string[] | 阻塞此任务的任务 ID 列表 |

**TaskUpdate 参数**：`id`（必需）、`subject`、`description`、`status`（`pending`→`in_progress`→`completed`→`deleted`）、`blocks`/`blockedBy`。状态变更时自动清理双向依赖。

**TaskList 参数**：`status` — 按状态过滤
**TaskGet 参数**：`id` — 获取单个任务详情

### 13.14 TaskStop — 中止后台任务 {#tool-taskstop}

| 参数 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 必需，要中止的后台任务 ID |

---

## 产品特色总结 {#product-features-summary}

Wave 代码智聊致力于成为开发者的智能编程伙伴，在提升开发效率的同时确保代码质量和项目安全。
