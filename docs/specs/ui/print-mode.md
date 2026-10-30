---
name: "Print 模式"
description: "`-p` 模式下仅输出主 agent 响应的干净输出：抑制子代理内部信息、等待后台任务与收尾完成的退出语义，以及 `--output-format json` / `stream-json` 的结构化结果"
order: 110
---

# 功能规格说明：打印模式

**创建日期**：2026-06-09

## 用户场景与测试 _（必填）_

### 用户故事：干净的仅响应输出（优先级：P0）

作为运行 `wave -p 'message'` 的用户，我希望只看到主 agent 的响应文本，以便输出适合管道传递给其他命令和脚本。

**为什么是这个优先级**：这是打印模式的基本目的——机器可读的干净输出。没有它，`-p` 无法用于脚本。

**独立测试**：运行 `wave -p 'hi'` 并验证只有助手的响应文本被打印到 stdout，没有子 agent 提示、文件列表或内部管理输出。

**验收场景**：

1. **假设**通过 `wave -p 'hi'` 的打印模式，**当** agent 响应时，**则**只有主 agent 的内容被写入 stdout。
2. **假设**打印模式，**当**主响应后自动记忆提取子 agent 运行时，**则**没有子 agent 输出（系统提示、文件清单、推理或内容）出现在 stdout 上。
3. **假设**打印模式，**当** agent 使用 Agent 工具时，**则**不打印子 agent 的用户消息或助手流式输出——只有主 agent 的工具块指示器和最终响应。

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

**独立测试**：`wave -p '列出当前目录' --output-format json | jq -r '.result'` 得到助手响应的完整文本；把同一提示换成 `--output-format text`，输出与改动前逐字节一致。

**验收场景**：

1. **假设** `--output-format json`，**当** 一次运行正常结束时，**则** stdout 上是**单条** JSON 对象，字段含 `type: "result"`、`subtype`、`is_error`、`result`（最后一次助手消息的纯文本）、`session_id`、`num_turns`、`duration_ms`、`usage`、`model_usage`、`tool_calls`，除此之外 stdout 上没有任何其他字符。
2. **假设** `--output-format json`，**当** 运行中出现可恢复的错误块（工具 hook 报错、压缩历史失败等），且主 agent 照常产出了正文时，**则** 该错误进入 `errors` 数组（仅非空时出现），`subtype` 仍为 `success`、`is_error` 为 `false`、退出码 0——可恢复错误不等于本次运行失败；工具执行失败同理，它记在 `tool_calls` 条目的 `success` 上。
3. **假设** `--output-format json`，**当** 运行本身失败（建 agent 或发送消息抛错）时，**则** stdout 上仍输出一条 `subtype: "error_during_execution"`、`is_error: true` 的 result 对象——**不带 `result` 字段**，失败原因放在必填的 `errors` 里（与 Claude Code 的错误版一致），进程退出码为 1。
4. **假设** 任一格式，**当** 运行结束时错误块非空、且主 agent **一句话正文都没产出**（典型来源：模型不可用、鉴权被拒——这类请求级错误不抛出，只落一个错误块）时，**则** 判为运行失败：`subtype: "error_during_execution"`、`is_error: true`、退出码 1（纯文本模式同样按此退出码收尾）。
5. **假设** `--output-format stream-json`，**当** 运行时，**则** stdout 每行一个 JSON 事件，首行为 `system/init`（含 `session_id`、`model`、`cwd`、`permission_mode`、`tools`），其后按发生顺序是 `assistant/reasoning_delta`、`assistant/content_delta`、`tool/start`、`tool/end`、`error`，最后一行为与场景 1 结构相同的 `result` 事件。
6. **假设** `--output-format stream-json`，**当** 流式内容到达时，**则** 文本事件携带的是**增量**（delta），不是累积快照，消费方拼接即得完整文本。
7. **假设** 任一结构化格式，**当** 进程退出时，**则** stdout 上已排队的 JSON 全部写完（管道消费方不会读到截断的末行）。
8. **假设** 任一结构化格式，**当** 有代码往 stdout 写了非 JSON 的行（依赖库的 `console.log`、遗漏的调试输出）时，**则** 该行被转到 stderr 并带标记前缀，stdout 上的 NDJSON 流不被打断。
9. **假设** 不指定 `--output-format`（默认 `text`），**当** 运行时，**则** 输出与既有纯文本行为完全一致：推理/响应标题、`🔧` 工具行、`❌` 错误行、`--show-stats` 的用量与耗时汇总都照旧写在 stdout。
10. **假设** 结构化格式搭配 `--show-stats`，**当** 运行时，**则** 用量汇总与耗时写到 **stderr**，stdout 保持纯 JSON。
11. **假设** 交互模式（没有 `-p`）下给了 `--output-format`，**当** 解析参数时，**则** 报错并以退出码 1 结束（该选项只对打印模式有意义）。

---

### 边界情况

- **主 agent 的响应为空怎么办？** 仅打印一个换行符；结构化模式下 `result` 为空字符串。
- **子 agent 出错怎么办？** 错误作为 tool_result 传播到主 agent；主 agent 决定如何在其响应中报告。不直接打印子 agent 错误。
- **并发子 agent 怎么办？** 无论并发如何，所有子 agent 输出都被抑制。
- **如果自动记忆提取在打印模式等待后台工作时运行怎么办？** `hasRunningBackgroundWork` 循环等待它，但不打印提取输出。
- **多个后台子 agent 错峰完成怎么办？** 等待条件必须覆盖主 agent 处理通知的收尾 turn 与队列中未消费的通知，最后一个子 agent 完成不得触发提前退出。
- **一次运行里有多次助手消息怎么办？** `result` 取**最后**一条助手消息的文本，`num_turns` 记录主 agent 的助手消息条数；被作废（流式降级）的半截消息不计入。
- **子 agent 的输出会进 JSON 吗？** 不会——与纯文本模式同一口径，只收主 agent 的推理/内容/工具调用。
- **`tool_calls` 里带工具输出吗？** 不带，只有 `{id, name, input, success, error?}`；完整输出在会话 transcript 里（stdout 不能被一次 `Read` 撑爆）。
- **工具参数不是合法 JSON 怎么办？** `input` 保留原始字符串。
- **结构化格式下 worktree 保留/删除提示怎么写？** 走 stderr，不进 stdout。
- **与 Claude Code 的 JSON 字段完全一致吗？** 信封骨架对齐（`type` / `subtype` / `is_error` / `result` / `session_id` / `duration_ms` / `num_turns` / 错误版用 `errors` 而不带 `result`），**数值口径不对齐**：`usage` 沿用本项目的 `prompt_tokens` / `completion_tokens` / `total_tokens`（OpenAI 口径，`prompt_tokens` **已含** cache_read），不等于 CC 的 `input_tokens`（不含 cache）；`total_cost_usd` 与 `modelUsage.costUSD` 我们没有价目表，**不输出**，也不填 0 假装有值。
- **stream-json 的中间事件与 CC 同构吗？** 不同构。CC 发的是 Anthropic 消息本体（`assistant` / `user` 包 `BetaMessage`、工具调用在 content block 里），我们的数据源是 SDK 回调而非 SSE 事件流，伪造那层结构会得到永远填不满的字段。只对齐两头：首事件 `system/init` 与末事件 `result`。
