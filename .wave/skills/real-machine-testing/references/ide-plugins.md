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

## JetBrains

```sh
pnpm jb:test:ui                            # 全部 integrationTest
pnpm jb:test:ui -- --tests "*completion*"  # 只跑补全
```

- Starter + Driver（`intellijPlatformTesting.testIdeUi`）拉起真 IDE、装 `build/distributions` 里的插件、用平台 action 驱动（`EditorTextEnd` / `CallInlineCompletionAction` / `InsertInlineCompletionAction`），**不用 `java.awt.Robot`** ⇒ 不依赖 macOS 辅助功能权限。
- 前置：可用模型配置 + 图形会话；首次要下 IDE（之后热态约 1 分钟）。
- 补全没有自己的会话，模型配置取自侧栏会话 ⇒ 侧栏 webview 起不来时 provider 会一直返回空建议（表现：等不到 ghost text，而「加载插件」那条仍然通过）。
- 环境性失败取证：Starter 侧日志为空、`cli.log` 没有新会话时，真因只在 IDE 子进程的 stderr 里，加 `-i` 重跑才打得出——
  `node packages/jetbrains/scripts/gradle.mjs integrationTest --no-daemon -i --tests "com.wave.jetbrains.completion.InlineCompletionRealIdeTest"`。

## Linux 的显示服务与沙箱（两条都会让 IDE 起不来或补全全红）

- **VS Code**：无图形会话时套 `xvfb-run -a` 即可。
- **JetBrains 必须用免鉴权的 X server**：`Xvfb :101 -screen 0 1920x1080x24 -ac &` 再 `DISPLAY=:101 pnpm jb:test:ui`。**不要用 `xvfb-run`**——它给 X server 带 `-auth`，而 Idea Starter 重建 IDE 子进程 env 时不传 `XAUTHORITY`，IDE 以 `Can't connect to X11 window server` exit 3。
- **JCEF 被系统策略挂起**（Ubuntu 24.04 起 `kernel.apparmor_restrict_unprivileged_userns=1`）：侧栏 webview 不执行 ⇒ 没有 CLI 会话 ⇒ 补全用例全红。现象在失败截图 `log/screenshots/driverError/full_screen.png` 里直接写着 `Embedded Browser is suspended`。解法：给 IDE 的 `out/perf-startup/cache/builds/IC-<build>/idea-IC-*/bin/idea64.vmoptions` 追加 `-Dide.browser.jcef.sandbox.enable=false` 与 `-Dide.browser.jcef.gpu.disable=true`（写 IDE 配置里的注册表无效，退出时会被抹掉）。
