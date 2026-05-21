# Implementation Plan: SSO Authentication

**Branch**: `076-sso-auth` | **Status**: Implemented (incl. token expiration & refresh) | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)

## Summary

Add `/login` and `/logout` slash commands for SSO authentication via Wave AI. AuthService handles browser-based SSO flow with localhost callback (receives authorization code, exchanges for JWT via `POST /api/auth/token` with `grant_type: "authorization_code"`), falls back to manual code input for remote servers. Gateway configuration prioritizes SSO mode when `~/.wave/auth.json` contains `SSO_TOKEN`, routing all LLM API requests through Wave AI's `/api/v1` proxy. Token expiration is handled via proactive refresh (5-min buffer), reactive 401/403 recovery with `createAuthAwareFetch`, and multi-process safety via file mtime detection.

## Technical Context

**Language/Version**: TypeScript (Node.js 22+)
**Primary Dependencies**: Node.js built-ins (`http`, `url`, `os`, `fs`, `path`, `child_process`)
**Testing**: Vitest (Unit and Integration tests)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (agent-sdk + code)
**Constraints**: Must not block agent operation on SSO failures; works on remote servers without browser
**Scale/Scope**: New authentication path for agent SDK and CLI

## Constitution Check

1. **Package-First Architecture**: AuthService in `agent-sdk`, LoginCommand in `code`. Pass.
2. **TypeScript Excellence**: Strict typing for `AuthConfig`, provider response, gateway config. Pass.
3. **Test Alignment**: Unit tests for AuthService and inputReducer. Pass.
4. **Build Dependencies**: `agent-sdk` must be built before `code`. Pass.
5. **Documentation Minimalism**: No extra files beyond spec structure. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: `auth.ts` in `types/`, `authService.ts` in `services/`, `LoginCommand.tsx` in `components/`. Pass.
8. **Data Model Minimalism**: `AuthConfig` with single `SSO_TOKEN` field. Pass.

## Architecture

```
User types /login → inputReducer → EXECUTE_COMMAND (local)
  → useInputManager → dispatch SET_SHOW_LOGIN_COMMAND
  → InputBox renders <LoginCommand>
    → User presses Enter → AuthService.login()
    → Browser opens → SSO flow → callback receives code → POST /api/auth/token { grant_type: "authorization_code", code } → JWT + refreshToken saved → UI updates
    → Remote server fallback: user pastes authorization code from browser URL bar → POST /api/auth/token → JWT + refreshToken saved

Token refresh flow:
  → Before API call: isTokenExpired() checks 5-min buffer
  → If expired → checkAndRefreshTokenIfNeeded() (dedup: shares in-flight promise)
  → POST /api/auth/token { grant_type: "refresh_token", refresh_token }
  → On 400/401 (revoked): clearAuth() → user must re-login
  → On network error: preserve existing auth, retry on next request

Reactive 401/403 recovery (createAuthAwareFetch):
  → Request returns 401/403
  → tryReadRefreshedTokenFromDisk() → another process may have refreshed
  → If disk refresh found → retry with new token
  → Else checkAndRefreshTokenIfNeeded() → force refresh
  → If refresh succeeds → retry with new token
  → Else → return original 401/403 response
```

## Files Modified

| File | Action |
|------|--------|
| `packages/agent-sdk/src/types/auth.ts` | Create (incl. `SSO_REFRESH_TOKEN`, `SSO_TOKEN_EXPIRES_AT`, `TokenResponse`) |
| `packages/agent-sdk/src/services/authService.ts` | Create (incl. token refresh methods, `createAuthAwareFetch`) |
| `packages/agent-sdk/src/types/index.ts` | Export auth types |
| `packages/agent-sdk/src/index.ts` | Export AuthService |
| `packages/agent-sdk/src/services/configurationService.ts` | Add SSO mode to resolveGatewayConfig + wrap fetch with `createAuthAwareFetch` |
| `packages/agent-sdk/src/services/remoteSettingsService.ts` | Wrap fetch with `createAuthAwareFetch` |
| `packages/code/src/constants/commands.ts` | Add login/logout entries |
| `packages/code/src/managers/inputReducer.ts` | Add showLoginCommand state + action |
| `packages/code/src/hooks/useInputManager.ts` | Add login/logout handlers + setter |
| `packages/code/src/components/LoginCommand.tsx` | Create |
| `packages/code/src/components/InputBox.tsx` | Render LoginCommand |
