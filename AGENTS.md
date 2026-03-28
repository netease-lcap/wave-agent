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
- **Important**: After modifying `agent-sdk`, you MUST rebuild it (`pnpm -F wave-agent-sdk build`) before the changes are available to `packages/code`.

## 🛠 Development Commands

Always use `pnpm` as the package manager.

### Build & Type-Check
- **Build all**: `pnpm build`
    - **Build specific package**: `pnpm -F <package-name> build` (e.g., `pnpm -F wave-agent-sdk build` or `pnpm -F wave-code build`)
- **Type-check all**: `pnpm run type-check`

### Testing
- **Run all tests**: `pnpm test`
    - **Run tests for a package**: `pnpm -F <package-name> test` (e.g., `pnpm -F wave-agent-sdk test`)
    - **Run a single test file**: `pnpm -F <package-name> test <path/to/test>` (e.g., `pnpm -F wave-agent-sdk test tests/tools/bashTool.test.ts`)
- **Testing Framework**: Vitest.

### Linting
- **Lint all**: `pnpm lint`
- **Format**: `pnpm exec prettier --write .`

## 🔍 Code Navigation & Exploration

- **Worktree Isolation**: If the current working directory is within a worktree (e.g., `.wave/worktrees/`), do NOT read or edit files in the base repository. Always stay within the current worktree.
- **Code Exploration**: This is a large codebase. NEVER read too many code files at once. You MUST ALWAYS use the `LSP` tool (goToDefinition, findReferences, etc.) as your primary method to understand code relationships and navigate the codebase. Only fallback to `Grep` or `Read` when `LSP` is insufficient.
- **Grep in node_modules**: When using the `Grep` tool to search within `node_modules`, you MUST explicitly set the `path` parameter to include `node_modules` (e.g., `path: "node_modules"` or `path: "packages/code/node_modules"`), as it may be excluded by default. Note that `path: "."` will NOT work because `node_modules` is typically ignored by `.gitignore`.

## 🤖 Subagent Usage

- **Subagent Usage**: You MUST delegate ALL implementation tasks to subagents to reduce the main context window. This is mandatory for implementing plans or performing focused tasks.
- **Delegation Guidelines**:
    - Explicitly instruct the subagent to ONLY perform the tasks delegated to them.
    - Instruct them to update their assigned tasks frequently using the task management tools.

