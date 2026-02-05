# Implementation Plan: Glob Pattern Match for Trusted Bash Commands

**Branch**: `037-bash-glob-match` | **Date**: 2025-12-27 | **Spec**: [/specs/037-bash-glob-match/spec.md](/home/liuyiqi/personal-projects/wave-agent/specs/037-bash-glob-match/spec.md)

**Input**: Feature specification from `/specs/037-bash-glob-match/spec.md`

## Summary

The goal is to improve the "Yes, and don't ask again" functionality for bash commands by implementing a "smart glob pattern match" instead of exact string matching or simple prefix matching. This allows users to trust a command once (e.g., `npm install lodash`) and have subsequent similar commands (e.g., `npm install express`) execute without further prompts by using wildcards. The system will use a heuristic to identify static parts of a command (executable + subcommands) and store them as trusted glob patterns, while maintaining a blacklist for dangerous commands.

## Technical Context

**Language/Version**: TypeScript (Strict mode)
**Primary Dependencies**: `agent-sdk`, `code`, `vitest`
**Storage**: `settings.local.json`
**Testing**: Vitest
**Target Platform**: Linux/macOS (CLI environment)
**Project Type**: CLI / Monorepo
**Performance Goals**: Glob pattern matching should be near-instant (<10ms) to avoid delaying command execution.
**Constraints**: Must not compromise security; dangerous commands must be blacklisted from pattern matching.
**Scale/Scope**: Affects all bash command executions initiated by the agent.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Package-First Architecture**: Will modify `agent-sdk` for core logic and `code` for CLI/UI interaction.
2. **TypeScript Excellence**: Strict typing will be used for all new logic.
3. **Test Alignment**: Tests will be added to `packages/*/tests`.
4. **Build Dependencies**: `pnpm build` will be run after `agent-sdk` changes.
5. **Documentation Minimalism**: No extra markdown docs beyond what's required by the plan.
6. **Quality Gates**: `pnpm run type-check` and `pnpm lint` will be run.
7. **Source Code Structure**: Logic will be placed in appropriate managers/services.
8. **Data Model Minimalism**: `TrustedCommand` entity will be kept simple.

## Project Structure

### Documentation (this feature)

```
specs/037-bash-glob-match/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   └── src/
│       ├── managers/    # Trust management logic
│       └── types.ts     # TrustedCommand definitions
└── code/
    └── src/
        ├── components/  # UI for confirming patterns
        └── contexts/    # Integration with agent execution flow
```

**Structure Decision**: Following the established monorepo pattern, core logic goes into `agent-sdk` and UI/CLI integration goes into `code`.

## Complexity Tracking

*No violations identified.*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
