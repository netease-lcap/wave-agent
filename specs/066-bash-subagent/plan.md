# Implementation Plan - Bash Builtin Subagent

## Technical Context

The feature involves adding a new built-in subagent named "Bash" to the Wave agent system. This subagent is specialized in executing bash commands and git operations, offloading these tasks from the main agent to reduce context usage and improve reliability.

### Architecture
- **Package**: `packages/agent-sdk`
- **Registration**: `packages/agent-sdk/src/utils/builtinSubagents.ts`
- **Prompts**: `packages/agent-sdk/src/constants/prompts.ts`
- **Tools**: Uses existing `BASH_TOOL_NAME` from `packages/agent-sdk/src/tools/bashTool.ts`.

### Dependencies
- `agent-sdk` must be rebuilt after changes.
- `code` package will automatically pick up the new built-in subagent via the SDK.

## Constitution Check

- **I. Package-First Architecture**: Changes are confined to `agent-sdk`.
- **II. TypeScript Excellence**: Strict typing will be maintained for the new subagent configuration.
- **III. Test Alignment**: Unit tests will be added to `packages/agent-sdk/tests/utils/builtinSubagents.test.ts`.
- **VI. Quality Gates**: `pnpm build`, `type-check`, and `test` will be run.
- **IX. Type System Evolution**: Will extend `SubagentType` enum if necessary.
- **XI. Planning and Task Delegation**: Planning performed by general-purpose agent; implementation tasks will be delegated to specialized subagents.

## Phase 0: Outline & Research
- [x] Research subagent registration patterns (Completed in `research.md`)
- [x] Identify tool equivalents (Completed in `research.md`)

## Phase 1: Design & Contracts
- [x] Define data model for Bash subagent (Completed in `data-model.md`)
- [x] Create user-facing quickstart (Completed in `quickstart.md`)

## Phase 2: Implementation

### Task 1: Define Bash Subagent Prompt
- **File**: `packages/agent-sdk/src/constants/prompts.ts`
- **Action**: Add `BASH_SUBAGENT_SYSTEM_PROMPT` based on the reference implementation.

### Task 2: Register Bash Subagent
- **File**: `packages/agent-sdk/src/utils/builtinSubagents.ts`
- **Action**: 
    - Implement `createBashSubagent()` function.
    - Add it to `getBuiltinSubagents()`.

### Task 3: Update Types
- **File**: `packages/agent-sdk/src/types.ts` (or wherever `SubagentType` is defined)
- **Action**: Add `Bash` to the subagent type definitions if not already present.

### Task 4: Verification & Testing
- **Action**:
    - Run `pnpm -F wave-agent-sdk build`
    - Add unit tests in `packages/agent-sdk/tests/utils/builtinSubagents.test.ts`.
    - Run `pnpm -F wave-agent-sdk test`.
