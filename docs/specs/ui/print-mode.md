---
name: "Print 模式"
description: "`-p` 模式下 stdout 只有最终答案、运行过程一个字都不打印：抑制子代理内部信息、等待后台任务与收尾完成的退出语义，以及 `--output-format json` / `stream-json` 的结构化结果"
order: 110
---

# 功能规格说明：打印模式

**创建日期**：2026-06-09

## 用户场景与测试 _（必填）_

### 用户故事：干净的仅响应输出（优先级：P0）

作为运行 `wave -p 'message'` 的用户，我希望只看到主 agent 的响应文本，以便输出适合管道传递给其他命令和脚本。

**为什么是这个优先级**：这是打印模式的基本目的——机器可读的干净输出。没有它，`-p` 无法用于脚本。

**独立测试**：运行 `wave -p 'hi'` 并验证只有助手的最终答案文本被打印到 stdout，没有推理、工具行、子 agent 提示、文件列表或内部管理输出。

**验收场景**：

1. **假设**通过 `wave -p 'hi'` 的打印模式，**当** agent 响应时，**则**只有主 agent 的**最终答案**（最后一条助手消息的文本）被写入 stdout——推理、工具调用、错误块都不进 stdout。
2. **假设**打印模式，**当**主响应后自动记忆提取子 agent 运行时，**则**没有子 agent 输出（系统提示、文件清单、推理或内容）出现在 stdout 上。
3. **假设**打印模式，**当** agent 使用 Agent 工具时，**则**不打印子 agent 的用户消息或助手流式输出——stdout 上只有主 agent 的最终答案。

---

### 用户故事：流式进度指示器（优先级：P2）

作为在终端中运行 `wave -p` 的用户，我希望看到轻量级的进度指示器（推理、工具调用），以便我知道 agent 正在工作，即使子 agent 内部被抑制。

**为什么是这个优先级**：增强用户体验，但不是核心功能所必需的。

**独立测试**：运行 `wave -p 'do something complex'` 并验证推理标题、工具块名称和主 agent 的响应内容被显示。

**验收场景**：

1. **假设**打印模式带有复杂提示，**当**主 agent 在响应前推理时，**则**打印 `💭 Reasoning:` 标题后跟推理文本。
2. **假设**打印模式，**当**主 agent 调用工具时，**则**打印 `🔧 <tool_name> <compactParams>` 行。
3. **假设**打印模式，**当**错误块被添加时，**则**打印 `❌ Error: <message>` 行。

---

### 用户故事：与 Claude Code 行为兼容（优先级：P1）

作为从 Claude Code 迁移的用户，我希望 `wave -p` 的行为与 `claude -p` 一致，以便现有脚本和期望无需更改即可工作。

**为什么是这个优先级**：与参考实现的一致性确保平滑的迁移路径。

**独立测试**：比较 `claude -p 'hi'` 和 `wave -p 'hi'` 的输出——两者都应该只显示主 agent 的响应文本。

**验收场景**：

1. **假设** `claude -p` 和 `wave -p` 两者，**当**使用相同提示时，**则**两者都不打印子 agent 内部输出（用户消息、系统提示、文件清单）。
2. **假设**两个工具，**当**分叉/后台 agent（如记忆提取）运行时，**则**其输出完全静默——永远不会发送到 stdout。
3. **假设**两个工具，**当**常规 Agent 工具子 agent 运行时，**则**子 agent 的结果作为 tool_result 返回给主 agent 并纳入主 agent 的最终响应，不单独打印。
4. **假设**两个工具，**当**主 agent 推理、调用工具并给出答案时，**则** stdout 上都只有最后一条助手消息的文本（缺结尾换行则补一个换行），且推理与工具调用**在任何一条流上都不出现**——两者在「运行过程不打印」上完全一致。

---

### 用户故事：从 stdin 读入长 prompt（优先级：P1）

作为把整份文档 / 规格 / SKILL.md 交给 `wave -p` 做分析或改写的用户，我希望 prompt 能从 stdin 管道喂进来，而不是只能塞进命令行参数，以便绕开单参数 131072 字节（Linux `MAX_ARG_STRLEN`）的内核上限。

**为什么是这个优先级**：长 prompt 场景（评审一份文档、改进一个 SKILL.md 的 description）本来就要整份文件进 prompt，走 argv 一定撞 `E2BIG`，调用方只能自己加「prompt 不能超过 120KB」的护栏并给出可读错误；脚本化调用（CI、批量评测、文档处理）几乎都会碰到。这不是体验优化，是那条路根本走不通。

**独立测试**：`printf '只回复两个字：收到' | wave -p --output-format text` 与 `wave -p '只回复两个字：收到' --output-format text` 输出一致（都得到「收到」）；再用一个大于 200KB 的文件走 stdin，运行正常返回。

**验收场景**：

1. **假设** stdin 不是 TTY 且 `-p` 没给值，**当** 进入打印模式时，**则** stdin 的全部内容作为这一轮的 prompt。
2. **假设** stdin 不是 TTY 且 `-p` 给了值，**当** 运行时，**则** prompt 是「该值 + 换行 + stdin 内容」（对齐 `claude -p` 的 `[prompt, data].filter(Boolean).join('\n')`），stdin 内容不被静默丢弃。
3. **假设** stdin 是 TTY（交互终端里手敲 `wave -p 'hi'`），**当** 运行时，**则** 完全不读 stdin、不会等待输入，行为与改动前逐字节一致。
4. **假设** stdin 非 TTY 却一直没有数据到达、也没有结束（父进程继承了管道但没写），**当** 3 秒内没有任何数据时，**则** 停止等待、按「没有 stdin 输入」继续，并在 stderr 打一行提示；一旦收到第一块数据就不再计超时，一直等到流结束。
5. **假设** `-p` 无值且 stdin 立即结束（如 `< /dev/null`），**当** 拼接后仍为空时，**则** 报既有的 `Print mode requires a message` 并以退出码 1 结束。
6. **假设** 用户写 `wave -p -` 且 stdin 非 TTY，**当** 运行时，**则** `-` 作为正文文本参与拼接（与 `claude -p -` 一致），不做「`-` 即 stdin」的特判。
7. **假设** 一个超过 131072 字节的 prompt 走 stdin，**当** 运行时，**则** 正常运行，不受内核单参数上限约束。
8. **假设** `--output-format json` 或 `stream-json` 且 stdin 有内容，**当** 运行时，**则** 拼入的内容体现在这一轮的 `result` 里，stdout 仍是纯 JSON（第 4 条的提示走 stderr）。

---

### 用户故事：等待后台工作及主 agent 收尾完成后再退出（优先级：P0）

作为在打印模式下由主 agent 启动后台子 agent 的用户，我希望 `wave -p` 等待所有后台子 agent 完成、并且主 agent 处理完所有完成通知（产出最终响应）之后才退出，以便最终结果不会丢失。

**为什么是这个优先级**：后台子 agent 的结果必须通过主 agent 的收尾 turn 纳入最终响应；过早退出会销毁主 agent 进行中的 turn 并丢失结果，等同于功能不可用。

**独立测试**：运行 `wave -p` 让主 agent 以后台方式启动多个子 agent，验证所有子 agent 完成、主 agent 输出包含各子 agent 结果的最终响应后进程才退出。

**验收场景**：

1. **假设**打印模式下主 agent 启动多个后台子 agent 并结束当前 turn，**当**所有子 agent 陆续完成时，**则**主 agent 处理完全部完成通知并输出最终响应后进程才退出。
2. **假设**最后一个后台任务状态已变为完成、但主 agent 仍在处理通知的 turn 中（isLoading），**当**退出等待循环检查时，**则**不得退出也不得 destroy agent。
3. **假设**消息队列中仍有待处理的通知（主 agent 空闲但通知未消费），**当**退出等待循环检查时，**则**不得退出。
4. **假设**打印模式下启动单个后台子 agent，**当**子 agent 完成时，**则**主 agent 的收尾 turn 完整输出后才退出，不被 500ms 轮询窗口截断。

---

### 用户故事：结构化输出（优先级：P0）

作为在 CI 流水线里跑 `wave -p` 的用户，我希望能拿到机器可读的结果（最终文本、用量、工具调用序列、失败与否），以便按「发现数量 / 严重度」判定门禁，而不是正则解析带 emoji 的人读输出。

**为什么是这个优先级**：`-p` 的纯文本输出是给人看的，退出码只有 0/1，CI 里任何判定都只能靠脆弱的文本匹配；自动化流水线集成的所有后续能力（状态上报、审查门禁、质量报告）都依赖这一层。

**独立测试**：`wave -p '列出当前目录' --output-format json | jq -r '.result'` 得到助手响应的完整文本；把同一提示换成默认的 `--output-format text`，stdout 上是同一段文本（外加结尾换行），没有推理与工具行。

**验收场景**：

1. **假设** `--output-format json`，**当** 一次运行正常结束时，**则** stdout 上是**单条** JSON 对象，字段含 `type: "result"`、`subtype`、`is_error`、`result`（最后一次助手消息的纯文本）、`session_id`、`num_turns`、`duration_ms`、`usage`、`model_usage`、`tool_calls`，除此之外 stdout 上没有任何其他字符。
2. **假设** `--output-format json`，**当** 运行中出现可恢复的错误块（工具 hook 报错、压缩历史失败等），且主 agent 照常产出了正文时，**则** 该错误进入 `errors` 数组（仅非空时出现），`subtype` 仍为 `success`、`is_error` 为 `false`、退出码 0——可恢复错误不等于本次运行失败；工具执行失败同理，它记在 `tool_calls` 条目的 `success` 上。
3. **假设** `--output-format json`，**当** 运行本身失败（建 agent 或发送消息抛错）时，**则** stdout 上仍输出一条 `subtype: "error_during_execution"`、`is_error: true` 的 result 对象——**不带 `result` 字段**，失败原因放在必填的 `errors` 里（与 Claude Code 的错误版一致），进程退出码为 1。
4. **假设** 任一格式，**当** 运行结束时错误块非空、且主 agent **一句话正文都没产出**（典型来源：模型不可用、鉴权被拒——这类请求级错误不抛出，只落一个错误块）时，**则** 判为运行失败：`subtype: "error_during_execution"`、`is_error: true`、退出码 1（纯文本模式同样按此退出码收尾）。
5. **假设** `--output-format stream-json`，**当** 运行时，**则** stdout 每行一个 JSON 事件，首行为 `system/init`（含 `session_id`、`model`、`cwd`、`permission_mode`、`tools`），其后按发生顺序是 `assistant/reasoning_delta`、`assistant/content_delta`、`tool/start`、`tool/end`、`error`，最后一行为与场景 1 结构相同的 `result` 事件。
6. **假设** `--output-format stream-json`，**当** 建 agent 阶段已经写出了一个事件（真机路径：`-r` 给了非法 session id，初始化在抛错前先落一个错误块）时，**则** 该事件不抢先写出——agent 建成功时它被押后到 `system/init` 之后、`system/init` 仍是首行；建 agent 直接失败、根本拿不到 `session_id` / `model` 时，流里没有 `system/init`，先出该事件、末行是 `result`。消费方不得把「读到 init」当作流已开始的唯一判据。
7. **假设** `--output-format stream-json`，**当** 流式内容到达时，**则** 文本事件携带的是**增量**（delta），不是累积快照，消费方拼接即得完整文本。
8. **假设** 任一结构化格式，**当** 进程退出时，**则** stdout 上已排队的 JSON 全部写完（管道消费方不会读到截断的末行）。
9. **假设** 任一结构化格式，**当** 有代码往 stdout 写了非 JSON 的行（依赖库的 `console.log`、遗漏的调试输出）时，**则** 该行被转到 stderr 并带标记前缀，stdout 上的 NDJSON 流不被打断。
10. **假设** 不指定 `--output-format`（默认 `text`），**当** 一次运行正常结束时，**则** stdout 上只有**最后一条助手消息的文本**（不以换行结尾时补一个换行），除此之外没有任何字符。运行过程（推理、`💭 Reasoning:` / `📝 Response:` 标题、`🔧` 工具行）在任何一条流上都不打印；诊断（`❌` 错误行、worktree 提示、告警）与 `--show-stats` 汇总写 stderr。空响应时 stdout 上只有一个换行。
11. **假设** text 模式，**当** 运行被判为失败（`is_error`：运行抛错，或错误块非空且主 agent 一句话正文都没产出）时，**则** stdout 上是 `Execution error`（逐字抄 Claude Code，**不带**结尾换行——它只在成功分支补换行），不输出任何模型文本，退出码 1；失败原因（错误块原文）写在 stderr。
12. **假设** text 模式，**当** 这次运行根本没起来（加载期失败：`-r` 给了非法或不存在的 session、恢复会话抛错、建 agent 抛错）时，**则** stdout 上**一个字节都不写**，原因写 stderr，退出码 1——对齐 Claude Code 的 `emitLoadError`（它的加载期失败同样不写 stdout）。结构化格式不受影响：它们照旧写一条 result 事件，因为 stdout 必须保持可解析。
13. **假设** 任一格式搭配 `--show-stats`，**当** 运行时，**则** 用量汇总与耗时写到 **stderr**（结构化格式下 stdout 保持纯 JSON，text 模式下 stdout 保持只有最终答案）。
14. **假设** 交互模式（没有 `-p`）下给了 `--output-format`，**当** 解析参数时，**则** 报错并以退出码 1 结束（该选项只对打印模式有意义）。

---

### 边界情况

- **主 agent 的响应为空怎么办？** stdout 上只有一个换行符；结构化模式下 `result` 为空字符串。
- **text 模式的失败为什么分两种 stdout？** 因为参照物分两种：运行起来之后失败（`error_during_execution`）它写 `Execution error`，运行根本没起来（加载期失败）它一个字节都不写、原因走 stderr。消费方据此能区分「跑过但错了」与「没跑起来」。
- **text 模式为什么不输出推理与工具行？** 对齐 Claude Code：它的 print 模式既不写 stdout 也不写 stderr，`text` 的语义就是「最终答案本身」。过程信息不是丢了而是**改成按需索取**：`--output-format stream-json` 会给出 `assistant/reasoning_delta`、`tool/start`、`tool/end` 事件，`json` 的 `tool_calls` 给出调用序列。运行期间终端上没有进度显示是这一口径的直接代价。
- **text 模式也装 stdout 守卫吗？** 不装（与 Claude Code 一致）：最终答案本身就是纯文本，没有「像不像 JSON」可用来区分它与脏行。stdout 的纯净由写点纪律保证——CLI 侧日志写 logger 文件，代码里不往 stdout 打 `console.log`。
- **stdout 是一次性写出的吗？** 是。text 模式在运行期间 stdout 完全静默，结束时一次性写出最终答案（或 `Execution error`），所以 `wave -p | head -1` 这类消费方拿到的一定是完整答案而不是半截流。
- **子 agent 出错怎么办？** 错误作为 tool_result 传播到主 agent；主 agent 决定如何在其响应中报告。不直接打印子 agent 错误。
- **并发子 agent 怎么办？** 无论并发如何，所有子 agent 输出都被抑制。
- **如果自动记忆提取在打印模式等待后台工作时运行怎么办？** `hasRunningBackgroundWork` 循环等待它，但不打印提取输出。
- **多个后台子 agent 错峰完成怎么办？** 等待条件必须覆盖主 agent 处理通知的收尾 turn 与队列中未消费的通知，最后一个子 agent 完成不得触发提前退出。
- **一次运行里有多次助手消息怎么办？** `result` 与 text 模式的 stdout 都取**最后**一条助手消息的文本（同源），`num_turns` 记录主 agent 的助手消息条数；被作废（流式降级）的半截消息不计入。
- **子 agent 的输出会进 JSON 吗？** 不会——与纯文本模式同一口径，只收主 agent 的推理/内容/工具调用。
- **`tool_calls` 里带工具输出吗？** 不带，只有 `{id, name, input, success, error?}`；完整输出在会话 transcript 里（stdout 不能被一次 `Read` 撑爆）。
- **工具参数不是合法 JSON 怎么办？** `input` 保留原始字符串。
- **结构化格式下 worktree 保留/删除提示怎么写？** 走 stderr，不进 stdout。
- **与 Claude Code 的 JSON 字段完全一致吗？** 信封骨架对齐（`type` / `subtype` / `is_error` / `result` / `session_id` / `duration_ms` / `num_turns` / 错误版用 `errors` 而不带 `result`），**数值口径不对齐**：`usage` 沿用本项目的 `prompt_tokens` / `completion_tokens` / `total_tokens`（OpenAI 口径，`prompt_tokens` **已含** cache_read），不等于 CC 的 `input_tokens`（不含 cache）；`total_cost_usd` 与 `modelUsage.costUSD` 我们没有价目表，**不输出**，也不填 0 假装有值。
- **stream-json 的中间事件与 CC 同构吗？** 不同构。CC 发的是 Anthropic 消息本体（`assistant` / `user` 包 `BetaMessage`、工具调用在 content block 里），我们的数据源是 SDK 回调而非 SSE 事件流，伪造那层结构会得到永远填不满的字段。只对齐两头：首事件 `system/init` 与末事件 `result`。
- **stdin 读进来要 trim 吗？** 不 trim，按 utf8 原样解码后拼接；只判「拼接后 `trim()` 为空」＝视同没给 prompt（沿用既有空校验口径，所以纯空白 stdin 也算没有输入，与 CC 的 `filter(Boolean)` 略有差异）。
- **读 stdin 只影响打印模式吗？** 是。`--stdio` / daemon / 交互模式各有自己的 stdin 语义，不受影响。
