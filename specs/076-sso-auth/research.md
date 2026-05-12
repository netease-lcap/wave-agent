# Research: SSO Authentication

## Decision: Localhost Callback with Manual Token Fallback

**Rationale**: The primary flow uses a localhost HTTP server to receive the SSO callback (standard OAuth/PKCE pattern). For remote servers where the callback cannot reach the CLI (SSH without port forwarding), a manual token input fallback is provided using Ink's `useInput` for terminal text capture.

**Alternatives considered**:
- **Device code flow (RFC 8628)**: Used by GitHub CLI, Azure CLI. Requires server-side endpoint changes on wave-admin. Rejected — adds server complexity, we can solve this client-side.
- **SSH port forwarding documentation**: Document `ssh -L port:127.0.0.1:port` workaround. Rejected — manual setup each session is poor UX.
- **Polling endpoint on wave-admin**: CLI gets session ID, polls server for token. Rejected — requires new server endpoint.

## Decision: `127.0.0.1` (IPv4) for Localhost Server

**Rationale**: On Linux, `localhost` may resolve to IPv6 (`::1`), but browser redirects target IPv4 (`127.0.0.1`). Binding explicitly to `127.0.0.1` ensures the callback reaches the server.

**Alternatives considered**:
- `localhost` binding: Rejected — may bind to IPv6, missing IPv4 callbacks on some systems.
- `0.0.0.0` binding: Rejected — exposes the callback port to the entire network, security risk.

## Decision: Merge Existing Auth Config on Save

**Rationale**: `saveAuth()` reads existing `auth.json` and merges new `SSO_TOKEN` into it, preserving any future fields (e.g., `REFRESH_TOKEN`, `EXPIRES_AT`).

**Alternatives considered**:
- Direct overwrite: Rejected — would lose future fields added to `auth.json`.

## Decision: `execFile` for Browser Opening

**Rationale**: Using `execFile` with separate command and args arrays prevents command injection via URL metacharacters. `exec` with string interpolation is vulnerable.

## Decision: Ink `useInput` for Token Input (Not readline)

**Rationale**: Ink already controls `process.stdin` in raw mode. Using `readline` would conflict with Ink's stdin handling, corrupting the terminal. Ink's `useInput` captures keystrokes including paste chunks, making it compatible.

**Alternatives considered**:
- `readline.createInterface`: Rejected — conflicts with Ink's stdin, both write to stdout.

## Decision: Wave-Admin as SSO Mediator

**Rationale**: wave-agent CLI does not connect directly to the company SSO IdP. Instead, wave-admin handles the OIDC/OAuth flow and redirects back to the CLI with a JWT. This keeps the CLI simple and centralized authentication in wave-admin.

## Decision: SSO Token Priority Over Direct LLM Config

**Rationale**: When `~/.wave/auth.json` contains `SSO_TOKEN`, gateway configuration resolution prioritizes SSO mode. This ensures authenticated users automatically use wave-admin's API proxy without needing to unset `WAVE_API_KEY`.

**Priority order**: SSO_TOKEN → constructor args → options → env (settings.json) → process.env → error.

## Integration Points

- `packages/code/src/constants/commands.ts`: `/login` and `/logout` command definitions.
- `packages/code/src/managers/inputReducer.ts`: `showLoginCommand` state management.
- `packages/code/src/hooks/useInputManager.ts`: Command dispatch + `setShowLoginCommand`.
- `packages/code/src/components/InputBox.tsx`: Render `LoginCommand` component.
- `packages/agent-sdk/src/services/configurationService.ts`: `resolveGatewayConfig()` SSO mode check.
- `packages/agent-sdk/src/services/aiService.ts`: Receives SSO `gatewayConfig` via `callAgent()` — no changes needed.
