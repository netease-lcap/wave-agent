---
paths:
  - "packages/webview/**/*"
  - "packages/webview-fixtures/**/*"
  - "packages/vscode/src/**/*"
  - "packages/desktop/src/**/*"
  - "packages/jetbrains/src/**/*"
---

# Webview 内部与约定

- `src/index.tsx` 按注入的 `window.waveHostType === "desktop"` 分 `DesktopApp` / `ChatApp`；`DesktopApp` 管桌面 pane 列表与 workdir，渲染交给 `ChatApp`。
- `ChatApp.tsx` 是 reducer 宿主（`useReducer(chatReducer, ...)`，`src/reducers/chatReducer.ts`）—— 消息/任务/会话/确认/permissionMode 等状态与 `ChatAction` 都在这；host↔webview 是扁平的 `command` 判别 postMessage 协议。

加 UI 功能优先用下面这些共享机制（都是重复实现出过 bug 才抽出来的）：

- **host→webview 消息**：用 `useHostMessage` hook（`src/utils/useHostMessage.ts`），不要裸写 `window.addEventListener("message")`；pane 级消费传 `{ paneId }`，requestId/termId 相关的特殊过滤就留在 handler 里。
- **新增 webview→host 命令**：四处都要注册（`messageHandler.ts` 里 vscode chat + settings 两套 switch、桌面 `desktopHost.ts`、JB `MessageHandler.kt`）。`webview-command-audit` 会因漏注册失败，流程写在 `scripts/audit-webview-commands.mjs` 顶部；桌面专属但不带 `desktop*` 前缀的，还要加进该脚本的 `DESKTOP_GATED_NON_PREFIX`。
- **新增 host→webview 的 reply 消息**：在 `packages/webview-fixtures` 的 `ReplyAttribution` 注册归属字段（`satisfies` 编译期强制）；消费方要么丢弃过期回复，要么渲染期按归属过滤。快照/广播消息不需要归属（分类口径写在 webview-fixtures 类型的 JSDoc 里）。
- **跨会话 UI 状态**（切会话要保留的）：放 `SessionUiStore`（`src/utils/sessionUiStore.ts`，key = `sessionId` | `new:<paneId>`，会话关闭时清理），别自己搞模块级缓存。`projectSettings` 快照已迁入（PR #2131）；#2081 的 context-usage 缓存**故意留在桌面 host**（它是跨进程事件回放源，不是 webview UI 状态，见 `desktopHost.ts` 的 `onContextUsage`）。
- **pane 骨架**用 `PaneShell` / `PanePlaceholder`，别重写 aside/toolbar/空态；**设置类列表页**（mount→fetch→response→删除确认）用 `useSettingsList`。
- **测试断言**锚 testid/语义（如 `is-spinning`、svg 存在），不要锚图标字体类名 —— 口径在 `packages/webview/tests/test-utils.tsx` 顶部。

未去重的遗留热点（改的时候两份都要看）：`messageHandler.ts` 里 vscode chat / settings 两套命令 switch（settings 命令注册了两遍，只改一处会造成 #2086 那种漂移）。vscode/desktop 各自的 stdioAgent + NotificationRouter 副本已并入 SDK `src/stdio/`（经 `/host` 导出，宿主只保留自己的传输）。
