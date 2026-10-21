# 桌面端：dev 隔离、realhost 套件、Electron 层现状

## 人工跑 dev（不动用户已装的那份）

```sh
cd packages/desktop && pnpm run run        # = compile + scripts/dev.mjs（electron . --no-sandbox）
WAVE_CLI_PATH=/path/to/repo/packages/code/bin/wave-code.js pnpm run run   # 用工作区 CLI，跳过拷 CLI + 装 rg
```

非打包态 userData 是 `appData/wave-desktop-dev`（`src/main/index.ts`），与已安装版 `CodeWave IDE` 并存互不干扰；单实例锁按 userData 作用域，所以两份能同时开。

## realhost 套件：真主进程 + 真 CLI，模型走假 server

**这是全仓唯一该用假模型 server 的一层**：它验的是「宿主 ↔ CLI 协议链路」，需要响应可断言、也不想每次跑都烧真调用。其余真机层一律连真服务端（`server-and-auth.md`）；要在 realhost 里验真模型，把 harness 里的 `WAVE_API_KEY`/`WAVE_BASE_URL` 换成 `WAVE_SERVER_URL` + 真 `auth.json` 即可，但那就失去了确定性。

```sh
pnpm build                                # 必须先全量构建：套件驱动 bin/wave-code.js → dist/bundle/wave.mjs
pnpm -F wave-desktop run test:realhost    # 3 个文件，120s/hook，fileParallelism: false
```

harness（`packages/desktop/tests/integration/realHostHarness.ts`）替你把环境都做好了：每次用例前重建两个工作区、`HOME`/`USERPROFILE` 指向一次性目录、`WAVE_CLI_PATH` 指向工作区 CLI、`DISABLE_LOGGER_IO=true`，并起一个 **OpenAI 兼容的假 `/chat/completions` SSE server**，用 `WAVE_API_KEY` / `WAVE_BASE_URL` / `WAVE_MODEL` 把 CLI 指过去。

**要复现「只有真会话才出现」的缺陷时，抄这套 harness 比自己搭快**：真 host ↔ 真 stdio 子进程 ↔ 假模型。它也能反过来当「假模型驱动真 UI」的夹具。Electron 外壳是 stub（`tests/__mocks__/electron.ts`），所以它验证不到渲染与打包产物；要验 UI 请用 `webview.md` 那套。

## 真 Electron 窗口

**目前没有现成 harness**（仓库里没有 `_electron` / `--remote-debugging-port` / Playwright-Electron 的代码）。要验渲染、托盘、深链、打包产物，只能人工跑 dev / 安装版；要自动化得自己用 Playwright 的 `_electron` 或给 Electron 开 `--remote-debugging-port` 接 CDP——**这条未验证，别当成现成能力写进结论**。
