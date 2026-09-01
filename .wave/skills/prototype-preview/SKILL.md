---
name: prototype-preview
description: webview 原型预览服务（设计师验收/视觉还原用）。当需要启动本地原型预览、切换 mock 用例、新增 mock 场景（工具状态/会话恢复/账户卡片/未登录等）、或对比 wave 实现与设计师原型差异时使用。
user-invocable: false
---

# Webview 原型预览（prototype preview）

Wave webview 的原型预览服务：以真实 `src/` 组件为入口的 Vite dev server，
用来在浏览器里人工验收 UI 与设计师原型的视觉一致性、给设计师演示新功能。

## 启动

```bash
pnpm -F wave-webview preview
# → http://localhost:8899（默认）
# 指定端口：PORT=8900 pnpm -F wave-webview preview → http://localhost:8900
```

日常开发常用 8900（设计师也已记住这个地址）。

页面右上角固定工具条（可拖拽移开）：

- **用例下拉**：切换 mock 用例（state 驱动 + key 重挂载，**无整页 reload**；dev 下记住上次选择，沙箱无存储则回默认 desktop-full）
- **深色/浅色按钮**：切 `<html data-theme>`，与真机 desktop 主题机制一致
- **拖拽手柄**：拖动工具条位置，避免遮挡 header（位置存 `sessionStorage["wave-preview-bar-pos"]`，沙箱无存储时静默降级）

## 构建与发布 artifacts

把原型打包成单个自包含 HTML，发布 artifact 分享给设计师/评审：

```bash
pnpm -F wave-webview build:prototype
# → packages/webview/prototype/dist/index.html（单文件，JS/CSS/字体全内联）
```

产物特性：

- **含全部 mock 用例与工具条**（用例下拉/主题/拖拽在产物里都能用）
- **mermaid 已裁掉**：产物约 1.1MB（gzip ~341KB）。图表块在构建产物里会显示「暂不支持」错误提示；需要看图表用 dev 预览
- **沙箱可用**：artifact 是 srcdoc `sandbox="allow-scripts"` iframe（origin null），存储不可用但已全部降级——切换/主题/拖拽均正常、默认深色主题
- 终端面板的 xterm chunk（terminal.js）不在产物里，打开终端会失败并报错，属预期（终端非原型场景）

发布：

1. 用 **Artifact 工具**发布本地 HTML：`file_path = packages/webview/prototype/dist/index.html`（可带 label），返回 `https://codechat.codewave.163.com/code/artifact/<slug>` 私密链接（需登录态才能打开，发链接时提醒设计师登录）
2. 重新发布：传 `url` 覆盖；若该 artifact 被他人更新过，加 `force: true`
3. 验证：发布后浏览器打开 URL，走一遍工具条（切用例/切主题/拖拽）

## Mock 用例：添加 / 更新

Mock 文件在 `packages/webview/prototype/mock/*.ts`（**整个 mock/ 目录被 gitignore，
只本地用，不提交仓库**）。每个文件 default export 一个 `MockCase`（结构见
`prototype/types.d.ts`）：

```ts
export default {
  name: "用例显示名",
  description: "一句话说明场景",
  host: "desktop",      // "desktop" 渲染桌面端外壳（侧边栏/账户卡片）；缺省=IDE 聊天
  messages: [
    { message: { command: "desktopWorkdirState", workdir: "", ... } },
    { delay: 100, message: { command: "setInitialState", ... } },
  ],
  responders: {
    getConfiguration: (_p, helpers) => helpers.send({ command: "configurationResponse", ... }),
  },
} satisfies MockCase;
```

要点：

- **添加**：新建 `mock/<name>.ts`，无需注册——`import.meta.glob("./mock/*.ts")` 自动扫描。
  保存后页面自动整页重载并重放新用例。
- **更新**：改 `mock/*.ts` → 自动热更新重载。改 `src/` 组件 → Fast Refresh（保留状态）；
  改 `src/` CSS → 即时生效。所以「改了没生效」先分清是哪种改动。
- `messages`：按序发送 host → webview 消息，`delay` 为毫秒。适合静态场景。
- `responders`：webview 向宿主发请求时按 command 命中回发（命令名必须与真实宿主一致，
  参考 `packages/desktop/src/main/desktopHost.ts` 与 `packages/webview-fixtures/src/types.ts`）。
- 字段（`paneId` 等）与真实协议一致，payload 即真实宿主 postMessage 的对象。
