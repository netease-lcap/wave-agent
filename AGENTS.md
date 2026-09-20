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
- **`docs/`**: VitePress documentation site.
- **`docs/specs/`**: Feature specifications grouped by topic (e.g., `docs/specs/ui/slash-commands.md`). See "Specs & Spec-First Workflow" below.
- **`.wave/rules/`**: Modular memory rules scoped to specific paths or tasks.

### Key Dependencies

- **Node >= 22 required** (`engines` in package.json, pnpm 11 via `packageManager`).
- `packages/code` depends on `packages/agent-sdk`.
- `packages/vscode` depends on `packages/agent-sdk` and `packages/webview`.
- `packages/jetbrains` consumes the `packages/webview` build output.
- `packages/desktop` consumes the `packages/webview` build output and spawns the `wave --stdio` CLI (from `packages/code`).
- **Important**: After modifying `agent-sdk` or `webview`, you MUST rebuild them (`pnpm -F wave-agent-sdk build` / `pnpm -F wave-webview build`) before the changes are available to dependent packages.

### Agent SDK Internals (`packages/agent-sdk`)

The SDK _is_ the product — every host (CLI, VS Code, JetBrains, desktop) drives the same `Agent`. When the question is "why did the model see / do X", the answer is usually in one of these:

- **`Agent` (`src/agent.ts`)**: constructed only via `Agent.create(options)` (the constructor is private). It stands up a lightweight DI `Container` (`utils/container.ts` + `utils/containerSetup.ts`) and pulls the managers/services out of it. `sendMessage()` queues when busy, else delegates to `InteractionService`.
- **Turn loop (`managers/aiManager.ts`)**: `sendAIMessage()` runs a `while (true)` loop — pin the per-turn config snapshot → call the model (`services/aiService.ts`) → if `tool_calls` came back: PreToolUse hook → `toolManager.execute()` → PostToolUse hook → loop again until the model stops calling tools.
- **Tools (`managers/toolManager.ts`, `src/tools/`)**: each built-in tool is a `ToolPlugin` (`src/tools/types.ts`) registered via `toolManager.register()`; names/limits live in `src/constants/`.
- **Permissions (`managers/permissionManager.ts`)**: `PermissionMode = default | acceptEdits | plan | dontAsk | bypassPermissions` (`src/types/permissions.ts`). `checkPermission()` is the single gate; the mode resolves CLI override > configured > `default`.
- **Memory (`services/memory.ts`)**: three scopes — project `<workdir>/AGENTS.md` (falls back to `CLAUDE.md`), user `~/.wave/AGENTS.md`, and auto-memory `~/.wave/projects/<git-common-dir>/memory/MEMORY.md` (only the first 200 lines load; keyed by git common dir so worktrees share it). Writes go through `utils/atomicWrite.ts`.
- **Config chain**: `services/configurationService.ts` + `utils/configPaths.ts`. Effective order: override > `AgentOptions` > Remote > `<workdir>/.wave/settings.local.json` > `<workdir>/.wave/settings.json` > `~/.wave/settings.json`. Per-session env vars are snapshotted (no `process.env` pollution). Hot reload is `LiveConfigManager` + `services/fileWatcher.ts`; each turn pins a snapshot.
- **Host transport (`src/stdio/`)**: `StdioAgent` mirrors the `Agent` API over JSON-RPC with a `sessionId` on every call; `NotificationRouter` demuxes notifications by session. Re-exported by the `wave-agent-sdk/host` entry (it has no subpath of its own) and used by the VS Code extension and desktop app.
- **Build**: `pnpm -F wave-agent-sdk build` = `tsc` → `dist/` (per-file ESM + `.d.ts`, no bundling). Dependents import `dist/`, so rebuild after any SDK edit.
- **Public surface**: three audiences, three entries. `wave-agent-sdk` (the barrel) is for the CLI, which embeds the agent in-process. The hosts (desktop main process, VS Code extension host) drive the agent over JSON-RPC and import **only `wave-agent-sdk/host`** — one positive entry re-exporting the RPC layer + shared literals + protocol types; need something new, add it there. The webview (pure UI) imports only `wave-agent-sdk/types` and `/constants`. The RPC layer deliberately has no subpath of its own — it is reachable only through `/host`, so a host cannot pick it up accidentally while reaching for a shared literal. `/types` and `/constants` stay public because the webview (a browser bundle) needs the node-free pair: `/constants` for values, `/types` for erased type-only imports. A barrel import from a host drags the whole agent runtime (tools, providers, transitive deps) into that host's bundle and can kill it at launch: `be05c42be` added two import lines for a shared string, grew the desktop main bundle by 2.2 MB, and the `@vscode/ripgrep` wrapper inside that graph threw while its module body evaluated — that is what made desktop + VS Code 1.2.5 crash before `whenReady`. Two invariants keep it cheap: `sideEffects: false` (so a stray barrel import costs ~10 KB instead of 2.2 MB) and **no import-time side effects in SDK modules** (no `import "./x.js"`, no module-scope IO/registration; optional/platform deps such as `@vscode/ripgrep` must be resolved lazily in a `createRequire` + `try/catch` wrapper). Enforced by `scripts/check-sdk-surface.mjs` (`pnpm run check:sdk-surface`, the PR-tier `sdk-surface` CI job). Split the host-side RPC layer into its own package only when an out-of-repo consumer appears — the barrier today is a script, and a package would make a wrong import _unresolvable_ rather than merely red.

### Webview Internals (`packages/webview`)

- `src/index.tsx` branches on the injected `window.waveHostType === "desktop"` → `DesktopApp`, else `ChatApp`. `DesktopApp` owns the desktop pane list / workdir and delegates rendering to `ChatApp`.
- `ChatApp.tsx` is the reducer host (`useReducer(chatReducer, ...)`, `src/reducers/chatReducer.ts`) — the single `ChatState`/`ChatAction` for messages, tasks, sessions, confirmations, permissionMode, etc. Host↔webview traffic is a flat `command`-discriminated `postMessage` protocol.

## 🛠 Development Commands

Always use `pnpm` as the package manager.

### Build & Type-Check

- **Build all**: `pnpm build`
  - **Build specific package**: `pnpm -F <package-name> build` (e.g., `pnpm -F wave-agent-sdk build` or `pnpm -F wave-code build`)
- **Type-check all**: `pnpm run type-check`
- **Run the CLI locally**: `pnpm run wave` (runs `packages/code` source directly via tsx, no build needed; set `LOG_LEVEL=DEBUG` for DEBUG logs)

### Testing

- **Run all tests**: `pnpm test`
  - **Run tests for a package**: `pnpm -F <package-name> test` (e.g., `pnpm -F wave-agent-sdk test`)
  - **Run a single test file**: `pnpm -F <package-name> test <path/to/test>` (e.g., `pnpm -F wave-agent-sdk test tests/tools/bashTool.test.ts`)
  - **Caution**: for `agent-sdk` and `code`, `pnpm test` includes `tests/integration/` + `*.integration.test.ts` files that hit real external dependencies (git/spawn/hook/filesystem — no real LLM calls; AI paths are mocked). Use `test:unit` to skip them.
- **Testing Framework**: Vitest.

Test layers, ordered fast→slow (the PR gate only runs unit + demo; the rest are post-merge):

| Layer            | Where                                                      | Command                                                                                                  |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Unit             | `*.test.ts` / `*.test.tsx`                                 | `pnpm -F <pkg> test:unit` — what PR CI gates                                                             |
| Integration      | `tests/integration/**`, `*.integration.test.ts`            | `pnpm run test:integration` (real git/spawn/fs, no LLM)                                                  |
| Webview e2e      | `packages/webview/e2e/*.e2e.ts` (real Chromium)            | `pnpm -F wave-webview run test:e2e`                                                                      |
| Demo/screenshots | `packages/webview/demo/*.demo.ts`                          | `pnpm -F wave-webview run test:demo` (also regenerates docs screenshots)                                 |
| Real-host        | `packages/desktop/tests/integration/*.integration.test.ts` | `pnpm -F wave-desktop run test:realhost` (real `DesktopHost` ↔ real `wave --stdio` child)               |
| Host artifact    | `scripts/check-host-bundles.mjs`                           | `pnpm run check:host-bundles` after building the host bundles (the post-merge `host-bundle-load` CI job) |
| SDK surface      | `scripts/check-sdk-surface.mjs`                            | `pnpm run check:sdk-surface` after `pnpm -F wave-agent-sdk build` (the PR-tier `sdk-surface` CI job)     |

Everything above runs **inside the repo**, where `node_modules` is complete and
`@vscode/ripgrep-<platform>` resolves. The host apps are what actually gets
**packaged and shipped** (an `app.asar` carries only the desktop app's own
production deps; everything else must already be inlined in the bundle), so a
green suite can still ship a host that dies on launch — v1.2.5 did exactly that.
The `host-bundle-load` job is the only layer that looks at the artifact: it fails
if a host bundle requires a package the packaged app will not have, or if that
bundle cannot be loaded from a directory with no `node_modules`. Like
`integration`/`webview-e2e`/`real-host-e2e` it is **not** a PR gate (it needs a
host build and is not on the ruleset's required list) — it reports on main, so the
stop line is "after merge, before release".

### Linting

- **Lint all**: `pnpm lint`
- **Format**: `pnpm exec prettier --write .`
- **Pre-commit** (`.husky/pre-commit`): runs `pnpm run type-check`, then `lint-staged` (prettier `--write` on staged code/json/md), then — only if a staged path is under `docs/` — `scripts/check-docs-links.mjs` + `scripts/check-sidebar-anchors.mjs`. Hooks install via `pnpm install` (`prepare` → husky).
- **Webview command contract**: `pnpm run audit:commands` statically verifies every webview→host `command` literal is registered in all four host routers (this is the `webview-command-audit` CI job).
- **Host artifact loadability**: `pnpm run check:host-bundles` (build the host bundles first) requires each host bundle to load from a directory with no `node_modules`, and rejects any `require()` of a package the packaged app does not ship — the `host-bundle-load` CI job. See the test-layer table above.
- **SDK surface / host import boundary**: `pnpm run check:sdk-surface` (build the SDK first) pins the _shape_ of the public surface rather than the artifacts: each host package may only import its allowed SDK subpath, the `/host` entry's closure must have zero third-party deps and stay under a size budget, every SDK entry must still load with `@vscode/*` removed from the resolution environment, and `sideEffects: false` must stay in place. Seconds long, no host build, so it is a PR gate (`sdk-surface` job).

### CI Parity & Release

- **Verify before pushing**: `pnpm run ci` (parallel type-check + lint + unit tests across packages). It matches the CI PR gate's `check`/`check-extras` jobs, but not the gate's webview command audit, its sharded demo suites, or its `sdk-surface` job — see `.github/workflows/ci.yml`.
- **Release**: `pnpm run release:patch` / `release:minor` / `release:major` (runs `scripts/release.js`, then the `publish.yml` GitHub workflow publishes to npm).

### JetBrains Plugin

- **Run IDE with plugin**: `pnpm run jb:run`
- **Build**: `pnpm run jb:build` (builds webview first, then the Gradle plugin)
- **Test**: `pnpm run jb:test`

### Desktop App (`packages/desktop`)

- **Run dev**: `cd packages/desktop && pnpm run run` (compiles, then launches Electron; dev uses a separate `wave-desktop-dev` userData so it coexists with the installed app)
- **Build installer**: `pnpm run dist` (electron-builder → `release/`). **Do not bypass `scripts/afterPack.js`**: electron-builder's bundle mutation breaks the ad-hoc linker seal, and without the re-sign step LaunchServices silently refuses to launch the app.
- **Install/update installed app**: `pnpm run desktop:install` (run from repo root). Does a full `pnpm build` → `electron-builder --dir` → `rsync -a --delete` over `/Applications/CodeWave IDE.app/`. Full build (not selective) is required because the user consumes `wave-code` via npm link. **Do not quit/kill/relaunch the user's running CodeWave IDE.app** — rsync over a running `.app` is safe on macOS; restart is manual.
- **Test**: `pnpm -F wave-desktop test`
- **Architecture**: the main process wraps the shared webview and talks JSON-RPC to a `wave --stdio` child process — `src/main/desktopHost.ts` (agent pool: one `StdioAgent` per session for parallel conversations, see FR-031) → `stdio/stdioClient.ts` + `stdio/notificationRouter.ts` (routes notifications by sessionId). Session index/worktree metadata persists in `userData/wave-desktop.json` via `configStore.ts`.
- **CLI resolution**: `WAVE_CLI_PATH` env var points at a workspace `wave-code` build; otherwise the bundled binary is used.

### Docs Site

- **Preview**: `pnpm run docs:dev`
- **Build**: `pnpm run docs:build` — this first runs Playwright demo tests to regenerate screenshots into `docs/public/screenshots/` (gitignored). A bare `vitepress build docs` fails on missing screenshot imports.

## 🧭 Webview Extension Conventions (`packages/webview`)

When adding UI features, use the shared mechanisms below instead of hand-rolling — each was extracted after the duplicated version caused recurring bugs:

- **Host→webview messages**: consume via the `useHostMessage` hook (`src/utils/useHostMessage.ts`), never a raw `window.addEventListener("message")`. Pane-scoped consumers pass `{ paneId }`; special filters (requestId/termId correlation) stay inline in the handler.
- **New webview→host commands**: register in **all four** route instances (vscode chat + settings switches in `messageHandler.ts`, desktop `desktopHost.ts`, JB `MessageHandler.kt`). The `webview-command-audit` CI job fails on missing registration — follow the workflow documented at the top of `scripts/audit-webview-commands.mjs`. A desktop-only command **without** the `desktop*` prefix must also be added to `DESKTOP_GATED_NON_PREFIX` in that script.
- **New host→webview response (reply-to) messages**: declare the attribution field in the `ReplyAttribution` registry (webview-fixtures) — compile-time enforced via `satisfies`. Consumers must either discard stale replies or filter by attribution at render time. Snapshot/broadcast messages need no attribution (classification JSDoc lives in the webview-fixtures types).
- **Cross-session UI state** (state that must survive conversation switches): store it in `SessionUiStore` (`src/utils/sessionUiStore.ts`; key = `sessionId` | `new:<paneId>`, prune on session close), not in ad-hoc module caches. Known legacy paths pending migration: none — the projectSettings snapshot moved here (PR #2131); the #2081 context-usage cache deliberately stays in the desktop host (it is a cross-process event-replay source — cache-before-pane-check + replay on pane bind — not webview UI state; see `desktopHost.ts` `onContextUsage`).
- **Pane skeletons**: compose `PaneShell`/`PanePlaceholder` instead of re-writing the aside/toolbar/empty-state markup.
- **Settings list views** (mount→fetch→response→delete-confirm state machine): use `useSettingsList`.
- **Test assertions**: anchor on testids/semantics (e.g. `is-spinning`, svg presence), never on icon font class names — standard documented at the top of `packages/webview/tests/test-utils.tsx`.

Known legacy hotspots (duplication not yet deduplicated — check **both** copies when editing): the vscode chat/settings dual command switches in `messageHandler.ts` (settings commands are registered twice; fixing only one causes #2086-style drift). The vscode/desktop stdioAgent + NotificationRouter copies are now merged into the SDK's `src/stdio/` (exported via `wave-agent-sdk/host`; hosts keep their transports).

## 🐛 Debugging

- **Prefer temporary console.log/console.trace**: When diagnosing bugs, especially race conditions or complex flows, add temporary `console.log` or `console.trace` statements to trace execution rather than overthinking through static analysis. Run the code/tests, observe the actual output, then remove the logs once the issue is identified.
- **Stop/restart the daemon**: `pnpm wave daemon stop` (graceful shutdown of `~/.wave/daemon.sock`, idempotent when not running) / `pnpm wave daemon restart` (stop + relaunch from the current CLI).

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
- **E2E tests**: real-browser Playwright tests in `packages/webview/e2e/` (`.e2e.ts`, requires Chromium) — `pnpm -F wave-webview run test:e2e`
- **Demo/screenshot tests**: screenshot-only Playwright tests in `packages/webview/demo/` (`.demo.ts`); `pnpm -F wave-webview run test:demo` runs the `demo` project and regenerates the gitignored screenshots under `docs/public/screenshots/` (the `e2e` project has its own `test:e2e`)

## 🖥 CLI (`packages/code`)

React Ink terminal app. `src/index.ts` is the yargs entry; it dispatches to one of several run modes:

- `src/cli.tsx` — interactive TUI (`render(<App/>)`), the default.
- `src/print-cli.ts` — non-interactive `-p/--print`.
- `src/stdio-cli.ts` + `src/stdio/` — JSON-RPC server over stdin/stdout (what the desktop app spawns as `wave --stdio`).
- `src/daemon-cli.ts` + `src/daemon/` — background daemon on a Unix socket (`~/.wave/daemon.sock`).

The `Agent` is constructed in `src/contexts/useChat.tsx` (it imports `wave-agent-sdk`, wires `AgentCallbacks`, and owns send/compact/queue state) — unlike the desktop app, which spawns the CLI and talks JSON-RPC. Slash commands are declared in `src/constants/commands.ts` (`AVAILABLE_COMMANDS`) with handling in `useChat.tsx`; the input state machine is `src/managers/inputReducer.ts` + `inputHandlers.ts`. Note `src/utils/logger.ts` writes to a log file, not stdout — stdout belongs to the Ink UI (don't `console.log` in CLI code).

## 📐 Specs & Spec-First Workflow

`docs/specs/` is the **source of truth for feature design** (and is rendered into the docs site). Update the spec — and get it confirmed — _before_ implementing a requirement change; the spec is design, not a changelog.

- Grouped by topic under `core/`, `ui/`, `desktop/`, `multi-agent/`, `ecosystem/`, `automation/`, `enterprise/`. Frontmatter carries `name` / `description` / `order`; the H1 is `# 功能规格说明：<name>`.
- A spec needs a `## 用户场景与测试` section with user stories (`### 用户故事：…`) and acceptance scenarios (numbered `N. **假设** … **当** … **则** …`).
- Counts + template warnings come from `docs/.vitepress/spec-stats.mjs` (consumed by `docs/specs/specs.data.js` → `docs/specs/index.md`). Prefer targeted edits to an existing spec over whole-file rewrites, and re-run the stats after editing.
