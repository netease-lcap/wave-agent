# Research: Support Plan Mode

## Decision: System Prompt Modification
**Rationale**: The system prompt is constructed in `AIManager.ts` and passed to `callAgent`. By modifying `AIManager.sendAIMessage`, we can dynamically append the Plan Mode reminder when the current permission mode is `plan`.

## Decision: Permission Mode Enforcement
**Rationale**: `PermissionManager.ts` already handles `default` and `acceptEdits` modes. Adding a `plan` mode here allows us to centralize the authorization logic. In `plan` mode:
- `Read`, `LS`, `Glob`, `Grep` are allowed.
- `Edit`, `MultiEdit`, `Write` are allowed ONLY for the designated plan file.
- `Delete` is denied (even for the plan file, to ensure it's built incrementally).
- `Bash` and other restricted tools are denied.

## Decision: Plan File Management
**Rationale**: A new `PlanManager` in `agent-sdk` will handle the creation of the `~/.wave/plans` directory and the generation of plan files. This keeps the logic separate from the UI (`InputManager`). The plan file name is deterministic within a session chain, using the `rootSessionId` as a seed.

## Decision: Deterministic Name Generator
**Rationale**: A new utility `packages/agent-sdk/src/utils/nameGenerator.ts` will be implemented using a list of adjectives and nouns. It supports seeded generation to ensure the same name is returned for the same `rootSessionId`, providing stability across message compressions.

## Alternatives Considered
- **Enforcing read-only in each tool**: Too fragmented and error-prone. Centralizing in `PermissionManager` is cleaner.
- **Putting plan file in the project directory**: The requirement specifically asks for `~/.wave/plans`.
