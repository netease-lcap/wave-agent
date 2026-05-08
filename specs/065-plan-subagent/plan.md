# Implementation Plan: Plan Subagent Support

**Branch**: `065-plan-subagent` | **Date**: 2026-02-12 | **Spec**: [/specs/065-plan-subagent/spec.md](./spec.md)
**Input**: Feature specification from `/specs/065-plan-subagent/spec.md`

## Summary

Implement a built-in "Plan" subagent specialized for designing implementation plans. The Plan subagent acts as a software architect, exploring codebases in read-only mode and producing detailed implementation strategies with critical files identified. Users can spawn Plan subagents from plan mode or via the Task tool to explore various implementation approaches.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `wave-agent-sdk`
**Testing**: Vitest
**Target Platform**: Linux/macOS/Windows (Node.js)
**Project Type**: Monorepo (agent-sdk, code)
**Performance Goals**: Fast subagent spawning, efficient read-only exploration
**Constraints**: Read-only enforcement for all files; no nested subagents; inherits parent model
**Scale/Scope**: Built-in subagent addition to existing subagent system

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Package-First Architecture: Logic in `agent-sdk` (built-in subagent definition)
- [x] TypeScript Excellence: Strict typing for subagent configuration
- [x] Test Alignment: Unit tests in `packages/agent-sdk/tests`
- [x] Documentation Minimalism: Spec and quickstart only
- [x] Quality Gates: `pnpm run type-check` and `pnpm run lint` will be run
- [x] Data Model Minimalism: Simple extension to existing `SubagentConfiguration`

## Project Structure

### Documentation (this feature)

```
specs/065-plan-subagent/
├── spec.md              # Feature specification
├── plan.md              # This file
├── data-model.md        # Entity definitions
├── tasks.md             # Implementation tasks
├── quickstart.md        # Usage guide
└── checklists/
    └── requirements.md  # FR checklist
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── constants/
│   │   │   └── prompts.ts              # Add PLAN_SUBAGENT_SYSTEM_PROMPT
│   │   └── utils/
│   │       └── builtinSubagents.ts     # Add createPlanSubagent()
│   └── tests/
│       └── utils/
│           └── builtinSubagents.test.ts # Add Plan subagent tests
```

**Structure Decision**: Minimal changes to existing codebase. New Plan subagent definition added to `builtinSubagents.ts`. System prompt added to `prompts.ts`. No changes to SubagentManager or Task tool - they already support built-in subagents.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

## Implementation Strategy

### Phase 1: System Prompt Definition
**Goal**: Define the Plan subagent system prompt with read-only restrictions

1. Add `PLAN_SUBAGENT_SYSTEM_PROMPT` constant to `packages/agent-sdk/src/constants/prompts.ts`
2. Include all sections: role definition, critical restrictions, process workflow, output format, tool guidance, prohibitions

### Phase 2: Subagent Definition
**Goal**: Create Plan subagent configuration

1. Add `createPlanSubagent()` function to `packages/agent-sdk/src/utils/builtinSubagents.ts`
2. Configure with:
   - name: "Plan"
   - description: when to use guidance
   - systemPrompt: PLAN_SUBAGENT_SYSTEM_PROMPT
   - tools: ["Glob", "Grep", "Read", "Bash", "LS", "LSP"]
   - model: "inherit"
   - scope: "builtin"
   - priority: 3

3. Add to `getBuiltinSubagents()` array

### Phase 3: Testing
**Goal**: Verify Plan subagent works correctly

1. Add unit tests to `packages/agent-sdk/tests/utils/builtinSubagents.test.ts`:
   - Test Plan subagent is loaded
   - Test read-only tool configuration
   - Test system prompt includes critical sections
   - Test "inherit" model setting
   - Test priority and scope

2. Add integration tests:
   - Spawn Plan subagent via Task tool
   - Verify read-only enforcement
   - Test multiple Plan subagents in parallel
   - Verify output format

### Phase 4: Documentation
**Goal**: Document the new Plan subagent

1. Update AGENTS.md to mention Plan subagent
2. Update README files to list Plan in built-in subagents
3. Create quickstart.md with usage examples

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (System Prompt)**: No dependencies - can start immediately
- **Phase 2 (Subagent Definition)**: Depends on Phase 1 completion
- **Phase 3 (Testing)**: Depends on Phase 2 completion
- **Phase 4 (Documentation)**: Can run in parallel with Phase 3

### Parallel Opportunities

- System prompt definition and test file creation can be done in parallel
- Documentation and testing can be done in parallel once implementation is complete

## Notes

- Follows exact pattern of existing Explore built-in subagent
- No changes to SubagentManager or Task tool required
- Read-only enforcement handled by existing tool filtering system
- Plan subagent can be overridden by user configs at project or user level
