# Research: SSO Authentication

## Decision: Localhost Callback with Manual Token Fallback

**Rationale**: The primary flow uses a localhost HTTP server to receive the SSO callback (standard OAuth/PKCE pattern). For remote servers where the callback cannot reach the CLI (SSH without port forwarding), a manual token input fallback is provided using Ink's `useInput` for terminal text capture.

**Alternatives considered**:
- **Device code flow (RFC 8628)**: Used by GitHub CLI, Azure CLI. Requires server-side endpoint changes on Wave AI. Rejected — adds server complexity, we can solve this client-side.
- **SSH port forwarding documentation**: Document `ssh -L port:127.0.0.1:port` workaround. Rejected — manual setup each session is poor UX.
- **Polling endpoint on Wave AI**: CLI gets session ID, polls server for token. Rejected — requires new server endpoint.

## Decision: `127.0.0.1` (IPv4) for Localhost Server

**Rationale**: On Linux, `localhost` may resolve to IPv6 (`::1`), but browser redirects target IPv4 (`127.0.0.1`). Binding explicitly to `127.0.0.1` ensures the callback reaches the server.

**Alternatives considered**:
- `localhost` binding: Rejected — may bind to IPv6, missing IPv4 callbacks on some systems.
- `0.0.0.0` binding: Rejected — exposes the callback port to the entire network, security risk.

## Decision: Merge Existing Auth Config on Save

**Rationale**: `saveAuth()` reads existing `auth.json` and merges new `SSO_TOKEN` into it, preserving any future fields (e.g., `SSO_REFRESH_TOKEN`, `SSO_TOKEN_EXPIRES_AT`).

**Alternatives considered**:
- Direct overwrite: Rejected — would lose future fields added to `auth.json`.

## Decision: Proactive Token Refresh with 5-Minute Buffer

**Rationale**: Refreshing tokens proactively (5 minutes before expiry) prevents API call failures due to expired tokens. The refresh uses a standard OAuth 2.0 refresh token grant to `POST /api/auth/token`, following the same pattern as Claude Code's token refresh.

**Alternatives considered**:
- **On-demand refresh only (no buffer)**: Rejected — API calls would fail during the refresh window, causing poor UX.
- **Timer-based refresh**: Rejected — adds complexity, doesn't handle suspended processes, and doesn't coordinate with multi-process scenarios.

## Decision: File mtime for Multi-Process Token Refresh Detection

**Rationale**: When multiple Wave processes run simultaneously, each would independently detect token expiry and attempt refresh. By tracking `auth.json`'s mtime, a process can detect when another has already refreshed the token and read the fresh token from disk instead of making a redundant network call.

**Alternatives considered**:
- **File locking (flock)**: Rejected — platform-specific, adds complexity, not reliable on all filesystems.
- **PID file**: Rejected — doesn't handle crash recovery, stale PID files.

## Decision: Auth-Aware Fetch Wrapper

**Rationale**: Rather than modifying every API call site to handle token refresh, a fetch wrapper (`createAuthAwareFetch`) transparently adds proactive refresh (before request), Authorization header updates (with fresh token), and reactive 401/403 recovery (single retry after refresh). This ensures all API calls through `resolveGatewayConfig` SSO mode and `remoteSettingsService` automatically benefit.

**Alternatives considered**:
- **Interceptor pattern (like axios)**: Rejected — requires changing the HTTP client library.
- **Manual refresh at each call site**: Rejected — error-prone, lots of duplicated code.

## Decision: Deduplicate Concurrent Refresh Calls

**Rationale**: Multiple concurrent API calls that all detect token expiry should share a single in-flight refresh promise rather than making N parallel refresh requests. This prevents token churn and race conditions.

**Alternatives considered**:
- **Lock/mutex**: Rejected — overkill for single-process async dedup, adds complexity.
- **No dedup**: Rejected — would cause multiple simultaneous refresh requests, potentially revoking tokens used by other in-flight requests.

## Decision: `execFile` for Browser Opening

**Rationale**: Using `execFile` with separate command and args arrays prevents command injection via URL metacharacters. `exec` with string interpolation is vulnerable.

## Decision: Ink `useInput` for Token Input (Not readline)

**Rationale**: Ink already controls `process.stdin` in raw mode. Using `readline` would conflict with Ink's stdin handling, corrupting the terminal. Ink's `useInput` captures keystrokes including paste chunks, making it compatible.

**Alternatives considered**:
- `readline.createInterface`: Rejected — conflicts with Ink's stdin, both write to stdout.

## Decision: Wave-Admin as SSO Mediator

**Rationale**: wave-agent CLI does not connect directly to the company SSO IdP. Instead, Wave AI handles the OIDC/OAuth flow and redirects back to the CLI with a short-lived authorization code. The CLI then exchanges this code for a JWT via `POST /api/auth/token` with `{ grant_type: "authorization_code", code }`. This two-step flow follows the standard OAuth 2.0 authorization code pattern, keeping the JWT out of the URL bar (only a short-lived code is exposed).

## Decision: SSO Token Priority Over Direct LLM Config

**Rationale**: When `~/.wave/auth.json` contains `SSO_TOKEN`, gateway configuration resolution prioritizes SSO mode. This ensures authenticated users automatically use Wave AI's API proxy without needing to unset `WAVE_API_KEY`.

**Priority order**: SSO_TOKEN → constructor args → options → env (settings.json) → process.env → error.

## Integration Points

- `packages/code/src/constants/commands.ts`: `/login` and `/logout` command definitions.
- `packages/code/src/managers/inputReducer.ts`: `showLoginCommand` state management.
- `packages/code/src/hooks/useInputManager.ts`: Command dispatch + `setShowLoginCommand`.
- `packages/code/src/components/InputBox.tsx`: Render `LoginCommand` component.
- `packages/agent-sdk/src/services/configurationService.ts`: `resolveGatewayConfig()` SSO mode check.
- `packages/agent-sdk/src/services/aiService.ts`: Receives SSO `gatewayConfig` via `callAgent()` — no changes needed.
