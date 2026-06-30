# Implementation Plan: Server-Managed Config Download

**Branch**: `055-server-managed-config` | **Status**: Planned | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/055-server-managed-config/spec.md`

## Summary

Add a `RemoteSettingsService` that downloads managed settings from Wave AI during initialization when SSO is authenticated. Settings are cached locally with checksum-based deduplication and merged with local settings using priority: managed > local user > local project.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Existing AuthService, ConfigurationService, InitializationService
**Testing**: Vitest (Unit + integration tests)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (agent-sdk + code)
**Constraints**: Must not block startup on network errors; must preserve local settings not overridden by managed settings

## Constitution Check

1. **Package-First Architecture**: `RemoteSettingsService` in `agent-sdk`, integrated in `ConfigurationService`. Pass.
2. **TypeScript Excellence**: Strict typing for managed settings and cache. Pass.
3. **Test Alignment**: Unit tests for download, caching, and merge logic. Pass.
4. **Build Dependencies**: `agent-sdk` must be built before `code`. Pass.
5. **Quality Gates**: `type-check` and `lint` required. Pass.

## Project Structure

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── services/
│   │   │   └── remoteSettingsService.ts    # NEW: Download, cache, merge managed settings
│   │   ├── types/
│   │   │   └── agent.ts                    # Add remoteSettings-related types if needed
│   │   └── utils/
│   │       └── containerSetup.ts           # Wire RemoteSettingsService into DI container
│   └── tests/
│       └── services/
│           └── remoteSettingsService.test.ts  # NEW: Unit tests
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
