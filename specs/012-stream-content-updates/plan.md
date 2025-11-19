# Implementation Plan: Real-Time Content Streaming

**Branch**: `012-stream-content-updates` | **Date**: 2025-11-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-stream-content-updates/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement real-time streaming content updates for both agent-sdk and code packages. The agent-sdk will add `onAssistantContentUpdated` callback and enhance `onToolBlockUpdated` to support streaming parameter updates with accumulated data. The code package will use these callbacks to display incremental content updates in the CLI message list, showing streaming in collapsed view and static snapshots in expanded view.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript 5.9+, Node.js 16+  
**Primary Dependencies**: OpenAI SDK, Ink (React for CLI), React 19+  
**Storage**: Session files (existing), no new storage requirements  
**Testing**: Vitest for unit and integration tests  
**Target Platform**: CLI interface on Linux/macOS/Windows
**Project Type**: Monorepo with two packages (agent-sdk + code)  
**Performance Goals**: 60fps UI rendering  
**Constraints**: Minimal changes, additive approach for onAssistantMessageAdded simplification  
**Scale/Scope**: Handle long streaming responses (>10k characters)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **I. Package-First Architecture**: Feature maintains clear package boundaries. Changes to agent-sdk (callbacks) and code (UI updates) are properly separated with defined interfaces.

✅ **II. TypeScript Excellence**: All streaming callbacks and interfaces will be strictly typed. No `any` types in streaming functionality.

✅ **III. Test Alignment**: Tests will be in `packages/*/tests` directories. Streaming functionality requires both unit tests (mocked) and integration tests (real streaming). TDD workflow will be followed.

✅ **IV. Build Dependencies**: After modifying agent-sdk callbacks, `pnpm build` will be run before testing in code package.

✅ **V. Documentation Minimalism**: No new documentation files created. Code clarity and inline documentation sufficient.

✅ **VI. Quality Gates**: All type-check and lint requirements will be met for streaming implementations.

✅ **VII. Source Code Structure**: Changes follow established patterns - callbacks in MessageManagerCallbacks, streaming logic in aiService, UI updates in useChat context.

✅ **VIII. Test-Driven Development**: TDD workflow will be followed for all new streaming functionality. Tests written before implementation.

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
### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── managers/
│   │   │   ├── messageManager.ts     # Add onAssistantContentUpdated, modify onAssistantMessageAdded
│   │   │   └── aiManager.ts          # Add streaming support in sendAIMessage
│   │   ├── services/
│   │   │   └── aiService.ts          # Modify callAgent to support streaming API
│   │   ├── types/
│   │   │   ├── index.ts              # Update existing types for streaming callbacks
│   │   └── utils/
│   │       └── (removed streamingHelpers.ts for performance)   # Optimized: Direct parametersChunk usage
│   └── tests/
│       ├── managers/
│       │   ├── messageManager.streaming.test.ts
│       │   └── aiManager.streaming.test.ts
│       └── services/
│           └── aiService.streaming.test.ts
│
└── code/
    ├── src/
    │   ├── contexts/
    │   │   └── useChat.tsx           # Add streaming callbacks, snapshot logic
    │   ├── components/
    │   │   └── MessageList.tsx       # Render streaming updates based on isExpanded
    │   └── utils/
    │       └── streamingUtils.ts     # New: CLI-specific streaming utilities
    └── tests/
        ├── contexts/
        │   └── useChat.streaming.test.ts
        └── components/
            └── MessageList.streaming.test.ts
```

**Structure Decision**: Monorepo with existing package structure maintained. Changes are focused on extending existing files rather than creating new major components. Streaming utilities are added as new files to support the core functionality without disrupting existing architecture.

## Type Definitions

### Streaming Callback Interfaces

```typescript
// Complete interface definitions for streaming callbacks
export interface MessageManagerCallbacks {
  // Existing callbacks...
  onAssistantContentUpdated?: (chunk: string, accumulatedContent: string) => void;
  onAssistantMessageAdded?: () => void; // No arguments per FR-002a
}

// Note: AgentToolBlockUpdateParams already exists and will be enhanced with:
// - parametersChunk?: string; // New field per FR-002
```

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

