# Implementation Plan: CLI Worktree Support

**Branch**: `068-worktree` | **Date**: 2026-02-27 | **Spec**: [./spec.md]
**Input**: Feature specification from `./spec.md`

## Summary

The goal is to add support for git worktrees in the Wave CLI. This allows users to start a session in an isolated environment without affecting their main working directory. The implementation involves adding a `-w/--worktree` flag to the CLI, programmatically managing git worktrees, and providing an interactive exit prompt to prevent accidental data loss.

Additionally, Wave supports mid-session worktree management via `EnterWorktree` and `ExitWorktree` tools (mirroring Claude Code's behavior), allowing the AI to create and exit worktrees without restarting the session. The tools use the DI container (`"Workdir"` key) and `AIManager.setWorkdir()` to update the session's working directory dynamically.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: `yargs` (CLI parsing), `ink` (CLI UI), `git` (system dependency)
**Storage**: Filesystem (git worktrees at `.wave/worktrees/` relative to the main repository root)
**Testing**: Vitest
**Target Platform**: Linux/macOS
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Worktree creation should be fast (< 2s).
**Constraints**: Must be in a git repository to use worktrees.
**Scale/Scope**: CLI feature + SDK tools for mid-session worktree management.

## Implementation Notes

- **CWD Change Architecture**: Mid-session tools use `AIManager.setWorkdir()` which updates both the DI container's `"Workdir"` entry and calls `process.chdir()`. All downstream tool executions receive the updated workdir via `ToolContext.workdir`.
- **Session Scope**: `EnterWorktree`/`ExitWorktree` only operate on worktrees created by `EnterWorktree` in the current session (module-level state). They do not touch manually-created worktrees or worktrees from previous sessions.
- **Dirty Guard**: `ExitWorktree` with `action: "remove"` refuses without `discard_changes: true` when the worktree has uncommitted files or new commits (fail-closed on git errors).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Package-First Architecture**: Changes will be isolated to `packages/code` (CLI logic) and potentially `packages/agent-sdk` (if new git utilities are needed).
- [x] **TypeScript Excellence**: All new code will be strictly typed.
- [x] **Test Alignment**: Unit tests for worktree management logic and integration tests for the CLI flow.
- [x] **Build Dependencies**: `pnpm build` will be run after any changes to `agent-sdk`.
- [x] **Documentation Minimalism**: Only `quickstart.md` and `research.md` are created as requested by the planning process.
- [x] **Quality Gates**: `pnpm run type-check`, `pnpm run lint`, and `pnpm test:coverage` will be run.
- [x] **Source Code Structure**: Follows existing patterns in `packages/code`.
- [x] **Test-Driven Development**: Critical logic for worktree detection and removal will be tested.
- [x] **Type System Evolution**: Existing CLI state types will be extended.
- [x] **Data Model Minimalism**: `WorktreeSession` entity is focused on essential fields.
- [x] **Planning and Task Delegation**: Planning performed by general-purpose agent.
- [x] **User-Centric Quickstart**: `quickstart.md` is focused on end-user usage.

## Project Structure

### Documentation (this feature)

```
specs/068-worktree/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output - USER FACING
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       ├── tools/
│       │   ├── enterWorktreeTool.ts   # EnterWorktree tool (mid-session)
│       │   └── exitWorktreeTool.ts    # ExitWorktree tool (mid-session)
│       ├── utils/
│       │   ├── worktreeSession.ts     # Module-level session state
│       │   └── worktreeUtils.ts       # SDK-side git worktree utilities
│       └── managers/
│           └── aiManager.ts           # setWorkdir() for CWD changes
└── code/
    └── src/
        ├── index.ts                   # CLI argument parsing (-w/--worktree)
        ├── App.tsx                    # Main app component (exit logic)
        ├── components/
        │   └── WorktreeExitPrompt.tsx # CLI exit interactive prompt
        └── utils/
            └── worktree.ts            # CLI-level worktree management
```

**Structure Decision**: The feature is primarily a CLI enhancement, so most changes will be in `packages/code`. Git-related logic that could be reused might be placed in `packages/agent-sdk`.

## Complexity Tracking

*No violations detected.*
