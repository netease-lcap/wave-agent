# Data Model: OpenTelemetry Support

## Entities

### TelemetryConfig
Represents the configuration for OpenTelemetry instrumentation.

- **enabled**: boolean (derived from presence of endpoint)
- **serviceName**: string (default: "wave-agent")
- **exporterEndpoint**: string (OTLP endpoint URL)
- **headers**: Record<string, string> (Optional headers for OTLP exporter)
- **samplingRate**: number (0.0 to 1.0)

### TraceContext
Represents the active trace context propagated through the system.

- **traceId**: string
- **spanId**: string
- **traceFlags**: number
- **baggage**: Record<string, string> (Optional metadata)

### AgentSpan
Represents a single unit of work within the agent.

- **name**: string (e.g., "task_execution", "tool_call")
- **kind**: SpanKind (Internal/Client/Server)
- **attributes**:
    - `agent.task.id`: string
    - `agent.tool.name`: string (if tool call)
    - `agent.step.type`: "planning" | "execution" | "observation"
    - `gen_ai.request.model`: string (if LLM call)
    - `gen_ai.usage.prompt_tokens`: number
    - `gen_ai.usage.completion_tokens`: number

## State Transitions

1. **Initialization**: `TelemetryConfig` is loaded from environment variables.
2. **Context Creation**: `TraceContext` is either extracted from incoming headers or generated for a new task.
3. **Span Lifecycle**: `AgentSpan` is started before an operation and ended after completion (or error).
4. **Export**: Spans and Metrics are periodically batched and sent to the `exporterEndpoint`.
