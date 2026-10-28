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

CLI 是最容易把「真服务」跑起来的一层：假 HOME + `WAVE_SERVER_URL` 指目标服务端 + 把对应登录态(`auth.json`)放进去，就是端到端全真。两个服务端怎么选、登录态怎么来（测试账号密码登录 / 复用现成 auth.json）、凭证过期的表现，都在 `server-and-auth.md`。
