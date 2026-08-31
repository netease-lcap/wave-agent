# 原型预览 mock 用例

`prototype/mock/` 目录整体被 gitignore（**仅本地使用，不提交仓库**）。目录下的每个 `.ts` 文件是一个用例，默认导出 `MockCase`：

```ts
import type { MockCase } from "../types";

export default {
  name: "长对话滚动",
  description: "220 条消息，验证虚拟化滚动到底",
  // 用例激活时按序发送的 host → webview 消息
  messages: [
    { message: { command: "init", payload: { sessionId: "s1" } } },
    { delay: 300, message: { command: "updateMessages", messages: [...] } },
  ],
  // 收到 webview → host 消息时的响应（命令名与真实宿主一致）
  responders: {
    getConfiguration: (_payload, helpers) => {
      helpers.send({ command: "configurationResponse", data: { language: "zh-CN" } });
    },
    setAgentsContent: (payload, helpers) => {
      helpers.send({ command: "agentsContentSaved", scope: payload.scope, ok: true });
    },
  },
} satisfies MockCase;
```

要点：

- **`messages`**：启动用例时按数组顺序发送，每条可带 `delay`（毫秒）。适合静态场景（如注入一批历史消息）。
- **`responders`**：webview 向宿主发请求（`vscode.postMessage`）时按 `command` 命中并回发响应。命令名必须与真实宿主一致（参考 `packages/desktop/src/main/desktopHost.ts` 中 postMessage 的 command，以及 `packages/webview-fixtures/src/types.ts`）。
- 消息 payload 即真实宿主 postMessage 的对象，字段名与真实协议一致（分屏相关消息带 `paneId` 等）。
- 支持 `import type` 与任意 TS 语法（Vite dev server 原生编译）。

## 启动

```bash
pnpm -F wave-webview preview
# → http://localhost:8899 （PORT 环境变量可覆盖）
```

浏览器打开后：右上角工具条选择用例 → 页面按用例脚本注入消息（state 驱动重挂载，**无整页 reload**）。**热更新由 Vite 提供**：

- 修改 `src/` 下组件 → React Fast Refresh（保留页面状态）
- 修改 `src/` 下 CSS → 即时生效
- 修改 `mock/` 下用例 → 自动整页重载并重放当前用例（无需手动刷新）

工具条可切换深色/浅色主题（与 desktop 真机一致，通过 `<html data-theme>` 切换）。
如需构建单文件产物发 artifact（含全部用例与工具条），运行 `pnpm -F wave-webview build:prototype` → `prototype/dist/index.html`，详见项目 skill「prototype-preview」的「构建与发布 artifacts」。
