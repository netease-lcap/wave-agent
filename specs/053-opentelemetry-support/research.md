# Research: OpenTelemetry Support in Wave Agent

## 1. Initialization in Node.js Monorepo

**Decision:**
Initialize OpenTelemetry in a dedicated module within the `code` package (the entry point). The `agent-sdk` package will use the global `@opentelemetry/api` to create spans and metrics. A `TelemetryService` will be created in `agent-sdk` to provide a clean wrapper around the global API.

**Rationale:**
- **Monorepo Structure**: `code` is the application entry point, ensuring telemetry is set up before core logic executes.
- **Separation of Concerns**: `agent-sdk` remains focused on core logic without direct dependency on specific SDK configurations.
- **Global API**: `@opentelemetry/api` allows instrumentation without coupling to the SDK implementation.
- **Graceful Shutdown**: The `code` package's `cli.tsx` already has a cleanup mechanism where we can add `telemetryService.shutdown()`.

**Alternatives considered:**
- Initializing in `agent-sdk`: Rejected as it couples core logic with telemetry configuration.
- Lazy initialization: Rejected as it adds complexity and risk of missing early traces.

## 2. Trace Context Propagation

**Decision:**
Use the built-in W3C Trace Context propagator in the OpenTelemetry SDK.

**Rationale:**
- **Standard Compliance**: W3C Trace Context is the industry standard.
- **Automatic Handling**: SDK handles header parsing/injection (e.g., `traceparent`).
- **Context API**: Manages active spans across asynchronous operations in Node.js.

**Alternatives considered:**
- Manual header parsing: Rejected as error-prone and redundant.

## 3. Recommended Span Attributes

**Decision:**
Use OpenTelemetry Semantic Conventions for LLM and FaaS, supplemented by custom `agent.*` attributes.

**Rationale:**
- **Standardization**: Improves interoperability with backends like Jaeger/Honeycomb.
- **LLM Attributes**: `gen_ai.request.model`, `gen_ai.usage.prompt_tokens`, etc.
- **Agent Attributes**: `agent.tool.name`, `agent.task.id`, `agent.step.type`.
- **Security**: Sensitive data (prompts/outputs) will be omitted or sanitized by default.

**Alternatives considered:**
- Only custom attributes: Rejected as it loses benefits of standardized observability tools.

## 4. Optional Telemetry (Disabled by Default)

**Decision:**
Conditional initialization based on environment variables (e.g., `OTEL_EXPORTER_OTLP_ENDPOINT`). Use no-op implementations when disabled.

**Rationale:**
- **Minimal Overhead**: No-op providers have negligible performance impact.
- **Global API Consistency**: Application code doesn't need `if (enabled)` checks everywhere.

**Alternatives considered:**
- Conditional `if` checks everywhere: Rejected as it clutters the codebase.

## 5. Metrics Exporting

**Decision:**
Use `MeterProvider` with `PeriodicExportingMetricReader` and `OTLPMetricExporter`.

**Rationale:**
- **Standard OTLP**: Ensures compatibility with Prometheus/OTEL Collector.
- **Instruments**: `Histogram` for latency, `Counter` for errors and token usage.

**Alternatives considered:**
- Custom metrics library: Rejected to maintain a unified observability stack.
