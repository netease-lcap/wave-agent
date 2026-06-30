# Data Model: SSO Authentication

## Configuration

### AuthConfig (Stored in `~/.wave/auth.json`)

| Field | Type | Description |
|-------|------|-------------|
| `SSO_TOKEN` | `string?` | JWT access token from Wave AI SSO login |
| `SSO_REFRESH_TOKEN` | `string?` | Long-lived refresh token for proactive token renewal |
| `SSO_TOKEN_EXPIRES_AT` | `number?` | Unix timestamp (ms) when SSO_TOKEN expires |
| `user` | `AuthUser?` | Authenticated user info (`{ id, email? }`) |

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
| `baseURL` | `string` | `${WAVE_SERVER_URL}/api/v1` |
| `defaultHeaders` | `Record<string, string>?` | Custom headers (if any) |
| `fetchOptions` | `ClientOptions.fetchOptions?` | Fetch options |
| `fetch` | `ClientOptions.fetch?` | Auth-aware fetch implementation (wrapped with `createAuthAwareFetch`) |

### TokenResponse (from POST /api/auth/token)

| Field | Type | Description |
|-------|------|-------------|
| `token` | `string` | JWT access token |
| `refreshToken` | `string?` | Long-lived refresh token (for future token renewal) |
| `expiresIn` | `number?` | Seconds until token expires (absent = never expires) |
| `user` | `{ id: string, email?: string }` | Authenticated user info |

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
1. SSO_TOKEN exists in ~/.wave/auth.json → { apiKey: SSO_TOKEN, baseURL: ${WAVE_SERVER_URL}/api/v1 }
2. Constructor args (apiKey, baseURL)
3. AgentOptions (this.options.apiKey, this.options.baseURL)
4. Settings.json env vars (WAVE_API_KEY, WAVE_BASE_URL)
5. process.env (WAVE_API_KEY, WAVE_BASE_URL)
6. Error (missing baseURL)
```

## serverUrl Priority for AuthService.login()

```
1. login({serverUrl}) — explicit override
2. authService._serverUrl — previously set server URL
3. WAVE_SERVER_URL — environment variable
```

## `~/.wave/auth.json` Example

```json
{
  "SSO_TOKEN": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "SSO_REFRESH_TOKEN": "dGhpcyBpcyBhIHJlZnJlc2gg...",
  "SSO_TOKEN_EXPIRES_AT": 1747891234567,
  "user": {
    "id": "user-uuid",
    "email": "user@example.com"
  }
}
```

## Token Refresh Flow

```
1. Before each API request: isTokenExpired() checks 5-min buffer
2. If expired → checkAndRefreshTokenIfNeeded() (dedup: shares in-flight promise)
3. refreshToken() → POST /api/auth/token { grant_type: "refresh_token", refresh_token }
4. On success: save new SSO_TOKEN, SSO_REFRESH_TOKEN, SSO_TOKEN_EXPIRES_AT
5. On 400/401 (revoked): clearAuth() → user must re-login
6. On network error: return false, preserve existing auth
   - All refresh operations MUST log info-level `[Auth]` messages for audit/debugging.

Reactive 401/403 recovery (single retry):
1. Request returns 401/403
2. tryReadRefreshedTokenFromDisk() → another process may have refreshed
3. If disk refresh found → retry with new token
4. Else checkAndRefreshTokenIfNeeded() → force refresh
5. If refresh succeeds → retry with new token
6. Else → return original 401/403 response
```
