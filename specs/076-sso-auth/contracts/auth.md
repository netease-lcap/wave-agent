# Contract: SSO Authentication

## AuthService Interface

```typescript
class AuthService {
  static getInstance(): AuthService;

  // Path & storage
  getAuthPath(): string;                     // Returns ~/.wave/auth.json
  loadAuth(): AuthConfig;                    // Reads and parses auth.json
  saveAuth(config: AuthConfig): void;        // Writes auth.json with 0o600 permissions
  clearAuth(): void;                         // Removes SSO_TOKEN, SSO_REFRESH_TOKEN, SSO_TOKEN_EXPIRES_AT, deletes file if empty

  // Token access
  getSSOToken(): string | undefined;         // Returns SSO_TOKEN or undefined
  isSSOAuthenticated(): boolean;             // Returns true if SSO_TOKEN exists and not past SSO_TOKEN_EXPIRES_AT
  isTokenExpired(): boolean;                 // Returns true if token is within 5-min buffer of SSO_TOKEN_EXPIRES_AT

  // Token refresh
  checkAndRefreshTokenIfNeeded(): Promise<boolean>;  // Proactively refreshes token if expired (5-min buffer), deduplicates concurrent calls
  tryReadRefreshedTokenFromDisk(): boolean;          // @internal — checks if another process refreshed token on disk

  // Server URL
  getServerUrl(): string;                    // Returns WAVE_SERVER_URL, throws if unset
  setServerUrl(url: string): void;           // Sets the server URL

  // Auth change callbacks
  onAuthChange(callback: () => void): () => void;  // Subscribe to auth state changes, returns unsubscribe fn

  // User info
  getAuthUser(): AuthUser | undefined;       // Returns authenticated user info

  // Login flow
  login(options?: {
    onAuthUrl?: (url: string) => void;       // Called with SSO URL for display
    readToken?: () => Promise<string>;       // Manual token input (remote server fallback)
    serverUrl?: string;                      // Override server URL for this login
  }): Promise<string>;                       // Resolves with the received token
}

export const authService: AuthService;       // Singleton instance

// Auth-aware fetch wrapper
export function createAuthAwareFetch(innerFetch: typeof fetch): typeof fetch;
// Wraps fetch with proactive token refresh + reactive 401/403 recovery
```

## AuthConfig

```typescript
interface AuthConfig {
  SSO_TOKEN?: string;
  SSO_REFRESH_TOKEN?: string;
  SSO_TOKEN_EXPIRES_AT?: number;  // Unix ms timestamp
  user?: AuthUser;
}

interface TokenResponse {
  token: string;
  refreshToken?: string;
  expiresIn?: number;  // seconds until expiry
  user: { id: string; email?: string };
}
```

## GatewayConfig (SSO Mode)

When `readSSOToken()` returns a non-empty value:

```typescript
interface GatewayConfig {
  apiKey: string;          // SSO_TOKEN
  baseURL: string;         // ${WAVE_SERVER_URL}/api/v1
  defaultHeaders?: Record<string, string>;
  fetchOptions?: ClientOptions["fetchOptions"];
  fetch?: ClientOptions["fetch"];  // Wrapped with createAuthAwareFetch for auth-aware requests
}
```

## Wave AI API Contracts

### GET /api/auth/sso-providers

**Response** (200):
```json
[
  {
    "provider": "netease",
    "displayName": "NetEase SSO"
  }
]
```

### GET /api/auth/sso/{provider}?callback_url={url}

**Behavior**: Redirects user to SSO IdP login page. After successful authentication, redirects to `callback_url?code={authorization_code}`.

### POST /api/auth/token (Authorization Code Exchange)

**Request**:
```json
{
  "grant_type": "authorization_code",
  "code": "short_authorization_code"
}
```

**Response** (200):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "dGhpcyBpcyBhIHJlZnJlc2gg...",
  "expiresIn": 28800,
  "user": {
    "id": "user-uuid",
    "email": "user@example.com"
  }
}
```

### POST /api/auth/token (Token Refresh)

**Request**:
```json
{
  "grant_type": "refresh_token",
  "refresh_token": "dGhpcyBpcyBhIHJlZnJlc2gg..."
}
```

**Response** (200):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "bmV3IHJlZnJlc2ggdG9rZW4...",
  "expiresIn": 28800,
  "user": {
    "id": "user-uuid",
    "email": "user@example.com"
  }
}
```

**Error** (400/401): Refresh token revoked — client must clear auth and re-login.

### Callback URL Response

**Expected**: `GET http://127.0.0.1:{port}?code={code}`

**Server responds with**: 200 HTML page "Authentication successful, you can close this window"

## File Contract: `~/.wave/auth.json`

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

- File permissions: `0o600` (owner read/write only)
- Created in `~/.wave/` directory (created recursively if missing)
- Merge semantics: new fields are merged with existing content
