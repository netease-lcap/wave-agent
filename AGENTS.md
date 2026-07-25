# AGENTS.md

This file provides guidance to Agent when working with code in this repository.

## 🏗 Architecture & Structure

This is a pnpm monorepo focused on AI-powered development tools.

- **`packages/agent-sdk`**: Core Node.js SDK. Handles AI model integration, tool systems, and memory management.
- **`packages/code`**: CLI frontend built with React Ink. Provides the interactive terminal interface.
- **`packages/webview`**: React 18 chat UI shared by the VS Code extension and JetBrains plugin.
- **`packages/vsce`**: VS Code extension. Uses esbuild for bundling (not tsc). Its `webview/` directory is a build artifact synced from `packages/webview` — always edit the source in `packages/webview/src/`.
- **`packages/jetbrains`**: JetBrains plugin (Gradle/Kotlin), reuses the `packages/webview` UI.
- **`docs/`**: VitePress documentation site.
- **`docs/specs/`**: Contains feature specifications grouped by topic (e.g., `docs/specs/ui/slash-commands.md`). These are the source of truth for feature design and implementation tasks, and are rendered into the docs site.
- **`.wave/rules/`**: Modular memory rules scoped to specific paths or tasks.

### Key Dependencies
- `packages/code` depends on `packages/agent-sdk`.
- `packages/vsce` depends on `packages/agent-sdk` and `packages/webview`.
- `packages/jetbrains` consumes the `packages/webview` build output.
- **Important**: After modifying `agent-sdk` or `webview`, you MUST rebuild them (`pnpm -F wave-agent-sdk build` / `pnpm -F wave-webview build`) before the changes are available to dependent packages.

## 🛠 Development Commands

Always use `pnpm` as the package manager.

### Build & Type-Check
- **Build all**: `pnpm build`
    - **Build specific package**: `pnpm -F <package-name> build` (e.g., `pnpm -F wave-agent-sdk build` or `pnpm -F wave-code build`)
- **Type-check all**: `pnpm run type-check`
- **Run the CLI locally**: `pnpm run wave` (runs `packages/code` source directly via tsx, no build needed; `pnpm run wave:debug` for DEBUG logs)

### Testing
- **Run all tests**: `pnpm test`
    - **Run tests for a package**: `pnpm -F <package-name> test` (e.g., `pnpm -F wave-agent-sdk test`)
    - **Run a single test file**: `pnpm -F <package-name> test <path/to/test>` (e.g., `pnpm -F wave-agent-sdk test tests/tools/bashTool.test.ts`)
- **Testing Framework**: Vitest.

### Linting
- **Lint all**: `pnpm lint`
- **Format**: `pnpm exec prettier --write .`

### JetBrains Plugin
- **Run IDE with plugin**: `pnpm run jb:run`
- **Build**: `pnpm run jb:build` (builds webview first, then the Gradle plugin)
- **Test**: `pnpm run jb:test`

### Docs Site
- **Preview**: `pnpm run docs:dev`
- **Build**: `pnpm run docs:build` — this first runs Playwright demo tests to regenerate screenshots into `docs/public/screenshots/` (gitignored). A bare `vitepress build docs` fails on missing screenshot imports.

## 📋 Spec-First Workflow

- **需求增加或变更时，优先更新 spec**：任何功能需求的新增或变更，必须先更新对应的 `docs/specs/` 下的规格说明（新增用户故事、验收场景、功能需求 FR 等），**待用户确认 spec 后再进行代码实现**。spec 是功能设计的权威来源，不是实现的 changelog。
- **不确定是否算需求变更时也先动 spec**：边界模糊时宁可先写 spec 草稿请用户确认，不要直接改代码。
- **新增或修改 spec 后**：运行 `node scripts/spec-count.js` 更新 `docs/specs/README.md` 中的统计表。

## 🐛 Debugging

- **Prefer temporary console.log/console.trace**: When diagnosing bugs, especially race conditions or complex flows, add temporary `console.log` or `console.trace` statements to trace execution rather than overthinking through static analysis. Run the code/tests, observe the actual output, then remove the logs once the issue is identified.

## 🧩 VS Code Extension (`packages/vsce`)

### Build
- **Compile**: `pnpm -F wave-vsce run compile` (esbuild: backend CJS + frontend IIFE)
- **Watch**: `pnpm -F wave-vsce run watch`
- **Package .vsix**: `pnpm -F wave-vsce run package`

### Architecture
- **Backend** (Extension Host): `src/extension.ts` → `ChatProvider` → `ChatSession` (wraps `wave-agent-sdk` Agent) → `MessageHandler` → services
- **Frontend** (Webview): React 18 app whose source lives in `packages/webview/src/` (NOT `packages/vsce/webview/`, which is synced build output), uses `useReducer` for state, communicates via `vscode.postMessage`
- **Key constraint**: `acquireVsCodeApi()` can only be called once per webview lifecycle — call in root component and pass as prop

### Testing
- **Unit tests**: Vitest in `tests/` — `pnpm -F wave-vsce test`
- **E2E tests**: Playwright in `e2e/` (requires Chromium)
- **Demo/screenshot tests**: `pnpm -F wave-webview run test:demo` (regenerates the gitignored screenshots under `docs/public/screenshots/`)

