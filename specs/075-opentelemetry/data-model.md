# Data Model: OpenTelemetry Integration

## Configuration

### TelemetryConfig (Resolved)

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Master switch for telemetry |
| `tracesExporter` | `'jsonl' \| 'otlp'` | Trace export target |
| `metricsExporter` | `'jsonl' \| 'otlp'` | Metric export target |
| `logsExporter` | `'jsonl' \| 'otlp'` | Log export target |
| `endpoint` | `string` | OTLP collector URL |
| `protocol` | `'http/protobuf' \| 'http/json' \| 'grpc'` | OTLP transport protocol |
| `headers` | `Record<string, string>` | Auth/custom headers |
| `logUserPrompts` | `boolean` | Include prompt text in events |
| `logToolContent` | `boolean` | Include tool I/O in events |
| `shutdownTimeoutMs` | `number` | Max flush time on exit (default 2000) |
| `spanTtlMs` | `number` | Stale span eviction TTL (default 1800000) |

## Span Types

### InteractionSpan

| Attribute | Type | Description |
|-----------|------|-------------|
| `span.type` | `'interaction'` | Span type discriminator |
| `user_prompt` | `string` | Prompt text (if `OTEL_LOG_USER_PROMPTS=1`) |
| `user_prompt_length` | `number` | Prompt length in characters |
| `interaction.sequence` | `number` | Turn number in session |

### LLMRequestSpan

| Attribute | Type | Description |
|-----------|------|-------------|
| `span.type` | `'llm_request'` | Span type discriminator |
| `model` | `string` | Model identifier |
| `llm_request.context` | `'interaction' \| 'standalone'` | Scope context |
| `input_tokens` | `number` | Prompt tokens consumed |
| `output_tokens` | `number` | Completion tokens generated |
| `cache_read_tokens` | `number` | Cache hit tokens |
| `cache_creation_tokens` | `number` | Cache write tokens |
| `ttft_ms` | `number` | Time to first token |
| `ttlt_ms` | `number` | Time to last token (total duration) |
| `success` | `boolean` | Request succeeded |
| `error` | `string` | Error message (if failed) |
| `has_tool_call` | `boolean` | Response included tool calls |

### ToolSpan

| Attribute | Type | Description |
|-----------|------|-------------|
| `span.type` | `'tool'` | Span type discriminator |
| `tool_name` | `string` | Tool identifier |
| `tool_input` | `string` | Serialized input (if `OTEL_LOG_TOOL_CONTENT=1`) |
| `success` | `boolean` | Tool execution succeeded |
| `error` | `string` | Error message (if failed) |
| `duration_ms` | `number` | Execution time |

## Event Types

### OTelEvent

| Event | Key Attributes |
|-------|---------------|
| `session_start` | `sessionId`, `model`, `workdir` |
| `session_end` | `duration`, `totalTokens`, `exitReason` |
| `user_prompt` | `prompt_length`, `prompt` (if enabled) |
| `tool_decision` | `tool_name`, `decision`, `source` |
| `compaction` | `beforeTokens`, `afterTokens`, `model` |
| `error` | `error_type`, `message`, `stack` (truncated) |

## Relationships
- An **InteractionSpan** has multiple child **LLMRequestSpan**s (if multi-turn recursion) and multiple child **ToolSpan**s.
- A **Session** produces multiple **InteractionSpan**s (one per user message).
- **OTelEvent**s are independent log records, not tied to specific spans.
