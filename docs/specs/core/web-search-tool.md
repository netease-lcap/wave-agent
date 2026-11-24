---
name: "WebSearch 工具"
description: "内置联网搜索工具：按 CC WebSearch 的入参与回执形状调用服务端 /api/v1/web-search，只回标题与链接；enableWebSearch 开关（含服务端下发）关掉时不注册，404 后本进程不再探测"
order: 31
---

# 功能规格说明：WebSearch 工具

**创建日期**：2026-11-25

> **上游契约**（已冻结，不在本仓实现）：codechat `docs/specs/web-search.md`。
> `POST {WAVE_SERVER_URL}/api/v1/web-search`，鉴权复用登录态（`Authorization: Bearer <SSO token>`，
> 由 `createAuthAwareFetch` 惰性刷新后附加）；请求 `{query, allowed_domains?, blocked_domains?}`（两组互斥）；
> 200 返回 `{query, results: [{tool_use_id, content: [{title, url, snippet?}]}], durationSeconds, searchCount, leftOut}`，
> 其中 `results` 恒为长度 1 的数组、`content: []` 表示「搜了但没命中」（不是错误）。
>
> **对齐基准**：Claude Code `2.1.331` 的 `WebSearch`——入参 schema 见
> `1022-211817B-D3o.js:2221-2223`，拼给模型的回执见 `:2770-2813`（`mapToolResultToToolResultBlockParam`），
> `leftOut` 那句话见 `:2526`（"N results left out by allowed_domains or blocked_domains."），
> 服务端失败的文本见 `:2275`（`Web search error: ${error_code}`——只有 code，没有散文）。

## 用户场景与测试 _（必填）_

### 用户故事：Agent 用一次搜索回答超出知识截止时间的问题（优先级：P1）

作为使用 wave 的成员，我希望 Agent 能直接联网搜索，以便回答「最近发布的版本」「这个库现在推荐怎么写」这类超出模型知识截止时间的问题，而不用我先去浏览器里查好再贴进来。

**为什么是这个优先级**：这是整条链路唯一的价值出口，其余（错误分档、能力探测、域名过滤）都只为它服务。

**独立测试**：mock `fetch` 让 `/api/v1/web-search` 返回一条命中，调用 `WebSearch({query})`，断言回执文本与 CC 逐字一致、请求体是 `{query}`、请求带 `Authorization: Bearer <token>`。

**验收场景**：

1. **假设** 服务端返回 `content: [{title, url}]`，**当** 调用 `WebSearch`，**则** 模型读到的文本是
   `Web search results for query: "<query>"` + 空行 + `Links: [{"title":"…","url":"…"}]`（**JSON 数组**，不是 markdown 列表）+ 空行 + `REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.`
2. **假设** 服务端返回 `content: []`，**当** 调用 `WebSearch`，**则** 工具 `success: true`，文本里是 `No links found.`，**不是**失败
3. **假设** 命中带 `snippet`，**当** 拼回执，**则** 回执文本里**没有** snippet（只进 `data`，给宿主 UI / PostToolUse hook 用）
4. **假设** 服务端返回 `leftOut: 2`，**当** 拼回执，**则** 追加 `2 results left out by allowed_domains or blocked_domains.`（单数为 `1 result left out …`）
5. **假设** 请求里给了 `allowed_domains` / `blocked_domains`，**当** 发请求，**则** 原样透传为 `allowed_domains` / `blocked_domains` 字段；两者都非空时本地就拒绝（CC 的 `validateInput` 同款，消息逐字）
6. **假设** 需要正文，**当** 模型读工具描述与回执，**则** 它知道本工具只给标题 + 链接，正文要用 `WebFetch` 打开 URL

---

### 用户故事：显式开关能关掉联网搜索，且支持服务端下发（优先级：P1）

作为私有化部署的管理者（或不想让 agent 联网的本机用户），我希望用一个显式开关关掉 WebSearch，而不是只能等它撞一次 404，以便按组织 / 按租户 / 按机器控制联网能力；关掉之后模型不该看见这个工具。

**为什么是这个优先级**：404 是「这台服务端没有这个能力」的被动发现，代价是先付一次注定失败的往返；而「管得住」的前提是开关**先于模型看见工具**就生效。开关还必须能由服务端下发（`GET /api/wave/settings`），否则私有化现场只能逐台改文件。

**独立测试**：把远端托管配置写成 `enableWebSearch: false`，重建工具表，断言 `WebSearch` 不在注册表里、按需池也命中不到、直接调插件返回「已关闭」且**零 HTTP**；把托管层改成 `true` 后断言它重新出现。

**验收场景**：

1. **假设** 托管层给出 `enableWebSearch: false`，**当** 构建工具表，**则** 不注册 `WebSearch`（`tools[]` 没有它、REPL 按需池也没有它），且**不发任何**探测请求
2. **假设** 托管层没说、本地 `settings.json` 写 `enableWebSearch: false`，**当** 构建工具表，**则** 同样不注册；本地写 `true` 则注册
3. **假设** 托管层 `true` 而本地 `false`（或反之），**当** 判定，**则** 一律以托管层为准——托管值对本地是强制的，两个方向都成立
4. **假设** 该键缺失、或值不是布尔（`"true"` / `1` / `null`），**当** 判定，**则** 当作「这一层没表态」继续往下落，最终取代码默认（开），不因畸形值翻转
5. **假设** 开关为开但服务端回 `404`，**当** 首次调用，**则** 仍按「本部署未开通」摘掉工具——404 探测是第二道闸，两者叠加而不是互相替代
6. **假设** 运行中托管配置由 `true` 变 `false`，**当** 下一次拉取触发配置重载，**则** 工具从工具表移除；反向变化则重新出现（与 `enableKnowledgeBase` 同一条重载链路）
7. **假设** 开关为关，**当** REPL 脚本捏着旧插件引用直接调用，**则** 返回「已在设置中关闭」的一句话，**不发请求**，也不误报成「本部署未开通」

---

### 用户故事：能力未开通时不要每轮都去撞（优先级：P1）

作为部署在「服务端没开 WEB_SEARCH_ENABLED」环境里的用户，我希望工具撞到 404 之后自己消失，而不是每轮对话都发一次注定失败的请求。

**为什么是这个优先级**：404 在这个契约里是「本部署没有这个能力」（与服务端整组能力关闭同口径），不是偶发失败；反复探测既浪费往返，也会让模型反复向用户道歉。

**独立测试**：第一次调用返回 404，断言工具被 `unregister`、第二次调用**不发起任何 fetch**、`ToolManager` 重载特性门（`reloadFeatureGatedTools`）不会把它加回来。

**验收场景**：

1. **假设** 服务端返回 `404`，**当** 调用 `WebSearch`，**则** 工具 `success: false`，文本说明「本部署未开通联网搜索」，并从本会话的工具表里摘掉
2. **假设** 本进程已经为当前 `serverUrl` 记下 404 判定，**当** 再次调用（脚本里捏着旧引用 / 直接调插件），**则** 直接返回同一句话，**不发请求**
3. **假设** 本进程对某个 `serverUrl` 记下了 404，**当** 换成另一台服务端（登录态随 `serverUrl` 切换），**则** 重新可用、重新探测
4. **假设** 判定是内存态，**当** 进程结束，**则** 不留下任何配置文件（不写 settings、不写 auth.json）

---

### 用户故事：失败与「没命中」必须可区分（优先级：P1）

作为模型，我需要知道「搜索被限流了」和「搜到了 0 条」是两件事，否则我会把一次限流当成「网上没有这个信息」直接作答。

**为什么是这个优先级**：把失败伪装成空结果，是这条链路上最容易产生幻觉的形态。

**独立测试**：分别 mock 429 / 504 / 400 / 401，断言 `success: false` 且文本各是一句可行动的话，且与 `No links found.` 不同。

**验收场景**：

1. **假设** 服务端 `429 WEB_SEARCH_RATE_LIMITED`，**当** 调用，**则** 模型可见文本逐字为 `Web search error: WEB_SEARCH_RATE_LIMITED`（与 CC `:2275` 同形：冒号后只有 code），**不是** `No links found.`
2. **假设** 服务端 `504 WEB_SEARCH_TIMEOUT`，**当** 调用，**则** 文本为 `Web search error: WEB_SEARCH_TIMEOUT`，且**不重试**（超时无法证明上游没执行）
3. **假设** 服务端 `400 WEB_SEARCH_INVALID_QUERY` / `WEB_SEARCH_INVALID_DOMAINS` / `WEB_SEARCH_DOMAIN_CONFLICT`，**当** 调用，**则** 文本为 `Web search error: <code>`（模型据此改参数），且**不重试**
4. **假设** `401` / `403`，**当** 调用，**则** 文本说明要登录 / 需要企业成员或授权（私有化还包括 license 闸门）
5. **假设** 服务端 `503`，**当** 调用，**则** 按仓内既有口径（`knowledgeBaseApi` 的同款）重试 1 次，仍失败则文本为 `Web search error: WEB_SEARCH_UNAVAILABLE`
6. **假设** 客户端侧 15 秒内没拿到响应，**当** 超时，**则** 报超时（客户端超时宽于服务端 10 秒；这是本地失败，冒号后是一句英文说明）
7. **假设** 200 但 `results` 不是数组，**当** 解析，**则** 报「响应畸形」（文本以 `Web search error:` 开头并说明响应畸形），**不当** 空结果
8. **假设** 服务端 `error.message` 是中文（codechat 侧面向运维的文案），**当** 调用失败，**则** 模型可见文本仍是 `Web search error: <code>`（**不含**服务端 message、不含任何中文）；服务端 message 截断后进 `logger.warn`，供排障时读

## 实现约束 _（必填）_

- **工具名**：`WebSearch`（`constants/tools.ts` 的 `WEB_SEARCH_TOOL_NAME`），声明为 `defer: true`——与 `WebFetch` 同档，REPL 开启时进按需池而不是每次对话都摊平。
- **入参 schema 逐字照 CC**：`query`（string，`minLength: 2`，"The search query to use"）、`allowed_domains`（string[]，"Only include search results from these domains"）、`blocked_domains`（string[]，"Never include search results from these domains"），`required: ["query"]`。
- **鉴权**：只用 `createAuthAwareFetch`（登录态 + 惰性刷新），不新建凭证类型、不加配置项。
- **回执文本**：由 `tools/resultData/webSearch.ts` 从 `data` 现场渲染（issue #3055 的分工），逐字照 CC——包括 CC 在 `Links` 块与 `REMINDER` 之间实际输出的两个空行（`Links: …\n\n` 加 reminder 自带的前导换行）。
- **服务端失败的文本逐字照 CC**：`Web search error: <code>`（`1022-211817B-D3o.js:2275`），冒号后**只有 code**，不附散文、不附服务端 message。服务端答了非 2xx 但没给 `{error:{code}}` 时用 HTTP 状态兜底（CC 那里会打印 `undefined`，我们不复刻这个缺陷）。**本地失败**（网络错误 / 客户端超时 / 200 畸形）没有服务端 code，冒号后落一句英文说明——CC 没有对应物。
- **401 / 403 保留行动指引**（去登录 / 看 license / 看企业成员）：那对应 CC 的 API 层错误提示，不是「服务端工具结果」那一档，所以不走 `Web search error: <code>` 模板。
- **服务端 `message` 不进模型可见文本**：它面向运维、在 codechat 侧是中文，拼进文本就是中英混排。服务端 message 截断（≤300 字符）后进 `logger.warn`（`Web search rejected` / `Web search was not authorized` 的 `serverMessage` 字段）。
- **工具 `content` 与渲染器输出同一份**，`data` 里留 `status` / `reason` / `errorCode` 供宿主与脚本读（`reason` 在服务端失败时就是 code，本地失败时是一句英文）。`shortResult` 是给折叠行看的中文短语。
- **开关**：`enableWebSearch`（`WaveConfiguration` 顶层键，与 `enableArtifact` / `enableRepl` / `enableKnowledgeBase` 同一家族）。解析顺序：远端托管（`GET /api/wave/settings`，管理员下发）→ 本地合并 `settings.json` → 代码默认 `WEB_SEARCH_DEFAULT_ENABLED = true`。非布尔值视为该层未表态（同 `readBooleanFlag` 口径），不强制转换。判定读 `SessionWorkdir`——与 `enableKnowledgeBase` 同理，`cd` 不得改变由哪个 settings 文件决定。判定函数与 404 判定同住 `services/webSearchAvailability.ts`；注册门把两者串起来（开关为开**且**没有 404 判定才注册），`execute` 入口按同一顺序复判——配置关回 `status: "disabled"`，404 回 `status: "unsupported"`。`execute` 取目录走 `ToolManager.getSessionWorkdir()`（同一个 `SessionWorkdir`），不回落到 `context.workdir`。
- **能力探测**：`services/webSearchAvailability.ts` 在**内存里**按 `serverUrl` 记 404 判定（不落盘）；注册门（`ToolManager.initializeBuiltInTools` / `reloadFeatureGatedTools`）与 `execute` 入口都读它。
- **超时**：15 000 ms（服务端 10 秒 + 余量）；**重试**：网络错误与 `503` 各重试 1 次、间隔 300 ms（照 `knowledgeBaseApi` 的既有口径），`400/429/502/504/404` 不重试。
- **遥测**：仓内没有通用「每工具耗时/错误」上报（`telemetry/metrics.ts` 只有 commit / PR / 编辑行数等专用计数器），故只 `logger.warn` 失败与能力判定，不新造计数器。
- **不实现 `WebFetch`**：抓正文归既有 `WebFetch`，本规格只在描述与回执里指向它。

## 边界情况

- **为什么默认开**：CC 的 `WebSearch` 除 provider 不支持外默认可用，本工具上线时也是「注册即有、404 才关」；把默认改成关等于悄悄收回一个已发布的能力。要收紧的部署显式下发 `false`。
- **开关与 404 是两件事**：开关是「配置说不要」，404 是「服务端说没有」。前者回执 `status: "disabled"`，后者 `status: "unsupported"`，不混用——把配置关闭报成「本部署未开通」会把人支去查服务端的 `WEB_SEARCH_ENABLED`。
- **`results` 恒为 1 个元素**：契约里它是「一次服务端工具调用的产出块」，本接口一次调用只打一次上游；`content: []` 是「搜了但没命中」。客户端按块 `flatMap` 出命中，多于 1 块也照样拼。
- **`snippet` 为什么不给模型看**：CC 的语义是模型只看 `title` + `url`（snippet 只进 PostToolUse hooks；非 citations 时被 `Qr()` 剥掉）。给模型摘要会诱导它拿 200 字的摘要硬答，而正文应该走 `WebFetch`。所以 `snippet` 留在 `data`（宿主 UI / hook 可读）、不进回执文本。
- **`tool_use_id`**：服务端生成的 `ws_<12 hex>`，客户端只当不透明 id，不解析、不校验格式；它也不进回执文本（CC 的回执也不带）。
- **`leftOut` 的位置**：CC 把它作为 `results` 里的一条**字符串**参与拼接，因此它总在 `Links`/`No links found.` 之后、`REMINDER` 之前。
- **`searchCount` 恒为 1**：契约保证；客户端只透传，不做 `results.length === searchCount` 之类的判断。
- **`durationSeconds`**：服务端耗时，只进 `data`（宿主卡片可显示），不进回执。
- **本地校验只做一条**：`allowed_domains` 与 `blocked_domains` 同时非空（CC 的 `validateInput` 也在这条上本地拦，消息逐字）。其余（长度、域名格式）交给服务端的 400——重复实现只会和契约漂移。
- **域名过滤为什么不在客户端做**：服务端已经按 hostname 后缀硬过滤并给出 `leftOut`；客户端再过滤一遍会在 `leftOut` 与条数上二次失真。本工具只把两个名单原样透传（服务端负责拼 `site:` 语法与硬过滤）。
