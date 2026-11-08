---
name: "Anthropic Messages API 传输"
description: "按 models.<name>.capabilities.apiType 逐模型选择端点：新增 messages 取值走原生 Anthropic Messages，思考块 signature 全链路回传、tool_use/tool_result 原生结构、cache_control 原生打点，让 Claude 模型不再因 OpenAI 兼容层压平思考块而丢推理连续性"
order: 86
---

# 功能规格说明：Anthropic Messages API 传输

**创建日期**：2026-11-07

## 用户场景与测试 _（必填）_

### 用户故事：按声明为 Claude 模型选择原生 Messages 端点（优先级：P1）

作为要在 Claude 模型上使用思考 + 工具调用的用户，我希望在 `settings.json` 里为某个模型把 `capabilities.apiType` 声明为 `"messages"`，Wave 就对这个模型的请求改用原生 Anthropic Messages 端点——否则思考块在 OpenAI 兼容层被压成一段纯文本 `reasoning_content`，`signature` 字段根本不出现在响应里，多轮工具调用时上游收不到可验证的思考块。

**为什么是这个优先级**：这是本功能的全部前提。Anthropic 的扩展思考要求**带 `signature` 的 thinking 块原样回传**（服务端用它校验思考确由该模型产出），而 OpenAI 兼容层没有承载这个结构的字段：实测线上网关对 Claude 的响应只给 `reasoning_content` 字符串，把 `signature` 塞进任何自定义字段（`thinking[]`、`reasoning_details[]`、顶层 `signature`）都会被静默丢弃。压缩成文本后上游只能把上一轮思考当普通 assistant 正文看，推理连续性丢失——这不是参数能调好的，只能换协议。

**独立测试**：用 `capabilities.apiType: "messages"` 的模型配置发起一次带工具的 agent 调用，断言请求打到 `${baseURL}/messages` 且请求体是 Anthropic 形状（顶层 `system`、`tools[].input_schema`、assistant 的 `thinking`/`tool_use` 块）；把声明去掉或改成 `"chat"`，断言请求仍打到 Chat Completions 且请求体与今天逐字段一致。

**验收场景**：

1. **假设** `models["<name>"].capabilities.apiType` 为 `"messages"`，**当** agent 主循环发起一轮带工具的请求，**则**该请求走 Messages 端点（`POST ${baseURL}/messages`），请求体为 Anthropic 形状
2. **假设**模型的 `apiType` 未声明或为 `"chat"`（默认），**当** agent 发起请求时，**则**行为与今天完全一致：走 Chat Completions，请求体不新增任何字段
3. **假设**该请求由子代理走 `fastModel` / `visionModel`（子代理有自己的模型配置），或走内联补全 / next-edit / 网页内容处理（读 `completionModelCapabilities` / `fastModelCapabilities`），**当**它与主模型的 `apiType` 不同时，**则**按**该请求实际使用的模型**的 `apiType` 选择端点
4. **假设**仓库里不存在任何模型名清单、正则或内置默认表，**当**用户把一个新模型写进 `models` 并声明 `apiType: "messages"` 时，**则**无需升级 Wave 即可使用
5. **假设** `apiType` 被写成枚举之外的值（拼错、空串、`true`），**当**选择端点时，**则**按 `"chat"` 处理并记一条 warn——不静默当没事、也不猜用户想要哪个协议
6. **假设**声明了 `apiType: "messages"` 的模型请求返回错误，**当**该错误上抛给用户时，**则**错误文案保留服务端原文，且**不会**静默改用 Chat Completions 重试（一次请求只打一个端点；静默回落等于又丢一次思考块）

---

### 用户故事：思考块的 signature 全链路保住（优先级：P1）

作为使用扩展思考的用户，我希望模型产出的思考块连同它的 `signature` 一起被保存下来，并在下一轮请求里原样送回——这样多轮工具调用期间模型的推理不会被重置，恢复历史会话后也照样接得上。

**为什么是这个优先级**：这正是本功能要解决的那个问题本身。三条链路都必须成立，缺一条就等于没做：

- **收**：流式响应里 `signature` 是单独一个 `signature_delta` 到达的（在 `content_block_delta` 里，紧贴该块 `content_block_stop` 之前），正文与签名分开到齐
- **存**：签名要随消息一起落到会话转录，会话恢复后仍在
- **送**：回传时思考块必须是 `{type:"thinking", thinking, signature}` 原样结构，且**只能**用原始签名——服务端会拒绝被改写或缺失的签名

**为什么签名不进流式回调**：签名不展示、不参与增量渲染，只在轮次结束时附着到思考块上。因此它走「轮次结束时回填」这一条路（与 `additionalFields` 同性质），不新增 `onReasoningSignature` 一类的流式通道——否则这条链要横穿 aiService → aiManager → messageManager → stdio 协议 → 四个宿主 → webview，为一个不显示的字段付出整条链的改动与测试。

**独立测试**：投喂一段带 `thinking_delta` + `signature_delta` 的录制事件流，断言思考块内容与签名都落到了消息上并写进转录文件；重新加载该会话，再发起下一轮，断言请求体里出现带同一签名原文的 `thinking` 块。再把签名挖掉跑一遍，断言该思考块**不作为** `thinking` 块发出。

**验收场景**：

1. **假设**流里先收到若干 `thinking_delta`、随后收到该块的 `signature_delta`，**则**思考文本照常逐字上屏（与今天的思考块渲染完全一致），签名在该块结束时就位
2. **假设**一轮响应结束，**则**该轮的思考块带上 `signature` 写入消息；转录落盘后重新加载会话，**则**签名仍在（`blocks` 原样序列化，无需额外持久化通道）
3. **假设**回传历史，**则**带签名的思考块发成 `{type:"thinking", thinking, signature}`，正文与签名一个字节都不改
4. **假设**某个思考块**没有**签名（轮次被中断、流在签名到达前断掉、或历史上来自其它协议），**则**它**不能**发成 `thinking` 块（上游会拒绝），按既有「只有 reasoning 也算有响应」的兜底把它留在正文说明里
5. **假设**响应里出现 `redacted_thinking` 块（内容加密、`data` 不透明），**则**原样保存并在回传时原样送回，`data` 不解码、不改写；该块**不**渲染思考内容——它不存在成一个内容为空的 `reasoning` 块（那会让界面多出一行空的「思考」标题），而是存在消息的 `redactedThinking` 上，只在组请求体时拼回 `anthropic_thinking`
6. **假设**同一个 assistant 轮次里出现过多次思考（思考 → tool_use → 继续思考 → tool_use），**则**回传的是「该轮全部 `thinking` 块按产出顺序 → 正文 → `tool_use`」，思考块之间不合并；**但**思考与工具调用的**原始交错位置不保真**——内部消息模型每轮只有一个 `reasoning` 块（既有行为），压平后的 `ChatCompletionMessageParam[]` 不记录块间交错，而 Anthropic 允许 `thinking` 块排在正文与 `tool_use` 之前，故按此顺序回传仍然合法。要保真必须改内部消息模型，不在本规格范围
7. **假设**一轮里出现多个思考块，**则**每个块各自带自己的签名，不共享、不拼接；轮次结束时按各块正文把合并后的 `reasoning` 块切回原来的块数（切不开时放弃附着签名，见边界情况 5）

---

### 用户故事：请求结构的原生翻译（优先级：P1）

作为走 Messages 端点的用户，我希望 Wave 把现有配置里的系统提示、生成参数、工具声明、图片和已发生的工具调用历史翻译成 Anthropic 形状，这样 `models.<name>.options` 里现有的写法继续可用、工具调用能连续多轮；同时我写在 `options` 里的其它字段仍然原样发出，不被 Wave 过滤或改写。

**为什么是这个优先级**：形状不对就是 400。但这一层比 Responses 那层**更省事**，因为三处正好同形：`thinking` 就是 `{type:"enabled", budget_tokens}`、`cache_control` 就是 Anthropic 原生的 `{type:"ephemeral"}`（我们现在就靠在 OpenAI content part 上挂它透传给网关）、工具结果本来就按 `tool_use_id` 配对。真正要新写的是消息与工具的容器形状。

**独立测试**：构造含系统提示、图片输入、工具声明、一轮已完成的「assistant 思考 + tool_use + 工具结果」历史，发起一次 Messages 请求，逐字段断言请求体符合下表；并断言 `options` 里一个未映射的键（如 `seed`）在请求体里**原样存在**。

| 现有配置（Chat Completions 形状）                       | Messages 形状                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| system 消息 / `SystemPromptBlock[]`                     | 顶层 `system`（text block 数组，可带 `cache_control`）                  |
| `messages`                                              | `messages`（只含 `user` / `assistant`，相邻同角色合并）                 |
| `max_tokens`                                            | `max_tokens`（必填，同名同值）                                          |
| `thinking`                                              | **原样**（`{type:"enabled", budget_tokens}` 就是原生形状）              |
| `options` 里的 `cache_control` 标记                     | **原样**（挂在 text block 上）                                          |
| `tools[].function.{name,description,parameters,strict}` | `tools[].{name,description,input_schema}`（`strict` 不进请求）          |
| `tool_choice` 具名工具                                  | `{type:"tool", name}`                                                   |
| `tool_choice: "required"`                               | `{type:"any"}`                                                          |
| `tool_choice: "auto"` / `"none"`                        | `{type:"auto"}` / `{type:"none"}`                                       |
| assistant `reasoning` 块（带签名）                      | `{type:"thinking", thinking, signature}`                                |
| assistant `tool_calls[]`                                | `{type:"tool_use", id, name, input}`（`arguments` 解析进 `input`）      |
| `role:"tool"` 消息                                      | `{type:"tool_result", tool_use_id, content}`，放进 **user** turn 的最前 |
| 图片 content part                                       | `{type:"image", source:{type:"base64", …}}` 或 `{type:"url", url}`      |
| **其它所有 `options` 键**                               | **原样透传**（Wave 不增删、不改名、不判合法性）                         |

**验收场景**：

1. **假设**系统提示是分块 `SystemPromptBlock[]`，**当**发起 Messages 请求时，**则**它们按顺序成为顶层 `system` 数组的 text block，**不**出现在 `messages` 里
2. **假设**同一模型声明了 `promptCaching: true`，**当**发起请求时，**则**可缓存块与「最后一条有内容的 user/assistant」照既有规则带 `cache_control: {type:"ephemeral"}`，打点位置与今天等价（工具不打标，与现状一致）
3. **假设** `options` 里有 `reasoning_effort`（OpenAI 口径、Anthropic 无对应物），**当**走 Messages 时，**则**键与值原样发出，Wave 不擅自翻译成 `thinking.budget_tokens`；配错由服务端 400 直接反馈
4. **假设**一轮响应同时产出正文、思考与多个 `tool_use` 块，**当**回传历史时，**则**按块顺序还原成 `text` / `thinking` / `tool_use` 序列，`tool_use.id` 与工具结果配对
5. **假设**历史里有工具结果，**当**组装请求时，**则**所有 `tool_result` 块合成**一条独立的 user turn**，紧跟产生这些 `tool_use` 的 assistant turn、并排在 content 数组最前（其后才允许出现同轮的用户文本与图片）；它**不**等到下一次真实用户消息才落地——工具循环里工具结果后面跟的是模型的下一轮回复（assistant），推迟过去会把 `tool_use` 之后塞进 `text`、并把两条 assistant 粘成一条（2026-11-07 云信网关实测到的错误形状），模型因此看不到工具往返
6. **假设**历史里出现连续两条 `user`（例如工具结果轮 + 用户插话）或连续两条 `assistant`，**当**组装请求时，**则**同角色相邻消息合并为一条——Anthropic 不接受同角色连续出现，而 Wave 的内部消息序列会产出这种排列
7. **假设**用户消息含图片，**当**走 Messages 时，**则**本地路径读成 base64 的 `image` 块、URL 发成 `url` source；非视觉模型剥离图片的既有行为不变
8. **假设**生效的输出上限来自 `max_tokens`（Wave 恒有默认值），**当**走 Messages 时，**则**照发该数值；**假设**它不大于思考预算 `thinking.budget_tokens`，**则**属于用户配置错误，原样发出由服务端拒绝，Wave 不猜一个更大的值
9. **假设** `options` 里有上表未列出的键（`seed`、`top_k`、`stop_sequences`、或用户自己写的 Anthropic 形状字段），**当**走 Messages 时，**则**该键连同其值原样出现在请求体里
10. **假设**强制具名 `tool_choice` 与生效的扩展思考同时出现，**当**发起请求时，**则**沿用既有降级规则把强制选择降为 `auto` 并记 warn（Anthropic 同样不允许两者并存）

---

### 用户故事：响应解析与用量口径（优先级：P1）

作为用户，我希望 Messages 返回的结果被解析成与 Chat Completions 等价的东西——正文、思考内容、工具调用、结束原因、token 用量——这样消息渲染、工具执行、上下文占用、错误处理都不需要为新端点分叉。

**为什么是这个优先级**：端点换了但下游语义不变是这个设计成立的关键。`finish_reason` 与 usage 口径一旦不一致，自动续写、上下文百分比、缓存 token 统计都会静默错乱。

**独立测试**：用固定的 Messages 事件流（正文 + 思考 + 两个 `tool_use`，`stop_reason` 可切换）调用解析路径，断言正文、思考、工具调用、结束原因、usage 与等价 Chat Completions 响应解析结果完全一致。

**验收场景**：

1. **假设** `stop_reason` 为 `end_turn` / `stop_sequence`，**则**映射成 `finish_reason: "stop"`；为 `tool_use`，**则** `"tool_calls"`；为 `max_tokens`，**则** `"length"`（`core/ai-error-handling.md` 的截断自动续写照常触发）；未列出的值按 `"stop"` 处理
2. **假设** `stop_reason` 缺失（流在 `message_delta` 之前断掉），**则**沿用既有截断判定：无结束原因且非用户中止即视为截断
3. **假设** usage 给的是 `input_tokens` / `output_tokens`，**则**分别填成 `prompt_tokens` / `completion_tokens`；**假设**还有 `cache_read_input_tokens` / `cache_creation_input_tokens`，**则**填成缓存读/写 token，且 `prompt_tokens` 取三者之和——否则上下文占用会因缓存命中而缩水，与今天的口径不一致
4. **假设**思考块带签名到达，**则**签名不进入展示、不计 token（思考正文照旧计入）
5. **假设**响应只有思考、既无正文也无工具调用，**则**按既有「只有 reasoning 也算有响应」的口径处理，不报空响应
6. **假设**工具调用的 `input` 因流被截断而无法解析成 JSON，**则**沿用既有容错（`{invalid_arguments}` 兜底），不让整轮失败

---

### 用户故事：流式输出与断连降级（优先级：P1）

作为用户，我希望走 Messages 时正文、思考、工具参数都照常边收边渲染，流式正文中途断连时的降级重发也照旧生效——体验不能因为换了协议而退化。

**为什么是这个优先级**：主循环请求都是流式的（工具参数靠增量渲染，长思考模型靠首字节占住网关空闲超时）。Messages 的事件流用命名事件（`message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`）而非统一的 chunk 结构，不映射就等于失去全部流式体验与既有容错。

**独立测试**：投喂一段录制的 Messages 事件流，断言正文/思考/工具参数三类增量按顺序到达对应回调，且最终组装结果与非流式解析等价；再让流在正文中途断掉，断言以非流式重发并应用其结果。

**验收场景**：

1. **假设**流里收到 `text_delta`，**则**等同正文增量回调（逐字上屏）
2. **假设**流里收到 `thinking_delta`，**则**等同思考增量回调（思考块边想边显示）
3. **假设**流里收到 `tool_use` 块开始（含 `id` 与工具名）与随后的 `input_json_delta`，**则**工具块先出现、参数逐步补全，与今天工具调用的流式表现一致
4. **假设**流式响应在正文中途断开，**则**沿用既有降级：丢弃半截 assistant 消息，用同一份参数以非流式重发（仍在 Messages 端点）
5. **假设**流里出现 `error` 事件或 `ping` 事件，**则** `ping` 忽略、`error` 按 `core/ai-error-handling.md` 的分类处理（429/5xx 重试、其他上报），不吞掉错误
6. **假设**用户在流式中途中止，**则**中止信号同样作用于 Messages 请求，不残留未关闭的连接

---

### 用户故事：全部调用路径与网关前置（优先级：P2）

作为用户，我希望内联补全、next-edit、网页内容处理、压缩与侧问这些路径也跟随同一个 `apiType` 声明；同时我希望这一能力在网关没准备好时**明确失败**而不是悄悄降级。

**为什么是这个优先级**：主对话是用户最先感知的，排在 P1 之后。但「按入口分裂」比整块不支持更难解释——同一个模型主对话带签名、网页处理走兼容层，行为对不上。而网关前置是**外部依赖**：当前 codechat 网关没有 `/messages` 路由（实测 404），私有化实例同样需要跟版；这条写在这里是为了让「声明了但打不通」有确定的解释。

**独立测试**：把当前模型声明为 `apiType: "messages"` 后分别触发内联补全、next-edit、网页内容处理与 `/compact`，断言四者请求都打到 Messages 端点且结果等价；把声明改回 `"chat"` 再跑一遍，断言四者回到 Chat Completions。

**验收场景**：

1. **假设**补全所用的模型（`completionModel`）声明了 `apiType: "messages"`，**当**触发内联补全时，**则**走 Messages 端点，插入文本与 Chat Completions 下等价；模型返回空文本时不渲染幽灵文本的规则不变
2. **假设** next-edit 所用模型声明了 `apiType: "messages"`，**当**触发建议时，**则**走 Messages 端点，解析出的行区间建议等价
3. **假设**网页内容处理使用声明了 `apiType: "messages"` 的模型，**当**发起请求时，**则**走 Messages 端点，纯文本结果等价
4. **假设**会话压缩 / `/compact` 或 `/btw` 侧问用该模型发起，**则**按主循环路径走 Messages，压缩产物与今天等价
5. **假设**声明了 `apiType: "messages"` 但网关没有 `/messages` 路由（404），**当**发请求时，**则**错误原样上抛并指出是端点不可用，**不**降级到 Chat Completions
6. **假设**补全 / next-edit 开关关闭，**当**用户触发时，**则**先按开关判断直接返回、不发起任何请求（开关判断先于端点选择）
7. **假设**企业部署走 SSO（`baseURL` 由 `serverUrl` 派生），**当**私有化实例未同步网关版本时，**则**同一份配置在 SaaS 可用、在私有化不可用——这条属于部署前置，Wave 侧只保证错误信息能指向它

---

### 边界情况

- **边界情况 1**：端点选择只有一个来源——逐模型的 `capabilities.apiType`（取值 `"chat"` 默认 / `"responses"` / `"messages"`），不存在全局开关、模型名清单、正则或内置默认表
- **边界情况 2**：`apiType` 是**一次到位的改名**，取代原来的 `capabilities.responsesApi` 布尔，不保留兼容别名、不读旧字段。因此发版顺序有硬约束：**先发 stable，再改远端 `settings.models` 下发**——反过来会让尚未升级的客户端把 `responsesApi: true` 的模型（`g56-so`、`g6-as`、`g56-lu`、`g56-te`）当成默认 `"chat"`，带 tools 必然 400。远端下发的 `models` 是整块替换，所以改配置这一步是一次性的全量覆盖，不需要逐模型迁移
- **边界情况 3**：Anthropic 独有能力（Batch、Files API、MCP connector、citations、computer use、1h 缓存 TTL、context editing）**不在本规格范围**。Wave 只把已有请求翻译过去
- **边界情况 4**：`options` 原样透传的原则与 Responses 一致——静默丢弃用户的配置比让它 400 更糟
- **边界情况 5**：签名是**不可重建**的。一旦某轮思考没拿到签名（中断、历史迁移、跨协议恢复），该思考就永远不能作为 `thinking` 块回传；不要尝试伪造或用空串顶替
- **边界情况 6**：同一个会话里跨协议混跑是正常场景（老消息来自 Chat Completions、新消息走 Messages）：老消息的思考块无签名，按边界情况 5 处理，正文与工具调用照常翻译
- **边界情况 7**：`apiType` 是设置项，改名与新增取值必须同批改完，不留残留：内置 `settings` 技能、`docs/tutorials.md` 的 `capabilities` 三键说明、以及 `capabilities` 的唯一读取点（`resolveApiType`）。漏一处就等于教用户写一个不生效的字段
- **边界情况 8**：改名波及的代码面很小且集中（`ModelCapabilities` 类型、能力读取函数、`aiService` 里四处客户端构造点），但测试面集中在 `aiService.responses.test.ts` 与 `responsesApi.test.ts`——这两份断言的是「按声明选端点」，改名后要一并改并保持断言强度
- **边界情况 9**：鉴权头按 Anthropic 惯例发 `x-api-key` 与 `anthropic-version`，同时保留既有的 `Authorization: Bearer`（网关当前按 Bearer 鉴权）；`defaultHeaders` 仍可覆盖
- **边界情况 10**：技能 / 自定义命令用 `model` 覆盖模型**名**时（`sendAIMessage({ model })`），端点仍按 agent 模型配置里的 `capabilities.apiType` 选——能力不随名字覆盖一起重解析。这与 `apiType: "responses"` 的现状一致，属于既有口径：要让某模型走 Messages，就把它配成主模型 / 子代理模型 / 补全模型，或在 `models[<agent 模型>]` 上声明
