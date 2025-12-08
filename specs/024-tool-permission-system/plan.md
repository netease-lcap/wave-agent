# Implementation Plan: Tool Permission System

**Branch**: `024-tool-permission-system` | **Date**: 2025-12-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-tool-permission-system/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Add permission system to Wave Agent SDK with "default" and "bypassPermissions" modes. In default mode, system prompts for confirmation before executing destructive tools (Edit, MultiEdit, Delete, Bash). Users can bypass with `--dangerously-skip-permissions` CLI flag. System implements `canUseTool` callback in Agent SDK for custom authorization and adds confirmation component to CLI. **Updated**: System supports multiple tool calls with individual sequential confirmations, allowing granular user control per tool while batching results back to AI.

## Technical Context

**Language/Version**: TypeScript 5.x (inferred from existing codebase)  
**Primary Dependencies**: React 19.1.0, Ink 6.5.1, OpenAI SDK 5.12.2, Yargs 17.7.2  
**Storage**: File-based session storage (existing), no additional storage needed  
**Testing**: Vitest 3.2.4 (existing testing framework)  
**Target Platform**: Node.js 16+ CLI environment with terminal interaction support  
**Project Type**: Monorepo - modifications to both `agent-sdk` and `code` packages  
**Performance Goals**: Immediate response to user input, minimal permission check impact  
**Constraints**: Must maintain backward compatibility, no breaking changes to existing API  
**Scale/Scope**: Single agent instance, interactive CLI confirmation, up to 10 concurrent tool executions, sequential confirmation handling for multiple tool calls with batched result return

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**✅ Package-First Architecture**: Modifications contained within existing `agent-sdk` and `code` packages. No new packages needed, maintains clear boundaries.

**✅ TypeScript Excellence**: All new code will use strict TypeScript with comprehensive type definitions. No `any` types planned.

**✅ Test Alignment**: Tests will be added to `packages/*/tests` directories using Vitest. Focus on essential functionality testing for permission flows.

**✅ Build Dependencies**: Changes to `agent-sdk` will require `pnpm build` before testing in `code` package. Standard workflow applies.

**✅ Documentation Minimalism**: No additional markdown documentation planned beyond this specification. Code will be self-documenting.

**✅ Quality Gates**: All changes will pass `pnpm run type-check` and `pnpm lint` before completion.

**✅ Source Code Structure**: Following established patterns - managers for permission logic, components for UI, types for interfaces.

**✅ Type System Evolution**: Will extend existing `AgentOptions` interface rather than creating new configuration types. Permission callbacks use composition pattern.

**✅ Data Model Minimalism**: Simple permission decision model with minimal attributes (behavior + optional message).

**✅ POST-DESIGN RE-EVALUATION**: All constitution principles remain satisfied after design phase and specification updates.

- **Package Architecture**: Design confirms modifications only to existing `agent-sdk` and `code` packages
- **TypeScript Excellence**: All contracts define strict types without `any` usage
- **Type Evolution**: Extended `AgentOptions` interface rather than creating parallel types
- **Data Minimalism**: Entity model focuses only on essential attributes for permission decisions
- **Quality Gates**: Implementation plan includes type-check and lint validation steps
- **Multiple Tool Call Support**: Sequential confirmation pattern maintains user control while batching results efficiently

**No violations detected. Implementation may proceed with enhanced multiple tool call specifications.**

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

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── agent.ts                    # Add permissionMode to AgentOptions
│   │   ├── types/
│   │   │   └── index.ts               # Add permission-related types
│   │   ├── managers/
│   │   │   ├── toolManager.ts         # Pass permission context to tools
│   │   │   └── permissionManager.ts   # New: Handle permission logic helpers
│   │   └── tools/                     # MODIFY: Add permission checks to restricted tools
│   │       ├── editTool.ts            # Insert permission check after validation/diff
│   │       ├── multiEditTool.ts       # Insert permission check after validation/diff  
│   │       ├── deleteFileTool.ts      # Insert permission check after validation/diff
│   │       ├── bashTool.ts            # Insert permission check after validation/diff
│   │       └── writeTool.ts           # Insert permission check after validation/diff
│   └── tests/
│       ├── managers/
│       │   └── permissionManager.test.ts
│       ├── tools/                     # Update existing tool tests for permission context
│       └── agent/
│           └── agent.permissions.test.ts
├── code/
│   ├── src/
│   │   ├── index.ts                   # Add --dangerously-skip-permissions CLI flag
│   │   ├── cli.tsx                    # Pass permission mode to Agent
│   │   ├── contexts/
│   │   │   └── useChat.tsx           # MODIFY: Add confirmation state management
│   │   └── components/
│   │       ├── ChatInterface.tsx     # MODIFY: Conditionally render InputBox vs ConfirmationComponent
│   │       ├── InputBox.tsx          # No changes (conditional rendering handled by parent)
│   │       └── ConfirmationComponent.tsx  # New: User permission prompts
│   └── tests/
│       └── components/
│           └── ConfirmationComponent.test.ts
```

**Structure Decision**: Extending existing monorepo structure with focused modifications to `agent-sdk` for core permission logic and `code` package for CLI integration. No new packages required - follows existing package-first architecture with clear separation between SDK capabilities and CLI interface.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

