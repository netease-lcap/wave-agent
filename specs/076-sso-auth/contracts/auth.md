# Contract: SSO Authentication

## AuthService Interface

```typescript
class AuthService {
  static getInstance(): AuthService;

  // Path & storage
  getAuthPath(): string;                     // Returns ~/.wave/auth.json
  loadAuth(): AuthConfig;                    // Reads and parses auth.json
  saveAuth(config: AuthConfig): void;        // Writes auth.json with 0o600 permissions
  clearAuth(): void;                         // Removes SSO_TOKEN, deletes file if empty

  // Token access
  getSSOToken(): string | undefined;         // Returns SSO_TOKEN or undefined
  isSSOAuthenticated(): boolean;             // Returns true if SSO_TOKEN exists

  // Admin URL
  getAdminBaseUrl(): string;                 // Returns WAVE_ADMIN_URL, throws if unset

  // Login flow
  login(options?: {
    onAuthUrl?: (url: string) => void;       // Called with SSO URL for display
    readToken?: () => Promise<string>;       // Manual token input (remote server fallback)
  }): Promise<string>;                       // Resolves with the received token
}

export const authService: AuthService;       // Singleton instance
```

## AuthConfig

```typescript
interface AuthConfig {
  SSO_TOKEN?: string;
}
```

## GatewayConfig (SSO Mode)

When `readSSOToken()` returns a non-empty value:

```typescript
interface GatewayConfig {
  apiKey: string;          // SSO_TOKEN
  baseURL: string;         // ${WAVE_ADMIN_URL}/api/v1
  defaultHeaders?: Record<string, string>;
  fetchOptions?: ClientOptions["fetchOptions"];
  fetch?: ClientOptions["fetch"];
}
```

## wave-admin API Contracts

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

### POST /api/auth/exchange

**Request**:
```json
{
  "code": "short_authorization_code"
}
```

**Response** (200):
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "username": "user@example.com"
  }
}
```

### Callback URL Response

**Expected**: `GET http://127.0.0.1:{port}?code={code}`

**Server responds with**: 200 HTML page "Authentication successful, you can close this window"

## File Contract: `~/.wave/auth.json`

```json
{
  "SSO_TOKEN": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

- File permissions: `0o600` (owner read/write only)
- Created in `~/.wave/` directory (created recursively if missing)
- Merge semantics: new fields are merged with existing content
