# VS Code 扩展 / JetBrains 插件使用文档

CodeWave IDE 是一款集成在 VS Code 与 JetBrains IDE（WebStorm、IntelliJ IDEA 等）中的 AI 辅助编程插件，两者共享同一聊天界面。本文档介绍插件的安装登录与差异化能力，其余 AI 能力与桌面端保持一致，详见 [桌面端产品文档](/desktop)。

## 快速入门

### VS Code 扩展

在 VS Code 扩展市场搜索 **CodeWave IDE**（扩展 ID：`wave-codechat.wave-vscode`）安装。安装后可通过三种方式打开聊天面板：

- **侧边栏**：点击活动栏的 CodeWave IDE 图标在侧边栏打开，或命令面板（`Cmd/Ctrl+Shift+P`）执行「在侧边栏打开代码智聊」。
- **新标签页**：执行「在新标签页打开代码智聊」，在编辑器区域以标签页形式打开，可与文件并排查看。
- **新窗口**：执行「在新窗口打开代码智聊」，在独立窗口打开，适合多显示器并行使用。

打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

![未登录欢迎页](/screenshots/spec-welcome-login.webp)

### JetBrains 插件

在 JetBrains 插件市场（IDE「设置 → 插件」）搜索 **CodeWave IDE** 安装。打开聊天面板点击欢迎页的「登录」按钮完成 SSO 登录。

## 代码补全

在编辑器里写代码时，Wave 会在光标停顿时给出行内续写建议（灰字幽灵文本）：建议只是预览，不写入文件、不进撤销栈，按 `Tab` 采纳才会落到文档里。该能力由 IDE 插件提供（VS Code / JetBrains），补全请求与聊天互不排队——补全不会拖慢正在进行的对话。

- **触发方式**：自动（输入停顿后请求，等待时长随补全服务近期延迟自适应，约 0.1–1 秒）或手动立即触发（VS Code 默认 `Alt+\`，走平台内置的 `editor.action.inlineSuggest.trigger`，跳过等待；JetBrains 侧复用平台的行内补全触发动作，按键以 IDE 键位为准）。
- **上下文范围**：光标前最多 150 行、光标后最多 30 行，拼起来总长上限 12000 字符，超出时从离光标最远处截断；不建代码库索引，也不做全文检索。除此之外两端还会带上光标处符号的定义、本文件 import 进来的符号的定义（VS Code 另含光标所在函数/类的声明），统共最多 3 段、采集超过 100ms 就放弃这一部分照常请求。
- **跨文件定义怎么找**：VS Code 侧先用本地语法解析（TS / TSX / JS / JSX / Python / Java，其它语言不带跨文件片段）挑出值得问的符号，再交给语言服务定位定义；JetBrains 侧把 import 行里的标识符和光标前后的引用交给 IDE 自己的引用解析，因此只受该语言插件是否有 PSI 支持限制。两端都不带同文件内的定义——那份代码已经在光标前缀里了。
- **超时**：单个请求 3 秒，超时按「没有建议」静默处理——更晚的建议对正在打字的人已没有价值。
- **不提供补全的情况**：只读 / 不可写文件；未命名缓冲区与非 `file` 协议的虚拟文档（设置页、计划预览、SCM 与 diff 视图、notebook 单元格等）；光标处有选区或多个光标；文件过大（VS Code 超过 20000 行或 1MB，JetBrains 超过 1MB）；文档处于合并冲突 / 内联差异等特殊渲染状态。同一时刻只有聚焦的那个编辑器持有请求，切换编辑器会取消。
- **会话前提**：补全用的模型与网关凭据都来自 CLI 侧的会话，所以扩展未激活（本次启动还没打开过 Wave 聊天面板）时不显示补全——避免为了补全在每次 IDE 启动时都拉起一个 CLI 进程。
- **隐私**：光标前后的代码片段，以及上述几段跨文件定义，会随请求发到你已配置的模型服务（与对话同一个网关和凭据）；不会上传整个文件或整个仓库。

也就是说，你在 B 文件里就能用上 A 文件里那个你还没看过的函数。比如：

```ts
// helper.ts
export function formatPrice(cents: number): string { /* … */ }

// cart.ts —— 只有 import，没有定义
import { formatPrice } from "./helper";
const label = ▍ // ← 建议直接给出 formatPrice(total)
```

补全默认跟随「快速模型」；你也可以在设置页「全局设置 → 基础设置」里单独指定补全专用模型、或用开关整体关掉补全（关闭后不再发起任何补全请求，也不消耗模型调用）：

![设置页：补全与下一步编辑建议开关、补全模型](/screenshots/spec-settings-global.webp)

## 下一步编辑建议

补全管的是「光标处往下写什么」，下一步编辑建议管的是「你刚改的那处，别处还该跟着改」：改完一个字段名、多加一个参数之后，Wave 会看你这几笔改动，预测同一文件里下一处该改的代码，给出可直接采纳的重写——可以只改几行，也可以是删掉几行。

默认关闭，可在设置页「全局设置 → 基础设置 → 下一步编辑建议」打开。它用的模型与补全相同（默认跟随快速模型），请求与对话、补全都不互相排队。

- **触发**：每次编辑后停顿约 0.2 秒请求一次；单个请求 3 秒超时，超时或模型没给出可用的重写就当作这次不提示。
- **建议从哪来**：最近几笔改动里被删掉的与新增的文本、光标上下各 5 行（模型可以改写的范围），以及范围外再 40 行只读上下文与文件路径。
- **VS Code 怎么显示与采纳**：建议要改的正是光标所在处时，与补全一样显示灰字，`Tab` 采纳；不在光标处时，在被改的那几行上划掉旧行、行尾预览新文本，并在光标所在行给出提示，按 `Ctrl+Alt+Enter` 采纳、`Ctrl+Alt+]` 跳到建议处。
- **JetBrains 怎么显示与采纳**：在被改的代码旁弹出差异浮层，`Tab` 或 `Ctrl+Alt+Enter` 采纳，`Esc` 拒绝。
- **采纳前不写入**：提示只是预览，不碰文档、不进撤销栈；采纳时只替换建议里那几行，并且是一次独立的撤销步骤。
- **不提示的情况**：最近 30 秒没有任何编辑；文件只读；光标处有选区或有多个光标；文件过大；本次启动还没打开过 Wave 聊天面板（模型与凭据来自会话）。
- **隐私**：与补全同一条链路——只有上述编辑片段、光标附近的代码与文件路径会随请求发到你已配置的模型服务，不会上传整个文件或整个仓库。

![VS Code：被改的行划掉旧文本、行尾预览新文本，光标所在行给出采纳提示](/plugin-shots/next-edit-vscode-inline.webp)

![JetBrains：要改的那行直接在代码上划掉，浮层给出替换写法，Tab 接受、Esc 拒绝](/plugin-shots/next-edit-jetbrains-popup.webp)

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

<figure><img src="/screenshots/spec-model-picker.webp" alt="输入卡片底栏的模型选择器" /><figcaption>输入卡片底栏的模型选择器</figcaption></figure>

<figure><img src="/screenshots/spec-file-suggestions.webp" alt="文件建议下拉列表" /><figcaption>文件建议下拉列表</figcaption></figure>

<figure><img src="/screenshots/ide-context-suggestions.webp" alt="输入 @ 时的 Terminal / Problems 条目" /><figcaption>输入 @ 时的 Terminal / Problems 条目</figcaption></figure>

<figure><img src="/screenshots/ide-context-tags.webp" alt="用户消息里的 Terminal / Problems 标签" /><figcaption>用户消息里的 Terminal / Problems 标签</figcaption></figure>

<figure><img src="/screenshots/ide-context-preview.webp" alt="点开标签查看终端输出全文" /><figcaption>点开标签查看终端输出全文</figcaption></figure>

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

<figure><img src="/screenshots/spec-background-task-workflow.webp" alt="后台任务管理 - 工作流进度" /><figcaption>后台任务管理 - 工作流进度</figcaption></figure>

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

在输入框中输入 `/resume` 可打开与顶部「历史对话」按钮完全相同的会话列表（范围一致：当前工作区目录，含命令行在同一目录创建的会话），不用离开聊天面板即可切换会话。

聊天面板顶部的会话标题也可以直接点击改名：标题就地变成输入框并全选原文，`Enter` 或点击别处保存、`Esc` 取消；保存失败时回滚为原标题并给出可见提示。标题以 `custom-title` 保留条目写在会话自己的 JSONL 文件里，因此与命令行、桌面端读到的标题一致——命令行 `/rename`、选择器内 `Ctrl+R` 改过的名字，在插件端头部也会显示。

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-chat-header-title-edit.webp" alt="点击标题就地改名" /><figcaption>点击标题就地改名</figcaption></figure>

<figure><img src="/screenshots/spec-rewind-button.webp" alt="用户消息上的回滚按钮" /><figcaption>用户消息上的回滚按钮</figcaption></figure>

<figure><img src="/screenshots/spec-rewind-popup.webp" alt="/rewind 检查点列表" /><figcaption>/rewind 检查点列表</figcaption></figure>

<figure><img src="/screenshots/spec-confirm-rewind.webp" alt="回滚确认对话框" /><figcaption>回滚确认对话框</figcaption></figure>

<figure><img src="/screenshots/spec-session-search.webp" alt="历史对话搜索与关键词高亮" /><figcaption>历史对话搜索与关键词高亮</figcaption></figure>

<figure><img src="/screenshots/spec-more-menu.webp" alt="更多菜单" /><figcaption>更多菜单</figcaption></figure>

</div>

### 9. 配置管理

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-settings-global.webp" alt="全局设置（基础设置）" /><figcaption>全局设置（基础设置）</figcaption></figure>

<figure><img src="/screenshots/spec-settings-personalization.webp" alt="个性化（AGENTS.md 与自动记忆）" /><figcaption>个性化（AGENTS.md 与自动记忆）</figcaption></figure>

<figure><img src="/screenshots/spec-hooks-list.webp" alt="钩子管理" /><figcaption>钩子管理</figcaption></figure>

<figure><img src="/screenshots/spec-mcp-settings.webp" alt="MCP 服务管理" /><figcaption>MCP 服务管理</figcaption></figure>

<figure><img src="/screenshots/spec-status-dialog.webp" alt="状态信息" /><figcaption>状态信息</figcaption></figure>

</div>

### 10. 插件系统

<div class="screenshot-gallery">

<figure><img src="/screenshots/spec-plugin-market.webp" alt="设置页插件市场（按市场分组 + 筛选 + 版本状态）" /><figcaption>设置页插件市场（按市场分组 + 筛选 + 版本状态）</figcaption></figure>

<figure><img src="/screenshots/plugin-search-filtered.webp" alt="关键词过滤效果" /><figcaption>关键词过滤效果</figcaption></figure>

<figure><img src="/screenshots/spec-plugin-scope.webp" alt="选择安装作用域" /><figcaption>选择安装作用域</figcaption></figure>

<figure><img src="/screenshots/spec-plugin-manage-markets.webp" alt="管理插件市场（官方市场只展示、自定义市场可移除、可添加新市场）" /><figcaption>管理插件市场（官方市场只展示、自定义市场可移除、可添加新市场）</figcaption></figure>

<figure><img src="/screenshots/spec-plugin-new-market.webp" alt="添加插件市场（本地路径 / 远程仓库）" /><figcaption>添加插件市场（本地路径 / 远程仓库）</figcaption></figure>

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
