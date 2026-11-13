---
name: "插件 MODS"
description: "用 TSX 给插件加界面与事件钩子：mods 的编译、执行、渲染、定时器与限额（一期仅桌面端面板）"
order: 75
---

# 功能规格说明：插件 MODS

## 背景

现在的插件只能做**声明式**扩展：命令、技能、子代理、钩子、LSP、MCP 六类能力都是数据（文件 + JSON），由宿主读取后注册。插件无法在会话里**画自己的界面**，也无法**在 Claude 动手前看到并改写事件**。

MODS 补上这两件事：插件带一个 TypeScript 模块（可写 TSX），运行在 agent 进程内，向宿主返回一棵声明式元素树，宿主按自己的渲染能力画出来，用户的点击/输入再回到这个模块。Claude Code 的 mods 是同一形态（`docs/specs` 外的对照调研见 PR 描述），本规格只取其最小可用子集。

一期只做**桌面端面板**：一个 mod 面板画在右侧面板槽里，面板能自己起定时器（`$.clock`）盯住外部状态，外部程序经 `$.store` 与它交换状态和意图。VS Code / JetBrains / 终端渲染、事件拦截改写、`Client` 动画、模型调用都留到后续期；mod 侧请求宿主新建会话本期不做（见「面板的归属」）。

## 概念

- **mod**：插件目录下的一个模块文件（`.tsx`/`.ts`/`.jsx`/`.js`），导出 `register($, on)`。一个插件可以有多个 mod。
- **hooks module**：普通的 ES 模块，在 agent 进程内执行。它没有 Node 全局（`fs`/`process`/`setTimeout` 都没有），只能通过 `$` 做事。
- **render site**：宿主界面上的一个可画点。一期只有 `Pane`（桌面端右侧面板的一个 tab）。
- **surface**：真正画树的渲染端（一期就是桌面端 webview）。树由 surface **拉取**：surface 对每个已挂载的 pane 发一次请求，agent 进程才去问 mod；宿主不主动把树推给 surface。
- **元素树**：`Box`/`Text`/`Button`/`Input`/`Link`/`Code`/`Markdown` 组成的嵌套声明，纯数据，可 JSON 序列化。
- **`$`**：hooks module 拿到的能力面，即「mods API」。

## 架构约束

**编译与执行都在 CLI 进程（agent 进程）内，宿主只负责画与回传。** 这与 Claude Code 的分层一致，也是唯一可行的分层：

1. mod 要读写会话状态、注册命令/工具、跑事件钩子，这些都活在 agent 进程里；
2. 桌面端是 Electron renderer，不持有会话，也不该拿到任意用户代码的执行权；
3. 宿主只收到**已编译的 JS 产物**，自己不做任何转译。

数据流是**拉取式**（与 Claude Code 的 `ui.render` 一致：invalidate 只通知过期，树永远由 surface 来要）：

```
插件目录 mods/*.tsx
  → [agent 进程] 逐文件编译（esbuild transform, classic JSX pragma `__wave.h`/`__wave.Fragment`）
  → [agent 进程] 执行 register($, on)，得到事件钩子表与元素回调表
  → mod 调 $.ui.open / $.ui.invalidate → [agent 进程] 只登记 pane、标记该 pane 的树过期
  → [stdio RPC 通知] modPanelUpdate { sessionId, modId, paneId, title, stale, closed? }（**不带树**）
  → [桌面端主进程] 转发 webview
  → [webview] 对每个已挂载的 pane 发 modPanelRender { modId, paneId }
  → [stdio RPC 请求] → agent 进程调 mod 的 ui.render → 校验（形状/限额）
  → 回 { revision, tree, error? }
  → [webview] ModPanelRenderer 把树画成 React
  → 用户点击/提交 → [webview] 回传 modPanelEvent { modId, paneId, key, kind, value }
  → [stdio RPC 请求] → agent 进程派发给 mod 的元素回调（`onPress` / `onSubmit`）
```

宿主**不缓存树**：每次请求都重新跑 `ui.render`，`revision` 在每次成功渲染时递增，webview 丢弃比已显示版本更旧的回复。这样 webview 重载、切会话回来、或多个 surface 并存时都不需要宿主额外推快照 —— surface 自己重新挂载一次即可。

## 编译

- **逐文件转译，不打包**。每个文件单独编译，相对 import 由我们自己解析（与 Claude Code 同构），不解析 `node_modules`。
- **JSX 用 classic pragma**：`esbuild.transform` 传 `jsx: "transform"` + `jsxFactory: "__wave.h"` + `jsxFragment: "__wave.Fragment"`，与 TSX 里的 `<Box>` 对应到 runtime 注入的全局 `__wave`。
- **编译器是 esbuild 的 `transform`**。选型依据：单文件 5KB 热态 0.8ms、冷启动 7ms；比 `esbuild-wasm`（170ms / 5ms）和 `@swc/wasm`（89ms / 1.3ms）快一个量级，且不需要在 webview/renderer 侧执行。逐文件 `transform` 而不是一次 `build` 的理由：两者都不打包（相对 import 由沙箱的 `require` 解析），差别只在批量开销（60 个 5KB 文件 11.5ms vs 48ms，一次性），而 `transform` 的报错天然带 `sourcefile`。
- **esbuild 走仓库既有的「运行时按需依赖」范式**：与 `@vscode/ripgrep` / `sharp` / `wave-search-tools` 同一张表（`packages/agent-sdk/src/utils/runtimeDeps.ts` 的 `RuntimeDependency`），**不进 bundle、不进安装包**。esbuild 的 JS API 不能被打包进单文件产物（实测抛 `The esbuild JavaScript API cannot be bundled`），走这条范式天然绕开：`__filename` 是真实的 `esbuild/lib/main.js`，`generateBinPath()` 的 `require.resolve("@esbuild/<platform>-<arch>/bin/esbuild")` 相对它解析，与 rg 是同一条「Node 往上找」机制。
  - 表项：`sharedPackages` = `esbuild` 本身，`platformPackages` = `@esbuild/<platform>-<arch>`（版本取 `entry.optionalDependencies`），`libcAwarePlatformKey: false` —— esbuild 是 Go 静态二进制，平台包里没有 musl 变体，且 `<platform>-<arch>` 与现成的 `runtimePlatformKey()` 输出格式一致。
  - 加入**默认批次**：随 CLI 启动后的 `void ensureRuntimeDeps()` 一起下载，落在共享的 `~/.wave/cli/node_modules`，升级不重下。首次约 4.5 MB（`@esbuild/linux-x64` 4.52 + `esbuild` 0.03，0.28.x 实测），桌面端随包的 CLI（`resources/wave-cli`）**不带任何 esbuild 文件**。
  - SDK 用 `createRequire` 从 CLI home 解析；解析失败不静默降级 —— mod 加载失败并在面板上显示「TSX mod 需要 esbuild」。

## 元素与能力

### 元素（一期）

| 元素       | 主要 props                                                                                                                                       | 说明                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Box`      | `flexDirection`、`gap`/`columnGap`/`rowGap`、`padding*`、`margin*`、`width`、`height`、`borderStyle`、`alignItems`、`justifyContent`、`overflow` | 布局容器，用 CSS flex 实现                                                                              |
| `Text`     | `color`、`bold`、`italic`、`dimColor`、`underline`、`wrap`                                                                                       | 一段文本                                                                                                |
| `Button`   | `key`、`label`、`onPress`、`disabled`、`variant`                                                                                                 | 点击后触发 `ui.press`                                                                                   |
| `Input`    | `key`、`label`、`placeholder`、`value`、`submitLabel`、`onSubmit`                                                                                | 提交后触发 `ui.input`                                                                                   |
| `Link`     | `href`、`label`                                                                                                                                  | 只允许 `https:` 与本地回环 `http:`；点击交给宿主用系统浏览器打开（`openExternal`），不在 webview 里导航 |
| `Code`     | `source`、`language`、`path`、`startLine`                                                                                                        | 一期用 `<pre><code>` 原样展示（不做语法高亮），可选一行文件路径                                         |
| `Markdown` | `text`                                                                                                                                           | `marked` + `DOMPurify` 渲染（与 webview 既有 markdown 用法同一套）                                      |

`Box` 的间距既可写数字（px），也可写 `'xs' | 'sm' | 'md' | 'lg' | 'xl'`。

上面这些名字从 `wave-agent-sdk/mods` 导入，那个子路径就是它们的 props 类型来源（`Box`、`Text`… `Fragment` 加各自的 `*Props`），插件作者写 TSX 时靠它拿类型补全；运行时值只是元素名字符串，实际由沙箱的 `require` 提供同一份表。

### 事件（一期）

`register($, on)` 的 `on(name, handler)` 注册**生命周期钩子**：

| 事件            | 触发时机                                                                                                           | 钩子可返回                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `session.start` | 会话初始化完成、第一个 prompt 之前                                                                                 | 无（返回值忽略；面板得在这里 `$.ui.open`） |
| `ui.render`     | surface 请求某个 render site 的树时（宿主不缓存，每次请求都重新问 mod），`e.component` 为站点名（一期只有 `Pane`） | 元素树                                     |

**只有这两个**，与 Claude Code 一致（它有 `session.start`/`session.end` 与 `ui.render` 等，但**没有**「面板被关掉」事件）。面板被用户关掉、插件重载、会话销毁都由宿主内部清理（撤销回调表与定时器、丢弃该 pane 的登记，之后的请求不再返回树），不通知 mod；mod 想确认面板还在不在，用 `$.ui.panes()` 查。

用户交互**不走** `on`，而是写在元素自己的回调 prop 上（回调用 `key` 与元素绑定，不进树）：

| 回调                    | 触发时机                                               | 返回值 |
| ----------------------- | ------------------------------------------------------ | ------ |
| `Button.onPress()`      | 用户点了面板里的一个 `Button`                          | 忽略   |
| `Input.onSubmit(value)` | 用户提交了面板里的一个 `Input`，`value` 是输入的字符串 | 忽略   |

### `$`（一期）

| 命名空间   | 方法                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `$.plugin` | `name`                                                                                                           |
| `$.ui`     | `open({ id, title })`、`close(id)`、`panes()`、`invalidate(id)`（只丢缓存并通知 surface 重新请求，不直接产生树） |
| `$.state`  | `get`、`set`（会话级状态；`get` 返回副本，`set` 后需自己 `invalidate`）                                          |
| `$.store`  | `get`、`set`、`delete`、`keys`（该插件自己的 JSON KV，跨会话）                                                   |
| `$.clock`  | `now()`、`after(ms, fn)`、`every(ms, fn)`（后两者返回 `{ cancel() }`，见「定时器」）                             |

### 定时器

mod 的沙箱里**没有** `setTimeout`/`setInterval`，要定时只能走 `$.clock`。这不是省略：定时器归宿主所有，会话销毁或插件重载时才能被一起撤销；裸定时器会留在进程里继续跑，然后打到已经销毁的会话上。

- `every(ms, fn)` 每 `ms` 毫秒跑一次，`after(ms, fn)` 只跑一次；两者都返回 `{ cancel() }`，`cancel()` 可以重复调用。
- `ms` 下限 200ms，更小的值**夹到 200ms**（`0`、负值、非数字几乎一定是写错了，但没必要为此把整个面板变成错误态）。
- 同一个 mod 的定时器回调**串行**执行：上一拍还没跑完时这一拍直接跳过（不排队、不并发），回调是 async 也一样。
- 回调里可以调 `$` 的任何方法（`$.ui.invalidate`、`$.store.get`、`$.ui.panes` 都行）。回调抛错记 `wave` 日志并在面板顶部叠一条错误摘要，**下一拍照常执行**——一次抛错不会把定时器停掉。
- 定时器不跨会话：会话销毁、`/reload-plugins`、agent 重建时宿主撤销该 mod 的全部定时器，之后不再有任何回调。

轮询是 mod 看到**自己进程之外**变化的主要手段。外部程序（用户在客户产品里跑的脚本、本机的客户端进程）把状态写进 `$.store` 对应的文件，mod 用 `$.clock.every` 读出来、变了就 `$.ui.invalidate`；反过来，面板上的按钮把意图写进 `$.store`，外部程序自己那份循环读到后执行真正的动作（例如连上或断开 WebSocket）。mod 不持有那个连接，也不该持有。

### 面板的归属（会话维度）

面板挂在**开它的那个会话**上：每个会话各有一份 mod 实例、一份面板；`$.state` 不跨会话，`$.store` 跨会话共享。这与 Claude Code 一致（它的 render site 全在会话内，跨会话只有 `$.store` 与 `$.session.send`），也是本规格不做全局面板的原因。

- 用户切到别的会话，这个会话的面板不显示；切回来还在（会话没销毁）。
- **新建会话永远由用户自己发起**（侧栏「＋」/`Cmd/Ctrl+N`）。mod 没有「新建会话」的能力，也没有任何请求宿主开新会话的通道：外部事件到达时，用户先新建一条会话、再打开面板控制，这是本规格明确接受的降级路径。新会话加载同一插件、再跑一次 `session.start`，于是面板在新会话里自己长出来（读同一个 `$.store`），不需要用户手动再开。
- 多会话并行时同一个 mod 有多份实例、多份定时器盯着同一个 store 文件。插件作者写 `$.store` 要按「整份覆盖」想并发，别让两个会话各自缓存一份再写回。

### 用户交互的结果

- 元素回调拿不到事件对象：`onPress()` 无参，`onSubmit(value)` 只有用户输入的字符串。想知道是哪个面板，用 `$.ui.panes()`，或在创建时把 `paneId` 闭包进回调。
- 回调返回后，若 `$.state` 或 `$.store` 变了，宿主**不**自动重画；mod 需要显式 `$.ui.invalidate(paneId)`（避免每个回调都触发一次渲染）。
- 一次 `invalidate` = 一条 `modPanelUpdate`（`stale`，不带树）；surface 收到后对受影响的 pane 各发一次 `modPanelRender`，回复里带递增的 `revision`，webview 丢弃比当前显示版本更旧的回复。
- 一个 pane 的**第一次** `modPanelRender` 回复到达时，桌面端会展开右侧面板槽并激活该 tab（与用户从「＋」菜单打开同一个效果）—— mod 申请的面板不该还要用户自己去点开。后续回复只更新内容，不抢当前焦点。
- 回包带 `error` 时，面板顶部叠一条错误摘要，**同一回复里给的是上一帧成功的树**（仍可操作）；下一次请求成功后摘要自动消失。把整棵树换成一行错误文字会让面板一次性报废（用户连别的按钮都点不到），不做。

## 限额

宿主侧强制，超限**不画**并给出可见错误（面板错误态 + `wave` 日志里的原因），不静默丢弃。

| 限额                             | 值                                      |
| -------------------------------- | --------------------------------------- |
| 单个 mod 文件                    | 1 MiB                                   |
| 一个插件所有 mod 文件总量        | 4 MiB                                   |
| 文件数                           | 64                                      |
| 元素树节点数                     | 2000                                    |
| 元素树深度                       | 24                                      |
| 树内文本总量                     | 100,000 字符                            |
| `Link.href`                      | 2048 字符                               |
| 单个 hook 执行时间               | 5 秒（超时视为失败，事件按无 mod 处理） |
| 面板每次 `invalidate` 的最小间隔 | 100ms（更快的调用合并）                 |
| 定时器最小间隔                   | 200ms（更小的值夹到 200ms）             |
| 一个 mod 同时活跃的定时器        | 16（超出时新建定时器报错）              |

## 加载纪律

- mod 的 import 只允许**相对路径**与 `wave-agent-sdk/mods`（元素构造器表）；其他裸包名直接报错。
- 动态 `import()` 在 CJS 产物里同样变成 `require`，因此受同一条白名单约束。
- 相对 import 只在**该插件本次参与编译的文件集合**里解析（不读 `node_modules`）；出现环形 import 直接报错。
- 文件解析走 `realpath`，解析结果必须落在插件目录内，越界即拒绝。
- 编译或加载失败：该 mod 不生效，其余 mod 与插件其他能力不受影响；失败原文进 `wave` 日志，并**占一个错误面板**（`paneId` 为 `error`，标题是文件名，内容是一行摘要）—— 否则用户只会看到「面板没出现」。
- 只注册 `ui.render` 而从不 `$.ui.open` 的 mod 不产生面板，日志记一条 debug。

## 生命周期

- `session.start` 在会话初始化完成、第一个 prompt 之前跑一次；面板在这一刻登记。
- `/reload-plugins` 会**重建**所有 mod：旧面板由宿主内部关掉（webview 上的 tab 随 `closed: true` 消失、旧实例的定时器与回调表一并丢弃），再按新插件列表重新加载与 `session.start`。mod 收不到「被关掉」的通知（见「事件」）。
- 会话结束 / agent 销毁：宿主内部关掉所有面板并丢弃该会话的 mod 实例，此后发来的一切交互静默丢弃。
- 会话结束与 `/reload-plugins` 同时撤销该 mod 的所有 `$.clock` 定时器（见「定时器」），销毁后不再有回调。
- webview 重建（窗口重载、panes 换绑）后 surface 自己对每个 pane 重新请求一次，用户不需要等 mod 下一次 invalidate 才能看到面板；宿主不主动推树。

## 交付分层（一期不做的事）

不做，且**接口不预留**（避免半成品）：VS Code / JetBrains / 终端渲染、`Client`/`Svg`/`Raster`/`Image`、`$.model`/`$.prompt`/`$.agent`/`$.http`/`$.process`/`$.fs`/`$.mcp`、事件拦截与改写（`tool.call`/`prompt.*`）、mod 分层与加载期审查。

`$.host`（让 mod 请求宿主做界面动作）整条不做也不预留。一期只有一个候选动作「新建会话」，它本身就超出 Claude Code 的 mods API（`$.session` 只能读会话、在会话内动作，CC 桌面端的新会话走客户端自己的接口），而它的副作用会打断用户眼前的会话（新建会把当前 pane 换到新会话）。产品决定降级：外部事件到达时由用户自己先新建一条会话，面板在新会话里自动出现（见「面板的归属」）。

## 用户场景与测试

### 用户故事：插件作者用 TSX 画出自己的面板（优先级：P0）

作为插件作者，我希望在插件里写一个 TSX 文件，让桌面端右侧面板出现我设计的界面，以便把插件的能力（待办、检查结果、看板）直接呈现给用户。

**验收场景**：

1. **假设**一个插件在 `mods/panel.tsx` 导出 `register($, on)`，其中注册了 `ui.render` 并在 `session.start` 里 `$.ui.open({ id: "p1", title: "待办" })`，**当**用户打开一个加载了该插件的会话，**则**右侧面板出现一个「待办」tab 并显示 `Hello`，且同目录下的其他插件能力（命令/技能）不受影响。
2. **假设**该 mod 的 `ui.render` 返回 `<Box flexDirection="row" gap={2}><Text>A</Text><Button label="B" /></Box>`，**当**面板渲染，**则** `A` 与按钮 `B` 横向排列、间距为 2 个间距单位，按钮可点击。
3. **假设** mod 只注册 `ui.render` 而从不调用 `$.ui.open`，**当**会话启动，**则**面板不出现，日志中记一条「mod 未申请面板」。

### 用户故事：面板交互回到 mod（优先级：P0）

作为用户，我希望点击面板里的按钮、在面板里输入文字后界面能立刻变化，以便这个面板真的能用。

**验收场景**：

1. **假设**面板里有一个 `Button`，它的 `onPress` 里把 `$.state` 的计数加一并 `$.ui.invalidate(paneId)`，**当**用户点击该按钮，**则**面板数字从 `n` 变为 `n+1`，且整个过程不产生新的对话轮次。
2. **假设**面板里有一个 `Input`，它的 `onSubmit` 把提交值追加进 `$.state` 并 invalidate，**当**用户输入 `hello` 并提交，**则**面板列表新增一行 `hello`，输入框清空。
3. **假设**同一个按钮被连点三次而 mod 每次只做一次 invalidate，**当**三次点击都到达，**则** mod 的回调被执行三次，宿主把 100ms 内的多次 invalidate 合并成一条 `stale` 通知，面板最终只请求并渲染一次。
4. **假设**面板里一个按钮的 `onPress` 直接抛错，**当**用户点击它，**则**面板顶部出现一条错误摘要、上一次渲染的按钮与列表仍能继续点，且下一次 `invalidate` 成功后摘要消失。

### 用户故事：面板跟着外部程序的状态走（优先级：P0）

作为插件作者，我希望面板显示的是**另一个进程**持有的状态（比如一条 WebSocket 连接），并且用户能在面板上给它发指令，以便插件不必自己实现网络客户端。

**验收场景**：

1. **假设**一个 mod 在 `session.start` 里用 `$.clock.every(1000, …)` 每秒读一次 `$.store.get("ws")`、值变了才 `$.ui.invalidate`，**当**外部脚本把该值从 `connecting` 写成 `open`，**则**面板在 2 秒内显示「已连接」，用户不需要做任何操作。
2. **假设**面板上有一个「断开」按钮，它的 `onPress` 只做 `$.store.set("ws", "closed")` 再 invalidate，**当**用户点击它，**则**面板立刻显示「未连接」，随后由外部程序读到该值并完成真正的断开（mod 里没有任何网络调用）。
3. **假设**定时器回调抛错，**当**某一拍失败，**则**面板顶部叠一条错误摘要、**下一拍照常执行**，面板继续跟随后续变化。
4. **假设**会话被销毁或执行了 `/reload-plugins`，**当**收尾完成，**则**该 mod 的定时器全部停止，之后不再有任何回调写 `$.state` 或 `$.ui`。
5. **假设**外部事件需要一个干净会话来处理（面板没有任何新建会话的能力），**当**用户自己按侧栏「＋」新建一条会话，**则**新会话里同一插件自己长出同一块面板、显示与旧会话一致的状态（读同一个 `$.store`），用户不需要再手动开面板。

### 用户故事：宿主拒绝不合法或过大的树（优先级：P0）

作为宿主，我需要在把树交给渲染器之前挡住不合法输入，以便一个坏 mod 不会让界面白屏或卡死。

**验收场景**：

1. **假设**某 mod 的 `ui.render` 返回了 `Button` 上不存在的 prop `bogusProp`，**当**面板渲染，**则**面板显示错误态、文案指出是哪个元素哪个 prop 不合法，且其余 mod 的面板正常。
2. **假设**某 mod 返回的树有 5000 个节点（超过 2000 的上限），**当**面板渲染，**则**面板显示「超过节点上限」的错误态，不渲染这棵树，且宿主进程不崩溃。
3. **假设**某 mod 的 `ui.render` 钩子陷入死循环，**当**超过 5 秒，**则**该次渲染失败并显示超时错误，其它事件与另一个 mod 不受影响。

### 用户故事：编译失败可见（优先级：P1）

作为插件作者，我希望 TSX 语法错误能被明确告知，以便我知道问题出在哪。

**验收场景**：

1. **假设** `mods/panel.tsx` 有一个语法错误，**当**会话启动，**则**日志包含编译器的错误原文（文件、行、列），面板出现一个标题为文件名的错误 tab、正文是「`<文件>:<行>:<列>: <原因>`」，插件其余能力仍然生效。
2. **假设**运行环境里没有可用的 esbuild，**当**加载一个 `.tsx` mod，**则**面板的正文明确指出「TSX mod 需要 esbuild」，而不是静默跳过该 mod。

### 用户故事：面板活到会话结束（优先级：P1）

作为用户，我希望插件重载或重启会话之后面板状态说得清，以便不会残留一个点不动的 tab。

**验收场景**：

1. **假设**一个 mod 已经开着一个面板、还挂着 `$.clock.every` 定时器，**当**用户执行 `/reload-plugins`，**则**旧 tab 先消失、旧实例的定时器停止，随后按新插件列表重新出现，面板内容是新代码渲染的；mod 全程收不到「被关掉」的通知。
2. **假设**会话被销毁，**当**宿主收尾，**则**所有 mod tab 消失、该会话的 mod 实例被丢弃，此后再来的交互被静默丢弃。
3. **假设** mod 在 `session.start` 之外又调用了 `$.ui.open`，**当** `modPanelUpdate` 到达且 surface 完成请求，**则**右侧面板**新增**一个 tab（同一 `modId` 可以开多个面板，`paneId` 区分）。
4. **假设**用户手动关掉 mod 的 tab，**当**之后该 mod 的定时器调用 `$.ui.invalidate(paneId)`，**则**该调用于是无害的空操作（面板已不在 `$.ui.panes()` 里），宿主不报错、不重建 tab。
5. **假设** webview 重载（窗口刷新、切走再切回），**当**面板重新挂载，**则** webview 自己对每个 pane 发 `modPanelRender` 并拿到当前树，mod 不需要再 invalidate。

### 用户故事：多个 mod 互不影响（优先级：P1）

作为用户，我希望装了两个带 mod 的插件时它们各自独立，以便一个坏了不拖累另一个。

**验收场景**：

1. **假设**插件 A 与插件 B 各带一个面板，**当**两者都打开，**则**右侧面板出现两个 tab，各自渲染自己的树，交互只路由到对应 mod。
2. **假设**插件 A 的 `ui.render` 抛异常，**当**面板渲染，**则** A 的面板显示错误态，B 的面板正常刷新，会话本身不中断。
