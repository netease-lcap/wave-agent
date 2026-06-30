# 功能规格说明：OpenTelemetry 集成

**特性分支**：`052-opentelemetry`
**创建日期**：2026-05-09

## 用户场景与测试 *（必填）*

### 用户故事 1 - 使用 OTLP 导出器的远程遥测（优先级：P1）

作为开发者，我希望将 Wave 遥测数据发送到 OTLP 收集器（例如 Jaeger、Grafana Tempo、Honeycomb），以便观察 agent 行为、调试性能问题和分析会话模式。

**为什么是这个优先级**：这是 OpenTelemetry 的主要用例——将结构化的 trace、metric 和 log 发送到外部后端进行分析。

**独立测试**：通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 将 Wave 指向本地 Jaeger 或 Grafana 实例，运行会话，并验证 trace 出现在收集器的 UI 中。

**验收场景**：

1. **假设** `OTEL_TRACES_EXPORTER=otlp` 且 `OTEL_EXPORTER_OTLP_ENDPOINT` 设置为运行中的收集器，**当**用户发送消息且 agent 响应时，**则**收集器收到完整的 trace，包含交互 span、带 token 计数的 LLM 请求 span 和带持续时间的工具执行 span。
2. **假设** `OTEL_METRICS_EXPORTER=otlp` 且有收集器端点，**当** agent 完成一轮时，**则**收集器收到定期的 metric 导出，包含 token 使用量、延迟直方图和错误计数器。
3. **假设** `OTEL_LOGS_EXPORTER=otlp` 且有收集器端点，**当**会话开始和结束时，**则**收集器收到 `session_start` 和 `session_end` 的结构化日志事件。

---

### 用户故事 2 - JSONL 文件导出器（优先级：P2）

作为开发者，我希望遥测数据写入专用的 JSONL 文件（`~/.wave/telemetry.jsonl`），以便通过 tail 文件观察 span 和 metric，而无需外部收集器。

**为什么是这个优先级**：JSONL 匹配 Wave 现有的会话文件格式——每行是一个自包含的 JSON 记录，易于 `tail -f`、用 `jq` 解析或流式传输到下游工具。与 `~/.wave/app.log`（文本日志）和 `~/.wave/sessions/*.jsonl`（会话数据）解耦。

**独立测试**：使用 `OTEL_METRICS_EXPORTER=jsonl OTEL_TRACES_EXPORTER=jsonl` 运行 Wave，与 agent 交互，并观察 `~/.wave/telemetry.jsonl` 中的结构化 JSONL 记录。

**验收场景**：

1. **假设** Wave 使用 `OTEL_TRACES_EXPORTER=jsonl` 启动，**当** agent 处理消息时，**则** `~/.wave/telemetry.jsonl` 包含每个 span 一行 JSON（交互、LLM 请求、工具）。`~/.wave/app.log` 不受影响。
2. **假设** Wave 使用 `OTEL_METRICS_EXPORTER=jsonl` 启动，**当** agent 完成一轮时，**则** `~/.wave/telemetry.jsonl` 包含 metric JSON 行。`~/.wave/app.log` 不受影响。
3. **假设**有遥测 JSONL 文件，**当**通过 `jq` 管道传输时，**则**每行独立解析为有效 JSON。

---

### 用户故事 3 - 通过事件日志的会话诊断（优先级：P2）

作为开发者，我希望关键会话生命周期事件（开始、结束、压缩、工具决策、错误）有结构化事件日志，以便无需解析原始 JSONL 文件即可重建会话期间发生的事情。

**为什么是这个优先级**：这提供了可搜索的结构化审计跟踪，补充原始消息历史。事件通过配置的 logs 导出器导出（OTLP 用于远程，jsonl 用于本地文件）。

**独立测试**：使用 `OTEL_LOGS_EXPORTER=otlp` 运行 Wave，完成包含多轮包括压缩和被拒绝工具调用的会话，并验证所有生命周期事件出现在收集器中。或使用 `OTEL_LOGS_EXPORTER=jsonl` 并 tail `~/.wave/telemetry.jsonl`。

**验收场景**：

1. **假设** OTEL 日志已启用，**当**会话开始时，**则**记录 `session_start` 事件，包含 sessionId、model 和 workdir。
2. **假设** OTEL 日志已启用，**当** agent 自动压缩对话时，**则**记录 `compaction` 事件，包含压缩前后的 token 计数。
3. **假设** OTEL 日志已启用，**当**工具权限被拒绝时，**则**记录 `tool_decision` 事件，包含工具名称和决策。
4. **假设** `OTEL_LOG_USER_PROMPTS=1`，**当**用户发送消息时，**则** `user_prompt` 事件包含实际提示文本。**假设** `OTEL_LOG_USER_PROMPTS` 未设置，**则**排除提示文本。

---

### 边界情况

- **如果 OTLP 端点不可达会怎样？** 遥测导出应优雅失败并记录警告；agent 会话必须正常继续而不阻塞。
- **如果 OTEL 已启用但未配置导出器会怎样？** 不设置默认导出器。用户必须显式配置至少一个导出器。这避免在交互模式中意外的 stdout 污染。
- **并行工具执行期间会怎样？** 每个工具调用必须使用 AsyncLocalStorage 在正确的父交互 span 下创建自己的子 span，以防止 span 上下文混合。
- **在 100+ 轮的长时间运行会话中会怎样？** 超过 30 分钟的活动 span 必须被清理以防止内存泄漏。
- **如果遥测初始化失败会怎样？** agent 必须在没有遥测的情况下正常启动；记录警告但不崩溃。

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须支持使用 MeterProvider、TracerProvider 和 LoggerProvider 进行 OpenTelemetry SDK 初始化。
- **FR-002**：系统必须支持每种信号类型的多个导出器：metrics（`jsonl`、`otlp`）、traces（`jsonl`、`otlp`）、logs（`jsonl`、`otlp`）。
- **FR-003**：系统必须从标准 `OTEL_*` 环境变量（端点、协议、headers、导出器）读取 OTEL 配置。
- **FR-004**：系统必须创建包裹每个用户消息 → 完整响应周期的交互 span。
- **FR-005**：系统必须为每次 API 调用创建 LLM 请求 span，包含属性：model、输入/输出/缓存 token、TTFT、TTLT、成功/错误状态。
- **FR-006**：系统必须为每次工具调用创建工具执行 span，包含属性：工具名称、成功/错误、持续时间、输入（可选）。
- **FR-007**：系统必须在并行工具执行期间使用 AsyncLocalStorage 维护正确的父子 span 关系。
- **FR-008**：系统必须为以下事件记录结构化事件：`session_start`、`session_end`、`user_prompt`、`tool_decision`、`compaction`、`error`。
- **FR-009**：系统默认不得在遥测中包含用户提示文本或工具内容；这些由 `OTEL_LOG_USER_PROMPTS=1` 和 `OTEL_LOG_TOOL_CONTENT=1` 控制。
- **FR-010**：系统必须优雅地处理遥测失败而不影响 agent 操作。
- **FR-011**：系统必须在关闭时刷新所有遥测数据，使用可配置超时（默认 2 秒）。
- **FR-012**：系统必须清理超过 30 分钟的陈旧 span 以防止内存泄漏。
- **FR-013**：系统必须包含资源属性：`service.name: 'wave'`、`service.version`、`os.type`、`host.arch`。
- **FR-014**：系统必须支持通过环境变量和 `settings.json` 进行配置，环境变量优先。
- **FR-015**：不支持控制台导出器。相反，自定义 JSONL 文件导出器将遥测记录（每行一个 JSON）写入 `~/.wave/telemetry.jsonl`。
- **FR-016**：当 SSO 未认证时，系统必须使用匿名 ID 作为 `user.id` 遥测属性的回退。匿名 ID 必须是存储在 `~/.wave/config.json` 中的 32 字节十六进制字符串，在首次使用时创建。当 SSO 已认证时，`user.id` 必须使用 SSO 用户 ID。

### 关键实体

- **Interaction Span**：包裹完整用户消息 → agent 响应周期的顶级 span。
- **LLM Request Span**：交互 span 的子 span，代表对模型的单次 API 调用。
- **Tool Span**：交互 span 的子 span，代表单次工具执行。
- **OTel Event**：会话生命周期事件的结构化日志记录。
- **TelemetryConfig**：从环境变量 + settings.json 解析的配置，控制导出器、端点和 PII 控制。
- **AnonymousId**：持久化在 `~/.wave/config.json` 中的 32 字节十六进制字符串，当 SSO 未认证时用作 `user.id`。通过 `getOrCreateAnonymousId()` 创建。
