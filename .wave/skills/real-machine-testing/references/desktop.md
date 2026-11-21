# 桌面端：dev 隔离、realhost 套件、真 Electron 自动化

## 人工跑 dev（不动用户已装的那份）

```sh
cd packages/desktop && pnpm run run        # = compile + scripts/dev.mjs（electron . --no-sandbox）
WAVE_CLI_PATH=/path/to/repo/packages/code/bin/wave-code.js pnpm run run   # 用工作区 CLI，跳过拷 CLI + 装 rg
```

非打包态 userData 是 `appData/wave-desktop-dev`（`src/main/index.ts`），与已安装版 `CodeWave IDE` 并存互不干扰；单实例锁按 userData 作用域，所以两份能同时开。

## realhost 套件：真主进程 + 真 CLI，模型走假 server

**协议链路这一层该用假模型 server**：它验的是「宿主 ↔ CLI 协议」，需要响应可断言、也不想每次跑都烧真调用。其余真机层一律连真服务端（换服务端时 `WAVE_SERVER_URL` + 对应登录态，见 `environment.md`）；要在 realhost 里验真模型，把 harness 里的 `WAVE_API_KEY`/`WAVE_BASE_URL` 换成 `WAVE_SERVER_URL` + 真 `auth.json` 即可，但那就失去了确定性。

```sh
pnpm build                                # 必须先全量构建：套件驱动 bin/wave-code.js → dist/bundle/wave.mjs
pnpm -F wave-desktop run test:realhost    # 5 个文件，120s/hook，fileParallelism: false
pnpm -F wave-desktop test                 # 单测 + realhost 两层一起跑（vitest projects）
```

harness（`packages/desktop/tests/integration/realHostHarness.ts`）替你把环境都做好了：每次用例前重建两个工作区、`HOME`/`USERPROFILE` 指向一次性目录、`WAVE_CLI_PATH` 指向工作区 CLI、`DISABLE_LOGGER_IO=true`，并起一个 **OpenAI 兼容的假 `/chat/completions` SSE server**，用 `WAVE_API_KEY` / `WAVE_BASE_URL` / `WAVE_MODEL` 把 CLI 指过去。

**要复现「只有真会话才出现」的缺陷时，抄这套 harness 比自己搭快**：真 host ↔ 真 stdio 子进程 ↔ 假模型。它也能反过来当「假模型驱动真 UI」的夹具。Electron 外壳是 stub（`tests/__mocks__/electron.ts`），所以它验证不到渲染与打包产物；要验 UI 请用 `webview.md` 那套或下面的 `_electron` 探针。

## 真 Electron 窗口：Playwright `_electron` 配方

仓库里仍然没有**现成的** harness（没有 `_electron` / `--remote-debugging-port` 的脚本可直接跑），但这条路**已经跑通过**：2026-11-20 在 Windows 11 上用一套手写探针驱动真 Electron 窗口，验了桌面端「目录缺失 → 换文件夹」的三条行为（新建对话跳过被删目录、空白会话换目录、有历史会话搬迁），全 PASS。真主进程 + 真 `DesktopHost` + 真 `wave --stdio` 子进程 + 真 webview + 真文件系统，只有原生弹窗与模型是替身。

| 环节                                         | 做法                                            | 状态                                                           |
| -------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| electron 二进制                              | `node install.js` 解压                          | Windows **已验证**                                             |
| 构建顺序                                     | webview → code → desktop compile                | Windows **已验证**                                             |
| `_electron.launch` 参数                      | 见下                                            | Windows **已验证**                                             |
| 假 HOME 隔离                                 | `HOME`/`USERPROFILE` + `APPDATA`/`LOCALAPPDATA` | Windows **已验证**                                             |
| 假模型 SSE                                   | 抄 realhost harness                             | Windows **已验证**                                             |
| 原生选目录弹窗替身                           | `app.evaluate` 打桩                             | Windows **已验证**                                             |
| 原生弹窗的 `properties`（沙箱 / macOS 行为） | —                                               | **未验证**（Windows 上弹窗被替身绕过，参数语义没被真弹窗检验） |
| macOS / Linux 窗口                           | —                                               | **未验证**（只在 Windows 真机跑过）                            |
| 远端 SSH 主机分支                            | —                                               | **未验证**（要一台真 SSH 机器）                                |
| 多分屏 / 托盘 / 深链 / 打包产物              | —                                               | **未验证**（本次只跑单分屏主窗口）                             |

### 1. electron 二进制：`pnpm` 装完 `dist` 是空的

```sh
cd packages/desktop/node_modules/electron && node install.js
```

pnpm 不跑该包 postinstall，所以 `dist/` 空、`path.txt` 空。`install.js` 先读本地缓存 `%LOCALAPPDATA%\electron\Cache\<hash>\electron-v<ver>-win32-x64.zip`（命中就离线秒级）。打完 `dist/electron.exe` 才在。判据：`ls packages/desktop/node_modules/electron/dist/electron.exe`。

### 2. 构建顺序（串行，别并行）

```sh
pnpm -F wave-webview build      # webview dist
pnpm -F wave-code build         # packages/code/dist/bundle/wave.mjs（bundleCli 的输入）
cd packages/desktop && pnpm run compile   # sync:webview + bundleCli + tsup
```

缺 `packages/code/dist/bundle/wave.mjs` 时 `scripts/bundleCli.mjs` 直接报错退出（「请先构建 packages/code」）。agent-sdk 没构建过就先生成 `pnpm -F wave-agent-sdk build`。

### 3. `_electron.launch`

```js
const { _electron } = await import(
  "file:///C:/Users/<user>/AppData/Roaming/npm/node_modules/playwright/index.mjs"
); // 全局那份 playwright 里就有 _electron；packages/webview/node_modules/@playwright/test 亦可

const app = await _electron.launch({
  executablePath:
    "<workspace>/node_modules/.pnpm/electron@<ver>*/node_modules/electron/dist/electron.exe",
  args: ["<绝对路径>/packages/desktop", "--no-sandbox"],
  cwd: "<绝对路径>/packages/desktop",
  env: { ...process.env /* 见下 */ },
  timeout: 120_000,
});
const page = await app.firstWindow();
```

`args[0]` 是 app 目录（读它的 `package.json` → `dist/main/index.cjs`）；`env` 里务必 `delete env.ELECTRON_RUN_AS_NODE`（否则 Electron 起成 Node 模式、没有窗口）。

### 4. 假 HOME 隔离（不碰用户真实数据）

```js
// 假根目录里先把这两个子目录建出来（见下面的坑）
HOME = USERPROFILE = "<fake>";
APPDATA = "<fake>/AppData/Roaming";
LOCALAPPDATA = "<fake>/AppData/Local";
// 结果：userData = <fake>/AppData/Roaming/wave-desktop-dev
//       ~/.wave  = <fake>/.wave（os.homedir() 跟随 USERPROFILE，CLI 子进程同步）
```

跑完 `rmSync(<fake>)` 即可，用户已装的 CodeWave IDE（真 `%APPDATA%\CodeWave IDE`）与真实 `~/.wave` 都不受影响。

#### ⚠️ 坑：`AppData\Roaming` 与 `AppData\Local` 必须提前建好

Electron 的 `app.getPath("appData")` 是 `USERPROFILE` + `\AppData\Roaming`（原生解析，**要求目录已存在**）。只把 `APPDATA` 指到别处、或只改 `USERPROFILE` 而没建出这两个子目录，主进程一加载就：

```
Error: Failed to get 'appData' path
    at Object.<anonymous> (dist/main/index.cjs:…)
App threw an error during load
```

窗口根本不出现（`firstWindow()` 一直等），极易误判成「代码改崩了」。判据＝launch 日志里有 `Failed to get 'appData' path` 就先补目录，别查代码。顺序：先 `mkdir -p <fake>/AppData/{Roaming,Local}`，再指 `APPDATA`/`LOCALAPPDATA`。

### 5. 让「能发消息」可断言：本地假 SSE server

抄 `packages/desktop/tests/integration/realHostHarness.ts` 的 `startFakeModelServer()`（约 40 行：`http.createServer` → `text/event-stream` → `data: {...}\n\n` → `data: [DONE]`），然后把这些环境变量塞给 Electron：

```js
WAVE_API_KEY = "test-key";
WAVE_BASE_URL = `http://127.0.0.1:<port>/v1`;
WAVE_MODEL = "test-model";
WAVE_FAST_MODEL = "test-model";
WAVE_CLI_PATH = "<repo>/packages/code/bin/wave-code.js";
```

`StdioClient` 起 CLI 时是 `{ ...process.env, ...env }`，所以这些变量会传给 `wave --stdio` 子进程；于是「点发送 → 真走完一轮 → 回复出现在界面上」可以离线、确定地断言（回复文案自己指定）。

### 6. 原生选目录弹窗：唯一的替身

Playwright 点不到 OS 级对话框（`dialog.showOpenDialog`），在主进程里顶掉它：

```js
await app.evaluate(({ dialog }, dir) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
}, targetDir);
```

**只有弹窗本身是替身**，它之后那段（校验目录是不是目录、同目录短路、spawn、写「最近目录」、切分屏）全真跑。所以这条替代不算「假过验收」：要验的正是弹窗之后的链路。`properties: ["openDirectory","createDirectory"]` 这类参数语义**未验证**（Windows 弹窗被绕过；macOS 未验）。

### 7. 造现场的两个坑

- **「最近目录」有两份真相**：真正的是 `~/.wave/recent-workdirs.json`（`{ "dirs": [...] }`，MRU，`dirs[0]` 最新）；桌面 store（`<userData>/wave-desktop.json`）里的 `recentWorkdirs` 只是回退缓存，**开机后会被机器那份整体覆盖**。要模拟「最近目录里有一份已被删的」，**两份都要种**；只种 store 的话第一轮之后它就被清空，下一次「新对话」退到「请选择工作目录」空白态——看着像实现 bug，其实是现场造假。
- **会话索引数组是登记顺序，不是 MRU**：判「新建了一场会话」要用 sessionId 集合差（`sessions.find(s => !idsBefore.has(s.sessionId))`），`sessions[0]` 是**最早**登记的那条。

### 8. 断言锚（webview 侧）

| 用途                                   | 选择器                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| 新对话按钮                             | `[data-testid="desktop-new-session"]`                                                         |
| 输入框（contentEditable，非 textarea） | `[data-testid="message-input"]`，用 `click()` + `keyboard.type()` + `keyboard.press("Enter")` |
| 当前工作目录                           | `[data-testid="desktop-workdir"]` 的 `title` 属性 = 完整路径（只在**新会话态**渲染）          |
| 目录缺失恢复提示                       | `session-folder-recovery` / `-path` / `-choose` / `-delete`                                   |
| 侧边栏会话行                           | `desktop-session-main-<sessionId>`                                                            |
| toast                                  | `[data-testid="toast"]`（会自己消失，起 100~150ms 轮询把文案累积进 Set 再判）                 |

补充：**恢复进来的历史会话不是「新会话态」**，输入框下方没有 `desktop-workdir`，目录归属只能看会话索引 `workdir`、`~/.wave/projects/<encoded>/*.jsonl`、以及宿主 toast（如「会话已移到 …，已复制 N 个文件」）。恢复提示要等宿主重推状态才出现，触发手段是 `page.reload()`（webview 重新 ready）。

### 9. 收尾

- 探针脚本**别**放在自己 `rmSync` 的目录里：Windows 上删正在运行的脚本所在目录会 `EPERM`。脚本放父目录、数据放 `<父>/run`。
- 结束前 `app.close()`，再确认没有残留 `electron` 进程；**别碰**用户正在跑的 `CodeWave IDE`（不同 userData，本来就互不影响）。
