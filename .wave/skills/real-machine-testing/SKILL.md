---
name: real-machine-testing
description: 真机/真环境验证手法（CLI 交互 TUI、桌面端、IDE 插件、webview 与远控页），覆盖 macOS 与 Linux：tmux 跑真 TTY、假 HOME 隔离配置与凭证、连测试环境真服务与登录态签发、Playwright + 真 Chromium、VS Code/JetBrains 真编辑器套件、两种平台的显示服务与沙箱差异，以及「这红是环境还是代码」的取证口径。当要用真环境验证某条链路、复现只有真机才出现的问题、或某套真机测试在本机跑不起来时使用。
allowed-tools:
  - Bash
---

# 真机测试（macOS / Linux）

真机套件的红，**环境占的比例远大于代码**。动手指令之前先定两件事：要验的是哪一层、那一层的前置满足没有。本文件只做路由；每一层的手法在同目录 `references/` 下，按需读。

**默认口径是端到端全真**：真 CLI / 真 IDE / 真插件 + 真模型。真模型不是自建假 server，而是选一个真服务端——**本地开发服务 / 测试环境 / 线上**，三者怎么挑、各自的登录态怎么来，见 `references/server-and-auth.md`。全仓只有 realhost 一层用假模型 server，理由写在那条路由里。

## 选层与路由

| 要验的东西                               | 命令                                          | 真到什么程度                                                              | 前置                       | 细读                        |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- | -------------------------- | --------------------------- |
| 交互式 CLI / TUI / 权限弹窗 / skill 菜单 | 自起 tmux 会话                                | 真 TTY + 真模型                                                           | SDK 已 build               | `references/cli.md`         |
| 非交互 CLI 一轮                          | `pnpm run wave -p "…"`                        | 真 CLI，无 TTY                                                            | —                          | `references/cli.md`         |
| 宿主与 CLI 的协议链路                    | `pnpm run wave --stdio` / daemon 子命令       | 真 JSON-RPC                                                               | —                          | `references/cli.md`         |
| 桌面端主进程 ↔ CLI（真会话/真落盘）     | `pnpm -F wave-desktop run test:realhost`      | 真 DesktopHost + 真 `wave --stdio`，Electron 外壳被 stub、模型走假 server | 先 `pnpm build`            | `references/desktop.md`     |
| 桌面端 UI（Pane/设置/看板/预览）         | `pnpm -F wave-webview run test:e2e`           | Playwright + 真 Chromium，宿主消息 mock                                   | webview 先 build           | `references/webview.md`     |
| 远控 Web 页（手机档/PC 档）              | 同上，看 `e2e/remote-page-*.e2e.ts`           | 真浏览器 + 视口/触控模拟                                                  | 同上                       | `references/webview.md`     |
| VS Code 扩展（真编辑器）                 | `pnpm -F wave-vscode run test:e2e:completion` | 真 VS Code + 真 CLI + 真模型                                              | 本机有 VS Code、有图形会话 | `references/ide-plugins.md` |
| JetBrains 插件（真 IDE）                 | `pnpm jb:test:ui`                             | 真 IDE（Starter 下载）+ 真插件 + 真模型                                   | 有图形会话、模型配置       | `references/ide-plugins.md` |

表里各层的「真模型」都指一个**真服务端**（本地开发服务 / 测试环境 / 线上，见 `references/server-and-auth.md`），前置是那份登录态；只有 realhost 行是假模型 server。

## 每次都先读：隔离、环境与服务端

- `references/environment.md` —— 假 HOME（唯一的配置隔离手段，含「settings.json 的 env 会盖过 shell 变量」「有 auth.json 时网关直连配置整段失效」两个反直觉点）、能改哪些 env、各组件日志路径、mac/linux 对照与 Windows 已知坑。与具体层无关，任何真机验证都用得上。
- `references/server-and-auth.md` —— 要连真服务时读：**本地开发服务 / 测试环境 / 线上**三选一的判断口径与地址、登录态怎么来（线上本机已有 token 不用签发；测试环境用**测试账号密码登录**（`POST /api/auth/login`，绕开 SSO，已实测）或复用现成 `auth.json`；本地服务拿 seed 账号换 token，`localhost:5174` 带 `/login` 页）、`auth.json` 与环境的绑定关系、凭证过期会表现成什么样。

## 结论口径

- **先分类再下判断**：套件起来了但断言不过 → 可能真有问题；套件根本没起来（IDE exit 3、连不上 X、浏览器挂起、端口不通）→ 环境问题，去补前置，别报成缺陷。
- **环境性失败拿不到有效日志**：宿主侧日志为空、`cli.log` 没有新会话时，真因只在子进程的 stderr 里（JetBrains 加 `-i` 重跑才打得出，见 `references/ide-plugins.md`）。
- **如实写跑了哪些、没跑哪些**，以及哪些是本机条件限制（Xvfb 抓不到 safe-area、realhost 的假模型验不到真实模型的自纠过程、Electron 外壳未验）。为凑结论写的「应该没问题」比没跑更糟。
- 单测全绿 ≠ 真环境可用：mock 掉 transport 时，模型看到 400 之后的自纠过程、真实渲染 crash、真 TTY 的键序问题都看不见。
