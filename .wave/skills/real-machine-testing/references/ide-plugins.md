# IDE 插件：VS Code 与 JetBrains 真编辑器套件

两套都是真编辑器 + 真插件 + 真 CLI 会话 + 真模型，都要网络与可用的登录态，都会烧掉真实模型调用，都不在 PR 门禁里。隔离与日志见 `environment.md`；**要避免烧生产额度就把这些调用打到测试环境或本地开发服务**——换 `WAVE_SERVER_URL` 并换成那个环境签发的 `auth.json`（`server-and-auth.md`，token 与环境绑定，不能沿用生产的）。

## VS Code

```sh
pnpm -F wave-vscode run test:e2e:completion             # 用已构建的 dist/
pnpm -F wave-vscode run test:e2e:completion -- --build  # 先重编扩展（含 bundleCli）
```

- 编辑器可执行文件用 `WAVE_E2E_VSCODE` 指定；不设时脚本按候选路径找（macOS 的 app 路径、`/usr/share/code/code`、`/usr/local/bin/code`），一个都没有就退出——Linux 上通常要自己下 tarball 再指过去。
- 脚本自己开临时 `--user-data-dir` + 临时工作区，并带 `--disable-extensions`：已装扩展（尤其 `GitHub.copilot-chat`，它也注册 inline provider）不会干扰断言；内置 TypeScript 语言服务仍在，跨文件用例靠它解析 import。
- 断言口径：VS Code 没有读取 inline suggestion 的扩展 API，`editor.action.inlineSuggest.commit` 是唯一可观测钩子 ⇒ 只断言「接受后文档变了」，ghost text 渲染本身验不到。
- 排查：`runTests` 的 stdout 里有扩展日志（含 `[completion-e2e] editor focus state:` 一行，能看出焦点在不在编辑器）；跨文件用例故意重试 3 次（模型有随机性），失败先看它第一步的 `executeDefinitionProvider` 过没过——那步红说明宿主根本采不到片段，跟模型无关。

**不烧模型的第二条真机套件（IDE 上下文 `@terminal` / `@problems`）**：

```sh
pnpm -F wave-vscode run test:e2e:ide-context   # 真终端 + 真诊断，不调模型、不需要登录
```

- 做法：runner 用 esbuild 把 `src/services/ideContextService.ts` 单独打成 cjs（`external: ["vscode"]`），把路径通过 `extensionTestsEnv` 传给 spec ⇒ 断言跑在扩展宿主里，用的就是产品代码本身。
- 已验证的真机事实（2026-10-22，Linux + Xvfb）：终端剪贴板中转（`selectToPreviousCommand` → `copySelection`）**在真实 VS Code 里能读到输出**，剪贴板随后被还原；`languages.getDiagnostics` 从内置 TS 服务拿到 1-based 行号列号与 `source: "ts"`；工作区相对路径取到 `src/broken.ts`。
- 临时工作区由一个语法错误文件（`src/broken.ts` = `export const broken: = 1;`）驱动诊断：不用 tsconfig，内置 TS 扩展照样立刻报 `Type expected.`。
- 想测「没有活动终端」分支时注意：真机上随时可能有别的终端是 active，断言要写成「成功则文本非空 / 失败则带原因」，不要写死 ok=false。

## JetBrains

```sh
pnpm jb:test:ui                            # 全部 integrationTest
pnpm jb:test:ui -- --tests "*completion*"  # 只跑补全
```

- Starter + Driver（`intellijPlatformTesting.testIdeUi`）拉起真 IDE、装 `build/distributions` 里的插件、用平台 action 驱动（`EditorTextEnd` / `CallInlineCompletionAction` / `InsertInlineCompletionAction`），**不用 `java.awt.Robot`** ⇒ 不依赖 macOS 辅助功能权限。
- 前置：可用模型配置 + 图形会话；首次要下 IDE（之后热态约 1 分钟）。
- 补全没有自己的会话，模型配置取自侧栏会话 ⇒ 侧栏 webview 起不来时 provider 会一直返回空建议（表现：等不到 ghost text，而「加载插件」那条仍然通过）。
- `completion sees a definition imported from another file` 是**模型随机性**用例：它会重试 3 次要求模型用上跨文件符号，2026-10-22 在同一棵树上「有改动 / 基线（`git stash`）各跑一次」都红，接受文本里模型改用同文件里的另一个方法 ⇒ 判红前先在基线上跑一遍同一用例，别先怀疑自己的改动。
- 环境性失败取证：Starter 侧日志为空、`cli.log` 没有新会话时，真因只在 IDE 子进程的 stderr 里，加 `-i` 重跑才打得出——
  `node packages/jetbrains/scripts/gradle.mjs integrationTest --no-daemon -i --tests "com.wave.jetbrains.completion.InlineCompletionRealIdeTest"`。

**驱动 JCEF webview 的用例（`@` 里的 IDE 上下文：`IdeContextRealIdeTest`）**

```sh
pnpm -F wave-webview build        # 先重编 webview，见下「产物陈旧」
DISPLAY=:101 pnpm jb:test:ui -- --tests "*IdeContextRealIdeTest*"
```

- 覆盖整条用户链路：`ActivateTerminalToolWindow` + `RemoteKeyboard` 敲 `echo <marker>` → 开 Wave 面板 → composer 里敲 `@` → Enter 选「终端」→ 点发送 → 点气泡里的 `@终端` 标签 → 断言弹窗正文含 marker。**每次跑烧一次模型调用**（发送后不等回答，但那一轮已计费）。
- **Driver 没有 JS eval**：`JCefUI.callJs` 是 private，只能用 `findElements`/`exist`/`getDom` 这类封装；`DomElement` 有 `html`、`click()`、`clickAtCenter()`。
- **选择器是 XPath 不是 CSS**：`JCefUI.findElements` 走 `document.evaluate`，写 `[data-testid=…]` 会在浏览器里抛（表现为「0 字符 DOM」或 `Error on remote driver call`）。写法：`//*[@data-testid='message-input']`。
- **必须给 Driver 预留 JS 查询槽**：`JBCefJSQuery.create` 在浏览器创建后只能复用创建前预留的槽，默认池为 0 ⇒ 每次 DOM 查询都在 IDE 侧 `IllegalStateException: Set the property JBCefClient.Properties.JS_QUERY_POOL_SIZE…`，回到测试侧只是 `Error on remote driver call`。解法 = `applyVMOptionsPatch { addSystemProperty("ide.browser.jcef.jsQueryPoolSize", 100) }`（测试用 VM 选项，不动产品代码）。取证入口：`<testHome>/log/idea.log` 里 `JBCefJSQuery` 附近。
- **点完 DOM 还要 `jcef { setFocus() }`**：DOM 点击只把光标放进 contenteditable，Swing 焦点仍在旧组件，`keyboard { enterText("@") }` 会打空（现象：composer 里没有 `@`、下拉 0 条）。
- **`findElement` ≠ `findElements`**：前者带 5s 等待、元素一重渲染就抛 `WaitForException`；读瞬时元素（下拉项）用 `findElements(...).firstOrNull()?.html`。
- 断言挂在 webview 自己的钩子上：`[data-testid=message-input]` / `[data-testid=send-btn]` / `[data-testid=messages-container]`、`[data-path="ide:terminal"]`、`[role=dialog].ide-context-preview`。
- **产物陈旧是最常见的假红**：插件打包的是 `packages/webview/dist`（`copyWebviewAssets` 只在 dist 变了才动），webview 源码改了但没 `pnpm -F wave-webview build` ⇒ 真机里跑的是旧 UI（现象：`.suggestion-item` 有 2 条却没有 `data-ide-context`，标签点开是「没有活动终端」）。跑之前先 `grep -c data-ide-context packages/webview/dist/chat.js`。
- 真机已验证（2026-10-22，IC-242.20224.300）：`IdeContextRealIdeTest` 连跑两次通过（40–47s）；弹窗正文是终端缓冲原文（含提示符、命令回显、marker），气泡里那条消息 body 不含终端文本（内容只在弹窗里）。
- **读终端的宿主侧坑（真机才发现）**：`ToolWindowManager.getToolWindow("Terminal").contentManager.selectedContent` 拿到的是**视图**条目，`getContent(widget)` 恒 null；用 `TerminalToolWindowManager.getWidgetByContent(content)` 拿 `JBTerminalWidget`（可 `as? ShellTerminalWidget`）。同名的 `findWidgetByContent(...)` 返回新 API 的桥接对象 `JBTerminalWidget$TerminalWidgetBridge`，拿不到 `terminalTextBuffer`。
- 平台 fixture 的 `IdeContextReaderTest` 仍保留「无终端时降级」的断言；终端正路只在本套件覆盖。

**不烧模型、也不需要 Starter 的那一层：平台 fixture（`pnpm jb:test`）**

- `BasePlatformTestCase` 起的是真 IDE Application（真 daemon、真 `DocumentMarkupModel`），所以 `IdeContextReaderTest` 能在里面读到真 highlighter：`myFixture.configureByText` + `myFixture.doHighlighting()` 之后，`IdeContextReader` 回 1-based 行号列号、`severity=error`、工作区相对 `filePath`。
- **读不到终端（平台 fixture 层面）**：fixture 的 `ToolWindowManager` 是 `ToolWindowHeadlessManagerImpl`（无头桩），`getToolWindow("Terminal")` 恒为 null，终端插件的 widget 无处可挂 ⇒ 这条分支只能在真界面里验，见上面 `IdeContextRealIdeTest`。
- fixture 的测试方法跑在 EDT 上，而被测读取是 `suspend` + `withContext(Dispatchers.EDT)`：直接 `runBlocking` 会死锁。做法 = 提交到 `executeOnPooledThread`，然后在 EDT 上循环 `PlatformTestUtil.dispatchAllEventsInIdeEventQueue()` 直到完成。
- 平台 fixture 的测试沙箱只装本插件（`Loaded custom plugins: CodeWave IDE`），但 IDE 自带 bundled 插件齐全——日志里 `Loaded bundled plugins: … Terminal (…) …` 就是 `<depends>org.jetbrains.plugins.terminal</depends>` 在真 IDE 里解析成功的证据。

## Linux 的显示服务与沙箱（两条都会让 IDE 起不来或补全全红）

- **VS Code**：无图形会话时套 `xvfb-run -a` 即可。
- **JetBrains 必须用免鉴权的 X server**：`Xvfb :101 -screen 0 1920x1080x24 -ac &` 再 `DISPLAY=:101 pnpm jb:test:ui`。**不要用 `xvfb-run`**——它给 X server 带 `-auth`，而 Idea Starter 重建 IDE 子进程 env 时不传 `XAUTHORITY`，IDE 以 `Can't connect to X11 window server` exit 3。
- **JCEF 被系统策略挂起**（Ubuntu 24.04 起 `kernel.apparmor_restrict_unprivileged_userns=1`）：侧栏 webview 不执行 ⇒ 没有 CLI 会话 ⇒ 补全用例全红。现象在失败截图 `log/screenshots/driverError/full_screen.png` 里直接写着 `Embedded Browser is suspended`。解法：给 IDE 的 `out/perf-startup/cache/builds/IC-<build>/idea-IC-*/bin/idea64.vmoptions` 追加 `-Dide.browser.jcef.sandbox.enable=false` 与 `-Dide.browser.jcef.gpu.disable=true`（写 IDE 配置里的注册表无效，退出时会被抹掉）。**该 cache 目录被清掉/重下 IDE 后补丁会丢**（2026-10-22 复现：日志里 `JCEF-sandbox is enabled`、补全全红），照上面重打一次。判断是否命中这条：`grep "JCEF-sandbox is enabled" <testHome>/log/idea.log`。
