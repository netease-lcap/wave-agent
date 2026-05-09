# Quickstart: OpenTelemetry Integration

## Overview
Wave now supports OpenTelemetry for structured observability — traces, metrics, and logs.

## Basic Usage — OTLP Exporter (Interactive Mode)

```bash
# Send telemetry to a local Jaeger instance
OTEL_TRACES_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
wave

# Send to Grafana Cloud with auth
OTEL_TRACES_EXPORTER=otlp \
OTEL_METRICS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp \
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer your-token" \
wave
```

## JSONL File Exporter (Local Debugging)

Console exporters are not supported (stdout corrupts Ink UI). Instead, use the `jsonl` exporter which writes to `~/.wave/telemetry.jsonl`.

```bash
# Enable all signals — telemetry goes to JSONL file
OTEL_METRICS_EXPORTER=jsonl \
OTEL_TRACES_EXPORTER=jsonl \
OTEL_LOGS_EXPORTER=jsonl \
wave

# Observe telemetry:
tail -f ~/.wave/telemetry.jsonl

# Parse with jq:
tail -f ~/.wave/telemetry.jsonl | jq 'select(."span.type" == "llm_request")'
```

## Remote Telemetry — OTLP Exporter

```bash
# Send to a local Jaeger instance
OTEL_TRACES_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
wave

# Send to Grafana Cloud with auth
OTEL_TRACES_EXPORTER=otlp \
OTEL_METRICS_EXPORTER=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp \
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer your-token" \
wave
```

## Configuration via settings.json

```json
{
  "monitoring": {
    "telemetry": {
      "enabled": true,
      "tracesExporter": "otlp",
      "metricsExporter": "otlp",
      "logsExporter": "jsonl",
      "endpoint": "https://your-collector.example.com",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

**Note**: Environment variables take precedence over settings.json.

## PII Protection

By default, user prompts and tool content are **NOT** included in telemetry. To enable:

```bash
OTEL_LOG_USER_PROMPTS=1 OTEL_LOG_TOOL_CONTENT=1 wave
```
