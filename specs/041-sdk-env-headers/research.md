# Research: SDK Env Headers Support

## Decision: Header Injection Point
The best place to inject headers from environment variables is in `ConfigurationService.resolveGatewayConfig`. This method is already responsible for resolving `GatewayConfig` from various sources (constructor args, `settings.json`, `process.env`).

## Rationale
- **Centralization**: `ConfigurationService` is the centralized place for all configuration resolution.
- **Consistency**: It already handles `WAVE_API_KEY` and `WAVE_BASE_URL` with a clear priority (constructor > `settings.json` > `process.env`).
- **Impact**: Modifying this method will automatically affect all `Agent` instances, including subagents, as they all use `ConfigurationService` to get their gateway configuration.

## Implementation Details
- **Environment Variable**: `WAVE_CUSTOM_HEADERS`
- **Format**: Newline-separated `Key: Value` pairs.
- **Parsing Logic**:
  - Split by `\n` or `\r\n`.
  - For each line, split by the first `:`.
  - Trim key and value.
  - Ignore empty lines or lines without a colon.
- **Precedence**:
  1. Constructor `defaultHeaders`
  2. `WAVE_CUSTOM_HEADERS` from `settings.json` (via `this.env`)
  3. `WAVE_CUSTOM_HEADERS` from `process.env`

## Alternatives Considered
- **Injecting in `AIManager`**: Too late in the process; `AIManager` should receive a fully resolved configuration.
- **Injecting in `aiService.ts`**: This would bypass the configuration resolution logic and make it harder to test and manage.
