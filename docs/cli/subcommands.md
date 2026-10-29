---
title: 子命令
description: 插件市场、插件操作与 daemon 后台会话的全部子命令与退出码
---

# 子命令

## 插件管理 {#plugin-commands}

```bash
# 市场管理
wave plugin marketplace add <input>          # 添加插件市场
wave plugin marketplace update [name]        # 更新已注册的市场
wave plugin marketplace list                 # 列出所有已注册市场

# 插件操作
wave plugin install <plugin>                 # 从市场安装插件
wave plugin list                             # 列出市场中可用插件
wave plugin uninstall <plugin>               # 卸载插件
wave plugin update <plugin>                  # 更新插件（卸载后重新安装）
```

安装插件时支持指定作用域（不指定时默认 user 作用域，安装即启用）：

```bash
wave plugin install my-plugin@official --scope user     # 全局安装（默认）
wave plugin install my-plugin@official --scope project  # 项目级安装
wave plugin install my-plugin@official --scope local    # 本地安装
```

## 更新 {#update-command}

```bash
wave update    # 更新 Wave CLI 到最新版本
```

Windows 上更新时提示「更新将在后台完成」并立即退出当前进程，由分离的后台子进程完成安装，避免更新程序自身占用 bin 文件句柄导致安装失败（EPERM/EBUSY）。

版本查询与安装都走 npm 国内镜像（`registry.npmmirror.com`），避免直连官方源时更新缓慢或超时；镜像不可达时自动回退到官方源，两个源都连不上才会报错退出。手工安装同理，可自行加 `--registry`。

## Daemon 客户端命令 {#daemon-commands}

`wave --daemon <socket>` 在远端主机上以守护进程方式启动 Wave，托管后台 agent 会话（桌面端经 SSH 隧道访问）。与之对应，`wave daemon <子命令>` 是访问该 daemon 的客户端命令组，可在远端主机上（或经 `ssh <host> wave daemon ...`）查看、续聊与审批 daemon 托管的会话，无需打开完整 UI。所有子命令非交互式运行：结果输出到 stdout、诊断输出到 stderr，便于脚本与管道消费。

```bash
# 列出 daemon 当前托管（进程内存中 live）的全部会话：会话 ID、工作目录、状态、消息数
wave daemon list

# 查看指定会话的实时状态（生成中/空闲/等待审批）与最近消息（默认只展示最后 1 条）
wave daemon status <sessionId> [--lines 1]

# 阻塞盯住指定会话，等它空闲（或挂起等待审批）就退出，退出时打印最终快照
# 退出码：0=等到空闲 / 3=挂起等待审批（立刻返回）/ 1=错误（连不上、会话不存在或在等待期间被销毁、--timeout 到点）
wave daemon wait <sessionId> [--lines 1] [--from-busy] [--timeout 600]

# 向会话注入一条消息（默认异步派单：发完即退，不等待回复；进度用 status 查看）
wave daemon send <sessionId> "继续"
# 需要同步等待回复时传 --wait <秒>：等待该消息对应的回复完成后输出助手最终回复
wave daemon send <sessionId> "继续" --wait 600

# 处理会话挂起的权限请求：允许 / 拒绝（可附原因）
wave daemon respond <sessionId> <requestId> --allow
wave daemon respond <sessionId> <requestId> --deny --reason "原因"

# 中断会话正在生成的回复（含子代理、bash 命令与排队消息）
wave daemon abort <sessionId>

# 优雅关闭 daemon（各会话存盘收尾后进程退出；未运行时幂等成功）
wave daemon stop

# 重启 daemon（CLI 升级后使用：先优雅停旧进程，再拉起当前 CLI 的新 daemon）
wave daemon restart
```

要点：

- 所有子命令固定连接默认 socket（`~/.wave/daemon.sock`），不提供 `--socket` 覆盖参数
- **语义区分**：`wave --daemon <socket>` 是启动 daemon（服务端），`wave daemon <子命令>` 是访问 daemon（客户端），两者互不干扰
- daemon 一经拉起即常驻运行（空闲不退出），仅在被 kill / 升级重启 / 机器重启后消失；daemon 未运行时，任一子命令自动以 nohup 方式拉起 daemon 并重试连接，仅当拉起的 daemon 在启动超时内未就绪时才以非零退出码报错退出，不进入 TUI、不挂起
- `wave daemon list` 仅展示当前 daemon 进程内存中 live 的会话（不扫磁盘索引）；知道 sessionId 时即使不在列表中，也可经 `status` / `send` 重新载入
- `wave daemon status` 默认只展示最后 1 条消息（消息正文完整不截断，默认值保持输出有界）；`--lines N` 展示最近 N 条，`--lines 0` 只输出 session 头与 `Status:` 行。`status` 始终是「取一次快照、立刻返回」的契约；需要阻塞等到状态变化（生成中 → 空闲，或挂起审批）时用 `wave daemon wait`。`Status:` 与 `wait` 用**同一**空闲判据（无回合、无后台任务/子 agent、无排队消息）：前台回合已结束但后台任务/子 agent 仍在跑的会话显示 `generating`，不会出现「`status` 说 idle、`wait` 却不返回」的矛盾取值
- `wave daemon wait` 是「盯会话」的正式入口：订阅 daemon 推送的 `loadingChange` 与 `backgroundTasksChange`（后台任务起止）作**唤醒**、醒来读注册表判空闲（不轮询），退出时按 `wave daemon status <id> --lines N` 的同格式把最终快照打到 stdout（`msg=$(wave daemon wait <id>)` 拿到的就是汇报本身），进度提示走 stderr；退出码为契约——`0`=等到空闲、`3`=会话挂起等待权限审批（立刻返回并打印待审批清单，`respond` 后可重新 `wait`）、`1`=错误（daemon 连不上 / sessionId 不存在或在等待期间被销毁 / `--timeout` 到点）。**「空闲」的判据与 `wave -p`（print mode）一致：无进行中的回合、无运行中的后台任务/子 agent、无待处理消息，三项同时成立**——只结束了前台回合、后台任务/子 agent 还在跑的会话**不算空闲**（这是刻意为之：否则会在后台任务还没跑完时就假报「已完成」），因此挂着长跑后台任务的会话（如长期跑着的 dev server）**永远不会空闲**、必须显式传 `--timeout`。调用时已空闲则立即退出 0；`--from-busy` 要求先观察到一次**本会话**的「非空闲」再判空闲（消除紧跟异步 `send` 之后立刻 `wait` 的 stale 快照竞态，运行中的后台任务同样算「忙」）；`--timeout <秒>` 默认无限等待
- **`status` / `wait` 的推送按 sessionId 分路**：daemon 把每条会话级通知广播给所有已连接客户端（信封标注 `sessionId`，一个连接可承载多个会话，如桌面端远端），因此命令订阅后先按本次 attach 的 sessionId 过滤再写状态——别的会话的 `loadingChange` / `userMessageAdded` / `assistantMessageAdded` 不得翻转 `Status:`、不得结束等待、也不得替 `--from-busy` 满足「忙」
- **无人值守监控不需要外层 shell 轮询脚本**：`wave daemon wait` 的三种终止已覆盖全部终止情形——`0`=目标会话完成（stdout 即最终快照）、`3`=卡在审批（去 `respond` 后续等）、`1`=出错（含等待期间该会话被其它客户端 `destroy`：命令会按「会话已不存在」明确报错退出，绝不挂住、也绝不把已消失的会话误报成「已完成」；daemon 侧保证销毁是「先摘注册表条目、再做耗时收尾」，因此整个销毁窗口内该会话都已按「不存在」对待）。因此调用方直接 `msg=$(wave daemon wait <id>)` 取汇报、按退出码分支即可；权限审批与会话是否仍存活这两类事实施信不了推送（会话被销毁只伴随一次 `loadingChange:false`，与「本轮生成结束」同形），由同一个 2 秒兜底查询覆盖（不是每 N 秒查一次 `status` 的状态轮询）
- **换键与就地重建不等于销毁**：会话在存活期间可以换 sessionId（清空对话铸出新 id）——daemon 会广播新 id，`wait` / `send --wait` 跟着重绑到同一个会话（不因旧 id 消失而报退出码 1 / 假超时）；配置保存触发的**就地重建**期间会话仍在注册表中并被报为「生成中」（绝不出现「条目在 + 未生成」这个会被误判成空闲的组合），读类请求照常、写类请求以可重试错误拒绝，重建完成后照常判定，只有重建**失败**才会话消失（走「已不存在」退出码 1）
- `wave daemon send` 默认异步派单：注入消息后立即退出码 0（stdout 输出 `Sent message to session: <sessionId>` 确认，不等待回复、不输出回复文本），消息照常在 daemon 中处理，进度用 `wave daemon status` 查看；需要同步等待回复时传 `--wait <秒>`（如 `--wait 600`，等待超过 N 秒无回复即以非零退出码退出；会话挂起等待审批时超时退出，提示先经 `wave daemon respond` 处理）
- `wave daemon respond` 按工具智能补全决策：`EnterPlanMode` 的 `--allow` 自动附带 plan 模式切换；`AskUserQuestion` 需用 `--answer '{"问题":"答案"}'` 提供答案；`--rule "Bash(ls)"` 持久化允许规则（后续同类调用不再询问）；`--mode acceptEdits` 切换会话权限模式
- `wave daemon abort` 中断指定会话正在生成的回复（含子代理、bash 命令与排队消息），不清除已完成的对话历史；对空闲会话是幂等 no-op（仍成功退出）；sessionId 不存在时以非零退出码报错；attach 是短暂访问、随用随断，中断后会话在 daemon 中继续存活
- `wave daemon stop` 优雅关闭 daemon（非强杀）：先销毁全部托管会话（各自存盘收尾）再退出；daemon 未运行时幂等成功（不自动拉起）；`wave daemon restart` 先优雅停掉旧 daemon、再以当前 CLI 拉起新 daemon（未运行时等价于直接拉起）——CLI 升级后运行它让 daemon 跑新代码
