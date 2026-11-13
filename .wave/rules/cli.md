---
paths:
  - "packages/code/**/*"
---

# CLI & Component Rules

- React Ink 终端应用，`src/index.ts` 是 yargs 入口，分发到几种运行模式：`src/cli.tsx`（交互 TUI，`render(<App/>)`，默认）、`src/print-cli.ts`（非交互 `-p/--print`）、`src/stdio-cli.ts` + `src/stdio/`（stdin/stdout 上的 JSON-RPC，桌面端 spawn 的 `wave --stdio`）、`src/daemon-cli.ts` + `src/daemon/`（后台 daemon，Unix socket `~/.wave/daemon.sock`）。
- `Agent` 在 `src/contexts/useChat.tsx` 构造（import `wave-agent-sdk`、接 `AgentCallbacks`、管 send/compact/queue 状态）；斜杠命令声明在 `src/constants/commands.ts`（`AVAILABLE_COMMANDS`），处理在 `useChat.tsx`；输入状态机是 `src/managers/inputReducer.ts` + `inputHandlers.ts`。
- `src/utils/logger.ts` 写日志文件而不是 stdout —— stdout 属于 Ink UI，CLI 代码里别 `console.log`。
- 本地跑：`pnpm run wave`（tsx 直跑源码，不用构建；`LOG_LEVEL=DEBUG` 看调试日志）；重启 daemon：`pnpm wave daemon stop|restart`。
- Use the `Grep` tool for searching. It supports the `.tsx` extension as part of the `ts` (TypeScript) file type.
- When searching for `.tsx` files, use the `type: "ts"` parameter.
- `packages/code/src/components` contains Ink components.
- Do not use side borders (left and right) in components. Use only top and bottom borders if borders are needed.
