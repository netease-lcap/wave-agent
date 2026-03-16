# Implementation Plan: Support Plan Mode

**Branch**: `050-plan-mode` | **Date**: 2026-01-19 | **Spec**: [/specs/050-plan-mode/spec.md](./spec.md)
**Input**: Feature specification from `/specs/050-plan-mode/spec.md`

## Summary
Implement a "Plan Mode" permission state that allows the LLM to analyze the codebase in a read-only manner while building a plan in a designated plan file. Users can cycle through permission modes (Full Access -> Accept Edits -> Plan Mode) using `Shift+Tab`.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `wave-agent-sdk`, `minimatch`, `crypto`
**Storage**: Filesystem (`~/.wave/plans/`)
**Testing**: Vitest
**Target Platform**: Linux/macOS/Windows (Node.js)
**Project Type**: Monorepo (agent-sdk, code)
**Performance Goals**: Instant mode switching, minimal overhead for permission checks.
**Constraints**: Read-only enforcement for all files except the plan file; no bash command execution in Plan Mode. The plan file is managed by the LLM using `Write` and `Edit` tools.
**Scale/Scope**: Core permission system enhancement.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Package-First Architecture: Logic split between `agent-sdk` (core) and `code` (UI).
- [x] TypeScript Excellence: Strict typing for new `plan` mode and `PlanManager`.
- [x] Test Alignment: Unit tests in `packages/*/tests`.
- [x] Documentation Minimalism: No extra MD docs beyond specs.
- [x] Quality Gates: `pnpm run type-check` and `pnpm run lint` will be run.
- [x] Data Model Minimalism: Simple `PlanFile` entity and extended `PermissionMode`.
- [x] Deterministic Naming: Plan file names are stable within a session chain using `rootSessionId`.

## Project Structure

### Documentation (this feature)

```
specs/050-plan-mode/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-extensions.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   ├── permissionManager.ts  # Update for plan mode
│   │   │   ├── planManager.ts        # New manager for plan files
│   │   │   └── aiManager.ts          # Update system prompt
│   │   ├── types/
│   │   │   └── permissions.ts        # Add "plan" mode
│   │   └── utils/
│   │       └── nameGenerator.ts      # New utility for deterministic names
│   └── tests/
│       └── managers/
│           ├── permissionManager.plan.test.ts
│           └── planManager.test.ts
└── code/
    ├── src/
    │   ├── managers/
    │   │   └── InputManager.ts       # Update Shift+Tab cycle
    │   └── components/
    │       └── PermissionIndicator.tsx # Visual feedback (if needed)
    └── tests/
        └── managers/
            └── InputManager.plan.test.ts
```

**Structure Decision**: Standard monorepo structure following the constitution. Core logic in `agent-sdk`, UI integration in `code`.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
