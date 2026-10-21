# webview 与远控页：Playwright + 真 Chromium

```sh
pnpm -F wave-webview build                              # e2e 加载的是 dist 产物，不 build 会测到旧逻辑
pnpm -F wave-webview exec playwright install --with-deps chromium   # 首次或换机器
pnpm -F wave-webview run test:e2e                       # Playwright + 真 Chromium，不是 jsdom
```

- **桌面 UI**：`e2e/utils/desktopTestHarness.ts` 在 bundle 执行前塞 `window.waveHostType="desktop"`，让 `src/index.tsx` 走 `DesktopApp` 分支，并 mock 掉窗口级命令（`desktopPanes` / `desktopWorkdirState` / `configurationResponse` …）。宿主消息一律经 mock 注入，**不连真 CLI** —— 要验「真宿主 ↔ 真 CLI」请用 `desktop.md` 的 realhost 套件。
- **手机档**：`test.use({ viewport, isMobile, hasTouch, deviceScaleFactor, userAgent })` 切档（`remote-page-controls.e2e.ts`）；远控页身份靠 `data-remote-page` 属性（真页面上由 `remote/shim.js` 打）；安全区用 `addStyleTag` 注入 `padding-top` 模拟（`remote-page-viewport.e2e.ts`）；需要更细的设备模拟时用 CDP `Emulation.setDeviceMetricsOverride` + `setTouchEmulationEnabled`（`demo/web-end.demo.ts`，注意 `mobile: true` 不会让 `pointer` 变 coarse，触控要单独开）。
- **e2e 抓不到、仍得上真机**：iOS 聚焦自动放大、主屏安装（standalone）的存储隔离与 push、真机触控手势与滚动惯性、`env(safe-area-inset-*)` 与收起工具栏下的 `dvh`（无头浏览器里 `dvh == vh`、`env()` 走 fallback）。这几条的结论只能写「未验」，不许拿 e2e 冒充。
- **demo ≠ 测试**：`demo/*.demo.ts`（`pnpm -F wave-webview run test:demo`）只把 UI 推到要拍照的状态并截图，绿了只证明「截图产出了」。**行为断言一律写进 `e2e/*.e2e.ts`**，改行为去改 e2e，别用 demo 兜。
