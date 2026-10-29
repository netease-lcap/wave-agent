---
title: Settings Skill
description: Settings Skill：用自然语言管理 settings.json 的钩子、环境变量、模型、权限、MCP、记忆、技能、子代理与插件配置
---

# Settings Skill {#settings-skill}

Wave 提供了一个强大的内置 `/settings` skill，作为用户与 Wave 配置系统交互的自然语言入口。用户无需手动编辑配置文件，只需用自然语言描述需求，AI 即可帮助查看、修改和引导配置。

**主要特性：**

- **自然语言配置**：通过对话方式管理所有 Wave 设置，如"显示我的当前设置"、"更新项目设置启用自动记忆"等。
- **三级作用域**：配置支持用户级（`~/.wave/settings.json`）、项目级（`.wave/settings.json`）和本地级（`.wave/settings.local.json`）。
- **热加载**：所有配置修改立即生效，无需重启 Wave。

## settings.json 配置中心 {#settings-json}

`settings.json` 是 Wave 的中央配置文件，支持自定义钩子、环境变量、工具权限等功能。

**使用示例：**

- "显示我当前的项目设置"
- "帮我在项目级设置里开启自动记忆"
- "用本地配置文件覆盖某个全局设置"

## 钩子 (Hooks) {#settings-hooks}

钩子允许在特定事件发生时自动执行任务，实现工作流自动化。Wave 支持以下钩子事件：

| 事件名称            | 触发时机                                                             |
| ------------------- | -------------------------------------------------------------------- |
| `PreToolUse`        | 工具执行前（可用于校验、拦截或预处理）                               |
| `PostToolUse`       | 工具执行完成后（可用于后处理或日志记录）                             |
| `UserPromptSubmit`  | 用户提交 Prompt 时                                                   |
| `PermissionRequest` | Wave 请求工具权限时                                                  |
| `Stop`              | Wave 完成响应周期（无更多工具调用）时                                |
| `SubagentStop`      | 子代理完成响应周期时                                                 |
| `WorktreeCreate`    | 创建新 worktree 时（hook 接管创建，见下方说明）                      |
| `WorktreeRemove`    | 删除 hook-based worktree 时（hook 接管删除，见下方说明）             |
| `CwdChanged`        | 工作目录变化时（如进入/退出 worktree，非阻塞）                       |
| `SessionStart`      | 会话开始时（来源：`startup` / `resume` / `compact` / `clear`）       |
| `SessionEnd`        | 会话结束时（来源：`exit` / `stop` / `compact` / `resume` / `clear`） |
| `PreCompact`        | 压缩前触发（stdout 作为附加指令合并进压缩 prompt）                   |
| `PostCompact`       | 压缩完成后触发（接收压缩摘要文本）                                   |

**钩子配置要点：**

- **WorktreeCreate（接管创建）**：配置该 hook 后，Wave 不再执行 `git worktree add`，由 hook 自行完成创建（如 `git worktree add` 或任何其他 VCS/外部资源准备），并将 worktree 的**绝对路径输出到 stdout**（首个成功 hook 的路径生效，async hook 不贡献路径）。所有 hook 失败或无输出时创建被阻止。接收 `name` 输入，创建的会话标记为 hook-based。
- **WorktreeRemove（接管删除）**：仅对 hook-based worktree（由 `WorktreeCreate` hook 创建）触发，Wave 不执行 `git worktree remove`，由 hook 自行完成删除（如 `git worktree remove --force` 及外部资源清理）。在 worktree 目录被删除**之前**触发，hook 仍可读取目录内文件。失败仅记录日志、不阻塞。git 直接创建的 worktree 由 git 删除，不触发此 hook。
- **模式匹配**：支持通过 `matcher` 匹配工具名（如 `Write`、`Read*`、`/^Edit/`），适用于 `PreToolUse`、`PostToolUse` 和 `PermissionRequest`。
- **异步执行**：支持 `async` 字段配置后台异步执行，避免阻塞工作流。
- **超时控制**：支持 `timeout` 字段设置最大执行时间（默认 600 秒）。
- **退出码控制**：`0` = 成功继续；`2` = 阻塞错误，阻止操作；其他 = 非阻塞错误，继续但显示警告。
- **输入上下文**：Wave 通过 `stdin` 向钩子进程传递 JSON 格式的详细信息。
- **热加载**：配置文件修改后即时生效，无需重启 Wave。

## 环境变量 {#settings-env}

通过 `env` 字段设置对所有工具和钩子可用的环境变量，也可直接在系统环境中设置。

### WAVE\_\* 变量

| 变量                         | 描述                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `WAVE_MODEL`                 | 默认 AI 模型                                                                                                  |
| `WAVE_FAST_MODEL`            | 快速模型（用于子代理、摘要等轻量场景）                                                                        |
| `WAVE_VISION_MODEL`          | 视觉模型（用于内置 `vision` 子代理的图像识别；设置后仍需主模型声明 `"vision": false` 才会启用，未设置则禁用） |
| `WAVE_API_KEY`               | API Key                                                                                                       |
| `WAVE_BASE_URL`              | API Base URL                                                                                                  |
| `WAVE_SERVER_URL`            | Wave AI 服务端地址（用于 SSO）                                                                                |
| `WAVE_CUSTOM_HEADERS`        | 自定义请求头（JSON 格式）                                                                                     |
| `WAVE_MAX_INPUT_TOKENS`      | 最大输入 Token 数                                                                                             |
| `WAVE_MAX_OUTPUT_TOKENS`     | 最大输出 Token 数                                                                                             |
| `WAVE_DISABLE_AUTO_MEMORY`   | 禁用自动记忆                                                                                                  |
| `WAVE_AUTO_MEMORY_FREQUENCY` | 自动记忆触发频率                                                                                              |
| `WAVE_PLUGIN_GIT_TIMEOUT_MS` | 插件 Git 操作超时（毫秒）                                                                                     |
| `WAVE_TASK_LIST_ID`          | 显式指定会话的任务列表 ID（默认取会话 ID）                                                                    |

### OTEL\_\* 变量（OpenTelemetry）

| 变量                              | 描述                                               |
| --------------------------------- | -------------------------------------------------- |
| `DISABLE_TELEMETRY`               | 总闸：设为 `1` 关闭全部遥测出站（含首方上报）      |
| `OTEL_METRICS_EXPORTER`           | 指标导出目标（`console` / `otlp` / `none` 关闭）   |
| `OTEL_LOGS_EXPORTER`              | 日志导出目标（`console` / `otlp` / `none` 关闭）   |
| `OTEL_EXPORTER_OTLP_ENDPOINT`     | OTLP 导出端点                                      |
| `OTEL_EXPORTER_OTLP_PROTOCOL`     | 导出协议（`grpc` / `http`）                        |
| `OTEL_EXPORTER_OTLP_HEADERS`      | 导出附加头（`k=v,k2=v2`）                          |
| `OTEL_LOG_USER_PROMPTS`           | 是否记录用户 Prompt                                |
| `OTEL_LOG_TOOL_CONTENT`           | 是否记录工具调用内容                               |
| `OTEL_METRICS_INCLUDE_SESSION_ID` | 指标是否带 `session.id`（默认开）                  |
| `OTEL_METRICS_INCLUDE_REPOSITORY` | 指标是否带 `vcs.repository.*`（默认关）            |
| `OTEL_METRICS_INCLUDE_ENTRYPOINT` | 指标是否带 `app.entrypoint`（默认关）              |
| `OTEL_RESOURCE_ATTRIBUTES`        | 遥测资源的自定义标签（如 `department.name=infra`） |
| `OTEL_SHUTDOWN_TIMEOUT_MS`        | 关闭超时时间（毫秒）                               |
| `OTEL_HEADERS_DEBOUNCE_MS`        | 出站头命令的刷新间隔（毫秒，默认 29 分钟）         |

## 工具权限 {#settings-permissions}

管理工具权限并定义"安全区域"（Safe Zone），支持 `allow`、`deny` 列表以及 `defaultMode` 配置（配置键对齐 Claude Code 的 `permissions.defaultMode`）。权限修改立即生效。

## 模型配置 {#settings-models}

在 `models` 字段中定义 AI 模型及其专属参数。生成参数需嵌套在每个模型的 `options` 子对象下：

- `temperature`：控制输出的随机性
- `reasoning_effort`：推理强度（`low`/`medium`/`high`），适用于支持推理的模型
- `thinking`：是否开启思考模式及预算 tokens，如 `{"type": "enabled", "budget_tokens": 2048}`

```json
{
  "models": {
    "claude-3-7-sonnet-20250219": {
      "options": {
        "thinking": { "type": "enabled", "budget_tokens": 2048 },
        "temperature": 1.0
      }
    },
    "o3-mini": {
      "options": {
        "reasoning_effort": "high"
      }
    }
  }
}
```

此外还支持 `fastModel` 配置，用于网页抓取摘要、对话摘要等轻量场景，以及声明了 `model: fastModel` 的自定义子代理（内置子代理已改为继承主模型）。

每个模型还可以通过 `maxInputTokens`（模型条目顶层，不在 `options` 内）设置其输入上下文窗口。该值覆盖全局的 `WAVE_MAX_INPUT_TOKENS`，压缩阈值和用量显示会按各模型自己的值生效：

```json
{
  "models": {
    "deepseek-v4-flash": { "maxInputTokens": 200000 },
    "kimi-k3": { "maxInputTokens": 131072 }
  }
}
```

`maxInputTokens` 解析优先级：构造函数参数 > options > `models[模型].maxInputTokens` > `WAVE_MAX_INPUT_TOKENS` > 默认值。子代理（如 `fastModel`/`visionModel`）会按实际使用的模型查找对应值。

## 模型能力配置 {#settings-capabilities}

在 `models` 字段中通过 `capabilities` 声明式配置每个模型的能力，支持以下字段：

- `promptCaching`：是否支持 Prompt Cache（提示词缓存）。设为 `true` 时，SDK 会在消息内容中插入 `ephemeral` 缓存标记来复用上下文，降低 API 调用成本。默认 `false`。
- `vision`：是否支持图像识别（视觉）。设为 `false` 时，SDK 会在发送前自动剥离图像并用文本占位符替换；若同时设置了 `WAVE_VISION_MODEL`，内置 `vision` 子代理随之可用，该模型可把图像识别委托出去。默认 `true`（不声明即视为能看图，此时内置 `vision` 子代理不注册）。

```json
{
  "models": {
    "claude-sonnet-4": {
      "capabilities": { "promptCaching": true, "vision": true }
    },
    "deepseek-r1": {
      "capabilities": { "vision": false }
    },
    "qwen-plus": {
      "capabilities": { "promptCaching": true }
    }
  }
}
```

> **注意**：`promptCaching` 默认为 `false`。即使是 Claude 模型，也需要显式声明 `capabilities: { promptCaching: true }` 才会启用缓存。

## MCP 协议 {#settings-mcp}

配置外部 MCP 服务器连接，支持本地进程（stdio）和远程 HTTP/SSE 两种方式。用户可通过 `/settings 增加mcp：xxx` 快速添加。

## 记忆规则 {#settings-memory}

为 Agent 提供上下文特定的指令和指南，确保 AI 在不同场景下遵循预期的行为模式。

## 自定义 Skill {#settings-skills}

创建自定义 skill 以扩展 Wave 功能，处理特定复杂任务。用户可通过 `/settings 帮我写个skill` 快速创建。

## 子代理 {#settings-subagents}

定义专用的 AI 个性代理，将特定任务委托给专业化的子代理执行。

## 插件配置 {#settings-plugins}

通过 `enabledPlugins` 启用或禁用插件。插件的 skill、hook、MCP 和 LSP 服务器可使用 `${WAVE_PLUGIN_ROOT}` 占位符引用其父插件目录。

## 其他设置 {#settings-other}

- `language`：AI 通信首选语言（如 `"zh"`、`"en"`）。
- `autoMemoryEnabled`：启用或禁用自动记忆（默认：`true`）。
- `autoMemoryFrequency`：自动记忆提取频率（默认：`1`）。
- `enableArtifact`：启用 Artifact 工具（默认：`true`）。未设置时跟随代码默认值（已登录时默认启用，未登录时默认禁用——所有请求都要带 SSO token，没有账号时开着也用不了）；设为 `false` 关闭 [Artifact 工具](./tool-artifact#tool-artifact) 与 `/artifact` 内置技能，设为 `true` 则强制注册（未登录也注册，首次调用会提示先 `/login`）。服务端下发的同名配置优先于本地设置。改动后配置热重载即时生效，无需重启会话；会话内登录/登出同样即时重新评估。
- `enableExec`：启用 [Exec 工具](./tool-exec#tool-exec)（默认：`true`）。未设置时跟随代码默认值（当前默认开启）；启用时延迟工具（内置 + MCP）从扁平声明中撤下、改由尾部公告呈现（会话能力不变），设为 `false` 则不注册 `Exec`、延迟工具逐条扁平声明——这也是"一键退回旧形态"的回退入口。服务端下发的同名配置优先于本地设置。改动后配置热重载即时生效，无需重启会话。
- `leanPrompt`：使用精简档提示词（默认：`true`）。未设置时跟随代码默认值（当前默认开启）；设为 `false` 退回完整档。精简档把静态系统提示词换成「身份句 + 安全说明 + `# Harness`」，并给每个声明了精简文案的内置工具下发精简 description——**只替换文本**，工具集合、参数 schema、权限判定与运行时行为完全不变。MCP 工具的描述不受影响。改动后下一轮请求即生效。
- `worktree.baseRef`：新建 worktree 的基准引用。`"fresh"`（默认）基于 `origin/<默认分支>` 创建新分支；`"head"` 基于当前本地 HEAD 创建，跳过 origin 解析与网络 fetch。适用于基于尚未推送的本地分支工作的场景。
- `cleanupPeriodDays`：会话 jsonl 保留期（天），启动时后台清理过期会话文件（默认：`30`，对齐 Claude Code）。设为 `0` 跳过清理。作用域 user → project → local 依次覆盖（last-wins）。详见 [会话文件存储](./sessions#session-storage)。
