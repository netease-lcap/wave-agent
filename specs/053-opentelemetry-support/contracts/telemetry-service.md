# Telemetry Service Contract

The Telemetry Service is an internal service within `agent-sdk` that provides a unified interface for instrumentation.

## Interface: `ITelemetryService`

```typescript
interface ITelemetryService {
  /**
   * Starts a new span and executes the provided function within its context.
   */
  withSpan<T>(
    name: string,
    attributes: Record<string, any>,
    fn: (span: Span) => Promise<T>
  ): Promise<T>;

  /**
   * Records a metric value.
   */
  recordMetric(
    name: string,
    value: number,
    attributes?: Record<string, any>
  ): void;

  /**
   * Shuts down the telemetry service and flushes pending data.
   */
  shutdown(): Promise<void>;
}
```

## Environment Variables (Configuration)

- `OTEL_EXPORTER_OTLP_ENDPOINT`: The OTLP endpoint URL (e.g., `http://localhost:4318/v1/traces`).
- `OTEL_SERVICE_NAME`: The name of the service (default: `wave-agent`).
- `OTEL_TRACES_SAMPLER`: The sampler to use (default: `always_on`).
- `OTEL_LOG_LEVEL`: Internal SDK log level.
