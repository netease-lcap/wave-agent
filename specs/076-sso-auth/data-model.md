# Data Model: SSO Authentication

## Configuration

### AuthConfig (Stored in `~/.wave/auth.json`)

| Field | Type | Description |
|-------|------|-------------|
| `SSO_TOKEN` | `string?` | JWT token from Wave AI SSO login |

### File Permissions

- `~/.wave/auth.json`: `0o600` (owner read/write only)

## SSO Provider Response

### SSOProvider (from `GET /api/auth/sso-providers`)

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `string` | Provider identifier (e.g., `"netease"`) |
| `displayName` | `string` | Human-readable name (e.g., `"NetEase SSO"`) |

## GatewayConfig (SSO Mode)

When `SSO_TOKEN` is present, `resolveGatewayConfig()` returns:

| Field | Type | Description |
|-------|------|-------------|
| `apiKey` | `string` | The `SSO_TOKEN` value |
| `baseURL` | `string` | `${WAVE_AI_URL}/api/v1` |
| `defaultHeaders` | `Record<string, string>?` | Custom headers (if any) |
| `fetchOptions` | `ClientOptions.fetchOptions?` | Fetch options |
| `fetch` | `ClientOptions.fetch?` | Custom fetch implementation |

## LoginCommand UI States

| State | Conditions | Display |
|-------|-----------|---------|
| Idle (not authenticated) | `!isSSOAuthenticated()` | "Not logged in", "Press Enter to login" |
| Idle (authenticated) | `isSSOAuthenticated()` && `!isLoading` | Truncated token, AI URL, "Press Enter to logout" |
| Loading | `isLoading` && `!message` | "Starting authentication..." |
| Auth URL shown | `isLoading` && `authUrl` | Auth URL + "Paste the authorization code from your browser URL bar:" + code input field |
| Success | `!isLoading` && `message === "Login successful"` | "Login successful" |
| Error | `!isLoading` && `error` | Error message in red |

## Resolution Priority (Gateway Config)

```
1. SSO_TOKEN exists in ~/.wave/auth.json → { apiKey: SSO_TOKEN, baseURL: ${WAVE_AI_URL}/api/v1 }
2. Constructor args (apiKey, baseURL)
3. AgentOptions (this.options.apiKey, this.options.baseURL)
4. Settings.json env vars (WAVE_API_KEY, WAVE_BASE_URL)
5. process.env (WAVE_API_KEY, WAVE_BASE_URL)
6. Error (missing baseURL)
```
