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
- **Build specific package**: `pnpm -F <package-name> build`
- **Type-check all**: `pnpm run type-check`

### Testing
- **Run all tests**: `pnpm test`
- **Run tests for a package**: `pnpm -F <package-name> test`
- **Run a single test file**: `pnpm -F <package-name> test <path/to/test>`
- **Testing Framework**: Vitest.
- **UI Testing**: Use `HookTester` for hooks and `vi.waitFor` for Ink components.

### Linting
- **Lint all**: `pnpm lint`
- **Format**: `pnpm exec prettier --write .`

## 📝 Development Guidelines

- **Memory & Rules**:
  - Use `AGENTS.md` for general project context.
  - Check `.wave/rules/` for path-specific instructions.
- **Feature Implementation**:
  - Before starting a task, research the codebase and relevant `specs/`.
  - When implementing tasks from `specs/*/tasks.md`, mark them as completed `[X]` in the file.
- **Code Style**:
  - Do not prefix unused variables with underscores; remove them.
  - Do not modify `tsconfig.json` unless explicitly requested.
  - Avoid unnecessary `setTimeout` or `sleep` in tests; prefer `vi.waitFor` or awaiting promises.
- **Git**: Do not perform git commits unless explicitly requested.
- **External Plugins**: `../wave-plugins-official` is the path for official wave plugins.

## 🧪 Testing Patterns
- **Agent Creation**: Always use `await Agent.create(...)` instead of `new Agent(...)`.
- **Mocking**:
  - Use `vi.mocked(...)` with `as unknown as Awaited<ReturnType<typeof ...>>` for type-safe mocks.
  - Mock `stdout` and `stderr` to suppress output during tests.
  - Do not use `mkdtemp` in tests; use mocking instead.
- **Examples**: `packages/*/examples` contain real integration tests. Run them using:
  `pnpm -F <package-name> exec tsx examples/<file>.ts`
