---
paths:
  - "packages/desktop/**/*"
---

# 桌面端（`packages/desktop`）

架构：主进程包住共享 webview，用 JSON-RPC 跟 `wave --stdio` 子进程通信 —— `src/main/desktopHost.ts`（agent 池：每个会话一个 `StdioAgent` 以支持并行对话，见 FR-031）→ `stdio/stdioClient.ts` + `stdio/notificationRouter.ts`（按 sessionId 分流通知）。会话索引/worktree 元数据经 `configStore.ts` 存 `userData/wave-desktop.json`。CLI 解析：`WAVE_CLI_PATH` 指向工作区 `wave-code` 构建，否则用内置二进制。

- **跑 dev**：`cd packages/desktop && pnpm run run`（编译后启 Electron，用独立 `wave-desktop-dev` userData，可与已安装版共存）。
- **打包**：`pnpm run dist`（electron-builder → `release/`）。**别绕过 `scripts/afterPack.js`** —— 改 bundle 会破坏 ad-hoc 链接签名，不复签 LaunchServices 会静默拒绝启动。
- **装进已安装应用**：`pnpm run desktop:install`（根目录跑；全量 `pnpm build` → `electron-builder --dir` → rsync 覆盖 `/Applications/CodeWave IDE.app/`，必须全量因为 `wave-code` 走 npm link）。**不要退出/杀/重启用户正在跑的 CodeWave IDE.app** —— macOS 上 rsync 覆盖运行中的 `.app` 是安全的，重启手工来。
- **测试**：`pnpm -F wave-desktop test`；real-host 套件 `pnpm -F wave-desktop run test:realhost`（真 `DesktopHost` ↔ 真 `wave --stdio` 子进程）。
