# Agent SDK

核心 Node.js SDK，负责 AI 模型集成、工具系统、记忆管理与会话持久化。

## 安装

```bash
npm install wave-agent-sdk
```

## 核心能力

- **AI 模型集成** — 支持 OpenAI 兼容格式，可配置多模型（主模型 + 快速模型）
- **工具系统** — 内置 Bash、Read、Write、Edit、Glob、Grep、LSP 等工具，支持自定义工具注册
- **记忆管理** — AGENTS.md 项目记忆 + 自动记忆系统 + 记忆规则
- **会话持久化** — JSONL 格式会话存储，支持恢复与回滚
- **子代理系统** — 支持 Bash、Explore、Plan 等专用子代理
- **Skill 技能系统** — 可扩展的斜杠命令与技能插件
- **MCP 协议** — Model Context Protocol 集成
- **插件系统** — 官方插件市场 + 自定义插件支持
- **OpenTelemetry** — 内置遥测支持

## 基本用法

```typescript
import { Agent } from 'wave-agent-sdk';

const agent = await Agent.create({
  model: 'gpt-4',
  apiKey: process.env.WAVE_API_KEY,
  baseURL: 'https://api.example.com/v1',
  callbacks: {
    onAssistantContentUpdated: ({ chunk }) => {
      process.stdout.write(chunk);
    },
  },
});

await agent.sendMessage('帮我写一个排序算法');
```

## 开发

```bash
# 构建
pnpm -F wave-agent-sdk build

# 运行测试
pnpm -F wave-agent-sdk test

# 类型检查
pnpm -F wave-agent-sdk run type-check
```

## 内置 Skills {#builtin-skills}

### settings — 配置管理 {#skill-settings}

详见 [Settings Skill](#settings-skill)。用户可通过 `/settings` 以自然语言管理所有 Wave 设置。

### init — 代码库初始化 {#skill-init}

分析代码库并创建 `AGENTS.md` 文件，为后续 Agent 会话提供项目上下文指引。

- **名称**: `init`
- **特性**: 不会被 AI 自动调用，需用户通过 `/init` 手动触发

### loop — 定时循环任务 {#skill-loop}

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

## 内置 Subagents {#builtin-subagents}

### Bash — 命令执行 {#subagent-bash}

专门用于执行 bash 命令的代理，适用于 git 操作、命令执行、终端任务等。

- **工具**: `[Bash]`
- **模型**: 继承主代理模型

### Explore — 代码库探索 {#subagent-explore}

快速探索代码库的文件搜索专家，支持三种细致程度：`quick`、`medium`、`very thorough`。

- **工具**: `[Glob, Grep, Read, Bash, LSP]`
- **模型**: 快速模型（fastModel）
- **模式**: 只读，禁止任何文件修改操作

### Plan — 软件架构师 {#subagent-plan}

设计实现方案的软件架构师代理，返回分步策略、识别关键文件、考虑架构权衡。

- **工具**: `[Glob, Grep, Read, Bash, LSP]`
- **模型**: 继承主代理模型
- **模式**: 只读，禁止任何文件修改操作

### General-Purpose 代理 {#subagent-general-purpose}

用于研究复杂问题、搜索代码和执行多步骤任务的通用代理。

- **模型**: 继承主代理模型

## 记忆系统 {#memory-system}

### AGENTS.md 文件 {#agents-md}

Wave 使用 `AGENTS.md` 文件作为持久化的项目级和用户级指令，帮助 AI 在不同会话间保持一致的行为和上下文：

- **项目级**：`[project-root]/AGENTS.md`，存放在项目根目录，随代码库共享给所有协作者
- **用户级**：`~/.wave/AGENTS.md`，存放在用户全局目录，跨所有项目生效
- 内容在每次会话加载时自动注入系统提示词，确保 AI 始终遵循这些指令
- 与自动记忆系统互补：AGENTS.md 侧重长期稳定的项目指南和约定，自动记忆侧重会话过程中动态积累的项目洞察
- 自动记忆提取时会避免与 AGENTS.md 内容产生重复

### 消息压缩 (Message Compression) {#mechanism-context-management}

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

### 自动记忆系统 (Auto Memory) {#mechanism-auto-memory}

Wave 在后台自动维护项目记忆，帮助 AI 持续了解项目演变：

- 每 N 轮对话触发一次记忆提取（`autoMemoryFrequency` 配置，默认每 1 轮）
- 使用 `general-purpose` 子代理在后台异步执行，不影响主对话
- 自动检测 AI 是否已手动更新 `.wave/memory/` 目录下的文件，若有则跳过避免重复
- 提取代理仅允许写入 `.wave/memory/` 目录，使用快速模型，最多 5 轮，越权写入自动拒绝
- 支持 `autoMemoryEnabled` 开关（默认开启）
- 记忆文件存储在 `~/.wave/projects/{项目编码}/memory/` 目录，确保 git worktree 间共享同一记忆

### 记忆规则 (Memory Rules) {#mechanism-memory-rules}

记忆规则提供上下文特定的行为指南，确保 AI 在不同场景下遵循预期模式：

- 存放在 `.wave/rules/` 目录下的多个独立 `.md` 文件（项目级）和 `~/.wave/rules/`（用户级）
- 支持子目录递归扫描和符号链接跟随
- 每个文件是一个独立规则，支持 YAML frontmatter：
  - `paths`：glob 模式数组，仅当相关文件在上下文中时规则才激活（空则始终激活）
  - `priority`：优先级数字，控制冲突时的覆盖顺序
- 项目规则可覆盖用户规则

## Settings Skill {#settings-skill}

Wave 提供了一个强大的内置 `/settings` skill，作为用户与 Wave 配置系统交互的自然语言入口。用户无需手动编辑配置文件，只需用自然语言描述需求，AI 即可帮助查看、修改和引导配置。

**主要特性：**

- **自然语言配置**：通过对话方式管理所有 Wave 设置，如"显示我的当前设置"、"更新项目设置启用自动记忆"等。
- **三级作用域**：配置支持用户级（`~/.wave/settings.json`）、项目级（`.wave/settings.json`）和本地级（`.wave/settings.local.json`）。
- **热加载**：所有配置修改立即生效，无需重启 Wave。

### settings.json 配置中心 {#settings-json}

`settings.json` 是 Wave 的中央配置文件，支持自定义钩子、环境变量、工具权限等功能。

**使用示例：**

- "显示我当前的项目设置"
- "帮我在项目级设置里开启自动记忆"
- "用本地配置文件覆盖某个全局设置"

### 钩子 (Hooks) {#settings-hooks}

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

### 环境变量 {#settings-env}

通过 `env` 字段设置对所有工具和钩子可用的环境变量。常用 `WAVE_*` 变量包括：

- `WAVE_MODEL`、`WAVE_FAST_MODEL`：模型选择
- `WAVE_MAX_INPUT_TOKENS`、`WAVE_MAX_OUTPUT_TOKENS`：Token 限制
- `WAVE_API_KEY`、`WAVE_BASE_URL`：API 配置

**使用示例：**

- "帮我设置默认模型为 claude-3-7-sonnet-20250219"
- "把最大输出 tokens 调到 4096"
- "添加一个自定义环境变量 NODE_ENV=development"

### 工具权限 {#settings-permissions}

管理工具权限并定义"安全区域"（Safe Zone），支持 `allow`、`deny` 列表以及 `permissionMode` 配置。权限修改立即生效。

**使用示例：**

- "把权限模式改成自动接受修改"
- "允许 Read 和 Bash 工具无需确认"
- "扩展安全区域，把 /tmp/wave-exports 目录加进去"

### 模型配置 {#settings-models}

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

### Prompt 缓存 {#settings-prompt-cache}

SDK 默认对名称包含 `claude` 的模型自动启用 Prompt Cache（提示词缓存），通过在消息内容中插入 `ephemeral` 缓存标记来复用上下文，降低 API 调用成本。

对于其他支持 Prompt Cache 的模型（如 qwen3.6-plus 等），可通过设置环境变量 `WAVE_PROMPT_CACHE_REGEX` 来匹配模型名称，例如：

- `WAVE_PROMPT_CACHE_REGEX="qwen"` — 匹配 qwen 系列模型
- `WAVE_PROMPT_CACHE_REGEX="(qwen|claude)"` — 同时匹配 qwen 和 claude

### MCP 协议 {#settings-mcp}

配置外部 MCP 服务器连接，为 AI 提供额外的工具和上下文能力。支持两种连接方式：

- **本地进程（stdio）**：通过命令启动本地 MCP 服务，如 `npx`、`uvx`、`python` 等
- **远程 HTTP/SSE**：通过 URL 连接到远程 MCP 服务器，如 `https://example.com/sse`

用户可通过 `/settings 增加mcp：xxx` 快速添加。

**使用示例：**

- "增加一个 MCP 服务，用 npx 运行 github MCP 服务器"
- "添加一个远程 MCP 服务，URL 是 https://mcp.example.com/sse"
- "帮我查看当前配置了哪些 MCP 服务器"
- "移除某个不再使用的 MCP 连接"

### 记忆规则 {#settings-memory}

为 Agent 提供上下文特定的指令和指南，确保 AI 在不同场景下遵循预期的行为模式。

**使用示例：**

- "添加一条记忆规则：始终用中文回答"
- "帮我查看当前的记忆规则有哪些"
- "删除那条关于代码风格的记忆"

### 自定义 Skill {#settings-skills}

创建自定义 skill 以扩展 Wave 功能，处理特定复杂任务。用户可通过 `/settings 帮我写个skill，具体做xxx` 快速创建。

**使用示例：**

- "帮我写个 skill，自动把当前分支的代码部署到测试服务器"
- "创建一个 skill，用于定期生成项目文档"
- "列出我所有的自定义 skill"

### 子代理 {#settings-subagents}

定义专用的 AI 个性代理，将特定任务委托给专业化的子代理执行。

**使用示例：**

- "创建一个专门负责代码审查的子代理"
- "定义一个专注于前端 UI 设计的子代理"
- "帮我查看所有已配置的子代理"

### 插件配置 {#settings-plugins}

通过 `enabledPlugins` 启用或禁用插件。插件的 skill、hook、MCP 和 LSP 服务器可使用 `${WAVE_PLUGIN_ROOT}` 占位符引用其父插件目录。

**使用示例：**

- "禁用 xxx 插件"
- "帮我查看所有已启用的插件"
- "在插件的 hook 中使用 ${WAVE_PLUGIN_ROOT} 引用插件目录"

### 其他设置 {#settings-other}

- `language`：AI 通信首选语言（如 `"zh"`、`"en"`）。
- `autoMemoryEnabled`：启用或禁用自动记忆（默认：`true`）。
- `autoMemoryFrequency`：自动记忆提取频率（默认：`1`）。

**使用示例：**

- "把 AI 回复语言改为英文"
- "关闭自动记忆功能"
- "调整自动记忆的触发频率"

## 官方插件市场 {#plugin-marketplaces}

SDK 内置默认插件市场 `wave-plugins-official`（来源：[netease-lcap/wave-plugins-official](https://github.com/netease-lcap/wave-plugins-official)），自动启用且支持自动更新。该市场提供以下插件：

### document-skills {#plugin-document-skills}

文档处理套件，包含 **docx**（Word）、**xlsx**（Excel）、**pptx**（PowerPoint）和 **pdf** 四个技能组。AI 可以读取、创建和编辑各类办公文档，支持内容提取、格式转换和数据操作。

### typescript-lsp {#plugin-typescript-lsp}

TypeScript/JavaScript 语言服务器，通过 `typescript-language-server --stdio` 提供代码智能支持。包括代码补全、跳转定义、查找引用、符号搜索、类型提示和错误诊断等功能。

### chrome-devtools {#plugin-chrome-devtools}

Chrome DevTools Protocol MCP 服务器，通过 `npx chrome-devtools-mcp` 启动。支持浏览器自动化操作，包括页面导航、元素检查、截图、网络请求监控、控制台执行等。

### code2spec {#plugin-code2spec}

从代码生成规格说明文档的工具集。基于代码库自动创建 requirements、plan、tasks 等技术规格模板，帮助团队建立代码与文档的对应关系。

### code2cwspec {#plugin-code2cwspec}

从现有代码（.NET、Java 等老系统）逆向生成为 CodeWave 格式的规范模板。包含 **4 个子代理**：cw-architect（架构分析）、cw-researcher（代码调研）、cw-validator（规范校验）、cw-writer（文档生成），输出 requirements/plan/tasks 完整规范。

### commit-skills {#plugin-commit-skills}

简化的 Git 工作流技能集，包含 **5 个技能**：commit（提交）、commit-push-mr（提交并推送 MR）、commit-push-pr（提交并推送 PR）、watch-merge-mr（等待合并 MR）、watch-merge-pr（等待合并 PR）。支持从代码审查到合并的全流程自动化。

### speckit {#plugin-speckit}

规范驱动开发工具包（中文版），包含 **8 个技能**：analyze（需求分析）、checklist（检查清单）、clarify（需求澄清）、constitution（项目章程）、implement（实现指导）、plan（项目规划）、specify（规格编写）、tasks（任务分解）。适用于软件工程任务的规格说明与规划。

### deep-wiki {#plugin-deep-wiki}

AI 驱动的 Wiki 生成器，支持 Mermaid 图表、源码引用、入职指南和 llms.txt 生成。包含 **3 个子代理**（wiki-architect、wiki-researcher、wiki-writer）和 **3 个命令**（ask、build、generate），可自动生成项目文档知识库。

### tavily-search {#plugin-tavily-search}

Tavily AI 驱动的搜索引擎 MCP 服务器，通过 `https://mcp.tavily.com/mcp/` 提供网络搜索能力。支持实时信息检索、新闻查询、技术文档查找等场景。

### lcap-extension-component {#plugin-lcap-extension-component}

LCAP 低代码平台扩展组件开发指南。包含约 **17 个技能**，覆盖 ElementUI、ElementPlus、AntD、Mobile UI、Cloud UI 等平台组件，以及工作流护栏、图标、无障碍访问等专项能力。

### frontend-design {#plugin-frontend-design}

创建独特的、生产级前端界面设计技能。注重美学品质，避免千篇一律的 AI 审美风格，生成具有设计感的 Web 前端代码。

## OpenTelemetry 遥测 {#opentelemetry-telemetry}

Wave 支持 OpenTelemetry 可观测性标准，提供结构化的遥测数据（Traces、Metrics、Logs），帮助开发者观察 Agent 行为、调试性能问题并分析会话模式。

### 导出器 (Exporters) {#otel-exporters}

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

### Span 体系 {#otel-spans}

Wave 创建三层 Span 结构，完整记录用户交互到工具执行的全链路：

| Span 类型 | 说明 | 关键属性 |
|-----------|------|----------|
| **InteractionSpan** | 包裹一次完整的用户消息 → Agent 响应周期 | `user_prompt`（可选）、`user_prompt_length`、`interaction.sequence` |
| **LLMRequestSpan** | Interaction 的子 Span，表示单次 API 调用 | `model`、`input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_creation_tokens`、`ttft_ms`、`ttlt_ms`、`success`、`has_tool_call` |
| **ToolSpan** | Interaction 的子 Span，表示单次工具执行 | `tool_name`、`tool_input`（可选）、`success`、`error`、`duration_ms` |

- **父子关系**：一个 InteractionSpan 包含多个 LLMRequestSpan（多轮递归时）和多个 ToolSpan（并行工具调用时）
- **并行隔离**：使用 `AsyncLocalStorage` 确保并行工具执行时 Span 上下文不混淆
- **资源属性**：包含 `service.name: 'wave'`、`service.version`、`os.type`、`host.arch`

### 事件日志 (Event Logging) {#otel-events}

Wave 在关键会话生命周期节点记录结构化事件：

| 事件 | 触发时机 | 关键属性 |
|------|----------|----------|
| `session_start` | 会话启动 | `sessionId`、`model`、`workdir` |
| `session_end` | 会话结束 | `duration`、`totalTokens`、`exitReason` |
| `user_prompt` | 用户发送消息 | `prompt_length`、`prompt`（若启用） |
| `tool_decision` | 工具权限决策 | `tool_name`、`decision`、`source` |
| `compaction` | 自动压缩触发 | `beforeTokens`、`afterTokens`、`model` |
| `error` | 错误发生 | `error_type`、`message`、`stack`（截断） |

### PII 保护 {#otel-privacy}

默认情况下，用户提示文本和工具内容**不包含**在遥测数据中。需显式启用：

- `OTEL_LOG_USER_PROMPTS=1`：在事件中包含用户提示文本
- `OTEL_LOG_TOOL_CONTENT=1`：在事件中包含工具输入/输出内容

### 可靠性保障 {#otel-reliability}

- **优雅降级**：遥测初始化或导出失败时，Agent 正常运行不受影响，仅记录警告日志
- **关闭刷新**：进程退出时自动刷新遥测数据，超时时间可配置（默认 2 秒）
- **内存保护**：超过 30 分钟的活跃 Span 自动清理，防止长会话内存泄漏
- **懒加载**：遥测模块懒加载，不增加启动延迟

## 完整工具清单 {#complete-tool-reference}

Wave 提供 19 个内置工具，涵盖代码探索、文件操作、任务管理、网页抓取和定时任务等能力。每个工具在执行时以工具块形式展示，标题栏显示关键参数（Compact Parameters）。

### Bash — 终端命令执行 {#tool-bash}

| 参数 | 类型 | 说明 |
|------|------|------|
| `command` | string | 必需，要执行的命令 |
| `timeout` | number | 超时时间（秒） |
| `description` | string | 命令描述 |
| `run_in_background` | boolean | 是否后台执行 |

执行后显示 `shortResult`（输出最后 3 行摘要）。后台执行时返回任务 ID，可通过任务通知查看结果。

### Read — 读取文件 {#tool-read}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `offset` | number | 起始行号（默认 1） |
| `limit` | number | 最大读取行数（默认 2000） |

**特性**：支持图片读取（PNG/JPEG/GIF/WebP），自动检测二进制文档（PDF/DOCX 等返回错误提示），超长行自动截断（2000 字符）。对未变更的文件返回 "File unchanged" 避免重复内容。

Compact Parameters 格式：`src/main.ts 1:2000`

### Glob — 文件名模式匹配 {#tool-glob}

| 参数 | 类型 | 说明 |
|------|------|------|
| `pattern` | string | 必需，glob 模式（如 `**/*.ts`） |
| `path` | string | 搜索根目录 |
| `limit` | number | 最大返回数量（默认 100） |

Compact Parameters 格式：`src/**/*.ts in src`

### Grep — 文本内容搜索 {#tool-grep}

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

### Write — 写入文件 {#tool-write}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `content` | string | 必需，写入内容 |

**规则**：写入已存在文件前必须先 Read 确认当前内容；自动创建不存在的父目录。

Compact Parameters 格式：`src/new-file.ts 1 lines, 29 chars`

### Edit — 精确字符串替换 {#tool-edit}

| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 必需，文件路径 |
| `old_string` | string | 必需，要替换的原文 |
| `new_string` | string | 必需，替换后的新文 |
| `replace_all` | boolean | 是否批量替换所有匹配项 |

**规则**：非 `replace_all` 时若 `old_string` 在文件中出现多次则报错，提示提供更多上下文或使用 `replace_all=true`。

### LSP — 代码智能 {#tool-lsp}

支持操作：`goToDefinition`（查找定义）、`findReferences`（查找引用）、`hover`（悬停信息）、`documentSymbol`（文档符号）、`workspaceSymbol`（全局符号搜索）、`goToImplementation`（查找实现）、`prepareCallHierarchy`/`incomingCalls`/`outgoingCalls`（调用层级分析）。

Compact Parameters 格式：`goToDefinition src/main.ts:10:5`

### AskUserQuestion — 交互式提问 {#tool-askuser}

| 参数 | 类型 | 说明 |
|------|------|------|
| `questions` | array | 必需，问题列表 |
| `questions[].question` | string | 问题内容 |
| `questions[].header` | string | 简短标签（最多 12 字符） |
| `questions[].options` | array | 选项列表（2-4 个），每项含 `label` 和可选 `description` |
| `questions[].multiSelect` | boolean | 是否允许多选 |

### WebFetch — 网页内容抓取 {#tool-webfetch}

| 参数 | 类型 | 说明 |
|------|------|------|
| `url` | string | 必需，要抓取的 URL |
| `prompt` | string | 必需，对抓取内容的处理指令 |

**特性**：内置 15 分钟 LRU 缓存（最大 50MB），自动将 HTTP 升级到 HTTPS，HTML 自动转 Markdown，使用快速模型处理摘要。内容上限 100K 字符。GitHub URL 提示使用 `gh` CLI。跨域重定向自动拦截并提示。

### ToolSearch — 延迟加载工具发现 {#tool-toolsearch}

| 参数 | 类型 | 说明 |
|------|------|------|
| `query` | string | 必需，搜索查询 |
| `max_results` | number | 最大返回数量（默认 5） |

**查询格式**：
- `select:ToolName` — 按名称精确匹配（逗号分隔多个）
- `notebook jupyter` — 关键词搜索
- `+slack send` — `+` 前缀表示必需匹配项

用于发现延迟加载工具（deferred tools）的完整 schema，获取后即可调用。

### EnterWorktree / ExitWorktree — Git Worktree 隔离 {#tool-worktree}

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

### CronCreate / CronDelete / CronList — 定时任务 {#tool-cron}

**CronCreate 参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `cron` | string | 必需，5 字段 cron 表达式（本地时区） |
| `prompt` | string | 必需，要执行的内容 |
| `recurring` | boolean | 是否循环（默认 true） |

**CronDelete 参数**：`id` — 任务 ID
**CronList 参数**：无

**限制**：最多 50 个任务，循环任务 7 天自动过期。

### TaskCreate / TaskGet / TaskUpdate / TaskList — 任务管理 {#tool-task}

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

### TaskStop — 中止后台任务 {#tool-taskstop}

| 参数 | 类型 | 说明 |
|------|------|------|
| `task_id` | string | 必需，要中止的后台任务 ID |
