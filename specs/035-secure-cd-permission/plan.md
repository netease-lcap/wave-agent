# Implementation Plan - Secure Pipeline Command Permission Matching

This plan outlines the implementation of secure pipeline command decomposition and validation for the bash tool.

## Technical Context

### Relevant Packages
- `agent-sdk`: Core logic for permission management and bash tool execution.

### Key Files
- `packages/agent-sdk/src/managers/permissionManager.ts`: Handles permission checks and rule matching.
- `packages/agent-sdk/src/tools/bashTool.ts`: Executes bash commands and triggers permission checks.
- `packages/agent-sdk/src/utils/bashParser.ts`: (New) Utility for decomposing complex bash commands.

### Unknowns & Research Needs
- [NEEDS CLARIFICATION] Best approach for parsing bash commands in TypeScript to identify shell operators and simple commands while respecting quotes and escapes.
- [NEEDS CLARIFICATION] How to accurately determine if a `cd` target is within the current working directory, especially with relative paths and symlinks.

## Constitution Check

- **Package-First Architecture**: Changes are confined to `agent-sdk`.
- **TypeScript Excellence**: Strict typing will be used for the new parser and updated manager.
- **Test Alignment**: New tests will be added to `packages/agent-sdk/tests/utils/bashParser.test.ts` and `packages/agent-sdk/tests/managers/permissionManager.test.ts`.
- **Data Model Minimalism**: No new complex data models; using simple strings and arrays for command parts.

## Gates

- [ ] `pnpm run type-check` passes in `agent-sdk`.
- [ ] `pnpm test` passes in `agent-sdk`.
- [ ] Complex commands like `cd /tmp && ls` are correctly decomposed and validated.
- [ ] `cd ..` is denied by default even if `cd` is in the safe list.

## Phase 0: Outline & Research

### Research Tasks
- Research bash command parsing libraries or patterns for TypeScript.
- Research path normalization and containment checks in Node.js.

## Phase 1: Design & Contracts

### Data Model
- `SimpleCommand`: `{ command: string, args: string[], env: Record<string, string> }`
- `ComplexCommand`: Array of `SimpleCommand` or a tree structure if nested.

### API Contracts
- `PermissionManager.checkPermission` will be updated to handle complex bash commands.
- `bashParser.splitCommand(cmd: string): SimpleCommand[]`

## Phase 2: Implementation

### Step 1: Bash Parser Utility
- Implement `packages/agent-sdk/src/utils/bashParser.ts`.
- Function `splitBashCommand(command: string): string[]` to split by `&&`, `||`, `;`, `|`.
- Function `stripEnvVars(command: string): string` to remove `VAR=val` prefixes.
- Function `stripRedirections(command: string): string` to remove `> file`, `2>&1`, etc.

### Step 2: Path Safety Utility
- Implement `packages/agent-sdk/src/utils/pathSafety.ts`.
- Function `isPathInside(target: string, parent: string): boolean`.
- Use `fs.realpathSync` to handle symlinks.

### Step 3: Update PermissionManager
- Integrate `bashParser` into `checkPermission`.
- Implement built-in safe list (`cd`, `ls`, `pwd`).
- Implement path restrictions for safe commands.
- Update `isAllowedByRule` to work with decomposed commands.

### Step 4: Update Bash Tool
- Ensure `bashTool.ts` passes the necessary context (like `workdir`) to `PermissionManager`.

### Step 5: Testing
- Add unit tests for `bashParser`.
- Add unit tests for `PermissionManager` with complex commands and safe list.
- Add integration tests for `bashTool`.
