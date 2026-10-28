# 隔离、env 与日志（跨层通用）

真机验证前先把「跑在什么配置上」和「出问题去哪看」定下来，否则验出来的是上一份配置的行为、或者根本找不到证据。

## 假 HOME 是唯一的配置隔离手段

配置目录全部由 `os.homedir()` 拼出来（`packages/agent-sdk/src/utils/configPaths.ts`、`src/utils/constants.ts`），**仓库没有任何 `WAVE_CONFIG` / `WAVE_HOME` 之类的目录级 env 覆盖**。所以：

```sh
HOME=/tmp/probe-home pnpm run wave            # Linux / macOS（POSIX 下 os.homedir() 读 $HOME）
```

一次假 HOME 里会被隔离的东西：`~/.wave/settings.json`、`auth.json`（凭证）、`projects/`（会话）、`file-history/`、`daemon.sock`、`logs/`、用户级 `AGENTS.md`。想保留登录态就把真 `~/.wave/auth.json` 拷进去；想彻底干净就什么都别拷。

**两个反直觉点：**

- **settings.json 的 `env` 会盖过 shell 导出的同名变量**。它进的是每会话快照（`configurationService.ts` 的 `setEnvironmentVars`），网关解析优先读快照再读 `process.env`，所以假 HOME 里若带着 `env.WAVE_API_KEY` / `WAVE_BASE_URL` / `WAVE_MODEL`，你在命令行导出的值不生效（只有 `WAVE_SERVER_URL` 会被镜像进 `process.env`）。灌 env 之前先 `cat` 一眼假 HOME 的 settings.json。
- **有 SSO token 时 `WAVE_BASE_URL` / `WAVE_API_KEY` 整段被跳过**：`auth.json` 存在 ⇒ 网关固定为 `${serverUrl}/api/v1` + SSO token（`configurationService.ts:595-610`）。所以**换服务端（比如从生产切到测试环境）= 重新签发登录态**，只换网关不动 token 是做不到的；反过来，要接自建网关/假 server 时假 HOME 里就不能有 `auth.json`。

## 环境变量能改什么

`WAVE_SERVER_URL`（服务端，决定 SSO/网关/远端配置）、`WAVE_API_KEY` / `WAVE_BASE_URL`（网关直连）、`WAVE_MODEL` / `WAVE_FAST_MODEL` / `WAVE_VISION_MODEL` / `WAVE_COMPLETION_MODEL`、`WAVE_MAX_INPUT_TOKENS`、`WAVE_LOGS_DIR`（桌面/vscode 宿主日志目录）、`LOG_FILE`（CLI 日志文件）、`LOG_LEVEL`、`DISABLE_LOGGER_IO=true`（关全部日志 IO，测试里常用）。

## 日志在哪

| 组件         | 路径                                                                                     | 备注                                               |
| ------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------- |
| CLI          | `~/.wave/logs/cli.log`                                                                   | **UTC** 时间戳；`LOG_FILE` 可覆盖                  |
| 桌面端主进程 | `~/.wave/logs/desktop.log`                                                               | 超 1MB 截到 1000 行；吃 `WAVE_LOGS_DIR`            |
| VS Code 扩展 | `~/.wave/logs/vscode.log`，扩展控制台打在 `runTests` stdout                              | 同上                                               |
| JetBrains    | `packages/jetbrains/out/perf-startup/tests/IC-<build>/waveInlineCompletion/log/idea.log` | 失败另有 `screenshots/driverError/full_screen.png` |
| webview e2e  | `packages/webview/test-results/`、`playwright-report/`                                   | 失败先看截图/trace                                 |

## macOS 与 Linux 对照

| 项                 | macOS                                                      | Linux                                                                   |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| 图形会话           | 始终有真 GUI                                               | 常需 Xvfb；JetBrains 必须 `-ac` 免鉴权（见 `ide-plugins.md`）           |
| 浏览器沙箱         | 正常                                                       | Ubuntu 24.04 起可能挂起 JCEF（userns 限制）                             |
| VS Code 路径       | `/Applications/Visual Studio Code.app/Contents/MacOS/Code` | 自行下载 tarball，用 `WAVE_E2E_VSCODE` 指过去                           |
| `/tmp`             | 普通盘                                                     | 可能是 tmpfs（本机 7.6G）：解包大产物/临时 profile 要 `TMPDIR` 指到大盘 |
| tmux               | `brew install tmux`                                        | `sudo -n apt-get install -y tmux`                                       |
| Playwright 依赖库  | 自带                                                       | `playwright install --with-deps chromium`                               |
| JetBrains 输入注入 | 不用 Robot，无需辅助功能权限                               | 同                                                                      |

Windows 已知：realhost 的临时目录要用 `tests/helpers/tempDir.ts` 的 `longFormTempDir()`（8.3 短名会让 libuv 的 fs-event 断言崩）；daemon 集成测试因 unix socket 不可用整文件 skip。
