# 真机 e2e：行内补全（inline completion）

用**真实 VS Code + 真实扩展 + 真实 CLI 会话 + 真实模型**跑一遍补全链路：
放光标 → 改文本 → 触发补全 → 接受建议 → 断言文档里多了模型给的代码。

这不是 PR 门禁的一部分：它要网络、要 `~/.wave/settings.json` 里可用的模型配置，
还会消耗一次真实模型调用。跑法：

```sh
# dist/ 已是最新时
pnpm -F wave-vscode run test:e2e:completion

# 先重新构建扩展（含 bundleCli，会检查 packages/code 产物是否过期）
pnpm -F wave-vscode run test:e2e:completion -- --build
```

环境变量 `WAVE_E2E_VSCODE` 可指定编辑器可执行文件（默认找
`/Applications/Visual Studio Code.app/Contents/MacOS/Code`）。脚本用临时
`--user-data-dir` 和临时工作区，并带 `--disable-extensions`：用户已装扩展（尤其
`GitHub.copilot-chat`，它也注册 inline provider）不会干扰断言。

## 用例与判据

| 用例           | 驱动方式                                                                                            | 断言                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 手动触发       | `editor.action.inlineSuggest.trigger`（`explicit: true` → `Invoke`，跳过 provider 自己的 debounce） | 接受后文档以种子前缀开头且变长                                                                                    |
| 自动触发       | 只用 `editor.edit()` 在光标处插入一个字符，**不调用** trigger                                       | 接受后文档变长（证明平台自己调了 provider）                                                                       |
| 跨文件定义片段 | 两个文件（`helper.ts` 定义符号、`answer.ts` 只 import 它），手动触发                                | 先断言 `vscode.executeDefinitionProvider` 能解析该 import（否则宿主根本采不到片段），再断言接受的文本里出现该符号 |

跨文件用例里模型有随机性，所以最多重试 3 次（每次把缓冲区复位到同一个种子）；
断言的是「建议里出现了只可能来自片段的符号名」，不是具体写法。
`--disable-extensions` 只关掉已安装扩展，内置扩展（TypeScript 语言服务）仍然可用——
跨文件片段的定义解析正是靠它，把内置扩展也关掉的话该用例会在第一步就失败。

## 为什么断言文档而不是 ghost text

VS Code 没有读取 inline suggestion 的扩展 API（[vscode-discussions#483](https://github.com/microsoft/vscode-discussions/discussions/483)
的官方答复），`editor.action.inlineSuggest.commit` 是唯一可观测的钩子。因此
「接受后光标处出现文本」是黑盒能做到的最强断言；要验证**渲染**（ghost text 真的画出来、
样式对不对）只能上 UI 级方案（ExTester / Playwright 驱动 VS Code DOM + 截图）。

## 排查

- 扩展控制台输出（含 `[completion-e2e] editor focus state:` 一行）直接打在 `runTests` 的标准输出里。
- CLI 侧日志：`~/.wave/logs/cli.log`（**UTC** 时间戳），补全请求与模型原始响应都在。
- 前置条件：补全没有自己的会话，模型配置取自侧栏会话，所以用例先执行
  `wave-code.openChatSidebar` 并等 CLI 起来。会话没起来时 provider 静默返回空建议，
  表现就是「一直等不到建议」。
