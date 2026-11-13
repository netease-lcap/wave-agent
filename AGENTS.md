# AGENTS.md

This file provides guidance to Agent when working with code in this repository.

**修改约定**：不要自行修改，需要先询问用户；如果用户同意了修改，也必须要简约，优先考虑用 rules 或者子目录的 agents.md。

## 🏗 Architecture & Structure

pnpm monorepo（Node >= 22，pnpm 12），做 AI 编码工具：

- **`packages/agent-sdk`** 核心 SDK：模型接入、工具系统、记忆管理。
- **`packages/code`** React Ink CLI 终端界面。
- **`packages/webview`** React 18 聊天 UI，VS Code / JetBrains / 桌面端共用。
- **`packages/vscode`** VS Code 扩展（esbuild 打包）。`webview/` 是同步产物 —— 永远改 `packages/webview/src/`。
- **`packages/jetbrains`** JetBrains 插件（Gradle/Kotlin），复用 webview 产物。
- **`packages/desktop`** Electron 桌面端，复用 webview 产物，通过 stdio 驱动 CLI。
- **`packages/webview-fixtures`** host→webview 消息契约 fixtures（四端测试共用）；改后 `pnpm -F wave-webview-fixtures build`。
- **`docs/`** VitePress 站点；**`docs/specs/`** 功能规格（见文末）。
- **`.wave/rules/`** 按路径生效的模块化规则（带 `paths:` 的只在相关文件进上下文时才注入）。桌面端 / VS Code / Webview / CLI 的内部细节与约定都放在这里，按目录自动生效，本文件不再重复。

依赖方向：`code` → `agent-sdk`；`vscode` → `agent-sdk` + `webview`；`jetbrains` / `desktop` 吃 webview 产物；`desktop` 另外 spawn `wave --stdio`（来自 `code`）。**改完 `agent-sdk` 或 `webview` 必须重建**（`pnpm -F wave-agent-sdk build` / `-F wave-webview build`）—— 依赖方读的是产物。

工具链版本统一写在 `pnpm-workspace.yaml` 的 `catalog:`（vitest / @vitest/coverage-v8 / tsx / tsrs），各包只写 `"catalog:"`，别在单个 package.json 写死；`catalogMode: prefer` 会让 `pnpm add` 自动沿用 catalog 版本。`@types/node` 分 `catalog:node22`（根，对齐 `engines.node`）与 `catalog:node25`（desktop / vscode / webview，跟随各自运行时），合并会丢端侧新 API 类型。

## 🔧 Agent SDK Internals (`packages/agent-sdk`)

SDK 就是产品：CLI、VS Code、JetBrains、桌面端驱动同一个 `Agent`。"模型为什么看到/做了 X" 基本都在这几处：

- **`Agent`**（`src/agent.ts`）：只能 `Agent.create(options)`（构造函数私有）。自建轻量 DI `Container`（`utils/container.ts` + `containerSetup.ts`）取 manager/service；`sendMessage()` 忙时入队，否则交给 `InteractionService`。
- **回合循环**（`managers/aiManager.ts` 的 `sendAIMessage()`）：pin 本轮配置快照 → 调模型（`services/aiService.ts`）→ 有 `tool_calls` 就 PreToolUse hook → `toolManager.execute()` → PostToolUse hook → 再循环，直到模型不再调工具。
- **工具**（`managers/toolManager.ts`、`src/tools/`）：内置工具都是 `ToolPlugin`（`src/tools/types.ts`），经 `toolManager.register()` 注册；名称/上限在 `src/constants/`。
- **权限**（`managers/permissionManager.ts`）：`PermissionMode = default | acceptEdits | plan | dontAsk | bypassPermissions`（`src/types/permissions.ts`）；`checkPermission()` 是唯一闸门，模式解析顺序 CLI 覆盖 > 配置 > `default`。
- **记忆**（`services/memory.ts`）：三档 —— 项目 `<workdir>/AGENTS.md`（回退 `CLAUDE.md`）、用户 `~/.wave/AGENTS.md`、自动记忆 `~/.wave/projects/<git-common-dir>/memory/MEMORY.md`（只加载前 200 行，按 git common dir 归档所以 worktree 共享）。写入走 `utils/atomicWrite.ts`。根 AGENTS.md 常驻；**子目录 AGENTS.md 不常驻，但要等 agent `Read` 到该子树里的文件后才注入**（`utils/nestedMemory.ts` 沿祖先链由远到近注入、同目录 `AGENTS.md` 优先于 `CLAUDE.md`、到项目根为止、会话级去重，与 CC 的 `nested_memory` 一致；只读触发，Write/Edit 不算）。
- **配置链**（`services/configurationService.ts` + `utils/configPaths.ts`）：override > `AgentOptions` > Remote > `<workdir>/.wave/settings.local.json` > `<workdir>/.wave/settings.json` > `~/.wave/settings.json`。会话级 env 快照（不污染 `process.env`）；热更新是 `LiveConfigManager` + `services/fileWatcher.ts`，每轮 pin 快照。
- **改 settings 必须同步内置技能**：`settings.json` 的键、`env`、hook 事件/字段或默认值有变动，就同步 `src/builtin/skills/settings.ts` —— 模型回答"怎么配 X"只读它，过期等于教错用法。
- **host 传输**（`src/stdio/`）：`StdioAgent` 用 JSON-RPC 镜像 `Agent` API，每次调用带 `sessionId`；`NotificationRouter` 按会话分流。经 `wave-agent-sdk/host` 再导出（自己不设子路径），VS Code 扩展与桌面端使用。
- **构建**：`pnpm -F wave-agent-sdk build` = `tsrs` → `dist/`（逐文件 ESM + `.d.ts`，不打包）。`tsrs` 是 TypeScript 的 Rust 移植，type-check 与两处 `tsc` 构建都由它跑；npm `typescript` **不是**依赖（无人 import 其 API，且 7.x 只发 `tsc` CLI，没有 tsserver/lib 可给编辑器用）。两条硬规则：`pnpm run type-check` / `pnpm run build` 必须**串行**（`--workspace-concurrency=1`）—— 并发编译器会在模块解析阶段随机丢包（幻影 TS2307），上游 `microsoft/typescript-go#4262` `#4834` 记录了这个缺陷，也是当初弃用 `tsc` 的原因。
- **公共面**：三个受众三个入口。`wave-agent-sdk`（barrel）给 CLI（进程内嵌 agent）；host（桌面主进程、VS Code 扩展宿主）只准 import `wave-agent-sdk/host`，缺什么加到这里；webview 只用 `/types` 与 `/constants`（浏览器 bundle 需要这对 node-free 入口）。RPC 层不单独开子路径，只能经 `/host` 到达。host 引 barrel 会把整个 agent 运行时拖进宿主 bundle：`be05c42be` 为共享一个字符串加了两行 import，桌面主包涨 2.2 MB，图里 `@vscode/ripgrep` 包装器在模块体求值时抛错，把 1.2.5 的桌面端与 VS Code 崩在 `whenReady` 之前。两条不变式压住成本：`sideEffects: false`（误引约 10 KB 而非 2.2 MB）与 **SDK 模块零 import 副作用**（不写 `import "./x.js"`、不做模块级 IO/注册；`@vscode/ripgrep` 这类可选/平台依赖必须在 `createRequire` + `try/catch` 里懒加载）。由 `scripts/check-sdk-surface.mjs`（PR 级 `sdk-surface` job）把守。只有仓库外出现消费者时，才把 RPC 层拆成独立包。

## 🛠 Development Commands

包管理器只用 `pnpm`。

- **构建 / 类型检查**：`pnpm build`（全量，串行）、`pnpm -F <pkg> build`、`pnpm run type-check`。
- **本地跑 CLI**：`pnpm run wave`（tsx 直跑 `packages/code` 源码，不用构建；`LOG_LEVEL=DEBUG` 看调试日志）。
- **测试**：`pnpm -F <pkg> test <path/to/test>` 跑单文件。**默认只跑改动相关的文件**；包级 `test:unit` 只用于横切改动（共享 helper/config/多文件）并说明理由，全仓跑要用户点名。`agent-sdk` / `code` 的 `pnpm test` 含 `tests/integration/` + `*.integration.test.ts`（真 git/spawn/hook/文件系统，无真 LLM，AI 路径 mock），要跳过用 `test:unit`。
- **测试分层**（PR 门禁只跑 unit）：unit `*.test.ts(x)` → `test:unit`；integration `tests/integration/**` → `pnpm run test:integration`；webview e2e `packages/webview/e2e/*.e2e.ts`（真 Chromium）→ `-F wave-webview run test:e2e`；real-host `packages/desktop/tests/integration/**` → `-F wave-desktop run test:realhost`；real-IDE `packages/vscode/tests-e2e/`、`packages/jetbrains/src/integrationTest/` → `test:e2e:completion` / `pnpm jb:test:ui`（真 IDE + 真模型，跑不起来先读 `.wave/skills/real-machine-testing`）。
- **`packages/webview/demo/*.demo.ts` 不是测试**：它把 UI 摆到位截 docs 截图（`test:demo`），行为断言一律写进 `e2e`。CI 只在文档部署（`pages.yml`）里跑 demo，PR 不跑。
- **单测绿只是"仓库内"绿**：`app.asar` 只带桌面端自己的生产依赖，其余必须已内联进 bundle，所以全绿也可能发出一个启动即死的宿主（1.2.5 就是这样）；打包产物目前没有断言，只靠 `check:sdk-surface` 的源码级检查兜底。
- **Lint 是 oxlint**（仓库没有 eslint，`pnpm exec eslint` → `Command not found`）：`pnpm lint` / `pnpm -F <pkg> lint`；格式化 `pnpm exec prettier --write .`。pre-commit（`.husky/pre-commit`）：`pnpm run type-check` → lint-staged（staged 的 code/json/md 走 prettier）→ staged 含 `docs/` 时再跑 `scripts/check-docs-links.mjs` + `check-sidebar-anchors.mjs`。hook 由 `pnpm install`（`prepare` → husky）安装。
- **契约 / 公共面检查**：`pnpm run audit:commands` 静态校验每个 webview→host `command` 字面量是否在四个宿主路由都注册；`pnpm run check:sdk-surface`（先建 SDK）钉公共面形状 —— host 只准 import 允许的 SDK 子路径、`/host` 闭包零第三方依赖且在体积预算内、去掉 `@vscode/*` 后各入口仍能加载、`sideEffects: false` 必须留着。都秒级、不构建宿主，属 PR 门禁。
- **发版**：`pnpm run release:patch|minor|major`（`scripts/release.js`，随后 `publish.yml` 发 npm 并建 GitHub Release）。
- **JetBrains**：`pnpm jb:run` / `jb:build`（先建 webview 再跑 Gradle）/ `jb:test`。
- **文档站**：`pnpm run docs:dev`；`pnpm run docs:build` 会先跑 demo 重新生成截图到 `docs/public/screenshots/`（gitignored），裸 `vitepress build docs` 会因缺图导入失败；`pnpm run docs:pack` 出 `docs-<version>.tar.gz`（`--base /docs/`），交给 `.wave/skills/ops-upload` 的 `--type docs` 上传。发版**不**建文档站（`publish.yml` 只发 npm + Release），Pages 由 `pages.yml` 单独构建，它也监听 `packages/webview/src/**` —— UI 改动合并就重部署，demo 坏了在那里暴露。

## 🐛 Debugging

- **优先用临时 `console.log` / `console.trace`**：尤其竞态和复杂流程，跑起来看真实输出，定位后删掉，别纯靠静态推演。
- **重启 daemon**：`pnpm wave daemon stop`（优雅停 `~/.wave/daemon.sock`，没在跑也安全）/ `pnpm wave daemon restart`。

## 📐 Specs & Spec-First Workflow

`docs/specs/` 是功能设计的**权威来源**（会渲染进文档站）。需求变更先改 spec 并确认，再动实现；spec 是设计，不是 changelog。

- 按主题分在 `core/` `ui/` `desktop/` `multi-agent/` `ecosystem/` `automation/` `enterprise/`；frontmatter 带 `name` / `description` / `order`，H1 是 `# 功能规格说明：<name>`。
- 必须有 `## 用户场景与测试`，内含用户故事（`### 用户故事：…`）与验收场景（编号 `N. **假设** … **当** … **则** …`）。
- 统计与模板告警来自 `docs/.vitepress/spec-stats.mjs`（经 `docs/specs/specs.data.js` → `docs/specs/index.md`）；优先定点编辑已有 spec 而不是整篇重写，改完重跑统计。
