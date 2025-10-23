# Implementation Plan: Hook JSON Input Support

**Branch**: `002-hook-json-input` | **Date**: 2024-12-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-hook-json-input/spec.md`

## Summary

Implement JSON data input via stdin for Wave Agent SDK hooks system. This feature enables hooks to receive structured session information (session_id, transcript_path, cwd, hook_event_name) and event-specific data (tool details, prompts, responses) for PreToolUse, PostToolUse, UserPromptSubmit, and Stop events. The implementation modifies the HookExecutor to pass JSON data to hook processes while maintaining backward compatibility with existing hooks that don't read stdin.

## Phase Status

- ✅ **Phase 0**: Research completed - Understanding of existing hooks system and integration points
- ✅ **Phase 1**: Design completed - Data model, type contracts, and API design finalized  
- 🔄 **Phase 2**: Ready for implementation - Use `/speckit.tasks` to generate implementation tasks

## Technical Context

**Language/Version**: TypeScript 5.9+, Node.js 16+  
**Primary Dependencies**: Node.js child_process spawn, Wave Agent SDK hooks system  
**Storage**: JSON session files (~/.wave/sessions/session_[shortId].json)  
**Testing**: Vitest, integration tests in examples/, unit tests in tests/  
**Target Platform**: Cross-platform (Windows, macOS, Linux) via Node.js  
**Project Type**: Monorepo package (agent-sdk) modification  
**Performance Goals**: JSON input delivery within 100ms, <50ms overhead per hook  
**Constraints**: Backward compatibility required, non-blocking stdin handling  
**Scale/Scope**: Core SDK feature affecting all hook implementations

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

✅ **Package-First Architecture**: Modifying existing agent-sdk package, no new packages or circular dependencies  
✅ **TypeScript Excellence**: All new code in TypeScript with strict types, no any types  
✅ **Test Alignment**: Unit tests in packages/agent-sdk/tests/, integration tests in packages/agent-sdk/examples/  
✅ **Build Dependencies**: Changes to agent-sdk require pnpm build before testing  
✅ **Documentation Minimalism**: No new markdown files, focus on code clarity  
✅ **Quality Gates**: Must run pnpm run type-check and pnpm run lint after changes

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
│   ├── hooks/
│   │   ├── executor.ts          # MODIFY: Add JSON stdin support
│   │   ├── manager.ts           # MODIFY: Pass additional context data
│   │   ├── types.ts             # MODIFY: Add JSON input type definitions
│   │   └── index.ts             # No changes needed
│   ├── services/
│   │   └── session.ts           # Reference: For session ID and transcript path logic
│   ├── managers/
│   │   ├── aiManager.ts         # MODIFY: Pass tool input/response data
│   │   └── messageManager.ts    # Reference: For message context
│   └── agent.ts                 # MODIFY: Pass user prompt data
├── tests/hooks/
│   ├── executor.test.ts         # MODIFY: Add JSON input tests
│   ├── manager.test.ts          # MODIFY: Update context tests
│   └── json-input.test.ts       # CREATE: Comprehensive JSON input tests
└── examples/
    └── hook-json-input.ts       # CREATE: All-in-one demo with real hook execution
```

**Structure Decision**: Monorepo package modification following existing patterns. Primary changes in hooks/ directory with supporting modifications in managers/ and agent.ts. Tests split between unit tests (mocking) and examples (real execution with `pnpm tsx`).

## Complexity Tracking

*No constitution violations identified. Feature follows existing patterns.*

