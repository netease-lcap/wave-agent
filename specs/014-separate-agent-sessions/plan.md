# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 18+)
**Primary Dependencies**: `agent-sdk` (internal), `fs` (Node.js built-in)
**Storage**: File system (JSON files)
**Testing**: Vitest
**Target Platform**: Linux/Node.js
**Project Type**: Monorepo (packages/agent-sdk)
**Performance Goals**: N/A
**Constraints**: Backward compatibility for existing sessions
**Scale/Scope**: Small - modification of existing classes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Package-First Architecture**: ✅ Compliant. Changes are within `agent-sdk`.
- **II. TypeScript Excellence**: ✅ Compliant. Will use strict types.
- **III. Test Alignment**: ✅ Compliant. Will add tests in `packages/agent-sdk/tests`.
- **IV. Build Dependencies**: ✅ Compliant. Will need to build `agent-sdk` after changes.
- **V. Documentation Minimalism**: ✅ Compliant. No extra docs unless requested.
- **VI. Quality Gates**: ✅ Compliant. Will run type-check and lint.
- **VII. Source Code Structure**: ✅ Compliant. Following existing structure.
- **VIII. Test-Driven Development**: ✅ Compliant. Will follow TDD.

## Project Structure

### Documentation (this feature)

```
specs/014-separate-agent-sessions/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
packages/agent-sdk/src/
├── managers/
│   ├── messageManager.ts
│   └── subagentManager.ts
└── services/
    └── session.ts

packages/agent-sdk/tests/
└── services/
    └── session.test.ts
```

**Structure Decision**: Modifying existing files in `packages/agent-sdk`. No new packages or directories needed.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

