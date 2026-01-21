# Implementation Plan: Subagent Support

**Branch**: `009-subagent-support` | **Date**: 2024-12-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-subagent-support/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement subagent support system that allows Wave Agent to delegate specialized tasks to configured AI personalities. Subagents operate with isolated context windows, have configurable tool access, and display as expandable message blocks in the UI. The system includes a Task tool for intelligent delegation, isolated aiManager and messageManager instances per subagent, and React components for subagent visualization.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript with Node.js >=16.0.0  
**Primary Dependencies**: OpenAI SDK 5.12.2, React 19.1.0, Ink 6.0.1, diff 8.0.2, glob 11.0.3  
**Storage**: File-based configuration (.wave/agents/, ~/.wave/agents/) with YAML frontmatter  
**Testing**: Vitest 3.2.4, HookTester for React hooks  
**Target Platform**: CLI application running on macOS, Linux, Windows
**Project Type**: Monorepo with packages (agent-sdk for core logic, code for CLI interface)  
**Performance Goals**: Subagent task completion within 150% of main agent time, <500ms for subagent selection  
**Constraints**: Context isolation between agents, no circular delegation, UI responsiveness during subagent execution  
**Scale/Scope**: Support for unlimited subagents per project, up to 10 most recent messages in expanded view, 2 messages in collapsed view

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

## Constitution Check (Post-Design)

*GATE: Re-evaluated after Phase 1 design completion.*

✅ **I. Package-First Architecture**: Design maintains clear package boundaries. SubagentManager and Task tool in agent-sdk, UI components in code package. No circular dependencies introduced. Each subagent gets isolated aiManager/messageManager instances.

✅ **II. TypeScript Excellence**: All new interfaces fully typed (SubagentConfiguration, SubagentInstance, SubagentBlock, TaskDelegation). No `any` types in design. Tool schema matches existing patterns with strict typing.

✅ **III. Test Alignment**: Test structure follows existing patterns. Unit tests in packages/*/tests, integration tests use temporary directories for .wave/agents/ testing. HookTester planned for React components.

✅ **IV. Build Dependencies**: Design requires agent-sdk build before code package testing. Task tool and types must be built first, then UI components can import and use them.

✅ **V. Documentation Minimalism**: Created only implementation documentation (research.md, data-model.md, contracts/, quickstart.md) as required by speckit workflow. No additional user-facing docs.

✅ **VI. Quality Gates**: Design includes comprehensive type checking and linting requirements. All new code will pass type-check and lint before commit.

**Design Validation**: All constitutional principles maintained. Ready to proceed with implementation.

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
│   │   ├── tools/
│   │   │   ├── taskTool.ts                    # NEW: Task delegation tool
│   │   │   └── types.ts                       # EXTEND: Add subagent types
│   │   ├── managers/
│   │   │   ├── messageManager.ts              # EXTEND: Add subagent callbacks
│   │   │   ├── aiManager.ts                   # EXTEND: Add subagent instance support
│   │   │   └── subagentManager.ts             # NEW: Subagent configuration & lifecycle
│   │   ├── utils/
│   │   │   └── subagentParser.ts             # NEW: YAML config parsing
│   │   └── types.ts                           # EXTEND: Add subagent message types
│   └── tests/
│       ├── tools/
│       │   └── taskTool.test.ts               # NEW: Task tool tests
│       ├── managers/
│       │   └── subagentManager.test.ts        # NEW: Subagent manager tests
│       └── utils/
│           └── subagentParser.test.ts         # NEW: Config parsing tests
└── code/
    ├── src/
    │   ├── components/
    │   │   ├── MessageList.tsx                # EXTEND: Add subagent block support
    │   │   ├── SubagentBlock.tsx              # NEW: Subagent message display
    │   │   ├── ToolResultDisplay.tsx          # REUSE: For subagent tool results
    │   │   └── DiffViewer.tsx                 # REUSE: For subagent diffs
    │   └── contexts/
    └── tests/
        └── components/
            └── SubagentBlock.test.tsx         # NEW: Subagent component tests
```

**Structure Decision**: Extending existing monorepo packages with clear separation between core logic (agent-sdk) and UI components (code). Subagent functionality integrated into existing tool/manager patterns while maintaining package boundaries.
```

**Structure Decision**: Extending existing monorepo packages with clear separation between core logic (agent-sdk) and UI components (code). Subagent functionality integrated into existing tool/manager patterns while maintaining package boundaries.

## Complexity Tracking

*No constitutional violations identified. All complexity justified by functional requirements.*

**Design Complexity Analysis**:
- **Multiple Manager Instances**: Isolated aiManager/messageManager per subagent required for context isolation (FR-007)
- **New Message Block Type**: SubagentBlock required for UI display requirements (FR-016-018, FR-020)
- **Callback Extensions**: MessageManager callbacks extended to support UI reactivity for subagent state
- **Configuration System**: File-based YAML parsing required by specification (FR-001, FR-002)

**Complexity Mitigation**:
- Reuses existing patterns (ToolPlugin interface, MessageBlock architecture, React component patterns)
- No new external dependencies beyond existing OpenAI SDK and React stack
- Maintains existing error handling and validation approaches
- Follows constitutional package boundaries and testing practices

