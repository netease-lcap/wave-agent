# AGENTS.md

This file provides guidance to Agent when working with code in this repository.

## 🏗 Architecture & Structure

This is a pnpm monorepo focused on AI-powered development tools.

- **`packages/agent-sdk`**: Core Node.js SDK. Handles AI model integration, tool systems, and memory management.
- **`packages/code`**: CLI frontend built with React Ink. Provides the interactive terminal interface.
- **`packages/webview`**: React 18 chat UI shared by the VS Code extension, JetBrains plugin, and desktop app.
- **`packages/vscode`**: VS Code extension. Uses esbuild for bundling (not tsc). Its `webview/` directory is a build artifact synced from `packages/webview` — always edit the source in `packages/webview/src/`.
- **`packages/jetbrains`**: JetBrains plugin (Gradle/Kotlin), reuses the `packages/webview` UI.
- **`packages/desktop`**: Electron desktop app, reuses the `packages/webview` UI and drives the CLI via stdio.
- **`packages/webview-fixtures`**: Shared host→webview message contract fixtures consumed by the webview, VS Code, JetBrains, and desktop test suites. Rebuild after edits: `pnpm -F wave-webview-fixtures build`.
- **`packages/vsce`**: Not a real package — contains only a synced `webview/` build artifact; the VS Code extension source lives in `packages/vscode`.
- **`docs/`**: VitePress documentation site.
- **`docs/specs/`**: Contains feature specifications grouped by topic (e.g., `docs/specs/ui/slash-commands.md`). These are the source of truth for feature design and implementation tasks, and are rendered into the docs site.
- **`.wave/rules/`**: Modular memory rules scoped to specific paths or tasks.

### Key Dependencies

- **Node >= 22 required** (`engines` in package.json, pnpm 11 via `packageManager`).
- `packages/code` depends on `packages/agent-sdk`.
- `packages/vscode` depends on `packages/agent-sdk` and `packages/webview`.
- `packages/jetbrains` consumes the `packages/webview` build output.
- `packages/desktop` consumes the `packages/webview` build output and spawns the `wave --stdio` CLI (from `packages/code`).
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
  - **Caution**: for `agent-sdk` and `code`, `pnpm test` includes `tests/integration/` + `*.integration.test.ts` files that hit real external dependencies (git/spawn/hook/filesystem — no real LLM calls; AI paths are mocked). Use `test:unit` to skip them.
- **Testing Framework**: Vitest.

### Linting

- **Lint all**: `pnpm lint`
- **Format**: `pnpm exec prettier --write .`

### CI Parity & Release

- **Verify before pushing**: `pnpm run ci` (parallel type-check + lint + unit tests with coverage across packages — matches the CI PR gate).
- **Release**: `pnpm run release:patch` / `release:minor` / `release:major` (runs `scripts/release.js`, then the `publish.yml` GitHub workflow publishes to npm).

### JetBrains Plugin

- **Run IDE with plugin**: `pnpm run jb:run`
- **Build**: `pnpm run jb:build` (builds webview first, then the Gradle plugin)
- **Test**: `pnpm run jb:test`

### Desktop App (`packages/desktop`)

- **Run dev**: `cd packages/desktop && pnpm run dev` (compiles, then launches Electron; dev uses a separate `wave-desktop-dev` userData so it coexists with the installed app)
- **Build installer**: `pnpm run dist` (electron-builder → `release/`). **Do not bypass `scripts/afterPack.js`**: electron-builder's bundle mutation breaks the ad-hoc linker seal, and without the re-sign step LaunchServices silently refuses to launch the app.
- **Install/update installed app**: `pnpm run desktop:install` (run from repo root). Does a full `pnpm build` → `electron-builder --dir` → `rsync -a --delete` over `/Applications/Wave.app/`. Full build (not selective) is required because the user consumes `wave-code` via npm link. **Do not quit/kill/relaunch the user's running Wave.app** — rsync over a running `.app` is safe on macOS; restart is manual.
- **Test**: `pnpm -F wave-desktop test`
- **Architecture**: the main process wraps the shared webview and talks JSON-RPC to a `wave --stdio` child process — `src/main/desktopHost.ts` (agent pool: one `StdioAgent` per session for parallel conversations, see FR-031) → `stdio/stdioClient.ts` + `stdio/notificationRouter.ts` (routes notifications by sessionId). Session index/worktree metadata persists in `userData/wave-desktop.json` via `configStore.ts`.
- **CLI resolution**: `WAVE_CLI_PATH` env var points at a workspace `wave-code` build; otherwise the bundled binary is used.

### Docs Site

- **Preview**: `pnpm run docs:dev`
- **Build**: `pnpm run docs:build` — this first runs Playwright demo tests to regenerate screenshots into `docs/public/screenshots/` (gitignored). A bare `vitepress build docs` fails on missing screenshot imports.

## 🐛 Debugging

- **Prefer temporary console.log/console.trace**: When diagnosing bugs, especially race conditions or complex flows, add temporary `console.log` or `console.trace` statements to trace execution rather than overthinking through static analysis. Run the code/tests, observe the actual output, then remove the logs once the issue is identified.
- **Kill stray daemons**: `pnpm run daemon:kill` (pkill on `wave.*--daemon` processes).

## 🧩 VS Code Extension (`packages/vscode`)

### Build

- **Compile**: `pnpm -F wave-vscode run compile` (esbuild: backend CJS + frontend IIFE)
- **Watch**: `pnpm -F wave-vscode run watch`
- **Package .vsix**: `pnpm -F wave-vscode run package`

### Architecture

- **Backend** (Extension Host): `src/extension.ts` → `ChatProvider` → `ChatSession` (wraps `wave-agent-sdk` Agent) → `MessageHandler` → services
- **Frontend** (Webview): React 18 app whose source lives in `packages/webview/src/` (NOT `packages/vscode/webview/`, which is synced build output), uses `useReducer` for state, communicates via `vscode.postMessage`
- **Key constraint**: `acquireVsCodeApi()` can only be called once per webview lifecycle — call in root component and pass as prop

### Testing

- **Unit tests**: Vitest in `tests/` — `pnpm -F wave-vscode test`
- **E2E tests**: Playwright in `e2e/` (requires Chromium)
- **Demo/screenshot tests**: `pnpm -F wave-webview run test:demo` (regenerates the gitignored screenshots under `docs/public/screenshots/`)
