# Implementation Plan: Interactive Permission Trust

**Branch**: `032-interactive-permission-trust` | **Date**: 2025-12-26 | **Spec**: [/specs/032-interactive-permission-trust/spec.md](./spec.md)
**Input**: Feature specification from `/specs/032-interactive-permission-trust/spec.md`

## Summary

The primary requirement is to enhance the tool permission system by adding a second option to the confirmation prompt. For file system tools, this option will switch the session to `acceptEdits` mode. For the `Bash` tool, it will persist a specific command rule to `.wave/settings.local.json`. The system will also be updated to load and respect these persistent rules from both local and user-level settings on startup.

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: React (Ink), agent-sdk, pnpm
**Storage**: Local JSON files (`.wave/settings.local.json`, `~/.wave/settings.json`)
**Testing**: Vitest, HookTester
**Target Platform**: Linux/macOS (CLI)
**Project Type**: Monorepo (agent-sdk + code packages)
**Performance Goals**: Instant permission resolution for allowed rules (<10ms)
**Constraints**: Exact string matching for Bash commands; no circular dependencies between packages.
**Scale/Scope**: Core permission system enhancement affecting all restricted tool calls.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Changes will be correctly partitioned between `agent-sdk` (logic/storage) and `code` (UI/interaction).
- [x] **TypeScript Excellence**: Strict typing will be maintained; `PermissionDecision` will be evolved to support new state transitions.
- [x] **Test Alignment**: Tests will be added to `packages/agent-sdk/tests/managers/permissionManager.test.ts` and `packages/code/tests/components/Confirmation.test.tsx`.
- [x] **Build Dependencies**: `agent-sdk` will be built before testing `code` package changes.
- [x] **Documentation Minimalism**: No unnecessary markdown files will be created.
- [x] **Quality Gates**: `type-check` and `lint` will be run after implementation.
- [x] **Source Code Structure**: Logic will reside in `PermissionManager` and `ConfigurationService`; UI in `Confirmation` component.
- [x] **Type System Evolution**: `PermissionDecision` and `WaveConfiguration` will be evolved rather than creating redundant types.
- [x] **Data Model Minimalism**: `PermissionRule` will be a simple string format.

## Project Structure

### Documentation (this feature)

```
specs/032-interactive-permission-trust/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   └── permissionManager.ts
│   │   ├── services/
│   │   │   └── configurationService.ts
│   │   ├── types/
│   │   │   ├── permissions.ts
│   │   │   └── hooks.ts
│   │   └── utils/
│   │       └── configPaths.ts
│   └── tests/
│       └── managers/
│           └── permissionManager.test.ts
└── code/
    ├── src/
    │   ├── components/
    │   │   └── Confirmation.tsx
    │   └── contexts/
    │       └── useChat.tsx
    └── tests/
        └── components/
            └── Confirmation.test.tsx
```

**Structure Decision**: Standard monorepo structure with logic in `agent-sdk` and UI in `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
