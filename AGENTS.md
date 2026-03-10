# AGENTS.md

This file provides guidance to Agent when working with code in this repository.

## 🏗 Architecture & Structure

This is a pnpm monorepo focused on AI-powered development tools.

- **`packages/agent-sdk`**: Core Node.js SDK. Handles AI model integration, tool systems, and memory management.
- **`packages/code`**: CLI frontend built with React Ink. Provides the interactive terminal interface.
- **`specs/`**: Contains numbered feature specifications (e.g., `specs/008-slash-commands/`). These are the source of truth for feature design and implementation tasks.
- **`.wave/rules/`**: Modular memory rules scoped to specific paths or tasks.

### Key Dependencies
- `packages/code` depends on `packages/agent-sdk`.
- **Important**: After modifying `agent-sdk`, you MUST rebuild it (`cd packages/agent-sdk && pnpm build`) before the changes are available to `packages/code`.

## 🛠 Development Commands

Always use `pnpm` as the package manager.

### Build & Type-Check
- **Build all**: `pnpm build`
    - **Build specific package**: `cd packages/<package-name> && pnpm build` (e.g., `cd packages/agent-sdk && pnpm build` or `cd packages/code && pnpm build`)
- **Type-check all**: `pnpm run type-check`

### Testing
- **Run all tests**: `pnpm test`
    - **Run tests for a package**: `cd packages/<package-name> && pnpm test` (e.g., `cd packages/agent-sdk && pnpm test`)
    - **Run a single test file**: `cd packages/<package-name> && pnpm test <path/to/test>` (e.g., `cd packages/agent-sdk && pnpm test tests/agent.test.ts`)
- **Testing Framework**: Vitest.

### Linting
- **Lint all**: `pnpm lint`
- **Format**: `pnpm exec prettier --write .`

## 🔍 Code Navigation & Exploration

- **Worktree Isolation**: If the current working directory is within a worktree (e.g., `.wave/worktrees/`), do NOT read or edit files in the base repository. Always stay within the current worktree.
- **Code Exploration**: This is a large codebase. NEVER read too many code files at once. ALWAYS prefer using the `LSP` tool (goToDefinition, findReferences, etc.) to understand code relationships and navigate the codebase efficiently.

## 🤖 Subagent Usage

- **Subagent Usage**: When implementing a plan, you MUST use specialized subagents for focused tasks to reduce context usage. Use the `Agent` tool to delegate tasks defined in the task list.
- **Delegation Guidelines**:
    - Explicitly instruct the subagent to ONLY perform the tasks delegated to them.
    - Instruct them to update their assigned tasks frequently using the task management tools.
- **Note**: Subagents typically do not have access to the `Agent` tool.

