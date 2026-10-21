# SDK：在 `examples/` 下写一个真跑的探针

SDK 层没有现成测试服：单测把模型 mock 掉了，CLI 又隔着一层 Ink 和 dist。要验「SDK 自己」——工具真执行、权限门控真生效、hook / 子代理 / 记忆 / workflow 真跑、某个回归是否只在真模型下复现——载体是 `packages/agent-sdk/examples/` 下的一个 `.ts`：`Agent.create()` 在进程内嵌 SDK，`sendMessage` 直接打真服务端。

```sh
cd packages/agent-sdk && pnpm exec tsx examples/features/rewind-demo.ts
```

纯手工跑：没有 package.json 脚本、也不进 CI。`tsx` 来自仓库根的 devDependency，`pnpm exec` 会向上找到它。

**验的是源码，不用先 build**（与 CLI 层相反）：示例写 `import { Agent } from "../../src/agent.js"`，tsx 把 `.js` 解析到 `src/*.ts`，所以改完 SDK 立刻能验。`cli.md` 里那条「先 build 否则验的是旧 dist」只属于 CLI 那条链，别套过来。实测过：给 `src/constants/` 新加一个导出，示例能直接 import 到，而旧 `dist/` 里没有。

**写之前先 type-check**：`cd packages/agent-sdk && pnpm run type-check`。`tsconfig.json` 的 `include` 带 `examples/**/*`，示例里的类型错会红（`tsconfig.build.json` 只编 `src`，示例不进 dist）。

## 骨架（照 `examples/getting-started/hi.ts` 抄）

写示例的编码规约（临时目录、`finally` 里 destroy、不碰私有成员）以仓库根 `.wave/rules/examples.md` 为准；下面只补验证视角要看的东西。

- `Agent.create({ workdir, permissionMode, serverUrl, callbacks })`。`workdir` 不传就是 `process.cwd()`（= `packages/agent-sdk`）；**要验文件读写就 `mkdtemp` 一个临时目录当 workdir**，否则 agent 会直接往包里写。要它安静跑完传 `permissionMode: "acceptEdits"` / `"bypassPermissions"`。
- 流式输出走 `callbacks.onAssistantContentUpdated`；子代理另有 `onSubagentAssistantContentUpdated` / `onSubagentToolBlockUpdated`（见 `getting-started/general-purpose-agent.ts`）。
- **断言读 `agent.messages`**（公共 getter），按 `ToolBlock` 的 `name` / `stage` / `success` 判定「工具真跑过 / 真失败过」，比盯 stdout 文本可靠（`tools/artifact-demo.ts` 是范本）。
- `finally` 里 `await agent.destroy()` 再 `process.exit(0)`；`SIGINT` / `SIGTERM` 各挂一次 destroy。少了这步，后台 shell、MCP / LSP 子进程的清理会漏掉，进程可能挂着不退出。
- 不许 `(agent as any)` 摸私有成员；想验的东西公共接口拿不到，说明它不属于这一层。

## 服务端与配置

默认读本机 `~/.wave/auth.json` + `settings.json`，即「线上」那一档；会话级换地址可以传 `Agent.create({ serverUrl })`，登录态仍旧来自 HOME（`auth.json` 与服务端的绑定关系见 `server-and-auth.md`）。要接测试环境 / 本地服务、或要假 server 做确定性验证，按 `environment.md` 上假 HOME —— 注意 `~/.wave/auth.json` 存在时网关直连配置（`WAVE_BASE_URL` / `WAVE_API_KEY`）整段失效，想走直连就不能有 auth.json。

## 探针的去留

`examples/` 是入库目录，里面写的是「没法 mock、要真跑」的用例。一次性复现完就删；会反复用的（回归、交给别人的复现步骤）转正成 `<主题>-demo.ts`，文件头写清前置条件与跑法。

本层验不到：TUI 渲染与键序（`cli.md`）、宿主 ↔ CLI 协议（`--stdio` / realhost，`desktop.md`）、webview 渲染（`webview.md`）。
