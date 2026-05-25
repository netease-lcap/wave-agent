# Feature Specification: OpenTelemetry Integration

**Feature Branch**: `075-opentelemetry`
**Created**: 2026-05-09
**Input**: "Add OpenTelemetry instrumentation following Claude Code patterns, supporting metrics, traces, and logs with multiple exporters (jsonl, OTLP)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Remote Telemetry with OTLP Exporter (Priority: P1)

As a developer, I want to send Wave telemetry data to an OTLP collector (e.g., Jaeger, Grafana Tempo, Honeycomb) so I can observe agent behavior, debug performance issues, and analyze session patterns.

**Why this priority**: This is the primary use case for OpenTelemetry — sending structured traces, metrics, and logs to an external backend for analysis.

**Independent Test**: Point Wave at a local Jaeger or Grafana instance via `OTEL_EXPORTER_OTLP_ENDPOINT`, run a session, and verify traces appear in the collector's UI.

**Acceptance Scenarios**:

1. **Given** `OTEL_TRACES_EXPORTER=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT` is set to a running collector, **When** the user sends a message and the agent responds, **Then** the collector receives a complete trace with interaction spans, LLM request spans with token counts, and tool execution spans with durations.
2. **Given** `OTEL_METRICS_EXPORTER=otlp` and a collector endpoint, **When** the agent completes a turn, **Then** the collector receives periodic metric exports with token usage, latency histograms, and error counters.
3. **Given** `OTEL_LOGS_EXPORTER=otlp` and a collector endpoint, **When** the session starts and ends, **Then** the collector receives structured log events for `session_start` and `session_end`.

---

### User Story 2 - JSONL File Exporter (Priority: P2)

As a developer, I want telemetry written to a dedicated JSONL file (`~/.wave/telemetry.jsonl`) so I can observe spans and metrics by tailing the file, without needing an external collector.

**Why this priority**: JSONL matches Wave's existing session file format — each line is a self-contained JSON record, easy to `tail -f`, parse with `jq`, or stream to downstream tools. Decoupled from `~/.wave/app.log` (text logs) and `~/.wave/sessions/*.jsonl` (session data).

**Independent Test**: Run Wave with `OTEL_METRICS_EXPORTER=jsonl OTEL_TRACES_EXPORTER=jsonl`, interact with the agent, and observe structured JSONL records in `~/.wave/telemetry.jsonl`.

**Acceptance Scenarios**:

1. **Given** Wave is started with `OTEL_TRACES_EXPORTER=jsonl`, **When** the agent processes a message, **Then** `~/.wave/telemetry.jsonl` includes one JSON line per span (interaction, LLM request, tool). `~/.wave/app.log` is unaffected.
2. **Given** Wave is started with `OTEL_METRICS_EXPORTER=jsonl`, **When** the agent completes a turn, **Then** `~/.wave/telemetry.jsonl` includes metric JSON lines. `~/.wave/app.log` is unaffected.
3. **Given** a telemetry JSONL file, **When** piping through `jq`, **Then** each line parses as valid JSON independently.

---

### User Story 3 - Session Diagnostics via Event Logging (Priority: P2)

As a developer, I want structured event logs for key session lifecycle events (start, end, compaction, tool decisions, errors) so I can reconstruct what happened during a session without parsing raw JSONL files.

**Why this priority**: This provides a searchable, structured audit trail complementing the raw message history. Events are exported via the configured logs exporter (OTLP for remote, jsonl for local file).

**Independent Test**: Run Wave with `OTEL_LOGS_EXPORTER=otlp`, complete a session with multiple turns including a compaction and a rejected tool call, and verify all lifecycle events appear in the collector. Or use `OTEL_LOGS_EXPORTER=jsonl` and tail `~/.wave/telemetry.jsonl`.

**Acceptance Scenarios**:

1. **Given** OTEL logging is enabled, **When** a session starts, **Then** a `session_start` event is logged with sessionId, model, and workdir.
2. **Given** OTEL logging is enabled, **When** the agent auto-compacts the conversation, **Then** a `compaction` event is logged with before/after token counts.
3. **Given** OTEL logging is enabled, **When** a tool permission is rejected, **Then** a `tool_decision` event is logged with tool name and decision.
4. **Given** `OTEL_LOG_USER_PROMPTS=1`, **When** the user sends a message, **Then** the `user_prompt` event includes the actual prompt text. **Given** `OTEL_LOG_USER_PROMPTS` is not set, **Then** the prompt text is excluded.

---

### Edge Cases

- **What happens if the OTLP endpoint is unreachable?** Telemetry export should fail gracefully with logged warnings; the agent session must continue normally without blocking.
- **What happens if OTEL is enabled but no exporters are configured?** No default exporter is set. Users must explicitly configure at least one exporter. This avoids surprising stdout pollution in interactive mode.
- **What happens during parallel tool execution?** Each tool call must create its own child span under the correct parent interaction span, using AsyncLocalStorage to prevent span context mixing.
- **What happens in long-running sessions with 100+ turns?** Active spans older than 30 minutes must be cleaned up to prevent memory leaks.
- **What happens if telemetry initialization fails?** The agent must start normally without telemetry; a warning is logged but no crash occurs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support OpenTelemetry SDK initialization with MeterProvider, TracerProvider, and LoggerProvider.
- **FR-002**: System MUST support multiple exporters for each signal type: metrics (`jsonl`, `otlp`), traces (`jsonl`, `otlp`), logs (`jsonl`, `otlp`).
- **FR-003**: System MUST read OTEL configuration from standard `OTEL_*` environment variables (endpoint, protocol, headers, exporters).
- **FR-004**: System MUST create interaction spans wrapping each user message → complete response cycle.
- **FR-005**: System MUST create LLM request spans for each API call with attributes: model, input/output/cache tokens, TTFT, TTLT, success/error status.
- **FR-006**: System MUST create tool execution spans for each tool call with attributes: tool name, success/error, duration, input (optional).
- **FR-007**: System MUST maintain correct parent-child span relationships during parallel tool execution using AsyncLocalStorage.
- **FR-008**: System MUST log structured events for: `session_start`, `session_end`, `user_prompt`, `tool_decision`, `compaction`, `error`.
- **FR-009**: System MUST NOT include user prompt text or tool content in telemetry by default; these are gated behind `OTEL_LOG_USER_PROMPTS=1` and `OTEL_LOG_TOOL_CONTENT=1`.
- **FR-010**: System MUST gracefully handle telemetry failures without impacting agent operation.
- **FR-011**: System MUST flush all telemetry on shutdown with a configurable timeout (default 2s).
- **FR-012**: System MUST clean up stale spans older than 30 minutes to prevent memory leaks.
- **FR-013**: System MUST include resource attributes: `service.name: 'wave'`, `service.version`, `os.type`, `host.arch`.
- **FR-014**: System MUST support configuration via both environment variables AND `settings.json`, with env vars taking precedence.
- **FR-015**: Console exporters are NOT supported. Instead, a custom JSONL file exporter writes telemetry records (one JSON per line) to `~/.wave/telemetry.jsonl`.
- **FR-016**: System MUST use an anonymous ID as fallback for `user.id` telemetry attribute when SSO is not authenticated. The anonymous ID MUST be a 32-byte hex string stored in `~/.wave/config.json` and created on first use. When SSO is authenticated, `user.id` MUST use the SSO user ID instead.

### Key Entities

- **Interaction Span**: Top-level span wrapping a complete user message → agent response cycle.
- **LLM Request Span**: Child span of interaction span, representing a single API call to the model.
- **Tool Span**: Child span of interaction span, representing a single tool execution.
- **OTel Event**: Structured log record for session lifecycle events.
- **TelemetryConfig**: Configuration resolved from env vars + settings.json controlling exporters, endpoints, and PII gates.
- **AnonymousId**: 32-byte hex string persisted in `~/.wave/config.json`, used as `user.id` when SSO is not authenticated. Created via `getOrCreateAnonymousId()`.
