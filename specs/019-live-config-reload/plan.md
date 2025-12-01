# Implementation Plan: Live Configuration Reload

**Branch**: `019-live-config-reload` | **Date**: 2024-12-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-live-config-reload/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement live configuration reload for Wave Agent SDK using Chokidar library for robust cross-platform file watching. Add support for environment variables in settings.json and optimize AGENTS.md memory caching to reduce I/O overhead. The Wave Code CLI will automatically inherit these capabilities since it uses the SDK.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript with Node.js 18+ (existing project standard)  
**Primary Dependencies**: Chokidar library for file watching, existing agent-sdk modules  
**Storage**: JSON files (settings.json) and Markdown files (AGENTS.md) on filesystem  
**Testing**: Vitest (existing project standard)  
**Target Platform**: Node.js cross-platform (Linux, macOS, Windows)
**Project Type**: Monorepo package (agent-sdk modification)  
**Performance Goals**: <10ms file watch response time, <1MB memory footprint for cached content  
**Constraints**: Must maintain backward compatibility, minimize external dependencies (Chokidar required for reliable cross-platform file watching)  
**Scale/Scope**: Single-user development environment, files typically <1MB

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

## Constitution Check (Post-Design)

*Re-evaluated after Phase 1 design completion*

✅ **I. Package-First Architecture**: Design maintains agent-sdk package boundaries with clear service separation  
✅ **II. TypeScript Excellence**: All contracts defined with strict TypeScript interfaces, no any types used  
✅ **III. Test Alignment**: Tests follow existing patterns with TDD approach, comprehensive coverage planned  
✅ **IV. Build Dependencies**: Changes are agent-sdk modifications requiring pnpm build before testing  
✅ **V. Documentation Minimalism**: No additional documentation files created beyond specification artifacts  
✅ **VI. Quality Gates**: Implementation will pass type-check and lint requirements  
✅ **VII. Source Code Structure**: Design follows agent-sdk patterns (services for I/O, managers for coordination, types for interfaces)  
✅ **VIII. Test-Driven Development**: Quickstart includes comprehensive test examples following TDD principles  
✅ **IX. Type System Evolution**: Renamed HookConfiguration to WaveConfiguration throughout codebase (types, imports, function signatures) to better express its expanded scope (hooks + environment variables) rather than creating separate configuration types

**Post-Design Result**: All constitutional principles maintained. The design properly extends existing systems without introducing architectural violations. Type system evolution follows principle IX by renaming `HookConfiguration` to `WaveConfiguration` to better express the complete configuration scope rather than creating separate configuration types.

## Project Structure

### Documentation (this feature)

```
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```
packages/agent-sdk/
├── src/
│   ├── services/
│   │   ├── hook.ts           # Extend for settings watching
│   │   └── memory.ts         # Extend for AGENTS.md caching
│   ├── managers/
│   │   └── liveConfigManager.ts    # Manage live reload coordination
│   ├── utils/
│   │   └── configResolver.ts # Extend for environment config live updates
│   ├── types/
│   │   └── hooks.ts          # Extend for env field
│   └── agent.ts              # Update to use cached memory
└── tests/
    ├── services/
    │   ├── hook.test.ts      # Add env field tests
    │   └── memory.test.ts    # Add caching tests
    └── managers/
        └── liveConfigManager.test.ts # Add live reload tests

packages/code/                 # CLI inherits SDK functionality automatically
```

**Structure Decision**: Modify existing agent-sdk package structure following established patterns. Services handle file I/O and watching, managers handle state coordination, types define new interfaces. No new packages needed as this extends existing functionality.



