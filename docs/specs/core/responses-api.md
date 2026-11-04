---
name: "Responses API 传输"
description: "按 models.<name>.capabilities.responsesApi 逐模型选择 Responses 端点：参数/工具/消息/流式与用量映射，让只允许 Responses 工具调用的新模型可用"
order: 85
---

# 功能规格说明：Responses API 传输

**创建日期**：2026-11-04

## 用户场景与测试 _（必填）_

### 用户故事：按声明为模型选择 API 端点（优先级：P1）

作为要在新代际 OpenAI 模型（`gpt-6.1-sol`、GPT-6 Astra、`gpt-5.x-pro` 等）上使用 Wave 的用户，我希望在 `settings.json` 里为某个模型声明「它必须走 Responses API」，Wave 就对这个模型的 agent 请求改用 Responses 端点——否则这类模型只要带 tools 就必然 400，不论 `reasoning_effort` 传什么。

**为什么是这个优先级**：这是本功能的全部前提。GPT-5.4 之后 Chat Completions 只有 `reasoning_effort: "none"` 才允许 function tools，而这类 6 代模型根本没有 `none` 档（官方模型页写明 "Tool calling requires the Responses API."），两条限制交集为空 → 对 Wave 而言这些模型**结构上不可用**，任何参数调整都绕不过去。

**独立测试**：用声明了 `capabilities.responsesApi: true` 的模型配置发起一次带工具的 agent 调用，断言请求打到 Responses 端点且请求体是 Responses 形状；把声明去掉或改成 `false`，断言请求仍打到 Chat Completions 且请求体与今天逐字段一致。

**验收场景**：

1. **假设** `models["<name>"].capabilities.responsesApi` 为 `true`，**当** agent 主循环发起一轮带工具的请求，**则**该请求走 Responses 端点（`client.responses.create`），请求体为 Responses 形状（`input` + 扁平 `tools`）
2. **假设**模型未声明 `capabilities.responsesApi`（即默认 `false`），**当** agent 发起请求时，**则**行为与今天完全一致：走 Chat Completions，请求体不新增任何字段
3. **假设**本轮请求实际使用的模型是覆盖后的 `fastModel` / `visionModel` / 显式指定模型，**当**它与主模型的 `responsesApi` 声明不同时，**则**按**该请求实际使用的模型**的声明选择端点（主模型走 Responses 不影响 fastModel 的子代理请求走 Chat Completions，反之亦然）
4. **假设**仓库里不存在任何模型名清单、正则或内置默认表，**当**用户把一个新模型写进 `models` 并声明 `responsesApi: true` 时，**则**无需升级 Wave 即可使用
5. **假设**声明了 `responsesApi: true` 的模型在 Responses 端点返回错误，**当**该错误上抛给用户时，**则**错误文案保留服务端原文，且**不会**静默改用 Chat Completions 重试（一次请求只打一个端点）

---

### 用户故事：请求参数与工具声明的映射（优先级：P1）

作为走 Responses 端点的用户，我希望 Wave 把现有配置里的生成参数、系统提示、工具声明和已发生的工具调用历史翻译成 Responses 的形状，这样 `models.<name>.options` 里现有的写法继续可用、工具调用能连续多轮；同时我写在 `options` 里的其它字段仍然原样发出，不被 Wave 过滤或改写。

**为什么是这个优先级**：端点换了而参数照发就是 400。`options` 是用户手写、按 Chat Completions 校验的字段，必须由 Wave 翻译——不能让用户为同一个模型维护两套配置。反过来，**`options` 是懂行的人写的**：Wave 只负责键名映射（`reasoning_effort` → `reasoning.effort` 这类），不判断某个键在 Responses 上是否合法。静默丢弃用户写完的配置比让它 400 更糟——400 至少说得清是哪一行。

**独立测试**：构造含 system 提示、图片输入、工具声明、一轮已完成的「assistant tool_call + 工具结果」历史，发起一次 Responses 请求，逐字段断言请求体符合下表；并断言 `options` 里一个未被映射的自定义键（如 `seed`）在请求体里**原样存在**，没有被丢弃或改名。

| 现有配置（Chat Completions 形状）                       | Responses 形状                                         |
| ------------------------------------------------------- | ------------------------------------------------------ |
| `messages`                                              | `input`（items 数组）                                  |
| system 消息 / `SystemPromptBlock[]`                     | `instructions`（拼接成字符串）                         |
| `max_completion_tokens`                                 | `max_output_tokens`（数值不变）                        |
| `response_format`                                       | `text.format`（`name`/`strict`/`schema` 上移一层）     |
| `reasoning_effort`                                      | `reasoning.effort`                                     |
| `verbosity`                                             | `text.verbosity`                                       |
| `tools[].function.{name,description,parameters,strict}` | `tools[].{name,description,parameters,strict}`（扁平） |
| `tool_choice` 具名工具                                  | `{type:"function", name}`                              |
| assistant `tool_calls[]`                                | `function_call` item（`call_id`/`name`/`arguments`）   |
| `role:"tool"` 消息                                      | `function_call_output` item（`call_id`/`output`）      |
| 图片 content part                                       | `input_image`（`image_url`）/ `input_text`             |
| **其它所有 `options` 键**                               | **原样透传**（Wave 不增删、不改名、不判合法性）        |

**验收场景**：

1. **假设** `models.<name>.options` 里有 `reasoning_effort: "high"`，**当**走 Responses 时，**则**发出 `reasoning: { effort: "high" }`（不是顶层的 `reasoning_effort`）
2. **假设** `options` 里有 `verbosity`，**当**走 Responses 时，**则**发到 `text.verbosity`
3. **假设** `options` 里有 `response_format: {type:"json_schema", json_schema:{name, schema, strict}}`，**当**走 Responses 时，**则**发成 `text.format: {type:"json_schema", name, schema, strict}`（`json_schema` 这层被去掉）
4. **假设**生效的输出上限来自 `max_completion_tokens` 或会话级上限，**当**走 Responses 时，**则**发到 `max_output_tokens`，数值不变（该额度含推理 token）
5. **假设** `options` 里有上表未列出的键（例如 `seed`、`stop`、`presence_penalty`，或用户自己写的 Responses 形状字段如 `reasoning: {effort:"high"}`），**当**走 Responses 时，**则**该键连同其值**原样出现在请求体里**，Wave 既不丢弃也不改名——配错了由服务端 400 直接反馈
6. **假设**用户同时写了 `reasoning_effort` 与 Responses 形状的 `reasoning`，**当**发生映射时，**则**用户显式提供的 `reasoning` 优先，映射结果不覆盖它
7. **假设**系统提示是分块 `SystemPromptBlock[]`，**当**走 Responses 时，**则**所有块按顺序拼成 `instructions` 字符串；**假设**同一模型还声明了 `promptCaching: true`，**则**不注入 `cache_control` 标记（Responses 侧由服务端自动缓存，该标记不适用，也不算错误配置）
8. **假设**工具声明是 `{type:"function", function:{name, description, parameters, strict?}}`，**当**走 Responses 时，**则**发成 `{type:"function", name, description, parameters, strict?}`，工具名与参数 schema 一个字节都不变
9. **假设** `tool_choice` 为 `"auto"` / `"none"` / `"required"`，**则**同名透传；**假设**是强制具名工具，**则**发成 `{type:"function", name}`；延伸思考生效时把强制 `tool_choice` 降为 `auto` 的既有规则照旧生效
10. **假设**历史里有 assistant 的 `tool_calls`，**当**翻译成 `input` 时，**则**每个调用成为一条 `function_call` item（带 `call_id`、`name`、`arguments`），同一条 assistant 消息的正文成为它前面的 `message` item；**假设**历史里有配对的 `role:"tool"` 消息，**则**成为一条 `function_call_output` item，`call_id` 与上者一致
11. **假设**用户消息含图片，**当**走 Responses 时，**则**content part 映射为 `input_image`（URL 原样）与 `input_text`；非视觉模型剥离图片的既有行为不变
12. **假设**历史来自多个轮次（既有 Responses 轮次也有此前走 Chat Completions 的轮次），**当**组装 `input` 时，**则**整段历史按同一套规则统一翻译，不因来源不同丢内容

---

### 用户故事：响应解析与用量口径（优先级：P1）

作为用户，我希望 Responses 返回的结果被解析成与 Chat Completions 等价的东西——正文、推理内容、工具调用、结束原因、token 用量——这样上层的消息渲染、工具执行、上下文占用、错误处理都不需要为新端点分叉。

**为什么是这个优先级**：端点换了但下游语义不变是这个设计成立的关键。`finish_reason`、usage 口径一旦不一致，自动续写、上下文百分比、缓存 token 统计都会静默错乱。

**独立测试**：用固定的 Responses 响应体（正文 + 推理 + 一个 `function_call`，`status`/`incomplete_details` 可切换）调用解析路径，断言正文、推理内容、工具调用、结束原因、usage 与等价 Chat Completions 响应解析结果完全一致。

**验收场景**：

1. **假设** `output` 里有一条 `type:"message"` 的 item 且其 `content` 含若干 `output_text`，**则** assistant 正文等于这些 `output_text` 的拼接
2. **假设** `output` 里有 `type:"reasoning"` 的 item，**则**其文本进入推理内容通道（与今天 Chat Completions 的 `reasoning_content` 等价），UI 思考块照常渲染
3. **假设** `output` 里有 `type:"function_call"` 的 item，**则**变成工具调用条目（工具名 + 参数 JSON 可直接执行），其 `call_id` 作为后续工具结果回填的 id
4. **假设**一次响应里有多个 `function_call` item，**则**全部按顺序转成工具调用，并行执行能力不变
5. **假设** `status: "incomplete"` 且 `incomplete_details.reason` 为 `"max_output_tokens"`，**则**映射成 `finish_reason: "length"`，`core/ai-error-handling.md` 的截断自动续写照常触发
6. **假设** `status: "completed"` 且没有工具调用，**则** `finish_reason: "stop"`；**假设**有工具调用，**则** `finish_reason: "tool_calls"`
7. **假设** usage 给的是 `input_tokens` / `output_tokens` / `total_tokens`，**则**分别填成 `prompt_tokens` / `completion_tokens` / `total_tokens`，上下文占用展示仍取 `total_tokens`
8. **假设** usage 里 `input_tokens_details.cached_tokens` 有值，**则**填成缓存读 token，但仍不计入上下文占用（对齐 `core/prompt-cache-control.md` 的 token 口径）
9. **假设**响应只有推理内容、既无正文也无工具调用，**则**按今天「只有 reasoning 也算有响应」的口径处理，不报空响应

---

### 用户故事：流式输出与断连降级（优先级：P1）

作为用户，我希望走 Responses 时正文、推理、工具参数都照常边收边渲染，流式正文中途断连时的降级重发也照旧生效——体验不能因为换了端点而退化。

**为什么是这个优先级**：Wave 的所有主循环请求都是流式的（工具参数靠流式增量渲染，长思考模型靠首字节占住网关空闲超时）。Responses 的事件流与 Chat Completions 的 chunk 结构完全不同，不映射就等于在 Responses 模型上失去全部流式体验与既有容错。

**独立测试**：投喂一段录制的 Responses 事件流，断言正文/推理/工具参数三类增量按顺序到达对应回调，且最终组装结果与非流式解析等价；再让流在正文中途断掉，断言以非流式重发并应用其结果。

**验收场景**：

1. **假设**流里收到正文增量事件，**则**它等同 Chat Completions 的正文增量回调（逐字上屏）
2. **假设**流里收到推理增量事件，**则**它等同推理增量回调（思考块边想边显示）
3. **假设**流里先收到工具调用开始（含 `call_id` 与工具名）、随后收到若干参数增量，**则**工具块先出现、参数逐步补全，与今天工具调用的流式表现一致
4. **假设**流式响应在正文中途断开，**则**沿用既有降级：丢弃这次半截的 assistant 消息，用同一份请求参数以非流式重发（仍在 Responses 端点），并把结果作为一次非流式响应应用
5. **假设**同一响应分别以流式与非流式请求，**则**解析结果在正文、工具调用、`finish_reason`、usage 上等价
6. **假设**用户在流式中途中止，**则**中止信号同样作用于 Responses 请求，不残留未关闭的连接
7. **假设**流里出现表示失败的结束事件，**则**按 `core/ai-error-handling.md` 的分类处理（429/5xx 重试、其他错误上报），不吞掉错误

---

### 用户故事：非 agent 调用路径同样跟随声明（优先级：P2）

作为用户，我希望内联补全、next-edit、网页内容处理这三条路径也跟随同一个 `responsesApi` 声明，这样声明过的模型在 Wave 里处处能用——不会出现「主对话能跑、网页内容处理报错」这种按入口分裂的行为。

**为什么是这个优先级**：这三条不跑 agent 主循环，用户最常感知的是主对话框，所以排在 P1 之后。但它们都是**同一个模型的其它入口**：主模型声明了 `responsesApi` 而网页内容处理仍打 Chat Completions 时，一旦遇到官方标为 "Chat Completions not supported" 的模型，这条路就直接失败——同一个模型一半能用一半不能用，比整块不支持更难解释。

**独立测试**：把当前模型声明为 `responsesApi: true` 后分别触发内联补全、next-edit 与网页内容处理，断言三者请求都打到 Responses 端点且结果与 Chat Completions 下等价；把声明去掉再跑一遍，断言三者回到 Chat Completions。

**验收场景**：

1. **假设**网页内容处理使用的是声明了 `responsesApi` 的模型（未指定 fastModel 时即主模型），**当**发起请求时，**则**走 Responses 端点，纯文本结果与 Chat Completions 下等价
2. **假设**补全所用的模型（`completionModel`）声明了 `responsesApi`，**当**触发内联补全时，**则**走 Responses 端点，插入的补全文本与 Chat Completions 下等价；模型返回空文本时不渲染任何幽灵文本的规则不变
3. **假设** next-edit 所用的模型声明了 `responsesApi`，**当**触发建议时，**则**走 Responses 端点，解析出的行区间建议与 Chat Completions 下等价
4. **假设**这三条路径所用的模型**未声明** `responsesApi`，**当**发起请求时，**则**仍走 Chat Completions，行为与今天完全一致
5. **假设**这三条路径的请求本身不带工具、不是流式（都是单次纯文本请求），**当**走 Responses 时，**则**只发送它们需要的字段（模型、`instructions`、`input`、输出上限等），不因「支持 Responses」而引入工具或流式语义
6. **假设**补全 / next-edit 的开关被关闭，**当**用户触发时，**则**先按开关判断直接返回、不发起任何请求（开关判断先于端点选择）
7. **假设**会话压缩 / `/compact` fork 用主模型发起，**当**它走 agent 主循环时，**则**按主模型的声明走 Responses（属于主循环路径）

---

### 边界情况

- **边界情况 1**：端点选择只有一个来源——逐模型的 `capabilities.responsesApi`（默认 `false`），不存在全局开关、模型名清单、正则或内置默认表。用户换新模型时改一行 `settings.json` 即可，不必等 Wave 发版
- **边界情况 2**：Responses 独有的其它能力（file search、code interpreter、computer use、MCP 托管、image generation、`reasoning.mode: "pro"`、hosted shell、apply patch、tool search）**不在本规格范围**。Wave 只把已有请求翻译过去，不主动索取推理摘要等 Responses-only 内容：主循环发它本来就会发的工具与消息，三条纯文本路径发它们本来就发的两段文本
- **边界情况 3**：`responsesApi: true` 与 `promptCaching: true` 同时声明不冲突：Responses 下不发 `cache_control`，由服务端自动缓存；不得因此报配置错误
- **边界情况 4**：`options` 是懂行的人写的配置，Wave 只做上表列出的键名映射，其余键一律原样透传——不丢弃、不改名、不判断端点是接受还是拒绝。用户配错由服务端 400 直接反馈，静默丢弃用户的配置比报错更糟
- **边界情况 5**：工具结果回填必须用 `call_id`（不是 item 的 `id`），两者用错服务端会拒绝该轮请求
- **边界情况 6**：`finish_reason` 的映射必须让「输出被上限截断」这一语义成立，否则 `core/ai-error-handling.md` 的自动续写在 Responses 模型上静默失效
- **边界情况 7**：开关是逐模型的，父子代理互不影响：同一个会话里主代理走 Responses、用 fastModel 的子代理走 Chat Completions 是正常组合
- **边界情况 8**：四条调用路径（agent 主循环 / 网页内容处理 / 内联补全 / next-edit）对**同一个模型**必须给出同一个端点结论——不能出现按入口分裂（主循环走 Responses、网页处理仍走 Chat Completions），否则「Chat Completions not supported」的模型会一半能用一半失败
- **边界情况 9**：模型的 `capabilities` 是设置项，新增字段必须同步登记到设置文档与内置 `settings` 技能，否则用户问「怎么让这个模型走 Responses」时得不到正确答案
