# AGENTS.md

This file provides guidance to Agent when working with code in this repository.

## 🏗 Architecture & Structure

This is a pnpm monorepo focused on AI-powered development tools.

- **`packages/agent-sdk`**: Core Node.js SDK. Handles AI model integration, tool systems, and memory management.
- **`packages/code`**: CLI frontend built with React Ink. Provides the interactive terminal interface.
- **`specs/`**: Contains numbered feature specifications (e.g., `specs/053-modular-rules/`). These are the source of truth for feature design and implementation tasks.
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
    - **Run a single test file**: `pnpm -F <package-name> test <path/to/test>` (e.g., `pnpm -F wave-agent-sdk test tests/agent.test.ts`)
- **Testing Framework**: Vitest.
- **Important**: ALWAYS use the **Bash subagent** to run `pnpm test`. This reduces context usage for the main agent and keeps the conversation focused.

### Linting
- **Lint all**: `pnpm lint`
- **Format**: `pnpm exec prettier --write .`

## 🔍 Code Navigation & Exploration

- **Code Exploration**: This is a large codebase. NEVER read too many code files at once. ALWAYS prefer using the `LSP` tool (goToDefinition, findReferences, etc.) to understand code relationships and navigate the codebase efficiently.

## 🤖 Subagent Usage

- **Subagent Usage**: Use specialized agents (typescript-expert, vitest-expert, Explore) for focused tasks (exploration, development, or testing) to reduce context usage.

