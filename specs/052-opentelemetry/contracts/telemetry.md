# Telemetry API Contracts

## Instrumentation Module

### `initializeTelemetry(config?: TelemetryConfig): Promise<void>`
Lazy-loads OTEL SDK and initializes all providers. Must be called once before any telemetry operations. Idempotent.

### `shutdownTelemetry(): Promise<void>`
Flushes all pending telemetry to exporters and shuts down providers. Respects `shutdownTimeoutMs` config. Must be called before process exit.

## Session Tracing Module

### `startInteractionSpan(userPrompt: string): Span`
Creates a new interaction span. Sets as active span in AsyncLocalStorage context.

### `endInteractionSpan(span: Span, metadata: { sequence: number }): void`
Ends the interaction span and removes from active context.

### `startLLMRequestSpan(model: string, options?: { context?: string; tools?: string[] }): Span`
Creates an LLM request span as child of current interaction span (via ALS context).

### `endLLMRequestSpan(span: Span, metadata: LLMRequestMetadata): void`
Ends LLM request span with token counts, latency, success/error status.

### `startToolSpan(toolName: string, input?: unknown): Span`
Creates a tool execution span as child of current interaction span.

### `endToolSpan(span: Span, metadata: ToolMetadata): void`
Ends tool span with success/error, duration, optional result tokens.

## Events Module

### `logOTelEvent(eventName: string, metadata: Record<string, string | undefined>): Promise<void>`
Logs a structured event via the OTEL logs API. Respects PII gates.

## Span Context Management

### `getActiveInteractionSpan(): Span | undefined`
Returns the current interaction span from AsyncLocalStorage context.

### `withToolContext<T>(span: Span, fn: () => T): T`
Executes `fn` with the given tool span as the active context. Ensures correct nesting for parallel tool calls.

## User Identification Functions

```typescript
/**
 * Get or create an anonymous ID for telemetry.
 * Stored in ~/.wave/config.json as a 32-byte hex string.
 * Created on first use if not present.
 */
function getOrCreateAnonymousId(): string;

/**
 * Get telemetry attributes including user identification.
 * Returns SSO user.id if authenticated, otherwise anonymous ID.
 */
function getTelemetryAttributes(): Record<string, string>;
```
