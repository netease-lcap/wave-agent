# Data Model: Server-Managed Config Download

## Configuration

### RemoteManagedSettings

Settings downloaded from the Wave AI server. Contains any subset of standard `settings.json` keys.

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string?` | Managed model selection |
| `fastModel` | `string?` | Managed fast model selection |
| `allowedTools` | `string[]?` | Managed tool allowlist |
| `disallowedTools` | `string[]?` | Managed tool deny list |
| `env` | `Record<string, string>?` | Managed environment variables |
| `permissionMode` | `string?` | Managed permission mode |
| `additionalDirectories` | `string[]?` | Managed additional directories |

### ManagedSettingsCache

Locally cached managed settings with metadata.

| Field | Type | Description |
|-------|------|-------------|
| `settings` | `RemoteManagedSettings` | Cached managed settings |
| `checksum` | `string` | ETag or checksum from last successful download |
| `lastFetched` | `number` | Unix timestamp (ms) of last successful fetch |

Stored in: `~/.wave/managed-settings-cache.json`

### RemoteSettingsService

| Method | Description |
|--------|-------------|
| `downloadManagedSettings()` | Fetch managed settings from server with auth token |
| `getCachedSettings()` | Return cached settings if available |
| `mergeWithLocal(local, managed)` | Merge local and managed settings with correct priority |

## Settings Merge Priority

| Priority | Source | Override Power |
|----------|--------|---------------|
| 1 (highest) | Environment variables | Always wins |
| 2 | Remote managed settings | Overrides local settings |
| 3 | User-level `settings.json` | Standard local config |
| 4 (lowest) | Project-level `settings.json` | Project defaults |

### Merge Rules

1. **Present in managed, absent in local**: Use managed value
2. **Present in both**: Managed value wins
3. **Absent in managed, present in local**: Local value preserved
4. **Array fields** (allowedTools, disallowedTools): Managed array replaces local array entirely (not merged)
5. **Env field**: Managed env vars override local keys with same name; non-overlapping local env vars are preserved

## API Contract

### GET /api/v1/managed-settings

**Request**:
```
Authorization: Bearer <SSO_TOKEN>
If-None-Match: <cached-etag>  (optional, for caching)
```

**Response** (200):
```json
{
  "settings": {
    "disallowedTools": ["Bash"],
    "model": "gpt-4o"
  },
  "checksum": "abc123def456"
}
```

**Response** (304 Not Modified):
(Empty body, when If-None-Match matches current checksum)

**Response** (401/403):
(Authentication failure — client should fall back to local settings)

## Relationships

- `RemoteSettingsService` is called during `InitializationService.initialize()` after SSO auth is confirmed
- Managed settings are merged into the resolved `ConfigurationService` state
- `ManagedSettingsCache` is persisted alongside `auth.json` in `~/.wave/`
