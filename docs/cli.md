# Wave Code CLI

基于 React Ink 构建的 CLI 终端界面，提供交互式 AI 编程助手体验。

---

## 1. 安装与启动 {#installation}

### 1.1 安装 {#install}

```bash
npm install wave-code -g
```

### 1.2 运行模式 {#run-modes}

Wave CLI 提供三种运行模式，适用于不同场景：

**交互模式**（默认）

启动基于 React Ink 的终端 UI，支持实时对话、流式输出和完整的交互体验。

```bash
wave
```

**打印模式**（`--print` / `-p`）

非交互式运行，接收输入并一次性输出结果，适用于脚本集成和自动化流水线。

```bash
wave -p "解释这个项目的架构"
echo "分析这段代码的问题" | wave -p
```

配合 `--show-stats` 可在输出末尾显示耗时和 Token 用量统计；配合 `--output-format json` / `stream-json` 可输出机器可读结果（见 [结构化输出](#structured-output)）。

---

## 2. 命令行选项 {#cli-options}

### 2.1 会话控制 {#session-options}

| 选项             | 简写 | 描述                                             |
| ---------------- | ---- | ------------------------------------------------ |
| `--restore <id>` | `-r` | 按 session ID 恢复会话；不指定 ID 则列出可用会话 |
| `--continue`     | `-c` | 自动继续上次会话                                 |

```bash
# 列出可恢复的会话
wave -r

# 恢复指定会话
wave -r <session-id>

# 继续上次会话
wave -c
```

### 2.2 模型与工具 {#model-tool-options}

| 选项                        | 描述                          |
| --------------------------- | ----------------------------- |
| `--model <name>`            | 指定 AI 模型                  |
| `--tools <list>`            | 启用的工具列表（逗号分隔）    |
| `--allowed-tools <list>`    | 始终允许的工具列表            |
| `--disallowed-tools <list>` | 始终禁用的工具列表            |
| `--mcp-config <json>`       | MCP 服务器配置（JSON 字符串） |

```bash
# 指定模型并限制工具
wave --model gpt-4o --disallowed-tools Bash,Write
```

### 2.3 权限与安全 {#permission-options}

| 选项                             | 描述                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `--permission-mode <mode>`       | 设置权限模式：`default`、`acceptEdits`、`bypassPermissions`、`dontAsk`、`plan` |
| `--dangerously-skip-permissions` | 跳过所有权限检查（危险）                                                       |
| `--add-dir <path>`               | 将目录加入会话安全区域，可重复指定（仅当前会话生效）                           |

```bash
# 将 /data/exports 加入当前会话的安全区域
wave --add-dir /data/exports
```

### 2.4 工作目录 {#worktree-options}

| 选项                | 简写 | 描述                                 |
| ------------------- | ---- | ------------------------------------ |
| `--worktree [name]` | `-w` | 在 git worktree 中启动，可选指定名称 |

```bash
# 自动命名 worktree
wave -w

# 指定 worktree 名称
wave -w my-feature
```

### 2.5 其他 {#misc-options}

| 选项                    | 简写 | 描述                                                    |
| ----------------------- | ---- | ------------------------------------------------------- |
| `--plugin-dir <path>`   |      | 从指定目录加载插件                                      |
| `--show-stats`          |      | 打印模式下显示耗时和 Token 统计                         |
| `--output-format <fmt>` |      | 打印模式输出格式：`text`（默认）、`json`、`stream-json` |
| `--version`             | `-v` | 显示版本号                                              |
| `--help`                | `-h` | 显示帮助信息                                            |

---

## 3. 子命令 {#subcommands}

### 3.1 插件管理 {#plugin-commands}

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

### 3.2 更新 {#update-command}

```bash
wave update    # 更新 Wave CLI 到最新版本
```

Windows 上更新时提示「更新将在后台完成」并立即退出当前进程，由分离的后台子进程完成安装，避免更新程序自身占用 bin 文件句柄导致安装失败（EPERM/EBUSY）。

版本查询与安装都走 npm 国内镜像（`registry.npmmirror.com`），避免直连官方源时更新缓慢或超时；镜像不可达时自动回退到官方源，两个源都连不上才会报错退出。手工安装同理，可自行加 `--registry`。

### 3.3 Daemon 客户端命令 {#daemon-commands}

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

---

## 4. 斜杠命令 {#slash-commands}

在交互模式中，输入 `/` 可触发命令选择器，快速调用以下内置命令：

| 命令              | 描述                                                       |
| ----------------- | ---------------------------------------------------------- |
| `/help`           | 显示帮助和快捷键                                           |
| `/status`         | 显示 Agent 状态和配置信息                                  |
| `/model`          | 切换 AI 模型                                               |
| `/tasks`          | 管理后台任务                                               |
| `/mcp`            | 管理 MCP 服务器连接                                        |
| `/plugin`         | 管理插件                                                   |
| `/reload-plugins` | 就地重新加载插件（不重启会话）                             |
| `/workflows`      | 查看和管理工作流运行                                       |
| `/rewind`         | 回滚到历史检查点                                           |
| `/resume`         | 恢复历史对话（会话内切换，无需退出进程）                   |
| `/rename`         | 给当前对话设自定义标题                                     |
| `/login`          | SSO 企业认证登录                                           |
| `/logout`         | 清除 SSO 认证                                              |
| `/clear`          | 清除当前对话历史                                           |
| `/compact`        | 压缩对话历史，减少 Token 占用                              |
| `/add-dir`        | 将目录加入会话安全区域（可带 `--remember` 持久化）         |
| `/agents`         | 查看当前会话可见的所有 agent（子代理）定义，按来源分组展示 |
| `/skills`         | 查看当前会话可见的所有技能，按来源分组展示并可查看详情     |
| `/hooks`          | 查看当前生效的钩子配置                                     |
| `/plan`           | 进入计划模式，或查看当前会话的计划文件                     |
| `/btw`            | 旁路提问，不调用工具的快速问答                             |

> 了解更多：详见 [SDK 文档 - 斜杠命令](/sdk#slash-commands)

---

## 5. 键盘快捷键 {#keyboard-shortcuts}

### 5.1 输入与导航 {#input-navigation}

| 快捷键                        | 功能                                           |
| ----------------------------- | ---------------------------------------------- |
| `Enter`                       | 发送消息 / 确认选择                            |
| `Ctrl+J`                      | 输入换行（多行输入）                           |
| `↑` / `↓`                     | 浏览输入历史 / 选择器导航                      |
| `@`                           | 触发文件选择器，将文件或子代理添加到上下文     |
| `/`                           | 触发命令选择器                                 |
| `!`                           | Shell 命令前缀（如 `!ls -la`）                 |
| `Ctrl+R`                      | 搜索 Prompt 历史（会话选择器内为给该会话改名） |
| `Ctrl+V` / `Alt+V`（Windows） | 粘贴剪贴板图片                                 |
| `Ctrl+A`                      | 光标移到行首                                   |
| `Ctrl+E`                      | 光标移到行尾                                   |
| `Ctrl+U`                      | 删除光标前到行首的内容                         |
| `Ctrl+K`                      | 删除光标后到行尾的内容                         |
| `Ctrl+W`                      | 删除光标前一个词                               |

**占位符整块删除：** 粘贴长文本或图片会生成 `[LongText#N]` / `[Image #N]` 占位符。当光标位于占位符末尾且其后为空白或行尾时，按 `Backspace` 会整块删除占位符（连同对应的长文本/图片附件），不会留下残缺片段；`Ctrl+U`/`Ctrl+K`/`Ctrl+W` 等行编辑键仍按普通字符串处理。

### 5.2 视图控制 {#view-control}

| 快捷键   | 功能                   |
| -------- | ---------------------- |
| `Ctrl+O` | 展开/折叠消息          |
| `Ctrl+T` | 切换任务列表显示       |
| `Ctrl+B` | 将当前任务放到后台执行 |

### 5.3 权限与确认 {#permission-control}

| 快捷键            | 功能                                 |
| ----------------- | ------------------------------------ |
| `Shift+Tab`       | 循环切换权限模式                     |
| `Tab`             | 在确认对话框中切换选项               |
| `PgUp`/`PgDn`     | 确认详情超高时翻页滚动内容区         |
| `Ctrl+U`/`Ctrl+D` | 确认详情超高时上/下滚半页            |
| `Esc`             | 中断 AI 响应 / 取消选择器 / 关闭帮助 |
| `Esc ×2`          | 空闲时双击清空输入（并保存到历史）   |

确认详情（超长 plan 或大 diff）超高时，内容区可独立滚动（`PgUp`/`PgDn` 翻页、`Ctrl+U`/`Ctrl+D` 半页），选项列表固定底部始终可见，底部显示滚动快捷键提示（内容不超高时不显示）。

---

## 6. 权限模式 {#permission-modes}

Wave 提供五种权限管理模式，控制 AI 调用工具时的确认行为：

| 模式                | 描述                                            |
| ------------------- | ----------------------------------------------- |
| `default`           | 受限工具需要用户确认，最安全的模式              |
| `acceptEdits`       | 自动接受文件编辑操作，其他工具仍需确认          |
| `bypassPermissions` | 自动接受所有工具调用，无需任何确认（危险）      |
| `plan`              | 计划模式，AI 只能修改计划文件，适合项目规划阶段 |
| `dontAsk`           | 自动拒绝受限工具，AI 不会请求确认也不会执行     |

**切换方式：**

- 交互模式中按 `Shift+Tab` 循环切换
- 启动时通过 `--permission-mode` 指定
- 使用 `--dangerously-skip-permissions` 等同于 `bypassPermissions`

**默认自动放行的只读命令：**

`default` 模式下，以下只读 git 命令默认直接执行、不触发权限确认：`git status`、`git diff`、`git log`、`git show`、`git branch`（含 `--list` / `-a` / `-r` / `-v` 等变体）、`git tag`、`git remote`、`git ls-files`、`git rev-parse`、`git config --list`、`git cat-file`、`git count-objects`。命令带全局作用域参数（如 `git -C <path> status`、`git --work-tree <path> diff`）时同样匹配自动放行；写操作（`git push`、`git commit`、`git branch -D` 等）不受影响，仍按正常权限流程确认。

---

## 7. 特色功能 {#features}

### 7.1 Bash 模式 {#bash-mode}

在输入框中以 `!` 开头直接执行 Shell 命令，无需离开聊天界面。

```bash
!ls -la
!git status
!npm test
```

命令以 user 消息 + bash tool block 形态显示在消息流中，输出在命令结束后一次性显示、全量展示；失败时在输出前标注 `[exit code: N]`。长时间运行的命令支持随时中止。

### 7.2 BTW 旁路提问 {#btw}

`/btw <question>` 向 AI 快速提问，AI 不会调用任何工具，仅基于已有上下文直接回答。适合快速确认思路或获取解释，不产生工具调用开销。

```
/btw 这个函数的时间复杂度是多少？
```

回答期间显示 `✻ Answering` 加载提示，其后实时展示当前流式文本的最后 30 个字符（超出截断、换行折叠），按 `Esc` 可中止请求。

回答较长时显示在固定高度的视口中，用 `↑`/`↓`（或 `Ctrl+P`/`Ctrl+N`）每次滚动 3 行，按 `Esc` 关闭。

### 7.3 Git Worktree {#worktree}

通过 `--worktree` 在隔离的 git worktree 中启动，安全实验新功能而不影响主分支。

```bash
wave -w my-feature
```

在交互模式中也可通过内置工具 `EnterWorktree` 切换到 worktree。

在退出对话框选择 "Remove worktree"（或打印模式 `-p` 正常退出清理、`WorktreeRemove` hook 接管）删除 worktree 时，会显示 `Deleting worktree ...` 进度提示，完成后显示 `Done.`；删除失败显示错误信息而非完成提示。选择 "Keep worktree" 保留时无提示。

### 7.4 Compact 压缩 {#compact}

`/compact` 压缩当前对话历史，将冗长的上下文总结为精简摘要，减少后续请求的 Token 占用。支持附加自定义指令引导压缩方向。

```
/compact 重点保留 API 设计相关的讨论
```

压缩进行中消息列表下方显示 `✻ Compacting` 提示，其后实时展示当前流式文本的最后 30 个字符（超出截断、换行折叠），压缩完成后提示消失。

### 7.5 Rewind 回滚 {#rewind}

`/rewind` 将对话回滚到历史检查点，撤销后续的对话记录和文件更改。

### 7.6 图片粘贴 {#image-paste}

按 `Ctrl+V` 粘贴剪贴板中的图片，支持跨平台（macOS、Linux、Windows）。AI 可识别截图中的 UI 设计、错误信息或架构图。Windows 终端将 `Ctrl+V` 保留为系统文本粘贴，按键不会到达 CLI，因此 Windows 下使用 `Alt+V`（与 Claude Code 一致）。

### 7.7 MCP 集成 {#mcp}

通过 `/mcp` 管理 MCP（Model Context Protocol）服务器连接，扩展 AI 的外部工具能力。支持在项目根目录的 `.mcp.json` 中配置，或通过 `--mcp-config` 命令行传入。

### 7.8 插件系统 {#plugin}

通过插件扩展 AI 的 Skill 和命令。支持插件市场的发现、安装和管理，插件可在 user、project、local 三种作用域下激活。

详见 [第 3.1 节 插件管理](#plugin-commands)。

### 7.9 Workflow 工作流 {#workflow}

通过 `/workflows` 查看和管理正在运行的工作流。工作流支持多阶段编排、并行执行和确定性控制流。

### 7.10 后台任务 {#background-tasks}

通过 `/tasks` 查看后台任务列表，或通过 `Ctrl+B` 将当前前台任务放到后台执行。支持 shell 命令和子代理两种任务类型，任务完成后自动通知。

### 7.11 SSO 认证 {#sso}

通过 `/login` 进行企业 SSO 认证，授权码通过 localhost 回调自动交换为 JWT。登录后 API 请求自动通过 Wave AI 服务端代理路由，无需手动配置 API Key。通过 `/logout` 清除认证状态。

### 7.12 会话管理 {#session-management}

支持多会话的创建、恢复和管理：

```bash
wave              # 启动新会话
wave -c           # 继续上次会话
wave -r           # 列出可恢复的会话
wave -r <id>      # 恢复指定会话
```

会话文件的元数据头持久化真实的创建时间、工作目录与 git 分支；`wave -r` 选择器中会话行尾显示 git 分支标签（如 `[main]`），多 worktree 场景下可区分同仓库不同分支的会话。

### 7.13 附加工作目录 {#additional-working-directories}

默认情况下，Agent 只能在当前工作目录内读写文件。通过附加目录（additional working directories）将安全区域扩展到工作目录之外，目录内的文件操作不再触发权限确认，并在系统提示词中列出。

```bash
# 启动时加入（仅当前会话生效，可重复指定）
wave --add-dir /data/exports

# 会话进行中加入（--remember 追加到 .wave/settings.local.json 的
# permissions.additionalDirectories，后续会话自动加载）
/add-dir /data/exports
/add-dir --remember /data/exports
```

无参数执行 `/add-dir` 显示用法及当前会话的附加目录列表。此功能为 CLI 专属入口；配置键 `permissions.additionalDirectories` 为通用配置，各端（CLI、VS Code 等）均生效。

### 7.14 Token 用量统计 {#token-stats}

在打印模式下配合 `--show-stats` 使用，输出结果末尾显示耗时和 Token 用量统计信息。

```bash
wave -p --show-stats "分析这个项目的依赖关系"
```

### 7.15 会话内热切换 {#resume}

`/resume` 在 TUI 内打开会话选择器，切换到另一段对话，不必退出进程重开：

```
/resume
```

选择器与 `wave -r` 共用同一组件与同一套会话归属判定（`↑` `↓` 选择、`Enter` 确认、`Esc` 取消）：

- **范围**：默认列出当前目录的会话；`Ctrl+W` 展开同仓库的全部 worktree（含主仓库），`Ctrl+A` 展开全部项目——展开时行尾显示会话所属项目路径。
- **原地恢复**：选中当前目录的会话即原地恢复，工作目录不变。
- **自动切换工作目录**：选中同仓库其它 worktree 的会话时直接恢复，并把会话转录文件、项目规则与记忆改按该目录解析。
- **跨项目**：选中其它项目的会话时不在当前进程恢复，选择器内显示可复制的 `cd <路径> && wave --restore <sessionId>`（同时写入剪贴板），按 `Esc` 返回——关闭提示后原会话与内容不受影响。目标 worktree 目录已被删除时按同样方式处理。
- **运行中**：正在生成回复时按 `/resume` 提示 `Cannot resume a conversation while the agent is running.`（`Esc` 返回），不中断当前回合。
- **切换后**：当前会话先自动存盘，消息流、Token 用量与任务列表整体换成目标会话的状态，输入框草稿清空。
- **失败**：目标会话记录不存在或损坏时不切换，提示失败原因，当前会话保持可用。

切换会触发 `SessionEnd` / `SessionStart` 钩子（来源为 `resume`），与 `wave -r` 启动时一致。

### 7.16 会话重命名 {#rename}

给当前对话设一个自定义标题，替代默认的「首条用户消息截断」显示：

```
/rename 修复登录页样式
```

不带标题执行 `/rename` 只打印用法（`Usage: /rename <title>`），成功时回显 `Conversation renamed to "…".`。

会话选择器（`/resume` 与 `wave -r` 共用同一组件）里也能就地改名：`↑` / `↓` 选中某行后按 `Ctrl+R`，该行标题变成输入框并全选原标题，`Enter` 保存、`Esc` 取消——选择器内 `Ctrl+R` 是重命名，与输入框里的 `Ctrl+R`（搜索 Prompt 历史）互不冲突。

- **显示优先级**：自定义标题 > 首条用户消息截断（30 字符）> `新对话`；已设的自定义标题不会被后续消息按「首条消息」重新推导覆盖。
- **存储与一致性**：标题以 `custom-title` 保留条目追加在会话自己的 JSONL 文件里（唯一权威来源），因此 `wave -r`、插件端与桌面端读到的都是同一个标题。
- **空标题**：`trim` 后为空时只提示用法、不作改动（没有「清除标题」语义）。
- **失败**：写盘失败时报错并保持原标题不变（不静默）。

### 7.17 结构化输出 {#structured-output}

打印模式默认输出给人看的纯文本。要让脚本或 CI 消费结果，用 `--output-format` 换成结构化格式，stdout 上就只剩 JSON：

```bash
# 取助手回复的纯文本
wave -p "列出当前目录" --output-format json | jq -r .result

# 逐事件消费（打印进度、审计工具调用）
wave -p "解释这个项目的架构" --output-format stream-json | jq -c .

# 在流水线里按结果决定成败
wave -p "检查构建脚本" --output-format json > result.json || echo "运行失败"
jq -e '.subtype == "success"' result.json > /dev/null
```

**`--output-format json`**：一次运行结束时输出**一条** JSON 对象。

| 字段          | 类型     | 说明                                                                                                                         |
| ------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `type`        | string   | 固定为 `"result"`                                                                                                            |
| `subtype`     | string   | `"success"` 或 `"error_during_execution"`                                                                                    |
| `is_error`    | boolean  | 与 `subtype` 同义，便于布尔判断                                                                                              |
| `result`      | string   | 最后一条助手消息的纯文本；**运行失败时没有这个字段**                                                                         |
| `session_id`  | string   | 会话 ID，可直接 `wave -r <session_id>` 恢复                                                                                  |
| `num_turns`   | number   | 主 agent 的助手消息条数（流式降级的半截消息不计入）                                                                          |
| `duration_ms` | number   | 本次运行耗时（毫秒）                                                                                                         |
| `usage`       | object   | `prompt_tokens` / `completion_tokens` / `total_tokens`，有缓存时带 `cache_read_input_tokens` / `cache_creation_input_tokens` |
| `model_usage` | object   | 按模型分组的同一组计数，外加 `operations.agent_calls` / `operations.compactions`                                             |
| `tool_calls`  | array    | `{id, name, input, success, error?}`，按调用顺序；**不含工具输出**（完整输出在会话记录里）                                   |
| `errors`      | string[] | 仅在非空时出现：运行中的错误块（模型请求失败、hook 报错等）                                                                  |

**`--output-format stream-json`**：每行一个 JSON 事件。首行是 `system/init`（建 agent 阶段就产生的事件会被押后到它之后；若建 agent 直接失败则没有 init，流从 `error` 到 `result`），末行是与上面结构相同的 `result`，中间按发生顺序是：

| `type` / `subtype`              | 主要字段                                                 |
| ------------------------------- | -------------------------------------------------------- |
| `system` / `init`               | `session_id`、`model`、`cwd`、`permission_mode`、`tools` |
| `assistant` / `reasoning_delta` | `message_id`、`delta`                                    |
| `assistant` / `content_delta`   | `message_id`、`delta`                                    |
| `tool` / `start`                | `message_id`、`tool_use_id`、`name`、`input`             |
| `tool` / `end`                  | `message_id`、`tool_use_id`、`name`、`success`、`error`  |
| `error`                         | `message`                                                |
| `result`                        | 同 `json` 格式的 result 对象                             |

`assistant` 事件的 `delta` 是**增量**片段，拼接起来才是完整文本。

几条使用约定：

- **退出码**：`0` 表示这次运行干成了活。以下两类判为失败、退出码 `1`，此时 stdout 上仍有一条 `subtype` 为 `error_during_execution` 的 result（不带 `result` 字段），失败原因在 `errors` 里：① 建 agent 或发消息抛错；② 运行结束时错误块非空且一句正文都没产出（典型来源是模型不可用、鉴权被拒）。工具执行失败不算运行失败（记在 `tool_calls` 条目的 `success` 上），压缩历史失败、hook 报错这类可恢复错误也不算。
- **stdout 只有 JSON**：`--show-stats` 的统计、worktree 提示等诊断信息都写到 stderr，stdout 保持纯净。万一有非 JSON 内容漏到 stdout，会被改写到 stderr 并加上 `[stdout-guard]` 前缀，不打断管道。
- **只对打印模式生效**：不带 `-p` 给非 `text` 的 `--output-format` 会报错退出（交互模式的 stdout 是终端 UI）。
- **`usage` 是 OpenAI 口径**：`prompt_tokens` **已包含**缓存读取的 token（与 Anthropic 的 `input_tokens` 口径不同），也不输出费用字段。

---

## 8. 环境变量 {#environment-variables}

| 变量           | 默认值                 | 描述                                                                     |
| -------------- | ---------------------- | ------------------------------------------------------------------------ |
| `LOG_LEVEL`    | `INFO`                 | 日志级别：`DEBUG`、`INFO`、`WARN`、`ERROR`                               |
| `LOG_KEYWORDS` | -                      | 日志关键词过滤，仅输出包含指定关键词的日志                               |
| `LOG_FILE`     | `~/.wave/logs/cli.log` | 日志文件路径（桌面端/插件端分别为 desktop.log/vscode.log/jetbrains.log） |

## 9. CI 集成 {#ci}

把 Wave 跑进流水线：PR 提上来，job 装 CLI、执行一段提示词（例如 `/code-review`）、把结论写回 PR，并用退出码决定这个 check 是红还是绿。

整条链路仍然只是「在无人值守的机器上跑 CLI」：认证（三个环境变量）、权限预设（不卡在确认框）、结构化结果（`wave-result.json`）。命令行参数的含义见 [2. 命令行选项](#cli-options) 与 [7.17 结构化输出](#structured-output)。

### 9.1 跑起来是什么样 {#ci-overview}

GitHub 仓库加一个文件 `.github/workflows/review.yml`：

```yaml
name: Review

on:
  pull_request:

jobs:
  review:
    uses: netease-lcap/wave-agent/.github/workflows/wave-review.yml@main
    secrets: inherit
    permissions:
      contents: read
      pull-requests: write
    with:
      prompt: /code-review
```

`secrets: inherit` 要求仓库里已经有 `WAVE_API_KEY`（Settings → Secrets and variables → Actions）。

提一个 PR 后会发生三件事：

1. 内置的 `/code-review` 技能读本次改动，结论以 PR 评论的形式发出来；
2. job 的 Summary 里有一段「跑成什么样」的摘要，`wave-result.json` 作为 artifact 保留；
3. 运行失败时 job 变红（退出码 1），成功时变绿。

### 9.2 认证 {#ci-auth}

CI 里不用登录态，三个环境变量就够：

| 变量            | 必填 | 说明                                                     |
| --------------- | ---- | -------------------------------------------------------- |
| `WAVE_API_KEY`  | 是   | 模型服务的 API Key                                       |
| `WAVE_MODEL`    | 是   | 模型名，如 `deepseek-flash`。**CI 里没有本地配置可继承** |
| `WAVE_BASE_URL` | 否   | 模型网关地址，留空则用 CLI 默认                          |

三个变量都会进入 SDK 的配置解析链，与本地 `~/.wave/settings.json` 里的同名键等价；少给 `WAVE_MODEL` 时 CLI 会直接报 `Agent configuration requires model`。

放哪里：`WAVE_API_KEY` 是密钥，放平台的 secret 机制（GitHub：Settings → Secrets and variables → **Actions → Secrets**）；`WAVE_MODEL` 与 `WAVE_BASE_URL` 不是密钥，放**仓库变量**（同页 **Variables**）更省事，团队里一眼能看到用的是哪个模型。两者都不要写进仓库文件——`wave-result.json` 与 job 日志里都不含它们。

### 9.3 权限预设 {#ci-permissions}

CI 里没有人在旁边点「允许」，所以要用一套不需要交互就能跑完的权限组合。三个参数分工明确：

| 参数                        | 作用                                             | CI 里怎么给          |
| --------------------------- | ------------------------------------------------ | -------------------- |
| `--permission-mode dontAsk` | 未命中预批规则的受限工具**直接拒绝**，不等待输入 | 恒定用它             |
| `--tools`                   | 只注册列表里的工具，其它工具模型根本看不见       | 按任务收窄，见下表   |
| `--allowed-tools`           | 预批规则，如 `Bash(git status*)`                 | 只放开确实要跑的命令 |

三种常见任务的最小组合：

| 任务             | `--tools`             | `--allowed-tools`                               |
| ---------------- | --------------------- | ----------------------------------------------- |
| 只读审查         | `Read,Glob,Grep,Bash` | `Bash(git diff*),Bash(git log*)`                |
| 还要跑测试       | 上面 + 你的项目工具   | 上面 + `Bash(pnpm test*),Bash(pnpm -F * test*)` |
| 允许改文件并提交 | 上面 + `Edit,Write`   | 上面 + `Bash(git commit*),Bash(git push*)`      |

`dontAsk` 下被拒的工具不是报错退出：拒绝原因作为一次工具结果回到模型，模型会换路子继续完成任务。技能自己声明的 `allowed-tools`（`/code-review` 这类内置技能都带）在执行该技能时也会自动注册成临时规则，不必在 `allowed-tools` 里重复。

### 9.4 GitHub Actions：用现成的可复用 workflow {#ci-github-reusable}

`uses: netease-lcap/wave-agent/.github/workflows/wave-review.yml@<ref>`，`<ref>` 建议写 tag 或 commit，别跟 `main`。输入与输出：

| 输入              | 默认值                | 说明                                               |
| ----------------- | --------------------- | -------------------------------------------------- |
| `prompt`          | 必填                  | 传给 `wave -p` 的提示词，如 `/code-review`         |
| `wave-version`    | `latest`              | `wave-code` 版本；生产请 pin 具体版本              |
| `output-format`   | `json`                | `text` / `json` / `stream-json`                    |
| `permission-mode` | `dontAsk`             | 见上一节                                           |
| `tools`           | `Read,Glob,Grep,Bash` | 启用的工具，逗号分隔                               |
| `allowed-tools`   | 空                    | 预批规则，逗号分隔                                 |
| `base-url`        | 空                    | 模型网关地址；空则读调用方仓库变量 `WAVE_BASE_URL` |
| `model`           | 空                    | 模型名；空则读调用方仓库变量 `WAVE_MODEL`（必需）  |
| `timeout-minutes` | `20`                  | 整个 job 的超时；审查类提示词不建议小于 20         |

| 输出          | 说明                                 |
| ------------- | ------------------------------------ |
| `result`      | 最后一条助手消息的纯文本             |
| `subtype`     | `success` / `error_during_execution` |
| `is-error`    | `true` 表示这次运行失败              |
| `result-file` | 结果 JSON 在工作区里的路径           |

`model` / `base-url` 留空时会读**调用方仓库的 Variables**，所以绝大多数仓库只需要配一次 `WAVE_MODEL` 变量 + 一个 `WAVE_API_KEY` secret，调用方 `with:` 里只写 `prompt`。想写死也可以显式传 `with: { model: deepseek-flash }`。

用输出串联下游 job：

```yaml
jobs:
  review:
    uses: netease-lcap/wave-agent/.github/workflows/wave-review.yml@main
    secrets: inherit
    with:
      prompt: /code-review
  report:
    needs: review
    if: needs.review.outputs.is-error == 'false'
    runs-on: ubuntu-latest
    steps:
      - run: echo '${{ needs.review.outputs.result }}'
```

### 9.5 GitHub Actions：自己写一个 step {#ci-github-step}

不想依赖本仓库的 workflow，就让 job 自己装 CLI：

```yaml
name: Review

on:
  pull_request:

jobs:
  review:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0 # 审查要算 merge-base，浅克隆会退化成 HEAD~1
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      # 生产环境把 latest 换成具体版本：上游发版即改变流水线行为
      - run: npm i -g wave-code@latest
      - name: Review
        env:
          WAVE_API_KEY: ${{ secrets.WAVE_API_KEY }}
          WAVE_MODEL: ${{ vars.WAVE_MODEL }} # 如 deepseek-flash；CI 里没有本地配置可继承
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          wave -p '/code-review' \
            --output-format json \
            --permission-mode dontAsk \
            --tools 'Read,Glob,Grep,Bash' \
            > wave-result.json
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: wave-result
          path: wave-result.json
```

两处容易踩：

- **`fetch-depth: 0` 不能省**。内置审查技能用 `git merge-base HEAD main` 定位改动范围，浅克隆下算出的范围不是这个 PR。
- **本地没有 `main` 时会退化**。技能里那行是 `git merge-base HEAD main 2>/dev/null || echo HEAD~1`；`pull_request` 事件检出的是 PR 的 merge commit，`HEAD~1` 恰好落在 base 分支尖上、等于没评。要让审查按 base 分支算，先建本地分支：

  ```yaml
  - run: git fetch --no-tags origin "refs/heads/${GITHUB_BASE_REF}:refs/heads/${GITHUB_BASE_REF}"
  ```

`--allowed-tools` 在这里没给：`/code-review` 的 `allowed-tools` 已经包含 `git diff*` / `git log*` / `git show*` / `git merge-base*` / `gh pr view*`，执行技能时会自动注册成临时规则。换成自己的提示词时，才需要按 9.3 的表格补。

### 9.6 GitHub Actions：变成阻断合并的门禁 {#ci-github-required-check}

1. 跑通一次上面的 job；
2. 仓库 Settings → Branches → 分支保护规则 → Require status checks to pass，勾上这个 job 的名字；
3. 之后这个 check 变红时 PR 不可合并。

红绿来自 CLI 的退出码，判据见 9.8。

### 9.7 GitLab CI {#ci-gitlab}

把下面这段合进 `.gitlab-ci.yml`（或 `include` 指向 [ci/gitlab-ci.yml](https://github.com/netease-lcap/wave-agent/blob/main/ci/gitlab-ci.yml) 的 raw URL），并在 Settings → CI/CD → Variables 里加一个 masked 变量 `WAVE_API_KEY`：

```yaml
wave-review:
  image: node:22
  variables:
    WAVE_VERSION: "latest" # 生产请 pin 具体版本
    WAVE_PROMPT: "/code-review"
    WAVE_MODEL: "deepseek-flash"
    WAVE_TOOLS: "Read,Glob,Grep,Bash"
    GIT_DEPTH: "0"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - npm i -g "wave-code@${WAVE_VERSION}"
  script:
    - |
      set -uo pipefail
      status=0
      wave -p "$WAVE_PROMPT" \
        --output-format json \
        --permission-mode dontAsk \
        --tools "$WAVE_TOOLS" > wave-result.json || status=$?
      if [ -s wave-result.json ]; then
        node -e 'const r=require("./wave-result.json");console.log(r.subtype, r.result ?? "")'
      fi
      exit "$status"
  artifacts:
    when: always
    expire_in: 1 week
    paths:
      - wave-result.json
```

`GIT_DEPTH: "0"` 与 GitHub 侧的 `fetch-depth: 0` 同因；`node:22` 镜像里没有 `jq`，读结果用镜像自带的 `node -e`。

### 9.8 结果与产物 {#ci-result}

结果文件就是 `--output-format json` 的那一条信封，字段表见 [结构化输出](#structured-output)。CI 里最常用的是四个：

| 字段       | 用途                                 |
| ---------- | ------------------------------------ |
| `subtype`  | `success` / `error_during_execution` |
| `is_error` | 布尔，等同退出码的语义               |
| `result`   | 结论正文；失败版没有这个字段         |
| `errors`   | 失败原因，仅在非空时出现             |

退出码只看两件事，满足任一即为 `1`：建 agent 或发消息抛错；运行结束时错误块非空且一句正文都没产出。工具执行失败不算运行失败（记在 `tool_calls[].success` 上）。

### 9.9 局限 {#ci-limits}

- **fork 来的 PR 拿不到 secret**：GitHub 不把 `WAVE_API_KEY` 交给 fork PR 的 workflow，这类 PR 上 job 会失败。要么改用 `pull_request_target` 并只做只读操作，要么由维护者在评论里手动触发。
- **版本要 pin**：`wave-version` 默认 `latest`，上游发版即改变流水线行为。
- **一次运行没有记忆**：每个 job 都是新会话，上一轮审查的结论不会带到下一轮。
