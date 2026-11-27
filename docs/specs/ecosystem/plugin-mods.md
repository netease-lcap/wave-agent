---
name: "插件 MODS"
description: "用 TSX 给插件加界面与事件钩子：mods 的编译、执行、渲染、定时器、外部进程与限额（一期渲染端是桌面端、终端 CLI 与 IDE 插件）"
order: 75
---

# 功能规格说明：插件 MODS

## 背景

现在的插件只能做**声明式**扩展：命令、技能、子代理、钩子、LSP、MCP 六类能力都是数据（文件 + JSON），由宿主读取后注册。插件无法在会话里**画自己的界面**，也无法**在 Claude 动手前看到并改写事件**。

MODS 补上这两件事：插件带一个 TypeScript 模块（可写 TSX），运行在 agent 进程内，向宿主返回一棵声明式元素树，宿主按自己的渲染能力画出来，用户的点击/输入再回到这个模块。Claude Code 的 mods 是同一形态（`docs/specs` 外的对照调研见 PR 描述），本规格只取其最小可用子集。

一期做**三个 surface**，画的是同一棵树：

- **桌面端**：一方是右侧面板槽里的 mod 面板，另一方是**不属于任何面板**的三样东西 —— 输入框上方的状态带、输入框下方的常驻状态行、以及短暂提示。
- **终端 CLI（`wave`）**：没有右侧栏，面板落在**输入框上方**（与桌面端的状态带同列，一次显示一个面板，多个时顶部一行 tab），三样非面板件落在输入框上下两行（见「终端形态」）。终端不做侧栏式两栏、拖动宽度与按列数决定的出现阈值，也不做终端专有的 `Raster`/`Image`。
- **IDE 插件的聊天面板**（VS Code 与 JetBrains 复用同一份 webview 产物，算同一个渲染端，surface 名 `vscode`）：画同样两个站点、落在同一个面板里（差异见「在 IDE 插件里画」）。

面板能自己起定时器（`$.clock`）盯住外部状态，外部程序经 `$.store` 与它交换状态和意图。外部程序可以只由用户自己跑，也可以由 mod 用 `$.process.spawn` 起（例如第三方服务的 WebSocket 客户端），它读到的内容再用 `$.prompt.submit` 投进对话。`Client` 动画、模型调用留到后续期；mod 侧请求宿主新建会话本期不做（见「面板的归属」）。

## 概念

- **mod**：插件目录下的一个模块文件（`.tsx`/`.ts`/`.jsx`/`.js`/`.mjs`/`.cjs`），导出 `register($, on)`。一个插件可以有多个 mod。社区里的写法（`hooks/hooks.json` 的 `modules` 声明 + `register(on, options)` + handler 收 `($, e, next)`）同样认，见「兼容社区 mod」；入口文件的扩展名不改变加载方式 —— 一律编译成 CJS，`.mjs` 里的 ESM 语法照常（Claude Code 官方示例 `mods/blast-radius` 的入口就是 `.mjs`）。
- **hooks module**：普通的 ES 模块，在 agent 进程内执行。它没有 Node 全局（`fs`/`process`/`setTimeout` 都没有），只能通过 `$` 做事。
- **render site**：宿主界面上的一个可画点。一期有两个：`Pane`（桌面端是右侧面板的一个 tab，终端是输入框上方那块，IDE 聊天面板按宽度 dock 在对话旁或落到输入框上方）与 `AbovePrompt`（输入框上方的状态带）。
- **surface**：真正画树的渲染端，一期有三端：桌面端 webview、终端 CLI（Ink）与 IDE 聊天面板。树由 surface **拉取**：surface 对每个已挂载的 pane、以及输入框上方那条带各发一次请求，agent 进程才去问 mod；宿主不主动把树推给 surface。**VS Code 与 JetBrains 共用一个 surface 名 `vscode`**：两端画的是同一份 webview、同一张元素表、同一套布局，插件没有理由区分它们。
- **元素树**：`Box`/`Text`/`Button`/`Input`/`Select`/`Svg`/`Link`/`Code`/`Markdown`/`Progress` 组成的嵌套声明，纯数据，可 JSON 序列化（`Svg` 只在桌面端与 IDE 端有，终端没有，见「元素」）。
- **外部进程**：mod 用 `$.process.spawn` 起的子进程。它跑在沙箱外、可以是任何程序（例如连第三方服务的 WebSocket 客户端），与 mod 之间靠输出流回话。
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
  → mod 调 $.ui.open / $.ui.invalidate("ui.render") → [agent 进程] 登记 pane（或只标记「这个 mod 的树过期」）、发 stale 通知
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

**终端是进程内 surface，没有 RPC 那一层。** `wave` 的 Ink 界面与 agent 同在 CLI 进程里，所以它省掉上面图里的「stdio RPC 通知 / 请求」两跳，直接调 `Agent` 的四个方法：`getModPanels()` 拿已有面板（顺带带回状态行）、`renderPane(modId, paneId)` / `renderBand()` 拉树、`handlePanelEvent()` 回传交互；`onModPanelUpdate` 回调只当「这个 pane 过期了」的信号，树照旧自己来要。两端共用同一套 `ModManager`，限额、校验、`revision`、失败保留上一帧全部一致。

请求树时 `surface` 字段按端给：桌面端 `"desktop"`、终端 `"terminal"`、IDE 聊天面板 `"vscode"`（VS Code 与 JetBrains 共用这个名字）。它决定 `$.ui.resolve(e)` 发哪张元素表，也是插件判断「我现在画在哪」的唯一依据（见「元素表按端分」）。

## 编译

- **逐文件转译，不打包**。每个文件单独编译，相对 import 由我们自己解析（与 Claude Code 同构），不解析 `node_modules`。
- **入口的相对 import 会被递归收进编译集**：`mods/` 目录本身全收，`hooks/hooks.json` 声明的入口只收声明的那些，所以入口 `import "./lib/format.js"` 的兄弟文件要顺着 import 图找出来一起编译 —— 只收入口会让社区的多文件 mod 报「文件未编译」，而它们确实是同一个 mod。收进来的兄弟文件仍然要过插件目录与限额检查；**只有导出 `register` 的才算一个 mod**，没有的（纯工具模块）只参与编译、不注册钩子、不占 mod 名额。
- **JSX 用 classic pragma**：`esbuild.transform` 传 `jsx: "transform"` + `jsxFactory: "__wave.h"` + `jsxFragment: "__wave.Fragment"`，与 TSX 里的 `<Box>` 对应到 runtime 注入的全局 `__wave`。
- **编译器是 esbuild 的 `transform`**。选型依据：单文件 5KB 热态 0.8ms、冷启动 7ms；比 `esbuild-wasm`（170ms / 5ms）和 `@swc/wasm`（89ms / 1.3ms）快一个量级，且不需要在 webview/renderer 侧执行。逐文件 `transform` 而不是一次 `build` 的理由：两者都不打包（相对 import 由沙箱的 `require` 解析），差别只在批量开销（60 个 5KB 文件 11.5ms vs 48ms，一次性），而 `transform` 的报错天然带 `sourcefile`。
- **编译完就把编译器收掉，不常驻**。`transform` 的 async API 会起一个 `--service` 常驻进程（`<platform> esbuild.exe --service`），而它的工作目录是 **esbuild 模块被加载那一刻的 `process.cwd()`**；会话在 worktree 里时（`-w` 起会话、桌面端在 worktree 内起会话）那就是 worktree 目录本身。Windows 上「某个进程的 cwd 在这个目录里」会让 `RemoveDirectoryW` 直接失败（`ERROR_SHARING_VIOLATION` → node `EBUSY`），于是一批 mod 编译完之后，退出时删 worktree 只能删成一个空壳、再提示用户手动清理。编译是一次性的 —— 跑起来的是编出来的 CJS，运行期不需要编译器 —— 所以一批 mod 编译完就 `stop()`，下一批再重起（实测重起 23ms、冷启 41ms、60 个文件热态 22ms）。语义与 Claude Code 一致：它用 `Bun.Transpiler` 在进程内同步转译，同样不留进程。
- **esbuild 走仓库既有的「运行时按需依赖」范式**：与 `@vscode/ripgrep` / `sharp` / `wave-search-tools` 同一张表（`packages/agent-sdk/src/utils/runtimeDeps.ts` 的 `RuntimeDependency`），**不进 bundle、不进安装包**。esbuild 的 JS API 不能被打包进单文件产物（实测抛 `The esbuild JavaScript API cannot be bundled`），走这条范式天然绕开：`__filename` 是真实的 `esbuild/lib/main.js`，`generateBinPath()` 的 `require.resolve("@esbuild/<platform>-<arch>/bin/esbuild")` 相对它解析，与 rg 是同一条「Node 往上找」机制。
  - 表项：`sharedPackages` = `esbuild` 本身，`platformPackages` = `@esbuild/<platform>-<arch>`（版本取 `entry.optionalDependencies`），`libcAwarePlatformKey: false` —— esbuild 是 Go 静态二进制，平台包里没有 musl 变体，且 `<platform>-<arch>` 与现成的 `runtimePlatformKey()` 输出格式一致。
  - 加入**默认批次**：随 CLI 启动后的 `void ensureRuntimeDeps()` 一起下载，落在共享的 `~/.wave/cli/node_modules`，升级不重下。首次约 4.5 MB（`@esbuild/linux-x64` 4.52 + `esbuild` 0.03，0.28.x 实测），桌面端随包的 CLI（`resources/wave-cli`）**不带任何 esbuild 文件**。
  - SDK 用 `createRequire` 从 CLI home 解析；解析失败不静默降级 —— mod 加载失败并在面板上显示「TSX mod 需要 esbuild」。

## 沙箱

mod 跑在 `node:vm` 的独立 context 里（每个 mod 一个）：没有 `process` / `Buffer` / `node:*`，`eval` 与 `new Function` 由 `codeGeneration` 关掉。三件与 Claude Code 的 `vmHardening` 同档的加固：

- **每次跨入都从 `runInContext` 进**（模块体、`register`、事件处理、元素回调、`$.clock` 回调）。`vm` 的 `timeout` 只在这一层生效，宿主直接调用等于裸跑 —— `while (true) {}` 会卡死整个 agent 进程，5 秒预算连触发都轮不到。
- **超时只管同步段**：`async` 处理函数第一次 `await` 就交回宿主，那之后的墙钟由 hook 预算算（见「限额」）。两边互补，缺一边留一个洞。
- **本 realm 的内置一律冻结**，并锁掉 `Error.prepareStackTrace`、删掉 `Error.captureStackTrace` —— 堆栈是宿主写日志时要读的，mod 能改写它就能让排查看到一段假的。

这仍是**进程内隔离**，不是安全边界：mod 与 hooks / MCP server 同一信任层级（用户自己装的插件），`$` 与元素构造器也还是宿主对象（把它们搬进 vm 要重写成字符串，代价大于收益）。它挡的是「写错一个死循环、或误调 `process.exit()` 把会话带走」。

## 元素与能力

### 元素

| 元素       | 主要 props                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 说明                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Box`      | `flexDirection`（`row`/`column`/`row-reverse`/`column-reverse`）、`flexWrap`、`flexGrow`、`flexShrink`、`gap`/`columnGap`/`rowGap`、`padding`、`paddingX`/`paddingY`、`paddingTop`/`Right`/`Bottom`/`Left`、`margin`、`marginX`/`marginY`、`marginTop`/`Right`/`Bottom`/`Left`、`width`/`height`/`minWidth`/`minHeight`、`borderStyle`、`borderColor`、`borderDimColor`、`backgroundColor`、`alignItems`、`alignSelf`、`justifyContent`、`display`、`position`、`top`/`left`/`right`/`bottom`、`overflow`、`hover` | 布局容器，用 CSS flex 实现                                                                                                                     |
| `Text`     | `color`、`backgroundColor`、`weight`、`size`、`bold`、`italic`、`dimColor`、`underline`、`strikethrough`、`inverse`、`wrap`、`hover`                                                                                                                                                                                                                                                                                                                                                                               | 一段文本                                                                                                                                       |
| `Button`   | `key`、`label`、`onPress`、`variant`（`"primary"`/`"secondary"`）、`plain`、`dimColor`、`role`（只有 `"dismiss"`：这个按钮关闭它所在的站点）、`autoFocus`、`hotkey`（一个小写字母或数字：面板聚焦时按下等于点它）、`hover`                                                                                                                                                                                                                                                                                         | 点击后触发 `ui.press`                                                                                                                          |
| `Input`    | `key`、`label`、`placeholder`、`value`、`submitLabel`、`onSubmit`、`autoFocus`、`rows`                                                                                                                                                                                                                                                                                                                                                                                                                             | 提交后触发 `ui.input`                                                                                                                          |
| `Select`   | `key`、`options`、`onSelect`、`label`、`value`、`autoFocus`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 下拉选择，选中后触发 `ui.select`；`options` 是 1–64 个 `{ value, label? }`，`value` 唯一                                                       |
| `Svg`      | `source`、`alt`、`width`、`height`、`isInteractive`                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 一段 SVG 标记内联画出来；`source` 非空且 ≤131072 字符，`alt` 必填（没有它等于没有可读文本）。**桌面端与 IDE 端有，终端的元素表里没有这个名字** |
| `Link`     | `href`、`label`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 只允许 `https:` 与本地回环 `http:`；点击交给宿主用系统浏览器打开（`openExternal`），不在 webview 里导航                                        |
| `Code`     | `source`、`language`、`path`、`startLine`、`format`、`wrap`                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 一期用 `<pre><code>` 原样展示（不做语法高亮），可选一行文件路径；`wrap` 只有 `"wrap"`/`"truncate-end"`；`format` 只有 `"diff"`（见下）         |
| `Markdown` | `text`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `marked` + `DOMPurify` 渲染（与 webview 既有 markdown 用法同一套）                                                                             |
| `Progress` | `label`、`value`、`max`、`valueText`、`color`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 一条进度：`value/max` 夹到 0–1（`max` 缺省 1），`valueText` 缺省是百分比；`label` 必填（说什么在做）；有 `value` 时是两行（标签 + 条）         |

`Box` 的间距既可写数字（px），也可写 `'xs' | 'sm' | 'md' | 'lg' | 'xl'`。

**间距的轴写法不是别名**：`paddingX` 设左右、`paddingY` 设上下，与 `paddingLeft` 这类单边写法**各自生效**，生效顺序是 `padding` → `paddingX` → `paddingY` → 单边（后写覆盖先写），与 Claude Code 的 Ink 实现同一顺序。`margin` 同理。这条顺序决定了「`padding={2} paddingX={1}`」得到的是左右 1、上下 2，而不是整块 1。

**`minWidth`/`minHeight`** 与 `width`/`height` 一样收数字或字符串（`'50%'` 这类百分比直接交给 CSS）。**`alignSelf`** 只有 `'flex-start' | 'center' | 'flex-end' | 'auto'`（**没有 `stretch`** —— 那是 `alignItems` 才有的值，照 Claude Code 的契约）。**`display`** 只有 `'flex' | 'none'`，`none` 的 `Box` 不占位置（配合 `hover` 做「悬停才展开的卡片」）。**`position`** 只有 `'relative' | 'absolute'`；`absolute` 时 `top`/`left`/`right`/`bottom` 是数字（px，可负），脱离文档流、不占兄弟位置、被站点区域裁切。

**颜色收两类值**：一类是主题 token（跟随用户的明暗主题），另一类是任何其它字符串（CSS 颜色名/hex，原样用）。token 名单与 Claude Code 的 `ThemeKey` 同名，映射到我们自己的设计变量：

| token                                   | 映射                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `text`                                  | `--cc-text-primary`                                                           |
| `subtle` / `inactive`                   | `--cc-text-secondary` / `--cc-text-placeholder`                               |
| `inverseText`                           | `--cc-bg-panel`（在反色底上写字）                                             |
| `suggestion` / `remember` / `merged`    | `--cc-text-link`（我们没有独立的紫/青 token，先用链接色，见「一期不做的事」） |
| `success` / `autoAccept` / `diffAdded`  | `--cc-color-success`                                                          |
| `error` / `diffRemoved`                 | `--cc-color-danger`                                                           |
| `warning` / `permission`                | `--cc-state-waiting`                                                          |
| `planMode` / `ide`                      | `--cc-color-info`                                                             |
| `claude`                                | `--cc-action-primary`                                                         |
| `promptBorder` / `bashBorder`           | `--cc-border`                                                                 |
| `diffAddedDimmed` / `diffRemovedDimmed` | `--cc-color-success-soft` / `--cc-color-danger-soft`                          |
| `diffAddedWord` / `diffRemovedWord`     | `--cc-color-success` / `--cc-color-danger`                                    |

表外的字符串（`#f60`、`red`、`rgb(…)`）当裸色用，不做白名单校验 —— 与 Claude Code 的 `Color`（`ThemeKey | string`）一致：认不出的 token 由各端自己决定画什么，而不是让整棵树被拒。

**`Text.weight`** 是枚举 `'regular' | 'medium' | 'semibold' | 'bold'`（不是数字），**`size`** 是语义档 `'caption' | 'footnote' | 'body' | 'heading' | 'title'`（不是字号）。两者缺省都继承外层 `Text`。`bold` 是 `weight` 的旧名（等价 `'semibold'`），显式 `weight` 压过它 —— 老 mod 写 `bold` 仍照常加粗。**`inverse`** 把前景与背景互换（在 `backgroundColor` 之上生效），**`strikethrough`** 画删除线。

**`Button.plain`** 是布尔开关（`true` 才画）：画成一串「字形 + label」的扁平按钮，不带边框与底色（一排 `➤` / `✕` 图标键就用它）；`plain` 为真时 `variant` 不再起作用。**`Button.dimColor`** 让 label 静止时调暗、指针进来时恢复全强度。**`Button.role`** 只有一个值 `"dismiss"`，含义是「这个按钮关闭它所在的站点」——**纯绘制提示、不改行为**（关了之后发生什么由 mod 自己的 `onPress` 决定）：桌面端把它画成那颗关闭控件（与面板页签的 × 同一颗），`label` 不再作为文本画出、改当它的无障碍名（`aria-label`），`plain`/`variant` 随之失效；写成别的值当场点名（`Button.role 只允许 "dismiss"`）。**`autoFocus`**（`Button` / `Input` / `Select`）只认布尔，`true` 才抢焦点（Claude Code 那边 `false` 会被拒；我们收布尔是因为 `autoFocus={cond}` 是自然写法），一个站点里多个时只有第一个生效。**它是这一站点的初始焦点**：面板刚打开、还没有人移过焦点时，焦点环就落在标了它的那个控件上（桌面端走 DOM 的 `autoFocus`，终端在第一次拿到树时按同一规则选种子），标了它是为了「别把焦点放在第一个按钮上」这类排布。

**`Input.rows`** 是 ≥1 的整数（缺省 1）：从 2 起变成多行输入（等价 `<textarea rows>`），Enter 仍提交、换行按输入框的默认打法。`Code.wrap` 只有 `'wrap' | 'truncate-end'` 两个值（`Text.wrap` 的其它拼法在这里被拒 —— 有行号 gutter 时它们没有意义）。

**`Code.format`** 目前只有一个值 `"diff"`，与 Claude Code 同名同形 —— 它的差异插件画正文就是 `<Code source={…} format="diff" path={…}>`（2.1.327 二进制核对）：`source` 是一段**统一差异文本**（`git diff` 那套，行首 `+`/`-`/` `/`@@`），surface 按行首着色 —— `+` 行绿（`diffAdded`）、`-` 行红（`diffRemoved`）、`@@` 行青（`planMode`），其余原色。没有它时 `Code` 是纯文本（见上表 `language` 也不做高亮），所以差异必须声明 `format="diff"` 才有颜色 —— 不靠内容猜。写别的值当场点名（取值表里只有这一个）。

两处与 Claude Code 的差，都是**有意**的：

- **不校验 `source` 能否 parse**。CC 的引擎在 `format: "diff"` 时先确认 `source` 是合法的 hunk 再交给 surface；我们只按行首着色 —— 着色本来就不依赖解析，而校验不过的代价是整棵树被拒（第三方插件一个字写错就什么都画不出来），观感上两边都是「颜色不对」。
- **只有终端画这套着色**。差异插件只在 `terminal` 注册面板，桌面端收到同一个 `format` 不报错、按纯文本画 —— 缺的是那一端的渲染，不是契约（元素表对四端是同一份）。

::: v-pre

**`hover` 是节点的独立字段，不在 props 里**：`h()` 把 JSX 上的 `hover={{ … }}` 摘到节点的 `hover`，因为它的值是**对象**（props 只收原始值）。结构是两个封闭的 key 集：

:::

- `Box`：`scope`、`borderStyle`、`borderColor`、`borderDimColor`、`backgroundColor`、`display`（只认 `'flex'`，用来 reveal 一个 `display: "none"` 的 `Box`）、`top`/`left`/`right`/`bottom`（只对 `position: "absolute"` 有效）。**没有一个会让兄弟移位**。
- `Text` / `Button`：`scope`、`color`、`backgroundColor`、`dimColor`、`bold`、`italic`、`underline`、`strikethrough`、`inverse`（`Button` 的 `hover` 改的是它 label 的样式，不含 `wrap`）。

**生效范围是「最近的带 `key` 的 `Box`」**：指针落在那个 `Box`（含其后代）里时，它自己和所有后代的 `hover` 一起生效；在里面再套一个带 `key` 的 `Box` 就是新的 scope。`scope` 给一个字符串时，这个元素加入**同名 scope** 而不是最近的 `Box` —— 让画在行外的卡片跟着行内元素一起亮。悬停**不跑钩子、不过进程**：它只是 surface 自己按指针位置换一组样式。

**props 是白名单，写错要报错**：每个元素只认上表列出的名字，多写一个（拼错、或照别的框架习惯写 `className`/`style`）在 `validateModTree` 阶段就失败并点名那个 prop —— 静默忽略会让作者以为写对了、却看不到任何效果。这条与 Claude Code 的元素校验一致（它的 `Button` 校验连 `variant` 的取值都会挑出来）。`hover` 的子 key 同样按上表校验，写错 key 也点名。

**上表的 prop 面是 Claude Code 同名白名单的子集**：它有的我们可以不吃（缺了只是作者的写法不生效），它没有的名字我们**不新增** —— 多一个名字就多一套只有我们认得、换到 Claude Code 上直接被拒的写法。所以加 prop 前先确认 Claude Code 的同名元素也收这个名字。

`flexGrow`/`flexShrink`/`flexWrap` 用 Claude Code 的同名 props，作用于**这个 `Box` 在父容器里**怎么伸缩与折行。`Button` 不收这三个名字 —— 宿主给按钮的默认是 `flex: 0 0 auto`，一排按钮不会被压成竖排；带里按钮多到放不下时，给那一行的 `Box` 写 `flexWrap="wrap"` 折到下一行。

`Select` / `Svg` / `Progress` 与前面七个的差别只有两条：**它们的 props 里有非原始值**（`Select.options` 是对象数组 —— 全表唯一一处），以及**三个都是叶子**（带 children 会被校验拒掉）。所以「prop 必须可序列化成原始值」这条规则按元素区分 —— 只有 `Select.options` 走数组，其余元素照旧只认字符串/数字/布尔/null。叶子的语义全在 prop 上（选哪几项、画哪段图、进度到哪），所以除了名字白名单还查取值：空 `options`、重复 `value`、超限的 `source`、非数字的 `value`/`max`、缺 `label` 的进度条，都当场点名。

::: v-pre

**被丢掉的对象 prop 要出声**：`h()` 只留原始值（`Select.options` 与 `hover` 两处例外），其余非原始值到不了树上。这类 prop（`style={{…}}`、`className` 的变体）以前是静默丢弃 —— 作者看到「写了没效果、也没有报错」。现在每丢一个记一条 warn，点名元素与 prop。

:::

上面这些名字从 `wave-agent-sdk/mods` 导入，那个子路径就是它们的 props 类型来源（`Box`、`Text`… `Fragment` 加各自的 `*Props`），插件作者写 TSX 时靠它拿类型补全；运行时值由沙箱的 `require` 提供同一份表（`$.ui.resolve(e)` 拿到的也是它）。**两种写法编出同一种树**：JSX（`<Text>hi</Text>`，编译器把 tag 交给 `__wave.h`）与调用式（`Text({ children: "hi" })`，Claude Code 官方示例就这么写）—— 构造器带 `elementType`，`h()` 按它归一，所以画出来的节点类型都是 `Text`。

### 元素表按端分

三端画的元素**不是同一张表**：`$.ui.resolve(e)` 按 `e.surface` 给这一端能画的那几张构造器。桌面端与 IDE 端各 10 个（`Box`/`Text`/`Button`/`Input`/`Select`/`Svg`/`Link`/`Code`/`Markdown`/`Progress`，两端逐项相同 —— VS Code 与 JetBrains 画的就是同一份 webview），终端 9 个（同一张表去掉 `Svg`）。这与 Claude Code 的分表方式一致 —— 它四张表各差几项（`terminal` 12 个，有 `Raster`/`Image` 而没有 `Svg`；`desktop` 12 个，反过来有 `Svg`/`Shader`；`vscode` 是那九个加 `Progress`），其中 `Progress` 在**每一端都有**。我们的差别只在没做 `Client`（三端都没）、`Shader`（桌面）、`Raster`/`Image`（终端）。

**`Svg` 在终端拿不到**：终端没有矢量画布，画出来只会是一堆坐标文本，所以名字压根不进终端那张表 —— 插件在终端里 `$.ui.resolve(e).Svg` 是 `undefined`，照桌面端写的那段直接报错，错误落在面板顶部。要兼顾两端就按 `e.surface` 分支：`"terminal"` 时改画几行 `Text` 或 `Box` 拼的条。

**`Progress` 两端都有**：终端用一行字符条（`█` 填、`░` 空）加百分比文本，宽度按站点给的行宽算，`value`/`max`/`valueText` 的语义与桌面端逐字相同。Claude Code 的终端表里也有它，所以「进度条」这类 mod 不必自己拿 `Box` + `Text` 拼字符条（社区里现在的确都是自己拼的，见「终端渲染」）。

**退回模块导入也过不了校验**：`import { Svg } from "wave-agent-sdk/mods"` 拿得到构造器（那是并集表，不按端裁剪），但用它拼出的树在终端请求里会被 `validateModTree` 拒掉并点名「terminal 的元素表里没有 Svg」，不会静默画成空白。

### 终端渲染

终端与桌面端画**同一棵树**，差别只在终端能表达什么。终端那张表里的九类都直译成 Ink：`Box` → 伸缩盒（`flexDirection`/`gap`/`padding`/`border*` 照抄），`Text` → 一段带颜色的字，`Button` → 一行「字形 + label」，`Input` → 一个焦点行，`Select` → 当前值一行、展开时列候选，`Progress` → 一行字符条（`█`/`░`）+ 百分比，宽度取站点行宽、上限 40 列，`Code`/`Markdown` 复用 CLI 现有的高亮与终端 markdown 渲染，`Link` 只把 URL 当文本显示（终端里点了不跳）。

三个桌面端特有、终端里自然失效的 prop，**不算校验错误**（树照收，只是画面上没有效果）：`hover`（终端没有指针移入事件）、`position="absolute"`（按普通盒子画，不脱流）、`Box` 的 `overflow` 滚动（滚动归终端这个 pane 自己，一层就够）。

### 终端形态（输入框上方）

终端没有右栏，面板只能落在**输入框上方**。纵向自上而下是：`pane`（面板）→ 输入框上方的带 → 输入框 → 输入框下方那一行（权限模式提示在左，`$.ui.status` 与提示在右）。

- **一次显示一个 pane**。同时登记了多个时，pane 区顶部多一行 tab：`1: 待办   2: 检查`，数字是该 pane 在当前列表里的序号（超过 9 个只列前 9 个）。只有一个 pane 时不画 tab 行。
- **默认不抢焦点**：面板出现后键盘还在输入框里，用户可以接着打字。`$.ui.open({ focus: true })`（或用户敲的 `/命令` 带出来的面板）才把焦点直接送进面板。
- **焦点在面板时**：`↑`/`↓` **先问一遍 mod**（`ui.focus`，见「控件的交互事件」）—— 插件返回落点就把焦点换到那个控件（列表型面板靠这条做选中），不返回就归这一端滚正文（`PageUp`/`PageDown` 翻页，`Home`/`End` 到顶/到底）。滚之前还会**再问一句 `ui.scroll`**（见「`ui.scroll`：mod 自己滚」）：想自己分页的插件接住这一下就由它挪窗口，不接才落回这一端的偏移。`Tab`/`Shift+Tab` 在任何情况下都只管移焦点，`Enter` 触发按钮或提交 `Input`，`hotkey` 字母直接触发对应按钮，数字键 `1`–`9` 切到对应面板；焦点在 `Input` 里时所有可打印键归输入框（与桌面端同一条纪律）。这条与 Claude Code 的 **inline（`/tui classic`）分支**一致：它那边方向键先变成 `ui.focus` 问插件，插件接住就换选中项，不接就落回 surface 的默认滚动；它的 fullscreen（右侧栏）分支是另一套（`↑`/`↓` 恒滚正文、`Tab` 移焦点），我们不跟。**mod 仍然拿不到原始方向键**：它收到的只是「候选落点」与「这一下要滚几行」，要跟着滚动走的信息从 `ui.render` 的 `e.props`（可见行数）里读。
- **退出用 `Esc`**：焦点在面板时按 `Esc` **先问一遍 mod**（`ui.close`，见「`ui.close`：mod 能拦下关闭」）—— 插件返回 `{ deny }` 就留在原地（详情页返回列表这类用法），否则收起这个面板并把焦点还给输入框（只是这一端不再画它；mod 下一次 `$.ui.open` / `invalidate` 会重新出现）。焦点在输入框时 `Esc` 完全归输入框（清空提示那套语义照旧），不碰面板。`Ctrl+C` 等宿主键不受影响。
- **高度**：面板正文的高度取**插件申报值与可用空间里较小的那个**。申报走 `$.ui.open({ rows })`（见「面板放得下吗」），省略时按 12 行；带每条封顶 6 行。两者与输入区合计不得超过终端 `rows` 的 2/3：先压带（每条最低 3 行）、再压面板（最低 6 行），仍放不下时面板内部滚动，消息区不被挤出去。所以「一张差异面板要占大半屏」只需 `rows` 申报，不用改这一端的策略 —— 上限仍是 2/3，终端太矮时它照样缩。
- **不做**：手动把焦点移进面板的独立键（裸 `Tab` 已是补全/选择确认的键，不抢 —— 面板拿到键盘之后 `Tab` 才归面板）、焦点在输入框时用 `Esc` 收盘；侧栏两栏与拖动宽度、按列数决定的出现阈值、`$.ui.open` 的 `columns` 字段、`Raster`/`Image`、重绘对话流里的消息与工具行。

### 事件（一期）

`register($, on)` 的 `on(name, handler)` 注册**生命周期钩子**：

| 事件                                  | 触发时机                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 钩子可返回                                                                                                                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `session.start`                       | 会话初始化完成、第一个 prompt 之前                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 无（返回值忽略；面板得在这里 `$.ui.open`）                                                                                                                                                                                                                         |
| `prompt.submit`                       | 用户审阅并提交一条 prompt（含 mod 自己调 `$.prompt.submit`），**模型请求还没发出之前**，见下                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `{ context?: string[] }`：塞给模型的额外上下文                                                                                                                                                                                                                     |
| `prompt.compose`                      | 宿主组装系统提示词时（一轮一次），见「系统提示词与附件」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `{ sections }`：`{ id, text, scope }` 数组，`scope` 取 `shared` / `session`，按发出的顺序                                                                                                                                                                          |
| `prompt.section`                      | 系统提示词里每个**命名段**一次，`e.name` 是它在 `prompt.compose` 里的 `id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `{ text }`，或用 `{ text: null }` 让这一段不出现（见「系统提示词与附件」）                                                                                                                                                                                         |
| `prompt.context`                      | 每条会话**一次**，在第一条消息发出之前                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `{ blocks }`：整场会话都要带的上下文块，每块 `{ name, text }`（见「系统提示词与附件」）                                                                                                                                                                            |
| `prompt.attachment`                   | 宿主自己要往对话里加一条消息之前（`system-reminder`、记忆注入、后台任务通知…），`e.type` 是这一类的名字                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `{ text }`，或用 `{ text: null }` 让这条不出现                                                                                                                                                                                                                     |
| `prompt.edit`                         | 用户在输入框里做完一次编辑（一次按键、一次粘贴、一次删除），`e` 是 `{ origin, key?, text, cursor, start, end, inputText }`，见「输入框里的建议」                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `next(e)` 解析到 `{ text, cursor }`：改写后的输入框；外层返回自己的那份也算数                                                                                                                                                                                      |
| `prompt.suggest`                      | 一个建议要摆进输入框时（引擎自己的推荐、或某个 mod 的 `$.prompt.suggest`），`e` 是 `{ text, origin }`，见「输入框里的建议」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `{ isShown: boolean }`：给出即是最终答案（`true` 不再问宿主，`false` 就是不摆）                                                                                                                                                                                    |
| `turn.start`                          | 一轮开始（用户消息已进上下文、第一个模型请求之前）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 无（返回值忽略）                                                                                                                                                                                                                                                   |
| `turn.step`                           | 一轮里**每发出一次模型请求之前**（工具循环的每一步），`e` 是 `{ turnId, index, model, effort?, messageCount, agentId? }`，`index` 从 0 起；handler 可以写成 async generator（见「轮次内外的事件」）                                                                                                                                                                                                                                                                                                                                                                                                         | `next(e)` 把这次请求交给下游（`yield*` 可转发中途产出）；返回 `{ ...e, model }` / `{ ...e, effort }` 改写**这一次**请求，宿主等答案落地后才发请求（见「轮次内外的事件」）                                                                                          |
| `ui.render`                           | surface 请求某个 render site 的树时（宿主不缓存，每次请求都重新问 mod）；事件带三个正交的维度：`e.surface` 是画这棵树的那一端（`desktop` / `terminal` / `vscode`，后者含 VS Code 与 JetBrains 两个宿主）、`e.component` 是站点名（一期有 `Pane` / `AbovePrompt` / `AbovePromptList`）、`e.requestId` 是该站点的哪个实例（`Pane` 是 `$.ui.open({ id })` 的 id，带固定是 `above-prompt`）、`e.plugin` 是这棵树归哪个插件；信封就是 Claude Code 的那五个加 `props`：`{ surface, component, requestId, plugin, viewport, props }`，不多不少；`e.props` 是站点给的版面事实（`bodyColumns` / `maxRows` 等，见下） | 元素树                                                                                                                                                                                                                                                             |
| `turn.complete`                       | 一轮对话结束（答完，或被用户中断），见下                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 无（返回值忽略）                                                                                                                                                                                                                                                   |
| `session.measure`                     | 一次带 usage 的响应回来后、token 计数已更新，见下                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 无（返回值忽略）                                                                                                                                                                                                                                                   |
| `session.compact`                     | 上下文压缩**完成后**（自动或手动 `/compact`），`e` 是 `{ trigger, tokensBefore, tokensAfter }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 无（返回值忽略）                                                                                                                                                                                                                                                   |
| `session.append`                      | 对话要**存下一行**之前（一条用户消息、一条模型消息、一条工具结果），见「转录写入前改写」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `next({ ...e, message })`：改这一行的文本块；`{ deny: reason }` 不存这一行；`e` / 返回值都带 `uuid`（= `message.id`）与 `door`                                                                                                                                     |
| `tool.call`                           | 一次工具调用**执行之前**（参数已通过 schema 校验、工具还没跑、权限还没问），见下                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `next(e)` 就是**执行这次调用**（`settings.json` 的 PreToolUse 与执行都在里面，resolve 到 `{ result }`，CC 同一条链）；`{ deny: string }` 拦下不跑；`{ result }` 是这次调用的结果 —— 可以是 `next()` 真跑出来的改写，也可以自己造（见「把我们自己的工具交给模型」） |
| `tool.check`                          | 一次工具调用**能不能跑**：`tool.call` 与 `classic.PreToolUse` 都放行之后、权限规则与模式给决定之前；`next(e)` 解析到的就是「规则 + 模式 + 前面那些钩子」已经形成的决定，见「第二判定源」                                                                                                                                                                                                                                                                                                                                                                                                                    | `{ decision: "allow" \| "ask" \| "deny", reason? }`：只能**收紧**，不能放宽（见「第二判定源」）                                                                                                                                                                    |
| `tool.describe`                       | 一个工具的描述**第一次要发给模型**时（每个工具一次），见「给工具、技能、命令写描述」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `{ description, isDeferred?, breakPromptCache? }`；`isDeferred` 翻转这个工具「平铺还是进 `REPL` 池」（同轮生效，见「给工具、技能、命令写描述」）；`breakPromptCache: true` 才让会话里存的那份失效                                                                  |
| `tool.register`                       | 会话第一次把工具清单交给模型之前（`session.start` 之后、第一个请求之前），每个 mod 一次，见「把我们自己的工具交给模型」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 无（返回值忽略；handler 里调 `$.tool.register`）                                                                                                                                                                                                                   |
| `agent.offer`                         | 引擎把一个子代理类型摆到模型面前时（Agent 工具的清单里一次、真正派发时再一次），见「派子代理」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `{ isOffered }`：`false` 既不入清单、也拒绝派发                                                                                                                                                                                                                    |
| `agent.spawn`                         | Agent 工具（或 `$.agent.spawn`）即将起一个子代理、模型还没解析时，见「派子代理」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `next(e)` 解析到 `{ model, agentId? }`；改 `e.prompt` / `e.description` 就是子代理真正拿到的东西                                                                                                                                                                   |
| `classic.PermissionRequest`           | 一次工具审批**即将**弹给用户时（`PermissionRequest` 钩子已放行、宿主询问用户之前），见下                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 无（返回值忽略；**没有**批准/拒绝通道）                                                                                                                                                                                                                            |
| `classic.*`（19 个镜像）              | 各自挂在宿主已有的某个时刻上（会话开局/销毁、一轮收尾、用户提交、换模型、工具跑完、压缩前后、目录变了…），逐条见「影子事件」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 只有三条有返回通道，且都是我们本来就有的能力换了个名字：`classic.Stop` / `classic.SubagentStop` 的 `{ additionalContext }` 让这一轮（子代理的那一轮）续跑、`classic.PreToolUse` 的 `{ deny }` 在工具跑之前拦下它。其余返回值一律忽略                               |
| `command.run`                         | 用户执行了一个由 `$.command.register` 注册的命令，或 mod 自己调 `$.command.run`（见「注册命令」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `{ text }`：这一行要变成的 prompt；`{}`：只是插件自己的动作（开关面板等），不发消息也不进对话。钩子没答（`undefined`）才是「没人回答」                                                                                                                             |
| `command.describe`                    | 命令列表要画时，每个命令（内置、插件、`$.command.register` 注册的）问一次，宿主等答案再画                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `{ description, argumentHint, isHidden }`（见「给工具、技能、命令写描述」）                                                                                                                                                                                        |
| `skill.prompt`                        | 一个技能的正文被展开给模型时（`/名字` 调用、或模型自己调）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `{ text }`：换掉技能正文                                                                                                                                                                                                                                           |
| `session.end`                         | 会话销毁（关掉这条会话、进程退出）**之前**；返回后该会话的 mod 实例、定时器与外部进程全部撤销，其面板**不再**逐条发 `ui.close`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 无（返回值忽略）                                                                                                                                                                                                                                                   |
| `ui.close`                            | 一个**由 mod 打开**的面板被关掉、且 mod 实例还活着：用户按 `Esc` / 点 ×、mod 调 `$.ui.close`、`/reload-plugins`。`e.id` 是 pane id                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `{ deny }`：拦下这次关闭（`deny` 是字符串时当理由记进调试日志，`true` 也认）。**只有「用户按下去的那一下」问这个**：终端 `Esc` 与端点报上来的 × 关闭会等回执；`$.ui.close`、`/reload-plugins`、会话销毁不问，直接关（见「`ui.close`：mod 能拦下关闭」）            |
| `ui.press` / `ui.input` / `ui.select` | 用户用了 mod 画的一个控件（`Button` 点下去、`Input` 提交、`Select` 选中），**在控件自己的回调之前**触发；事件与 Claude Code 的 `UiPressArgument` / `UiInputArgument` / `UiSelectArgument` 同形：`plugin`（谁画的）、`element`（控件的 `key`）、`component`（`Pane` 或 `AbovePrompt`）、`requestId`（哪个实例，也就是 pane id）、`surface`，`ui.input` 另有 `kind`（我们只有提交一条通道，恒为 `"submit"`）与 `value`，`ui.select` 另有 `value`，见「控件的交互事件」                                                                                                                                        | `{ element?, value? }`：改写这次交互派给哪个控件、带什么值                                                                                                                                                                                                         |
| `ui.focus`                            | 焦点在面板里、用户按了 `↑` / `↓`：surface 把方向键算出的**候选落点**（下一个可聚焦控件的 `key`）先问一遍 mod，`e` 与 `ui.press` 同形（`element` 是候选落点）。改 `element` 往下交就是「接住这次方向键、把焦点放到这儿」，返回 `{}` 就是「接住但不动」，原样交下去就是「我不管」，由 surface 滚正文。`plugin` 同样是钉住的 matcher 键                                                                                                                                                                                                                                                                        | `{ element? }`：给了落点就是「接住并换焦点」，返回 `{}` 是「接住但不动」，原样 `next(e)` 或不返回才是「我不管」。宿主归一成 `{ handled, element? }` 交给 surface                                                                                                   |
| `ui.scroll`                           | 焦点在面板里、用户按了滚动键（`↑` / `↓` / `PageUp` / `PageDown` / `Home` / `End`）：surface 把这一下算出来的位移**先问一遍 mod**（`e.by` / `e.offset` / `e.contentRows` / `e.bodyRows`，见「`ui.scroll`：mod 自己滚」）。`plugin` 同样是钉住的 matcher 键，`{ requestId }` 可以把这条钉到某一块面板上                                                                                                                                                                                                                                                                                                       | `{}`：接住这一下（mod 自己挪窗口）。原样 `next(e)` 或不返回 = 我不管，surface 按自己的滚动模型走。宿主归一成 `{ handled }` 交给 surface                                                                                                                            |

`ui.render` 的事件要交给 `$.ui.resolve(e)` 换元素表（见下）；表外的元素名会被 `validateModTree` 拦下。

`ui.render` 的 `e.props` 是**站点给的版面事实**，字段按站点分，与 Claude Code 的 render sites 表逐项对齐：`Pane` 是 `title`、`isFocused`（键盘是不是在这块面板的正文里，与 `$.ui.panes()` 的同一个字段同源，见「面板的显示与焦点」）、`bodyColumns`（正文宽度，单位字符）、`placement`、`scroll`（`{ offset, bodyRows }`）、`view`；`AbovePrompt` / `AbovePromptList` 是 `hasSurvey` / `isCollapsed` / `isWorking`（都是 `false`，协议占位）、`maxRows`（这条带一次最多显示多少行）、`bodyColumns`、`scroll`、`view`。mod 按 `bodyColumns` 断行、按 `scroll.bodyRows` 决定要不要自己滚，比猜宽度稳。**不跨站点多给字段**：给 `Pane` 塞 `maxRows` 会让照 CC 写的 mod 在我们这里能跑、到 CC 上读到 `undefined`。

**桌面端与 IDE 端的数字由 surface 实测上报**：`e.viewport` 是**这一端有多大** —— `{ columns, rows, isFullscreen }`，`columns` / `rows` 是画布的字符宽高（按它所画字体的字宽 / 行高折算），`isFullscreen` 是「这一端有没有分屏」。三个字段与 Claude Code 同形，缺了就说明这个 surface 还没量到（不填 `false` 冒充测量结果）。surface 在请求树时把量到的字符宽高带上来（`modPanelRender` / `modBandRender` 的 `columns` / `rows` / `bodyColumns`），引擎把它原样填进 `e.viewport` 与 `e.props.bodyColumns`；`bodyColumns` 量的是**这块面板自己的宽**（dock 时右侧那一列、inline 与带时输入区那一列），窄到一列按钮摆不下时 mod 自己能换排布。surface 没报的字段按缺省值处理（正文 100 字符、面板 24 行、带 8 行），所以「宿主还没量到」不会让面板变空；`placement: "inline"` 时 `scroll.bodyRows` 是那个 **12 行**上限（见「在 IDE 插件里画」），dock 时仍是面板的行数上限。面板正文的行数另有一条通道：surface 报 `bodyRows`（`modPanelRender` 的第四个版面事实）时它就是 `scroll.bodyRows`，只有没报时才按上面那两条缺省值算 —— 它与 `e.viewport.rows` 不是一个数（后者是整块画布，前者只算面板正文）。

**终端这边量得到，就直接报真实值**：Ink 侧拿得到终端行列数，所以 `bodyColumns` 是这块区域的真实宽度（减掉边框）、`bodyRows` 与 `scroll.bodyRows` 是终端这块的实际可用行数（见「终端形态」的高度上限）—— 插件的窗口按它算，屏幕多高就画几行。插件在终端里按这两个数分页是准的，在桌面端与 IDE 端仍要按「可能比实际矮」来写。

**面板被关掉时有 `ui.close`**（`e.id` 是被关的那个 pane）。Claude Code 同样有这个名字 —— 它的首方插件在自己的 scan 声明里把 `ui.close` 列进可监听钩子，与 `ui.render` 并列。发完之后宿主内部清理（撤销该 pane 的回调表与登记，之后的请求不再返回树）。拦截只在**用户按下去的那一下**有意义（见下一节）。会话销毁时不逐条发它，只发一次 `session.end`（实例马上整体丢弃，逐条通知没有接收方）。mod 想确认面板还在不在，仍可用 `$.ui.panes()` 查。

用户交互**不走** `on`，而是写在元素自己的回调 prop 上（回调用 `key` 与元素绑定，不进树）：

| 回调                     | 触发时机                                                     | 返回值 |
| ------------------------ | ------------------------------------------------------------ | ------ |
| `Button.onPress()`       | 用户点了面板里的一个 `Button`                                | 忽略   |
| `Input.onSubmit(value)`  | 用户提交了面板里的一个 `Input`，`value` 是输入的字符串       | 忽略   |
| `Select.onSelect(value)` | 用户在面板里的 `Select` 选了一项，`value` 是那一项的 `value` | 忽略   |

`Select` 的选中值**不会**自动变成元素自己的 `value`：宿主只报「选了哪个」，下一帧画什么由 `ui.render` 的返回值决定（mod 想让它停在新的选中项，就把 `value` 一起写进状态）。这与 `Input` 提交后清空是同一条纪律 —— 控件的状态归 mod，不归 webview。

### `next`（钩子链往下交的那一帧）

`on(name, handler)` 的 handler 最后一个形参是 `next`。它本身**可调用**：`next(e)` 把这次事件交给链上的下一层（下一个 mod 的同名钩子，最后是引擎自己那一帧）；一次 handler 只能调一次，第二次当场报错（见「兼容社区 mod」）。除可调用，它还挂着几个只读成员，回答的是「我现在在哪条链上、已经跑到哪、还剩多少时间」：

| 成员            | 含义                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next.signal`   | `AbortSignal`：整条调用被放弃时 abort（用户中断、会话销毁、插件重载）。长等待挂在它上面，别自己轮询。                                                                                                                                                                                                                                                                                                                                                                       |
| `next.event`    | 这次派发的事件名（`"tool.call"` / `"classic.PreToolUse"` / `"ui.render"` …）。给「一个 handler 管多个事件」的写法分支与记日志用 —— 它答的是「我现在在哪个事件的链上」，不是 matcher 判定。                                                                                                                                                                                                                                                                                  |
| `next.is(p, e)` | `p` 是不是选中了这次派发：`next.is("tool.call", e)`、`next.is("classic.*", e)`。认的模式与我们 `on()` 认的**完全一致**（事件名，或 `"classic.*"`）；别的模式（CC 的 `"*"` / `"!tool.*"`）当场报错，不安静答 `false` —— 答 `false` 会让 mod 以为自己该管的活被别人接管了。                                                                                                                                                                                                   |
| `next.origin`   | 谁发起了这次派发：`{ plugin, tier }`。引擎自己发起是 `{ plugin: "engine", tier: "core" }`；某个 mod 用 `$` 主动进链（`$.tool.check` / `$.tool.call` / `$.prompt.suggest` 这些方法形态）是 `{ plugin: <那个 mod 的名字>, tier: "user" }`。链上的守卫靠它认出「这一次是插件自己来问的」，而不是模型真的要跑。                                                                                                                                                                 |
| `next.trace`    | 这条链上**已经跑完**的层（跨 mod 也算同一条链，别的 mod 跑完的层一样在这里），只读快照，读一次给一份（不含自己 —— 这一层还没跑完）。每条 `{ index, plugin, tier, event, outcome, ms }`：`index` 是「第几个跑完」（matcher 没选中的不算一层），`outcome` 只取我们**判得出来**的三档 —— `returned` 自己给了结果、`caught` 抛了但被 `.catch` 接住并给了结果、`rejected` 抛了没人接；`ms` 是**这一层自己**花的时间（`next()` 在飞、`$` 调用在等的那段本层的钟停着，不算进去）。 |
| `next.budget`   | **这个钩子这次派发**的时间预算，读一次算一次：`{ ms, remainingMs }`。`ms` 是这次派发的额度（5 秒），`remainingMs` 是此刻还剩多少（下限 0）。这个钟只算本层自己的时间：它调 `next(e)` 期间、调 `$` 期间都停表。不在链上时（钩子把 `next` 存下来、链早跑完了）报「没人计量」：`ms` 是 `0`、`remainingMs` 是 `Infinity`。                                                                                                                                                      |

- **`error` 与 `called` 只在 `.catch` 帧上，主帧没有**：`.catch(handler)` 的 handler 收到的那一帧多两项 —— `next.error`（这一层为什么失败）与 `next.called`（失败之前有没有调过 `next`）。所以「这个钩子有没有调过它」这个问题**只有**在 `.catch` 里问得出来；在主帧上写 `next.called` 读到的是 `undefined`，不要这么写。
- **`is` 判的是「哪条链」，不是「这个 `e` 是什么类型」**：运行时它只看这次派发的事件名，`e` 只是把类型收窄交给 TypeScript 的载体（CC 那边它就是个类型谓词）。所以它**不是** matcher 值判定 —— 「这个工具是不是 `Bash`」用 `e.tool === "Bash"`；`is` 也不认 `"*"`。
- **`origin` 只有 `core` 与 `user` 两档**：`core` 是引擎自己，`user` 是**所有** mod —— 我们这一版 mod 全在同一层，正好等于 CC 的 `user`。CC 另有 `prepend` / `append` / `builtin` 几档，那要一整套分层与让位机制，我们没有，也不会在这里给出别的值。同理 CC 的 `next.to(e, tier)`（跳到更深的某一层）不给：所有 mod 同层，跳层没有落点。
- **`next.origin` 与事件体里的 `e.origin` 同名不同义**：`e.origin` 只有 `prompt.suggest` 上有，说的是「这条建议是谁提的」（`{ kind: "plugin", name }` / `{ kind: "suggestion" }`）；`next.origin` 说的是「谁发起了这次派发」。别拿一个当另一个用。
- **`trace` 与 `budget` 是取值时现算的**：链还在往下跑、预算还在走，所以它们不能是构造时定下的常量；读它们不产生副作用，也不推进链。

**5 秒是每个钩子一次派发的，不是整条链共用一份。** 这是 Claude Code 的 `HookBudget` 口径（原文是 "A hook's budget per dispatch, from its call to its return"），它的 `NextBudget` 只在 `session.end` 那种「整个派发统一限时」的场合才指整条链。所以 A 的钩子 `next()` 到 B，B 拿自己的一份 5 秒，A 的钟在 B 跑的时候停着 —— 一条 N 个 mod 的链，总耗时可以是 N × 5 秒。

- **每个 mod 各拿一份**（同一个 mod 在同一次派发里注册了多个处理器时它们共享那一份，派发的边界是 mod）。宿主并列问不同 mod 的地方更是彼此独立的派发：`prompt.submit` 的注入、`turn.complete` 的上报那种「每个 mod 各问一次」就是并列的。
- **与 mod 无关的等待不计入**：`$.process` 等输出、`$.ui.ask` 等人按键、`$.model.complete` 整段都不占（见「问用户一个问题」「让模型替插件答一次」「外部进程」）。`$.clock.sleep` 算在内 —— 那是 mod 自己在等。
- **`next()` 在飞时停表**：下游有几个 mod、跑多久都不吃本层的额度，否则「A 交给 B、B 自己花 4 秒」会让 A 也吃 4 秒，A 读到的 `next.budget.remainingMs` 是个假数。停的那段从调用 `next(e)` 起，到它 settle（跑完 / 抛错 / 被取消）为止。
- **`.catch` 的兜底不计时**：预算到期后进入兜底，那时这一层的表已经停了，兜底跑在不再计时的状态里。（CC 在这里另给 1 秒宽限 `catchMs`，我们不给 —— 兜底本来就该短。）
- **超时只让这一层失败**，不影响别的层、也不影响别的 mod：各自的失败纪律照旧（`ui.render` 按「没有意见」、`tool.call` 按不表态放行、`tool.check` 按 `deny`）。

### 控件的交互事件（`ui.press` / `ui.input` / `ui.select`）

同一次交互还会**先跑一遍同名钩子**，再跑上面那些回调：`ui.press`（按了 `Button`）、`ui.input`（提交了 `Input`）、`ui.select`（选了 `Select` 的一项）。钩子在回调之前跑，所以 mod 能看见「用户按的是哪个控件、输入了什么」，再决定回调收到什么。

- **`e` 的形状**：`{ plugin, component, requestId, surface, element, kind?, value? }`，与 Claude Code 的 `UiPressArgument` / `UiInputArgument` / `UiSelectArgument` 同形。`plugin` 是画这个控件的 mod 自己、`component` 是**站点**（`Pane` 或 `AbovePrompt`，不是控件类型 —— 控件靠 `element` 认）、`requestId` 是这块面板的实例 id（pane id，带上是 `above-prompt`）、`surface` 是这次交互来自哪一端（`desktop` / `terminal` / `vscode`）、`element` 就是控件的 `key`；`kind` 只有 `ui.input` 带（我们只有提交一条通道，恒为 `"submit"`），`value` 只有 `ui.input` / `ui.select` 带。社区里按 `e.element` 认控件、按 `e.value` 读输入。
- **默认只对自己画的控件触发**：不写 matcher 的钩子只收到自己画的那个控件的事件；要看别人画的控件，matcher 写成 `{ plugin: "other-mod" }`（`"*"` 也行，等于「谁的都看」）—— 这是 Claude Code 的 matcher 语义：`plugin` 是这条事件上唯一被钉住的键。
- **返回 `{ element?, value? }` 改写这次交互**：`element` 换派给哪个控件，`value` 换回调收到的值。改写只对这一次生效，**不落进元素树** —— 下一帧画什么仍由 `ui.render` 决定。`element` 在那个 pane 里没有对应回调时按「没人接」丢掉并记一条 debug，不会串到别的 pane。
- **`value` 不合法就退回原值**：`ui.input` / `ui.select` 的 `value` 必须是字符串，别的形状（数字、对象）丢掉这一项并 warn，控件回调仍拿到用户原本的值。
- **三端一致**：桌面端、webview 与终端都发（终端里的输入/选择走同一条 `modPanelEvent`），没有 `prompt.edit` 那种「终端不发」的差异 —— 这里观察的是**已经发生的**一次控件操作，不与用户正在打字冲突。

#### `ui.focus`：方向键先问 mod

`ui.focus` 是同一族里的第四个（Claude Code 同名）：**终端里焦点在面板、用户按了 `↑` / `↓` 时**，surface 不自己决定这一下是「换选中项」还是「滚正文」，而是把方向键算出来的**候选落点**（下一个可聚焦控件的 `key`）发给插件问一句。

- **`e` 与 `ui.press` 同形**：`{ plugin, component, requestId, surface, element }`，`element` 是候选落点而不是「用户按下的控件」。`plugin` 是钉住的 matcher 键，语义与上面三条一致。
- **接住有三档**（判据与 Claude Code 一样：看这条链最后流下去的是什么）：`return next({ ...e, element })` 或直接 `return { element }` = 接住并把焦点放到这个 `key` 上；`return {}` = 接住但不动（不换焦点、也不滚正文）；原样 `return next(e)`（或什么都不返回）= 我不管。
- **不接 = 滚正文一行**：详情/正文型面板（diff 面板的详情视图）什么都不返回即可，surface 落到默认行为。
- **只在终端发**：桌面端与 IDE 端用指针，没有方向键焦点模型；`surface` 字段仍在（值为 `terminal`），别按「三端都会发」写。
- **不改元素树**：接住时插件自己决定要不要 `$.ui.invalidate` 把 `❯` 这类选中标记重画；返回的 `element` 只对这一次方向键生效。
- **surface 拿到的回执是 `{ handled, element? }`**：`handled` 为真就是「这一下方向键归 mod」（`element` 缺省表示原地不动、也不滚正文），为假就是没人接、surface 走默认滚动。给它 `element` 但那个 `key` 这一帧还不在树里时（插件顺手让窗口挪了一格、落点是下一帧才进来的行）surface 记下它，等下一帧的树到了再落上去。

#### `ui.scroll`：mod 自己滚

`ui.scroll` 是同一族里的第五个（Claude Code 同名）：**终端里焦点在面板、用户按下滚动键时**（`↑` / `↓` 走完 `ui.focus` 没人接之后，以及 `PageUp` / `PageDown` / `Home` / `End`），surface 把这一下算出来的位移先问一遍 mod，由它决定「这一下归谁滚」。

- **为什么要有它**：宿主自带的滚动层只能滚**整棵子树**，钉在底部的行（详情视图的键位提示）会跟着一起滚走。想「正文滚、提示钉住」只能由 mod 自己分页 —— 它的树永远只画一屏，宿主那层对它来说是空的。
- **`e` 是一次滚动的实数**：`{ plugin, component, requestId, surface, origin, by, offset, contentRows, bodyRows }`。`by` 是这一下要挪几行（正数往下），`offset` 是 surface 按自己的模型算出来的目标位置，`contentRows` / `bodyRows` 是它数到的内容行数与可见行数。`Home` / `End` 用 `by: ±Number.MAX_SAFE_INTEGER` 表达「到顶/到底」（Claude Code 的插件也是这么认的），mod 自己按它那份内容夹住。
- **接住只有一档**：返回 `{}` 就是接住（这一下归自己，记得 `$.ui.invalidate` 重画）；原样 `next(e)` 或什么都不返回就是我不管，surface 落到自己的偏移上（`↑`/`↓` 一行、翻页一屏、`Home`/`End` 到两头）。
- **只在终端发**：桌面端与 IDE 端由浏览器自己滚，没有这条事件；`surface` 字段仍在（值为 `terminal`），别按「三端都会发」写。
- **要把窗口算准就用 `e.props.scroll.bodyRows`**：那是这块面板正文这一帧真能画多少行（见「`ui.render` 的 `e.props`」）。用它算「一屏几行」，再把树裁到那一屏，提示行就钉在面板底边不动了。
- **`{ requestId }` 可以钉住面板**：一条 mod 开两块面板时，不写 matcher 只收到自己那几块的滚动；写了别人的面板名才会收到别人的。

#### `ui.close`：mod 能拦下关闭

Claude Code 的 `ui.close` 有返回值：返回 `{ deny }` 就不关。我们跟同一条：**终端里焦点在面板时按 `Esc`**，surface 先把这次关闭发给插件、等回执再决定收不收。

- **`{ deny }` 就是拦下**：`deny` 是字符串时当理由（记进调试日志，不弹给用户），`true` 也认；返回 `{}` / `undefined` / 原样 `next(e)` 都是「不拦」。形状不对（`deny: 42`）按不拦处理并记一条 warn —— 一个坏掉的 mod 不该把面板永久钉在屏幕上。
- **拦下之后 surface 什么都不做**：面板还在、焦点仍在面板里，`isShown` / `isFocused` 都不变。
- **典型用法是「返回上一级」**：详情视图里按 `Esc` 回列表（`return { deny: "back to the file list" }`），列表里再按 `Esc` 才真的收起来 —— 内置差异插件就是这么做的。
- **只有「等得起回执的那一下」问**：终端的 `Esc` 会等；`$.ui.close`、`/reload-plugins`、会话销毁不问（那是 mod 或宿主的决定，问了也没人能改主意），`ui.close` 在那几条路上仍是纯通知。
- **桌面端与 IDE 端不等回执**：那边的 tab × 关闭是乐观的（webview 先删 tab 再发 `modPanelEvent`），在这里拦下只会让下一次推送把 tab 又画回来。所以 `deny` 在那一端**没有效果**，关掉照旧、`ui.close` 只是通知。要让两端一致，得先让那两个端点改成「等回执再收 tab」。

### 轮次内外的事件（只读）

`prompt.submit` / `turn.start` / `turn.step` / `session.compact` / `session.end` / `ui.close` 六个事件回答「一轮对话里正在发生什么」「会话什么时候没了」。有返回通道的只有两个：`prompt.submit` 往上下文里塞文本、`turn.step` 改写这一次请求用的模型或推理强度；`ui.close` 另有一条「拦下这次关闭」的通道（见「`ui.close`：mod 能拦下关闭」），其余返回值一律忽略。

- **`prompt.submit` 只在用户敲的那条 prompt 上触发**：mod 自己经 `$.prompt.submit` 投进来的**不再触发**它 —— 否则 handler 里再 submit 一次就是无限环。触发点在「用户消息已进上下文、本轮第一个模型请求还没发出」之间，与 Claude Code 同一个位置（它的 `prompt.submit` 钩子在 `next(e)` 里跑完 `classic.UserPromptSubmit` 之后、请求发出之前）。
- **返回值只认 `context`**：`{ context?: string[] }`，字符串数组，合起来受限额（见「限额」）。宿主把它们当作**本轮**的附加上下文，在请求边界并入（与后台任务通知同一个注入点，见「轮次内注入」），模型下一个请求就能看到；不写进用户消息原文。
- **不改 `text`、不给 `drop`**：这两项是 Claude Code 同名事件另外两个返回值（改掉用户敲的话、或把这条 prompt 丢掉）。改/丢用户输入在这种「钩子跑在界面看不到的地方」的位置上没法让用户察觉，产品上不给插件。
- **`turn.start` / `turn.step` 的分工**：`turn.start` 一轮一次，在用户消息落库之后；`turn.step` 每发一次模型请求之前一次，`e.index` 从 0 起 —— 一轮里有 N 次请求（工具循环）就有 N 个 index。它同时带着这次请求的 `model` 与 `messageCount`（`effort` 有才带、`agentId` 只在子代理里），handler 可以写成 async generator：`yield* next(e)` 把下游接上来并转发它产出的块，`return { ...e, model }`（或 `next({ ...e, model })`）改写**这一次**请求 —— 宿主在这里是**等**的，答案落地之后才构造请求（CC 的 `turn.step` 是它仅有的两个 generator 事件之一，另一个是 `process.spawn`）。只认 `model`（必须非空字符串）与 `effort` 两项：`turnId` / `index` / `messageCount` 是宿主的事实，改不动。用户中断后不再有 step，`turn.complete` 带 `isAborted: true` 收尾。三者都带同一个 `turnId`（这一轮的身份，`$.turn.abort` 与 `classic.MessageDisplay` 认它）：Stop 钩子要求续跑、注入后台任务通知把循环重开，都还是同一轮，`turnId` 不变。
- **`session.compact` 在压缩完成之后**，`e` 是 `{ trigger: "auto" | "manual", tokensBefore, tokensAfter }`。`tokensBefore` 与 `$.session.usage()` 的 `context.tokens` 同一处（锚定最后一次请求的 usage，含系统提示词与工具 schema）；`tokensAfter` 只数压缩后新历史的消息文本 —— 压缩刚结束还没有新请求的 usage 可锚定，而被保留下来的那两轮仍带着压缩前的 usage，按同一处口径算会原样报回压缩前的数字（真机实测两者曾完全相等）。这一对是「压缩前的估算上下文」与「压缩后的历史文本量」，**不是**同一把尺子：上下文接近窗口时前者远大于后者，但窗口极小、历史本来就很短时，摘要本身可能比被折叠掉的内容更长，此时 `tokensAfter` 反而更大（探针实测 985 → 2248）。mod 要判断「省了多少」应把它当最近似值，不要当不变量。
- **`session.end` 是唯一一个宿主会等的**：会话销毁要先撤销 mod 实例，所以它必须在销毁之前跑完；仍受钩子预算的 5 秒约束，超时照常销毁。其余五个都是 fire-and-forget（抛错、超时只记一条 warn），也都不重放。

### 完成与审批的观察（只读事件）

第三方服务想把「对话答完了」「有张审批卡片在等」反映到自己的页面上（网页那边看到一个通知），用的就是这两个事件：它们只报告宿主**已经发生**的事实，不改变任何行为。

| 事件                        | 载荷                                                                                            | 触发边界                                                                                                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turn.complete`             | `{ turnId, isAborted, durationMs, answer, usage }`                                              | 一轮结束：答完或用户中断（Esc / 停止 / 插件 `$.turn.abort`）。`durationMs` 从这一轮开始处理到结束，`answer` 是最后一条 assistant 消息的正文，`usage` 是本轮所有模型请求的 token 合计；因 Stop 钩子要求继续、注入后台任务通知而重开的循环算**同一轮**，只在真正结束时触发一次（`usage` 也不从头再算） |
| `classic.PermissionRequest` | `{ session_id, transcript_path, cwd, hook_event_name, tool_name, tool_input, plan_file_path? }` | 一次工具审批即将弹给用户。权限规则自动放行或拒绝的不触发（没有卡片要显示），`PermissionRequest` 钩子把这次请求拒掉的也不触发                                                                                                                                                                         |

**与 Claude Code 的关系**（照它官方 mods 的 events 参考核过）：

- `turn.complete` 是**同名事件**（CC 的 Turns 分组里有 `turn.start` / `turn.step` / `turn.complete`），字段取 `isAborted` / `durationMs` / `answer` / `usage` 四个。**没有** `turnId` / `agentId`（我们只报主 agent 的轮次，子代理的嵌套轮次不报），也不实现返回 `{ text }` 在答案下面显示一行那个能力。
- `classic.PermissionRequest` 用 CC 的 `classic.` 前缀，因为 CC 把**每个** settings hook 事件都镜像成 `classic.<Event>`（`classic.Stop`、`classic.PostToolUse`…），`e` 就是那份 hook stdin JSON（snake_case，含 `transcript_path`）。载荷字段与 `PermissionRequest` 钩子收到的 stdin 一致；其余镜像见「影子事件」。
- 审批**不是** `tool.check`：那是 CC 里唯一能拿到并改写放行决定的钩子（`{ decision: allow | ask | deny }`），被 mod 拿去做「自动批准」时用户的卡片就形同虚设。这一批做它，但**只给收紧的半边**：`allow → ask/deny`、`ask → deny` 收，`deny → allow/ask` 不收（见「第二判定源」）。`tool.call` 仍只做那个**拦下**（`{ deny }`），「替用户批准」的通道两边都不给。
- 想在「工具跑完」那一刻做事，用 `tool.call` + `await next(e)`（见「拦下一次工具调用」）—— `next(e)` 就是执行，它 resolve 之后钩子里的下一行跑在工具结束之后。这是 CC 的写法（它的 `tool.call` 里 `next` 就是执行），我们没有另造一个「跑完了」的事件，也没有第二个入口。

四条约束：

- **只读**：两个事件的返回值都被忽略。`classic.PermissionRequest` **不是**审批通道 —— 批准、拒绝、记住规则都只能由用户在界面上做（或由既有权限规则决定），mod 无法替用户答。
- **`usage` 是本轮、`$.session.usage()` 是整场**：同名的 `tokens` 字段（`prompt` / `completion` / `cacheRead` / `cacheCreation`），作用域不同，别混用；`prompt` 两侧都**含**缓存命中的 token。
- **`turn.complete.usage` 同时给 Claude Code 的四个别名**（`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`，外加 `model`）：社区 mod 直接拿 `u.input_tokens` 做加法，缺一个就是 `undefined`、整条带画出 `NaN`。`input_tokens` 是 `prompt - cacheRead - cacheCreation`（**不含**缓存命中，与我们自己的 `prompt` 不是同一个数），所以是换算而不是改名。
- **不阻塞**：派发是 fire-and-forget，mod 在钩子里做网络上报不会卡住轮次收尾或那张审批卡片；钩子抛错、超时（5 秒预算）只记一条 warn，本轮照常结束、审批卡片照常弹出。
- **不重放**：两者都是瞬时事件，surface 后挂上来（切会话、webview 重建）不会补发 —— 它们是「此刻正在发生」，不是像 `$.ui.status` 那样的状态。

**怎么把它们送到自己的服务端**是插件自己的事：`$.process.spawn` 起一个 WebSocket 客户端、或 `$.http.fetch` 直接发 HTTP（见「外部进程」「发 HTTP 请求」），宿主不提供推送通道，也不替 mod 保存「发到哪」。

### 影子事件：`classic.*`

Claude Code 把**每个** settings hook 事件都镜像成 `classic.<Event>`，社区插件大量只写这一套 —— 语料里 49 个含 mods 源码的仓库中，`classic.PreToolUse`（10 仓）、`classic.Stop`（12）、`classic.SessionStart`（14）、`classic.MessageDisplay`（6）、`classic.PermissionDenied`（5）都在用得最多的那一档。这一批做两件事：把已有的 14 个镜像**逐字段对齐** CC 的 hook stdin（上一批有几处是照我们自己的形状合成的，插件按 CC 的名字读会拿到 `undefined`），再补 5 个（`classic.PreToolUse` / `classic.PermissionDenied` / `classic.PreCompact` / `classic.PostCompact` / `classic.MessageDisplay`）—— 连 `classic.PermissionRequest` 一共 **20 个**镜像。

共同纪律：

- **载荷是 CC 的 hook stdin 形状（snake_case）**，不是我们自己的 camelCase：公共五字段 `session_id` / `transcript_path` / `cwd` / `permission_mode` / `hook_event_name` 每条都带（`hook_event_name` 是不带前缀的事件名，例如 `"Stop"`），其余字段见下表。这五项就是 CC 的 `createBaseHookInput(permissionMode)` —— 权限模式是**每一条** hook stdin 都有的字段，不是某几个事件专属（社区守卫靠它判断「这一刻有没有人会被问到」，见「验收场景」最后一条）。
- **字段名与字段集照 CC，不自造**：插件是按 CC 的名字读的，多一个我们编的字段名（曾经的 `ok` / `description` / `status`）它读不到，少一个真字段它也读不到 —— 两种都让「已经装上的插件」静默不工作。所以每条事件给 CC 那一份的全集，我们拿不到的那几个写成可选（见「只能给近似」），**新造字段名一律不做**。唯一的形状例外是 `classic.PreToolUse`：CC 在自己 mods 面里也把它排掉（`E extends 'PreToolUse' ? ToolCallEnvelope : ClassicHookInputs[E]`），`e` 就是 `tool.call` 的 `ToolCallEnvelope`（`{ tool, tool_use_id, input }` + 顶层铺开参数），不是 stdin 那份 `{ tool_name, tool_input }`。
- **只读 + fire-and-forget**：返回值一律忽略，钩子抛错、超时（5 秒预算）只记一条 warn，与 `turn.complete` / `classic.PermissionRequest` 同一条纪律。例外只有三条：`classic.Stop` / `classic.SubagentStop` 的 `additionalContext`（宿主会等它，见「一轮收尾时的非错误反馈」）与 `classic.PreToolUse` 的 `deny`（它和 `tool.call` 是同一条链上的两个名字，见「拦下一次工具调用」）。
- **顺序**：同一时刻我们自有的事件先发、镜像后发（`turn.complete` → `classic.Stop`，`prompt.submit` → `classic.UserPromptSubmit`，`tool.call` 的 `next(e)` 已经把结果交回之后才发 `classic.PostToolUse`）。跨事件之间不承诺顺序，它们本来就各自代表不同的时刻。同样只有 `classic.Stop` 例外：它有返回通道，必须先在 `turn.complete` 之前拿到返回值（同上）。
- **不重放**：瞬时事件，surface 后挂上来（切会话、webview 重建）不补发。
- **`on("classic.*", handler)` 一次订阅全部**：CC 支持这个通配（GenesisTools 就是一条吃掉所有 classic 事件），我们把它展开成每一条镜像，**同一条登记**挂到每个名字下 —— 所以 `on(…).catch(fn)` 的兜底对每一条都生效，不会只兜住最后一个。带 matcher 不支持（`classic.*` 的镜像事件都不按字段筛，要筛就在 handler 里比 `e.hook_event_name`）。

| 事件                         | 触发时机                                                                                                                 | 额外字段                                                                                                                                                                                                         | 只能给近似 / 给不出的                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `classic.SessionStart`       | 会话初始化完成、`session.start` 之后                                                                                     | `source`：`startup` / `resume` / `clear`                                                                                                                                                                         | 我们没有分叉会话的入口，不会出现 `fork`                                                                                                                                                                                                          |
| `classic.SessionEnd`         | 会话销毁前、`session.end` 之后                                                                                           | `reason`：`clear` / `prompt_input_exit` / `other`                                                                                                                                                                | 取值与 CC 同名同义；我们没有 `logout` / `resume` 这两个入口，走到时按 `other` 报                                                                                                                                                                 |
| `classic.UserPromptSubmit`   | 用户审阅并提交一条 prompt，与 `prompt.submit` 同一时刻                                                                   | `prompt`                                                                                                                                                                                                         | 不改用户原文、不丢弃（与 `prompt.submit` 同一条理由）                                                                                                                                                                                            |
| `classic.InstructionsLoaded` | 一份指令文件被注入上下文                                                                                                 | `file_path`；`memory_type`：`Project` / `Local` / `User`；`load_reason`：`session_start` / `nested_traversal`                                                                                                    | `Managed` 给不出（我们没有企业托管设置层）；CC 另有 `path_glob_match` / `include` / `compact` 三种触发原因，我们没有对应入口                                                                                                                     |
| `classic.PreToolUse`         | 工具参数校验通过、**还没执行**、权限也还没问（与 `tool.call` 同一时刻）                                                  | `e` 就是 `tool.call` 的 `ToolCallEnvelope`：`tool` / `tool_use_id` / `input`，外加顶层铺开的一份参数；**没有** `hook_event_name`（CC 在 mods 面里也是这么排的）                                                  | 只认 `{ deny }`。CC 另外三种答复不做：`{ allow: true }`（不弹审批直接放行）、`{ ask }`（强制弹一次卡片）、`updatedInput`（改写参数）—— 前两个见「交付分层」里的第二判定源                                                                        |
| `classic.PermissionDenied`   | 一次工具调用被权限**拒**掉之后（命中 deny 规则、模式自动拒、用户点了拒绝、没人能问）                                     | `tool_name` / `tool_input` / `tool_use_id`；`reason`：`denied_by_rule` / `denied_by_mode` / `no_permission_prompt` / `user_denied`                                                                               | `reason` 这一格 CC 也是宿主自定的短码（它自己给的是 `host_exit` 这类），所以我们的取值不与它逐字相同；CC 的 `{ retry: true }`（插件告诉模型「可以重试」）不收                                                                                    |
| `classic.PostToolUse`        | 一次工具调用**成功**返回之后                                                                                             | `tool_name`, `tool_input`, `tool_use_id`, `tool_response`（按限额截断，见下）, `duration_ms`                                                                                                                     | 不改模型看到的结果（CC 的 `updatedToolOutput` / `updatedMCPToolOutput` 不做）；`mcp_server` 没给（这一层不区分工具来源）                                                                                                                         |
| `classic.PostToolUseFailure` | 一次工具调用失败或被拒之后                                                                                               | `tool_name`, `tool_input`, `tool_use_id`, `error`, `duration_ms`                                                                                                                                                 | 同上；`is_interrupt` 没给（被中断与被拒绝在结果里是同一类失败，分不出来）                                                                                                                                                                        |
| `classic.PostToolBatch`      | 同一次模型响应里的**一批**工具调用全部跑完之后                                                                           | `tool_calls: [{ tool_name, tool_input, tool_use_id, tool_response? }]`                                                                                                                                           | `tool_response` 与单条那个同一份截断；「一批」按一次响应算，不是上面为了并发切出来的小块                                                                                                                                                         |
| `classic.Notification`       | 一次审批**即将**弹给用户（与 `classic.PermissionRequest` 同一时刻）                                                      | `notification_type`：`permission_prompt`；`message`                                                                                                                                                              | 只发这一类。`$.ui.ask` 的提问卡片**不**发 —— CC 对提问不发通知，它的取值表（`permission_prompt` / `idle_prompt` / `auth_success` / `elicitation_*`）里没有对应名字，编一个表外的只会让按真名字过滤的插件（done-waiting-ping）永远不触发          |
| `classic.SubagentStart`      | 一个子代理起来                                                                                                           | `agent_id`, `agent_type`                                                                                                                                                                                         | 返回值（CC 的 `additionalContext`）不收                                                                                                                                                                                                          |
| `classic.SubagentStop`       | 子代理**每次**收尾（答完 / 用户中断 / 被 settings 钩子拦停后重来一次也算一次，见下）；出错与中止路径在实例释放时补报一次 | `agent_id`, `agent_type`, `stop_hook_active`（这一轮是不是已经被要求续过，与 `classic.Stop` 同一口径）, `last_assistant_message?`, `agent_transcript_path?`（只有跑在后台、有日志文件的子代理才给）              | 支持返回 `{ additionalContext }` 让子代理再跑一轮；`background_tasks` / `session_crons` 不给（子代理作用域里没有）；`{ decision: "block" }` 与 `preventContinuation` 不收；出错 / 中止路径补报的那一次 `stop_hook_active` 恒 `false`             |
| `classic.PreCompact`         | 上下文压缩**开始之前**（撞阈值自动压与 `/compact` 都走这里）                                                             | `trigger`：`auto` / `manual`；`custom_instructions`：`/compact` 带的那段指令，没有时是 `null`                                                                                                                    | CC 的 `block`（插件否决这次压缩）不支持 —— 我们这条是纯观察                                                                                                                                                                                      |
| `classic.PostCompact`        | 上下文压缩**完成之后**（与 `session.compact` 同一时刻）                                                                  | `trigger`；`compact_summary`：这次生成的摘要正文                                                                                                                                                                 | 想知道「省了多少」看同一时刻的 `session.compact`（`tokensBefore` / `tokensAfter`），别从这个字段推                                                                                                                                               |
| `classic.PostModelSwitch`    | `Agent.setModel` 被调（会话的模型被换掉）                                                                                | `from_model`, `to_model`, `context_tokens`（换之前那一刻的上下文估值，与 `$.session.usage().context.tokens` 同一处）, `cache_ttl`                                                                                | `cache_ttl` 恒 `null`：我们不做提示词缓存的 TTL 记账，给个假数字比给 `null` 更坏；`requested_model` / `source` / `prompt_cache_warm` / `pricing` / `estimated_cache_write_usd` 没给 —— `/model` 与界面上的模型选择器走到同一个入口，分不出调用方 |
| `classic.Stop`               | 模型停下来、这一轮可能要收尾时（答完或用户中断，在 `turn.complete` 之前，见下一小节）                                    | `background_tasks`：还在跑的后台任务对象数组（`id` / `type` / `status` / `description`，没有时是 `[]`）；`stop_hook_active`：这一轮是不是已经被要求续过；`last_assistant_message`：最后一条 assistant 消息的正文 | 支持返回 `{ additionalContext }` 让模型再跑一轮；`{ decision: "block" }` 与 `preventContinuation` 不支持                                                                                                                                         |
| `classic.StopFailure`        | 一轮**因错误**结束                                                                                                       | `error: { kind, message }`，`kind` 取我们自己的错误分类（`rate_limit` / `server` / `network` / `timeout` / `auth` …，即遥测的 `ErrorCategory`）                                                                  | `kind` 是那张闭集里的值，不是 CC 的 `overloaded` / `api_error` 那一套                                                                                                                                                                            |
| `classic.CwdChanged`         | 会话**会动的工作目录**变了（Bash `cd`、进/出 worktree）                                                                  | `old_cwd`, `new_cwd`                                                                                                                                                                                             | 只报这一个目录（见「会话事实」里的三个目录），工作区根与会话起点变了不算                                                                                                                                                                         |
| `classic.MessageDisplay`     | 一条 assistant 消息**收尾时**（与 `turn.complete` 无关：一轮里每条回答各一次）                                           | `turn_id`, `message_id`, `index`（恒 `0`）, `final`（恒 `true`）, `delta`（这条消息的完整正文，按限额截断）                                                                                                      | 我们不分 flush：CC 每攒够几行派发一次、`index` 递增、`final` 只在最后一次为真；我们一条消息只给一次全文。CC 的 `displayContent`（替换用户看到的文本）不收                                                                                        |

- **matcher**：`classic.PostToolUse` / `classic.PostToolUseFailure` 认 `{ tool_name }`，`classic.PostToolBatch` 认 `{ tool_name }` / `{ tool_calls }`（这三条是 CC matcher 键表里对这个事件列的全部键），`classic.PreToolUse` 认 `{ tool }`（与 `tool.call` 同一套），其余 `classic.*` 不带 matcher，传了按既有纪律 warn 并忽略这一条。
- **`classic.SubagentStop` 可能不止一次**：子代理被 `additionalContext` 续跑（或被 settings 的 `SubagentStop` 钩子拦停）之后再收尾，会再派发一次，那一次的 `stop_hook_active` 是 `true`。所以别按「`SubagentStart` / `SubagentStop` 一对一」给子代理记账（Claude Code 也是这个形状）；要「这个子代理彻底结束了」的信号时没有别的，只能按最后一次收尾算。与 CC 唯一的偏离是**出错与中止路径也补报一次**（那一刻没有收尾可言，`stop_hook_active` 给 `false`）：我们承诺所有结束路径都有通知，缺了它插件在失败路径上就聋了。
- **`tool_response` / `delta` 截断**：与 `$.ui.log` 单条同一个口径（超过「限额」里的上限就截断并加省略号），`classic.PostToolBatch` 里那几份、`classic.MessageDisplay` 的 `delta` 都算。CC 给的是全文，我们这一处是**刻意的偏离**：一次 `Read` 可以几 MB，把它整份跨沙箱边界递给每个插件，是让「观察」变成「拷贝」。
- **不做的返回通道**（都是改行为，不是观察）：`classic.Stop` 的 block 与 `preventContinuation`、`classic.UserPromptSubmit` 的 `drop` 与改文本、`classic.SubagentStart` 的 `additionalContext`、`classic.PostToolUse` 的 `updatedToolOutput`、`classic.PreToolUse` 的 `allow` / `ask` / `updatedInput`、`classic.PermissionDenied` 的 `retry`、`classic.PreCompact` 的 `block`、`classic.MessageDisplay` 的 `displayContent`、`classic.SessionStart` 的 `hookSpecificOutput`。
- **仍然不做**：`ui.message`（元素事件，和 `ui.press` / `ui.input` 一家，需要可交互元素）。它不是广播，单独立项。`session.append` 已做（见「转录写入前改写」），粒度按我们的一条消息、不按 CC 的一行。

### 一轮收尾时的非错误反馈（`classic.Stop` / `classic.SubagentStop` 的 `additionalContext`）

模型停下来之后、这一轮真正收尾之前，`classic.Stop` 的钩子可以返回 `{ additionalContext: string[] }`：这不是错误、也不是拦下用户，而是「还有一件事没做」的提醒 —— 宿主把它读进对话、**这一轮不收尾**、再跑一轮。社区里靠这条通道的自查类插件（cys 对着自己的改动再核一遍、watchducks 盯用户的要求有没有被满足）不接这条就完全是白装：它们的全部逻辑就是「发现不对就提醒一句，让模型接着改」。

子代理那条（`classic.SubagentStop`）是同一件事落在子代理自己的一轮上：子代理要收尾时插件同样能把它拦下来、喂一句话回去、让它接着跑 —— 这正是 Claude Code 的 `SubagentStop` 钩子做的事（它和 `Stop` 共用一份 stdin 与同一条续跑路径），只做观察的话，「子代理扫完一遍就说没事了」这类插件也没法纠正它。

- **只收 `additionalContext`**（字符串数组，空串丢掉）：多个 mod 按加载顺序拍平、用空行拼成**一条** meta 消息（与后台任务通知同一种消息 —— 模型看得到，界面上不是用户说的话），条数与字数沿用 `prompt.submit` 那份限额。两条事件用同一份限额与同一套拍平规则。
- **注入到谁的对话里**：`classic.Stop` 进主对话；`classic.SubagentStop` 进**那个子代理自己的**对话（它的下一轮请求看得到，父代理看不到这一段）。
- **续跑的那一轮**里 `stop_hook_active` 是 `true`：插件据此认出「这一轮是我要求续的」，自己收手；首次收尾是 `false`（名字与语义都照 Claude Code）。两条事件同一口径 —— 一个子代理的收尾被 `additionalContext`（或 settings 的 `SubagentStop` 钩子）续过之后，它下一次收尾的 `stop_hook_active` 就是 `true`。
- **上限 8 次**：同一条用户 prompt 里因 `additionalContext` 续跑最多 8 次（Claude Code 的 `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 默认值），到顶之后收到的 `additionalContext` 丢弃并记一条 warn、这一轮照常结束 —— 插件写得再贪也不会把用户困在死循环里。子代理按它自己那一轮计（它有自己的计数器，不与主会话的 8 次共享）。
- **不收两项**：`{ decision: "block", reason }` 与 `preventContinuation` 仍然不支持（一个是「拦下模型」的另一套说法，一个是强制终止），返回了只记一条 warn 并忽略。两条事件都是这样：唯一开的返回值口子是 `additionalContext`。
- **中断与排队优先**：用户按 Esc 收尾的那一轮、以及收尾时已有用户消息在队列里等着的，都不续跑（排队的消息下一轮再说 —— 插进来续跑会把它饿死）。子代理沿用同一条纪律（它被中止、或父会话里有用户消息在排队时也不续跑）。因错误结束的一轮发的是 `classic.StopFailure`，没有这条通道；子代理出错 / 中止走的是「实例释放时补报一次」，那次也没有返回通道。
- **失败/超时**：与只读镜像同一条纪律 —— 某个 mod 抛错或超时（5 秒预算）只记一条 warn，其余 mod 的反馈照收；一个都没有时与原来完全一样（一次请求就收尾）。

### 拦下一次工具调用（`tool.call`）

危险命令守卫类插件（社区里的 blast-radius / risky-hold / warden 这一族）要的是同一件事：**在工具跑之前**看一眼参数，判断该拦就拦，该问就问。「问」由 `$.ui.ask` 提供，「拦」就是这里的 `{ deny }`。

- **触发点**：参数已通过 schema 校验（非法参数不进钩子，模型直接拿到校验错误），工具**还没执行**、权限**也还没问**。因此被 deny 的调用不会弹审批卡片 —— 用户看到的是「插件拦了」，不是「审批被拒了」。
- **`e` 的形状**：`{ tool, tool_use_id, input }`，并把工具参数**在顶层铺一份**（`e.command` 就是 Bash 的 `command`）。这是 Claude Code 的 `ToolCallEnvelope` 形状，社区插件读写的是 `e.command` / `e.file_path` 而不是 `e.input.command`。
- **matcher**：`on("tool.call", { tool: "Bash" }, handler)`，`tool` 可以是字符串或字符串数组（`["Bash", "PowerShell"]`）。不写 matcher 收所有工具。
- **放行 = 调 `next(e)`**：它继续把这次调用交给**下一个 mod** 的同名钩子，最后一个交回引擎执行（先过 `settings.json` 的 PreToolUse）。链上没人 deny 就照常跑。`next(e)` resolve 之后，钩子里的下一行跑在工具**结束之后** —— 「跑完再刷新」用的就是这个位置（`const r = await next(e); await refresh();`）。`next.signal` 在整条调用被放弃时 abort（用户中断、会话销毁），长等待应该挂在它上面；`next.event` / `next.is` / `next.origin` / `next.trace` / `next.budget` 是这一帧上另外几个只读成员，`error` 与 `called` 只在 `.catch` 帧上（见「`next`」）。
- **拦下 = 返回 `{ deny: string }`**：这次调用**不执行**，模型收到这段文本作为工具错误结果（与「参数不合法」同一形态），排在它后面的 mod 钩子不再跑。文本要写成给模型看的行动建议（「先问用户，或用更安全的形式」），因为用户看不到卡片、只能从对话里看到模型重试。
- **抛错 / 超时（5 秒预算）= 不表态**：宿主记一条 warn 并**放行**，与只读事件同一条纪律 —— 钩子挂掉不该让用户的对话卡在「工具既不跑也不拒」。要 fail-closed 的守卫用 `on(...).catch((next) => …)` 自己返回 `{ deny }`（社区插件正是这么写的）。
- **多个 mod**：按加载顺序串行，第一个 `{ deny }` 生效。同一个 mod 注册多条（不同 matcher）时按注册顺序跑。
- **`{ result }` 是这次调用的结果**：两个来源同一个形状 —— `next(e)` 走到链尾真的跑了一次，得到 `{ result }`；mod 也可以不看 `next` 自己造一份（CC 同口径，拿到 `next()` 的结果再改写是它的正常用法）。宿主只认「这次调用的结果是什么」，不再按工具归属筛。`next(e)` 里的执行**先过 `settings.json` 的 PreToolUse**，所以它不能用来绕过用户的拒绝。
- **不做的两件事**：改写参数（CC 的 rewrite，会把用户以为要跑的命令换成别的）与替用户批准（`tool.check`）。前者不给，后者见「完成与审批的观察」。
- **`classic.PreToolUse` 是这条链的另一个名字**：同一时刻、同一份 `ToolCallEnvelope`、同一个 `{ deny }` 返回值，先跑 `tool.call` 再跑它（前者已经拦下就不再问后者）。CC 把两者做成两层（`tool.call` 在 mods 面、`classic.PreToolUse` 是 settings 钩子的镜像），社区里只写后者的一半（chronicle 的注释写得很直白：「only the classic result can ask」）；我们让两个名字落到同一条链上，插件写哪个都拦得住。它的 `{ allow: true }` / `{ ask }` / `updatedInput` 三种答复不做 —— 允许绕开审批与强制弹卡片都是第二判定源，见「交付分层」。

### 第二判定源（`tool.check`）

`tool.call` 是**我们自己的链上**第一次拦，`tool.check` 是在**权限规则与模式已经给出结论之后**插一脚。Claude Code 的定位是「Claude Code decides whether a tool call may run, after the `tool.call` and `PreToolUse` hooks」——`next(e)` 解析到的就是那个决定，钩子可以换掉它。

落点是 `PermissionManager.checkPermission()`：`tool.call` 链与 `classic.PreToolUse` 链都放行之后，规则（deny / allow 列表、权限模式）先算出决定，再把这份决定交给 `tool.check` 链。钩子拿到 `e = { tool, tool_use_id, input, agentId?, isReadOnly?, decision, reason? }`，`next(e)` 原样传下去，返回 `{ decision, reason? }` 换掉它。

**三个方向都算数，包括放宽。** `allow → ask`、`allow → deny`、`ask → deny` 是收紧；`deny → allow`、`deny → ask` 是放宽 —— 两者都接受。这不是「随便让它放过」：CC 的类型文档写的就是「return any `{ decision }`」，官方示例是 `on("tool.check", { tool: "Read" }, () => ({ decision: "allow" }))`；真插件的主要用途恰恰是放宽（sotto 用它给自家的 `mcp__sotto__*` 工具免审批）。把放宽挡掉会让这条钩子对它最现实的用法失效，也会让插件作者以为放宽生效了而实际没生效。收紧与放宽的**理由不同**：收紧不撤销任何已经到手的授权，放宽是 mod 替用户放行 —— 后者是插件作者对自己会话的一个明确选择（插件是用户自己装的，`settings.json` 里能看见），我们只在**非法返回值**（不是三个字符串之一）、抛错或超时时按 `{ decision: "deny" }` 处理并记 warn —— 与 CC 的 `Jn["tool.check"]` 同一条默认（答复不可用就不放行）。这是本事件唯一 fail-closed 的地方，与其余只读钩子的 fail-open 不同。

`decision: "ask"` 在我们这里的含义是「这张卡片必须弹」：`dontAsk` / `bypassPermissions` 下原本不弹，插件抬成 `ask` 就弹。`agentId` 只在子代理的调用上有；`isReadOnly` 只在工具自己报了只读时出现（不出现即「不是只读」，不是 `false`）。

唯一的例外是**本身就是提问**的工具（`AskUserQuestion` / `ExitPlanMode` 那一类，`USER_INTERACTION_REQUIRED_TOOLS`）：它们没有「不问就跑」的形态，放宽成 `allow` 等于让宿主去执行一个没有答案的提问。所以这一类只接收紧（插件仍能拒），放宽按宿主的 `ask` 走 —— 这条比 CC 更保守，理由不是「防插件」而是「放宽之后那个工具没法完成它的语义」。

返回 `{ decision: "deny" }` 之后模型收到的错误文本是 `reason`（没给就用一句固定的「被插件拒绝」），与 `tool.call` 的 `deny` 落在同一个位置。

### 主动问一次工具面（`$.tool.check` / `$.tool.call`）

`tool.check` / `tool.call` 各有一个**方法形态**，让 mod 在不真的跑工具的前提下问一句：

| 方法                             | 参数                                                  | 返回                                                                                              |
| -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `$.tool.check({ tool, input? })` | `tool` 是工具名（模型看到的那个），`input` 是这份参数 | `Promise<{ decision, reason? }>`：跑一遍 `tool.check` 链得到的决定                                |
| `$.tool.call({ tool, input? })`  | 同上                                                  | `Promise<{ deny?: string }>`：跑一遍 `tool.call` + `classic.PreToolUse` 链，有人拦就是 `{ deny }` |

- **两条都不执行工具**：只是跑链。`tool.call` 的 `next(e)` 在 mod 主动发起时**没有宿主侧执行体**（那个执行体只在模型真的要调用时才有），链尾是空对象 —— 想真的做事用 `$.process` / `$.fs` / `$.http`。这也是 Claude Code 的形状：它的 `$.tool.call` 同样是「跑一遍那个事件」，不是「执行工具」。
- **`tool.check` 的基底是 `allow`**：没有真实调用就没有宿主的决定，方法按「还没人拦」起算，链上只会让它更严或更松。要看真实决定得在 `tool.check` 事件里看 —— 那时 `decision` 是规则与权限模式算出来的。
- **`tool_use_id` 是宿主编的临时值**：这不是一次真实调用，事件里那个 id 只为形状一致，别拿它去对 `$.ui.notice`。
- **matcher 照旧生效**：`on("tool.check", { tool: "Bash" }, …)` 只在这份 `tool` 是 `Bash` 时才被叫起来，与真实调用同一个判定。

### 系统提示词与附件（`prompt.compose` / `prompt.section` / `prompt.context` / `prompt.attachment`）

这四个事件改的是**模型读到、用户看不到**的文本，落点各不相同：

| 事件                | 落点                                            | 频率              | 返回                                 |
| ------------------- | ----------------------------------------------- | ----------------- | ------------------------------------ |
| `prompt.compose`    | `buildSystemPrompt()`（`src/prompts/index.ts`） | 每轮一次          | `{ sections }`：整份系统提示词的段表 |
| `prompt.section`    | 同上，逐段                                      | 每个命名段一次/轮 | `{ text }` / `{ text: null }`        |
| `prompt.context`    | 会话的第一条消息                                | 每条会话一次      | `{ blocks }`                         |
| `prompt.attachment` | 宿主自己往对话里加一条消息的位置                | 每次一条          | `{ text }` / `{ text: null }`        |

**「一轮一次」怎么算**：一轮里工具循环会连着发好几次请求，`prompt.compose` 与逐段的 `prompt.section` 只在这一轮第一次问，后面几步复用同一份结果（带时间戳/计数器的插件才不会让同一轮各步的系统提示词不同，缓存前缀也就不被打断）。只有**宿主自己的**段表变了才会再问一次 —— 典型是一轮中间 MCP 拨号换了可达工具。

**`prompt.section` 的前提是「命名段」，我们现在没有。** `buildSystemPrompt()` 现在拼出的是 `[staticText, dynamicText]` 两个整块字符串（前者 cacheable、后者不），段内部靠 `\n\n` 串起 `SECURITY_NOTE` / `URL_GUARD` / `SYSTEM_PROMPT` / `DOING_TASKS_PROMPT` / `EXECUTING_ACTIONS_PROMPT` / `buildUsingToolsPrompt(tools)` / `TONE_AND_STYLE_PROMPT` 与动态的环境、记忆块。`prompt.section` 的 `e.name` 无处可指。所以这一批先把它们各自命名成段（`identity` / `security` / `url-guard` / `system` / `doing-tasks` / `executing-actions` / `tools` / `tone` / `env` / `memory` …），`buildSystemPrompt()` 的返回从「两个块」变成「按段拼」。

**代价是提示词缓存**：现在是「静态块整块 cacheable」，拆段之后要么按段各自缓存、要么整份不再缓存。这一批取**按段缓存** —— 段表按 `id` 排序稳定、`scope` 标记哪些段属于可缓存前缀，拼出来的字符串与今天逐字相同；`prompt.section` 改过某一段时，从这一段起往后的缓存断掉（与 CC 的 `breakPromptCache` 同一个后果，但我们不给那个字段：改了就断，不额外声明）。一段都没改时，拼出来的前缀与今天完全一致，缓存命中率不下降。

`prompt.compose` 的 `sections` 是**这一次实际要发出去的段表**（已含各段钩子的结果），`scope` 取 `"shared"`（跨轮不变的共享段，排在最前）或 `"session"`（本场会话，排在最后）—— 与 CC 的两档同义。`prompt.compose` 自己返回的 `sections` 会被下游的 `prompt.section` 再问一遍 —— 顺序与 CC 一致：先 `compose` 定段、再逐段 `section`。

`prompt.context` 与 `prompt.submit` 的 `{ context }` 不是一回事：后者每轮都能塞、只作用于**本轮**；前者一条会话只有一次机会、作用于**整场**（落点是第一条用户消息旁边的上下文块，与「会话开始的附加上下文」同一处）。

`prompt.context` 的块形状照 CC：`{ blocks: [{ name, text }] }`，`name` 是来源标记（给人看、进日志），`text` 才进模型上下文 —— lossless-claude 写的就是 `{ blocks: [...blocks, { name: "lcm", text }] }`。裸字符串块也收（来源名记作 `context`），但 `next(e)` 交下去的永远是 `{ blocks }`，不是裸数组。

`prompt.section` 与 `tool.check` 一样**接受 matcher**（`{ name }`）：只想管「记忆段」的插件没必要在每一段上被叫起来，lossless-claude 就是 `on("prompt.section", { name: "memory" }, …)`。交下去和 `next(e)` 解析到的都是 `{ text }` 对象（不是裸字符串）—— 同一族的写法是 `const s = await next(e); return { text: s.text + … }`。`prompt.attachment`（`{ type }`）与 `skill.prompt`（`{ skill }`）同样接受 matcher，取值就是 CC 类型文档示例里的那两个（`on("prompt.attachment", { type: "todo_reminder" }, …)` / `on("skill.prompt", { skill: "commit" }, …)`）。

**`prompt.compose` 的 `scope` 只有 CC 那两档**：`shared` 与 `session`。宿主自己那些「每轮重算」的段（环境、记忆）也标 `session` —— 缓存前缀怎么切是宿主的事，不通过插件可见的 `scope` 表达（CC 用 `prompt.section` 的 invalidator 做同一件事，我们没有那个入口就不发明第三档）。

`prompt.attachment` 的 `e.type` 是我们自己的分类，但**与 CC 同名的那两个逐字照抄**：`nested_memory`（子目录 AGENTS.md）、`agent_mention`（@子代理提醒）—— 名字差一个分隔符，按真名字过滤的插件就匹配不上。其余是我们自己的：`memory`（AGENTS.md 注入）、`session-start`（SessionStart 钩子的附加上下文）、`background-task`（后台任务通知）。返回 `{ text: null }` 让这条不出现 —— 这是**唯一**能让插件压掉一条宿主消息的通道，所以只给文本，不给「改消息的其它字段」。

### 给工具、技能、命令写描述（`tool.describe` / `skill.prompt` / `command.describe`）

三个事件改的是**模型读到的说明文本**，不改任何行为：

- **`tool.describe`**：落点是 `ToolManager` 组装工具 schema 的位置（`config.function.description = tool.prompt(args)` 那一处）。**每个工具每场会话问一次**，返回 `{ description, isDeferred?, breakPromptCache? }`：描述与放置都在**组装这次请求之前** `await` 拿定（插件给的值当次请求就生效，与 `command.describe` 同一条时机），问过的这一份随后锁进会话、之后每次请求都用它；只有 `breakPromptCache: true` 才让存的那份失效、下次组装重问（另一种等效写法是之后调一次 `$.ui.invalidate("tool.describe")`：返回值那次已经赶不上了，事后通知宿主作废就是这个入口）。锁住是硬要求：工具 schema 每轮都要发给模型，重问一次就重写一次缓存前缀，插件的时间戳/计数器会把前缀打断（CC 的 `breakPromptCache` 就是为这个加的）。

  `isDeferred` 翻转的是**延迟判定表对这一个工具的结论**（平铺还是进 `REPL` 池，见 `docs/specs/core/repl-tool.md`）：`true` 进池、`false` 回平铺。引擎先按判定表算出默认走向，插件给的值是最终值——连 `alwaysLoad` 与非延迟名单也能翻，与 CC 同一条（唯一翻不动的是结构豁免：`REPL` 自己永远不进池）。**没有池的时候**（`enableRepl: false`，或这台宿主没有 REPL）`isDeferred: true` 无处可去，保持平铺并记一条 warn，不得凭空把工具下架。池内工具同样会被问一次：它们的描述不进 `tools[]`（本来就不进），只参与搜索打分与放置。

- **`skill.prompt`**：技能正文被展开时问一次，返回 `{ text }` 换掉正文。`e` 给 `{ skill, text, source?, path? }`；`source` 取 `builtin` / `plugin` / `project` / `user`，`path` 是技能文件（没有文件的内置技能不给）。
- **`command.describe`**：命令列表每次要画时每个命令问一次，**`await` 完再画**（与 CC 同一条：插件给的描述当次就生效，不是下一次）。返回 `{ description, argumentHint, isHidden }`，三个字段都可选、只覆盖给了的。`isHidden` 只影响列表里显不显示，不影响能不能执行。

三者的时机**不一样**，别按同一条记：`tool.describe` 每场会话一次、组装前 `await`（这次请求就用新值，之后锁住；要换就在返回里给 `breakPromptCache`，或事后 `$.ui.invalidate("tool.describe")`）；`command.describe` 每次画列表都问、且 `await` 完再画；`skill.prompt` 每次展开都问（技能正文不缓存）。`tool.describe` 之所以存一份，是因为工具 schema 每轮都要发给模型：同一次请求里不可能既有描述 A 又有描述 B，而每轮都重问会让插件的时间戳/计数器把提示词缓存打断。

### 转录写入前改写（`session.append`）

落点是 `MessageManager` 写转录的那一处（`appendMessages`）。**每次要存下一行**之前问一次，`e = { message, uuid, door, agentId? }`：`message` 与 `$.session.messages()` 里的同形，`uuid` 就是 `message.id`（CC 的字段名，插件按它回查自己记的那份），`door` 是这一行的来源、取 CC 的名字：`prompt`（用户敲的那句）/ `response`（assistant 回答）/ `tool-result`（工具结果）；`agentId` 只在子代理落库时出现。CC 另有 `tool-message` / `command` / `notice` / `compaction` / `delivery` / `hook-context` / `attachment` / `queue` / `note` 九档，我们没有对应的行（压缩摘要走 `compact` 块、本来就不问这条通道；宿主注入的行都是 `isMeta`，不进 `$.session.messages()`，也不过这条通道），所以不会出现 —— 插件按 `door` 过滤时，我们给的值都在它认得的集合里。返回值里同样带 `uuid`（`{ message, uuid, deny? }`），插件按 `r.uuid` 串联 —— lossless-claude 的 shadow 就是这么读的。

**`note` 这一档刻意不给，别按「宿主自己塞进去的行」放回来**：CC 的 `note` 专指**插件自己**经 `$.session.append({ message })` 写进会话的那一行（引擎把 `door` 置 `note`、`origin` 置调用它的插件、`uuid` 新发一个），而那个写入口我们没做；CC 里宿主注入的行归 `attachment` / `hook-context`。曾把 `note` 当「宿主注入行」写进类型与本节，是同名反语义，已纠正并删掉。

- 返回 `next({ ...e, message })` 换掉这一行的文本块。可改的只有 `text` 块与 `tool_result` 块的 `content` —— 改别的字段（`role`、`tool_use_id`、块类型）当场报错，与 CC 同一个口径。
- 返回 `{ deny: reason }` 不存这一行（记一条 info，model 侧看不到这一行存在过）。
- **粒度是我们的，不是 CC 的**：CC 的「一行」是它自己消息流里的行（prompt / response block / tool result / notice 各算一行），我们的转录按**一条消息**存（一条 assistant 消息可能带多个块）。所以 `e.message` 是一条消息而不是一个块，`deny` 丢掉的是整条。这是刻意的降级：把块切开再拼回去，会让「一条消息」这个身份在 `classic.MessageDisplay` / `$.session.messages()` 里对不上。
- **不重放、不追溯**：只作用于「从这一刻起要存的行」，已经存过的不回头改。恢复会话（`--resume`）时不重跑。

### 会话消息（`$.session.messages`）

只读：返回这条会话**已经存下**的消息，最新的在最后。每项 `{ id, role, content }`，`content` 是块数组（`{ type: "text", text }` / `{ type: "tool_use", id, name, input }` / `{ type: "tool_result", tool_use_id, content }`），与 `session.append` 的 `message` 同形。

- **限额与截断**：最多回最近 `200` 条；单条超过「限额」里那档的文本按同一口径截断并加省略号。插件要「整份历史」自己做分页。
- **只读**：没有配套的「改写 / 删除」；要改是 `session.append` 的事（写之前），不是这里。
- **不快照到磁盘**：每次调用读的是内存里那份会话记录，与 `$.session.usage()` 同一层数据源。

### `$`（一期）

| 命名空间     | 方法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| `$.plugin`   | `name`；`root`：这个插件自己的目录（绝对路径）—— 插件随包带的资源（权重、模板、脚本）拼在它下面再交给 `$.fs` / `$.process`，见「读写文件」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `$.ui`       | `resolve(e)`、`open({ id, title, focus? })` → `Promise<{ isPlaced, reason? }>`（放得下吗，见「面板放得下吗」）、`close({ id })` → `Promise<void>`（对象参数，与 Claude Code 同一个形状；传字符串当场报错）、`panes()` → `Promise<readonly ModUiPane[]>`：自己开着的面板，每项 `{ id, title, isShown, isFocused, isPlaced }`，与 Claude Code 逐字段同形同义（见「面板的显示与焦点」）、`invalidate("ui.render" \| "tool.describe")`（告诉宿主某个渲染站点的生产者过期了：`"ui.render"` 是面板与带、`"tool.describe"` 是这场会话存着的那份工具描述；它不直接产生树、也不当场重问，见「用户交互的结果」）、`status(text)`、`toast(text, timeoutMs?)`（见「状态带、状态行与提示」）、`log(text, { to? })`（在对话流里留一行）、`ask(question, options?)` → Promise（问用户一个问题，见「问用户一个问题」）、`notice(tool_use_id, text)`（在一个工具调用下面加一行，`undefined` 撤掉；见「工具调用下面的一行」）、`copy({ text, surface? })` → `Promise<{ isCopied: true } \| { isCopied: false, reason }>`（写进剪贴板） |
| `$.state`    | `get`、`set`（会话级状态；`get` 返回副本，`set` 后需自己 `invalidate`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `$.store`    | `get(key)`、`set(key, value)`、`delete(key)`、`keys()`，四个都返回 Promise；`key` 必须是非空字符串（三条读写都查，与 Claude Code 同一句报错）。值是**任意 JSON**：`set` 按 `JSON.stringify` 归一（对象属性里的函数/symbol 静默丢掉，等同 CC；环、顶层 `undefined`、超限都报错），`get` 读回的是反序列化出来的副本                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |     |
| `$.clock`    | `now()`、`sleep(ms, { signal? })` → Promise（等待，可被取消；见「时钟：等待」）、`after(ms, fn)`、`every(ms, fn)`（后两者返回 `{ cancel() }`，见「定时器」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `$.process`  | `spawn({ argv, cwd?, env?, input? })` → 异步迭代子进程的输出；`run(argv, { cwd?, env?, stdin?, timeoutMs? })` → 跑完拿 `{ exitCode, stdout, stderr, is…Truncated }`（见「外部进程」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `$.fs`       | `read`（可选 `{ as: "bytes" }`）、`write`、`list`、`stat`、`exists`（相对路径按会话工作目录解析，见「读写文件」）、`ancestors({ names, of?, below? })` → `Promise<readonly FsAncestor[]>`（沿目录链找指令文件，见「沿目录链找指令文件」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `$.http`     | `fetch(url, { method?, headers?, body?, timeoutMs? })`（只允许 `https:` 与本机回环，见「发 HTTP 请求」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `$.prompt`   | `submit({ text, asUser })`：把一条 prompt 送进当前会话（见「把 prompt 送进对话」）；`fill({ text, mode? })` → `{ isFilled }`：把草稿填进输入框、不发送（见「把草稿填进输入框」）；`read()` → `{ text, cursor }`：输入框里此刻有什么（见「输入框里现在有什么」）；`suggest({ text })` → `Promise<{ isShown }>`：把这个建议摆成输入框的暗色建议、Tab 采纳，`e.origin` 是 `{ kind: "plugin", name }`（见「输入框里的建议」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `$.session`  | `usage()`：只读的 token 用量快照（见「会话用量」）；`cwd()`：会话**当前**工作目录（与 `$.fs` 相对路径、`$.process` 的缺省 cwd 同一份数据源，会随会话里的 `cd` 变）；`id()`：这条会话的 id；`root()`：会话工作根（不随 `cd` 动）；`model()`：当前生效的模型名；`surfaces()`：这一刻有谁在画；`turns()`：用户已发过几条 prompt；`repo()`：所在的 git 仓库；`version()`：引擎版本（后三个见「会话事实：id、根目录、模型」）；`messages()` → `Promise<SessionMessage[]>`：这条会话里已经存下的消息（见「会话消息」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `$.turn`     | `abort({ turnId })` → `Promise<void>`：把**此刻正在跑的那一轮**收掉（`turnId` 就是 `turn.start` 给的那个，不匹配时 reject 并同时报出两个 id）。走的是与 Esc 同一条路：模型请求中断、正在跑的工具停掉；不清用户队列、不打断 Bash 命令与斜杠命令（见「收掉一轮」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `$.env`      | `get(name)` → `Promise<string \| undefined>`：读一个环境变量，没设置就是 `undefined`（不抛错）；见「环境变量与设置（只读）」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `$.settings` | `read()` / `read({ source })` / `read({ key })` / `read({ source, key })` → Promise：`settings.json` 的只读快照，`source` 取 `user` / `project` / `local`，不传就是合并后的当前配置；见「环境变量与设置（只读）」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `$.command`  | `register({ name, description, argumentHint?, immediate? })`、`list()`、`run({ command, args? })`（见「注册命令」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `$.tool`     | `list()` → `Promise<ToolInfo[]>`：这一刻模型能调的工具，`{ name, description, mcp }`（见「配了哪些、能调什么、有谁在跑」）；`register({ name, description, inputSchema?, isDeferred? })` → `Promise<{ name }>`：把**自己**的一个工具交给模型（`isDeferred` 缺省 `true`＝进 `REPL` 池，`false`＝平铺），`name` 是模型看到的全名（见「把我们自己的工具交给模型」）；`check({ tool, input? })` → `Promise<{ decision, reason? }>`、`call({ tool, input? })` → `Promise<{ deny? }>`：不真的跑工具，只跑一遍「允不允许」/「拦不拦」那两条链（见「主动问一次工具面」）                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `$.config`   | `list()` → `Promise<ConfigRow[]>`：`/config` 菜单此刻会画的行，`{ key, label, description?, kind, value, options?, provider, isLocked }`（同上）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `$.agent`    | `list()` → `Promise<AgentInfo[]>`：这条会话跑过的子代理，`{ id, description, type, status, parentAgentId?, plugin? }`（同上）；`spawn({ prompt, description?, subagentType?, model? })` → `Promise<{ model, agentId? }>`：派一个子代理（见「派子代理」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `$.model`    | `complete({ model, prompt, system?, maxTokens?, timeoutMs? })` → `Promise<{ isAnswered: true, text, usage } \| { isAnswered: false, reason, usage }>`：让模型答一次，结果回给 mod（见「让模型替插件答一次」）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

`$.ui.resolve(e)` 把 `ui.render` 收到的事件换成**这一端可用的元素表**：`desktop` 与 `vscode` 是 `{ Box, Text, Button, Input, Select, Svg, Link, Code, Markdown, Progress }`（两端内容相同 —— VS Code 与 JetBrains 画的就是同一份 webview），`terminal` 是同一张表去掉 `Svg`（见「元素表按端分」）。从 `wave-agent-sdk/mods` 导入的是**并集表**（三端的名字都在），不按端裁剪 —— 拿它拼出的树会在校验时按端查一遍。表里每一项既是 JSX tag、也能直接调用（`t.Text({ children: "hi" })`，`children` 从 props 里摘出来），两种写法落到同一个节点。表按 `e.surface` 选：一期只发 `desktop` / `vscode` / `terminal`，别的值、以及不认识的 `e.component`，都直接报错并列出可用名单，不返回半张表。

与 Claude Code 的 `$.ui.resolve(e)` 同一个语义：它同样拿 `ui.render` 的 `e`，按 `e.surface` 选元素表、并要求 `e.component` 是引擎画得出的站点（它的错误文案是 `takes a ui.render argument (e.surface names the surface)`）。区别在覆盖面：CC 的 surface 有 `terminal` / `desktop` / `mobile` / `vscode` 四端，**各端元素表不同，但九类 + `Progress` 是四端共有的底**（`terminal` 另加 `Client`/`Raster`/`Image`、没有 `Svg`；`desktop` 另加 `Svg`/`Client`/`Shader`；`mobile` 另加 `Svg`/`Shader`；`vscode` 正好那十类）；我们只发 `desktop` / `vscode` / `terminal` 三端，前两端 10 个、终端 9 个，都少 `Client`（终端还少 `Raster`/`Image`、桌面少 `Shader`），且**没有 CC 之外的任何名字** —— 给画不出的名字，mod 编出的树只会被 `validateModTree` 拒掉，错误离原因更远。

### 面板放得下吗（`$.ui.open` 的 `isPlaced`）

`$.ui.open({ id, title, focus? })` 返回 `Promise<{ isPlaced, reason? }>`：`isPlaced: true` 表示这一次请求已经被一个 surface 接住、会画出来；`false` 带一句 `reason` 说明为什么没画（没人接、会话正在销毁）。它**不等待**用户做任何事，也不表示面板已经可见 —— 只是「有人接这一帧」。

- 判据是「有没有 surface 在画」，与 `$.session.surfaces()` 同一个数据源：桌面端、终端 CLI 或 VS Code / JetBrains 在画 ⇒ `isPlaced: true`（终端的具体形态见「终端形态」）；`wave -p` ⇒ `isPlaced: false`，`reason` 是「这条会话没有画面板的表面」。
- **没人接的时候面板照样登记**（与 Claude Code 的「With none attached keep the pane」一致）：`isPlaced` 说的是「这一帧有没有人看得见」，不是「这个 pane 存不存在」。之后有 surface 挂上来，它照常能画出这个面板。所以判断「要不要等用户按」只能读 `isPlaced`，不能反推「面板登记成功了就有人看」。
- 守卫类插件的用法：开不了面板就别开，直接按「没人看得见」降级 —— blast-radius 那种「冻住命令、等用户按 Proceed」的流程在无界面时必须立刻拒绝，而不是等一个永远没人按的按钮。

`focus: true` 表示用户点了按钮/命令带出来的面板（抢焦点）；省略表示 mod 自己的意愿（不抢焦点）。**只收 `true`**：写 `focus: false` 与不写是两件事（后者是「没有意见」、前者是想显式表达「别抢」），CC 也是在 `false` 上报错，所以两边同一个口径。**桌面端**首帧打开面板本来就是激活这个 tab，因此 `focus: true` 在桌面端是 no-op —— 收它只为让照 CC 写的插件原样能跑；**终端**里它才真的有第二种行为：键盘焦点直接进面板，省略时焦点留在输入框、面板只显示（见「终端形态」）。

**`rows`（申报高度）**：`$.ui.open({ id, title, rows })` 让插件告诉 surface「这块面板画这么多行才够」，与 Claude Code 的 `openPane({ …, rows })` 同名同义 —— 它的差异插件每次开面板都传一个按内容算出来的行数。口径有三条：

- **是申报，不是命令**。surface 取「申报值」与「这一端放得下多少」里较小的那个：终端仍受 2/3 屏幕与最低 6 行的约束（见「终端形态」的「高度」），桌面端 tab 高度由面板区自己决定、这个字段是 no-op。所以申报小了会挤、申报大了会被压，不会撑坏版面。
- **只对写它的那一帧生效，之后按最后申报值**。内容变高变矮时再 `$.ui.open` 一次更新（Claude Code 的差异插件就是这么做的：算出来的行数与上次不同才重开），不是每帧都传。
- **必须是 ≥1 的整数**。写 `0`、负数、小数、字符串都当场点名 —— 与 `Input.rows` 同一条校验纪律（静默忽略会让作者以为申报生效了、面板却还是 12 行）。

`closeOnEscape`（CC 的同一个入参）我们**不收也不校验**：这一端的 `Esc` 归 `ui.close` 那条通道（默认收起，见「终端形态」与「`ui.close`：mod 能拦下关闭」），所以照 CC 写的插件传了它也只是被忽略，不会报错；想「关不掉」就在 `ui.close` 里返回 `{ deny }`。

### 面板的显示与焦点（`$.ui.panes`）

`$.ui.panes()` → `Promise<readonly ModUiPane[]>`，每一项 `{ id, title, isShown, isFocused, isPlaced }`。列的是**这个 mod 自己的**面板（按插件过滤，不是会话里的全部），顺序按打开先后。

| 字段         | 口径                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| `id`/`title` | `$.ui.open({ id, title })` 登记时给的那两个；`title` 省略时等于 `id`                  |
| `isPlaced`   | 与 `$.ui.open()` 的 `isPlaced` 同一个判据（「有没有 surface 在画」），见上一节        |
| `isShown`    | 这个 pane 是不是该端**当前摊开**的那一个（多 tab 里在前台的那个；终端是正画着的那块） |
| `isFocused`  | 键盘是不是在这个 pane 的正文里                                                        |

`isShown` / `isFocused` 是**这一端的事实**，由 surface 上报，引擎只存一份（切 tab、点进面板正文、按 `Esc` 把键盘交回输入框各报一次）。它们与 `$.ui.open({ focus: true })` 的分别就是「请求」与「事实」：前者是 mod 的意愿，后者是人实际做出来的。

- **没人上报过时两者都是 `false`**，不编值：`wave -p`、远控页这类不画面板的端永远不报，读到的就是 `isPlaced: false` + 两个 `false`。
- **单一真值、最后上报者胜**：一条会话可能同时被两端挂着（桌面端 + 终端），引擎只存一组「当前显示 / 当前焦点」—— 与 Claude Code 一致（它的 pane 状态也只有一组 `shownId` / `focusedId`）。
- **新开的面板在没人持焦点时自动成为 shown**（与 CC 的 `shownId: focusedId ?? 新 id` 同一条）：mod 连开两个，用户看到的是后开的那个；键盘已经有人持着就不抢。
- **关掉 shown / focused 的那个 pane**：两个标记一起清成 `null`，不自动顶到相邻 tab（随后由该端上报它实际显示的那一个）。
- **终端按 `Esc` 收起面板**（见「终端形态」）：先走 `ui.close` 问一句，被 `{ deny }` 拦下时什么都不变；真收起来之后把 `isFocused` 报成 `false`，此时 `isShown` 也是 `false`（这一端没在显示任何面板）。

同一个事实也出现在面板的渲染 props 里：`ui.render` 的 `e.props.isFocused` 与 `$.ui.panes()` 的 `isFocused` **同源同值**，不另立一套口径。区别只在时效 —— 树是 surface 拉出来的，`e.props` 是**拉那一帧那一刻**的事实，所以 surface 在焦点真的翻转之后会给翻转的那块（最多两块：让出焦点的、拿到焦点的）**补拉一帧**，mod 不必轮询。这条触发只在值变了时发（同一份快照按值比较），点按钮、打字这类不会翻焦点的动作不会多一次往返；Claude Code 那边是同一条语义 —— 它的渲染站点以 `isFocused` 为 memo 依赖，焦点一变就重画一次，并靠「props 没变就复用上一次结果」的缓存压住重复派发。

不做的中间态：CC 的 roster 里还有一个「待裁决的焦点请求」（`focus_requested_id`），由 surface 判断「输入框空、空闲、没有对话框」才兑现，否则回一条拒绝。**我们不引入这个状态**：`focus: true` 由各端在打开那一刻按自己的既有形态处理（终端直接送键盘、桌面端本来就激活这个 tab），结果经同一条上报通道回来。所以 `$.ui.panes()` 上只有「现在有没有焦点」，没有「正在请求焦点」。

### 状态带、状态行与提示

面板之外，mod 还能往界面上贴三样**不属于任何 pane** 的东西，落点与形态各不相同（下表是桌面端的；IDE 聊天面板把三样收进输入框上方的同一个栈，见「在 IDE 插件里画」）：

| 能力                              | 落点                     | 形态                                                                                                        |
| --------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `AbovePrompt` 站点（`ui.render`） | 输入框**上方**的带       | 一棵元素树；一个 mod 一条带，多条按插件加载顺序纵向排列；高度封顶在 11 行正文 + 滚动内衬，超出在带里滚      |
| `$.ui.status(text)`               | 输入框下方**常驻的一行** | 纯文本，每个插件一段 `plugin: text`，后一次调用替换前一次，`null` 清除；右对齐、单行省略、放不下的收成 `+N` |
| `$.ui.toast(text, { timeoutMs })` | **右下角固定浮层**       | 纯文本，默认停留 4000ms，到点自己消失，也可点 × 提前关；360px 宽，由下往上堆                                |

三样的尺寸口径对齐 Claude Code 桌面端（它的 `above-prompt` 站点 / 状态行 / cds Toast）：带的上限 `calc(11lh + 40px)`（那 40px 是滚动内衬，首末条的描边与焦点环不被容器边缘切掉），滚动条隐掉；状态行是一条水平行、`plugin: text`、单行省略，放不下的收成 `+N`（收起来时才给每段 32ch 的天花板）；提示是固定右下角浮层、360px、正文按 240 字符截断 —— 它不参与输入区布局，因此也不受输入卡宽度约束。带与状态行仍然与输入卡同列同宽（插件端 800 / 桌面 768）。

**提示浮层不是输入区的一部分**：它会盖住输入卡右下角，所以既能点 × 关掉、也在 `toastQueueMax` 条之后丢最旧的一条；`position: fixed` 让 50 条长提示不会把消息区压成 0（历史缺陷：这三样都没有上限时，60 行的带把输入卡顶出视口）。

后两个是**只推不拉**的：不产生树、不进对话上下文、宿主收到就画。`status` 的一行一直挂着，直到插件自己替换或清除；`toast` 会自己消失。两者都按插件署名，用户能看出是谁贴的。

**`toast` 的第二个参数是对象**（`{ timeoutMs }`），与 Claude Code 同一个形状 —— 社区 mod 一律这么写，收成裸数字会让它们的 `session.start` 当场抛错。裸数字我们早期也认（老示例直接抄得动），但新写的按对象来。

**状态行会重放，`toast` 不会**：`session.start` 里贴的状态比客户端注册会话更早，那条推送按传输层既有语义会被丢掉（v1：未知会话的通知一律丢弃）。所以 surface 挂上来要面板快照时（`getModPanels`）agent 顺带把当前每个插件的状态行补发一次 —— 「启动时贴一行、之后一直挂着」才是这个能力的正常用法。`toast` 是瞬时消息，晚了就不该再弹。

带是第二个渲染站点，走与面板同一条拉取链路：surface 在会话就绪后、以及每次 `stale` 之后，对每个注册了 `ui.render` 的 mod 用 `{ surface: <这一端>, component: "AbovePrompt", requestId: "above-prompt" }` 拉一次树；返回 `undefined` 或空树就不占位置。校验、限额、`revision`、失败时保留上一帧并叠错误摘要，全部与面板一致。

与 Claude Code 的差异：它的带是**一个共享站点**（`requestId` 固定 `above-prompt`，与 pane 一起列进 `ui.focus` / `ui.scroll` 的站点集合）；我们按插件分成多条带，且一期不给带键盘焦点与滚动 —— 那是面板才有的东西。

**终端里这三样的落点**（终端没有浮层与右栏，只能落在输入框上下两行）：

| 能力               | 终端落点                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AbovePrompt` 站点 | 输入框上方，一个 mod 一条、按插件加载顺序自上而下；每条正文封顶 6 行，超出在带内滚动                                                                                     |
| `$.ui.status`      | 输入框下方那一行（左侧仍是权限模式提示）：`插件名: text` 用 `·` 连起来、单行省略，放不下时收成末尾的 `+N`                                                                |
| `$.ui.toast`       | 同一个槽位（与「插件变更待应用」同一个 hint，谁最后设置谁显示），带 `插件名: ` 署名，默认停留 4 秒后自己消失；终端里没有 × 可点，提前清就走 `timeoutMs` 或下一次提示覆盖 |

**`AbovePromptList` 站点：看见并重排别人的带**。第三个站点把「带里现在有什么」摊给 mod 看：宿主先把所有 mod 的带收齐，再用 `{ surface: "desktop", component: "AbovePromptList", requestId: "above-prompt" }` 问**显式在 matcher 里点名这个站点的** mod 一次（`on("ui.render", { component: "AbovePromptList" }, …)`），`e.props.rows` 是这一帧全部行的形状 `{ plugin, tree }`（`plugin` 是行主的插件名，`tree` 是那一行当前要画的树），外加 `hasSurvey` / `isCollapsed` / `isWorking` / `maxRows` / `bodyColumns` 几个版面事实。

- **只问显式点名的那几个 mod**：没写 matcher 的 `ui.render` 处理器会收到每一个站点，而「只画自己那一行」的插件收到这个站点时照样会返回它自己那棵树 —— 那棵树里恰好有它自己那一行，按「留下哪些行」的语义读就等于把所有别人的行都藏了。所以「没写 matcher」在这个站点上是**不被问**，不是「被问但返回 undefined」。
- **只认 `props.rows`**：mod 返回的树必须把想留下的行**按自己的顺序**重新列一遍（`rows.map(r => r.tree)` 这种写法就够），宿主按返回顺序画。要隐藏某一行就是不放进去。
- **没意见 = 返回 `undefined`**（或不出现在上面那批 mod 里），所有行照原顺序画。
- **返回了树但一行都不认 = 把带清空**：这是 fail-closed 的写法，与 Claude Code 的「to fail closed, answer no rows in its `.catch`」同一条。「没有意见」与「什么都不显示」是两件事，前者用 `undefined` 表达。
- **不支持「包一层树」**：Claude Code 允许拿别人的行当子树嵌进自己的 `Box` 里再排版（「wraps them by answering around it」），我们不接 —— 一棵树跨插件嵌套之后，`revision` / 归属 / 失败隔离都得按子树重算，而按行重排已经覆盖了绝大多数用法（合并、置顶、折叠）。
- **失败按原顺序画**：harness 抛错或超时（5 秒预算）时**按原顺序画**并记一条 debug，与 `tool.call` 的 fail-open 同一条纪律。要「宁可什么都不显示」就在自己的 `.catch` 里返回一棵不含任何行的树（见上一条）。
- **不跨 mod 接力**：第一个给出可认结果的 mod 说了算，`next(e)` 之后没有第二个排序器可问 —— 面板与带都是「一个 mod 一份」，只有这个站点是全体的。
- 与 `AbovePrompt` 的关系：那个站点画「我这一行」，这个站点决定「所有行怎么排」。一个 mod 可以只注册后者（做排序器，自己不画带）。

### 问用户一个问题（`$.ui.ask`）

守卫类插件拦下一条命令之后要问「怎么办」，又不能自己画一个按钮等按（钩子跑在工具调用的关键路径上，谁按得到取决于有没有人开着界面）。`$.ui.ask(question, options?)` 直接借引擎自己的提问通道：**走 `AskUserQuestion` 那条审批链路**，宿主用各自已有的对话框画出来，用户选完这一句 Promise 才 resolve。

```ts
on("tool.call", { tool: "Bash" }, async ($, e, next) => {
  if (!isRisky(e.command)) return next(e);
  const answer = await $.ui.ask(`要执行这条命令吗？\n${e.command}`, [
    "允许一次",
    "拒绝",
  ]);
  return answer === "允许一次" ? next(e) : { deny: "用户拒绝了这条命令" };
});
```

- **参数与返回值照 Claude Code**：`ask(question, options?)`，`options` 是 2–4 个标签，或者 `{ options, header, multiSelect }`（`header` 是那颗小标签，`multiSelect` 为真时多个答案用逗号连接）。resolve 的是**选中的标签**，或者用户在「其他」里打的自由文本 —— 所以要拿它跟标签做**精确**比较。少于两个标签时补成「是 / 否」。
- **拒绝的情形一律 reject**：用户关掉对话框、这条会话没有任何界面接手（`wave -p`、纯服务端跑）、宿主等不到回执。守卫的正确写法是 `try/catch` 之后按「没人能答」处理（社区插件正是这么写的：`catch` → deny）—— 所以插件不需要先问「有没有人在看」，问不到就按拒绝走。
- **不占钩子预算**：等人按键的时间与 `$.process.run` 的等待同一条口径（等 I/O 不计入那个钩子的 5 秒），所以「问一句、等 60 秒」的守卫不会因为超时被当成挂掉。
- **一次只问一个问题**：`AskUserQuestion` 本身支持一次问 1–4 个，这里只给单个问题 —— `$.ui.ask` 的契约是一个问题一个答案，多问几次即可。

### 在对话流里留一行

`$.ui.log(text, { to? })` 把一行用户可见的文字**追加进对话流**，落点是宿主已有的「提示块」（`notice`）：跟报错、钩子状态行同一个位置，挂在最后一条 assistant 消息下面，没有就在最新一条用户消息之下新起一条。

- 与 `status` / `toast` 的区别是**它属于这次对话**：随会话落盘，切会话、重启之后还在；`status` 是常驻的一行（后一次覆盖前一次），`toast` 几秒就没了。要「这件事发生过、以后还能回看」就用 `log`。
- **不进模型上下文**：`notice` 块不进 API 请求（参见消息块可见性矩阵），所以 mod 可以放开写，不会污染提示词、也不会顶掉 token 预算。
- `to` 只认两个值：`"transcript"`（省略时默认它，即上面那条）与 `"debug"`（只写进 `wave` 的调试日志，对话流里**不出现** —— 给 mod 作者自己排查用）。别的值报错并列出这两个可用值，与 Claude Code 逐字同一份口径（它宿主侧也是这两个值，原话 `to is "transcript" or "debug"`）；唯一差别是不合法时**我们让这条钩子失败、CC 只丢掉这一行并记一条 warn** —— 我们一贯宁可当场失败，不静默吞掉。
- 单条超过上限（见「限额」）截断并加省略号，与 `status` 同一个口径。

### 工具行下面的一行

`$.ui.notice(tool_use_id, text)` 把一行字贴在**某个工具调用那一条的下面**，`text` 给 `undefined` 就撤掉；返回 `void`。

- 与其他三处贴字的地方都不同：`status` 是输入框下方常驻一行、`toast` 是右下角浮层、`log` 是对话流里独立一条；`notice` 挂在**已经存在的那一行工具**上，用户收起工具块时它跟着看不见。
- `tool_use_id` 就是工具结果事件里那个 id。**对不上就当场报错**（Claude Code 是「refused」）：默默丢掉会让作者以为画上了。
- 工具调用结束（成功与失败都算）时宿主自己撤掉这一行，插件不必在 `turn.complete` 里清理。时机精确到「工具执行完、结果块定型之后」：`classic.PostToolUse` / `classic.PostToolUseFailure` 与 `PostToolUse` 钩子在那之前就已经报过（它们在工具执行那一层返回时就发），所以 `tool.call` 里、工具跑的过程中贴的行用户看得到；在 `classic.PostToolUse` 里贴的行属于「工具已经结束」，会被这次收口一并撤掉。
- 一行纯文本，不换行、不解析 markdown，超出宽度省略。

### 剪贴板

剪贴板要先看**有没有人在画**才决定做不做得成，所以返回结果对象、不抛错：

- `$.ui.copy({ text, surface? })` → `{ isCopied: true }` 或 `{ isCopied: false, reason }`，`reason` 取 `no-surface`（没人画）/ `no-clipboard`（这一端没有剪贴板通道）/ `refused`（对面拒了或 3 秒没回执）。`surface` 不给就用 `surfaces()` 的第一个，给了就必须是其中一个，否则 `no-surface`。

### 注册命令

mod 可以注册一个斜杠命令，用户像用内置命令一样敲 `/name args`（也出现在 CLI 的命令选择器与 webview 的快捷指令弹窗里）。

```ts
on("session.start", ($) => {
  $.command.register({
    name: "standup", // /^[a-zA-Z0-9_-]{1,64}$/
    description: "把昨天的提交整理成日报", // 菜单里显示的那行字，必填非空
    argumentHint: "<天数>", // 可选：命令后那行参数提示
    immediate: false, // 可选：忙的时候要不要插队执行
  });
});

on("command.run", { command: "/standup" }, ($, e) => ({
  text: `整理最近 ${e.args || "1"} 天的提交`,
}));
```

**注册只给菜单元数据，逻辑在 `command.run` 钩子里**（与 Claude Code 同一个形状）：`register` 没有 handler，用户敲下 `/standup 3` 后引擎派 `command.run`，matcher 写成本条命令（带斜杠，`{ command: "/standup" }`，与 CC 一致；也可以不给 matcher、由钩子自己比 `e.command`，见下），钩子返回两档之一：

- **`{ text }`**：这段文字作为**一条用户消息**进会话，模型看到的就是它；
- **`{}`**（没有 `text`）：这次命令**只是插件自己的动作** —— 开关一块面板、刷新一次状态 —— 不发消息、不进对话。差异插件的 `/diff` 就是这一档（见 [diff-command](../commands/diff-command.md)），否则每敲一次就给模型白送一轮。

`{}` 与「没答」（`undefined`）是两件事：前者是有人回答了、只是没有话要说，后者才会报错（见下）。

- `args` 是用户敲在命令名后面的原文（`"3"`，没写就是空串）。
- **matcher 是可选的**：`on("command.run", { command: "/standup" }, handler)` 只接这一条，`on("command.run", handler)` 接这个 mod 注册的**所有**命令（社区 mod 就是一条钩子管自己所有命令、在钩子里比 `e.command`）。派发本来就按 mod 分开，没有 matcher 不会把命令串到别的 mod 上；给了 matcher 但没写 `command` 的，这条注册被忽略并记一条 warn。
- **事件里的 `e.command` 不带斜杠**（`"standup"`）—— 与 Claude Code 同一个口径，社区 mod 直接比 `e.command === "guard"`；matcher 里写带不带斜杠都认（两边归一后比较）。
- **钩子没答就不执行**：注册了命令但 `command.run` 没有对应 matcher 的钩子（返回 `undefined`），这条命令报错并给一句能照做的提示（缺钩子时照 CC 的文案形状：「registered /name but no command.run hook answered it」）。
- **重名即拒**：与内置命令、用户/项目 `.wave/commands` 下的自定义命令、技能命令、别的插件的命令同名，注册就失败并在插件日志里说明是谁占了。同一个 mod 用同一份 spec 重复注册是幂等的。
- **撞宿主本地命令**在宿主侧丢弃：`/config`、`/clear`、`/model` 这类是各前端自己实现的动作（不在 SDK 的命令表里），SDK 检查不到；所以 `getSlashCommands` 合并时，同名 mod 命令被丢掉并记一条 warn。
- **不能在 `command.run` 钩子里调 `$.prompt.submit`**：钩子正持有用户打出的这一轮，再投一条会等自己（CC 的原文案是「would wait on the turn this hook is holding」）。要在这之后继续，就存到状态里、在 `turn.complete` 里投。
- `$.command.list()` 返回当前可见的命令（`{ name, description, source, plugin? }`，`source` 是 `built-in` / `user` / `skill` / `plugin`），`$.command.run({ command, args })` 以 mod 身份执行一条已注册的命令 —— 与用户敲下它等价（同样走 `command.run` 钩子）；命令不存在时报错并列出最接近的名字。

### 把我们自己的工具交给模型

除了观察和改写宿主已有的工具，mod 还能**带来自己的工具**：`$.tool.register()` 交一份工具规格，模型按 `mcp__<plugin>__<name>` 调它，执行体是同一个 mod 的另一条 `tool.call` 钩子。

```ts
on("tool.register", ($) => {
  $.tool.register({
    name: "lookup_ticket", // /^[a-zA-Z0-9_-]{1,64}$/
    description: "按编号查一张工单的现状", // 模型看到的那段，必填非空
    isDeferred: false, // 可选：不藏进 REPL，直接平铺（缺省是 true，见下）
    inputSchema: {
      // JSON Schema 对象，缺省 { type: "object" }
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  });
});

on("tool.call", { tool: "mcp__myplugin__lookup_ticket" }, async ($, e) => {
  const ticket = await lookup(e.input.id);
  return { result: ticket }; // 这份 JSON 就是模型读到的工具结果
});
```

- **名字带前缀**：`mcp__<plugin>__<name>`，`<plugin>` 是插件目录名归一后的 `[a-z0-9_-]+`。这个前缀不是装饰：`isRestrictedTool()` 按它把工具归进受限工具，于是 mod 带来的工具与 MCP 工具走同一条审批路（用户看得见、能拒）。不写前缀就得给「第三方工具」单开一条权限分支，那是把同一个判断做两次。
- **执行走 `tool.call`**：规格里没有 handler，模型调它时引擎派 `tool.call`，matcher 写全名、返回 `{ result }`（任意 JSON，序列化后作为工具结果文本交给模型）或 `{ deny }`。为此 `tool.call` 的返回值从「只认 `{ deny }`」扩成 `{ deny } | { result }`，链也从「只观察」变成能答结果的链：`next(e)` 解析到下游已经形成的答案，外层返回自己的那份才算数。不注册 `tool.call` 的工具被调用时按 `{ result: null }` 答，并在插件日志里说明没人接。
- **5 秒预算照旧（每次派发一份，见「限额」）**：执行体是 mod 的代码，受「限额」那一节的全部约束；要跑长活就 `$.process` / `$.http`（它们有自己的超时与暂停规则）。
- **默认延迟**：mod 注册的工具与 MCP 工具走同一条规则——**无条件进 `REPL` 池**，模型从公告里看到名字、用 `tools.ToolSearch` 取签名后调用。要让它平铺就 `isDeferred: false`（与 `alwaysLoad` 同义）。这一位与 CC 的 `$.tool.register({ isDeferred })` 是同一个字段、同一个默认值（CC 把它翻成 MCP 的 `_meta: {"anthropic/alwaysLoad": true}`）；`REPL` 未启用时它无处可去，照常扁平声明（见 `docs/specs/core/repl-tool.md`）。
- **时机**：`tool.register` 事件每个 mod 一次，在第一次请求之前；在 `session.start` 里直接调也一样 —— 只要赶在第一次请求之前。放置按注册时这一位定下来，之后不再询问；要改只能在 `tool.describe` 里翻转（见「给工具、技能、命令写描述」）。
- **限额**：一个 mod 最多 16 个工具（`MOD_LIMITS.modToolsPerMod`）；`description` ≤ 2000 字符、`inputSchema` 序列化后 ≤ 16 KB，超了当场报错并把实际数字写进错误里；重名（别的插件、内置工具、MCP 工具）注册即失败。
- **卸载**：插件重载、`session.end` 时注销；注销之后模型不再看到它，同一轮里已经跑起来的调用不打断。

### 派子代理

`$.agent.spawn()` 让 mod 自己起一个子代理；`agent.spawn` 事件让 mod 拦在**任何**子代理起跑之前（包括 `Agent` 工具派的）。

```ts
on("agent.spawn", { subagentType: "Explore" }, async ($, e, next) => {
  if (e.prompt.includes(".env"))
    return { deny: "这个仓库里不许把 .env 交给子代理" };
  return next({ ...e, prompt: e.prompt + "\n只读，别改文件。" });
});
```

- **形状**：`e` 是 `{ tool_use_id, prompt, description, subagentType, model? }`；`next(e)` 解析到 `{ model, agentId? }`（`agentId` 是 core 派的那个子代理的 id，钩子自己答的没有）；`{ deny }` 拒绝这一次派发。
- **matcher**：`{ agent: "Explore" }` 匹配 `agent.offer`（事件里那个字段就叫 `agent`），`{ subagentType: "Explore" }` 匹配 `agent.spawn`（CC 的事件字段名也是这个，见它的 `n.subagentType`）。不跨事件别名：给 `agent.spawn` 写 `{ agent }` 匹配不上，与 CC 一致。值按字面比，内置 `Explore` 的 `E` 是大写。
- `agent.offer` 在**清单**与**派发**各触发一次，返回 `{ isOffered: false }` 让这个子代理类型既不出现在 Agent 工具的清单里、也拒绝派发 —— 它与 `agent.spawn` 的分工是「先决定给不给看，再决定这一次放不放」。
- **额度**：一个 mod 同时活跃的子代理最多 4 个；mod 派的子代理**不再派**（深度 1），防递归。超了 `$.agent.spawn` reject，`agent.spawn` 钩子则不触发（没东西可派）。
- **归属**：`$.agent.list()` 能看见它们，多一个 `plugin?` 字段标明是谁派的；主会话的汇总照旧。
- 子代理的 `tool.call` 事件带 `agentId`（主会话上这个键不出现），mod 据此分辨是谁在调。

### 让模型替插件答一次（`$.model.complete`）

mod 有时要自己问模型一句：给一段长文本分类、把一堆提交写成摘要、判断这行日志像不像故障。

```ts
const reply = await $.model.complete({
  // 全名，取用户配置里已有的模型（与 --model 同一份清单 + 当前会话模型；
  // Wave 没有 haiku/sonnet 这类族别名，写不存在的名字当场 reject）
  model: "gpt-4o-mini",
  system: "你是一个分类器，只回一个词。",
  prompt: chunk,
  maxTokens: 256,
});
if (reply.isAnswered) $.ui.status(reply.text.trim());
```

- **一次一问、不流式**：答了给 `{ isAnswered: true, text, usage }`（`usage` 与 `$.session.usage()` 同口径），没答出来给 `{ isAnswered: false, reason, usage }`，`reason` 取 CC 的三档：`api-error`（带 `status` 与 `error`，`status` 是 HTTP 状态、拿不到响应时为 `null`）、`empty-reply`（模型回了但正文没有文本块）、`aborted`（`timeoutMs` 到期、调用方取消、插件被卸载）。**我们自己的门槛不混进这个联合**：模型不在 allowlist 里、超出每会话 50 次、`maxTokens` 非正整数，一律当场 reject —— CC 的 `reason` 说的是「这次请求怎么了」，而这三件是「根本没发这次请求」。
- **它是唯一一条不占这个钩子 5 秒预算的调用**：一次请求通常 3–60 秒，把它塞进钩子预算等于废掉这个能力。实现上走与 `$.process` 等输出同一条「暂停预算」通道，超时由调用方用 `timeoutMs` 自己给（缺省不设，与 CC 一致）；**除它之外，钩子里的一切仍然受那个钩子的 5 秒约束。**
- **额度**：每条会话每个插件最多 50 次（`MOD_LIMITS.modModelCallsPerSession`）；`maxTokens` 缺省 1024、上限 4096（`MOD_LIMITS.modModelMaxTokens`）。上限比 Claude Code 的「`min(模型输出上限, 64000)`」紧一档：这条通道是给插件做单次判断用的，不是给它们跑长生成 —— 64k 的一问在额度只有 50 次时能被一次花光。超出额度 reject 而不是答 `aborted` —— 见上一条的分工。
- **记账可见**：这几次调用算进会话总量（与模型请求同一条记账路，`model` 记的是请求的那个模型），所以 `$.session.usage()` 与 `session.measure` 的快照都含它们。用户的账单要能对上模型请求，所以不藏。
- **不许在 `$.model.complete` 里再调 `$.model.complete`**：一次调用只有一层，直接 reject。
- 命令的归属随插件：`/reload-plugins` 或卸载插件后该命令消失；同名命令不会被另一个插件抢走。

### 定时器

mod 的沙箱里**没有** `setTimeout`/`setInterval`，要定时只能走 `$.clock`。这不是省略：定时器归宿主所有，会话销毁或插件重载时才能被一起撤销；裸定时器会留在进程里继续跑，然后打到已经销毁的会话上。

- `every(ms, fn)` 每 `ms` 毫秒跑一次，`after(ms, fn)` 只跑一次；两者都返回 `{ cancel() }`，`cancel()` 可以重复调用。
- `ms` 下限 200ms，更小的值**夹到 200ms**（`0`、负值、非数字几乎一定是写错了，但没必要为此把整个面板变成错误态）。
- 同一个 mod 的定时器回调**串行**执行：上一拍还没跑完时这一拍直接跳过（不排队、不并发），回调是 async 也一样。
- 回调里可以调 `$` 的任何方法（`$.ui.invalidate`、`$.store.get`、`$.ui.panes` 都行）。回调抛错记 `wave` 日志并在面板顶部叠一条错误摘要，**下一拍照常执行**——一次抛错不会把定时器停掉。
- 定时器不跨会话：会话销毁、`/reload-plugins`、agent 重建时宿主撤销该 mod 的全部定时器，之后不再有任何回调。

轮询是 mod 看到**自己进程之外**变化的主要手段。外部程序（用户在客户产品里跑的脚本、本机的客户端进程，或 mod 自己用 `$.process.spawn` 起的进程）把状态写进 `$.store` 对应的文件，mod 用 `$.clock.every` 读出来、变了就 `$.ui.invalidate`；反过来，面板上的按钮把意图写进 `$.store`，外部程序自己那份循环读到后执行真正的动作（例如连上或断开 WebSocket）。mod 自己的网络能力是一次性请求（`$.http.fetch`）；要长连接就起一个**桥进程**，桥持有 WebSocket，mod 与桥之间走本机回环 HTTP（见「跨平台的双向连接」）。

### 时钟：等待

`$.clock.sleep(ms, { signal? })` 返回一个 Promise，`ms` 之后 resolve —— 沙箱里没有 `setTimeout`，轮询之间、退避重试、等外部进程重启都要它。它和 `after` 不是一回事：`after(ms, fn)` 是「到点跑一个回调」，`sleep` 是「这一行代码停在这儿等」。

- `ms` 的限额与定时器同一条（下限 200ms、单次上限 10 分钟，更小的夹到 200ms）。
- **可取消**：传 `{ signal }`（`AbortSignal`）就能提前结束，abort 后 Promise **reject**（一个 `AbortError`，`name` 是 `"AbortError"`），不是 resolve —— 调用方要能分辨「等到了」和「被打断」。
- **会话销毁 / 插件重载时未完成的等待一并 reject**，与定时器、外部进程同一条纪律：沙箱里不该有活过会话的东西。所以 `await $.clock.sleep(...)` 外面永远要考虑被 reject 的可能（例如 `try/catch` 后直接返回，别在 `finally` 里再写界面）。
- 等待**不占**「同时活跃的定时器」配额（那是 `after`/`every` 的），但占用这一层的执行时间额度：一个 5 秒的 `sleep` 会把这一层自己的额度吃满，钩子超时的规则照旧（见「限额」）。

### 环境变量与设置（只读）

插件常要把自己的配置放在环境变量或 `settings.json` 里（`$.env.get("MY_PLUGIN_WATCH")`），两个只读入口：

- **`$.env.get(name)`** 返回 `Promise<string | undefined>`：读会话环境变量的值与 `process.env` 合并后的结果（`settings.json` 的 `env` 段优先，与工具、钩子看到的是同一份）。**没设置就给 `undefined`，不抛错** —— Claude Code 同样是这个语义，社区插件的写法就是 `(await $.env.get("X")) || 默认值`。
- **`$.settings.read(...)`** 返回 `Promise<Record<string, unknown>>`（带 `key` 时是该键的值，可能 `undefined`）。四种调用形式：`read()` 拿合并后的当前配置；`read({ source })` 只拿某一层（`user` = `~/.wave/settings.json`、`project` = `<workdir>/.wave/settings.json`、`local` = `<workdir>/.wave/settings.local.json`）；`read({ key })` / `read({ source, key })` 再取一个**顶层键**（不做 `.` 路径展开）。`source` 传别的值当场报错并列出可用值 —— Claude Code 的这份表里还有 `flag` / `policy`（它的命令行 flag 层与托管策略层），我们没有这两层，不假装有。
- **不做掩码**：`$.env.get("WAVE_API_KEY")` 能读到真值、`settings.read()` 里也含 `env` 段。这不是疏忽：同一个插件的 hooks 本来就在宿主进程里跑 shell（`echo $WAVE_API_KEY` 一样读得到），掩码只会让「同一份配置在 hook 里能读、在 mod 里是星号」变成更坏的语义。信任边界在**装插件**那一刻，不在 `$` 的字段上（同「外部进程」的信任说明）。反过来要求插件作者：别把读到的值打进 `$.ui.log`、`$.ui.status` 或 `$.http.fetch`。
- 两者都是**只读**：没有 `$.env.set`（Claude Code 有，改会话环境会牵连正在跑的工具与子进程）、没有写 `settings.json`。

### 配了哪些、能调什么、有谁在跑

三个只读清单，插件拿它们做「装没装」「有几个」「叫什么」的判断，都不改任何东西。形状照 Claude Code 的 `ConfigRow` / `ToolInfo` / `AgentInfo`，字段只少不多：

| 方法              | 返回                   | 我们填什么                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$.config.list()` | `Promise<ConfigRow[]>` | `/config` 菜单此刻会画的行：`{ key, label, description?, kind, value, options?, provider, isLocked }`。`kind` 取 `boolean` / `choice` / `text` / `number`（由值类型与候选表定），`value` 是值本体，`choice` 的候选另放 `options`，`provider` 是 `{ plugin, tier }`。**只列真有值的键**（三层 `settings.json` 里写了的，加上插件 `userConfig` 的行），不把几十个默认值铺出来 —— 社区读法是 `find(row => row.key === "theme")`，没写过的行给 `undefined` 才会让它走自己的兜底值。 |
| `$.tool.list()`   | `Promise<ToolInfo[]>`  | 这一刻 `ToolManager` 上注册的工具，`{ name, description, mcp }`，顺序就是模型看到的顺序；`mcp` 按工具名是不是 `mcp__<server>__<tool>` 判。                                                                                                                                                                                                                                                                                                                                      |
| `$.agent.list()`  | `Promise<AgentInfo[]>` | 这条会话派过的子代理，一条一个：`{ id, description, type, status, parentAgentId? }`。`id` 就是子代理事件里那个 id；`type` 是派它时用的子代理类型；`status` 取 `pending` / `running` / `idle` / `completed` / `failed` / `killed`（我们的 `initializing` / `active` / `completed` / `error` / `aborted` 逐一对上）。                                                                                                                                                             |

- 这两个清单仍**只读**：没有 `$.config.set`、没有 `$.agent.register`。会写的那三个 `$.tool.register` / `$.agent.spawn` / `$.model.complete` 各有自己的额度与生命周期，见「把我们自己的工具交给模型」「派子代理」「让模型替插件答一次」。
- `$.config.list()` 的值是**合并后**的（override > `AgentOptions` > Remote > 三层 `settings.json`），与 `$.settings.read()` 同一个数据源；它比后者多的只有「菜单会怎么画」—— `label`、`kind`、`isLocked`（被 Remote / override 那层钉住的键为真，菜单显示但拒绝改）。
- `$.agent.list()` 只列**还在的**子代理：任务被丢掉之后就不在列表里，与 Claude Code 的「until the engine drops its task」同语义。列表按派生的先后排。
- 三个都返回 `Promise`，一次读取无副作用、不占钩子预算（不碰 I/O 的只有 `agent.list`，另外两个读的是宿主内存里的快照）。

### 会话事实：id、根目录、模型

`$.session` 上除了 `usage()` / `cwd()`，还有七个只读事实，插件拿它们做键、做标题、做上报：

| 方法         | 值                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id()`       | 这条会话的 id（`/clear` 与恢复会话后会变，所以**要用时现取**，别在 `session.start` 里存死）                                                                                                         |
| `root()`     | 会话工作根：`EnterWorktree` 会让它动，`cd` 不会                                                                                                                                                     |
| `model()`    | 当前生效的模型名（与 `$.session.usage()` 的 `model` 同一处解析，没配时是空串）                                                                                                                      |
| `surfaces()` | 这一刻有谁在画这条会话：`Promise<readonly RenderSurface[]>`，元素是 `"desktop"` / `"terminal"` / `"vscode"` / `"mobile"`，**空数组表示没有界面**（`wave -p` 这类一次性调用）。永远不会 reject       |
| `turns()`    | 用户已经发过几条 prompt（`Promise<number>`，从 0 起）。数的是**用户轮**，不含工具往返；`/clear` 之后重新计数                                                                                        |
| `repo()`     | 会话所在的 git 仓库：`{ root, remote, internal, name }`，`root` 是主工作树的绝对路径（在 worktree 里跑也给主树的），`remote` 是 `origin` 的 URL（没有就是 `null`）。**不在仓库里给 `null`，不抛错** |
| `version()`  | 引擎版本：`{ version, base?, builtAt? }`，`version` 是 `wave --version` 打印的那个，`base` 是它的语义核心（`1.6.6`），`builtAt` 是构建时间（本地源码跑没有这一项）                                  |

七个都返回 `Promise`（Claude Code 的同名方法也是异步的），一次读取不产生副作用。`turns()` 数的是 `MessageManager` 里 `role: "user"` 的**真实输入**（不含工具结果与系统注入），`repo()` 每次现读工作副本（不缓存，因为用户可能在会话中间 `git init`），`version()` 是编译期常量。`$.session.usage()` 与 `$.session.cwd()` 是既有的**同步**返回（一期已交付），与 Claude Code 那两处异步不同 —— 差异只影响 `.then()` 这种写法（`await` 两边都能用），不改。

`surfaces()` 给出三类答案：桌面端在画 ⇒ `["desktop"]`；IDE 聊天面板在画（VS Code 或 JetBrains）⇒ `["vscode"]`；终端 CLI 在画 ⇒ `["terminal"]`；`wave -p` ⇒ `[]`。几个端可能同时挂着（同一会话既开桌面端又从终端连），所以它给的是**数组**、按 surface 名字母序去重，插件要「择一」就取第一项。语义按「有界面」定义而不是「能画面板」：元素表按 `e.surface` 选，读它的插件不需要改。

- **它是「有没有人看得见」的唯一诚实答案**，`$.ui.open()` 的 `isPlaced` 与它同一个数据源（见「面板放得下吗」）。守卫类插件必须在拦下之前问一次：没人看得见就别把命令冻在那儿等一个永远没人按的按钮。
- **空数组不是错误**：Claude Code 对它明确写了「never rejects」，`wave -p` 也是正常会话。所以调用方别用 `try/catch` 兜，直接判 `length`。
- **CC 的 `$.session.surface()`（单数）已 deprecated**，被返回数组的版本取代；**我们不提供单数版本** —— deprecated 的东西不跟进，免得同一件事两种读法。社区里还在调它的插件（13 处）改成 `(await $.session.surfaces())[0]` 就是一行的事。

### 外部进程

mod 的沙箱里没有 `child_process`，要跑外部程序只能走 `$.process.spawn`。与 `$.clock` 同一条纪律：进程归宿主所有，会话销毁或插件重载时由宿主统一杀掉；裸 `spawn` 会留下孤儿进程，然后打到已经销毁的会话上。

- `spawn({ argv, cwd?, env?, input? })` 返回一个异步可迭代对象，逐块产出 `{ stream: "stdout" | "stderr", text }`；迭代正常结束时返回 `{ code, signal }`，进程起不来或被宿主拒绝时抛错。形状与 Claude Code 的 `$.process.spawn` 一致（它的生成器同样 yield `text` 块、`return { code, signal }`）。
- `argv` 是**参数数组、不走 shell**；要用 shell 就显式写 `argv: ["bash", "-lc", cmd]`。
- `cwd` 默认会话工作目录；`env` 与宿主环境取并集，显式给的值覆盖。`input` 给出时写进 stdin 然后关闭（一次性输入，不支持长连 stdin）。
- **等 I/O 不计入链的预算**：`for await` 停在下一块输出上的时间算空闲，那个钩子的 5 秒预算在这段时间里暂停，所以「起一个长跑进程、在钩子或元素回调里逐块消费它」是最正常的写法，不会一动就超时；预算只算 mod 自己干活的时间。`run` / `fs` / `http` 的等待同理。与 Claude Code 把 `process.spawn` 的预算标成 `pull`、把 `$.clock.sleep` 之外的时间排除在事件预算外是同一条规则。
- 进程退出后句柄不可复用；要重连就再 `spawn` 一次。一个 mod 同时最多 4 个子进程（`run` 在它跑完之前也占一个名额）。
- **结束一条流就是结束那个进程**：`for await` 里 `break`，或者从别处对同一个迭代器调 `return()`（面板上的「断开」按钮就是这么写的），都会**立刻**给子进程发信号、连它的子进程树一起收掉，不等下一块输出。这是 Claude Code 的 streaming pull/close 协议（v2.1.280 changelog）——`return()` 不能排在正在 `await` 的那次 `next()` 后面，否则一条静默的长跑进程（`tail -f` 那类）永远杀不掉。
- 子进程输出按块读、不做行切分：要行协议就自己按 `text` 拆分（外部脚本用 `console.log` 打一行 JSON 是最省事的接法）。
- `run(argv, { cwd?, env?, stdin?, timeoutMs? })` 是「跑完拿结果」的那一半：一次调用 resolve 到 `{ exitCode, stdout, stderr, isStdoutTruncated, isStderrTruncated }`，**退出码非 0 也 resolve**；程序起不来或超时报错（超时先把进程树杀掉）。默认 30 秒、最多 10 分钟；stdout / stderr 各留 4 MiB，超出部分丢弃并把对应的 `is…Truncated` 置真。`stdin` 一次性写入后关闭。形状与 Claude Code 的 `$.process.run` 一致（它用 `stdin` 而 `spawn` 用 `input`，这个不一致也照抄）。

### 读写文件

沙箱里没有 `fs`，`$.fs` 是唯一入口。相对路径按**会话工作目录**解析（与 `spawn` 的 `cwd` 默认一致），绝对路径原样使用。

- `read(path)` 返回 `string`；`read(path, { as: "bytes" })` 返回 `{ base64 }`（二进制走这条）。
- `write(path, text)` 覆盖写入，走 `atomicWrite`（临时文件 + rename），不留半截文件。
- `list(path)` 返回这一层的 `{ name, kind: "file" | "dir", size, isLink }`，不递归。
- `stat(path)` 返回 `{ kind, size, isLink }`；`exists(path)` 返回 `boolean`（不存在就是 `false`，不抛错）。
- 单个文件读写各 4 MiB。形状与 Claude Code 的 `$.fs` 一致。
- **插件自己的资源走 `$.plugin.root`**：那是插件目录的绝对路径，`$.fs.read(`${$.plugin.root}/hooks/weights.bin`, { as: "bytes" })` 是社区写法（camjac251/cc-enhanced 的钩子就这么取自己那份词表）。相对路径仍然按会话工作目录解析 —— 插件目录与会话目录是两个地方，别指望 `read("hooks/x.json")`。
- **不另设路径白名单**：同一插件的 hooks 本来就在跑 shell，mod 也能 `spawn` 任意命令读同一个文件 —— 加白名单只是让「读」比「读」更难，不提高任何安全性。这与「外部进程」的信任论证是同一条。

### 沿目录链找指令文件

`$.fs.ancestors({ names, of?, below? })` 回答「从这个文件往上，一路上都有哪些 `AGENTS.md`」，返回 `readonly FsAncestor[]`，**根目录在前**（与 Claude Code 同一个顺序）：

- `names` 是相对文件名（`["AGENTS.md", "CLAUDE.md"]`），每个目录里按这个顺序各找一次。**同目录的两个都命中时都给**，不去重、不挑一个 —— 「哪个优先」是调用方的事（我们的 `nestedMemory` 是 `AGENTS.md` 优先）。
- `of` 是起点文件（相对会话工作目录或绝对），走它的**所在目录**及每一级祖先；不给就走会话工作目录。
- `below` 是上界，只读它**严格内部**的目录；不给就走到会话工作目录为止（不走到文件系统根 —— CC 走到 `/`，我们不跟着走，读一整个 home 下的同名文件不是这个 API 的用途）。
- 每项是 `{ dir, name, content, parts }`：`dir` 是文件所在目录的绝对路径，`name` 是 `names` 里那个拼法，`content` 是文件正文，`parts` 是「这个文件 + 它 import 的文件」的序列。
- **一期不做 `@include` 展开**：`parts` 只有文件自己一条，`content` 就是它的原文。CC 的 `parts` 会把 `@path` 引来的文件一并列出、`content` 是拼接结果；我们还没有那套 import 解析，宁可少给也不给半份。

### 发 HTTP 请求

`$.http.fetch(url, options?)` 是 mod 访问网络的唯一方式（沙箱里没有 `fetch`）。

- **只允许 `https:` 与本地回环的 `http:`**（`localhost` / `127.0.0.1` / `[::1]`），与 `Link.href` 同一条白名单。明文 http 打远端直接报错 —— 否则一条命令就能把带 token 的请求发成明文。
- `options` 是 `{ method?, headers?, body?, timeoutMs? }`；返回 `{ ok, status, headers, text }`，`text` 是响应体原文、不解 JSON。
- 最多跟 5 次重定向，一次调用（含重定向与读完 body）最多 30 秒。
- 请求体 4 MiB（按字符数），响应体 4 MiB：超出时 `text` 只留前 4 MiB 并置 `isTruncated`；`Content-Length` 声明的长度超限则**直接报错**，不静默截断。
- 形状与 Claude Code 的 `$.http.fetch` 一致。

### 把 prompt 送进对话

`$.prompt.submit({ text, asUser: true })` 把一条消息投进当前会话，这是整条「外部事件驱动对话」链路的最后一米：

- 语义就是用户自己发了一条：会话空闲时立刻开新一轮，忙时按 `Agent.sendMessage` 的既有规则入队。投递只有「入队」与「执行」两种结果，没有第三种。
- `asUser` 一期只接受 `true`。Claude Code 在 `asUser: false` 时会在正文前加一句「由 XX 发送」，那需要一个「消息来源」块，本期不做；传 `false` 或省略直接报错，而不是静默降级成用户发言。
- 不做 Claude Code 的「中断后拒收」回执（`{ drop }`）：我们的投递不会因为用户按了 Esc 就把在队里的消息丢掉。
- **它投进去的这条 prompt 不触发 `prompt.submit` 事件**（那个事件只对用户敲的话发）：否则 mod 在钩子里再 submit 一次就是无限环。它开的那一轮里 `turn.start` / `turn.step` 照常发，所以「投完再观察自己造成的那一轮」仍然做得到。

### 收掉一轮（`$.turn.abort`）

`$.turn.abort({ turnId })` 是 `$.prompt.submit` 的反向操作：插件发现「这一轮不该继续跑了」（自建的超时、外部信号、盯到一个不该出现的命令）时，自己把它收掉，不必等用户去按 Esc。

- **`turnId` 是 `turn.start` 给的那个**：形状照 Claude Code（`{ turnId }`），不匹配时 reject 并同时报出两个 id —— 插件手里那个 id 可能已经过期（上一轮早就结束了），把「收掉此刻这一轮」按旧 id 执行会杀掉用户刚发起的新一轮。
- **收掉 = 模型请求中断、正在跑的工具停掉**，与用户按 Esc 收到的效果一致；被收掉的那一轮照常发 `turn.complete`（`isAborted: true`）与 `classic.Stop`，所以「我收的」这件事在事件里是看得见的。
- **不动的两样**：用户已经排队的消息照旧留在队里（下一轮再说），Bash 常驻命令与斜杠命令不跟着断 —— Esc 会顺手把它们也停掉，插件手上没有「用户按下去了」这个事实，越界替它做决定反而更糟。
- **没有一轮在跑时**（模型在等用户输入）reject，而不是静默成功：插件的超时逻辑靠这个异常分辨「我收掉了」与「本来就没事」。

**信任。** `spawn` 让 mod 能执行任意命令，但它不引入新的信任层级——同一个插件的 hooks 本来就在跑 shell（`services/hook.ts` 的 `executeCommand`）。变的只是 mods 也能做同一件事，而插件安装时用户已经在授予这个权限。

### 把草稿填进输入框

`$.prompt.fill({ text, mode? })` 把文本放进**用户正看着的那个输入框**，当草稿、**不发送**，返回 `{ isFilled }`：

- 与 `submit` 是两件事：`submit` 替用户按下回车（开一轮、进上下文、不可改），`fill` 只是把字打好，什么时候发、发不发都由用户决定。所以 `fill` 不改会话状态、不开轮次、不进上下文。
- `mode` 一期三档，语义与 Claude Code 同名：`replace`（默认，替掉整份草稿）、`append`（接在草稿后面）、`insert`（插在光标处；编辑器没聚焦时按末尾算）。光标落在填入的文本之后，用户可以接着打字。
- **`isFilled: false` 是正常结果，不是错误**：终端 CLI、宿主没接这条通道、审批卡片或问答对话框正占着键、输入框还没挂上，都会返回 `false` 而不是抛错——mod 拿到 `false` 就知道这次没落地，可以自己降级（改成 `$.ui.toast` 或 `$.prompt.submit`）。
- **5 秒没有回执按 `false`**：与 Claude Code 同一时限。晚到的回执不改变已返回的结果，也不会把文本填第二次。
- 文本允许空串（`replace` 空串 = 清空草稿）；`mode` 传了不认识的值当场报错并列出可用值。
- 一期是 Claude Code 的**子集**：不做 `decorations`（给填入的文字涂色）、`cursor`（指定光标落点）、`answers_press`（回指某次按键）。那三样要么依赖 composer 的富文本区间绘制，要么依赖「一次按键」的标识，与「把字打好」不是一件事。

### 输入框里现在有什么

`$.prompt.read()` 返回 `{ text, cursor }`：用户打到一半的草稿，和下一个字符会落在哪（`text` 里的 UTF-16 偏移）。

- 与 `fill` 是同一条通道的两头：`read` 读、`fill` 写、`submit` 替用户按回车。三个都**不消费**草稿。
- **永不 reject**：终端 CLI、`wave -p`、输入框还没挂上、3 秒没有回执，一律给 `{ text: "", cursor: 0 }`。社区写法是 `(await $.prompt.read()).text` 直接取，抛错会让他们整个钩子挂掉。
- 空串是「输入框是空的」还是「没有输入框」，调用方分不出来 —— 这是刻意的：CC 也一样。要区分就问 `$.session.surfaces()`。
- `fill` 填进去的字**立刻**能从 `read` 读回来（同一条通道，不走另一份缓存），所以「填完再读一遍确认」是合法写法。

### 输入框里的建议（`prompt.suggest` / `prompt.edit`）

两个事件让 mod 看见「用户正在输入框里做什么」，都能改写：

| 事件             | 时机                                                                                                                       | 返回                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `prompt.edit`    | 用户在输入框里做完一次编辑（一次按键、一次粘贴、一次删除），`e` 是 `{ origin, key?, text, cursor, start, end, inputText }` | `next(e)` 解析到 `{ text, cursor }`：改写后的输入框；外层返回自己的那份也算数 |
| `prompt.suggest` | 一个建议要摆进输入框（用户打字后的推荐、或某个 mod 的 `$.prompt.suggest`），`e` 是 `{ text, origin }`                      | `{ isShown: boolean }`：这次建议摆没摆上                                      |

- **`origin` 是两处同一个形状**：`prompt.edit` 恒为 `{ kind: "composer" }`（人是唯一来源）；`prompt.suggest` 取 `{ kind: "suggestion" }`（引擎自己的推荐）或 `{ kind: "plugin", name }`（某个 mod 调的 `$.prompt.suggest`）。`next(e)` 原样传下去，任何钩子都不改它。
- **`prompt.edit` 的改写**：`next({ ...e, text })` 是「把这次编辑应用到另一份草稿上」、`next({ ...e, inputText })` 是「换成别的字」，光标落在它后面；不调 `next` 直接返回 `{ text: e.text, cursor: e.cursor }` 等于**吃掉这次按键**（拼写检查、语法闸门就这么写）。
- **`prompt.suggest` 不返回文本**：换一个建议靠 `next({ ...e, text })`。返回 `{ isShown: boolean }` 且不调 `next` 就是**最终答案**：`false` 是不摆，`true` 是「我摆上了」—— 宿主不再自己问输入框（CC 的 core 以 `isShown` 为结果键，谁给出合法的它，链就收敛）。要问宿主摆不摆就别返回它，走 `next(e)`。宿主摆不上有确定的原因：输入框里已有字、一轮正在跑、文本是空白、没有输入框（headless）、对话框占着键或输入框被禁用（此刻用户看不见草稿）。
- **三端差异**：桌面端与 webview 两件都发；**终端一律不发**（`prompt.edit` / `prompt.suggest` 与用户正在打字直接冲突，与 `$.prompt.read` 在终端「刻意不做」是同一条理由）。mod 用 `$.session.surfaces()` 判断要不要挂这些钩子。
- **焦点不在这条通道上**：`prompt.edit` 问的是「用户正在改输入框」，与面板里的焦点无关 —— 焦点环的事归 `ui.focus`（见「控件的交互事件」，我们只做它的事件形态）。要看「用户在打字」用 `prompt.edit`。
- **与 `$.prompt.fill` 的关系**：`prompt.suggest` 只是「提议」，用户按 Tab 采纳才进输入框；mod 想直接写进去仍要调 `$.prompt.fill`（同一条草稿状态，所以两边不会打架）。`$.prompt.suggest({ text })` 是这条事件的方法形态，与引擎自己的推荐走同一条链，`e.origin` 标明是谁提的 —— 否则 mod 容易自己触发自己。

### 会话用量

`$.session.usage()` 返回一份**只读快照**，让 mod 能自己把「这次会话用了多少」画成带、状态行或面板：

| 字段                   | 含义                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| `context.tokens`       | 上下文占用：最近一次带 usage 的响应报出的总数                     |
| `context.window`       | 当前模型的上下文窗口                                              |
| `context.percent`      | 压缩压力百分比（0–100 整数；分母是自动压缩阈值，见下）            |
| `tokens.prompt`        | 整场会话累计的 prompt token（**含**缓存命中的那部分）             |
| `tokens.completion`    | 累计的 completion token                                           |
| `tokens.cacheRead`     | 累计的缓存命中 token                                              |
| `tokens.cacheCreation` | 累计的缓存写入 token                                              |
| `startedAt`            | 这条会话开始的时刻（epoch 毫秒），算「本场跑了多久」用            |
| `rateLimits`           | 额度窗口数组：有企业端额度响应头时是真实窗口，没有时是 `[]`，见下 |
| `model`                | 当前模型名，没配时字段缺省                                        |

- **`percent` 的分母是自动压缩阈值，不是 `window`**（`getAutoCompactThreshold`，画到 100% 正是压缩要发生的地方）。**它与图形界面输入框旁那个用量环口径不同**：2026-11-26 起环与 `/context` 浮层统一用窗口分母（同一个会话只给用户看一个百分比，见 [message-compact.md](../core/message-compact.md)「用量百分比的分母按端分工」），所以 mod 想把「窗口用了多少」画成进度条时请自己算 `tokens / window`，别把 `percent` 当成环的读数；想报「离压缩还有多远」才用它。CLI 输入框上方那一格是同一分母的**反向**读数（`N% until auto-compact`，`remainingPercentOf`），所以 `100 - percent` 就是那一行此刻的数字。
- **字段名按我们自己的口径写死**：我们上游的 `prompt_tokens` 已经包含缓存命中，Claude Code 的 `input_tokens` 不包含，两者不能互换，所以这里不叫 `input`/`output`。
- **现取现算、不订阅**：每次调用返回一份新快照，mod 改它伤不到会话；要看它变化就在 `$.clock` 的节拍里或 `ui.render` 时再问一次。也不产生一次渲染请求——mod 拿到数字后自己决定要不要 `invalidate`。要「变化时被叫醒」用下面的 `session.measure`。
- **`rateLimits` 是真实读数，没有可报的窗口时才是 `[]`**：形状 `{ kind, percentUsed, resetsAt? }[]`，源是模型响应上的企业端额度头（`x-codechat-quota-*`，成功与错误响应都带）。几点口径写死在这里：
  - `kind` 是**我们上游的窗口名**：`weekly` / `monthly`（自然周 + 滚动月）。**不要**对成 Claude Code 的 `five_hour` / `seven_day` —— 那两个是 5 小时滚动窗与 7 天窗，不是我们的窗口；按 `kind` 分支的社区 mod 至少能认出「这是个周窗」。
  - 顺序固定 `weekly` → `monthly`：周窗更紧，mod 取 `rateLimits[0]` 当「代表窗口」时拿到的是更可能先触顶的那个。
  - `percentUsed` 是 0–100 的数字，超额时夹在 100（不原样透传上游 >100 的比例，免得 mod 算 `100 - percentUsed` 得到负余量）；`resetsAt` 是毫秒时间戳，上游没给这个窗口的重置时刻就**不出现**这个字段（不是给 `0`）。
  - **一个额度头都没有时是空数组**（私有化部署、自定义网关、中间层剥掉了自定义头）：那是「这个账号没有配额窗口可报」的真实读法，不是缺陷 —— 不报错、不打日志。社区的写法是直接 `.reduce` 这个字段，空数组正好安全。
  - 只报「窗口」，不报充值余额（余额没有重置时刻，不属于额度窗口的语义）。
- 不给消息列表与 `send`/`append`（那些是「改会话」，与只读快照不是一回事）。

### 用量的变化（`session.measure`）

`$.session.usage()` 要 mod 主动问，而带式的 mod（输入框上方那条带）只在被要求渲染时才醒 —— 于是「这一轮烧了多少」这类内容会慢半拍。`session.measure` 补这一半：**每次带 usage 的模型响应回来、token 计数更新之后**发一次，`e` 就是那一刻的 `$.session.usage()` 快照外加一个 `changed` 字段：

| 字段      | 含义                                                                |
| --------- | ------------------------------------------------------------------- |
| `changed` | 这一拍变了哪些部分，`"context"` / `"tokens"` 的子集（一期两个都给） |
| 其余      | 与 `$.session.usage()` 的字段逐个相同                               |

它解决的是「被叫醒」，不是「拿到数字」—— handler 里仍可以直接 `$.session.usage()` 再取一份（两者同一处解析，值一致），要重画就 `$.ui.invalidate("ui.render")`。返回值忽略；它是 fire-and-forget 的瞬时事件，不重放（切会话、webview 重建不补发）。名字沿用 Claude Code 的同名事件，`changed` 是它的字段。子代理的嵌套轮次**不报**（它用的是自己的那一层，mod 只关心主会话这一条）。

### 面板的归属（会话维度）

面板挂在**开它的那个会话**上：每个会话各有一份 mod 实例、一份面板；`$.state` 不跨会话，`$.store` 跨会话共享。这与 Claude Code 一致（它的 render site 全在会话内，跨会话只有 `$.store` 与 `$.session.send`），也是本规格不做全局面板的原因。

- 用户切到别的会话，这个会话的面板不显示；切回来还在（会话没销毁）。
- **新建会话永远由用户自己发起**（侧栏「＋」/`Cmd/Ctrl+N`）。mod 没有「新建会话」的能力，也没有任何请求宿主开新会话的通道：外部事件到达时，用户先新建一条会话、再打开面板控制，这是本规格明确接受的降级路径。新会话加载同一插件、再跑一次 `session.start`，于是面板在新会话里自己长出来（读同一个 `$.store`），不需要用户手动再开。
- 多会话并行时同一个 mod 有多份实例、多份定时器盯着同一个 store 文件。插件作者写 `$.store` 要按「整份覆盖」想并发，别让两个会话各自缓存一份再写回。

### 用户交互的结果

- 元素回调拿不到事件对象：`onPress()` 无参，`onSubmit(value)` 只有用户输入的字符串。想知道是哪个面板，用 `$.ui.panes()`，或在创建时把 `paneId` 闭包进回调。
- 回调返回后，若 `$.state` 或 `$.store` 变了，宿主**不**自动重画；mod 需要显式 `$.ui.invalidate("ui.render")`（避免每个回调都触发一次渲染）。
- 一次 `invalidate("ui.render")` **作用于这个 mod 的所有渲染站点**，不只是面板：
  - 每个已登记的面板各发一条 `modPanelUpdate`（`stale`，不带树），surface 收到后对该 pane 发一次 `modPanelRender`；
  - 带也各发一条（`paneId` 是固定值 `above-prompt`），surface 收到后重拉一次带。
    这是**带唯一的重画通道**：surface 平时只在挂载时拉一次带，没有 `invalidate` 就永远停在第一帧。目标只有两个：`"ui.render"`（面板与带，上面这些）与 `"tool.describe"`（让这场会话里存着的那份工具描述失效、之后拼工具表时重问，等价于 `breakPromptCache: true`）；传别的值当场报错，不是安静地什么都不做。
    CC 的 `invalidate` 还认另外六个目标，我们都不支持：`prompt.*`（系统提示词那几个生产者）与 `command.describe` 在这边是**每次现算**的，没有缓存可清，认下来只是一句空调用；`tool.list` 与 `config.describe` 连对应的事件都还没有（它们只有 `$.tool.list()` / `$.config.list()` 这两个只读方法），没有生产者可通知。
    回复里带递增的 `revision`，webview 丢弃比当前显示版本更旧的回复。
- 一个 pane 的**第一次** `modPanelRender` 回复到达时，桌面端会展开右侧面板槽并激活该 tab（与用户从「＋」菜单打开同一个效果）—— mod 申请的面板不该还要用户自己去点开。后续回复只更新内容，不抢当前焦点。
- 回包带 `error` 时，面板顶部叠一条错误摘要，**同一回复里给的是上一帧成功的树**（仍可操作）；下一次请求成功后摘要自动消失。把整棵树换成一行错误文字会让面板一次性报废（用户连别的按钮都点不到），不做。
- `Button` 可以带 `hotkey`（一个小写字母或数字，`/^[a-z0-9]$/`）：面板**有键盘焦点时**按这个键等于点了它 —— 守卫类插件最常用的形态（`y` 放行 / `n` 拒绝，用户不用先把指针挪过去）。只收单字符是因为它是裸按键，带修饰键的组合留给宿主自己（`Ctrl+C` 那类）；焦点在 `Input` 里时所有可打印键都归输入框。同一帧里两个可见 `Button` 撞同一个 hotkey 时**后写的那个**赢（与 Claude Code 一样），另一个不响应 —— 撞键不算校验错误（树是动态的，不同状态下可见的按钮本来就会变）。

## 兼容社区 mod（布局、注册签名与裸名 import）

社区里现有的 mod 不是按这份规格写的。为了让**已有的 mod 不改一行就能跑**，加载层认两种形状，语义仍是上面那一套。

**布局**：除 `.wave-plugin/plugin.json` + `mods/*.tsx` 之外，也认 `hooks/hooks.json` 里的模块声明 `{ "modules": ["./register.tsx"] }`（社区插件的写法，一个插件可有多个模块，等价于我们的「一个插件多个 mod」）。**`modules` 里的路径相对 `hooks/` 目录**，不是相对插件根 —— `./register.tsx` 就摆在 `hooks.json` 旁边。同一个 `hooks.json` 里的 `hooks` 段（settings hook 事件）与 `modules` 段互不相干，可以共存；两处指向同一个文件时按 realpath 只收一次，stem 撞名时先到先得并记一条 warn。manifest 目录名两种都认（`.claude-plugin/` 已有回退）。`plugin.json` 里的 `userConfig` 是配置 schema（`type` / `title` / `description` / `default`）：`register` 收到的 `options` 一期**只是 schema 里的 `default`**（没有「用户改值」的存储，界面上也还没有这一栏），schema 里没写 `default` 的键不出现。

**注册签名**（两种都认，按实参形状区分）：

| 形状                    | 谁的   | `$` 从哪来                   |
| ----------------------- | ------ | ---------------------------- |
| `register($, on)`       | 我们的 | 第一个参数                   |
| `register(on, options)` | 社区的 | handler 的第一个参数（见下） |

**handler 签名**（按**哪个实参被当成登记函数**区分，不看形参个数 —— 两种形状互斥：我们的用第二个实参当 `on`，社区的把第一个实参当 `on`，因此同一个 `on` 登记出来的 handler 形状是确定的）：

- `(e, next)` —— 我们的形状（`register($, on)` 登记），返回值语义仍按「事件」那张表；`next` 与社区那个同义（交给链上的下一个 mod / 引擎；`tool.call` 下它就是执行本身）。第二个形参是后来补的：没有它，按我们推荐写法写的守卫只能看见调用、看不见结果（`tool.call` 里拿不到 `next(e)` 交回的那份结果），而社区写法有。老 mod 少写一个形参不受影响。
- `($, e, next)` —— 社区的（`register(on, options)` / `Register = on =>` 登记）。**社区 handler 可以只写一个形参**（`on("command.run", matcher, async $ => …)`，社区真 mod 就这么写），那一个形参就是 `$`：按形参个数判形状会把它当成我们的 `(e)`，`$` 会变成事件对象。`next(e)` 把这次事件交给链上的下一个 mod / 引擎：`ui.render` 下它返回**引擎自己那一帧**（只有宿主本来就会画的站点才有；`Pane` / `AbovePrompt` 是留给 mod 的空间，`next(e)` 返回 `undefined`），mod 可以返回自己的树去替换它，也可以把 `next(e)` 的结果包一层再返回；`tool.call` 下它返回链上后面的 mod 的决议（没人拦就是**空对象**），所以守卫要先看 `ran.deny` 再决定自己要不要返回 `{ deny }`；其余观察型事件（`turn.*` / `session.*`）下它同样返回**空对象**而不是 `undefined` —— 社区 mod 会 `await next(e)` 之后读 `ran.deny` / `ran.isError`，给 `undefined` 会当场抛属性错误，空对象正好表达「引擎没有意见（也就没有拒绝、没有报错）」。一次 handler 最多调一次 `next(e)` —— 再调当场报错（否则链会跑两遍）。
- **`next(e)` 收下改过的事件**：社区最常见的写法是 `return next({ ...e, context: [...] })`（burn-rate 的限额提醒就是这样注入上下文的）。链尾的引擎帧按**走到那里的那份事件**算 —— `prompt.submit` 取 `e.context` 还成 `{ context }`，`command.run` 取 `e.text` 还成 `{ text }`，所以 mod 把改动交给 `next`、自己不拼返回值也能生效。丢掉这份改动会让注入静默失效。

**同一条事件可以挂多个 handler**（不分社区还我们，按注册顺序串成一条链；第一个匹配上的 handler 的返回值就是结果）。`on(name, handler)` 返回一个可以 `.catch(handler)` 的注册凭据：handler 抛错（含 5 秒预算超时）时用它兜底，兜底自己也抛才算这条钩子失败。社区的写法是 `.catch(function ($, e) { … })`，兜底与它所在的那条钩子同形状（同一个 `on` 登记出来的）。

**matcher**（第三个实参，社区写法 `on(name, matcher, handler)`）：只对这几个事件有意义 —— `ui.render`（`{ component, requestId }`）、`ui.press` / `ui.input` / `ui.select`（`{ plugin, element }`，Claude Code 的写法）、`tool.call`（`{ tool }`）、`command.run`（`{ command }`）。语义是**事件字段的子集匹配**，值可以是一个候选值数组（命中任一即匹配）。单个值按 CC 的同一套比：标量是 `===`（`command` 两边归一后比），`RegExp` 是把事件值当字符串 `test`（社区 mod 写 `{ command: /git\s+commit/ }` 就是这个意思），事件值是对象时 matcher 里给对象按**对象偏匹配**递归比；事件的字段名就是 Claude Code 钩子里的名字（`requestId`，没有别名），matcher 与 handler 读的是同一个字段。没匹配上的钩子**不参与**这次事件（不是「参与但拿不到值」）。`command.run` 的 matcher **可省**：省了就是「这个 mod 注册的每条命令都问它」，钩子自己比 `e.command`（社区真 mod 就这么写）；写了就带不带斜杠都认、内部归一。给别的配对不上 matcher 的钩子传 matcher 会记一条 warn 并忽略这条注册。

**裸名 import**：`wave-agent-sdk/mods` 是我们对外推荐的名字；社区的 `'claude-code'` 作为**别名**解析到同一个模块 —— 不引入那个 npm 包，也不解析 `node_modules`。除元素构造器，该模块还导出三个助手：

- `atom({ plugin, key }, initial)`：声明一个存在 `$.store` 里的值（键是 `<plugin>/<key>`）；
- `read($, atom)`：读出来；键不存在或 JSON 解析失败都返回 `initial`；
- `update($, atom, value | (prev) => next)`：写回去。

`atom` 的值走 JSON 序列化，因此受 `$.store` 的体积约束（见「限额」）。

## 限额

宿主侧强制，超限**不画**并给出可见错误（面板错误态 + `wave` 日志里的原因），不静默丢弃。

| 限额                              | 值                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单个 mod 文件                     | 1 MiB                                                                                                                                                            |
| 一个插件所有 mod 文件总量         | 4 MiB                                                                                                                                                            |
| 文件数                            | 64                                                                                                                                                               |
| 元素树节点数                      | 2000                                                                                                                                                             |
| 元素树深度                        | 24                                                                                                                                                               |
| 树内文本总量                      | 100,000 字符                                                                                                                                                     |
| `Link.href`                       | 2048 字符                                                                                                                                                        |
| `Svg.source`                      | 131,072 字符（与 Claude Code 同一个数）                                                                                                                          |
| `Svg` 的 `width` / `height`       | 各 4096px（同上）                                                                                                                                                |
| `Select.options`                  | 1–64 项，`value` 必须唯一                                                                                                                                        |
| 一条钩子链的执行时间              | 5 秒**每次派发**（不是整条链共用一份，见「`next`」；调 `next()` 期间与等外部进程输出、等人按键这类与 mod 无关的等待不计；超时视为这一层失败，事件按无 mod 处理） |
| 面板每次 `invalidate` 的最小间隔  | 100ms（更快的调用合并）                                                                                                                                          |
| 定时器最小间隔                    | 200ms（更小的值夹到 200ms）                                                                                                                                      |
| 一个 mod 同时活跃的定时器         | 16（超出时新建定时器报错）                                                                                                                                       |
| `$.clock.sleep` 单次等待          | 10 分钟（更长的夹到 10 分钟）                                                                                                                                    |
| 一个 mod 同时未完成的 `sleep`     | 16（与定时器分开计；超出时 `sleep` 报错）                                                                                                                        |
| `$.env.get` 的变量名              | 256 字符（更长的按没设置处理，返回 `undefined`）                                                                                                                 |
| `$.settings.read` 的返回值        | 4 MiB（超出报错，不截断 —— 截断的配置是错的配置）                                                                                                                |
| `prompt.submit` 返回的 `context`  | 32 条、合计 100,000 字符（超出丢弃多余的并记一条 warn）                                                                                                          |
| 一个 mod 同时活跃的外部进程       | 4（`run` 跑完前也占一个；超出时 `spawn` / `run` 报错）                                                                                                           |
| 外部进程单块输出                  | 64 KiB（更长的块切开）                                                                                                                                           |
| 一个外部进程累计输出              | 4 MiB（超出后停止读取并杀掉该进程）                                                                                                                              |
| `$.process.run` 超时              | 默认 30 秒，最多 10 分钟                                                                                                                                         |
| `$.process.run` 的 stdout/stderr  | 各 4 MiB（超出置对应的 `is…Truncated`）                                                                                                                          |
| `$.fs.read` / `$.fs.write`        | 单个文件 4 MiB                                                                                                                                                   |
| `$.http.fetch` 请求体 / 响应体    | 各 4 MiB（响应体超 `Content-Length` 声明即报错）                                                                                                                 |
| 一次 `$.http.fetch`               | 30 秒（含重定向与读完 body），最多 5 次重定向                                                                                                                    |
| `$.ui.status` 的一行              | 10,000 字符（超出截断并加省略号）                                                                                                                                |
| `$.ui.toast` 停留时间             | 默认 4000ms，`timeoutMs` 最多 10 秒（我们的限额）                                                                                                                |
| 同时排队的 toast                  | 50 条（溢出丢弃未展示的旧条；同屏显示 1 条）                                                                                                                     |
| 输入框上方的带                    | 一个 mod 一条，树与节点限额同面板                                                                                                                                |
| 终端的面板正文 / 每条带           | 一次最多 12 行 / 6 行（见「终端形态」，超出在端内滚动）                                                                                                          |
| `$.ui.log` 的一行                 | 10,000 字符（超出截断并加省略号）                                                                                                                                |
| `$.store` 的单个值                | 4,194,304 个字符（`JSON.stringify` 之后的长度；与 Claude Code 同一个数与同一个算法。超出、含环、顶层 `undefined` 都报错，不截断 —— 截断的值是错的值）            |
| 一个 mod 注册的命令               | 32 个（超出报错）                                                                                                                                                |
| 一个 mod 注册的工具               | 16 个（超出报错）；`description` ≤ 2000 字符、`inputSchema` ≤ 16 KiB（超出报错并把实际数字写进错误）                                                             |
| 一个 mod 同时活跃的子代理         | 4 个（超出 `$.agent.spawn` 报错）；mod 派的子代理不再派子代理（深度 1）                                                                                          |
| `$.model.complete` 的调用次数     | 每条会话每个插件 50 次（超出当场 reject —— 那是「这次请求根本没发出去」，不是 `reason: "budget_exceeded"`）                                                      |
| `$.model.complete` 的 `maxTokens` | 4096（超出夹到这个数）                                                                                                                                           |
| 一次 `$.model.complete`           | 缺省不设超时，`timeoutMs` 最多 5 分钟（这条调用不占那个钩子的 5 秒预算）                                                                                         |

## 加载纪律

- mod 的 import 只允许**相对路径**与 `wave-agent-sdk/mods`（元素构造器表 + `atom`/`read`/`update`）；社区的 `'claude-code'` 是它的别名，其他裸包名直接报错。
- 动态 `import()` 在 CJS 产物里同样变成 `require`，因此受同一条白名单约束。
- 相对 import 只在**该插件本次参与编译的文件集合**里解析（不读 `node_modules`）；`.js` / `.jsx` 说明符也认同名 TS 源码（`./x.js` → `x.ts` / `x.tsx`）。环形 import 按 CJS 语义解 —— 后来者拿到前者**当时已写下**的 `exports`，不整片失败（社区多文件 mod 里这种真环很常见）。
- 同一插件里两个**入口**文件重名时只留先到的那个（记一条 warn）；被 import 的兄弟文件重名不影响，各自带后缀留在编译集里。
- 文件解析走 `realpath`，解析结果必须落在插件目录内，越界即拒绝。
- 编译或加载失败：该 mod 不生效，其余 mod 与插件其他能力不受影响；失败原文进 `wave` 日志，并**占一个错误面板**（`paneId` 为 `error`，标题是文件名，内容是一行摘要）—— 否则用户只会看到「面板没出现」。
- 只注册 `ui.render` 而从不 `$.ui.open` 的 mod 不产生面板，日志记一条 debug。

## 内置插件与默认开关

内置插件是随二进制分发、不可卸载的那一档，以 `<name>@builtin` 登记（`sdd`、`diff`）。它们的**默认开关由插件自己声明**，不写死一个全局值：

| 插件   | `defaultEnabled` | 理由                                                                                                  |
| ------ | ---------------- | ----------------------------------------------------------------------------------------------------- |
| `sdd`  | `false`          | 规格优先工作流会改变模型的写码节奏，用户得主动选用；不想要的人不该被它影响                            |
| `diff` | `true`           | 它就是终端 `/diff` 的载体（见 [diff-command](../commands/diff-command.md)），关掉等于删掉一条内置命令 |

判定顺序是「显式配置 > 插件策略 > 关」：`enabledPlugins["<name>@builtin"]` 写了布尔值就照它（`true` 开、`false` 关），没写才落到 `defaultEnabled`，策略里也没写就是关。**与 Claude Code 同一条口径**（它那边是 `defaultEnabled ?? true`，我们缺省取 `false` 只是因为不想让「新增内置插件」默认改变用户行为，所以每个想默认开的都必须在策略表里写明）。写 `false` 显式关掉一个 `defaultEnabled: true` 的插件是受支持的档，设置页里它与 `sdd` 一样能切。

## 生命周期

- `session.start` 在会话初始化完成、第一个 prompt 之前跑一次；面板在这一刻登记。
- **每挂载一次就跑一次**：新建会话、切回旧会话、webview 重建、`/reload-plugins` 都会重新走一遍。所以 `session.start` 里要幂等 —— 恢复状态读 `$.store` 就好，别每次追加一条 `$.ui.log`（对话流里会看到重复的行）。
- `/reload-plugins` 会**重建**所有 mod：旧面板逐个发 `ui.close`（见「事件」）后由宿主内部关掉（webview 上的 tab 随 `closed: true` 消失、旧实例的定时器与回调表一并丢弃），再按新插件列表重新加载与 `session.start`。
- 会话结束 / agent 销毁：宿主内部关掉所有面板并丢弃该会话的 mod 实例，此后发来的一切交互静默丢弃。
- 会话结束与 `/reload-plugins` 同时撤销该 mod 的所有 `$.clock` 定时器（见「定时器」），销毁后不再有回调。
- 同一时刻也杀掉该 mod 的所有外部进程（连同其子进程树），与定时器同一条纪律：进程不能活过开它的会话。
- surface 重建（webview 重载、终端重新挂载或改变尺寸）后 surface 自己对每个 pane 重新请求一次，用户不需要等 mod 下一次 invalidate 才能看到面板；宿主不主动推树。

## 在 IDE 插件里画

IDE 聊天面板（VS Code 与 JetBrains）是第二个 surface，`e.surface` 是 `"vscode"` —— 两端画的是同一份 webview 产物，所以元素表、布局、下面这些端差对两个宿主完全一样；宿主侧只是各自的传输接线不同。它画同两个站点（`Pane` / `AbovePrompt`）、同一棵元素树，差在落点与几种绘制 prop：

- **`Pane` 按聊天面板的宽度挑一种放法**，断点 `(min-width: 800px)`（与 Claude Code 同一个数）：宽于 800px 时 dock 在对话右侧、`e.props.placement === "dock"`，同时开着多个 pane 时出 tab 栏；更窄时落到输入框上方、`placement === "inline"`，显示 12 行后整体滚。`e.viewport` 在这一端**总是有值**（桌面端要等窗口量完），`columns` / `rows` / `e.props.bodyColumns` 都是这一端量出来的字符宽高 —— 窄面板的 `bodyColumns` 与 `viewport.columns` 差得很远，mod 正好可以据此换排布。
- **带、状态行、toast 在同一个栈里**，位置在输入框正上方；桌面端的三处落点（带在上、状态行在下、toast 右下角）到这里收成一处。每个插件一行 status（200 字符或 2 行截断），toast 500 字符截断（桌面端是 240）。有审批或对话弹窗时整个栈收起。
- **不生效的绘制 prop**：`Button` 的 `plain` / `variant` / `role` / `hotkey` / `autoFocus` / `action`、`Box` 的 `position` 与 `hover`、`Text` 的 `size` / `mono` / `tabular`。**按不写它画，不拒整棵树** —— 与 Claude Code 扩展同一个口径：这一端的按钮画成普通的可点方块，用户点击或按 Enter，不假装有快捷键。
- **不支持的能力**：`AbovePromptList` 站点（只在桌面端发）。`$.ui.notice` / `$.prompt.read` / `$.prompt.fill` / `$.ui.copy` 照常可用 —— `notice` 那行跟桌面端一样挂在同名工具块下面（同一份 webview、同一个 `toolUseId` 键），只是两端宿主都没有 pane，消息里不带 `paneId`。

**为什么 JetBrains 也归到 `vscode` 这个 surface 名下**：Claude Code 的 JetBrains 插件没有自己的聊天面板（它的 JB 端是内嵌终端，报 `terminal`），而我们的 JB 插件有真 webview 面板、与 VS Code 复用同一份产物。名字的作用是告诉插件「这一端能画什么」—— 两端能画的完全一样，所以共用一个名字，既不新增 Claude Code 面外的名字，也不让插件为两个宿主写分支。

## 交付分层（一期不做的事）

不做，且**接口不预留**（避免半成品）：终端专有的 `Raster`/`Image`、终端的侧栏两栏与拖动宽度、按列数决定的出现阈值、对话流消息/工具行/spinner 的重绘站点、`Client`（要在 webview 里执行 mod 附带的第二份模块，连带 `ui.message` / `ui.fault` 两个事件）、`$.mcp`、`$.agent.register`、`tool.call` 的**改写参数**（`updatedInput`）与**替用户批准**、`prompt.submit` 的改写 `text` 与 `drop`、`$.prompt.compose` 这个**方法**（要做的是同名的 `prompt.compose` / `prompt.section` **事件**，不是让 mod 自己拼提示词）、把焦点环挪到某个元素上（CC 的 `$.ui.focus` 方法：`ui.focus` **事件**我们做，见「控件的交互事件」；让 mod 主动挪环不做）、`prompt.autocomplete`（CC 那个「一次给一批补全候选」的事件：候选下拉的承载在多端宿主的文件补全通道里，mod 没有参与点，给个同名事件就是永不触发的空钩子）、mod 分层与加载期审查。

终端已有的降级（做，但不追平桌面端）：`Svg` 不画（见「终端渲染」）、`hover` 与 `absolute` 无效果、`$.prompt.fill` 仍返回 `{ isFilled: false }`、`$.prompt.read` 仍返回空草稿（终端的输入框状态没接到那条 RPC 上）——前三者是终端表达不出，最后一条是刻意不做：mod 替用户改输入框，在终端里与「用户正在打字」的冲突没法让它察觉。

Claude Code 的 `$` 有 23 个命名空间，我们覆盖 16 个（`ui` / `session` / `turn` / `prompt` / `clock` / `process` / `fs` / `http` / `store` / `state` / `command` / `env` / `settings` / `tool` / `config` / `agent`）。差的是三类，各自的理由：

- **改会话**：`$.session.send` / `append` / `compact`、`$.prompt.edit` 这个**方法**（我们做的是同名**事件**：观察用户怎么改输入框，不是替用户改）、`$.prompt.paint` / `compose`、`$.env.set`、`$.config.set`。这些不是「多一个方法」，而是「mod 能替用户改东西」，每一条都要单独想清楚可见性（改了什么用户看不看得见）与冲突（用户正在打字时 mod 改输入框）。（`$.turn.abort` 已做：它只收自己那一轮，不改用户输入、不替用户答审批，与 `$.prompt.submit` 对称。）
- **读更多会话内部**：`$.session.authorize` / `identity` 不做（绑账号身份，我们这条链上还没有对应物）。`$.session.messages` 这一批做了，但**不是**「把整份对话原样交出去」：最近 200 条、单条按限额截断，与 `$.session.usage()` 那种「一个数字」仍然是两个量级，所以限额是硬约束（见「会话消息」）。（`turns` / `repo` / `version` 已做，见「会话事实」；CC 的单数 `surface()` 已标 deprecated，我们不跟。）
- **我们没有的底座**：`$.agent.register`（注册子代理**类型**）、`$.mcp`（调 MCP）、`$.telemetry`、`$.theme`、`$.audio`、`$.flag`、`$.decision`。前两个要往模型的选择清单里加东西 / 缺 MCP 客户端，后几个依赖我们还没有的对应子系统。（`$.agent.list` / `$.config.list` / `$.tool.list` 是只读事实，已做；`$.tool.register` / `$.agent.spawn` / `$.model.complete` 这三个「会做事」的在这一版做了，见各自的小节。）

**Web 远控页也不显示这三样**：手机上既没有状态带、没有状态行，也没有提示浮层。这是「一期只做桌面端、终端与 IDE 插件三个渲染端」的下游结果，所以远控页不会因为它们弹「这个操作在 Web 端还没有接通」这类提示 —— 带是页面自己在打开会话、切换会话时取一次的，不是用户点出来的请求，不该在用户眼前报错。

`$.host`（让 mod 请求宿主做界面动作）整条不做也不预留。一期只有一个候选动作「新建会话」，它本身就超出 Claude Code 的 mods API（`$.session` 只能读会话、在会话内动作，CC 桌面端的新会话走客户端自己的接口），而它的副作用会打断用户眼前的会话（新建会把当前 pane 换到新会话）。产品决定降级：外部事件到达时由用户自己先新建一条会话，面板在新会话里自动出现（见「面板的归属」）。

## 用户场景与测试

### 用户故事：插件作者用 TSX 画出自己的面板（优先级：P0）

作为插件作者，我希望在插件里写一个 TSX 文件，让桌面端右侧面板（以及终端里输入框上方）出现我设计的界面，以便把插件的能力（待办、检查结果、看板）直接呈现给用户。

**验收场景**：

1. **假设**一个插件在 `mods/panel.tsx` 导出 `register($, on)`，其中注册了 `ui.render` 并在 `session.start` 里 `$.ui.open({ id: "p1", title: "待办" })`，**当**用户打开一个加载了该插件的会话，**则**右侧面板出现一个「待办」tab 并显示 `Hello`，且同目录下的其他插件能力（命令/技能）不受影响。
2. **假设**该 mod 的 `ui.render` 返回 `<Box flexDirection="row" gap={2}><Text>A</Text><Button label="B" /></Box>`，**当**面板渲染，**则** `A` 与按钮 `B` 横向排列、间距为 2 个间距单位，按钮可点击。
3. **假设** mod 只注册 `ui.render` 而从不调用 `$.ui.open`，**当**会话启动，**则**面板不出现，日志中记一条「mod 未申请面板」。
4. **假设** `ui.render` 里用 `$.ui.resolve(e)` 取元素表（TSX 里 `const { Box, Text } = $.ui.resolve(e); return <Box><Text>hi</Text></Box>`），**当**面板渲染，**则**拿到的表里每个元素名都是可用构造器、渲染结果与 `import { Box, Text } from "wave-agent-sdk/mods"` 一致；把 `$.ui.resolve({})` 或 `e.surface` 既不是 `desktop` / `vscode` 也不是 `terminal` 的事件传进去，**则**钩子返回错误摘要、面板顶部显示「需要一个 ui.render 的事件」并列出可用的端，不渲染半张表。

5. **假设** mod 在 `Button` 上多写了一个 prop（拼错的 `label2`，或照别的框架习惯写 `className`），**当**这一帧树被校验，**则** `validateModTree` 拒绝整棵树并点名那个 prop（面板顶部一条错误摘要），而不是静默忽略 —— 写错 prop 必须当场看见。
6. **假设**带里一行放了三个 `Button`（那一行的 `Box` 写了 `flexWrap="wrap"`），**当**这一行渲染，**则**每个按钮保持单行宽度、放不下的折到下一行；画在带里的按钮与画在面板里的是同一套观感（`variant="primary"` 用主题主操作色），不是浏览器默认的灰方块。

### 用户故事：同一个 mod 在终端里也能用（优先级：P0）

作为终端用户，我希望在 `wave` 里跑同一个插件时，它的面板与状态出现在输入框上方，而不是什么都没有，以便不装桌面端也能用插件画出来的界面。

**验收场景**：

1. **假设**加载了上面那个面板插件的会话在终端里打开，**当** mod 在 `session.start` 里 `$.ui.open({ id: "p1", title: "待办" })`，**则**输入框上方出现带边框的面板并显示 `Hello`，只有一个面板时顶部不画 tab 行，消息区与输入框都仍在视口里；同样这一帧里 `e.surface === "terminal"`。
2. **假设**同一个 mod 在 `ui.render` 里判断 `e.surface`，**当**树被终端拉取，**则**它按 `"terminal"` 分支返回的那棵树被画出来（不是桌面端那张）。
3. **假设**面板是 `$.ui.open({ id: "p1" })` 打开的（没有 `focus: true`），**当**用户接着在输入框里打字，**则**字进输入框、面板不抢键盘；**当**换成 `$.ui.open({ id: "p2", focus: true })`，**则**焦点直接进面板，按 `hotkey` 触发对应按钮、按 `Esc` 收起面板并让焦点回到输入框，输入框内容不变。
4. **假设**两个面板同时登记，**当**终端画出这一帧，**则**面板区顶部有一行 `1: 待办  2: 检查`，焦点在面板时按 `2` 切到第二个面板；切完之后 `$.ui.panes()` 里第一个的 `isShown` 变 `false`、第二个变 `true`，`isFocused` 跟着键盘走 —— 按 `Esc` 收起面板后两者都是 `false`。
5. **假设**焦点在输入框、上方有面板，**当**用户按 `Esc`，**则**只走输入框自己的清空语义、面板不动；**当** mod 调 `$.ui.close({ id })`，**则**面板消失，mod 收到一条 `ui.close` 通知 —— 这条路上没有回执，返回 `{ deny }` 也不影响关闭。
6. **假设**某个照桌面端写的 mod 在 `ui.render` 里 `const { Svg } = $.ui.resolve(e)`，**当**这条会话在终端里画，**则** `Svg` 是 `undefined`、那次渲染在终端那块区域显示一条错误摘要，不画空白；把同一个 mod 改成 `e.surface === "terminal"` 时改画几行 `Text`，**则**终端里正常显示那几行。同一棵树里的 `Progress` 不必分支 —— 终端照常把它画成一行字符条。
7. **假设**面板的 `ui.render` 返回 60 行内容、且带里某条 mod 返回 20 行，**当**终端画这一帧，**则**面板正文只占 12 行、带每条只占 6 行，剩下的在各自区域内滚动（焦点在面板时 `↑`/`↓` 与 `PageUp`/`PageDown`），消息区仍有高度。
8. **假设**终端正在画这条会话，**当** mod 读 `$.session.surfaces()` 与 `$.ui.open` 的返回值，**则**前者含 `"terminal"`、后者是 `{ isPlaced: true }`；同一条会话换成 `wave -p`，**则**前者是空数组、后者是 `{ isPlaced: false, reason: … }`，且不抛错。
9. **假设** mod 调 `$.ui.status("sonnet · 62%")` 与 `$.ui.toast("已保存", 2000)`，**当**终端画出这一帧，**则**输入框下方那一行出现 `插件名: sonnet · 62%`（左侧的权限模式提示不动），提示 `插件名: 已保存` 复用这一行的提示槽位、约 2 秒后自己消失，两者都不进对话上下文、也不把输入区顶高。
10. **假设** mod 在 `ui.close` 里判断「现在是详情页」就返回 `{ deny: "back to the file list" }` 并 `$.ui.invalidate` 把面板画回列表，**当**焦点在面板时用户按 `Esc`，**则**面板还在、画面换成列表、`$.ui.panes()` 的 `isFocused` 仍是 `true`；**当**用户在列表里再按一次 `Esc`（这次不 deny），**则**面板收起、焦点回输入框。同一份 mod 在桌面端关 tab 时 `deny` 不生效，tab 照常关掉（见「`ui.close`：mod 能拦下关闭」）。
11. **假设**某个面板把正文裁到「表头 + 一屏 + 底部提示」（一屏几行取自 `e.props.scroll.bodyRows`）并在 `ui.scroll` 里挪自己的窗口，**当**焦点在面板时按 `↓` / `PgDn` / `End`，**则** `ui.scroll` 依次收到 `by: 1` / `by: (可见行数-1)` / `by: Number.MAX_SAFE_INTEGER` 与当前的 `contentRows` / `bodyRows`，插件重画后面板正文换了一屏、底部提示仍在最后一行；**当**插件什么都不返回（不接），**则**由这一端按自己的偏移滚整棵树。

### 用户故事：照 Claude Code 写的守卫能问清自己的面板状态（优先级：P1）

作为插件作者，我希望 `$.ui.panes()` 回的形状与 Claude Code 一样，以便同一份守卫逻辑（「我的面板还开着吗 / 用户是不是正在看着它」）在两边都能跑，而不是在我这边被静默判成「面板已经关了」。

**为什么是这个优先级**：社区里读 `panes()` 的那批（守卫、轮询器）写的是 `(await $.ui.panes()).some(p => p.id === "x")`。我们回 id 数组时 `p.id` 恒 `undefined`，这段代码不报错、只是恒 `false` —— 形状不同比字段缺失更难发现。

**验收场景**：

1. **假设** mod 在 `session.start` 里 `$.ui.open({ id: "guard", title: "放行确认" })`，**当**它在 `tool.call` 里读 `(await $.ui.panes()).find(p => p.id === "guard")`，**则**拿到 `{ id: "guard", title: "放行确认", isPlaced: true, isShown: true, isFocused: false }`（桌面端首帧就激活这个 tab，键盘还在输入框）。
2. **假设**桌面端开着两个 mod 面板，**当**用户点第二个 tab，**则**下一次 `$.ui.panes()` 里第二个的 `isShown` 是 `true`、第一个是 `false`；**当**用户点进第二个面板里的 `Input`，**则**它的 `isFocused` 变 `true`；按 `Esc` 把键盘交回输入框后，两者都是 `false`。
3. **假设**同一条会话换成 `wave -p`（没有能画面板的端），**当** mod 读 `$.ui.panes()`，**则**面板仍在列表里，但 `isPlaced` / `isShown` / `isFocused` 全是 `false` —— 登记了不等于有人看得见。
4. **假设** mod 调 `$.ui.close({ id: "guard" })` 关掉自己正显示着的面板，**当**它再读 `$.ui.panes()`，**则**列表里没有它；另一个 mod 的面板不受影响（按插件过滤）。
5. **假设** mod 连开两个都没人持焦点，**当**两个都登记完，**则**后开的那个 `isShown: true`、先开的 `false`（与 Claude Code 的 `shownId: focusedId ?? 新 id` 同一条）。
6. **假设** mod 在 `ui.render` 里把 `e.props.isFocused` 写进树（比如「按 `Esc` 返回对话」这行提示只在拿到键盘时出现），**当**用户点进面板正文让键盘落进去，**则**这一端给这块面板补拉一帧，树里出现那行提示；**当**用户按 `Esc` 把键盘交回输入框，**则**再补拉一帧、那行提示消失 —— 而面板里点一个按钮（焦点没翻走）不会引发额外的拉取。

### 用户故事：面板交互回到 mod（优先级：P0）

作为用户，我希望点击面板里的按钮、在面板里输入文字后界面能立刻变化，以便这个面板真的能用。

**验收场景**：

1. **假设**面板里有一个 `Button`，它的 `onPress` 里把 `$.state` 的计数加一并 `$.ui.invalidate("ui.render")`，**当**用户点击该按钮，**则**面板数字从 `n` 变为 `n+1`，且整个过程不产生新的对话轮次。
2. **假设**面板里有一个 `Input`，它的 `onSubmit` 把提交值追加进 `$.state` 并 invalidate，**当**用户输入 `hello` 并提交，**则**面板列表新增一行 `hello`，输入框清空。
3. **假设**同一个按钮被连点三次而 mod 每次只做一次 invalidate，**当**三次点击都到达，**则** mod 的回调被执行三次，宿主把 100ms 内的多次 invalidate 合并成一条 `stale` 通知，面板最终只请求并渲染一次。
4. **假设**面板里一个按钮的 `onPress` 直接抛错，**当**用户点击它，**则**面板顶部出现一条错误摘要、上一次渲染的按钮与列表仍能继续点，且下一次 `invalidate` 成功后摘要消失。

### 用户故事：画一张图、一个下拉和一个进度条（优先级：P0）

作为插件作者，我希望在面板和带里画一张自己拼出来的 SVG 图、让用户从一组选项里挑一个、把「还剩多少」画成进度条，以便「用量趋势」「当前口径」「这一步走到哪」这类信息不必退化成一行文字。

**为什么是这个优先级**：社区里真正画图的那批 mod 全靠 `Svg`（我们用 33 个热门 mod 仓的源码数过：`<Svg` 6 仓，`<Select` 几乎没有）；进度条那批（`savvy-progress` 等）现在全是自己拿 `Box` + `Text` 拼 `█░` 字符条，`Progress` 是 Claude Code 四端都有的官方元素，接过来它们就不用自己拼。

**验收场景**：

1. **假设**某 mod 的 `ui.render` 返回 `<Svg source={...} alt="近 5 分钟 CPU" width={340} height={96} />`，**当**面板渲染，**则**那段 SVG 内联画在面板里、尺寸就是给的 `width`/`height`；把 `alt` 去掉或写成 `source: ""`，**则**这次渲染失败并在面板顶部说明缺的是哪个 prop。
2. **假设** `Svg.source` 里带 `<script>` 或 `onload=` 这类可执行内容，**当**面板渲染，**则**画出来的 SVG 被净化过（脚本与外链引用都不生效），宿主进程不受影响；`source` 超过 131072 字符或 `width`/`height` 超过 4096，**则**整棵树被校验拒绝并给出是哪一条超限。
3. **假设**面板里有 `<Select key="range" value={picked} options={[{value:"1m",label:"1 分钟"},{value:"5m",label:"5 分钟"}]} onSelect={v => { picked = v; $.ui.invalidate("ui.render") }} />`，**当**用户选了「5 分钟」，**则** mod 的 `onSelect` 收到 `"5m"`、下一次渲染的选中项跟着变；`options` 为空、超过 64 项、或有重复 `value`，**则**这次渲染失败并点名是哪一条。
4. **假设**面板里有 `<Progress label="迁移" value={7} max={20} />`，**当**标签页渲染，**则**画出一条填充 35% 的条并带 `35%`；`value={25} max={20}` **则**画成满格、`value` 缺省或给 `NaN` **则**画成不确定态（条在跑、不显示百分比）；把 `label` 去掉或写成空串，**则**这次渲染失败并点名 `label`。
5. **假设**同一棵树里 `Svg` / `Select` / `Progress` 被写成带 children（`<Svg source={…}>x</Svg>`），**当**面板渲染，**则**校验以「Svg 是叶子、不带 children」拒绝，而不是悄悄把 children 丢掉。
6. **假设**这些元素被用在输入框上方的带里（`e.component === "AbovePrompt"`），**当**带渲染，**则**它们与面板里画出来的一致（同一个渲染器）；`Select` 在带里选中后同样回到 mod。

### 用户故事：不开面板也能把信息放在用户眼前（优先级：P0）

作为插件作者，我希望在输入框上方画一条状态带、在输入框下方贴一行常驻状态、必要时弹一条提示，以便「额度快用完了」「正在看哪个分支」「刚保存了什么」这类信息不必为它开一块面板。

**验收场景**：

1. **假设** mod 注册了 `ui.render` 并在 `e.component === "AbovePrompt"` 时返回 `<Box><Text>ctx 62%</Text></Box>`，**当**会话就绪，**则**输入框上方出现这条带，且它的文本随下一次 `invalidate` 更新；同一 mod 返回 `undefined` 时带不占位置、不留空行。
2. **假设** mod 在 `session.start` 里调 `$.ui.status("sonnet · 62% context")`，**当**界面渲染出来，**则**输入框下方常驻一行、贴着输入卡右缘的「插件名: sonnet · 62% context」；再调一次换成新文本，调 `$.ui.status(null)` 后这行消失，全程不进对话上下文、不产生新消息。
3. **假设**同一个会话里有八个插件各自设了 status，**当**这一行渲染出来，**则**它仍是**单行**、放不下的那些收成末尾的 `+N`（数字即被收起条数，悬停可看它们），整行不换行、不把输入区顶高。
4. **假设** mod 调 `$.ui.toast("已保存", { timeoutMs: 2000 })`，**当**调用到达，**则**屏幕**右下角**浮出一条提示、约 2 秒后自己消失，mod 不需要再调一次来清；再来两条时按时间由下往上叠，最新的那条贴着右下角；正文超过 240 字符时截断加省略号；用户点 × 可提前关掉（连同它的计时器）。
5. **假设**带的内容远高于输入卡（60 行）而某条 toast 正文长达一万字符，**当**界面渲染出来，**则**带的高度封顶、超出部分在带内滚动，输入卡仍在视口内；toast 作为固定浮层不参与输入区高度，五条也不会把消息区压成 0。
6. **假设**同一会话里两个插件都画带、也都设了 status，**当**两者都到位，**则**两条带按插件加载顺序上下排列、两行 status 互不覆盖，关掉其中一个插件的面板不影响另一个的带与 status。
7. **假设**一个只画带、从不开面板的 mod 用 `$.clock.every(2000, …)` 每两秒调一次 `$.ui.invalidate("ui.render")`，**当**第二拍到达，**则**这条带重画成新内容 —— 不需要任何面板存在（surface 平时只在挂载时拉一次带，`invalidate` 是它唯一的重画通道）。
8. **假设**某 mod 的带钩子抛错，**当** surface 重画，**则**只有那条带显示错误摘要，其余带与所有 status 行照常显示，会话不中断。
9. **假设** mod 只在 `session.start` 里贴了一次 status、之后再也不写，**当**桌面端挂上这条会话（新建、切回来、webview 重建），**则**那一行照样出现 —— surface 要面板快照时 agent 会把它重放一次；`toast` 不重放，那时的提示早已过期。

### 用户故事：同一个插件在 IDE 里也画得出来（优先级：P0）

作为用户，我希望在 VS Code 与 JetBrains 的聊天面板里看到插件画的同一块面板与同一行状态，不必为了用插件而切到桌面端。

**为什么是这个优先级**：Claude Code 从扩展 2.1.299 起就在 VS Code 聊天面板里画 mod 的树（`e.surface === "vscode"`），照它写的社区插件在两端都能跑。它的 render sites 表（2.1.325 官方文档）里 `Pane` 与几条既有行（消息、工具行、`AskUserQuestion`、`Spinner`）在 Terminal / Desktop / VS Code 三端都抬，`AbovePrompt` 只有 Terminal / Desktop —— 我们在 IDE 面板里**也**给了输入框上方那条带，因为我们的输入区上方有这个位置、社区 mod 的带在这里不会画到别的地方。我们的 VS Code 与 JetBrains 复用同一份 webview 产物，把这一端接上，插件的可见面才不止桌面端。

**验收场景**：

1. **假设**插件在 `session.start` 里 `$.ui.open({ id: "p1", title: "待办" })`，**当**用户在 VS Code 或 JetBrains 里打开会话且聊天面板宽于 800px，**则**面板 dock 在对话右侧、出现「待办」tab，树与桌面端渲染结果一致；把面板拖窄到 800px 以下**则**它落到输入框上方、显示 12 行后整体滚，`e.props.placement` 从 `dock` 变成 `inline`。
2. **假设**同一个 mod 画一条带、设一行 status、弹一条 toast，**当**IDE 聊天面板渲染，**则**三样都在输入框上方的那一个栈里（带在上、status 在下、toast 插在其中），不是桌面端的三处落点；status 超过 200 字符或 2 行时截断，toast 超过 500 字符时截断。
3. **假设**守卫类 mod 在 `tool.call` 里先 `await $.session.surfaces()`，**当**这条会话在 VS Code 或 JetBrains 里跑，**则**都拿到 `["vscode"]` 并照常 `$.ui.open`（`isPlaced: true`）；同一条会话在 `wave -p` 里仍拿到 `[]`，走「没人看得见」的拒绝分支。
4. **假设**mod 的按钮写了 `variant="primary"` 与 `hotkey="y"`，**当**IDE 聊天面板渲染，**则**它画成普通的可点按钮（不拒树、不报错），点击照常回 `ui.press`；**当**同一个 mod 对某个工具调用的 id 调 `$.ui.notice(id, "已校验")`，**则**这一端的工具块下面也出现那一行灰字（与桌面端同一份 webview，宿主按 `desktopModNotice` 把它转给面板），`$.ui.notice(id, undefined)` 后这行消失。
5. **假设**同一个插件在桌面端、VS Code、JetBrains 各开一次会话，**当**三端都渲染，**则**`ui.render` 的 `e.surface` 分别是 `desktop` / `vscode` / `vscode`，`$.ui.resolve(e)` 在三端都返回同一张 10 个元素的表。
6. **假设**mod 按 `e.viewport.columns` / `e.props.bodyColumns` 换排布，**当**IDE 聊天面板分别以宽（dock）与窄（inline）两种摆法渲染，**则** `e.viewport.isFullscreen === true`、`columns` / `rows` 是按这一端字体的字宽与行高折算出的真实字符数（不是缺省 100 / 24），`bodyColumns` 量的是面板自己那一列（dock 时明显小于 `viewport.columns`，inline 时与输入区同宽）；把面板拖宽后下一次渲染数字跟着变。
7. **假设**mod 的 `Box` 写了 `flexDirection="row-reverse"`（RTL 的一排按钮），**当**IDE 聊天面板渲染，**则**子元素从右往左排，与桌面端一致 —— 不是被当成缺省 `row` 静默丢掉。

### 用户故事：面板能跟着指针和主题变色（优先级：P1）

作为插件作者，我希望用社区同一套 prop 名写出「悬停才亮的删除键」「大号小标题」「整行变色的卡片」，以便把我为 Claude Code 写好的界面原样搬过来。

**为什么是这个优先级**：社区里 6103 个带 TSX 的 mod 中，`Box.paddingX` 出现在 1645 个、`Box.borderColor` 996 个、`Text.backgroundColor` 729 个、`Box.minWidth` 334 个 —— 白名单不认它们时**整棵树被拒**，面板一片空白（真机上 `ideas-shelf` 就是这样：只因为一个 `paddingX`）。它们全是纯绘制，不引入新事件。

**验收场景**：

::: v-pre

1. **假设**某个 `Box` 写 `padding={2} paddingX={1}`，**当**面板渲染，**则**它上下各 2、左右各 1（轴写法在四边简写之后生效）；再补 `paddingLeft={3}` **则**左边变 3、其余边不变。
2. **假设** `<Text color="suggestion">` 与 `<Text color="#f60">` 各一段，**当**面板渲染，**则**前者画成主题的链接色（toggle 明暗主题时跟着变）、后者原样是 `#f60`；写一个表里没有的 token（`color="chartreuse"`）**则**按裸色画，不拒整棵树。
3. **假设** `<Text weight="bold" size="title" strikethrough>已完成</Text>`，**当**面板渲染，**则**这段字是粗体、标题档字号、带删除线；把 `weight` 写成 `600`（数字）**则**整棵树被拒并点名 `weight`（它只收那四个枚举）。
4. **假设** `<Box key="row" hover={{ backgroundColor: "error" }}><Button label="✕" plain dimColor hover={{ color: "error" }} /></Box>`，**当**指针移进这一行，**则**整行换底色、按钮的 `✕` 由暗变亮并转成错误色；指针移出**则**恢复静止样子，**且这个过程不产生 `ui.render` 重画、不跑任何 mod 钩子**。
5. **假设** `<Box key="k"><Text>glyph</Text><Box position="absolute" top={-2} left={2} display="none" hover={{ display: "flex" }}>卡片</Box></Box>`，**当**指针落在 `glyph` 上，**则**卡片出现并画在行外上方，指针移出**则**收回 —— 行内其它元素位置不动（`hover` 里没有会让兄弟移位的 key）。
6. **假设**按钮写 `plain`（`<Button label="✕" plain onPress={…} />`），**当**面板渲染，**则**它是一个无边框、无底色的字形键，一排三个能挤在行尾；同时写 `plain` 与 `variant="primary"` **则**按 `plain` 画。
7. **假设** `hover` 里写错一个 key（`hover={{ colour: "red" }}`），**当**这一帧被校验，**则**整棵树被拒并在面板顶部点名那个 key 与可用名单，不静默忽略。
8. **假设** `<Input key="note" rows={3} onSubmit={…} />`，**当**面板渲染，**则**输入框高 3 行、Enter 仍提交；同一站点里两个元素都写 `autoFocus` **则**只有第一个拿到焦点。
9. **假设** `<Button key="close" label="关闭" role="dismiss" plain onPress={() => $.ui.close({ id })} />`，**当**面板渲染，**则**那里是那颗 × 关闭控件（不画「关闭」两个字）、无障碍名是「关闭」、点击照常触发 `ui.press`；把 `role` 写成 `"cancel"` 之类**则**整棵树被拒并点名 `Button.role 只允许 "dismiss"`。

:::

### 用户故事：面板跟着外部程序的状态走（优先级：P0）

作为插件作者，我希望面板显示的是**另一个进程**持有的状态（比如一条 WebSocket 连接），并且用户能在面板上给它发指令，以便插件不必自己实现网络客户端。

**验收场景**：

1. **假设**一个 mod 在 `session.start` 里用 `$.clock.every(1000, …)` 每秒读一次 `$.store.get("ws")`、值变了才 `$.ui.invalidate`，**当**外部脚本把该值从 `connecting` 写成 `open`，**则**面板在 2 秒内显示「已连接」，用户不需要做任何操作。
2. **假设**面板上有一个「断开」按钮，它的 `onPress` 只做 `$.store.set("ws", "closed")` 再 invalidate，**当**用户点击它，**则**面板立刻显示「未连接」，随后由外部程序读到该值并完成真正的断开（mod 里没有任何网络调用）。
3. **假设**定时器回调抛错，**当**某一拍失败，**则**面板顶部叠一条错误摘要、**下一拍照常执行**，面板继续跟随后续变化。
4. **假设**会话被销毁或执行了 `/reload-plugins`，**当**收尾完成，**则**该 mod 的定时器全部停止，之后不再有任何回调写 `$.state` 或 `$.ui`。
5. **假设**外部事件需要一个干净会话来处理（面板没有任何新建会话的能力），**当**用户自己按侧栏「＋」新建一条会话，**则**新会话里同一插件自己长出同一块面板、显示与旧会话一致的状态（读同一个 `$.store`），用户不需要再手动开面板。
6. **假设**「连接」按钮的 `onPress` 用 `$.process.spawn` 起了一个外部 WebSocket 客户端并把迭代器存在闭包里，「断开」按钮对同一个迭代器调 `return()`，**当**用户点击「断开」，**则**该外部进程连同子进程树在一秒内退出、面板显示「未连接」，即使它此后一直没有输出。

### 用户故事：跨平台的双向连接（优先级：P0）

作为插件作者，我希望面板能驱动一条真正的双向连接（WebSocket），且 Windows / macOS / Linux 行为一致，以便「遥控开关」这类面板不必等宿主造一套 WS API，也不被平台特性卡住。

**为什么是这个形状**：mod 沙箱里没有 `fetch` 也没有 `WebSocket`，所以 WS 只能在**桥进程**里；桥与 mod 之间走本机回环 HTTP（`$.http.fetch` 发命令、桥的 stdout 收事件）——不用命名管道，是因为 Windows 没有 `mkfifo`。

**验收场景**：

1. **假设** mod 在「连接」按钮里 `$.process.spawn` 起一个桥进程（它自己连远端 WebSocket，并在 `127.0.0.1` 上开 HTTP），桥把端口打在 stdout 第一行，mod 读第一块拿到端口，**当**用户点「发送」，`onPress` 调 `$.http.fetch('http://127.0.0.1:<port>/send', { method: 'POST', body })`，**则**远端收到这条消息，调用在 30 秒内拿到 `ok`（桥没连上时返回 503，面板显示发送失败而不是静默）。
2. **假设**桥每收到一条远端消息就往 stdout 打一行 JSON，mod 在 `for await` 里读到后写 `$.state` 并 invalidate，**当**远端推送到达，**则**面板在下一帧显示新内容。
3. **假设**「断开」按钮对桥的迭代器调 `return()`，**当**用户点击，**则**桥进程连同子进程树在一秒内退出、面板显示「未连接」；整条链路不依赖 `mkfifo`，Windows 上同样成立。
4. **假设** `$.http.fetch` 的目标是明文 `http://` 的公网地址，**当**调用发生，**则**报错（只允许 `https:` 与本机回环），面板顶部显示错误摘要。
5. **假设**「探测」按钮用 `$.process.run` 跑一条 3 秒的命令，**当**它以退出码 2 结束，**则** `await` 正常返回 `{ exitCode: 2, stdout, stderr }`、面板显示「探测失败」而不是抛错；同一命令超过 `timeoutMs`（上限 10 分钟）时调用报错，且该进程树已被杀掉。
6. **假设**「导出」按钮里调 `$.fs.write('.wave/export.json', text)`，**当**用户点击，**则**文件立刻是完整内容（不是半截），随后 `$.fs.list('.wave')` 能在结果里看到它，`$.fs.read` 读回同样的字符串。

### 用户故事：第三方服务点一下按钮，prompt 就进对话（优先级：P0）

作为把 wave 嵌进自己产品的团队，我希望用户在我的服务端界面上点一个按钮，那条 prompt 就出现在他正开着的 wave 会话里，以便我不用自己做一套对话界面。

**为什么是这个优先级**：这是「插件不只画界面、还能驱动对话」的最小闭环——面板、开关、外部进程、投递四件事各就各位，缺任何一环这条链路就不成立。

**验收场景**：

1. **假设**一个 mod 在面板上有一个「遥控」按钮，`onPress` 里切 `$.state` 并 `$.process.spawn({ argv: ["node", "~/vendor-ws-client.js"] })`，外部进程每收到一条消息就往 stdout 打一行 JSON，mod 在 `for await` 里读到后调 `$.prompt.submit({ text, asUser: true })`，**当**第三方服务端点下那个按钮，**则**会话里出现一条用户消息、模型开始回答，用户不需要在 wave 里做任何操作。
2. **假设**会话正在回答上一轮，**当**外部进程又送来一条 prompt，**则**这条按 `sendMessage` 的既有规则入队，当前轮结束后被执行，**不丢弃**。
3. **假设** mod 调用 `$.prompt.submit({ text, asUser: false })` 或省略 `asUser`，**当**调用发生，**则**报错（一期不支持「由 mod 发送」的消息来源），而不是静默当成用户发言。
4. **假设**外部进程一直不退出，**当**用户销毁会话或执行 `/reload-plugins`，**则**该进程（连同它的子进程树）被杀掉，此后不再有回调往对话里投递。
5. **假设** `argv` 指向的程序不存在，**当** mod 调 `$.process.spawn`，**则**这一路的迭代抛错、`wave` 日志记下原文，mod 的其余面板与定时器照常工作。
6. **假设**同一个 mod 已经开着 4 个外部进程，**当**它再调一次 `spawn`，**则**这次调用报错（见「限额」），不会静默排队或杀掉旧进程。

### 用户故事：点一下建议，草稿就落在输入框里（优先级：P1）

作为插件作者，我希望 mod 把一段文本填进输入框当草稿、而不是替用户发出去，以便「下一步建议」「改写这一句」这类面板用户还能先改一改再发。

**为什么是这个优先级**：它和 `$.prompt.submit` 是同一件事的两档力度。`submit` 已经在主链路里，但「替用户按下回车」是不可撤销的动作——建议类面板多半只想把字打好。

**验收场景**：

1. **假设**面板上有三条建议按钮，**当**用户点第二条，**则**输入框里出现第二条的正文、光标在末尾、**没有**发出去，`await` 拿到 `{ isFilled: true }`。
2. **假设**输入框里已经有一段用户自己打的字，**当** mod 用 `mode: "append"` 填，**则**原有的字保留、新文本接在后面；用默认的 `replace` 时整份草稿被换掉。
3. **假设**用户正把光标放在输入框中间，**当** mod 用 `mode: "insert"` 填，**则**文本插在光标处、光标跟到填入的文本之后；输入框当时没有聚焦时按末尾算。
4. **假设**宿主是终端 CLI（没有可填的输入框），**当** mod 调 `$.prompt.fill`，**则**拿到 `{ isFilled: false }` 而不是抛错，mod 的其余逻辑照常跑。
5. **假设**一张审批卡片或问答对话框正占着键，**当** mod 调 `$.prompt.fill`，**则**拿到 `{ isFilled: false }`，对话框不受影响。
6. **假设**宿主 5 秒内没有回执（webview 卡住或没挂上），**当**超时到，**则**调用返回 `{ isFilled: false }`；之后晚到的回执被丢弃，文本不会被填第二次。
7. **假设** mod 传 `{ text: "" }` 配 `mode: "replace"`，**当**调用到达，**则**清空草稿并返回 `{ isFilled: true }`。
8. **假设** mod 传 `{ text: "x", mode: "prepend" }`，**当**调用发生，**则**当场报错并列出 `replace` / `append` / `insert`，不静默当成 `replace`。

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
3. **假设**一个社区布局的插件只有 `hooks/hooks.json` 声明了 `./register.tsx`，而它 `import { lineDelta } from "./lib/format.js"`，**当**加载，**则** `lib/format.js` 顺着 import 图一起被编译，`register.tsx` 的钩子正常触发、`lineDelta` 能用；`lib/format.js` 自己没有 `register`，所以**不算**一个 mod、不出现在面板与命令的归属里。
4. **假设**那个兄弟文件被 `import "./../../外面.js"` 指到插件目录之外，**当**加载，**则**它被拒收（越界只记一条 warn），插件其余部分照常加载。

### 用户故事：面板活到会话结束（优先级：P1）

作为用户，我希望插件重载或重启会话之后面板状态说得清，以便不会残留一个点不动的 tab。

**验收场景**：

1. **假设**一个 mod 已经开着一个面板、还挂着 `$.clock.every` 定时器，**当**用户执行 `/reload-plugins`，**则**旧 tab 先收到一次 `ui.close` 再消失、旧实例的定时器停止，随后按新插件列表重新出现，面板内容是新代码渲染的。
2. **假设**会话被销毁，**当**宿主收尾，**则**所有 mod tab 消失、该会话的 mod 实例被丢弃，此后再来的交互被静默丢弃。
3. **假设** mod 在 `session.start` 之外又调用了 `$.ui.open`，**当** `modPanelUpdate` 到达且 surface 完成请求，**则**右侧面板**新增**一个 tab（同一 `modId` 可以开多个面板，`paneId` 区分）。
4. **假设**用户手动关掉 mod 的 tab，**当**之后该 mod 的定时器调用 `$.ui.invalidate("ui.render")`，**则**该调用于是无害的空操作（它没有已登记的面板，带也不再占位置），宿主不报错、不重建 tab。
5. **假设** webview 重载（窗口刷新、切走再切回），**当**面板重新挂载，**则** webview 自己对每个 pane 发 `modPanelRender` 并拿到当前树，mod 不需要再 invalidate。

### 用户故事：多个 mod 互不影响（优先级：P1）

作为用户，我希望装了两个带 mod 的插件时它们各自独立，以便一个坏了不拖累另一个。

**验收场景**：

1. **假设**插件 A 与插件 B 各带一个面板，**当**两者都打开，**则**右侧面板出现两个 tab，各自渲染自己的树，交互只路由到对应 mod。
2. **假设**插件 A 的 `ui.render` 抛异常，**当**面板渲染，**则** A 的面板显示错误态，B 的面板正常刷新，会话本身不中断。
3. **假设**插件 A 的事件处理里写了 `while (true) {}`，**当**宿主要它的树，**则**这次调用在 5 秒后以「同步执行超过」失败并记一条 warn，会话与插件 B 照常（见「沙箱」）。

### 用户故事：用 token 用量驱动自己的提示（优先级：P1）

作为插件作者，我希望 mod 能读到本会话的 token 用量，以便「上下文快满了」「这一场花了多少」这类提醒由我自己画在带或状态行上，而不必等用户去敲斜杠命令。

**为什么是这个优先级**：`context.percent` 与用量环共用一个算法，读错了就会给出与界面矛盾的提醒，所以先期只给最小、口径写死的字段。

**验收场景**：

1. **假设** mod 在 `ui.render` 里把 `$.session.usage().context.percent` 画成一条带，**当**会话跑完一轮，**则**下一次 `invalidate` 后带上的数字与输入框旁那个环一致；没跑过任何轮次时是 `0`。
2. **假设** mod 调 `$.session.usage()` 后改动返回对象的字段再调一次，**当**第二次调用到达，**则**拿到的仍是会话的真实值（快照是副本，改它不影响会话）。
3. **假设** mod 在 `$.clock.every(60_000, …)` 里读用量，**当**一分钟的拍子到达，**则**拿到的是那一刻的数字，mod 不需要订阅、也没有收到过任何用量推送。
4. **假设**会话还没接上用量来源（`Agent` 之前的状态），**当** mod 调 `$.session.usage()`，**则**拿到全 0 的快照（`window` 也是 `0`）而不是抛错，mod 的其余逻辑照常跑。
5. **假设**模型响应带企业端额度头（周窗已用 42%、月窗已用 10%，各自带重置时刻），**当** mod 调 `$.session.usage()`，**则** `rateLimits` 是 `[{ kind: "weekly", percentUsed: 42, resetsAt }, { kind: "monthly", percentUsed: 10, resetsAt }]` —— 周窗在前，`kind` 是上游的 `weekly` / `monthly`（不是 CC 的 `five_hour` / `seven_day`），`resetsAt` 是毫秒；**当**部署不发这批头（私有化 / 自定义网关），**则**是 `[]`、不报错也不打日志。

### 用户故事：把「答完了」「有审批在等」报到自己的服务端（优先级：P1）

作为把 wave 嵌进自己产品的团队，我希望 mod 在对话答完、或者有一张审批卡片要弹给用户时收到一个只读通知，以便把它转发到我的服务端，让用户在我的网页那边也看得到。

**为什么是这个优先级**：上报走的是插件自己的进程或 HTTP，宿主只需要忠实、及时地报告这两个时刻；早一天给出去，第三方就不必去轮询会话状态。

**验收场景**：

1. **假设** mod 注册了 `turn.complete` 并在钩子里 `$.http.fetch` 打自己的服务端，**当**用户在 wave 里问一句、模型答完，**则**服务端收到一次上报，载荷里的 `isAborted` 是 `false`；答完后立刻再问一句，**则**再收到一次。
2. **假设**模型正在回答，**当**用户按 Esc 中断，**则**服务端收到一次 `isAborted: true` 的上报，且这一次不会因为中断后没有新的回答而缺失。
3. **假设**这一轮里 Stop 钩子要求继续修复、或者中途注入了一条后台任务通知把循环重开了一次，**当**最终答完，**则**服务端只收到**一次**上报，`durationMs` 覆盖从这一轮开始到真正结束的时间，`usage` 是这几段请求之和（不是最后一段）。
4. **假设** mod 注册了 `classic.PermissionRequest`，**当**模型调用一个需要用户确认的 Bash 命令、审批卡片弹出，**则**服务端收到 `{ hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: … }, session_id, transcript_path, cwd }`；用户点「允许」之后模型继续跑，**则**服务端不会再收到与这次审批有关的任何事件（没有「已批准」事件，也不需要）。
5. **假设**同一个工具调用被权限规则自动放行，**当**它执行，**则**宿主不触发 `classic.PermissionRequest`（没有卡片要显示，报了就是假通知）；被 `PermissionRequest` 钩子直接拒掉的调用同样不触发。
6. **假设** mod 的 `turn.complete` 钩子里写了死循环，**当**超过 5 秒，**则**这次派发超时并记一条 warn，该轮照常说结束、界面正常回到可输入状态；mod 的这条上报丢失，不重试、不排队。
7. **假设** mod 在这两个钩子里完全没有注册，**当**轮次结束、审批弹出，**则**宿主什么都不做（没有 mod 时派发是空操作），既不报错也不产生日志噪音。
8. **假设** mod 在 `classic.PermissionRequest` 里 `return { decision: "allow" }`（照 Claude Code 的 `tool.check` 习惯写），**当**卡片弹出，**则**这次审批照样等用户回答，返回值被忽略 —— 只读事件不能替用户批准。
9. **假设** mod 注册了我们没有镜像的 `classic.*` 名字（`classic.Setup`、`classic.WorktreeCreate`…），**当**插件加载，**则**它被当作不存在的钩子拒收并记一条 warn（已镜像的 20 个见「影子事件」），而不是静默登记一个永远不触发的钩子。
10. **假设** mod 注册了 `classic.PermissionDenied`，**当**用户在卡片上点了「拒绝」，**则**它收到 `{ tool_name, tool_input, tool_use_id, reason: "user_denied" }`；同一个调用因为命中 `permissions.deny` 规则被拦，**则** `reason` 是 `"denied_by_rule"`、卡片根本没弹（两种情况都要能分辨是「规则拦的」还是「人拒的」）。

### 用户故事：只写 `classic.*` 的社区插件也能收到事件（优先级：P0）

作为装社区插件的用户，我希望那些只认 Claude Code 那套 `classic.<Event>` 名字的插件在 wave 里也能收到事件，以便它们的面板与上报不用改一行代码就能用。

**为什么是这个优先级**：语料里 49 个含 mods 源码的仓库中，`classic.SessionStart` / `classic.Stop` 分别被 14 / 12 个插件用到，`classic.PreToolUse` 10 个，是缺得最多的一档；而这些事件的触发时刻我们**本来就有**（开局、一轮收尾、用户提交、工具跑完、目录变了），补的是名字与载荷，不是新机制。载荷还必须逐字段和 CC 对齐：上一批有几处是照我们自己的形状合成的，插件按 CC 的名字读一律拿到 `undefined` —— 事件发了、插件照旧不工作，比没发更难查。

**验收场景**：

1. **假设** mod 注册了 `on("classic.Stop", h)`，**当**一轮答完，**则** `h` 收到 `{ session_id, transcript_path, cwd, permission_mode, hook_event_name: "Stop", background_tasks, stop_hook_active, last_assistant_message }`（最后一项是最后一条 assistant 消息的正文，插件不必自己去解转录），且这次派发在 `turn.complete` **之前**（它要拿返回值才知道这一轮算不算收尾，见「一轮收尾时的非错误反馈」）；用户按 Esc 中断的那一轮同样派发一次。
2. **假设** mod 注册 `on("classic.PostToolUse", { tool_name: "Write" }, h)`，**当**一次 `Write` 成功返回，**则** `h` 被调用一次、`tool_response` 是那次工具的文本结果并按限额截断、`tool_use_id` 与模型消息里那次调用的 id 相同（插件拿它去 `$.ui.notice(tool_use_id, …)` 能落在对应的那一行）、`duration_ms` 是这次执行的耗时；同一轮的 `Bash` 调用不触发它。
3. **假设**一次工具调用失败（工具自己报错、被插件 `{ deny }`、被权限拒绝），**当**它收尾，**则**派发的是 `classic.PostToolUseFailure` 而不是 `classic.PostToolUse`，`error` 里是那条错误正文，`tool_use_id` 同样给到。
4. **假设**同一个模型响应里并行发了三条工具调用，**当**三条全部跑完，**则** `classic.PostToolBatch` 派发一次，`tool_calls` 是三项 `{ tool_name, tool_input, tool_use_id, tool_response }` —— **没有**我们自造的 `ok` 字段（CC 的 schema 里没有它，多给一个字段名插件也读不到），成功与否看 `tool_response` 在不在。
5. **假设** mod 的 `classic.Stop` 钩子 `return { decision: "block" }`（照 Claude Code 的写法），**当**一轮答完，**则**这一轮照常结束，返回值被忽略 —— 唯一开的口子是 `additionalContext`（见「一轮收尾时的非错误反馈」）。
6. **假设** mod 的 `classic.SessionStart` 钩子抛错，**当**会话启动，**则**会话照常起来、面板照常可用，只记一条 warn。
7. **假设** mod 在 `classic.PostModelSwitch` 里读 `e.to_model` 与 `e.from_model`，**当**用户从 `wave-pro` 切到 `wave-max`，**则**它拿到 `from_model: "wave-pro"`、`to_model: "wave-max"`（不再是自造的 `model` 字段）；`e.cache_ttl` 是 `null`（我们不做缓存 TTL 记账），而不是一个猜出来的值。
8. **假设**用户在会话里让 Bash `cd` 到子目录，**当**目录真的变了，**则** `classic.CwdChanged` 带 `{ old_cwd, new_cwd }` 派发一次（读 `old_cwd` 的插件 —— kwitsch 的 universal-lint、nadundesilva 的 hud 都是 —— 能拿到旧目录）；`EnterWorktree` 换工作区时同样派发（工作区根变了，会动的那个目录也变了）。
9. **假设** mod 在 `classic.SessionStart`、`classic.PostToolBatch`、`classic.PermissionRequest`、`classic.Stop` 里都读 `e.permission_mode`（社区守卫 jr-deploy-guard 就是这么写的：它靠这个值判断「这一刻有没有人会被问到」，读不到就当成没人可问、一律拒绝），**当**这些事件派发，**则**每条都带着当时生效的权限模式（`default` / `acceptEdits` / `plan` / `dontAsk` / `bypassPermissions`），与 `$.session` 那份配置同一处解析。
10. **假设**一次审批卡片即将弹出，**当**派发 `classic.Notification`，**则** `notification_type` 是 `permission_prompt`（Claude Code 自己给审批卡片用的名字），按这个名字过滤的插件（done-waiting-ping）能收到；`$.ui.ask` 的提问卡片**不**派发 `classic.Notification`。
11. **假设** mod 在 `classic.InstructionsLoaded` 里按 `e.load_reason === "nested_traversal"` 过滤（照 CC 的取值写），**当**模型读到子目录里的 `AGENTS.md`，**则**它收到 `{ file_path, memory_type: "Project", load_reason: "nested_traversal" }`；开局那几份报的是 `session_start`，`<workdir>/AGENTS.local.md` 报 `memory_type: "Local"`、`~/.wave/AGENTS.md` 报 `"User"` —— 我们自造的 `nested_read` 不再出现。
12. **假设** mod 在 `classic.SubagentStop` 里读 `e.last_assistant_message` 与 `e.agent_id`，**当**一次子代理收尾，**则**它拿到那两个字段（外加 CC 也有的 `stop_hook_active`：首次收尾是 `false`）；我们自造的 `description` / `status` 不再给 —— 这两个名字 CC 没有，插件读了只会是 `undefined`，多给反而让人以为有这个约定。
13. **假设** mod 的 `classic.SubagentStop` 钩子在子代理第一次收尾时 `return { additionalContext: ["测试还没跑"] }`，**当**子代理因此续跑一轮并再次收尾，**则**第二次钩子里的 `e.stop_hook_active` 是 `true`，且那条提醒作为 `isMeta` 消息进了**子代理自己的**对话（子代理的下一轮请求能看到，父对话里看不到）；插件这次不再返回内容时子代理真的结束，主代理收到它最终的结果。settings 里配的 `SubagentStop` 钩子把子代理拦停一次之后，下一次收尾的 `stop_hook_active` 同样是 `true`（两条通道共用这一个状态）。
14. **假设** mod 的 `classic.SubagentStop` 每次都返回 `additionalContext`，**当**同一个子代理已经因此续跑 8 次，**则**第 9 次的内容被丢弃、记一条 warn、子代理照常结束；这个 8 次按子代理自己那一轮计，不占主会话的额度（两个子代理之间也不互相消耗）。
15. **假设**子代理因为模型报错、或用户把它停掉而结束，**当**实例被释放，**则**补派发一次 `classic.SubagentStop`（`stop_hook_active: false`），这一次不接受 `additionalContext`（那一刻已经没有「再跑一轮」的落点）；正常答完的子代理不会在实例释放时再收到第二次（收尾时已经报过）。

### 用户故事：压缩前后与「助手说了什么」也能被插件看见（优先级：P1）

作为把 wave 接进自有系统的团队，我希望 mod 在上下文被压缩的前后、以及每段助手回答收尾时都收到一次事件，以便我在自己那边留下「什么时候丢了历史」「用户看到的是哪段话」这两条记录。

**为什么是这个优先级**：`classic.PreCompact` / `classic.PostCompact` / `classic.MessageDisplay` 在语料里分别是 4 个仓库、6 个仓库在用（后两个是 hud / sotter 这一族「把对话镜像到别处」的插件），触发时刻我们本来就有（压缩入口、消息收尾），缺的只是名字与载荷。

**验收场景**：

1. **假设** mod 注册了 `classic.PreCompact` 与 `classic.PostCompact`，**当**自动压缩撞到阈值触发，**则**先收到 `PreCompact { trigger: "auto", custom_instructions: null }`；压缩完成后收到 `PostCompact { trigger: "auto", compact_summary: "…" }`，`compact_summary` 就是这次写回历史的那段摘要；同一时刻还有 `session.compact`（带 `tokensBefore` / `tokensAfter`）。
2. **假设**用户敲 `/compact 只保留接口相关的`，**当**它跑起来，**则** `PreCompact` 的 `trigger` 是 `"manual"`、`custom_instructions` 是用户带的那段话。
3. **假设**压缩因为会话被切走而放弃（摘要写不回去），**当**它中止，**则** `PreCompact` 已经发过、`PostCompact` 与 `session.compact` 都不发 —— 「开始了」与「真的压缩了」是两件事。
4. **假设** mod 注册了 `classic.MessageDisplay`，**当**模型答完一段话，**则**它收到 `{ turn_id, message_id, index: 0, final: true, delta }`，`delta` 是这段回答的完整正文（按限额截断）、`message_id` 与转录里的那条消息同 id；一轮里模型答了两段（中间夹了工具调用），**则**收到两次，`turn_id` 相同、`message_id` 不同。
5. **假设** mod 的 `classic.MessageDisplay` 返回 `{ displayContent: "…" }`（照 Claude Code 的写法），**当**这段回答显示出来，**则**用户看到的仍是原文，返回值被忽略（替换显示内容是改行为，见「不做的返回通道」）。

### 用户故事：自查类插件能让这一轮别急着收尾（优先级：P1）

作为装了自查类社区插件的用户，我希望插件发现「还有一处没改完」时能把这句话塞回对话、让模型接着做，而不是答完就停在那里等我自己再催一遍。

**为什么是这个优先级**：cys / watchducks 这一族插件的全部逻辑就是 `classic.Stop` 里返回 `additionalContext`；只发事件、不收返回值的话它们装上去等于白装，而「续跑一轮」这条路径宿主本来就有（后台任务通知、Stop 钩子阻塞都用它）。

**验收场景**：

1. **假设** mod 注册了 `on("classic.Stop", …)` 并返回 `{ additionalContext: ["改动里还有一处没跑测试"] }`，**当**一轮答完，**则**这段文本作为一条 meta 消息进上下文、宿主再发一次模型请求，模型第二段回答接在第一段之后，界面仍是同一个回合（输入框保持「生成中」）。
2. **假设**同一轮里又有后台任务通知送达，**当**这一轮收尾，**则** `turn.complete` 只上报一次（`durationMs` 覆盖含续跑在内的整段时间），不会因为中途续跑而多报几条。
3. **假设**某个 mod 每次收尾都无条件返回 `additionalContext`，**当**这一轮反复续跑，**则**第 8 次之后停下、记一条 warn，这一轮正常结束，第 9 次的反馈被丢弃。
4. **假设** mod 靠 `e.stop_hook_active` 判重，**当**第一次收尾拿到 `false` 并返回 `additionalContext`，**则**续跑那一轮的 `classic.Stop` 拿到 `true`，插件据此不再要求继续、这一轮真正收尾。
5. **假设**用户按 Esc 收尾、或收尾时队列里已有一条用户消息，**当** mod 在这时返回 `additionalContext`，**则**宿主不续跑（中断就是中断、排队的消息优先），反馈丢弃。
6. **假设** mod 的 `classic.Stop` 钩子返回 `{ decision: "block", reason: "…" }`，**当**一轮答完，**则**这一轮照常收尾并记一条 warn（只收 `additionalContext`）。
7. **假设** mod 的 `classic.Stop` 里写了死循环、而另一个 mod 也注册了这条事件，**当**超过 5 秒，**则**那个 mod 的反馈丢失并记一条 warn，另一个 mod 的 `additionalContext` 照收、这一轮照常续跑。

### 用户故事：插件能主动收掉这一轮（优先级：P1）

作为装了一个「看门」插件的用户，我希望它在发现这一轮已经跑偏（自建的超时到了、盯到一个不该出现的命令）时能把这一轮收掉，而不是让我盯着它一直跑到自己停。

**为什么是这个优先级**：`turn.start` / `turn.complete` 已经让插件看得见轮次，但只能看不能动 —— 语料里 3 个插件在用 `$.turn.abort`，写出来的都是「我自己定的超时/条件到点就收」。`$.prompt.submit` 是「加一轮」，这是它的反向操作，缺了它，轮次这条线就只有半边。

**验收场景**：

1. **假设** mod 在 `turn.start` 里记下 `e.turnId`，**当**它自己定的 60 秒超时到了而这一轮还在跑，**则** `await $.turn.abort({ turnId })` resolve，模型请求中断、正在跑的工具停掉，那一轮照常发 `turn.complete`（`isAborted: true`）与 `classic.Stop`。
2. **假设** mod 拿的是一个已经结束的 `turnId`（用户已经问过新的一句、新一轮在跑），**当**它调 `$.turn.abort`，**则** Promise reject、报错里同时有两个 id，正在跑的那一轮**不受影响** —— 旧 id 绝不能杀掉用户刚发起的一轮。
3. **假设**模型在等用户输入（没有一轮在跑），**当** mod 调 `$.turn.abort`，**则** Promise reject，插件的 `catch` 能分辨「收掉了」与「本来就没事」。
4. **假设**收的时候队列里有用户排着的消息，**当**这一轮被收掉，**则**那几条消息仍在队里、下一轮照常发出去（不是「连同队列一起清空」）。

### 用户故事：危险命令被插件拦下（优先级：P0）

作为用户，我希望装上一个守卫插件之后，删库、强推这类命令在跑之前就被拦下来（或者先问我一句），以便我不必全程盯着模型的每一个 Bash 调用。

**为什么是这个优先级**：社区里 `$.ui.ask` 用得最多的就是这一族（blast-radius / risky-hold / warden），它们的整条逻辑都是「`tool.call` 里判断 → 问一句或直接 `{ deny }`」。不给这套，「插件作者写的守卫」就只能退化成「事后贴一行警告」。

**验收场景**：

1. **假设** mod 注册 `on("tool.call", { tool: "Bash" }, ($, e, next) => …)`，**当**模型要跑 `rm -rf /`，**则**钩子在工具执行**之前**收到 `{ tool: "Bash", tool_use_id, input: { command: "rm -rf /" } }` 且顶层铺着一份工具参数（`e.command === "rm -rf /"`）；钩子返回 `{ deny: "…" }` 后**则**这条命令不执行，模型收到的工具结果是 `is_error: true`、正文就是那段 deny 文本，并据此换个做法。
2. **假设**同一个守卫对无害命令 `ls` 调 `next(e)`，**当**链上没人再拦，**则**命令照常执行、钩子拿到的仍是这次调用的真结果；主帧上没有 `next.called` 这个成员（它只在 `.catch` 帧上），`next` 也没有被记成拒绝。
3. **假设**整条钩子是从头跑通的（不是被拒、不是失败），**当**它被 `{ deny }` 拦下，**则**宿主**不弹**审批卡片 —— 被拦的调用在权限判定之前就结束了，用户看到的是插件拦的。
4. **假设**守卫在钩子里 `await $.ui.ask("要执行这条命令吗？", ["允许一次", "拒绝"])`，**当**用户在桌面端点了「拒绝」，**则** Promise resolve 成字符串 `"拒绝"`，钩子据此返回 `{ deny }`；点「允许一次」**则** resolve 成 `"允许一次"` 并 `next(e)`，命令照常跑。
5. **假设**用户关掉了那个对话框（或这条会话根本没有界面，比如 `wave -p`），**当** `$.ui.ask` 等不到答案，**则** Promise reject，守卫 `catch` 之后返回 `{ deny: "没人能确认这条命令" }`，命令不执行。
6. **假设**守卫钩子自己抛错（不是 `$.ui.ask` 的 reject），**当**这次调用派发，**则**宿主记一条 warn 并**放行**（与只读事件同一条纪律），对话不会卡在「既不跑也不拒」。
7. **假设**守卫用 `on("tool.call", …, h).catch(f)` 注册，`h` 超时（这个钩子的 5 秒预算用完），**当**兜底 `f` 收到 `(next)` 并返回 `{ deny: "…" }`，**则**这次调用被拦下 —— fail-closed 的写法能生效，`f` 拿到的 `next.called` 是 `false`（`h` 在超时前没调过 `next`），`next.error` 说明这次是超时。
8. **假设**两个 mod 都注册了 `tool.call`，**当**第一个返回 `{ deny }`，**则**第二个的钩子不再跑；第一个 `next(e)` 之后第二个才跑，两边都能依次拿到事件。
9. **假设** mod 的钩子把 `next(e)` 调了两次，**当**第二次调用，**则**当场抛错（链不会跑两遍），按「钩子抛错」处理。
10. **假设**工具参数不合 schema（比如缺 `command`），**当**调用发生，**则** `tool.call` **不触发**，模型直接拿到参数校验错误 —— 守卫不必自己防「参数是空的」。
11. **假设**守卫按我们推荐的写法登记 `on("tool.call", { tool: "Write" }, async (e, next) => { const r = await next(e); … })`，**当**工具跑完，**则** `next` resolve 成 `{ result }`（`r.result.content` / `r.result.error` 就是这次调用的结果），钩子在它之后的那几行才跑；同一个 handler 只写一个形参 `(e)`、既不调 `next` 也不返回 `{ deny }` 时，工具照常执行（拦下必须显式给 `{ deny }`）。
12. **假设**同一个守卫是照 Claude Code 的 `classic.PreToolUse` 写的（chronicle 的 check-branch 就是这样：`on("classic.PreToolUse", { tool: "Bash" }, ($, e, next) => …)`，读 `e.tool` / `e.command`），**当**模型要跑一条 Bash，**则**它收到与 `tool.call` 完全一样的那份信封（`tool` / `tool_use_id` / `input` + 顶层铺开参数，没有 `hook_event_name`），返回 `{ deny: "…" }` 同样能拦下这次调用；`tool.call` 上已经有人拦下时它不再被问。
13. **假设**只写了 `classic.PreToolUse` 的守卫返回 CC 的另外几种答复（`{ allow: true }`、`{ ask: "…" }`、`updatedInput`），**当**这次调用继续，**则**它们被忽略并记一条 warn：放行与强制弹卡片都是第二判定源（见「交付分层」），改写参数同一条理由不做。
14. **假设**守卫在 `tool.call` 里 `const r = await next(e)` 之后读 `r.result`，返回 `{ result: { ...r.result, content: r.result.content + "\n（已记录）" } }`，**当** `ls` 跑完，**则**工具**只执行一次**、`r.result` 就是这次调用的真结果，模型收到的正文带那段后缀；`next(e)` 里的执行先过 `settings.json` 的 PreToolUse，被它拦下时工具不执行、`r.result` 是那条拒绝。
15. **假设**同一个 handler 同时登记在 `tool.call` 与 `classic.PreToolUse` 上，**当**模型跑一条 Bash，**则**两次派发里 `next.event` 分别是 `"tool.call"` 与 `"classic.PreToolUse"`，handler 据此分支；事件名只在 `next` 上，`e` 里没有这个字段。
16. **假设**守卫用一个 handler 管两个事件，**当**它写 `next.is("classic.*", e)`，**则**在 `classic.PreToolUse` 那次是 `true`、在 `tool.call` 那次是 `false`；**当**它传 `"*"` 这类连 `on()` 都不认的模式，**则**当场报错（不是安静答 `false`）。
17. **假设**守卫读 `next.origin`，**当**这次是模型真的要跑工具（引擎发起），**则**拿到 `{ plugin: "engine", tier: "core" }`；**当**另一个 mod 用 `$.tool.call({ tool, input })` 主动来问一句，**则**那次派发里是 `{ plugin: <那个 mod 的名字>, tier: "user" }` —— 守卫据此区分「真调用」与「插件自查」。
18. **假设**两个 mod 都注册了 `tool.call`、第一个调了 `next(e)`，**当**第一个在 `await next(e)` 之后读 `next.trace`，**则**里面有第二个 mod 那一层 `{ index: 0, plugin: <第二个 mod>, tier: "user", event: "tool.call", outcome: "returned" | "caught" | "rejected", ms }`；**当**第二个在自己的 handler 里读，**则**还看不见它（只收**已经跑完**的层，第一个此时正挂在 `next` 上）；matcher 没选中的 mod 不占一层。
19. **假设**守卫读 `next.budget`，**当**这次派发刚开始，**则** `ms` 是 5000、`remainingMs` 接近 5000；**当**它在钩子里等了 2 秒再读一次，**则** `remainingMs` 相应变小（读一次算一次，不是构造时定下的常量）。
20. **假设**链上两个 mod 各花 4 秒，**当**整条链跑下来，**则**两个都跑完（各有一份 5 秒，总耗时 8 秒不被截断）；**假设**其中一个自己跑了 6 秒，**则**只有那一层超时失败，另一个 mod 照常跑完、按 `tool.call` 的失败纪律记一条 warn 并放行。

### 用户故事：拦下之后开个面板，按一下才放行（优先级：P0）

作为用户，我希望守卫插件在拦下一条危险命令时，不是简单问我「是/否」，而是开一块面板把这条命令**完整摊开**（爆炸半径、受影响路径、为什么危险），再给几个带快捷键的按钮，让我看清楚之后按 `y` 放行、按 `n` 拒绝。

**为什么是这个优先级**：这是 hold 型守卫（blast-radius / risky-hold 这一族）的核心形态，也是社区 mod 里唯一需要「拦住 + 自己画界面 + 等按键」三件事同时成立的场景。它逼出四个缺一不可的能力：知道有没有人看得见（`$.session.surfaces()`）、知道面板放没放下（`$.ui.open().isPlaced`）、按钮能按快捷键（`Button.hotkey`）、以及把别人贴在输入框上方的提示统一排序（`AbovePromptList`）。

**验收场景**：

1. **假设** `tool.call` 钩子里先 `await $.session.surfaces()`，**当**这条会话是 `wave -p`（一期不画 mod 的树），**则**拿到**空数组**（不 reject），守卫据此**立刻**返回 `{ deny: "这里没有人能确认这条命令" }` —— 不开面板、不等待、不让对话停在一个没人按的按钮上。
2. **假设**同一个钩子在桌面端跑，**当** `await $.session.surfaces()`，**则**拿到 `["desktop"]`；随后 `await $.ui.open({ id: "blast", title: "确认命令" })` 返回 `{ isPlaced: true }`，面板画出来。
3. **假设** `$.ui.open()` 返回的是 `{ isPlaced: false, reason: "…" }`（会话正在销毁、或这一端不画面板），**当**守卫读到它，**则**按「没人看得见」降级（`{ deny }`），而不是继续等一个没画出来的面板上的按钮。
4. **假设**面板里有 `<Button key="ok" label="放行 (y)" hotkey="y" onPress={resolveOk} />` 与 `<Button key="no" label="拒绝 (n)" hotkey="n" onPress={resolveNo} />`，**当**面板有键盘焦点时用户按 `y`，**则**等于点了「放行」那个按钮、`onPress` 触发、钩子拿到答案并 `next(e)`，命令照常执行 —— 用户不需要先把指针挪到按钮上。
5. **假设**用户按的是面板里没有绑 hotkey 的键（或焦点在输入框上时按 `y`），**当**按键发生，**则**它照常进输入框 / 什么也不发生 —— 热键只在面板聚焦时生效，不劫持全局输入。
6. **假设**同一帧里两个可见 `Button` 都写了 `hotkey="y"`，**当**用户按 `y`，**则**后写的那个响应、另一个不响应；两个不同键（`y` / `n`）**则**各自响应，互不干扰。
7. **假设** mod 用 `on("ui.render", { component: "AbovePromptList" }, f)` 注册排序器，返回 `e.props.rows.filter(r => r.plugin !== "noise").map(r => r.tree)`，**当**带重画，**则**被滤掉的那一行不再出现、其余按返回顺序排列；返回 `undefined` **则**所有行照原顺序画（「没有意见」，不是「什么都不显示」）。
8. **假设**排序器 mod 的 handler 抛错或超时（5 秒），**当**带重画，**则**按**原顺序**画（fail-open），不是把带清空；**当**它在 `.catch` 里返回一棵不含任何行的树，**则**整条带被清空（fail-closed 的写法）。
9. **假设** `AbovePromptList` 的 handler 返回一棵把别人的行包进自己 `Box` 的树（跨插件嵌套），**当**宿主收到，**则**不按嵌套排版：只认 `props.rows` 里的 `tree` 按顺序画，多出来的包裹层被忽略 —— 「包一层再排版」这个用法不支持（见「状态带、状态行与提示」）。
10. **假设**某个 mod 只写了 `on("ui.render", handler)`（没有 matcher）、handler 对每个站点都回自己那一棵树，**当**带重画，**则**它**不被当作排序器**问：别人的行照原顺序全在，它自己那一行也照常画出来 —— 「只画自己」不会被读成「藏掉别人」。
11. **假设**面板里的按钮在等用户按键，**当**用户关掉面板或切走这个会话，**则**守卫那次 `tool.call` 不会永远悬着：面板消失后按「没人能确认」处理（`{ deny }`），与场景 1、3 同一个降级。

### 用户故事：工具一跑完就跟着刷新（优先级：P1）

作为插件作者，我希望 mod 在每次工具调用结束时收到一个只读通知，以便「分支/未提交文件数」这类带不必靠轮询，用户 `git commit` 完那一瞬间就更新。

**为什么是这个优先级**：轮询（`$.clock.every`）在长时间空闲时会白跑、在关键时刻又会慢半拍；但「跑完再更新」只是体验优化，不像守卫那样挡在危险操作前面。

**验收场景**：

1. **假设** mod 注册了 `tool.call`，在钩子里 `const r = await next(e)` 之后重新读一次 `git status`、写进 `$.state` 并 `invalidate`，**当**模型跑完一个 Bash 调用，**则**带上的未提交文件数在下一次渲染里就是新值，不需要等任何定时器；`r.result` 就是这次工具的结果。
2. **假设**这次工具调用的审批被用户拒掉，**当** `next(e)` 返回，**则**它照常把结果交回（`result.success: false`），mod 在 `await` 之后照样能刷新，不会卡在「上一次状态」里。
3. **假设** mod 不调 `next(e)` 直接 `return { deny: "分支没同步，先 pull" }`，**当**这次调用派发，**则**工具**不执行**，模型收到这段文本作为错误结果。

### 用户故事：插件注册自己的斜杠命令（优先级：P0）

作为插件作者，我希望 mod 能注册一个 `/standup` 这样的命令，以便用户不必先打开面板，敲一行就走完我这条流程。

**验收场景**：

1. **假设** mod 在 `session.start` 里 `$.command.register({ name: "standup", description: "整理日报" })` 并注册了 `on("command.run", { command: "/standup" }, …)`，**当**用户在 webview 敲 `/stan`，**则**快捷指令弹窗里出现 `/standup` 与那行描述（与内置、自定义命令同组，不额外挂来源标签）；回车执行后**则**钩子返回的 `{ text }` 作为一条用户消息进会话，模型读到它。
2. **假设**用户敲的是 `/standup 3`，**当** `command.run` 派发，**则** `e.args` 是 `"3"`、`e.command` 是 `"/standup"`。
3. **假设** mod 注册了命令却没有注册对应 matcher 的 `command.run` 钩子，**当**用户执行它，**则**会话里出现一条错误提示，说明「注册了但没有任何钩子回答这条命令，补一个 `on("command.run", { command: "/<name>" }, …)`」，而不是静默什么都不做。
4. **假设**内置命令（或用户 `.wave/commands` 下的自定义命令、别的插件的命令）已经叫这个名字，**当** mod 注册，**则**注册失败、插件日志写明被谁占了；同一个 mod 用同一份 spec 重复注册不报错、也不产生第二条命令。
5. **假设**用户敲了 `/config` 这类由前端自己实现的宿主命令，而某个 mod 恰好也注册了同名命令，**当**命令列表合并，**则**宿主命令胜出、mod 的那条被丢掉并记一条 warn。
6. **假设** `command.run` 钩子在忙时被触发而命令标了 `immediate: false`，**当**模型正在回答，**则**用户那行进队列，答完之后再执行（与内置命令同一套排队语义）。
7. **假设**插件被卸载或 `/reload-plugins` 重载，**当**命令表刷新，**则**该命令从弹窗与 CLI 选择器里消失，再敲同名命令报「没有这个命令」。
8. **假设** mod 在 `command.run` 钩子里调 `$.prompt.submit`，**当**钩子执行，**则**调用报错并说明「它会等正被这个钩子占着的那一轮，改成返回 `{ text }`，或挪到 `turn.complete` 里再投」。

### 用户故事：在对话流里留一行（优先级：P1）

作为用户，我希望插件做过的动作在对话里留个痕，以便过一会儿回看时知道「这一轮是插件替我跑的」，而不是只在几秒的 toast 里闪一下。

**验收场景**：

1. **假设** mod 在 `command.run` 或 `turn.complete` 里调 `$.ui.log("已把审批规则写进 .wave/settings.local.json")`，**当**这一行落地，**则**对话流里出现一条提示块（署名由插件自己写在文字里），切走会话再回来仍然在。
2. **假设**这一行落了地，**当**下一轮请求发给模型，**则**请求里**没有**这行文字（提示块不进上下文）。
3. **假设** mod 传了 `{ to: "pane" }` 这类我们没有的目标，**当**调用发生，**则**抛错并列出可用的 `"transcript"` 与 `"debug"`，而不是静默写进对话流。
4. **假设** mod 调 `$.ui.log("…", { to: "debug" })`，**当**这一行落地，**则**对话流里不出现提示块，只有 `wave` 的调试日志里多一行（`LOG_LEVEL=DEBUG` 才看得见）。

### 用户故事：用户一提交，插件就把相关材料塞进这一轮（优先级：P0）

作为用户，我希望我敲下问题的瞬间，插件能把它检索到的相关材料交给模型，以便模型回答时用得上，而我自己敲的那句话保持原样。

**验收场景**：

1. **假设** mod 注册 `prompt.submit` 并在钩子里返回 `{ context: ["记忆 A", "记忆 B"] }`，**当**用户提交「上次那个 bug 修了吗」，**则**本轮请求带上这两条（作为附加上下文），对话流里显示的仍是用户自己敲的那句原文。
2. **假设**同一次提交有两个 mod 都返回 `context`，**当**请求发出，**则**两条都在（按插件加载顺序拼接）；合计超过限额时丢弃多余部分并记一条 warn，这一轮照常发出。
3. **假设** mod 在 `prompt.submit` 钩子里又调 `$.prompt.submit`，**当**那条 prompt 落地，**则**它**不**触发 `prompt.submit`（否则是无限环），但它开的那一轮里 `turn.start` / `turn.step` 照常发。
4. **假设**钩子抛错或超过 5 秒，**当**用户提交，**则**这一轮照常发请求（只是没有注入），日志一条 warn，用户看不到错误。
5. **假设** mod 返回 `{ text: "改写", drop: true }`（Claude Code 同名事件的另外两个返回值），**当**钩子返回，**则**两项都被忽略、只认 `context`，并记一条 warn 说明「改/丢用户输入不支持」；`context` 不是字符串数组时同样忽略、不打断这一轮。

### 用户故事：插件按轮次节奏做事、会话结束时收尾（优先级：P1）

作为插件作者，我希望知道「一轮什么时候开始、走到第几步、上下文什么时候被压缩、会话什么时候没的」，以便按节奏刷新面板、退避轮询、上报用量。

**验收场景**：

1. **假设** mod 在 `turn.start` 与 `turn.step` 里累计步数，**当**用户问一个要连调三次工具的问题，**则** `turn.start` 一次、`turn.step` 四次（首答一次 + 每次工具结果后各一次请求），`e.index` 依次 0–3，`turn.complete` 一次。
2. **假设**用户在第二轮中途按 Esc，**当**这一轮结束，**则**不再有 `turn.step`，`turn.complete` 收到 `isAborted: true`。
3. **假设** `$.clock.sleep(30000)` 正在等，**当**用户关掉这条会话，**则**这次等待立刻 reject（`name === "AbortError"`），mod 的 catch 能跑收尾；传了 `{ signal }` 时 abort 行为相同。
4. **假设**上下文逼近窗口（历史远大于摘要），**当**自动压缩完成，**则** `session.compact` 收到 `{ trigger: "auto", tokensBefore, tokensAfter }` 且 `tokensBefore > tokensAfter`；手动 `/compact` 时 `trigger` 是 `"manual"`。两者不是同一把尺子（见「轮次内外的事件」），历史本来就很短时 `tokensAfter` 可能更大。
5. **假设** mod 打开了两个面板，**当**用户点掉其中一个的 ×，**则** `ui.close` 收到 `{ id }`；**当**整条会话被关掉，**则**只收到一次 `session.end`、不再收到两条 `ui.close`。
6. **假设** `session.end` 的钩子卡住，**当** 5 秒过去，**则**会话照常销毁（超时只记一条 warn，不阻止销毁）。
7. **假设** mod 是 `async function*` 写在 `turn.step` 上、`const below = yield* next(e)` 之后 `return { ...below, model: "claude-opus-4" }`，**当**这一轮的这次请求发出，**则**它用的是 `claude-opus-4`，且 apiType / 上下文窗口 / 输出上限按新模型重新解析（不是只换请求里的名字）；返回 `{ ...e, model: "  " }` **则**按没改处理，`turnId` / `index` / `messageCount` 也改不动。

### 用户故事：插件从环境变量和设置里读自己的配置（优先级：P1）

作为插件作者，我希望把配置放在用户熟悉的地方（`settings.json` 的 `env` 段或环境变量），并在插件里读到与会话相关的那几个事实（会话 id、工作根、模型），以便不用自造一份配置文件。

**验收场景**：

1. **假设**用户把 `MY_WATCH=1` 写进 `settings.json` 的 `env` 段，**当** mod 调 `$.env.get("MY_WATCH")`，**则**拿到 `"1"`；没设置的名字返回 `undefined`（不抛错），`|| 默认值` 就能兜底。
2. **假设** mod 调 `$.settings.read({ source: "project", key: "permissions" })` 而 `project` 层没有这个键，**当**调用发生，**则**得到 `undefined`；把 `source` 写成 `"policy"`（我们没有这一层）**则**抛错并列出 `user` / `project` / `local` 三个可用值。
3. **假设** mod 需要给会话打标，**当**它调 `$.session.id()` / `root()` / `model()`，**则**分别拿到当前会话 id（`/clear` 之后是新值）、会话工作根（`cd` 之后不变）、当前生效的模型名；三者都不改变会话任何状态。

### 用户故事：把社区里已有的 mod 原样装上就能跑（优先级：P0）

作为想试用社区 mod 的用户，我希望能直接把我找到的插件装上（它的目录布局和注册写法是冲着 Claude Code 的），不用请作者为我改一版，也不用我手动改 import。

**验收场景**：

1. **假设**插件是社区写法（`.claude-plugin/plugin.json` + `hooks/hooks.json` 的 `{"modules": ["./register.tsx"]}`，模块 `export const register = (on, options) => …`），**当**用户把它作为插件目录加载并开一个会话，**则**模块被加载、`register` 被调用、里面的 `on(...)` 与 `$.` 调用照常生效，一行都不用改。
2. **假设**社区 mod 的 handler 是 `($, e, next)` 且站点是 `Pane`，**当** `ui.render` 触发，**则** `$` 是那个 mod 的能力面、`next(e)` 返回 `undefined`（这块地方本来就归 mod），mod 返回自己的树；**当**站点是宿主自己会画的（后续期），**则** `next(e)` 返回引擎那一帧，mod 的返回值可以替换它。
3. **假设** mod 写 `import { atom, read, update } from 'claude-code'`，**当**加载，**则**解析到 `wave-agent-sdk/mods`（同一个虚拟模块），`read($, atom)` 取值、`update($, atom, …)` 写回都落在 `$.store` 上；**当**那个键还没有值，**则** `read` 返回 `atom` 声明的初值。
4. **假设** `plugin.json` 声明了 `userConfig.enabled`（`default: true`），**当** mod 在 `register(on, options)` 里读 `options.enabled`，**则**拿到 `true`；schema 里没写 `default` 的键**则**不在 `options` 里（一期没有「用户改值」的存储，见「布局」）。
5. **假设**同一个 handler 调了两次 `next(e)`，**当**第二次调用，**则**当场报错（链只走一次），日志点名 mod 与事件名。
6. **假设**一个 mod 用 `on("tool.call", { tool: ["Bash", "Edit"] }, handler)` 注册、另一个用 `on("ui.render", { component: "AbovePrompt", requestId: "above-prompt" }, handler)`，**当**一次 Bash 调用发起、带站点第三次重画，**则**两条钩子各自只在自己匹配的事件上被调用；**当**换成 `Read` 调用，**则**第一条不被调用（matcher 没命中 = 这次事件与它无关）。
7. **假设** mod 写 `on("session.measure", handler).catch((e) => …)`，**当**一次带 usage 的响应回来，**则** handler 收到的 `e` 里既有 `changed`、也有与 `$.session.usage()` 相同的 `context` / `tokens` / `startedAt` / `rateLimits`；**当** handler 抛错，**则** `.catch` 里那个被调用，会话照常继续。
8. **假设** mod 要读自己随包带的文件（`await $.fs.read(`${$.plugin.root}/weights.bin`, { as: "bytes" })`，camjac251/cc-enhanced 的钩子就这么取词表），**当**它拼这个路径，**则** `$.plugin.root` 是插件目录的绝对路径、`read` 拿到的是那份文件；**当**它改用相对路径 `read("weights.bin")`，**则**按会话工作目录解析、通常读不到 —— 两个目录是两回事。
9. # **假设**一个社区 mod 在 `turn.complete` 里读 `e.usage.input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `usage.model`，并按 `e.command === "guard"` 认自己的命令，**当**一轮答完、用户敲 `/guard off`，**则**五个字段都有数字（`input_tokens` = 本轮 `prompt` 减去两份缓存）、`e.command` 是不带斜杠的 `"guard"`、`e.args` 是 `"off"`。
10. **假设**社区 mod 在 `session.start` 里调 `$.ui.toast("hello", { timeoutMs: 8000 })` 并注册了 `on("ui.press", handler)`，**当**会话启动、用户点了它画在面板里的按钮，**则** toast 按 8 秒停留显示、`ui.press` 的 handler 收到 `e.element` 是那个控件的 `key`，两处都不抛错、也不中断 `session.start` 后面的 `$.ui.open`（`$.ui.toast(text, 8000)` 这种裸数字的老写法同样认）。

### 用户故事：插件显示「配了哪些、能调什么、有谁在跑」（优先级：P1）

作为插件作者，我希望在自己的面板上写「这个仓库配了哪几项」「一共有几个工具」「现在有几个子代理在跑」，以便不用让用户自己去翻设置和任务列表。

**验收场景**：

1. **假设** `settings.json` 里写了 `theme: "dark"` 与 `env: { MY_WATCH: "1" }`，**当** mod 调 `$.config.list()` 再 `find(row => row.key === "theme")`，**则**拿到 `{ key: "theme", kind: "text", value: "dark", isLocked: false }`；`env` 那种对象值不单独成行；没写过的键（例如 `mcpServers`）不在列表里，`find` 得到 `undefined`，作者的 `?? 默认值` 照常兜底。
2. **假设**用户把 `theme` 通过 Remote 托管下发，**当** mod 再读那一行，**则** `isLocked` 为真（菜单显示但拒绝改），`value` 是托管值而不是本地值。
3. **假设**注册了内置工具与一个 MCP server，**当** mod 调 `$.tool.list()`，**则**每项是 `{ name, description, mcp }`，MCP 那几项 `mcp` 为真、`name` 形如 `mcp__<server>__<tool>`，顺序与模型看到的工具表一致。
4. **假设**这条会话派了两个子代理、其中一个还在跑，**当** mod 调 `$.agent.list()`，**则**两条都在、`status` 分别是 `running` 与 `completed`、`id` 与子代理事件里的一致；**当**那条跑完的子代理任务被宿主丢掉，**则**它不再出现在列表里。

### 用户故事：插件读草稿、在工具行下面贴一行、复制一段话（优先级：P1）

作为插件作者，我希望看到用户打到一半的草稿（好在他的输入上面画提示），能在我关心的那次工具调用下面贴一句结论，也能把一段拼好的文本直接放进剪贴板，以便不用让用户自己去复制。

**验收场景**：

1. **假设**用户在输入框里打了 `看下 @a.png`，**当** mod 调 `$.prompt.read()`，**则** `text` 是这一串、`cursor` 等于 `text.length`；**当**同样的 mod 跑在终端 CLI 里，**则**拿到 `{ text: "", cursor: 0 }`，不抛错、钩子照常往下走。
2. **假设** mod 在 `tool.call` 里对 `e.tool_use_id` 调 `$.ui.notice(id, "已校验")`，**当**这次工具调用画出来，**则**那一行下面多一行灰字；**当**工具调用结束，**则**这行自己消失，插件不需要清理。
3. **假设** mod 用了一个不存在的 `tool_use_id` 调 `$.ui.notice`，**当**调用发生，**则**当场抛错（不静默丢弃）。
4. **假设** mod 调 `$.ui.copy({ text: "…" })`，**当**桌面端在画这条会话，**则**解析到 `{ isCopied: true }` 且剪贴板里是那段文本；**当**没有界面在画（`wave -p`），**则**解析到 `{ isCopied: false, reason: "no-surface" }`。

### 用户故事：插件能在工具真跑之前多问一次，也能拒绝（优先级：P0）

作为守卫类插件的作者，我希望在宿主已经按规则算出「放行 / 问一下 / 拒绝」之后再插一脚，以便把策略里加不进去的判断做掉（例如「这个仓库里 `npm publish` 一律先问」），而不是只能在更早的 `tool.call` 里硬拦。

**验收场景**：

1. **假设** mod 注册 `tool.check`，规则与模式给出 `allow`，钩子返回 `{ decision: "ask", reason: "发布前请确认版本号" }`，**当**模型发起那次调用，**则**弹出审批卡片、卡片上带那句 reason；用户批准后工具照常执行。
2. **假设**同一次调用命中了 deny 规则，**当** mod 返回 `{ decision: "allow" }`，**则**这次调用按插件的结论执行（放宽算数 —— 这是 CC 的契约，sotto 这样给自家工具免审批）。
3. **假设** mod 返回 `{ decision: "deny", reason: "…" }`，**当**调用发生，**则**工具不执行、模型收到 reason 作为错误结果，`classic.PermissionDenied` 的 `reason` 仍是 `denied_by_rule` 那套宿主短码（不被插件的 reason 覆盖）。
4. **假设**运在 `dontAsk` 模式下、原本不会弹卡片，**当** mod 抬成 `ask`，**则**卡片仍然弹出（收紧的含义就是「多问一次」）。
5. **假设**钩子抛错或超时，**当**调用发生，**则**按宿主原本的决定走（不因为插件坏了就放行），日志一条 warn。
6. **假设**一个子代理发起调用，**当**钩子读到 `e.agentId`，**则**能认出它属于哪个子代理；主会话的调用上这个字段不出现。
7. **假设** mod 想把 `AskUserQuestion` 这样的「本身就是提问」的工具放宽成 `allow`，**当**调用发生，**则**仍然弹卡片（这一类没有「不问就跑」的形态）。
8. **假设** mod 返回 `{ decision: "sure" }` 这种非法值，**当**调用发生，**则**按引擎的结论走，日志一条 warn。

### 用户故事：插件能改模型读到的提示词与说明文字（优先级：P1）

作为插件作者，我希望替换系统提示词里的某一段、把整场会话的上下文塞一次、压掉某条宿主提醒，也能改写工具与技能的说明文字，以便我的策略生效于模型真正读到的内容，而不是只在界面上提示用户。

**验收场景**：

1. **假设** mod 注册 `prompt.section` 并在 `e.name === "tone"` 时返回 `{ text: "只用中文回答。" }`，**当**下一轮请求发出，**则**请求里的语气段是这句、其余段一字未变；一轮里这段只问一次。
2. **假设** mod 对某个段返回 `{ text: null }`，**当**请求发出，**则**这一段整体不出现（不是空字符串占位）。
3. **假设**一个段都没被改，**当**请求发出，**则**拼出来的系统提示词与没有这些钩子时**逐字相同**（缓存前缀不被打断）；只有被改的那一段之后的前缀断开。
4. **假设** mod 注册 `prompt.context` 并返回 `{ blocks: [{ name: "lcm", text: "本仓库只用 pnpm" }] }`，**当**这条会话的第一条消息发出，**则**该块出现在上下文里；**当**用户在同一会话里继续追问，**则**不再重复注入（一条会话一次）；`next(e)` 交下去的同样是 `{ blocks }`（不是裸数组）。
5. **假设** mod 在 `prompt.attachment` 里按 `e.type === "memory"` 返回 `{ text: null }`，**当** AGENTS.md 注定入时，**则**那条提醒不出现、其余提醒不受影响；`e.type` 换成我们没发的值时不匹配（不会误伤）。
6. **假设** mod 注册 `tool.describe` 并给 `Bash` 返回新的 `description`，**当**这次请求组装，**则**模型看到的就是新描述（同一次请求，不是下一次）；**当**同一轮里连调三次工具，**则**描述只问过一次、三次请求里一致。
7. **假设** mod 对某个平铺工具返回 `{ isDeferred: true }`，**当**这次请求组装完，**则**该工具不再平铺、进 `REPL` 池，公告里出现它的名字；**假设**它对一个 MCP 工具返回 `{ isDeferred: false }`，**则**该工具回到平铺声明、从公告里消失；**假设**它对 `REPL` 自己返回 `true`、或在 `enableRepl: false` 的会话里返回 `true`，**则**这一项被忽略并记一条 warn（不能把唯一的通道或全部能力下架）。
8. **假设** mod 注册 `command.describe` 给某个命令返回 `{ isHidden: true }`，**当**命令列表画出，**则**该命令不显示；**当**用户直接敲那个命令，**则**它照常执行（隐藏只影响列表）。
9. **假设** mod 注册 `skill.prompt` 给一个技能返回 `{ text }`，**当**用户用 `/名字` 调用它，**则**模型收到的技能正文是改写后的。
10. **假设** mod 用 `{ name: "memory" }` 作 matcher 注册 `prompt.section`，**当**发出去的段表里有 `memory` 段（其余段名不同），**则**只有那一段进 handler；`next(e)` 解析到的是 `{ text }`（不是裸字符串），写 `const s = await next(e); return { text: s.text + "…" }` 能拿到原文（lossless-claude 就是这个写法）。
11. **假设** mod 在 `session.start` 里给 `Bash` 返回了描述 A、这场会话已经把 A 存下（之后每次请求都用它），**当** mod 之后再调一次 `$.ui.invalidate("tool.describe")`，**则**之后拼工具表时会重问这条钩子、下一次请求里模型看到的就是新的描述 B（A 那一份不再被当作最终答案，与 `breakPromptCache: true` 同一个后果）；**当**它调 `$.ui.invalidate("prompt.section")`（我们不支持的目标），**则**当场报错并列出可用的两个目标。

### 用户故事：插件能在消息存下之前改写它、也能读到已经存下的（优先级：P1）

作为需要脱敏或标注的插件作者，我希望在一条消息落进转录之前改掉其中的敏感片段，也能读到这条会话已经存下的消息，以便给自己的面板做历史视图。

**验收场景**：

1. **假设** mod 注册 `session.append` 并把 `message` 里文本块中的 token 替换成 `***`，**当**一条 assistant 消息落库，**则**转录里存的是替换后的文本；同一个会话里后续请求读到的也是这一版。
2. **假设** mod 返回 `{ deny: "脱敏失败，丢弃这一条" }`，**当**这一行要落库，**则**它**不**进转录，日志一条 info，界面上这一行仍显示（界面与转录是两份数据）。
3. **假设** mod 在 `next({ ...e, message })` 里改了 `role` 或块类型，**当**钩子返回，**则**当场抛错、按原样存下（不允许改身份）。
4. **假设**会话里已经有 300 条消息，**当** mod 调 `$.session.messages()`，**则**只拿到最近 200 条（最新的在最后），单条超限的按限额截断并带省略号。
5. **假设** mod 在 `session.append` 里抛错或超时，**当**消息要落库，**则**按原样存下（不因为插件坏了就丢消息），日志一条 warn。
6. **假设** `session.append` 里返回的 `message` 与 `$.session.messages()` 里的同形，**当**插件把前者直接喂给后者渲染，**则**字段对得上（`id` / `role` / `content` 与块形状一致）。
7. **假设** mod 读 `e.uuid` 与 `e.door`，**当**一条用户消息落库，**则** `uuid` 等于 `message.id`、`door` 是 `prompt`；返回值里同样带 `uuid`，插件按它串联自己记的那份（lossless-claude 的 shadow 就这么读）。

### 用户故事：插件带来自己的工具、派自己的子代理、自己问模型一次（优先级：P1）

作为想把外部系统接进对话的插件作者，我希望插件能带来模型**直接调用**的工具、能派子代理去做一段独立的工作、也能自己问模型一句话，以便把「查工单」「批量审阅」「给长文本分类」这类活儿真正做成插件，而不是只画一个面板。

**验收场景**：

1. **假设** mod 在 `tool.register` 里注册了 `lookup_ticket`（没给 `isDeferred`），**当**这次请求组装完，**则**模型看到的 `tools[]` 里没有它，它进了 `REPL` 池、公告里出现 `mcp__<plugin>__lookup_ticket`；**当**模型调它，**则**这条调用走与 MCP 工具同一条审批路（用户能看见、能拒），执行体是 mod 的 `tool.call` 钩子，它返回的 `{ result }` 就是模型读到的结果；**假设**注册时给了 `isDeferred: false`，**则**它照常出现在 `tools[]` 里、不进公告。
2. **假设** 注册的工具名与内置工具、别的插件的工具或某个 MCP 工具重名，**当** `$.tool.register` 调用，**则**注册失败并在错误里说明是谁占了那个名字。
3. **假设** 插件被重载或会话结束，**当**下一次组装声明与公告时，**则**那个工具从公告里消失、也调不到了（`tools[]` 本来就没有它）；同一轮里已经跑起来的调用不被打断。
4. **假设** mod 注册 `agent.spawn` 并返回 `{ deny: "…" }`，**当** Agent 工具要起子代理，**则**子代理不启动、模型收到这段文本作为错误结果；**假设**返回 `next({ ...e, prompt })`，**则**子代理拿到的是改写后的 prompt。
5. **假设** mod 在 `agent.offer` 里返回 `{ isOffered: false }`，**当**Agent 工具的清单画出、或模型试图派发这个类型，**则**它既不在清单里、也派不出去。
6. **假设** 同一个 mod 已经派了 4 个还在跑的子代理，**当**它再调 `$.agent.spawn`，**则** reject 并说明上限；**假设** mod 派的子代理里再调 `$.agent.spawn`，**则**同样 reject（深度只到 1）。
7. **假设** mod 在 `prompt.section` 钩子里调 `$.model.complete`，**当**这次调用耗时 20 秒，**则**那个钩子的 5 秒预算被暂停、这次调用按自己的超时走完；返回 `{ isAnswered: true, text, usage }`，这次 usage 记进会话总量，`session.measure` 里带 `source: "mod"` 与 `plugin`。
8. **假设** 传的模型不在 allowlist 里，**当** `$.model.complete` 调用，**则**当场 reject 并说明这个模型不许用（不是返回 `aborted` —— 这次请求根本没发出去）；**假设** provider 回了 529，**则** resolve 成 `{ isAnswered: false, reason: "api-error", status: 529, usage }`。
9. **假设** 一条会话里同一个插件已经调了 50 次 `$.model.complete`，**当**它调第 51 次，**则** reject 并说明额度用完了。
10. **假设** 在终端里，**当**用户打字，**则** `prompt.edit` / `prompt.suggest` 都不触发；**假设** 在桌面端用户打了一个字，**则** mod 收到一次 `prompt.edit`，返回 `{ text, cursor }` 之后输入框变成改写后的内容。
11. **假设** mod 调 `$.prompt.suggest({ text })`，**当** `prompt.suggest` 派发到别的插件，**则** `e.origin` 是 `{ kind: "plugin", name }`，引擎自己的推荐是 `{ kind: "suggestion" }`；**假设** 某个钩子返回 `{ isShown: false }` 且不调 `next`，**则**输入框不出现建议，`$.prompt.suggest` 拿到 `{ isShown: false }`。

### 用户故事：插件先看见用户按了哪个控件，再决定回调收到什么（优先级：P1）

作为面板类插件的作者，我希望能借一次按钮/输入/选择做点别的事（埋点、校验、把这次按键转给另一个控件），而不是只能等 `onPress` 被调用。

**验收场景**：

1. **假设** mod 画了 `Button({ key: "deploy" })` 并注册 `on("ui.press", handler)`，**当**用户点了它，**则** handler 先收到 `{ plugin, surface, component: "Pane", requestId, element: "deploy" }`，`onPress` 在它返回**之后**才跑。
2. **假设** mod 画了 `Input({ key: "tag" })`，`ui.input` 的 handler 返回 `{ value: e.value.trim() }`，**当**用户提交 `" dev "`，**则** `onSubmit` 收到 `"dev"`；元素树里那份 `value` 不变（下一帧画什么仍由 `ui.render` 决定）。
3. **假设** handler 返回 `{ element: "cancel" }` 且同一个 pane 里画着 `Button({ key: "cancel" })`，**当**用户按了 `deploy`，**则**跑的是 `cancel` 的 `onPress`；**假设** `cancel` 不在这个 pane 里，**则**按原来的 `deploy` 派发，日志一条 warn。
4. **假设** handler 在 `ui.select` 上返回 `{ value: 42 }`（不是字符串），**当**用户选了一项，**则**这一项被丢掉、日志一条 warn，`onSelect` 拿到用户原本选的值。
5. **假设**两个 mod 都注册了 `on("ui.press", handler)`（都不写 matcher），**当**用户按了其中一个画的按钮，**则**只有画那个按钮的 mod 的 handler 被调用；**假设**其中一个写 `{ plugin: "另一个 mod" }`，**则**它也会被调用（`"*"` 同理）。
6. **假设**同样的 mod 跑在终端里，**当**用户用热键/回车按下 `Button`，**则**同样收到一次 `ui.press`；`component` / `element` / `requestId` 与桌面端一致，`surface` 是 `"terminal"`。

### 用户故事：插件能先问一句「这个工具我能不能用」（优先级：P1）

作为要在动手之前自查的插件作者，我想在不真的执行工具的前提下问一句「按现在这些规则与插件，这个调用会被拦吗、会被要求审批吗」，以便自己的流程能提前降级，而不是撞上去才发现。

**验收场景**：

1. **假设**另一个 mod 注册了 `on("tool.check", { tool: "Bash" }, () => ({ decision: "deny", reason: "发布前请确认版本号" }))`，**当** mod 调 `$.tool.check({ tool: "Bash", input: { command: "npm publish" } })`，**则**解析到 `{ decision: "deny", reason: "发布前请确认版本号" }`，**且**没有任何工具被执行、没有审批卡片弹出。
2. **假设**没有任何钩子收紧，**当** mod 调 `$.tool.check({ tool: "Read" })`，**则**解析到 `{ decision: "allow" }`（基底是「还没人拦」，不是规则算出来的决定）。
3. **假设**另一个 mod 的 `tool.call` 钩子返回 `{ deny: "…" }`，**当** mod 调 `$.tool.call({ tool: "Bash", input })`，**则**解析到 `{ deny: "…" }`；没人拦时解析到 `{}`。
4. **假设** `$.tool.call` 触发了一次真实调用（钩子调了 `next(e)`），**当**链走到尾，**则**链尾是空对象 —— 方法**不执行**工具，返回里没有 `{ result }`。
5. **假设**钩子的 matcher 是 `{ tool: "Bash" }`，**当** mod 调 `$.tool.check({ tool: "Read" })`，**则**那条钩子不被调用（与真实调用同一个匹配规则）。
6. **假设** mod 在自己的 `tool.check` 钩子内部调 `$.tool.check`（同一个 mod 的同名事件重入），**当**调用发生，**则**当场 reject 并说明「不能在钩子里重入同名事件」；`$.tool.call` 同理。

### 用户故事：退出时能把 worktree 删干净（优先级：P1）

作为在 worktree 里干活的使用者，我希望退出并选择「删除」之后目录真的消失，而不是留下一个只有 `.git` 的空壳和一条「手动清理」提示 —— 只要插件带的 mods 编译过，这个目录就删不掉了。

**验收场景**：

1. **假设** 我用 `wave -w demo` 起了一个会话，装载的插件带 TSX mods（编译器起过一次），**当** 我退出并选择删除 worktree，**则** 目录被整个删掉、输出 `Done.`，不出现「Worktree directory survived at …」。
2. **假设** 同一个进程里随后插件重载又带来新的 mods，**当** 再次编译，**则** 编译器自动重起、编译结果照常，用户不需要做任何事。
