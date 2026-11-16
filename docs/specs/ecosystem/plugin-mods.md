---
name: "插件 MODS"
description: "用 TSX 给插件加界面与事件钩子：mods 的编译、执行、渲染、定时器、外部进程与限额（一期仅桌面端面板）"
order: 75
---

# 功能规格说明：插件 MODS

## 背景

现在的插件只能做**声明式**扩展：命令、技能、子代理、钩子、LSP、MCP 六类能力都是数据（文件 + JSON），由宿主读取后注册。插件无法在会话里**画自己的界面**，也无法**在 Claude 动手前看到并改写事件**。

MODS 补上这两件事：插件带一个 TypeScript 模块（可写 TSX），运行在 agent 进程内，向宿主返回一棵声明式元素树，宿主按自己的渲染能力画出来，用户的点击/输入再回到这个模块。Claude Code 的 mods 是同一形态（`docs/specs` 外的对照调研见 PR 描述），本规格只取其最小可用子集。

一期只做**桌面端**：一方是右侧面板槽里的 mod 面板，另一方是**不属于任何面板**的三样东西 —— 输入框上方的状态带、输入框下方的常驻状态行、以及短暂提示。面板能自己起定时器（`$.clock`）盯住外部状态，外部程序经 `$.store` 与它交换状态和意图。外部程序可以只由用户自己跑，也可以由 mod 用 `$.process.spawn` 起（例如第三方服务的 WebSocket 客户端），它读到的内容再用 `$.prompt.submit` 投进对话。VS Code / JetBrains / 终端渲染、事件拦截改写、`Client` 动画、模型调用都留到后续期；mod 侧请求宿主新建会话本期不做（见「面板的归属」）。

## 概念

- **mod**：插件目录下的一个模块文件（`.tsx`/`.ts`/`.jsx`/`.js`），导出 `register($, on)`。一个插件可以有多个 mod。社区里的写法（`hooks/hooks.json` 的 `modules` 声明 + `register(on, options)` + handler 收 `($, e, next)`）同样认，见「兼容社区 mod」。
- **hooks module**：普通的 ES 模块，在 agent 进程内执行。它没有 Node 全局（`fs`/`process`/`setTimeout` 都没有），只能通过 `$` 做事。
- **render site**：宿主界面上的一个可画点。一期有两个：`Pane`（桌面端右侧面板的一个 tab）与 `AbovePrompt`（输入框上方的状态带）。
- **surface**：真正画树的渲染端（一期就是桌面端 webview）。树由 surface **拉取**：surface 对每个已挂载的 pane、以及输入框上方那条带各发一次请求，agent 进程才去问 mod；宿主不主动把树推给 surface。
- **元素树**：`Box`/`Text`/`Button`/`Input`/`Select`/`Svg`/`Link`/`Code`/`Markdown`/`Progress` 组成的嵌套声明，纯数据，可 JSON 序列化。
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

## 编译

- **逐文件转译，不打包**。每个文件单独编译，相对 import 由我们自己解析（与 Claude Code 同构），不解析 `node_modules`。
- **JSX 用 classic pragma**：`esbuild.transform` 传 `jsx: "transform"` + `jsxFactory: "__wave.h"` + `jsxFragment: "__wave.Fragment"`，与 TSX 里的 `<Box>` 对应到 runtime 注入的全局 `__wave`。
- **编译器是 esbuild 的 `transform`**。选型依据：单文件 5KB 热态 0.8ms、冷启动 7ms；比 `esbuild-wasm`（170ms / 5ms）和 `@swc/wasm`（89ms / 1.3ms）快一个量级，且不需要在 webview/renderer 侧执行。逐文件 `transform` 而不是一次 `build` 的理由：两者都不打包（相对 import 由沙箱的 `require` 解析），差别只在批量开销（60 个 5KB 文件 11.5ms vs 48ms，一次性），而 `transform` 的报错天然带 `sourcefile`。
- **esbuild 走仓库既有的「运行时按需依赖」范式**：与 `@vscode/ripgrep` / `sharp` / `wave-search-tools` 同一张表（`packages/agent-sdk/src/utils/runtimeDeps.ts` 的 `RuntimeDependency`），**不进 bundle、不进安装包**。esbuild 的 JS API 不能被打包进单文件产物（实测抛 `The esbuild JavaScript API cannot be bundled`），走这条范式天然绕开：`__filename` 是真实的 `esbuild/lib/main.js`，`generateBinPath()` 的 `require.resolve("@esbuild/<platform>-<arch>/bin/esbuild")` 相对它解析，与 rg 是同一条「Node 往上找」机制。
  - 表项：`sharedPackages` = `esbuild` 本身，`platformPackages` = `@esbuild/<platform>-<arch>`（版本取 `entry.optionalDependencies`），`libcAwarePlatformKey: false` —— esbuild 是 Go 静态二进制，平台包里没有 musl 变体，且 `<platform>-<arch>` 与现成的 `runtimePlatformKey()` 输出格式一致。
  - 加入**默认批次**：随 CLI 启动后的 `void ensureRuntimeDeps()` 一起下载，落在共享的 `~/.wave/cli/node_modules`，升级不重下。首次约 4.5 MB（`@esbuild/linux-x64` 4.52 + `esbuild` 0.03，0.28.x 实测），桌面端随包的 CLI（`resources/wave-cli`）**不带任何 esbuild 文件**。
  - SDK 用 `createRequire` 从 CLI home 解析；解析失败不静默降级 —— mod 加载失败并在面板上显示「TSX mod 需要 esbuild」。

## 元素与能力

### 元素

| 元素       | 主要 props                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 说明                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Box`      | `flexDirection`、`flexWrap`、`flexGrow`、`flexShrink`、`gap`/`columnGap`/`rowGap`、`padding`、`paddingX`/`paddingY`、`paddingTop`/`Right`/`Bottom`/`Left`、`margin`、`marginX`/`marginY`、`marginTop`/`Right`/`Bottom`/`Left`、`width`/`height`/`minWidth`/`minHeight`、`borderStyle`、`borderColor`、`borderDimColor`、`backgroundColor`、`alignItems`、`alignSelf`、`justifyContent`、`display`、`position`、`top`/`left`/`right`/`bottom`、`overflow`、`hover` | 布局容器，用 CSS flex 实现                                                                                 |
| `Text`     | `color`、`backgroundColor`、`weight`、`size`、`bold`、`italic`、`dimColor`、`underline`、`strikethrough`、`inverse`、`wrap`、`hover`                                                                                                                                                                                                                                                                                                                              | 一段文本                                                                                                   |
| `Button`   | `key`、`label`、`onPress`、`disabled`、`variant`（`"primary"`/`"secondary"`）、`plain`、`dimColor`、`autoFocus`、`hover`                                                                                                                                                                                                                                                                                                                                          | 点击后触发 `ui.press`                                                                                      |
| `Input`    | `key`、`label`、`placeholder`、`value`、`submitLabel`、`onSubmit`、`autoFocus`、`rows`                                                                                                                                                                                                                                                                                                                                                                            | 提交后触发 `ui.input`                                                                                      |
| `Select`   | `key`、`options`、`onSelect`、`label`、`value`、`autoFocus`                                                                                                                                                                                                                                                                                                                                                                                                       | 下拉选择，选中后触发 `ui.select`；`options` 是 1–64 个 `{ value, label? }`，`value` 唯一                   |
| `Svg`      | `source`、`alt`、`width`、`height`、`isInteractive`                                                                                                                                                                                                                                                                                                                                                                                                               | 一段 SVG 标记内联画出来；`source` 非空且 ≤131072 字符，`alt` 必填（没有它等于没有可读文本）                |
| `Link`     | `href`、`label`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 只允许 `https:` 与本地回环 `http:`；点击交给宿主用系统浏览器打开（`openExternal`），不在 webview 里导航    |
| `Code`     | `source`、`language`、`path`、`startLine`、`wrap`                                                                                                                                                                                                                                                                                                                                                                                                                 | 一期用 `<pre><code>` 原样展示（不做语法高亮），可选一行文件路径；`wrap` 只有 `"wrap"`/`"truncate-end"`     |
| `Markdown` | `text`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `marked` + `DOMPurify` 渲染（与 webview 既有 markdown 用法同一套）                                         |
| `Progress` | `label`、`value`、`max`、`valueText`、`color`                                                                                                                                                                                                                                                                                                                                                                                                                     | 一条进度：`value/max` 夹到 0–1（`max` 缺省 1），`valueText` 缺省是百分比；有 `value` 时是两行（标签 + 条） |

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

**`Button.plain`** 是布尔开关（`true` 才画）：画成一串「字形 + label」的扁平按钮，不带边框与底色（一排 `➤` / `✕` 图标键就用它）；`plain` 为真时 `variant` 不再起作用。**`Button.dimColor`** 让 label 静止时调暗、指针进来时恢复全强度。**`autoFocus`**（`Button` / `Input` / `Select`）只认布尔，`true` 才抢焦点（Claude Code 那边 `false` 会被拒；我们收布尔是因为 `autoFocus={cond}` 是自然写法），一个站点里多个时只有第一个生效。

**`Input.rows`** 是 ≥1 的整数（缺省 1）：从 2 起变成多行输入（等价 `<textarea rows>`），Enter 仍提交、换行按输入框的默认打法。`Code.wrap` 只有 `'wrap' | 'truncate-end'` 两个值（`Text.wrap` 的其它拼法在这里被拒 —— 有行号 gutter 时它们没有意义）。

**`hover` 是节点的独立字段，不在 props 里**：`h()` 把 JSX 上的 `hover={{ … }}` 摘到节点的 `hover`，因为它的值是**对象**（props 只收原始值）。结构是两个封闭的 key 集：

- `Box`：`scope`、`borderStyle`、`borderColor`、`borderDimColor`、`backgroundColor`、`display`（只认 `'flex'`，用来 reveal 一个 `display: "none"` 的 `Box`）、`top`/`left`/`right`/`bottom`（只对 `position: "absolute"` 有效）。**没有一个会让兄弟移位**。
- `Text` / `Button`：`scope`、`color`、`backgroundColor`、`dimColor`、`bold`、`italic`、`underline`、`strikethrough`、`inverse`（`Button` 的 `hover` 改的是它 label 的样式，不含 `wrap`）。

**生效范围是「最近的带 `key` 的 `Box`」**：指针落在那个 `Box`（含其后代）里时，它自己和所有后代的 `hover` 一起生效；在里面再套一个带 `key` 的 `Box` 就是新的 scope。`scope` 给一个字符串时，这个元素加入**同名 scope** 而不是最近的 `Box` —— 让画在行外的卡片跟着行内元素一起亮。悬停**不跑钩子、不过进程**：它只是 surface 自己按指针位置换一组样式。

**props 是白名单，写错要报错**：每个元素只认上表列出的名字，多写一个（拼错、或照别的框架习惯写 `className`/`style`）在 `validateModTree` 阶段就失败并点名那个 prop —— 静默忽略会让作者以为写对了、却看不到任何效果。这条与 Claude Code 的元素校验一致（它的 `Button` 校验连 `variant` 的取值都会挑出来）。`hover` 的子 key 同样按上表校验，写错 key 也点名。

`flexGrow`/`flexShrink`/`flexWrap` 用 Claude Code 的同名 props，作用于**这个 `Box` 在父容器里**怎么伸缩与折行。`Button` 不收这三个名字 —— 宿主给按钮的默认是 `flex: 0 0 auto`，一排按钮不会被压成竖排；带里按钮多到放不下时，给那一行的 `Box` 写 `flexWrap="wrap"` 折到下一行。

`Select` / `Svg` / `Progress` 与前面七个的差别只有一条：**它们的 props 里有非原始值**（`Select.options` 是对象数组）。所以「prop 必须可序列化成原始值」这条规则按元素区分 —— 只有 `Select.options` 走数组，其余元素照旧只认字符串/数字/布尔/null。三个都是**叶子**（带 children 会被校验拒掉），而且它们的语义全在 prop 上（选哪几项、画哪段图、填充到几分之几），所以除了名字白名单还查取值：空 `options`、重复 `value`、超限的 `source`、非数字的 `value/max` 都当场点名。

**被丢掉的对象 prop 要出声**：`h()` 只留原始值（`Select.options` 与 `hover` 两处例外），其余非原始值到不了树上。这类 prop（`style={{…}}`、`className` 的变体）以前是静默丢弃 —— 作者看到「写了没效果、也没有报错」。现在每丢一个记一条 warn，点名元素与 prop。

上面这些名字从 `wave-agent-sdk/mods` 导入，那个子路径就是它们的 props 类型来源（`Box`、`Text`… `Fragment` 加各自的 `*Props`），插件作者写 TSX 时靠它拿类型补全；运行时值只是元素名字符串，实际由沙箱的 `require` 提供同一份表。

### 事件（一期）

`register($, on)` 的 `on(name, handler)` 注册**生命周期钩子**：

| 事件                        | 触发时机                                                                                                                                                                                                                                                                                                                                                                             | 钩子可返回                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `session.start`             | 会话初始化完成、第一个 prompt 之前                                                                                                                                                                                                                                                                                                                                                   | 无（返回值忽略；面板得在这里 `$.ui.open`）     |
| `prompt.submit`             | 用户审阅并提交一条 prompt（含 mod 自己调 `$.prompt.submit`），**模型请求还没发出之前**，见下                                                                                                                                                                                                                                                                                         | `{ context?: string[] }`：塞给模型的额外上下文 |
| `turn.start`                | 一轮开始（用户消息已进上下文、第一个模型请求之前）                                                                                                                                                                                                                                                                                                                                   | 无（返回值忽略）                               |
| `turn.step`                 | 一轮里**每发出一次模型请求之前**（工具循环的每一步），`e.step` 从 1 起                                                                                                                                                                                                                                                                                                               | 无（返回值忽略）                               |
| `ui.render`                 | surface 请求某个 render site 的树时（宿主不缓存，每次请求都重新问 mod）；事件带三个正交的维度：`e.surface` 是画这棵树的那一端（一期只有 `desktop`）、`e.component` 是站点名（一期有 `Pane` / `AbovePrompt`）、`e.instance_id` 是该站点的哪个实例（`Pane` 是 `$.ui.open({ id })` 的 id，带固定是 `above-prompt`）；`e.props` 是站点给的版面事实（`bodyColumns` / `maxRows` 等，见下） | 元素树                                         |
| `turn.complete`             | 一轮对话结束（答完，或被用户中断），见下                                                                                                                                                                                                                                                                                                                                             | 无（返回值忽略）                               |
| `session.measure`           | 一次带 usage 的响应回来后、token 计数已更新，见下                                                                                                                                                                                                                                                                                                                                    | 无（返回值忽略）                               |
| `session.compact`           | 上下文压缩**完成后**（自动或手动 `/compact`），`e` 是 `{ trigger, tokensBefore, tokensAfter }`                                                                                                                                                                                                                                                                                       | 无（返回值忽略）                               |
| `tool.call`                 | 一次工具调用**结束**后（拿到工具结果、`PostToolUse` 钩子跑完），见下                                                                                                                                                                                                                                                                                                                 | 无（返回值忽略；**不能**拦下这次调用）         |
| `classic.PermissionRequest` | 一次工具审批**即将**弹给用户时（`PermissionRequest` 钩子已放行、宿主询问用户之前），见下                                                                                                                                                                                                                                                                                             | 无（返回值忽略；**没有**批准/拒绝通道）        |
| `command.run`               | 用户执行了一个由 `$.command.register` 注册的命令，或 mod 自己调 `$.command.run`（见「注册命令」）                                                                                                                                                                                                                                                                                    | `{ text }`：这一行要变成的 prompt              |
| `session.end`               | 会话销毁（关掉这条会话、进程退出）**之前**；返回后该会话的 mod 实例、定时器与外部进程全部撤销，其面板**不再**逐条发 `ui.close`                                                                                                                                                                                                                                                       | 无（返回值忽略）                               |
| `ui.close`                  | 一个**由 mod 打开**的面板被关掉、且 mod 实例还活着：用户点 ×、mod 调 `$.ui.close`、`/reload-plugins`。`e.id` 是 pane id                                                                                                                                                                                                                                                              | 无（返回值忽略）                               |

`ui.render` 的事件要交给 `$.ui.resolve(e)` 换元素表（见下）；表外的元素名会被 `validateModTree` 拦下。

`ui.render` 的 `e.props` 是**站点给的版面事实**，一期四个字段：`bodyColumns`（正文宽度，单位字符）、`maxRows`（这个站点一次最多显示多少行）、`hasSurvey` / `isWorking`（`false`，协议占位）。mod 按 `bodyColumns` 断行、按 `maxRows` 决定要不要自己滚，比猜宽度稳。字段只增不减地往上加，读不到的按缺省处理。

**面板被关掉时有 `ui.close`**（`e.id` 是被关的那个 pane）。Claude Code 同样有这个名字 —— 它的首方插件在自己的 scan 声明里把 `ui.close` 列进可监听钩子，与 `ui.render` 并列。发完之后宿主内部清理（撤销该 pane 的回调表与登记，之后的请求不再返回树）；`ui.close` 只是告知，**不能**拦下关闭。会话销毁时不逐条发它，只发一次 `session.end`（实例马上整体丢弃，逐条通知没有接收方）。mod 想确认面板还在不在，仍可用 `$.ui.panes()` 查。

用户交互**不走** `on`，而是写在元素自己的回调 prop 上（回调用 `key` 与元素绑定，不进树）：

| 回调                     | 触发时机                                                     | 返回值 |
| ------------------------ | ------------------------------------------------------------ | ------ |
| `Button.onPress()`       | 用户点了面板里的一个 `Button`                                | 忽略   |
| `Input.onSubmit(value)`  | 用户提交了面板里的一个 `Input`，`value` 是输入的字符串       | 忽略   |
| `Select.onSelect(value)` | 用户在面板里的 `Select` 选了一项，`value` 是那一项的 `value` | 忽略   |

`Select` 的选中值**不会**自动变成元素自己的 `value`：宿主只报「选了哪个」，下一帧画什么由 `ui.render` 的返回值决定（mod 想让它停在新的选中项，就把 `value` 一起写进状态）。这与 `Input` 提交后清空是同一条纪律 —— 控件的状态归 mod，不归 webview。

### 轮次内外的事件（只读）

`prompt.submit` / `turn.start` / `turn.step` / `session.compact` / `session.end` / `ui.close` 六个事件回答「一轮对话里正在发生什么」「会话什么时候没了」。除 `prompt.submit` 能往上下文里塞文本，其余返回值一律忽略。

- **`prompt.submit` 只在用户敲的那条 prompt 上触发**：mod 自己经 `$.prompt.submit` 投进来的**不再触发**它 —— 否则 handler 里再 submit 一次就是无限环。触发点在「用户消息已进上下文、本轮第一个模型请求还没发出」之间，与 Claude Code 同一个位置（它的 `prompt.submit` 钩子在 `next(e)` 里跑完 `classic.UserPromptSubmit` 之后、请求发出之前）。
- **返回值只认 `context`**：`{ context?: string[] }`，字符串数组，合起来受限额（见「限额」）。宿主把它们当作**本轮**的附加上下文，走与 `tool.call` 的 `context` 同一套注入点（请求边界），模型下一个请求就能看到；不写进用户消息原文。
- **不改 `text`、不给 `drop`**：这两项是 Claude Code 同名事件另外两个返回值（改掉用户敲的话、或把这条 prompt 丢掉）。改/丢用户输入在这种「钩子跑在界面看不到的地方」的位置上没法让用户察觉，产品上不给插件。
- **`turn.start` / `turn.step` 的分工**：`turn.start` 一轮一次，在用户消息落库之后；`turn.step` 每发一次模型请求之前一次，`e.step` 从 1 起 —— 一轮里有 N 次请求（工具循环）就有 N 个 step。用户中断后不再有 step，`turn.complete` 带 `isAborted: true` 收尾。
- **`session.compact` 在压缩完成之后**，`e` 是 `{ trigger: "auto" | "manual", tokensBefore, tokensAfter }`。`tokensBefore` 与 `$.session.usage()` 的 `context.tokens` 同一处（锚定最后一次请求的 usage，含系统提示词与工具 schema）；`tokensAfter` 只数压缩后新历史的消息文本 —— 压缩刚结束还没有新请求的 usage 可锚定，而被保留下来的那两轮仍带着压缩前的 usage，按同一处口径算会原样报回压缩前的数字（真机实测两者曾完全相等）。这一对是「压缩前的估算上下文」与「压缩后的历史文本量」，**不是**同一把尺子：上下文接近窗口时前者远大于后者，但窗口极小、历史本来就很短时，摘要本身可能比被折叠掉的内容更长，此时 `tokensAfter` 反而更大（探针实测 985 → 2248）。mod 要判断「省了多少」应把它当最近似值，不要当不变量。
- **`session.end` 是唯一一个宿主会等的**：会话销毁要先撤销 mod 实例，所以它必须在销毁之前跑完；仍受 5 秒上限约束，超时照常销毁。其余五个都是 fire-and-forget（抛错、超时只记一条 warn），也都不重放。

### 完成与审批的观察（只读事件）

第三方服务想把「对话答完了」「有张审批卡片在等」反映到自己的页面上（网页那边看到一个通知），用的就是这三个事件：它们只报告宿主**已经发生**的事实，不改变任何行为。

| 事件                        | 载荷                                                                                            | 触发边界                                                                                                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `turn.complete`             | `{ isAborted, durationMs, answer, usage }`                                                      | 一轮结束：答完或用户中断（Esc / 停止）。`durationMs` 从这一轮开始处理到结束，`answer` 是最后一条 assistant 消息的正文，`usage` 是本轮所有模型请求的 token 合计；因 Stop 钩子要求继续、注入后台任务通知而重开的循环算**同一轮**，只在真正结束时触发一次（`usage` 也不从头再算） |
| `tool.call`                 | `{ tool, input }`                                                                               | 一次工具调用结束、结果已经拿到（`PostToolUse` 钩子之后）。`tool` 是工具名、`input` 是它收到的参数对象。审批被用户拒掉、工具执行抛错也照发（mod 要靠这个知道「这一下结束了」）；**只读**，拦不下这次调用                                                                        |
| `classic.PermissionRequest` | `{ session_id, transcript_path, cwd, hook_event_name, tool_name, tool_input, plan_file_path? }` | 一次工具审批即将弹给用户。权限规则自动放行或拒绝的不触发（没有卡片要显示），`PermissionRequest` 钩子把这次请求拒掉的也不触发                                                                                                                                                   |

**与 Claude Code 的关系**（照它官方 mods 的 events 参考核过）：

- `turn.complete` 是**同名事件**（CC 的 Turns 分组里有 `turn.start` / `turn.step` / `turn.complete`），字段取 `isAborted` / `durationMs` / `answer` / `usage` 四个。**没有** `turnId` / `agentId`（我们只报主 agent 的轮次，子代理的嵌套轮次不报），也不实现返回 `{ text }` 在答案下面显示一行那个能力。
- `classic.PermissionRequest` 用 CC 的 `classic.` 前缀，因为 CC 把**每个** settings hook 事件都镜像成 `classic.<Event>`（`classic.Stop`、`classic.PostToolUse`…），`e` 就是那份 hook stdin JSON（snake_case，含 `transcript_path`）。我们**只做这一个镜像**，不是整套 `classic.*`；载荷字段与 `PermissionRequest` 钩子收到的 stdin 一致。
- 审批**不是** `tool.check`：那是 CC 里唯一能拿到并改写放行决定的钩子（`{ decision: allow | ask | deny }`），被 mod 拿去做「自动批准」时用户的卡片就形同虚设，本规格明确不做。
- `tool.call` 只做**只读观察**这一半：CC 的同名事件允许返回 `{ deny }` 拦下这次调用，那是决策型钩子（与 `tool.check` 同级，要处理与权限模式的仲裁顺序、也要处理「插件拦了但用户看不到原因」）。我们只发事件、丢弃返回值；`prompt.*` 那族改写钩子同样不做。

四条约束：

- **只读**：三个事件的返回值都被忽略。`classic.PermissionRequest` **不是**审批通道 —— 批准、拒绝、记住规则都只能由用户在界面上做（或由既有权限规则决定），mod 无法替用户答；`tool.call` 也拦不下调用。
- **`usage` 是本轮、`$.session.usage()` 是整场**：同名的 `tokens` 字段（`prompt` / `completion` / `cacheRead` / `cacheCreation`），作用域不同，别混用；`prompt` 两侧都**含**缓存命中的 token。
- **`turn.complete.usage` 同时给 Claude Code 的四个别名**（`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`，外加 `model`）：社区 mod 直接拿 `u.input_tokens` 做加法，缺一个就是 `undefined`、整条带画出 `NaN`。`input_tokens` 是 `prompt - cacheRead - cacheCreation`（**不含**缓存命中，与我们自己的 `prompt` 不是同一个数），所以是换算而不是改名。
- **不阻塞**：派发是 fire-and-forget，mod 在钩子里做网络上报不会卡住轮次收尾或那张审批卡片；钩子抛错、超时（5 秒）只记一条 warn，本轮照常结束、审批卡片照常弹出。
- **不重放**：三者都是瞬时事件，surface 后挂上来（切会话、webview 重建）不会补发 —— 它们是「此刻正在发生」，不是像 `$.ui.status` 那样的状态。

**怎么把它们送到自己的服务端**是插件自己的事：`$.process.spawn` 起一个 WebSocket 客户端、或 `$.http.fetch` 直接发 HTTP（见「外部进程」「发 HTTP 请求」），宿主不提供推送通道，也不替 mod 保存「发到哪」。

### `$`（一期）

| 命名空间     | 方法                                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `$.plugin`   | `name`                                                                                                                                                                                                                                                                                                       |
| `$.ui`       | `resolve(e)`、`open({ id, title })`、`close(id)`、`panes()`、`invalidate("ui.render")`（只通知「我这个 mod 画的东西过期了」，不直接产生树；见「用户交互的结果」）、`status(text)`、`toast(text, timeoutMs?)`（见「状态带、状态行与提示」）、`log(text, { to? })`（在对话流里留一行，见「在对话流里留一行」） |
| `$.state`    | `get`、`set`（会话级状态；`get` 返回副本，`set` 后需自己 `invalidate`）                                                                                                                                                                                                                                      |
| `$.store`    | `get`、`set`、`delete`、`keys`（该插件自己的 JSON KV，跨会话）                                                                                                                                                                                                                                               |
| `$.clock`    | `now()`、`sleep(ms, { signal? })` → Promise（等待，可被取消；见「时钟：等待」）、`after(ms, fn)`、`every(ms, fn)`（后两者返回 `{ cancel() }`，见「定时器」）                                                                                                                                                 |
| `$.process`  | `spawn({ argv, cwd?, env?, input? })` → 异步迭代子进程的输出；`run(argv, { cwd?, env?, stdin?, timeoutMs? })` → 跑完拿 `{ exitCode, stdout, stderr, is…Truncated }`（见「外部进程」）                                                                                                                        |
| `$.fs`       | `read`（可选 `{ as: "bytes" }`）、`write`、`list`、`stat`、`exists`（相对路径按会话工作目录解析，见「读写文件」）                                                                                                                                                                                            |
| `$.http`     | `fetch(url, { method?, headers?, body?, timeoutMs? })`（只允许 `https:` 与本机回环，见「发 HTTP 请求」）                                                                                                                                                                                                     |
| `$.prompt`   | `submit({ text, asUser })`：把一条 prompt 送进当前会话（见「把 prompt 送进对话」）；`fill({ text, mode? })` → `{ isFilled }`：把草稿填进输入框、不发送（见「把草稿填进输入框」）                                                                                                                             |
| `$.session`  | `usage()`：只读的 token 用量快照（见「会话用量」）；`cwd()`：会话**当前**工作目录（与 `$.fs` 相对路径、`$.process` 的缺省 cwd 同一份数据源，会随会话里的 `cd` 变）；`id()`：这条会话的 id；`root()`：会话工作根（不随 `cd` 动）；`model()`：当前生效的模型名（见「会话事实：id、根目录、模型」）             |
| `$.env`      | `get(name)` → `Promise<string \| undefined>`：读一个环境变量，没设置就是 `undefined`（不抛错）；见「环境变量与设置（只读）」                                                                                                                                                                                 |
| `$.settings` | `read()` / `read({ source })` / `read({ key })` / `read({ source, key })` → Promise：`settings.json` 的只读快照，`source` 取 `user` / `project` / `local`，不传就是合并后的当前配置；见「环境变量与设置（只读）」                                                                                            |
| `$.command`  | `register({ name, description, argumentHint?, immediate? })`、`list()`、`run({ command, args? })`（见「注册命令」）                                                                                                                                                                                          |

`$.ui.resolve(e)` 把 `ui.render` 收到的事件换成**这一端可用的元素表**（`{ Box, Text, Button, Input, Select, Svg, Link, Code, Markdown, Progress }`，值与从 `wave-agent-sdk/mods` 导入的同名导出是同一份）。表按 `e.surface` 选：一期只发 `desktop`，别的值、以及不认识的 `e.component`，都直接报错并列出可用名单，不返回半张表。

与 Claude Code 的 `$.ui.resolve(e)` 同一个语义：它同样拿 `ui.render` 的 `e`，按 `e.surface` 选元素表、并要求 `e.component` 是引擎画得出的站点（它的错误文案是 `takes a ui.render argument (e.surface names the surface)`）。区别在覆盖面：CC 的 surface 有 `terminal` / `desktop` / `mobile` / `vscode` 四端，**各端元素表不同** —— `terminal` 有 `Raster` / `Image` 没有 `Svg`，`desktop` 反过来（11 个：多 `Select` / `Svg` / `Progress` / `Client`），`mobile` / `vscode` 有 `Svg` 没有 `Client`；我们只发 `desktop`，表里放已实现的 10 个，与 CC 的桌面端表只差 `Client` —— 给画不出的名字，mod 编出的树只会被 `validateModTree` 拒掉，错误离原因更远。

### 状态带、状态行与提示

面板之外，mod 还能往界面上贴三样**不属于任何 pane** 的东西，落点与形态各不相同：

| 能力                              | 落点                     | 形态                                                                                                        |
| --------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `AbovePrompt` 站点（`ui.render`） | 输入框**上方**的带       | 一棵元素树；一个 mod 一条带，多条按插件加载顺序纵向排列；高度封顶在 11 行正文 + 滚动内衬，超出在带里滚      |
| `$.ui.status(text)`               | 输入框下方**常驻的一行** | 纯文本，每个插件一段 `plugin: text`，后一次调用替换前一次，`null` 清除；右对齐、单行省略、放不下的收成 `+N` |
| `$.ui.toast(text, timeoutMs?)`    | **右下角固定浮层**       | 纯文本，默认停留 4000ms，到点自己消失，也可点 × 提前关；360px 宽，由下往上堆                                |

三样的尺寸口径对齐 Claude Code 桌面端（它的 `above-prompt` 站点 / 状态行 / cds Toast）：带的上限 `calc(11lh + 40px)`（那 40px 是滚动内衬，首末条的描边与焦点环不被容器边缘切掉），滚动条隐掉；状态行是一条水平行、`plugin: text`、单行省略，放不下的收成 `+N`（收起来时才给每段 32ch 的天花板）；提示是固定右下角浮层、360px、正文按 240 字符截断 —— 它不参与输入区布局，因此也不受输入卡宽度约束。带与状态行仍然与输入卡同列同宽（插件端 800 / 桌面 768）。

**提示浮层不是输入区的一部分**：它会盖住输入卡右下角，所以既能点 × 关掉、也在 `toastQueueMax` 条之后丢最旧的一条；`position: fixed` 让 50 条长提示不会把消息区压成 0（历史缺陷：这三样都没有上限时，60 行的带把输入卡顶出视口）。

后两个是**只推不拉**的：不产生树、不进对话上下文、宿主收到就画。`status` 的一行一直挂着，直到插件自己替换或清除；`toast` 会自己消失。两者都按插件署名，用户能看出是谁贴的。

**状态行会重放，`toast` 不会**：`session.start` 里贴的状态比客户端注册会话更早，那条推送按传输层既有语义会被丢掉（v1：未知会话的通知一律丢弃）。所以 surface 挂上来要面板快照时（`getModPanels`）agent 顺带把当前每个插件的状态行补发一次 —— 「启动时贴一行、之后一直挂着」才是这个能力的正常用法。`toast` 是瞬时消息，晚了就不该再弹。

带是第二个渲染站点，走与面板同一条拉取链路：surface 在会话就绪后、以及每次 `stale` 之后，对每个注册了 `ui.render` 的 mod 用 `{ surface: "desktop", component: "AbovePrompt", instance_id: "above-prompt" }` 拉一次树；返回 `undefined` 或空树就不占位置。校验、限额、`revision`、失败时保留上一帧并叠错误摘要，全部与面板一致。

与 Claude Code 的差异：它的带是**一个共享站点**（`instance_id` 固定 `above-prompt`，与 pane 一起列进 `ui.focus` / `ui.scroll` 的站点集合）；我们按插件分成多条带，且一期不给带键盘焦点与滚动 —— 那是面板才有的东西。

### 在对话流里留一行

`$.ui.log(text, { to? })` 把一行用户可见的文字**追加进对话流**，落点是宿主已有的「提示块」（`notice`）：跟报错、钩子状态行同一个位置，挂在最后一条 assistant 消息下面，没有就在最新一条用户消息之下新起一条。

- 与 `status` / `toast` 的区别是**它属于这次对话**：随会话落盘，切会话、重启之后还在；`status` 是常驻的一行（后一次覆盖前一次），`toast` 几秒就没了。要「这件事发生过、以后还能回看」就用 `log`。
- **不进模型上下文**：`notice` 块不进 API 请求（参见消息块可见性矩阵），所以 mod 可以放开写，不会污染提示词、也不会顶掉 token 预算。
- `to` 一期只接受 `"transcript"`（省略时默认它），别的值报错 —— Claude Code 同名方法的 `to` 还认面板/终端那几档，我们只有对话流这一档，给个拼错的值静默当成 transcript 更糟。
- 单条超过上限（见「限额」）截断并加省略号，与 `status` 同一个口径。

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

**注册只给菜单元数据，逻辑在 `command.run` 钩子里**（与 Claude Code 同一个形状）：`register` 没有 handler，用户敲下 `/standup 3` 后引擎派 `command.run`，matcher 写成本条命令（带斜杠，`{ command: "/standup" }`，与 CC 一致；也可以不给 matcher、由钩子自己比 `e.command`，见下），钩子必须返回 `{ text }` —— 这段文字作为**一条用户消息**进会话，模型看到的就是它。

- `args` 是用户敲在命令名后面的原文（`"3"`，没写就是空串）。
- **matcher 是可选的**：`on("command.run", { command: "/standup" }, handler)` 只接这一条，`on("command.run", handler)` 接这个 mod 注册的**所有**命令（社区 mod 就是一条钩子管自己所有命令、在钩子里比 `e.command`）。派发本来就按 mod 分开，没有 matcher 不会把命令串到别的 mod 上；给了 matcher 但没写 `command` 的，这条注册被忽略并记一条 warn。
- **事件里的 `e.command` 不带斜杠**（`"standup"`）—— 与 Claude Code 同一个口径，社区 mod 直接比 `e.command === "guard"`；matcher 里写带不带斜杠都认（两边归一后比较）。
- **钩子没答就不执行**：注册了命令但 `command.run` 没有对应 matcher 的钩子（或钩子返回的不是 `{ text }`），这条命令报错并给一句能照做的提示（缺钩子时照 CC 的文案形状：「registered /name but no command.run hook answered it」）。
- **重名即拒**：与内置命令、用户/项目 `.wave/commands` 下的自定义命令、技能命令、别的插件的命令同名，注册就失败并在插件日志里说明是谁占了。同一个 mod 用同一份 spec 重复注册是幂等的。
- **撞宿主本地命令**在宿主侧丢弃：`/config`、`/clear`、`/model` 这类是各前端自己实现的动作（不在 SDK 的命令表里），SDK 检查不到；所以 `getSlashCommands` 合并时，同名 mod 命令被丢掉并记一条 warn。
- **不能在 `command.run` 钩子里调 `$.prompt.submit`**：钩子正持有用户打出的这一轮，再投一条会等自己（CC 的原文案是「would wait on the turn this hook is holding」）。要在这之后继续，就存到状态里、在 `turn.complete` 里投。
- `$.command.list()` 返回当前可见的命令（`{ name, description, source, plugin? }`，`source` 是 `built-in` / `user` / `skill` / `plugin`），`$.command.run({ command, args })` 以 mod 身份执行一条已注册的命令 —— 与用户敲下它等价（同样走 `command.run` 钩子）；命令不存在时报错并列出最接近的名字。
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
- 等待**不占**「同时活跃的定时器」配额（那是 `after`/`every` 的），但占用一个 hook 的执行时间额度：一个 5 秒的 `sleep` 会把同一次钩子调用吃满，钩子超时的规则照旧（见「限额」）。

### 环境变量与设置（只读）

插件常要把自己的配置放在环境变量或 `settings.json` 里（`$.env.get("MY_PLUGIN_WATCH")`），两个只读入口：

- **`$.env.get(name)`** 返回 `Promise<string | undefined>`：读会话环境变量的值与 `process.env` 合并后的结果（`settings.json` 的 `env` 段优先，与工具、钩子看到的是同一份）。**没设置就给 `undefined`，不抛错** —— Claude Code 同样是这个语义，社区插件的写法就是 `(await $.env.get("X")) || 默认值`。
- **`$.settings.read(...)`** 返回 `Promise<Record<string, unknown>>`（带 `key` 时是该键的值，可能 `undefined`）。四种调用形式：`read()` 拿合并后的当前配置；`read({ source })` 只拿某一层（`user` = `~/.wave/settings.json`、`project` = `<workdir>/.wave/settings.json`、`local` = `<workdir>/.wave/settings.local.json`）；`read({ key })` / `read({ source, key })` 再取一个**顶层键**（不做 `.` 路径展开）。`source` 传别的值当场报错并列出可用值 —— Claude Code 的这份表里还有 `flag` / `policy`（它的命令行 flag 层与托管策略层），我们没有这两层，不假装有。
- **不做掩码**：`$.env.get("WAVE_API_KEY")` 能读到真值、`settings.read()` 里也含 `env` 段。这不是疏忽：同一个插件的 hooks 本来就在宿主进程里跑 shell（`echo $WAVE_API_KEY` 一样读得到），掩码只会让「同一份配置在 hook 里能读、在 mod 里是星号」变成更坏的语义。信任边界在**装插件**那一刻，不在 `$` 的字段上（同「外部进程」的信任说明）。反过来要求插件作者：别把读到的值打进 `$.ui.log`、`$.ui.status` 或 `$.http.fetch`。
- 两者都是**只读**：没有 `$.env.set`（Claude Code 有，改会话环境会牵连正在跑的工具与子进程）、没有写 `settings.json`。

### 会话事实：id、根目录、模型

`$.session` 上除了 `usage()` / `cwd()`，还有三个只读事实，插件拿它们做键、做标题、做上报：

| 方法      | 值                                                                                          |
| --------- | ------------------------------------------------------------------------------------------- |
| `id()`    | 这条会话的 id（`/clear` 与恢复会话后会变，所以**要用时现取**，别在 `session.start` 里存死） |
| `root()`  | 会话工作根：`EnterWorktree` 会让它动，`cd` 不会                                             |
| `model()` | 当前生效的模型名（与 `$.session.usage()` 的 `model` 同一处解析，没配时是空串）              |

三个都返回 `Promise`（Claude Code 的同名方法也是异步的），一次读取不产生副作用。`$.session.usage()` 与 `$.session.cwd()` 是既有的**同步**返回（一期已交付），与 Claude Code 那两处异步不同 —— 差异只影响 `.then()` 这种写法（`await` 两边都能用），不改。

### 外部进程

mod 的沙箱里没有 `child_process`，要跑外部程序只能走 `$.process.spawn`。与 `$.clock` 同一条纪律：进程归宿主所有，会话销毁或插件重载时由宿主统一杀掉；裸 `spawn` 会留下孤儿进程，然后打到已经销毁的会话上。

- `spawn({ argv, cwd?, env?, input? })` 返回一个异步可迭代对象，逐块产出 `{ stream: "stdout" | "stderr", text }`；迭代正常结束时返回 `{ code, signal }`，进程起不来或被宿主拒绝时抛错。形状与 Claude Code 的 `$.process.spawn` 一致（它的生成器同样 yield `text` 块、`return { code, signal }`）。
- `argv` 是**参数数组、不走 shell**；要用 shell 就显式写 `argv: ["bash", "-lc", cmd]`。
- `cwd` 默认会话工作目录；`env` 与宿主环境取并集，显式给的值覆盖。`input` 给出时写进 stdin 然后关闭（一次性输入，不支持长连 stdin）。
- **等 I/O 不计入钩子预算**：`for await` 停在下一块输出上的时间算空闲，5 秒预算在这段时间里暂停，所以「起一个长跑进程、在钩子或元素回调里逐块消费它」是最正常的写法，不会一动就超时；预算只算 mod 自己干活的时间。`run` / `fs` / `http` 的等待同理。与 Claude Code 把 `process.spawn` 的预算标成 `pull`、把 `$.clock.sleep` 之外的时间排除在事件预算外是同一条规则。
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
- **不另设路径白名单**：同一插件的 hooks 本来就在跑 shell，mod 也能 `spawn` 任意命令读同一个文件 —— 加白名单只是让「读」比「读」更难，不提高任何安全性。这与「外部进程」的信任论证是同一条。

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

**信任。** `spawn` 让 mod 能执行任意命令，但它不引入新的信任层级——同一个插件的 hooks 本来就在跑 shell（`services/hook.ts` 的 `executeCommand`）。变的只是 mods 也能做同一件事，而插件安装时用户已经在授予这个权限。

### 把草稿填进输入框

`$.prompt.fill({ text, mode? })` 把文本放进**用户正看着的那个输入框**，当草稿、**不发送**，返回 `{ isFilled }`：

- 与 `submit` 是两件事：`submit` 替用户按下回车（开一轮、进上下文、不可改），`fill` 只是把字打好，什么时候发、发不发都由用户决定。所以 `fill` 不改会话状态、不开轮次、不进上下文。
- `mode` 一期三档，语义与 Claude Code 同名：`replace`（默认，替掉整份草稿）、`append`（接在草稿后面）、`insert`（插在光标处；编辑器没聚焦时按末尾算）。光标落在填入的文本之后，用户可以接着打字。
- **`isFilled: false` 是正常结果，不是错误**：终端 CLI、宿主没接这条通道、审批卡片或问答对话框正占着键、输入框还没挂上，都会返回 `false` 而不是抛错——mod 拿到 `false` 就知道这次没落地，可以自己降级（改成 `$.ui.toast` 或 `$.prompt.submit`）。
- **5 秒没有回执按 `false`**：与 Claude Code 同一时限。晚到的回执不改变已返回的结果，也不会把文本填第二次。
- 文本允许空串（`replace` 空串 = 清空草稿）；`mode` 传了不认识的值当场报错并列出可用值。
- 一期是 Claude Code 的**子集**：不做 `decorations`（给填入的文字涂色）、`cursor`（指定光标落点）、`answers_press`（回指某次按键）。那三样要么依赖 composer 的富文本区间绘制，要么依赖「一次按键」的标识，与「把字打好」不是一件事。

### 会话用量

`$.session.usage()` 返回一份**只读快照**，让 mod 能自己把「这次会话用了多少」画成带、状态行或面板：

| 字段                   | 含义                                                   |
| ---------------------- | ------------------------------------------------------ |
| `context.tokens`       | 上下文占用：最近一次带 usage 的响应报出的总数          |
| `context.window`       | 当前模型的上下文窗口                                   |
| `context.percent`      | 用量环那个百分比（0–100 整数）                         |
| `tokens.prompt`        | 整场会话累计的 prompt token（**含**缓存命中的那部分）  |
| `tokens.completion`    | 累计的 completion token                                |
| `tokens.cacheRead`     | 累计的缓存命中 token                                   |
| `tokens.cacheCreation` | 累计的缓存写入 token                                   |
| `startedAt`            | 这条会话开始的时刻（epoch 毫秒），算「本场跑了多久」用 |
| `rateLimits`           | 额度窗口数组，一期**恒为 `[]`**，见下                  |
| `model`                | 当前模型名，没配时字段缺省                             |

- **`percent` 的分母是自动压缩阈值，不是 `window`**：与输入框旁那个用量环同一条规则（`getAutoCompactThreshold`），环画到 100% 正是压缩要发生的地方；换成 `tokens / window` 会让环永远到不了头，两个数字也会对不上。
- **字段名按我们自己的口径写死**：我们上游的 `prompt_tokens` 已经包含缓存命中，Claude Code 的 `input_tokens` 不包含，两者不能互换，所以这里不叫 `input`/`output`。
- **现取现算、不订阅**：每次调用返回一份新快照，mod 改它伤不到会话；要看它变化就在 `$.clock` 的节拍里或 `ui.render` 时再问一次。也不产生一次渲染请求——mod 拿到数字后自己决定要不要 `invalidate`。要「变化时被叫醒」用下面的 `session.measure`。
- **`rateLimits` 一期恒为 `[]`**（字段留着，形状是 `{ kind, percentUsed, resetsAt? }[]`）：额度与重置时间要先有企业端的额度接口才有数，填假数字比空数组更糟。不给消息列表与 `send`/`append`（那些是「改会话」，与只读快照不是一回事）。

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
    这是**带唯一的重画通道**：surface 平时只在挂载时拉一次带，没有 `invalidate` 就永远停在第一帧（一期只支持 `"ui.render"` 这一个目标，`prompt.section`/`tool.describe` 等站点还没有）。
    回复里带递增的 `revision`，webview 丢弃比当前显示版本更旧的回复。
- 一个 pane 的**第一次** `modPanelRender` 回复到达时，桌面端会展开右侧面板槽并激活该 tab（与用户从「＋」菜单打开同一个效果）—— mod 申请的面板不该还要用户自己去点开。后续回复只更新内容，不抢当前焦点。
- 回包带 `error` 时，面板顶部叠一条错误摘要，**同一回复里给的是上一帧成功的树**（仍可操作）；下一次请求成功后摘要自动消失。把整棵树换成一行错误文字会让面板一次性报废（用户连别的按钮都点不到），不做。

## 兼容社区 mod（布局、注册签名与裸名 import）

社区里现有的 mod 不是按这份规格写的。为了让**已有的 mod 不改一行就能跑**，加载层认两种形状，语义仍是上面那一套。

**布局**：除 `.wave-plugin/plugin.json` + `mods/*.tsx` 之外，也认 `hooks/hooks.json` 里的模块声明 `{ "modules": ["./register.tsx"] }`（社区插件的写法，一个插件可有多个模块，等价于我们的「一个插件多个 mod」）。**`modules` 里的路径相对 `hooks/` 目录**，不是相对插件根 —— `./register.tsx` 就摆在 `hooks.json` 旁边。同一个 `hooks.json` 里的 `hooks` 段（settings hook 事件）与 `modules` 段互不相干，可以共存；两处指向同一个文件时按 realpath 只收一次，stem 撞名时先到先得并记一条 warn。manifest 目录名两种都认（`.claude-plugin/` 已有回退）。`plugin.json` 里的 `userConfig` 是配置 schema（`type` / `title` / `description` / `default`）：`register` 收到的 `options` 一期**只是 schema 里的 `default`**（没有「用户改值」的存储，界面上也还没有这一栏），schema 里没写 `default` 的键不出现。

**注册签名**（两种都认，按实参形状区分）：

| 形状                    | 谁的   | `$` 从哪来                   |
| ----------------------- | ------ | ---------------------------- |
| `register($, on)`       | 我们的 | 第一个参数                   |
| `register(on, options)` | 社区的 | handler 的第一个参数（见下） |

**handler 签名**（按**哪个实参被当成登记函数**区分，不看形参个数 —— 两种形状互斥：我们的用第二个实参当 `on`，社区的把第一个实参当 `on`，因此同一个 `on` 登记出来的 handler 形状是确定的）：

- `(e)` —— 我们的形状（`register($, on)` 登记），返回值语义仍按「事件」那张表；
- `($, e, next)` —— 社区的（`register(on, options)` / `Register = on =>` 登记）。**社区 handler 可以只写一个形参**（`on("command.run", matcher, async $ => …)`，社区真 mod 就这么写），那一个形参就是 `$`：按形参个数判形状会把它当成我们的 `(e)`，`$` 会变成事件对象。`next(e)` 把这次事件交给链上的下一个 mod / 引擎：`ui.render` 下它返回**引擎自己那一帧**（只有宿主本来就会画的站点才有；`Pane` / `AbovePrompt` 是留给 mod 的空间，`next(e)` 返回 `undefined`），mod 可以返回自己的树去替换它，也可以把 `next(e)` 的结果包一层再返回；观察型事件（`tool.call` / `turn.*` / `session.*`）下它返回**空对象**而不是 `undefined` —— 社区 mod 会 `await next(e)` 之后读 `ran.deny` / `ran.isError`，给 `undefined` 会当场抛属性错误，空对象正好表达「引擎没有意见（也就没有拒绝、没有报错）」。一次 handler 最多调一次 `next(e)` —— 再调当场报错（否则链会跑两遍）。
- **`next(e)` 收下改过的事件**：社区最常见的写法是 `return next({ ...e, context: [...] })`（burn-rate 的限额提醒就是这样注入上下文的）。链尾的引擎帧按**走到那里的那份事件**算 —— `prompt.submit` 取 `e.context` 还成 `{ context }`，`command.run` 取 `e.text` 还成 `{ text }`，所以 mod 把改动交给 `next`、自己不拼返回值也能生效。丢掉这份改动会让注入静默失效。

**同一条事件可以挂多个 handler**（不分社区还我们，按注册顺序串成一条链；第一个匹配上的 handler 的返回值就是结果）。`on(name, handler)` 返回一个可以 `.catch(handler)` 的注册凭据：handler 抛错（含 5 秒预算超时）时用它兜底，兜底自己也抛才算这条钩子失败。社区的写法是 `.catch(function ($, e) { … })`，兜底与它所在的那条钩子同形状（同一个 `on` 登记出来的）。

**matcher**（第三个实参，社区写法 `on(name, matcher, handler)`）：只对三个事件有意义 —— `ui.render`（`{ component, requestId }`）、`tool.call`（`{ tool }`）、`command.run`（`{ command }`）。语义是**事件字段的子集匹配**，值可以是一个候选值数组（命中任一即匹配）；`requestId` 是 `instance_id` 的别名。没匹配上的钩子**不参与**这次事件（不是「参与但拿不到值」）。`command.run` 的 matcher **可省**：省了就是「这个 mod 注册的每条命令都问它」，钩子自己比 `e.command`（社区真 mod 就这么写）；写了就带不带斜杠都认、内部归一。给别的配对不上 matcher 的钩子传 matcher 会记一条 warn 并忽略这条注册。

**裸名 import**：`wave-agent-sdk/mods` 是我们对外推荐的名字；社区的 `'claude-code'` 作为**别名**解析到同一个模块 —— 不引入那个 npm 包，也不解析 `node_modules`。除元素构造器，该模块还导出三个助手：

- `atom({ plugin, key }, initial)`：声明一个存在 `$.store` 里的值（键是 `<plugin>/<key>`）；
- `read($, atom)`：读出来；键不存在或 JSON 解析失败都返回 `initial`；
- `update($, atom, value | (prev) => next)`：写回去。

`atom` 的值走 JSON 序列化，因此受 `$.store` 的体积约束（见「限额」）。

## 限额

宿主侧强制，超限**不画**并给出可见错误（面板错误态 + `wave` 日志里的原因），不静默丢弃。

| 限额                             | 值                                                                |
| -------------------------------- | ----------------------------------------------------------------- |
| 单个 mod 文件                    | 1 MiB                                                             |
| 一个插件所有 mod 文件总量        | 4 MiB                                                             |
| 文件数                           | 64                                                                |
| 元素树节点数                     | 2000                                                              |
| 元素树深度                       | 24                                                                |
| 树内文本总量                     | 100,000 字符                                                      |
| `Link.href`                      | 2048 字符                                                         |
| `Svg.source`                     | 131,072 字符（与 Claude Code 同一个数）                           |
| `Svg` 的 `width` / `height`      | 各 4096px（同上）                                                 |
| `Select.options`                 | 1–64 项，`value` 必须唯一                                         |
| 单个 hook 执行时间               | 5 秒（等外部进程输出的空闲不计；超时视为失败，事件按无 mod 处理） |
| 面板每次 `invalidate` 的最小间隔 | 100ms（更快的调用合并）                                           |
| 定时器最小间隔                   | 200ms（更小的值夹到 200ms）                                       |
| 一个 mod 同时活跃的定时器        | 16（超出时新建定时器报错）                                        |
| `$.clock.sleep` 单次等待         | 10 分钟（更长的夹到 10 分钟）                                     |
| 一个 mod 同时未完成的 `sleep`    | 16（与定时器分开计；超出时 `sleep` 报错）                         |
| `$.env.get` 的变量名             | 256 字符（更长的按没设置处理，返回 `undefined`）                  |
| `$.settings.read` 的返回值       | 4 MiB（超出报错，不截断 —— 截断的配置是错的配置）                 |
| `prompt.submit` 返回的 `context` | 32 条、合计 100,000 字符（超出丢弃多余的并记一条 warn）           |
| 一个 mod 同时活跃的外部进程      | 4（`run` 跑完前也占一个；超出时 `spawn` / `run` 报错）            |
| 外部进程单块输出                 | 64 KiB（更长的块切开）                                            |
| 一个外部进程累计输出             | 4 MiB（超出后停止读取并杀掉该进程）                               |
| `$.process.run` 超时             | 默认 30 秒，最多 10 分钟                                          |
| `$.process.run` 的 stdout/stderr | 各 4 MiB（超出置对应的 `is…Truncated`）                           |
| `$.fs.read` / `$.fs.write`       | 单个文件 4 MiB                                                    |
| `$.http.fetch` 请求体 / 响应体   | 各 4 MiB（响应体超 `Content-Length` 声明即报错）                  |
| 一次 `$.http.fetch`              | 30 秒（含重定向与读完 body），最多 5 次重定向                     |
| `$.ui.status` 的一行             | 10,000 字符（超出截断并加省略号）                                 |
| `$.ui.toast` 停留时间            | 默认 4000ms，`timeoutMs` 最多 10 秒（我们的限额）                 |
| 同时排队的 toast                 | 50 条（溢出丢弃未展示的旧条；同屏显示 1 条）                      |
| 输入框上方的带                   | 一个 mod 一条，树与节点限额同面板                                 |
| `$.ui.log` 的一行                | 10,000 字符（超出截断并加省略号）                                 |
| 一个 mod 注册的命令              | 32 个（超出报错）                                                 |

## 加载纪律

- mod 的 import 只允许**相对路径**与 `wave-agent-sdk/mods`（元素构造器表 + `atom`/`read`/`update`）；社区的 `'claude-code'` 是它的别名，其他裸包名直接报错。
- 动态 `import()` 在 CJS 产物里同样变成 `require`，因此受同一条白名单约束。
- 相对 import 只在**该插件本次参与编译的文件集合**里解析（不读 `node_modules`）；出现环形 import 直接报错。
- 文件解析走 `realpath`，解析结果必须落在插件目录内，越界即拒绝。
- 编译或加载失败：该 mod 不生效，其余 mod 与插件其他能力不受影响；失败原文进 `wave` 日志，并**占一个错误面板**（`paneId` 为 `error`，标题是文件名，内容是一行摘要）—— 否则用户只会看到「面板没出现」。
- 只注册 `ui.render` 而从不 `$.ui.open` 的 mod 不产生面板，日志记一条 debug。

## 生命周期

- `session.start` 在会话初始化完成、第一个 prompt 之前跑一次；面板在这一刻登记。
- **每挂载一次就跑一次**：新建会话、切回旧会话、webview 重建、`/reload-plugins` 都会重新走一遍。所以 `session.start` 里要幂等 —— 恢复状态读 `$.store` 就好，别每次追加一条 `$.ui.log`（对话流里会看到重复的行）。
- `/reload-plugins` 会**重建**所有 mod：旧面板逐个发 `ui.close`（见「事件」）后由宿主内部关掉（webview 上的 tab 随 `closed: true` 消失、旧实例的定时器与回调表一并丢弃），再按新插件列表重新加载与 `session.start`。
- 会话结束 / agent 销毁：宿主内部关掉所有面板并丢弃该会话的 mod 实例，此后发来的一切交互静默丢弃。
- 会话结束与 `/reload-plugins` 同时撤销该 mod 的所有 `$.clock` 定时器（见「定时器」），销毁后不再有回调。
- 同一时刻也杀掉该 mod 的所有外部进程（连同其子进程树），与定时器同一条纪律：进程不能活过开它的会话。
- webview 重建（窗口重载、panes 换绑）后 surface 自己对每个 pane 重新请求一次，用户不需要等 mod 下一次 invalidate 才能看到面板；宿主不主动推树。

## 交付分层（一期不做的事）

不做，且**接口不预留**（避免半成品）：VS Code / JetBrains / 终端渲染、`Client`（要在 webview 里执行 mod 附带的第二份模块，连带 `ui.message` / `ui.fault` 两个事件）、终端专有的 `Raster`/`Image`、`$.model`/`$.agent`/`$.mcp`、事件拦截与改写（`prompt.*` 那族改写钩子、CC 那种能改写放行决定的 `tool.check`、`tool.call` 的 `{ deny }` 决议、`prompt.submit` 的改写 `text` 与 `drop` —— 我们只发只读事件与一次上下文注入，见「轮次内外的事件」）、mod 分层与加载期审查。

Claude Code 的 `$` 有 23 个命名空间，我们一期覆盖 12 个（`ui` / `session` / `prompt` / `clock` / `process` / `fs` / `http` / `store` / `state` / `command` / `env` / `settings`）。差的是三组，各自的理由：

- **改会话**：`$.session.send` / `append` / `compact`、`$.turn.abort`、`$.prompt.edit` / `paint` / `compose`、`$.env.set`、`$.config.set`。这些不是「多一个方法」，而是「mod 能替用户改东西」，每一条都要单独想清楚可见性（改了什么用户看不看得见）与冲突（用户正在打字时 mod 改输入框）。
- **读更多会话内部**：`$.session.messages` / `turns` / `repo` / `surface` / `surfaces` / `authorize` / `identity` / `version`。`messages` 与 `turns` 把整份对话（含工具输出）交出去，与 `$.session.usage()` 那种「一个数字」不是一个量级。
- **我们没有的底座**：`$.model`（调模型）、`$.agent`（派子代理）、`$.mcp`（调 MCP）、`$.telemetry`、`$.theme`、`$.audio`、`$.flag`、`$.decision`、`$.config`。前三个要独立的额度、权限与生命周期模型，后几个依赖我们还没有的对应子系统。

**Web 远控页也不显示这三样**：手机上既没有状态带、没有状态行，也没有提示浮层。这是「一期只做桌面端」的下游结果，所以远控页不会因为它们弹「这个操作在 Web 端还没有接通」这类提示 —— 带是页面自己在打开会话、切换会话时取一次的，不是用户点出来的请求，不该在用户眼前报错。

`$.host`（让 mod 请求宿主做界面动作）整条不做也不预留。一期只有一个候选动作「新建会话」，它本身就超出 Claude Code 的 mods API（`$.session` 只能读会话、在会话内动作，CC 桌面端的新会话走客户端自己的接口），而它的副作用会打断用户眼前的会话（新建会把当前 pane 换到新会话）。产品决定降级：外部事件到达时由用户自己先新建一条会话，面板在新会话里自动出现（见「面板的归属」）。

## 用户场景与测试

### 用户故事：插件作者用 TSX 画出自己的面板（优先级：P0）

作为插件作者，我希望在插件里写一个 TSX 文件，让桌面端右侧面板出现我设计的界面，以便把插件的能力（待办、检查结果、看板）直接呈现给用户。

**验收场景**：

1. **假设**一个插件在 `mods/panel.tsx` 导出 `register($, on)`，其中注册了 `ui.render` 并在 `session.start` 里 `$.ui.open({ id: "p1", title: "待办" })`，**当**用户打开一个加载了该插件的会话，**则**右侧面板出现一个「待办」tab 并显示 `Hello`，且同目录下的其他插件能力（命令/技能）不受影响。
2. **假设**该 mod 的 `ui.render` 返回 `<Box flexDirection="row" gap={2}><Text>A</Text><Button label="B" /></Box>`，**当**面板渲染，**则** `A` 与按钮 `B` 横向排列、间距为 2 个间距单位，按钮可点击。
3. **假设** mod 只注册 `ui.render` 而从不调用 `$.ui.open`，**当**会话启动，**则**面板不出现，日志中记一条「mod 未申请面板」。
4. **假设** `ui.render` 里用 `$.ui.resolve(e)` 取元素表（TSX 里 `const { Box, Text } = $.ui.resolve(e); return <Box><Text>hi</Text></Box>`），**当**面板渲染，**则**拿到的表里每个元素名都是可用构造器、渲染结果与 `import { Box, Text } from "wave-agent-sdk/mods"` 一致；把 `$.ui.resolve({})` 或 `e.surface` 不是 `desktop` 的事件传进去，**则**钩子返回错误摘要、面板顶部显示「需要一个 ui.render 的事件」并列出可用的端，不渲染半张表。

5. **假设** mod 在 `Button` 上多写了一个 prop（拼错的 `label2`，或照别的框架习惯写 `className`），**当**这一帧树被校验，**则** `validateModTree` 拒绝整棵树并点名那个 prop（面板顶部一条错误摘要），而不是静默忽略 —— 写错 prop 必须当场看见。
6. **假设**带里一行放了三个 `Button`（那一行的 `Box` 写了 `flexWrap="wrap"`），**当**这一行渲染，**则**每个按钮保持单行宽度、放不下的折到下一行；画在带里的按钮与画在面板里的是同一套观感（`variant="primary"` 用主题主操作色），不是浏览器默认的灰方块。

### 用户故事：面板交互回到 mod（优先级：P0）

作为用户，我希望点击面板里的按钮、在面板里输入文字后界面能立刻变化，以便这个面板真的能用。

**验收场景**：

1. **假设**面板里有一个 `Button`，它的 `onPress` 里把 `$.state` 的计数加一并 `$.ui.invalidate("ui.render")`，**当**用户点击该按钮，**则**面板数字从 `n` 变为 `n+1`，且整个过程不产生新的对话轮次。
2. **假设**面板里有一个 `Input`，它的 `onSubmit` 把提交值追加进 `$.state` 并 invalidate，**当**用户输入 `hello` 并提交，**则**面板列表新增一行 `hello`，输入框清空。
3. **假设**同一个按钮被连点三次而 mod 每次只做一次 invalidate，**当**三次点击都到达，**则** mod 的回调被执行三次，宿主把 100ms 内的多次 invalidate 合并成一条 `stale` 通知，面板最终只请求并渲染一次。
4. **假设**面板里一个按钮的 `onPress` 直接抛错，**当**用户点击它，**则**面板顶部出现一条错误摘要、上一次渲染的按钮与列表仍能继续点，且下一次 `invalidate` 成功后摘要消失。

### 用户故事：画一张图、一个下拉和一个进度条（优先级：P0）

作为插件作者，我希望在面板和带里画一张自己拼出来的 SVG 图、让用户从一组选项里挑一个、并且把「做到哪一步了」画成进度条，以便「用量趋势」「当前口径」「跑到 7/12 了」这类信息不必退化成一行文字。

**为什么是这个优先级**：社区里真正画图的那批 mod 全靠 `Svg`（我们用 33 个热门 mod 仓的源码数过：`<Svg` 6 仓，`<Select` 与 `<Progress` 几乎没有）；没有它，一整类「把数据画出来」的插件移植过来只能降级成文字表。

**验收场景**：

1. **假设**某 mod 的 `ui.render` 返回 `<Svg source={...} alt="近 5 分钟 CPU" width={340} height={96} />`，**当**面板渲染，**则**那段 SVG 内联画在面板里、尺寸就是给的 `width`/`height`；把 `alt` 去掉或写成 `source: ""`，**则**这次渲染失败并在面板顶部说明缺的是哪个 prop。
2. **假设** `Svg.source` 里带 `<script>` 或 `onload=` 这类可执行内容，**当**面板渲染，**则**画出来的 SVG 被净化过（脚本与外链引用都不生效），宿主进程不受影响；`source` 超过 131072 字符或 `width`/`height` 超过 4096，**则**整棵树被校验拒绝并给出是哪一条超限。
3. **假设**面板里有 `<Select key="range" value={picked} options={[{value:"1m",label:"1 分钟"},{value:"5m",label:"5 分钟"}]} onSelect={v => { picked = v; $.ui.invalidate("ui.render") }} />`，**当**用户选了「5 分钟」，**则** mod 的 `onSelect` 收到 `"5m"`、下一次渲染的选中项跟着变；`options` 为空、超过 64 项、或有重复 `value`，**则**这次渲染失败并点名是哪一条。
4. **假设**元素是 `Progress`：`<Progress label="构建" value={7} max={12} />`，**当**面板渲染，**则**画出一条夹在 0–1 的进度（这里约 58%）与标签「构建」；`value` 缺省时只画标签，`valueText` 给出时用它替代默认百分比，`value` 为负数或大于 `max` 时夹到两端而不是画到外面。
5. **假设**同一棵树里 `Svg` / `Select` / `Progress` 被写成带 children（`<Svg source={…}>x</Svg>`），**当**面板渲染，**则**校验以「Svg 是叶子、不带 children」拒绝，而不是悄悄把 children 丢掉。
6. **假设**这些元素被用在输入框上方的带里（`e.component === "AbovePrompt"`），**当**带渲染，**则**它们与面板里画出来的一致（同一个渲染器）；`Select` 在带里选中后同样回到 mod。

### 用户故事：不开面板也能把信息放在用户眼前（优先级：P0）

作为插件作者，我希望在输入框上方画一条状态带、在输入框下方贴一行常驻状态、必要时弹一条提示，以便「额度快用完了」「正在看哪个分支」「刚保存了什么」这类信息不必为它开一块面板。

**验收场景**：

1. **假设** mod 注册了 `ui.render` 并在 `e.component === "AbovePrompt"` 时返回 `<Box><Text>ctx 62%</Text></Box>`，**当**会话就绪，**则**输入框上方出现这条带，且它的文本随下一次 `invalidate` 更新；同一 mod 返回 `undefined` 时带不占位置、不留空行。
2. **假设** mod 在 `session.start` 里调 `$.ui.status("sonnet · 62% context")`，**当**界面渲染出来，**则**输入框下方常驻一行、贴着输入卡右缘的「插件名: sonnet · 62% context」；再调一次换成新文本，调 `$.ui.status(null)` 后这行消失，全程不进对话上下文、不产生新消息。
3. **假设**同一个会话里有八个插件各自设了 status，**当**这一行渲染出来，**则**它仍是**单行**、放不下的那些收成末尾的 `+N`（数字即被收起条数，悬停可看它们），整行不换行、不把输入区顶高。
4. **假设** mod 调 `$.ui.toast("已保存", 2000)`，**当**调用到达，**则**屏幕**右下角**浮出一条提示、约 2 秒后自己消失，mod 不需要再调一次来清；再来两条时按时间由下往上叠，最新的那条贴着右下角；正文超过 240 字符时截断加省略号；用户点 × 可提前关掉（连同它的计时器）。
5. **假设**带的内容远高于输入卡（60 行）而某条 toast 正文长达一万字符，**当**界面渲染出来，**则**带的高度封顶、超出部分在带内滚动，输入卡仍在视口内；toast 作为固定浮层不参与输入区高度，五条也不会把消息区压成 0。
6. **假设**同一会话里两个插件都画带、也都设了 status，**当**两者都到位，**则**两条带按插件加载顺序上下排列、两行 status 互不覆盖，关掉其中一个插件的面板不影响另一个的带与 status。
7. **假设**一个只画带、从不开面板的 mod 用 `$.clock.every(2000, …)` 每两秒调一次 `$.ui.invalidate("ui.render")`，**当**第二拍到达，**则**这条带重画成新内容 —— 不需要任何面板存在（surface 平时只在挂载时拉一次带，`invalidate` 是它唯一的重画通道）。
8. **假设**某 mod 的带钩子抛错，**当** surface 重画，**则**只有那条带显示错误摘要，其余带与所有 status 行照常显示，会话不中断。
9. **假设** mod 只在 `session.start` 里贴了一次 status、之后再也不写，**当**桌面端挂上这条会话（新建、切回来、webview 重建），**则**那一行照样出现 —— surface 要面板快照时 agent 会把它重放一次；`toast` 不重放，那时的提示早已过期。

### 用户故事：面板能跟着指针和主题变色（优先级：P1）

作为插件作者，我希望用社区同一套 prop 名写出「悬停才亮的删除键」「大号小标题」「整行变色的卡片」，以便把我为 Claude Code 写好的界面原样搬过来。

**为什么是这个优先级**：社区里 6103 个带 TSX 的 mod 中，`Box.paddingX` 出现在 1645 个、`Box.borderColor` 996 个、`Text.backgroundColor` 729 个、`Box.minWidth` 334 个 —— 白名单不认它们时**整棵树被拒**，面板一片空白（真机上 `ideas-shelf` 就是这样：只因为一个 `paddingX`）。它们全是纯绘制，不引入新事件。

**验收场景**：

1. **假设**某个 `Box` 写 `padding={2} paddingX={1}`，**当**面板渲染，**则**它上下各 2、左右各 1（轴写法在四边简写之后生效）；再补 `paddingLeft={3}` **则**左边变 3、其余边不变。
2. **假设** `<Text color="suggestion">` 与 `<Text color="#f60">` 各一段，**当**面板渲染，**则**前者画成主题的链接色（toggle 明暗主题时跟着变）、后者原样是 `#f60`；写一个表里没有的 token（`color="chartreuse"`）**则**按裸色画，不拒整棵树。
3. **假设** `<Text weight="bold" size="title" strikethrough>已完成</Text>`，**当**面板渲染，**则**这段字是粗体、标题档字号、带删除线；把 `weight` 写成 `600`（数字）**则**整棵树被拒并点名 `weight`（它只收那四个枚举）。
4. **假设** `<Box key="row" hover={{ backgroundColor: "error" }}><Button label="✕" plain dimColor hover={{ color: "error" }} /></Box>`，**当**指针移进这一行，**则**整行换底色、按钮的 `✕` 由暗变亮并转成错误色；指针移出**则**恢复静止样子，**且这个过程不产生 `ui.render` 重画、不跑任何 mod 钩子**。
5. **假设** `<Box key="k"><Text>glyph</Text><Box position="absolute" top={-2} left={2} display="none" hover={{ display: "flex" }}>卡片</Box></Box>`，**当**指针落在 `glyph` 上，**则**卡片出现并画在行外上方，指针移出**则**收回 —— 行内其它元素位置不动（`hover` 里没有会让兄弟移位的 key）。
6. **假设**按钮写 `plain`（`<Button label="✕" plain onPress={…} />`），**当**面板渲染，**则**它是一个无边框、无底色的字形键，一排三个能挤在行尾；同时写 `plain` 与 `variant="primary"` **则**按 `plain` 画。
7. **假设** `hover` 里写错一个 key（`hover={{ colour: "red" }}`），**当**这一帧被校验，**则**整棵树被拒并在面板顶部点名那个 key 与可用名单，不静默忽略。
8. **假设** `<Input key="note" rows={3} onSubmit={…} />`，**当**面板渲染，**则**输入框高 3 行、Enter 仍提交；同一站点里两个元素都写 `autoFocus` **则**只有第一个拿到焦点。

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

### 用户故事：用 token 用量驱动自己的提示（优先级：P1）

作为插件作者，我希望 mod 能读到本会话的 token 用量，以便「上下文快满了」「这一场花了多少」这类提醒由我自己画在带或状态行上，而不必等用户去敲斜杠命令。

**为什么是这个优先级**：`context.percent` 与用量环共用一个算法，读错了就会给出与界面矛盾的提醒，所以先期只给最小、口径写死的字段。

**验收场景**：

1. **假设** mod 在 `ui.render` 里把 `$.session.usage().context.percent` 画成一条带，**当**会话跑完一轮，**则**下一次 `invalidate` 后带上的数字与输入框旁那个环一致；没跑过任何轮次时是 `0`。
2. **假设** mod 调 `$.session.usage()` 后改动返回对象的字段再调一次，**当**第二次调用到达，**则**拿到的仍是会话的真实值（快照是副本，改它不影响会话）。
3. **假设** mod 在 `$.clock.every(60_000, …)` 里读用量，**当**一分钟的拍子到达，**则**拿到的是那一刻的数字，mod 不需要订阅、也没有收到过任何用量推送。
4. **假设**会话还没接上用量来源（`Agent` 之前的状态），**当** mod 调 `$.session.usage()`，**则**拿到全 0 的快照（`window` 也是 `0`）而不是抛错，mod 的其余逻辑照常跑。

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
9. **假设** mod 注册了 `classic.Stop` 这类我们没有的 `classic.*` 名字，**当**插件加载，**则**它被当作不存在的钩子拒收并记一条 warn（一期只做 `classic.PermissionRequest` 这一个镜像），而不是静默登记一个永远不触发的钩子。

### 用户故事：工具一跑完就跟着刷新（优先级：P1）

作为插件作者，我希望 mod 在每次工具调用结束时收到一个只读通知，以便「分支/未提交文件数」这类带不必靠轮询，用户 `git commit` 完那一瞬间就更新。

**为什么是这个优先级**：轮询（`$.clock.every`）在长时间空闲时会白跑、在关键时刻又会慢半拍；但让 mod 拦下调用的 `{ deny }` 那一档要动权限仲裁，先只给观察面。

**验收场景**：

1. **假设** mod 注册了 `tool.call` 并在里面重新读一次 `git status`、写进 `$.state` 后 `invalidate`，**当**模型执行完一个 Bash 调用，**则**带上的未提交文件数在下一次渲染里就是新值，不需要等任何定时器。
2. **假设**这次工具调用的审批被用户拒掉，**当**这一下结束，**则** `tool.call` 照常触发（载荷里同样是工具名与参数），mod 不会卡在「上一次状态」里。
3. **假设** mod 在 `tool.call` 里 `return { deny: true }`（照 Claude Code 的写法），**当**工具执行，**则**这次调用照常执行、返回值被忽略 —— 只读事件拦不下工具。

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
3. **假设** mod 传了 `{ to: "pane" }` 这类我们没有的目标，**当**调用发生，**则**抛错并列出唯一可用的 `"transcript"`，而不是静默写进对话流。

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

1. **假设** mod 在 `turn.start` 与 `turn.step` 里累计步数，**当**用户问一个要连调三次工具的问题，**则** `turn.start` 一次、`turn.step` 四次（首答一次 + 每次工具结果后各一次请求），`e.step` 依次 1–4，`turn.complete` 一次。
2. **假设**用户在第二轮中途按 Esc，**当**这一轮结束，**则**不再有 `turn.step`，`turn.complete` 收到 `isAborted: true`。
3. **假设** `$.clock.sleep(30000)` 正在等，**当**用户关掉这条会话，**则**这次等待立刻 reject（`name === "AbortError"`），mod 的 catch 能跑收尾；传了 `{ signal }` 时 abort 行为相同。
4. **假设**上下文逼近窗口（历史远大于摘要），**当**自动压缩完成，**则** `session.compact` 收到 `{ trigger: "auto", tokensBefore, tokensAfter }` 且 `tokensBefore > tokensAfter`；手动 `/compact` 时 `trigger` 是 `"manual"`。两者不是同一把尺子（见「轮次内外的事件」），历史本来就很短时 `tokensAfter` 可能更大。
5. **假设** mod 打开了两个面板，**当**用户点掉其中一个的 ×，**则** `ui.close` 收到 `{ id }`；**当**整条会话被关掉，**则**只收到一次 `session.end`、不再收到两条 `ui.close`。
6. **假设** `session.end` 的钩子卡住，**当** 5 秒过去，**则**会话照常销毁（超时只记一条 warn，不阻止销毁）。

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
6. **假设**一个 mod 用 `on("tool.call", { tool: ["Bash", "Edit"] }, handler)` 注册、另一个用 `on("ui.render", { component: "AbovePrompt", requestId: "above-prompt" }, handler)`，**当**一次 Bash 调用结束、带站点第三次重画，**则**两条钩子各自只在自己匹配的事件上被调用；**当**换成 `Read` 调用，**则**第一条不被调用（matcher 没命中 = 这次事件与它无关）。
7. **假设** mod 写 `on("session.measure", handler).catch((e) => …)`，**当**一次带 usage 的响应回来，**则** handler 收到的 `e` 里既有 `changed`、也有与 `$.session.usage()` 相同的 `context` / `tokens` / `startedAt` / `rateLimits`；**当** handler 抛错，**则** `.catch` 里那个被调用，会话照常继续。
8. **假设**一个社区 mod 在 `turn.complete` 里读 `e.usage.input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `usage.model`，并按 `e.command === "guard"` 认自己的命令，**当**一轮答完、用户敲 `/guard off`，**则**五个字段都有数字（`input_tokens` = 本轮 `prompt` 减去两份缓存）、`e.command` 是不带斜杠的 `"guard"`、`e.args` 是 `"off"`。
