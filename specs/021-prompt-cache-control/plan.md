# Implementation Plan: Prompt Cache Control

**Branch**: `021-prompt-cache-control` | **Date**: 2025-12-02 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/021-prompt-cache-control/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement cache_control functionality for cache-enabled models in the OpenAI provider to optimize token usage and reduce costs. The feature adds ephemeral cache markers using an adaptive strategy: system message (always cached), last tool definition, and an adaptive breakpoint — last user message for short conversations (≤20 content blocks) or a bridge marker at ~18 blocks from the end for long conversations (>20 blocks) to stay within the API's 20-block backward scan window. Cache control is applied only at the block level (content blocks and tool definitions), never at the message level. This includes extending usage tracking to capture cache-related metrics from both Claude top-level fields (cache_read_input_tokens, cache_creation_input_tokens) and OpenAI-standard prompt_tokens_details (cached_tokens, cache_creation_input_tokens), with Claude top-level fields taking priority. This ensures cache token tracking works across Claude, Gemini, DeepSeek, and other models that return cache data.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript/Node.js (existing codebase)  
**Primary Dependencies**: OpenAI SDK, existing agent-sdk architecture  
**Storage**: N/A (stateless message transformation)  
**Testing**: Vitest (existing test framework)  
**Target Platform**: Node.js runtime (cross-platform)
**Project Type**: Package enhancement (agent-sdk modification)  
**Performance Goals**: <50ms latency increase for cache transformation (acceptable overhead for 30-60% cost savings)  
**Constraints**: Claude API ephemeral cache with 5min-1hr duration, text-only content caching supported  
**Scale/Scope**: Expected cache hit rates 40-70% for system messages, 30-60% token cost reduction after 2-3 requests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### ✅ Package-First Architecture
- **PASS**: Modifying existing `agent-sdk` package, no new packages needed
- **PASS**: Clear boundaries maintained within aiService.ts
- **POST-DESIGN PASS**: New `utils/cacheControlUtils.ts` follows established patterns

### ✅ TypeScript Excellence  
- **PASS**: All code will be TypeScript with strict typing
- **PASS**: Extending existing type definitions for usage tracking
- **POST-DESIGN PASS**: All contracts defined with strict types, no `any` usage

### ✅ Test Alignment
- **PASS**: Tests will follow existing patterns in `packages/agent-sdk/tests/services/`
- **PASS**: Using Vitest framework as established
- **POST-DESIGN PASS**: New test file `aiService.cacheControl.test.ts` follows naming convention

### ✅ Build Dependencies
- **PASS**: Changes contained within agent-sdk, build process unchanged
- **PASS**: Using pnpm as specified
- **POST-DESIGN PASS**: No external dependencies added, only internal utility functions

### ✅ Documentation Minimalism
- **PASS**: No additional documentation files planned
- **PASS**: Code clarity through good naming and inline docs
- **POST-DESIGN PASS**: Contracts and data model are specification docs, not user-facing docs

### ✅ Quality Gates
- **PASS**: Will run type-check and lint after modifications
- **PASS**: All type safety maintained
- **POST-DESIGN PASS**: Type extensions preserve strict compilation requirements

### ✅ Source Code Structure
- **PASS**: Modifications to existing services/aiService.ts
- **PASS**: Types in existing types/core.ts
- **POST-DESIGN PASS**: New utility follows utils/ pattern for pure functions

### ✅ Test-Driven Development
- **PASS**: Will follow TDD workflow for new functionality
- **PASS**: Tests written before implementation
- **POST-DESIGN PASS**: Quickstart defines comprehensive test-first approach

### ✅ Type System Evolution
- **PASS**: Extending existing CallAgentResult interface for usage tracking
- **PASS**: No new types needed, composing with existing OpenAI types
- **POST-DESIGN PASS**: `ClaudeUsage` extends `CompletionUsage`, follows composition principle

**FINAL GATE STATUS**: ✅ ALL CONSTITUTION REQUIREMENTS MET

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
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```
packages/agent-sdk/
├── src/
│   ├── services/
│   │   └── aiService.ts           # Main modifications here
│   ├── types/
│   │   └── core.ts               # Extended usage types
│   └── utils/
│       └── cacheControlUtils.ts   # New utility functions
└── tests/
    └── services/
        ├── aiService.cacheControl.test.ts  # New test file
        ├── aiService.basic.test.ts         # Updated existing tests
        └── aiService.streaming.test.ts     # Updated existing tests
```

**Structure Decision**: Enhancing existing agent-sdk package structure. Primary changes in `services/aiService.ts` for cache control logic, `types/core.ts` for extended usage tracking types, and new utility file for cache control helpers. Tests follow existing pattern with new dedicated test file for cache control functionality.

## Complexity Tracking

### Breaking Changes Justification

| Breaking Change | Why Needed | Simpler Alternative Rejected Because |
|----------------|------------|-------------------------------------|
| Remove `cacheUserMessageCount` from config | Strategy is now hardcoded (system message + last tool only) | Maintaining unused properties creates technical debt |
| Delete `findRecentUserMessageIndices` | Function implements old strategy being replaced | Maintaining unused code creates technical debt |

