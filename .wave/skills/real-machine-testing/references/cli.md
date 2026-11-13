# CLI：真 TTY、非交互模式与连真服务

隔离与日志见 `environment.md`；SDK 是源码还是 dist 决定你验的是不是新逻辑，见下面第 2 条。

## 交互行为只能靠真 TTY（tmux）

`-p` 里 `AskUserQuestion` 无法作答、单测里 `ConfirmationSelector` 会被绕过——**「弹窗没出现但工具返回空答案」这类缺陷只有真会话能看见**。

```sh
# 起会话（-x/-y 决定 TUI 宽度；cwd 就是 agent 的 workdir）
tmux new-session -d -s probe -x 140 -y 45 \
  "cd /path/to/workdir && /path/to/repo/node_modules/.bin/tsx /path/to/repo/packages/code/src/index.ts"

tmux send-keys  -t probe -l "帮我看看这个仓库的 X"     # -l 防特殊键解释
tmux send-keys  -t probe Enter                        # Enter 单独发！
tmux capture-pane -p -t probe                          # 读屏；回看历史加 -S -120
```

三个必踩的坑：

1. **`send-keys '/cmd' Enter` 和「先发文本再发 Enter」不是同一条路径**——前者文本与 `\r` 同一 chunk，走 `inputReducer` 的 coalesced-Enter 分支。同一个缺陷可能一次复现一次不复现，先确认发送方式再改代码。
2. **这样起只保证 `packages/code` 是源码，SDK 仍读 `packages/agent-sdk/dist`** ⇒ 先 `pnpm -F wave-agent-sdk build`，否则验的是旧 SDK。只想验 SDK 源码本身、不关心 TUI，就别绕 CLI，直接写 example（`sdk.md`，那边 import 的是 `src/`，不用 build）。
3. **Ink 下不要 `console.log`**（污染 TUI 且看不到）。临时在 reducer/handler 里 `appendFileSync("/tmp/x.log", …)` 打 action 流，定因后立刻删。

权限弹窗用 `send-keys Up/Down + Enter` 选；要它安静跑完可切到 `Yes, and bypass permissions`（状态行显示 `bypassPermissions`）。tmux 本机没有时按 `environment.md` 的平台对照装。

## Windows：没有 tmux 时用 node-pty（真 ConPTY）

上一节的前提是有 tmux；Windows 没有，交互式 CLI 改用 **node-pty 起真 ConPTY**，脚本放在临时目录（别进仓库）。`node-pty@1.2.0-beta.14` 在 `.pnpm` 里，从 `packages/desktop/package.json` 用 `createRequire` 拿。

- **可执行文件必须绝对路径**：`process.execPath` + `.../node_modules/tsx/dist/cli.mjs` + `packages/code/src/index.ts`；`cwd` 给被测 workdir。写 `node` 会报 `File not found:`。
- 假 HOME 要**连 `APPDATA` / `LOCALAPPDATA` 一起指**（Windows 的配置与缓存读这两个，见 `environment.md`）。
- **一次 write 只发一个完整键，间隔 90~150ms**。一个 chunk 里塞多个键盘序列时解析结果不可靠，帧可能纹丝不动——那会把「探针写法错」读成「功能不响应」。
- 要「看画面」得自己维护一块屏幕网格（`\x1b[H/2J/2K/A/B/C` + `\r\n` 够用）。注意 **`log-update` 靠 ECH（`\x1b[<n>X`）擦旧帧行尾**，只实现 `2K` 会留下上一帧的字符，屏幕上出现「两个帧交织」的错觉——很容易误报成渲染 bug。真怀疑渲染时先回 raw 看那段 CSI。
- **要跑一轮真模型**（验 per-turn / 流式这类只有真回合才有的东西）：把 `~/.wave/auth.json` 与 `~/.wave/remote-settings.json`（后者带 `settings.env.WAVE_MODEL`）拷进假 HOME 的 `.wave/`，启动加 `--permission-mode bypassPermissions`，否则改文件会卡在权限弹窗等按键。**跑完立刻删掉这两份拷贝**——里面是真 SSO token，不该留在临时目录。
- 判「这一轮跑完了」用拍帧轮询：出现输入框提示、不含 `esc to interrupt|Running`、且连续两拍帧相同（真模型一轮 Read+Edit 约 20~30s）。别写死 sleep。
- 验收交互式覆盖层的口径是**顺不顺**：滚动跟手，且 `↑ N more` 这类数字与实际偏移对得上——「能打开」不算过。

## 非交互三模式

```sh
pnpm run wave -p "…"                 # print 模式，stdout 只有答案
pnpm run wave --stdio                # JSON-RPC over stdio，stdout 被 guardStdoutForJsonRpc 保护
pnpm run wave daemon list|status|wait <id>|send|respond|abort|destroy|stop|restart
```

- daemon socket 固定 `~/.wave/daemon.sock`，**没有 `--socket` 覆盖** ⇒ 隔离只能靠假 HOME。
- `daemon status <sessionId>` 是**会话**状态（不是进程状态）；`daemon wait` 退出码 0=空闲 / 3=待审批 / 1=错误。
- daemon 由任何需要它的命令按需拉起；`stop` 幂等（未运行也 exit 0）。

## 连真服务（测试环境 / 线上）

CLI 是最容易把「真服务」跑起来的一层：假 HOME + `WAVE_SERVER_URL` 指目标服务端 + 把对应登录态(`auth.json`)放进去，就是端到端全真。`auth.json` 与 serverUrl 绑定，跨环境会 401 ⇒ 换服务端就得一并换登录态（见 `environment.md`）。
