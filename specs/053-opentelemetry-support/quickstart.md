# Quickstart: OpenTelemetry Support

## Enabling Telemetry

To enable OpenTelemetry support in Wave Agent, set the following environment variables:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="http://your-otel-collector:4318"
export OTEL_SERVICE_NAME="wave-agent"
```

## Viewing Traces

1. Start an OpenTelemetry Collector (e.g., using Jaeger or Honeycomb).
2. Run a Wave Agent task:
   ```bash
   wave-agent "summarize the README.md file"
   ```
3. Open your observability backend to see the distributed trace, including:
   - Task execution span
   - Tool call spans (e.g., `read_file`)
   - LLM request spans

## Metrics

The agent exports the following metrics:
- `agent.task.duration`: Histogram of task execution times.
- `agent.task.errors`: Counter of failed tasks.
- `gen_ai.usage.tokens`: Counter of tokens used (prompt and completion).

## Disabling Telemetry

Telemetry is disabled by default. To explicitly disable it or if the endpoint is not reachable, simply unset the `OTEL_EXPORTER_OTLP_ENDPOINT` variable.
