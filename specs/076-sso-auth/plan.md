# Implementation Plan: SSO Authentication

**Branch**: `076-sso-auth` | **Status**: Implemented | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)

## Summary

Add `/login` and `/logout` slash commands for SSO authentication via wave-admin. AuthService handles browser-based SSO flow with localhost callback, falls back to manual token input for remote servers. Gateway configuration prioritizes SSO mode when `~/.wave/auth.json` contains `SSO_TOKEN`, routing all LLM API requests through wave-admin's `/api/v1` proxy.

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
    → Browser opens → SSO flow → token saved → UI updates
    → Remote server fallback: user pastes token from browser URL bar
```

## Files Modified

| File | Action |
|------|--------|
| `packages/agent-sdk/src/types/auth.ts` | Create |
| `packages/agent-sdk/src/services/authService.ts` | Create |
| `packages/agent-sdk/src/types/index.ts` | Export auth types |
| `packages/agent-sdk/src/index.ts` | Export AuthService |
| `packages/agent-sdk/src/services/configurationService.ts` | Add SSO mode to resolveGatewayConfig |
| `packages/code/src/constants/commands.ts` | Add login/logout entries |
| `packages/code/src/managers/inputReducer.ts` | Add showLoginCommand state + action |
| `packages/code/src/hooks/useInputManager.ts` | Add login/logout handlers + setter |
| `packages/code/src/components/LoginCommand.tsx` | Create |
| `packages/code/src/components/InputBox.tsx` | Render LoginCommand |
