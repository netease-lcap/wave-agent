# Implementation Plan: Improved Message Cache Strategy

**Branch**: `029-cache-20-messages` | **Date**: 2025-12-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/029-cache-20-messages/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Completely replace the Claude cache control strategy from caching "last 2 user messages" to caching messages at 20-message intervals (every 20th, 40th, 60th user message). This is a **breaking change** that removes all backward compatibility, simplifying the codebase by eliminating legacy "recent message" logic and implementing only interval-based caching.

## Technical Context

**Language/Version**: TypeScript (existing project)  
**Primary Dependencies**: OpenAI SDK, existing agent-sdk dependencies  
**Storage**: No storage changes needed (cache control is runtime optimization)  
**Testing**: Vitest (existing testing framework)  
**Target Platform**: Node.js CLI application (existing)
**Project Type**: Monorepo - changes isolated to agent-sdk package  
**Performance Goals**: No specific performance requirements - replace existing caching logic  
**Constraints**: **BREAKING CHANGE** - no backward compatibility, existing configurations must be updated  
**Scale/Scope**: Affects all Claude model cache control, requires updates to consuming code

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial Check (Pre-Phase 0)
✅ **PASSED** - All constitutional requirements satisfied

### Post-Design Re-evaluation (After Phase 1)

✅ **I. Package-First Architecture**: ✅ **CONFIRMED** - All changes isolated to single utility file in existing `agent-sdk` package, no new packages or dependencies, clear separation maintained

✅ **II. TypeScript Excellence**: ✅ **CONFIRMED** - Enhanced interfaces maintain strict typing, extended existing `CacheControlConfig` interface, no `any` types introduced, comprehensive type safety for cache control

✅ **III. Test Alignment**: ✅ **CONFIRMED** - Test strategy focuses on essential cache behavior (interval calculations, backward compatibility, edge cases) with clear test organization in existing test structure

✅ **IV. Build Dependencies**: ✅ **CONFIRMED** - Changes to `agent-sdk` utilities require standard `pnpm build` workflow, no additional build dependencies

✅ **V. Documentation Minimalism**: ✅ **CONFIRMED** - No external documentation files created, quickstart guide is for development purposes only

✅ **VI. Quality Gates**: ✅ **CONFIRMED** - All enhancements maintain TypeScript strict mode compliance and linting standards, enhanced interfaces pass type-check validation

✅ **VII. Source Code Structure**: ✅ **CONFIRMED** - Changes follow established utils pattern in agent-sdk, cache control logic properly organized in utilities, maintains functional separation

✅ **VIII. Test-Driven Development**: ✅ **CONFIRMED** - Essential testing approach with focus on critical cache behavior, interval logic, and compatibility scenarios without over-testing

✅ **IX. Type System Evolution**: ✅ **CONFIRMED** - Extended existing `CacheControlConfig` interface with optional properties, no unnecessary new types, backward compatible type evolution

✅ **X. Data Model Minimalism**: ✅ **CONFIRMED** - Minimal configuration additions (2 optional properties), concise interval logic, simple user message counting without complex hierarchies

**Final Constitution Compliance**: ✅ **PASS** - All constitutional requirements satisfied in both initial assessment and post-design validation. Design maintains architectural consistency while adding focused cache control enhancements.

## Project Structure

### Documentation (this feature)

```
specs/029-cache-20-messages/
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
└── utils/
    └── cacheControlUtils.ts           # PRIMARY: Replace cache logic entirely, remove legacy functions

packages/agent-sdk/tests/
└── utils/
    └── cacheControlUtils.test.ts      # Replace tests for interval-based caching only
```

**Structure Decision**: **Breaking change** implementation contained within single utility file. All legacy "recent message" caching logic will be removed and replaced with interval-based logic only. No backward compatibility code - clean replacement implementation.

## Complexity Tracking

### Breaking Changes Justification

| Breaking Change | Why Needed | Simpler Alternative Rejected Because |
|----------------|------------|-------------------------------------|
| Remove `cacheUserMessageCount` | User explicitly requested no backward compatibility | Keeping both properties would add unnecessary complexity |
| Delete `findRecentUserMessageIndices` | Function implements old strategy being replaced | Maintaining unused code creates technical debt |
| Replace configuration structure | Simplifies API to single caching strategy | Dual configuration support adds branching complexity |

**User-Requested Simplification**: User explicitly stated "do not maintain backward compatibility, remove all related code" - these breaking changes align with requirements for clean, simplified implementation.