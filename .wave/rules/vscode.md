---
paths:
  - "packages/vscode/**/*"
---

# VS Code 扩展（`packages/vscode`）

- **构建**：`pnpm -F wave-vscode run compile`（esbuild：后端 CJS + 前端 IIFE）/ `watch` / `package`（.vsix）。
- **后端**（扩展宿主）：`src/extension.ts` → `ChatProvider` → `ChatSession`（经 `StdioAgent` 用 JSON-RPC 驱动 `wave --stdio` 子进程，**不**内嵌 SDK 的 `Agent`）→ `MessageHandler` → services。
- **前端**（webview）：源码在 `packages/webview/src/`（**不是** `packages/vscode/webview/`，那是同步产物），`useReducer` 管状态，走 `vscode.postMessage`。**硬约束**：`acquireVsCodeApi()` 每个 webview 生命周期只能调一次 —— 在根组件取，当 prop 往下传。
- **测试**：单测 `pnpm -F wave-vscode test`；e2e 用 `packages/webview/e2e/` 的真浏览器 Playwright 套件。
