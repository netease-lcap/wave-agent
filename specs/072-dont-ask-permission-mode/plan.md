# Implementation Plan: dontAsk Permission Mode

**Branch**: `072-dont-ask-permission-mode` | **Date**: 2026-03-18 | **Spec**: [./spec.md]
**Input**: Feature specification from `./spec.md`

## Summary
The primary requirement is to support a new permission mode called `dontAsk`. In this mode, any restricted tool call that is not pre-approved in `permissions.allow` or `temporaryRules` will be automatically denied without prompting the user. The agent will be informed of this mode via a system prompt message. This mode will not be accessible via the "Shift+Tab" shortcut in the CLI. It can be enabled by setting `defaultMode` to `dontAsk` in the configuration.

## Technical Context
- **Language/Version**: TypeScript (Node.js)
- **Primary Dependencies**: `agent-sdk`, `code` (React Ink)
- **Storage**: `settings.json`, `settings.local.json` (via `ConfigurationService`)
- **Testing**: Vitest, HookTester
- **Target Platform**: Node.js (CLI)
- **Project Type**: Monorepo (pnpm)
- **Performance Goals**: N/A (standard CLI performance)
- **Constraints**: No circular dependencies, strict typing, mandatory unit/integration tests.
- **Scale/Scope**: `agent-sdk` and `code` packages.

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Package-First Architecture**: Changes will be in `agent-sdk` and `code`.
- [x] **II. TypeScript Excellence**: Strict typing will be used.
- [x] **III. Test Alignment**: Unit and integration tests are required. `pnpm test:coverage` must be maintained.
- [x] **IV. Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
- [x] **V. Documentation Minimalism**: Only requested docs (`quickstart.md`) will be created.
- [x] **VI. Quality Gates**: `type-check`, `lint`, and `test:coverage` will be run.
- [x] **VII. Source Code Structure**: Following established patterns.
- [x] **VIII. Test-Driven Development**: For critical logic in `PermissionManager`.
- [x] **IX. Type System Evolution**: Extending `PermissionMode` type.
- [x] **X. Data Model Minimalism**: Minimal changes to configuration.
- [x] **XI. Planning and Task Delegation**: Using general-purpose agent for planning.
- [x] **XII. User-Centric Quickstart**: `quickstart.md` will be for end-users.

**REQUIRED**: All planning phases MUST be performed using the **general-purpose agent** to ensure technical accuracy and codebase alignment. Always use general-purpose agent for every phrase during planning. All changes MUST maintain or improve test coverage; run `pnpm test:coverage` to validate.

## Project Structure

### Documentation (this feature)
```
specs/072-dont-ask-permission-mode/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command) - USER FACING
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
```
packages/agent-sdk/
├── src/
│   ├── types/
│   │   └── permissions.ts   # Update PermissionMode type
│   ├── managers/
│   │   ├── permissionManager.ts # Update checkPermission logic
│   │   └── aiManager.ts     # Update system prompt injection
│   └── prompts/
│       └── index.ts         # Update buildSystemPrompt
└── tests/
    └── managers/
        └── permissionManager.test.ts # Add tests for dontAsk mode

packages/code/
├── src/
│   └── managers/
│       └── inputHandlers.ts # Update cyclePermissionMode
└── tests/
    └── managers/
        └── inputHandlers.test.ts # Add tests for cyclePermissionMode
```

**Structure Decision**: Monorepo structure with changes in `agent-sdk` and `code` packages.

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
