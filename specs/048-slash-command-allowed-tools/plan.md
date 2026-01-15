# Implementation Plan: Slash Command Allowed Tools

**Feature Branch**: `048-slash-command-allowed-tools`  
**Created**: 2026-01-15  
**Status**: Draft  
**Feature Spec**: [spec.md](spec.md)

## Technical Context

### Architecture Overview
The feature integrates with the existing `PermissionManager` in `agent-sdk`. When a slash command is triggered, its `allowed-tools` metadata will be parsed and temporarily added to the `PermissionManager`'s allowed rules. These rules will be active only for the duration of the `sendAIMessage` recursion cycle.

### Key Components
- **`AIManager` (`packages/agent-sdk/src/managers/aiManager.ts`)**: Responsible for managing the AI response cycle and recursion. It will handle the temporary addition and removal of allowed rules.
- **`PermissionManager` (`packages/agent-sdk/src/managers/permissionManager.ts`)**: Needs to be updated to support temporary rules that are not persisted to `settings.json`.
- **`SlashCommand` parsing**: The logic that triggers slash commands needs to extract `allowed-tools` and pass them to `AIManager.sendAIMessage`.

### Dependencies & Integrations
- **`agent-sdk`**: Core logic for AI and permissions.
- **`code`**: CLI interface where slash commands are defined and triggered.

### Unknowns & Risks
- **[NEEDS CLARIFICATION: PermissionManager API]**: Does `PermissionManager` currently support adding rules in-memory without saving to disk? (Research Phase 0)
- **[NEEDS CLARIFICATION: Slash Command Metadata]**: How are slash command headers currently parsed and where is the best place to extract `allowed-tools`? (Research Phase 0)
- **[NEEDS CLARIFICATION: Recursion Lifecycle]**: How to reliably ensure temporary rules are removed even if an error occurs during recursion? (Research Phase 0)

## Constitution Check

### Principles
- **I. Package-First Architecture**: Changes will be primarily in `agent-sdk`.
- **II. TypeScript Excellence**: Strict typing for new permission methods.
- **IX. Type System Evolution**: Evolve `PermissionManager` and `AIManager` options.
- **X. Data Model Minimalism**: Keep the temporary rules structure simple.

### Quality Standards
- **Type Check**: `pnpm run type-check` must pass.
- **Linting**: `pnpm lint` must pass.
- **Testing**: Vitest tests for `PermissionManager` and `AIManager` integration.

## Evaluation Gates

| Gate | Requirement | Status | Justification |
|------|-------------|--------|---------------|
| 1 | No circular dependencies | PASS | Changes are within existing package boundaries. |
| 2 | Type safety | PASS | Will use strict TS. |
| 3 | Test coverage | PASS | Tests will be added in Phase 3. |

## Phase 0: Outline & Research

### Research Tasks
1. **Research PermissionManager API**: Check if `PermissionManager` has methods for temporary rules.
2. **Research Slash Command Parsing**: Identify where slash command metadata is parsed in the `code` package.
3. **Research Recursion Lifecycle**: Determine the best way to wrap `sendAIMessage` with temporary permissions.

## Phase 1: Design & Contracts

### Data Model (`data-model.md`)
- **TemporaryPermissionRule**: A simple string array in `PermissionManager`.

### API Contracts
- **`PermissionManager.addTemporaryRules(rules: string[])`**
- **`PermissionManager.removeTemporaryRules(rules: string[])`**
- **`AIManager.sendAIMessage(options: { allowedTools?: string[], ... })`**

### Agent Context Update
- Run `update-agent-context.sh` after design.

## Phase 2: Implementation Plan

### Step 1: Update PermissionManager
- Add `temporaryRules` property.
- Update `checkPermission` to include `temporaryRules`.
- Add methods to add/remove temporary rules.

### Step 2: Update AIManager
- Modify `sendAIMessage` to accept `allowedTools`.
- Implement the logic to add rules before recursion and remove them after.

### Step 3: Update Slash Command Trigger
- Ensure `allowed-tools` are extracted and passed to `AIManager`.

## Phase 3: Testing & Validation

### Unit Tests
- `PermissionManager` tests for temporary rules.
- `AIManager` tests for rule lifecycle.

### Integration Tests
- End-to-end test with a mock slash command.
