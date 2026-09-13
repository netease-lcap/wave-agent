# 工具目录代理 · 准入门槛验证脚手架（PR-1）

验证 spec `docs/specs/core/tool-catalog-proxy.md` 的前提问题：

> 模型仅凭**紧凑签名**（目录条目）构造的参数，能否被真实 MCP 服务器接受？

**本目录不含任何产品代码改动**，全部是测试与脚手架。产品接线（`resolveFilteredTools` 切分、`ToolInvoke` 派发、预算/截断、`ToolSearch`）见技术方案，不在本目录。

## 两个组

| 组                | 工具暴露方式                                                            | 叶子调用路径                                |
| ----------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| `flat`（对照）    | 三个工具按今天的形态**逐条声明**（完整 JSON Schema）                    | SDK 自己的 `McpManager` → 我们的严格 server |
| `catalog`（实验） | 同样三个工具只作为目录条目出现在**一个 `ToolInvoke`** 的 description 里 | 探针自带的极简 MCP 客户端 → 同一个 server   |

`catalog` 组用 `AgentOptions.customTools` 注入 `ToolInvoke`，用 `AgentOptions.disallowedTools` 把叶子工具从「已声明集合」中移除（**deny 只作用于声明**，因为叶子调用不经过 SDK 的 MCP 层）。这样做的原因见「保真度欠账」。

## 运行

```bash
# 自检（验证器 / 目录渲染 / server 协议）
pnpm exec tsx scripts/catalog-proxy-probe/selftest.mjs

# 准入门槛：3 档复杂度 × 20 次 × 2 轮 × 2 组 = 240 轮
pnpm exec tsx scripts/catalog-proxy-probe/probe.mjs \
  --groups flat,catalog --rounds 2 --trials 20 --concurrency 6 --lang en --tag r1-en

# 汇总（含失败类型分布与失败样例原始参数）
node scripts/catalog-proxy-probe/analyze.mjs --outDir /tmp/catalog-proxy-probe-results --tag r1-en

# 目录体积（token 口径、中英对比、截断触发点、描述裁剪）
pnpm exec tsx scripts/catalog-proxy-probe/measure-tokens.mjs --outDir /tmp/catalog-proxy-probe-results

# 消融臂（删掉签名，证明签名承载信息）
pnpm exec tsx scripts/catalog-proxy-probe/probe.mjs \
  --groups catalog --rounds 1 --trials 10 --concurrency 6 --lang en \
  --signature none --tag ablate-nosig

# 退化形态（args 以 JSON 字符串携带）
pnpm exec tsx scripts/catalog-proxy-probe/probe.mjs \
  --groups catalog --rounds 1 --trials 10 --concurrency 6 --lang en \
  --argsMode json-string --tag degrade-jsonstr
```

`probe.mjs` 需要 `WAVE_API_KEY` / `WAVE_BASE_URL` / `WAVE_MODEL`（会用 `HOME` 指向输出目录下的隔离 profile，不碰真实 `~/.wave`）。产物默认写 `/tmp/catalog-proxy-probe-results/`：`runs-*.jsonl`（每轮）、`server-calls-*.jsonl`（每次叶子调用，由 server 写）、`analysis-*.json`、`catalog-size.json`。

## 文件

- `schemas.mjs` — 三档工具 schema（简单/中等/复杂）、严格校验器（唯一真源：server 用它做判定，目录渲染器用它生成签名）、任务语句、`toOpenAITool`。
- `server.mjs` — 零依赖的 stdio MCP server（`initialize` / `tools/list` / `tools/call`），严格校验并把每次调用结果写 JSONL。
- `catalog.mjs` — 紧凑签名渲染、token 预算截断（含 `COMPLETE` / `PARTIAL - X of Y shown`、每 namespace ≥1 行）、描述按 token 裁剪、造合成工具找截断点。
- `mcpClient.mjs` — 极简 MCP stdio 客户端（探针自己在 `catalog` 组调用叶子用）。
- `probe.mjs` / `analyze.mjs` / `measure-tokens.mjs` / `selftest.mjs`。
- `RESULTS.md` — **PR-1 结论**（成功率、失败分类、消融判别力、token 体积、预算建议、spec 缺口）。`results/*.json` 是它的证据（4 份 `analysis-*.json` + `catalog-size.json`）。

## 失败类型分类（判定口径）

判定方是 **server**，不是模型：一次调用只有「server 接受」才算成功。

| 分类               | 含义                                                           |
| ------------------ | -------------------------------------------------------------- |
| `OK`               | 首次叶子调用被 server 接受                                     |
| `MISSING_REQUIRED` | 缺必填                                                         |
| `TYPE_MISMATCH`    | 类型错（含越界、minLength）                                    |
| `ENUM_INVALID`     | 枚举越界                                                       |
| `NESTED_STRUCTURE` | 嵌套结构错（数组长度越界、嵌套容器种类不符）                   |
| `UNKNOWN_FIELD`    | 多余字段                                                       |
| `OTHER`            | 参数不可解析 / 未调用目标工具 / 调错工具 / 超时 / 基础设施错误 |

`analyze.mjs` 同时给出「首次成功率」与「重试后成功率」，并把失败样例的**原始参数**打出来，用于区分「模型没看懂签名」与「签名本身丢了信息」。

## 保真度欠账（必须随结论一起读）

1. **`catalog` 组的叶子调用不走 `mcpManager.executeMcpTool`**：因为叶子工具在该组被 deny（用来模拟「已连接但未声明」），deny 会让 SDK 的执行路径一并拒绝。叶子调用改由探针自己的极简客户端发到**同一个 server**，参数校验语义完全一致，因此「参数能否被接受」这个问题不受影响；受影响的是「生产派发路径」这一点，它由 PR-3 的集成测试覆盖。
2. **`flat` 组走完整生产链路**（SDK 循环 + SDK MCP 客户端），是本实验的真对照。
3. **目录渲染器是本目录的一次性实现**（PR-2 会用正式模块替换）：签名规则 = 类型 + 必填/可选 + 枚举值 + 默认值 + 两级嵌套展开。渲染越保守（信息越多），结论越强；`maxDepth` 是可直接调的旋钮。
4. **`prompt()` 动态描述不参与目录**：目录条目只取静态 description（见 spec 缺口记录）。
