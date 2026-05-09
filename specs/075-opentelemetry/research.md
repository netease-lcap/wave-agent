# Research: OpenTelemetry Integration

## Decision: Use @opentelemetry/sdk-node as Foundation
- **Rationale**: Provides unified setup for MeterProvider, TracerProvider, LoggerProvider with standard env var support. Matches Claude Code's approach.
- **Alternatives considered**:
  - Manual provider setup: Rejected — too much boilerplate, env var parsing reinvented.
  - @opentelemetry/auto-instrumentations-node: Rejected — auto-instrumentations (http, fs, etc.) add noise; we want manual instrumentation only.

## Decision: Manual Instrumentation Only (No Auto-Instrumentations)
- **Rationale**: Wave's value comes from domain-specific spans (interactions, LLM calls, tools). Auto-instrumenting HTTP calls, DNS lookups, etc. adds irrelevant noise.
- **Alternatives considered**: Auto-instrumentations for HTTP to track API latency — rejected, LLM request spans already cover this with richer attributes.

## Decision: AsyncLocalStorage for Span Context
- **Rationale**: Wave supports parallel tool execution. Using AsyncLocalStorage ensures each tool call's span is correctly nested under its parent interaction span, even when tools execute concurrently.
- **Alternatives considered**:
  - Global active span: Rejected — parallel calls would corrupt parent context.
  - Explicit span passing everywhere: Too invasive; ALS provides implicit context propagation.

## Decision: Lazy Initialization (Dynamic Import)
- **Rationale**: OTEL packages add ~1MB to startup. Using `import()` defers loading until after the agent is ready. Matches Claude Code's pattern.
- **Alternatives considered**: Static import at top level: Rejected — adds visible startup delay.

## Decision: JSONL File Exporter (Dedicated Telemetry File)
- **Rationale**: Telemetry is structured JSON data — JSONL format (one JSON object per line) matches Wave's existing session file convention. A dedicated file (`~/.wave/telemetry.jsonl`) keeps telemetry decoupled from `~/.wave/app.log` (text application logs) and session data. No stdout/stderr concerns, no Ink corruption. Easy to tail, parse with `jq`, or stream to downstream tools.
- **Alternatives considered**:
  - OTEL console exporters: Rejected — writes to stdout, corrupts Ink UI.
  - Write to app.log: Rejected — format clash (text vs JSON), telemetry verbosity would dwarf app logs, defeats separate-tailing use case.

## Decision: Graceful Degradation on Failure
- **Rationale**: Telemetry must never block or crash the agent. All export operations use batch processors with non-blocking error handling.
- **Alternatives considered**: Fail-fast: Rejected — unacceptable for a developer tool.

## Integration Points
- `Agent` constructor: initialize telemetry, log `session_start` event
- `Agent.destroy()`: log `session_end` event, `shutdownTelemetry()`
- `AIManager.queryModel()`: wrap with interaction span + LLM request span
- `ToolManager.executeTool()`: wrap with tool span
- `CompactionService`: log `compaction` event
- CLI entry point: lazy-load `initializeTelemetry()`
