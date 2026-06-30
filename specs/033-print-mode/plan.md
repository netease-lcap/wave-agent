# Implementation Plan: Print Mode

**Branch**: `033-print-mode` | **Status**: Implemented | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/033-print-mode/spec.md`

## Summary

Ensure `wave -p` (print mode) only outputs the main agent's response to stdout, suppressing all subagent output (user messages, reasoning, content). This matches Claude Code's print mode behavior where subagent output is internal and the main agent incorporates results in its own response.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: Ink (React for CLI — not used in print mode), agent-sdk callbacks
**State Management**: Callback-driven streaming via `AgentCallbacks`
**Testing**: Vitest
**Target Platform**: Linux/macOS/Windows (Terminal CLI)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: No additional latency; print mode should be as fast as interactive mode
**Constraints**: Print mode must not print any subagent internal output
**Scale/Scope**: Single file (`print-cli.ts`) plus existing callback infrastructure

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: Changes in `code` package only (callback consumer). Pass.
2. **TypeScript Excellence**: No new types needed — removing callback implementations. Pass.
3. **Test Alignment**: Existing print-cli tests updated. Pass.
4. **Build Dependencies**: No agent-sdk changes required. Pass.
5. **Documentation Minimalism**: No extra .md files beyond spec companion docs. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: Changes in `packages/code/src/print-cli.ts`. Pass.
8. **Data Model Minimalism**: No new data entities. Pass.

## Project Structure

### Documentation (this feature)

```
specs/033-print-mode/
├── plan.md              # This file
├── research.md          # Design decisions
├── data-model.md        # Callback entities
├── quickstart.md        # User guide
├── contracts/           # API contracts
├── checklists/          # Quality checks
└── tasks.md             # Implementation tasks
```

### Source Code (repository root)

```
packages/
└── code/
    └── src/
        └── print-cli.ts    # Print mode entry point — callback configuration
```

**Structure Decision**: Single-file change in `code` package. Agent-sdk's `AgentCallbacks` interface already supports optional subagent callbacks — simply omitting them achieves the desired behavior.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |
