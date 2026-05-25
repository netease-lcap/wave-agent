# Research: Server-Managed Config Download

## Decision: Download During Initialization

- **Rationale**: Managed settings must be available before the agent processes any messages. Downloading during `InitializationService.initialize()` ensures settings are merged before the first AI call. This matches Claude Code's `remoteManagedSettings` which downloads during startup.
- **Alternatives considered**:
  - Download on first request: Rejected — too late, the agent may have already made decisions with incorrect settings.
  - Download on file change: Rejected — only the server knows when settings change; polling would add unnecessary complexity.

## Decision: Checksum-Based Caching

- **Rationale**: Using ETag/checksum allows the server to return a 304 Not Modified when settings haven't changed, avoiding unnecessary data transfer and parsing. The checksum is stored locally alongside the cached settings.
- **Alternatives considered**:
  - Always download: Rejected — wasteful for teams where settings rarely change.
  - Time-based caching (TTL): Rejected — doesn't guarantee freshness; checksum is more reliable.

## Decision: Merge Priority — Managed > Local

- **Rationale**: The purpose of managed settings is organizational policy enforcement. If local settings could override managed settings, the feature would be useless for security/compliance. This matches Claude Code's merge priority (priority 1 = highest = server-managed).
- **Alternatives considered**:
  - Local overrides managed: Rejected — defeats the purpose of centralized management.
  - Per-key priority: Rejected — too complex; a simpler model where managed wins for any key it includes is easier to reason about.

## Decision: Graceful Degradation on Network Errors

- **Rationale**: Agent startup must never be blocked by a server being unavailable. If the managed settings endpoint is down, the agent should use cached settings or fall back to local-only. This ensures developer productivity is not impacted by infrastructure issues.
- **Alternatives considered**:
  - Block startup until download completes: Rejected — single point of failure.
  - Retry with long timeout: Rejected — delays startup unacceptably.

## Integration Points

- `InitializationService.initialize()`: Triggers `RemoteSettingsService.downloadManagedSettings()` after SSO check
- `ConfigurationService.resolveSettings()`: Includes managed settings in the merge pipeline
- `AuthService`: Provides SSO token for authenticated download requests
- `~/.wave/managed-settings-cache.json`: Persisted cache for offline/cached access

## Reference: Claude Code Remote Managed Settings

Claude Code implements `remoteManagedSettings` with:
- Priority levels (1 = highest): managed settings always win for keys they include
- Checksum-based caching with ETag
- 401/403 triggers auth refresh and retry
- Managed settings can include: allowedTools, disallowedTools, customInstructions, model, etc.
- Security dialog for "dangerous" managed settings that could compromise the agent
