---
name: "Agent 配置"
description: "基于构造函数的配置替代环境变量，支持 max output tokens 和自定义 headers"
order: 60
---

# 功能规格说明：Agent 配置

**创建日期**：2025-01-27

## 用户场景与测试 _（必填）_

### 用户故事：显式 AI 服务配置（优先级：P1）

开发者需要通过 Agent 构造函数显式配置 AI 网关设置（API 密钥、基础 URL、模型 ID），而不是依赖环境变量，提供更好的可控性和可测试性。

**为什么是这个优先级**：这是启用显式配置管理并通过使必需配置可见和可控来提高 API 可用性的核心功能。

**独立测试**：可以通过使用自定义 AI 配置创建 Agent 实例并验证它使用这些设置而非环境变量来完整测试。

**验收场景**：

1. **假设**开发者使用自定义 AI 配置创建 Agent，**当**代理处理消息时，**则**它使用提供的配置值
2. **假设**未向 Agent 构造函数提供配置，**当**设置了环境变量时，**则**代理使用环境变量值

---

### 用户故事：Token 限制配置（优先级：P2）

开发者需要通过 Agent 构造函数配置自定义 token 限制，以控制消息压缩行为和最大输出 token，而无需设置环境变量。

**为什么是这个优先级**：Token 限制配置影响性能和成本管理，但次于基本 AI 功能。

**独立测试**：可以通过使用自定义 token 限制创建 Agent 并验证在指定限制处触发压缩来独立测试。

**验收场景**：

1. **假设**开发者通过 Agent 构造函数设置了自定义 token 限制，**当**token 使用超过该限制时，**则**触发消息压缩
2. **假设**未提供 token 限制，**当**创建代理时，**则**它使用合理的默认 token 限制

---

### 用户故事：模型选择配置（优先级：P3）

开发者需要通过 Agent 构造函数指定默认 AI 模型（代理模型和快速模型），以避免对环境变量的硬编码模型依赖。

**为什么是这个优先级**：模型配置提供灵活性，但作为核心功能的第三优先级，因为默认模型可以适用于大多数用例。

**独立测试**：可以通过使用自定义模型配置创建 Agent 并验证指定模型用于 AI 操作来测试。

**验收场景**：

1. **假设**开发者通过 Agent 构造函数指定了自定义模型，**当**执行 AI 操作时，**则**使用指定模型而非默认模型

---

### 用户故事：可配置最大输出 Token（优先级：P2）

作为开发者，我希望通过环境变量、代理创建选项或直接调用参数指定 AI 响应的最大输出 token。

**为什么是这个优先级**：对控制响应长度和成本至关重要。

**独立测试**：设置 `WAVE_MAX_OUTPUT_TOKENS=2048` 或向 `Agent.create` 传递 `maxTokens: 1024` 并验证 AI 服务调用使用正确的限制。

**验收场景**：

1. **假设**`WAVE_MAX_OUTPUT_TOKENS` 设置为 `2048`，**当**调用 `callAgent` 时，**则**请求使用 2048 作为最大 token 限制
2. **假设**代理创建时带有 `maxTokens: 1024`，**当**调用 `callAgent` 时，**则**请求使用 1024 作为最大 token 限制

---

### 用户故事：通过环境变量配置 SDK 自定义请求头（优先级：P2）

作为开发者，我希望使用 `WAVE_CUSTOM_HEADERS` 环境变量配置 SDK 的自定义 HTTP 请求头，以管理认证或环境特定的元数据。

**为什么是这个优先级**：支持替代认证方法和更好的安全实践。

**独立测试**：设置 `WAVE_CUSTOM_HEADERS="X-Test: 123\nY-Test: 456"`，初始化 SDK，并验证发出的请求包含这些请求头。

**验收场景**：

1. **假设**`WAVE_CUSTOM_HEADERS` 设置为 `X-Test: 123`，**当**SDK 发出请求时，**则**它包含请求头 `X-Test: 123`
2. **假设**未提供 `apiKey` 但在 `WAVE_CUSTOM_HEADERS` 中设置了自定义认证请求头，**当**SDK 初始化时，**则**它不抛出验证错误

---

### 用户故事：配置首选语言（优先级：P1）

作为用户，我希望在设置文件或代理选项中指定我的首选语言，以便代理用该语言与我交流。

**为什么是这个优先级**：使非英语使用者能够更有效地与代理交互。

**独立测试**：在 `Agent.create()` 或 `settings.json` 中设置 `language: "Chinese"` 并验证系统提示包含语言指令。

**验收场景**：

1. **假设**语言设置为 "Chinese"，**当**我向代理提问时，**则**代理用中文回答
2. **假设**语言设置为 "Spanish"，**当**代理解释函数 `calculateTotal()` 时，**则**解释用西班牙语但 `calculateTotal()` 保持不变

---

### 用户故事：自定义环境变量（优先级：P1）

开发者需要将自定义环境变量（API 密钥、数据库 URL、功能标志）传递给 Wave Agent SDK，而不需要在代码中硬编码。他们在 settings.json 文件中添加 "env" 字段，并期望这些变量在代理执行上下文中可用。这些变量被存入 Agent 的**会话级环境快照**（`ConfigurationService` 实例，每个会话独立），优先级高于 OS 环境变量，但**不写入 `process.env`**——这样在 stdio 多会话模式下，一个进程承载多个会话时不会相互污染。**例外**：`WAVE_SERVER_URL` 因需被进程级单例（`AuthService`、远端设置后台拉取）读取，会额外镜像写入 `process.env`（详见边界说明）。Wave Code CLI 将继承此功能，因为它使用 SDK。

**为什么是这个优先级**：这提供了必要的配置灵活性，并遵循安全最佳实践，将敏感数据保留在配置文件中而非代码中。

**独立测试**：可以通过将 env 变量添加到 settings.json 并验证它们在代理进程中可访问来完整测试，提供即时配置价值。

**验收场景**：

1. **假设**settings.json 文件包含带有键值对的 env 字段，**当**Wave Agent SDK 启动时，**则**这些环境变量存入该 Agent 的**会话级环境快照**（per-session env snapshot），优先级高于 OS 环境变量；它们**不写入 `process.env`**（`WAVE_SERVER_URL` 例外，见验收场景 6 与边界说明）
2. **假设**用户级和项目级 settings.json 文件都包含 env 字段，**当**代理运行时，**则**项目级环境变量覆盖同名的用户级变量
3. **假设**env 字段格式无效，**当**设置被加载时，**则**系统显示关于无效环境变量配置的清晰错误消息
4. **假设**一个 stdio 进程承载多个会话（不同项目/workdir），且各自的 settings.json `env` 设置了不同的 `WAVE_MODEL`/`WAVE_API_KEY`，**当**任一会话解析网关/模型配置时，**则**只读取本会话的快照，不发生"后启动会话覆盖前一会话"的污染（last-session-wins 污染消除）
5. **假设**settings.json `env` 中的变量被子进程（bash、hooks、bang、后台任务、MCP 模板替换）读取，**当**这些子进程启动时，**则**其环境为 `OS env + 本会话快照` 的合并（基础设施子进程如 git/worktree/LSP 仍只读 OS env）
6. **假设**settings.json `env` 中设置了 `WAVE_SERVER_URL`，**当**配置被加载时，**则**该值既存入会话快照、也镜像写入 `process.env`，使进程级单例 `AuthService`/`remoteSettingsService` 能读到它（详见边界说明）

---

### 用户故事：CLI 不在运行时强制 NODE_ENV，子进程环境与用户原始环境一致（优先级：P1）

Wave Code CLI 入口曾强制 `process.env.NODE_ENV ||= "production"`，以加载 React/ink 生产构建——react-reconciler 开发构建每次组件渲染都会向 Node 全局 perf buffer 写入 `performance.measure()` 条目（永不清空），长会话累积到百万条会触发 `MaxPerformanceEntryBufferExceededWarning` 并泄漏约 150MB。但 `process.env` 的修改会被所有 spawn 的子进程继承：wave 是常驻 daemon，它生成的每个 shell（Bash 工具、`!` bang 命令、后台任务、hooks、shell 快照捕获）都带 `NODE_ENV=production`，导致 `npm install`/`pnpm install` 跳过 devDependencies、构建与测试框架行为被改变。作为 wave 会话中的开发者，我希望子进程环境与启动 wave 时的原始环境一致（未设置 `NODE_ENV` 即不含该键），以便 `npm install` 等命令与普通登录 shell 行为一致。

**为什么是这个优先级**：这是静默行为破坏——依赖缺失报错时根因（`NODE_ENV`）与环境无关，排查成本高，影响所有把 wave 当作开发环境执行命令的用户。React 生产构建由构建期 esbuild define 保证（对齐 Claude Code 的做法：编译期替换 `process.env.NODE_ENV`，运行时不做修改），因此运行时强制并非必要。

**独立测试**：在无 `NODE_ENV` 的环境启动 wave，`echo $NODE_ENV` 应为空、`npm install` 正常安装 devDependencies；在 `NODE_ENV=development` 环境启动 wave，CLI 进程与子进程均保持 `development`。

**验收场景**：

1. **假设**用户环境未设置 `NODE_ENV` 且启动 wave CLI，**当**CLI 进程加载时，**则**CLI 自身 `process.env.NODE_ENV` 保持未设置（不注入 `production`），React 生产构建由构建期 define 保证，无 `MaxPerformanceEntryBufferExceededWarning`
2. **假设**用户显式设置 `NODE_ENV=development` 启动 wave，**当**CLI 加载时，**则**`process.env.NODE_ENV` 保持 `development`，不被覆盖
3. **假设**用户环境未设置 `NODE_ENV`，**当**wave 会话内通过 Bash 工具、`!` bang 命令、后台任务或 hooks 启动子进程时，**则**子进程环境不包含 `NODE_ENV`，`echo $NODE_ENV` 输出为空（与普通登录 shell 一致）
4. **假设**用户以 `NODE_ENV=development` 启动 wave，**当**wave 会话内启动子进程时，**则**子进程的 `NODE_ENV` 为 `development`
5. **假设**用户环境未设置 `NODE_ENV`，**当**wave 会话内运行 `npm install` 时，**则**devDependencies 被正常安装，不被 `production` 跳过

---

### 用户故事：设置实时重载（优先级：P2）

开发者正在积极工作，需要修改其 settings.json 配置（hooks、环境变量等）。他们希望这些更改立即生效而无需重启 SDK，实现配置的快速迭代。Wave Code CLI 将受益于此，因为它使用 SDK。

**为什么是这个优先级**：消除工作流中断并通过消除配置更改的重启要求来提高开发者生产力。

**独立测试**：可以通过在 CLI/SDK 运行时修改 settings.json 并验证新配置在下次操作时生效来测试。

**验收场景**：

1. **假设**Wave Agent SDK 正在运行，**当**用户修改 settings.json 时，**则**更改被检测并应用于后续操作，无需重启
2. **假设**Wave Agent SDK 正在处理请求，**当**settings.json 被更新时，**则**新设置用于下次代理执行
3. **假设**保存了无效设置，**当**文件监视器检测到更改时，**则**系统记录错误但继续使用之前的有效配置

---

### 用户故事：按子代理类型设置请求头（优先级：P2）

SDK 用户需要按子代理类型配置不同的 HTTP 请求头，以便 `customFetch` 可以区分主代理调用和子代理调用，实现请求级路由、速率限制和可观测性。

**为什么是这个优先级**：对多代理可观测性和路由重要，但次于核心配置。

**独立测试**：使用 `subagentHeaders: { "Explore": { "X-Subagent-Type": "Explore" } }` 创建 Agent，生成 Explore 子代理，并验证子代理的 `defaultHeaders` 包含类型特定请求头。

**验收场景**：

1. **假设**Agent 带有 `subagentHeaders: { "Explore": { "X-Subagent-Type": "Explore" } }`，**当**创建 Explore 子代理时，**则**子代理的 `defaultHeaders` 包含 `X-Subagent-Type: Explore`
2. **假设**Agent 配置了 `subagentHeaders`，**当**创建不在 `subagentHeaders` 中的子代理类型时，**则**子代理仅接收父级 `defaultHeaders`，无额外键
3. **假设**Agent 带有 `defaultHeaders: { "X-Shared": "base" }` 和 `subagentHeaders: { "Explore": { "X-Shared": "explore-override" } }`，**当**创建 Explore 子代理时，**则**子代理接收 `X-Shared: explore-override`
4. **假设**Agent 配置了 `subagentHeaders`，**当**为子代理请求调用 `customFetch` 时，**则**`init.headers` 包含合并后的类型特定请求头

---

### 用户故事：IDE 插件配置对话框（优先级：P1）

作为 IDE 插件用户，我希望通过 `/config` 或头部设置按钮打开配置对话框，填写 API Key、API 地址等配置，以便无需登录即可正常使用插件。

**为什么是这个优先级**：这是未登录用户使用 IDE 插件的主要配置入口，直接影响插件可用性。

**独立测试**：在 IDE 中打开配置对话框，填写 API Key 与 API 地址并保存，验证对话框自动关闭且无需登录即可发起对话。

**验收场景**：

1. **假设**用户在 IDE 中输入 `/config` 或点击头部设置按钮，**当**对话框打开时，**则**显示"全局"和"模型"两个标签页，并载入当前已保存的配置。
2. **假设**对话框处于"全局"标签页，**当**页面渲染时，**则**提供界面语言选择（中文 / English）。
3. **假设**对话框处于"模型"标签页，**当**页面渲染时，**则**提供 API Key（密码式隐藏输入）、自定义请求头、API 地址、模型名称、快速模型名称五个输入项。
4. **假设**用户点击保存，**当**保存进行中时，**则**所有输入与按钮禁用并显示"保存中..."。
5. **假设**保存成功，**当**响应返回时，**则**对话框自动关闭，新配置立即对所有会话生效。
6. **假设**保存或加载失败，**当**失败发生时，**则**对话框内显示错误原因。
7. **假设**用户尚未完成配置，**当**对话框打开时，**则**显示引导文案"保存后，优先使用此配置，无需登录即可正常使用插件。"
8. **假设**对话框已打开，**当**用户点击对话框外区域、按下 Escape 或点击取消/关闭按钮时，**则**对话框关闭且未保存的修改不生效。

---

### 用户故事：快速模型思考禁用配置（优先级：P1）

用户将推理模型（如 deepseek-v4-flash）配置为快速模型（fastModel）后，WebFetch 内容处理、快速子代理（`model: fastModel`）等轻量任务会偶发 "Empty response from AI" 错误——推理模型的思考（reasoning）消耗了全部输出 token（max_tokens），导致 content 为空。用户希望为不同模型配置各自的"禁用思考"参数，使快速模型场景可按需禁用思考、稳定返回内容，同时不影响主代理对话（agent loop）中的思考能力。

**为什么是这个优先级**：这是快速模型场景空响应错误的直接修复，影响 WebFetch 等常用工具的可用性。

**独立测试**：分别配置与不配置 `models[X].disableThinkingOptions`，触发 WebFetch 内容处理与快速子代理，验证请求携带正确参数；同时验证主代理对话与自动记忆提取、上下文压缩等后台 fork 请求不受影响。

**验收场景**：

1. **假设**用户未配置 `disableThinkingOptions`，**当**快速模型场景（如 WebFetch 内容处理）发起请求时，**则**请求不携带任何禁用思考参数，交由模型默认处理（避免对不支持该参数的网关报错）
2. **假设**用户为模型 X 配置 `models[X].disableThinkingOptions: {"enable_thinking": false}`，**当**快速模型场景使用模型 X 时，**则**请求携带 `{"enable_thinking": false}`
3. **假设**用户为快速模型配置了 `models[fastModel].disableThinkingOptions`，**当** WebFetch 内容处理与快速子代理使用快速模型时，**则**两类请求都携带该模型的禁用思考参数
4. **假设**用户为快速模型配置了 `models[fastModel].disableThinkingOptions`，**当**自动记忆提取、上下文压缩等后台 fork 使用主模型（复用主对话 prompt cache，无 `modelOverride`）时，**则**请求不携带禁用思考参数，思考行为保持模型默认
5. **假设**用户配置了 `models[X].disableThinkingOptions`，**当**主代理对话（agent loop）使用模型 X 时，**则**请求不携带禁用思考参数，思考行为保持模型默认
6. **假设**用户为模型 X 配置 `disableThinkingOptions: {}`，**当**快速模型场景使用模型 X 时，**则**请求不携带任何禁用思考参数，交由模型默认处理

---

### 边界情况

- 当提供部分配置时会发生什么（如 apiKey 但无 baseURL）？
- 系统如何处理无效配置值（空字符串、格式错误的 URL、非数字 token 限制）？
- 当构造函数参数和环境变量同时存在时会发生什么？
- `WAVE_CUSTOM_HEADERS` 中的格式错误行如何处理？（应被忽略）
- 当 settings.json 在实时重载期间包含格式错误的 JSON 时会发生什么？
- 系统如何处理文件监视期间的文件系统权限错误？
- 系统如何处理快速连续的文件修改？
- 当文件监视器在系统启动时初始化失败会发生什么？
- IDE 插件配置对话框只填写部分字段（如仅 API Key、无 API 地址）时如何生效？（未填写的字段保持原值或回退到环境变量）
- IDE 插件配置对话框加载已保存配置失败时如何展示？（对话框内显示错误，表单仍可填写重试）
- 不同模型的禁用思考参数形态不同（`thinking: {type}` / `enable_thinking` / `reasoning_effort`），SDK 不做内置映射，由用户在 `models[X].disableThinkingOptions` 中按目标接口格式原样配置
- 未配置 `disableThinkingOptions` 时，快速模型场景不发送任何禁用思考参数；SDK 不内置默认值，避免直连不支持 `thinking` 参数的网关时报错

### 边界说明：环境变量作用域与优先级

- **settings.json `env` 与 OS 环境变量的关系**：settings.json `env` 存入会话级快照，优先级高于 OS 环境变量，但**不写入 `process.env`**（`WAVE_SERVER_URL` 例外，见下条）。优先级从高到低：显式构造参数 / stdio `initialize` 参数 > settings.json `env`（快照）> OS 环境变量 > 默认值。
- **`WAVE_SERVER_URL` 支持从 settings.json `env` 读取（镜像到 `process.env`）**：`AuthService` 与 `remoteSettingsService` 是进程级单例，不持有 per-session 快照，因此 settings `env` 里的 `WAVE_SERVER_URL` 经 `setEnvironmentVars` 特例**镜像写入 `process.env`**，使这些单例能读到。优先级：`options.serverUrl` / stdio `initialize` 参数 > settings.json `env`（镜像到 `process.env`）> OS 环境变量 > 默认值。由于 `AuthService` 是进程单例（一个进程一个 server），同进程多会话的 `WAVE_SERVER_URL` 应为同值，镜像不造成跨会话污染。启动 401 竞态已通过 init 顺序消除（`loadCacheFromDisk` → `loadMergedConfiguration` 写入 `process.env` → `startBackgroundFetch` 读取）。
- **SSO 认证 / 远端设置轮询为进程级单例**：`authService` 与 `remoteSettingsService` 是进程级单例（一个 `auth.json` / 远端设置缓存——按用户）。因此对于后台 token 刷新/远端设置轮询，**每个进程只有一个 `serverUrl`**；AI 网关/模型/密钥的解析本身仍是按会话进行的。
- **基础设施子进程保持 OS-env-only**：git/worktree/LSP 等基础设施子进程只读取 OS 环境变量（`PATH`/`HOME`/`LC_ALL` 等），不合并会话快照。`WAVE_PLUGIN_GIT_TIMEOUT_MS`、`WAVE_SHELL`、`WAVE_GIT_BASH_PATH` 等"基础设施级"变量不从 settings.json `env` 读取，需通过 OS 环境设置。
