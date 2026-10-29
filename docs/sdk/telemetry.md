---
title: OpenTelemetry 遥测
description: OpenTelemetry 遥测：首方上报出口、导出器、出站头、指标、归属属性、事件日志、PII 保护与可靠性
---

# OpenTelemetry 遥测 {#opentelemetry-telemetry}

Wave 支持 OpenTelemetry 可观测性标准，提供结构化的遥测数据（Metrics、Logs），帮助开发者观察 Agent 行为、调试性能问题并分析会话模式。

> 早期版本采集的 **Traces（span 链路）已移除**：上游 Claude Code 的 traces 仍处 beta，且链路数据对「成本 / 容量 / 错误率」这类车队级问题不如指标直接。配置里遗留的 `tracesExporter` / `spanTtlMs` 不再生效，加载时记一条告警（其余遥测设置照常生效）。

## 内置上报（首方出口） {#otel-first-party}

除下面这些自建导出器外，Wave 还有一条**独立的**首方管道：把 `wave.*` 指标与会话生命周期事件直报**部署方自己的** CodeWave 服务端，端点 `{登录服务端地址}/otel`，凭证复用当前登录的 SSO token，企业端运营平台的「研发效能」页面据此供数。

- **默认开启**，不需要任何配置；两条管道互不顶替——配了自建 OTLP 不会关掉它，它也不占用你配的 `endpoint`。
- **关掉它用总闸**：`DISABLE_TELEMETRY=1` 同时停掉首方上报与自建导出器（与 Claude Code 同名同义）。只想停自建导出器时，把 `OTEL_METRICS_EXPORTER` / `OTEL_LOGS_EXPORTER` 设为 `none`。
- **未登录、或拿不到服务端地址时不产生任何流量**（不生成注定 401 的批次），导出失败走优雅失败，不阻塞会话。

## 导出器 (Exporters) {#otel-exporters}

Wave 支持为每种信号类型（Metrics、Logs）配置不同的导出目标：

- **OTLP 导出器**：将遥测数据发送到标准 OTLP 收集器（Grafana、Datadog 等兼容后端均可）。通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 设置收集器地址；端点即基址，指标发往 `<endpoint>/v1/metrics`、日志发往 `<endpoint>/v1/logs`。
- **`none`（显式关闭）**：某类信号的环境变量设为 `none` 时该类信号不导出，且**不**回退到 `settings.json` 里配的导出器——用来在一台已配好遥测的机器上单独关掉某一类信号；另一类信号不受影响，两类都关等于遥测不启用。
- **Console 导出器**：把遥测以可读形式直接打印到终端（对齐 Claude Code 的 `console` 导出器）。交互 TUI 下输出呈现在界面上方、不打碎界面；**只在交互模式生效**——`--stdio` / `--print` 宿主的 stdout 是协议/结果通道，console 导出器在那里会被自动剥除。旧 `jsonl` 文件导出器已移除，配置里遗留的 `"jsonl"` 值会被忽略并告警。

**配置方式**：`OTEL_*` 写在 `settings.json` 的 **`env` 块**里（或由服务端托管配置下发同一批键），也可以直接用操作系统环境变量；三者同时存在时按「托管配置 > 设置文件 `env` > OS 环境」取值。载体与 Claude Code 一致——它也是把 `OTEL_*` 放在 `env` 里。

```json
{
  "env": {
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://your-collector.example.com",
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer ..."
  }
}
```

> 唯一不写在 `env` 里的是出站头命令 `otelHeadersHelper`（见下节）：它会在这台机器上执行命令，所以单独占一个顶层键，与 Claude Code 的位置一样。旧写法 `monitoring.telemetry` 已下架，该块不再被读取，其余配置照常生效。

## 出站头 (Headers) {#otel-headers}

OTLP 出站头有两个来源，**动态头按 key 覆盖静态头**：

| 来源                                      | 形态                                    | 何时读取                                                                        |
| ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_HEADERS`              | `key1=value1,key2=value2`               | 进程启动                                                                        |
| `otelHeadersHelper`（settings.json 顶层） | 一条命令，stdout 是头部 JSON 对象       | 首次导出前 + 每次刷新间隔（默认 29 分钟，可用 `OTEL_HEADERS_DEBOUNCE_MS` 覆盖） |
| `AgentOptions.telemetry.headersProvider`  | `() => Promise<Record<string, string>>` | 同 helper（可选，优先级高于 helper）                                            |

静态头适合固定凭据（如 `Authorization: Bearer <长期 token>`）；**`otelHeadersHelper` 适合按设备签发、可吊销、会轮换的凭据**——凭据本身不写进配置或分发包，改一次 token 不需要重新下发配置，也不需要重启长驻宿主（桌面端 / VS Code）里的会话。

```json
{
  "env": {
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "https://your-collector.example.com",
    "OTEL_EXPORTER_OTLP_HEADERS": "x-application=wave"
  },
  "otelHeadersHelper": "/usr/local/bin/get-otel-headers"
}
```

helper 命令跑在 shell 里（Windows 下是 Git Bash，与 hook 一致），stdin 为空、无参数，stdout 必须是 `{"header-name": "value"}`（值必须都是字符串，且对象非空）。它不需要任何权限确认——与 hook 一样属于「配置声明的执行者」；**但只有用户级 `~/.wave/settings.json` 与服务端托管配置能设置它**，项目里的 `.wave/settings.json` 会被忽略（只忽略这一个键，同文件 `env` 里的其它遥测键照常生效）并打一条警告：helper 是一台机器上会执行的命令，随仓库分发的配置不该能指定它。

失败语义（非 0 退出 / 超时 / stdout 不是合法 JSON 对象）时**不丢批次、不影响 agent**：先沿用上一次成功取到的头，没有则只发静态头；失败按「失败种类变化」限流打警告。**stdout 就是凭据**，因此它不进日志、不进审计、不进 span 属性，失败告警里也只带失败种类与退出码。

## 指标 (Metrics) {#otel-metrics}

指标回答的是车队级问题——哪个模型在吃预算、用量是否在涨、产出有多大。命名稳定在 `wave.*` 下，每个数据点在家族属性（模型 id、token 类型、行数方向）之外还会带上下面那套标准归属属性；属性面刻意保持低基数，**不含提示词、文件路径或任何内容级数据**。

| 指标                           | 类型 | 说明                    | 归属属性                                                                         |
| ------------------------------ | ---- | ----------------------- | -------------------------------------------------------------------------------- |
| `wave.tokens`                  | 计数 | 消耗的 token 数         | `model` + `type`（input / output / cache_read / cache_creation）                 |
| `wave.sessions`                | 计数 | 启动的 Agent 会话数     | —                                                                                |
| `wave.lines.changed`           | 计数 | 编辑类工具增删的行数    | `direction`（added / removed）                                                   |
| `wave.commits`                 | 计数 | 经由工具创建的提交数    | —                                                                                |
| `wave.pull_requests`           | 计数 | 经由工具创建的 PR/MR 数 | —                                                                                |
| `wave.active_time`             | 计数 | 活跃时长（秒）          | `type`（user / cli）                                                             |
| `wave.code_edit_tool.decision` | 计数 | 编辑类工具的权限决策数  | `decision`（accept / reject）+ `source` + `tool_name` + `language`（能推断出时） |

- **失败不记用量**：一次请求失败时拿不到 usage，因此不产生 `wave.tokens`；失败本身走事件日志（`error` 事件），不在指标里重复计数。
- **零值不上报**：编辑结果里为 0 或缺失的一侧不产生记录，纯新增与纯删除因此可区分。
- **创建动作按调用判定**：`wave.commits` / `wave.pull_requests` 只看这次工具调用是否**成功创建**了提交 / PR——对齐 Claude Code 的 `commit.count` / `pull_request.count` 口径（不看是否被合并、不看后续改动）。判定不询问任何 Git 托管平台，因此私有化 GitLab 与 GitHub 同等成立；一次调用最多计一次，失败的调用不计。
- **进程级累加**：指标按进程累加，不随单个会话结束而重置；压缩（compaction）后 token 继续累加在同一计数器上。
- **活跃时长不是在线时长**：`wave.active_time` 每次只上报一段**已闭合的区间长度**（不是累计值、更不是进程存活时长），`type=cli` 只覆盖 agent 真正在跑的时间——模型调用与工具执行，弹窗等待用户批准的那段被排除；并行/嵌套的操作按墙钟只算一次。`type=user` 把相邻两次输入间隔**小于 5 秒**的那段算作在场，更长的间隔视为挂机不计。**按会话分桶**：长驻进程里的多个会话各记各的（同一进程并发跑两个会话时，两者之和会超过进程墙钟），属性带各自的 `session.id`。
- **编辑类工具的决策只认 `Edit` / `Write`**：每次权限决策记一次（允许与拒绝都计，不是每次工具调用），`source` 取 `config`（配置规则、权限模式、worktree 安全、plan 文件范围）／`hook`（`PermissionRequest` hook 决定）／`user_permanent`（你选的持久化规则）／`user_temporary`（只对本会话生效的允许）／`user_abort`（弹窗被取消）／`user_reject`（明确拒绝）／`unknown`；`language` 由目标文件扩展名推导，推导不出时该属性不出现，文件路径本身从不上报。

## 归属属性 (Attributes) {#otel-attributes}

**每条指标数据点与每条事件**都带同一组标准属性，接入方据此按人、按会话、按团队切片，而不是只能看全局总量。开关名与 Claude Code 一致，写进 `settings.json` 的 `env` 块即可。

| 属性                                                                                       | 何时带上                   | 开关（默认）                                     |
| ------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------ |
| `session.id`                                                                               | 指标数据点                 | `OTEL_METRICS_INCLUDE_SESSION_ID`（开）          |
| `session.id`                                                                               | 每条事件                   | 恒带（事件面不受开关影响）                       |
| `user.id`                                                                                  | 每条记录                   | 恒带（未登录时为本机持久匿名 id）                |
| `user.email`                                                                               | 每条记录（已认证且有邮箱） | 恒带                                             |
| `terminal.type`                                                                            | 每条记录（探测到时）       | 恒带                                             |
| `service.version` / `service.name` / `os.type` / `host.arch`                               | 遥测资源                   | 恒带                                             |
| `OTEL_RESOURCE_ATTRIBUTES` 里的键                                                          | 遥测资源 + 指标数据点      | `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES`（开） |
| `vcs.repository.url.full` / `vcs.owner.name` / `vcs.repository.name` / `vcs.provider.name` | 每条记录                   | `OTEL_METRICS_INCLUDE_REPOSITORY`（**关**）      |
| `app.entrypoint`                                                                           | 指标数据点                 | `OTEL_METRICS_INCLUDE_ENTRYPOINT`（**关**）      |
| `app.entrypoint`                                                                           | 每条事件                   | 恒带（事件面不受开关影响）                       |

- **`session.id` 是逐条记录的属性**：长驻宿主（daemon、桌面端远程主机）在一个进程里承载多个会话，一个进程共享的 resource 无法表达「这条记录属于哪个会话」，所以它挂在数据点/事件上。多会话并发时各记录的归属互不串味。
- **`OTEL_RESOURCE_ATTRIBUTES` 会投影到数据点**：`OTEL_RESOURCE_ATTRIBUTES="department.name=infra"` 这类自定义标签既进遥测资源，也直接落在每个指标数据点上——即使收集器不把资源属性落成序列标签，按团队过滤在指标侧依然成立。
- **仓库维度默认关闭**：`OTEL_METRICS_INCLUDE_REPOSITORY=1` 时从会话工作目录的 `origin` remote 派生上述四个键（`provider.name` 为 `github` / `gitlab` / `unknown`）；**远端 URL 里的凭据会被剥掉**，本地路径不出现在遥测里；目录不是 git 仓库或没有 `origin` 时整组不带。
- **`service.version` 取构建产物自身的版本**：不再依赖 `npm_package_version`（打包后的宿主没有这个环境变量，会退化成 `unknown` 并把同一车队拆成多条序列）。
- **入口标识由创建会话的那一方声明**：取值为固定的五档 `cli` / `desktop` / `vscode` / `jetbrains` / `remote`（远控通道），来自「谁创建（或 daemon 重启后重新托管）了这条会话」，不靠进程形态猜；会话跑在哪个进程里不决定取值——同一个 daemon 进程里，本机建的会话与远控进来的会话各自带自己的入口标识。声明了才带，认不出的值（拼写错误、第三方客户端）当作未声明处理：不带该键，也不把原值落成新序列。
- **刻意与 Claude Code 不同的地方**：不额外提供 `app.version`（版本已在遥测资源里）；身份属性固定为 `user.id` + `user.email`，我们账号体系里没有 `account_uuid` / `organization.id`，不造字段；`app.entrypoint` 的取值域是我们自己的五档而不是 Claude Code 的 `cli` / `sdk-ts` / `claude-vscode…`，见[功能规格说明：OpenTelemetry 集成](/specs/enterprise/opentelemetry)。

## 事件日志 (Event Logging) {#otel-events}

Wave 在关键会话生命周期节点记录结构化事件：

| 事件            | 触发时机     | 关键属性                                               |
| --------------- | ------------ | ------------------------------------------------------ |
| `session_start` | 会话启动     | `model`、`workdir`（会话由标准属性 `session.id` 表达） |
| `session_end`   | 会话结束     | `duration`、`totalTokens`、`exitReason`                |
| `user_prompt`   | 用户发送消息 | `prompt_length`、`prompt`（若启用）                    |
| `tool_decision` | 工具权限决策 | `tool_name`、`decision`、`source`                      |
| `compaction`    | 自动压缩触发 | `beforeTokens`、`afterTokens`、`model`                 |
| `error`         | 错误发生     | `error_type`、`message`、`stack`（截断）               |

上表是每个事件自己的字段；**每条事件另外都带一组标准归属属性**（`session.id`、身份、`terminal.type`，以及开启时的 `vcs.repository.*`），见上面的「归属属性」。`session.id` 因此不是 `session_start` 独有的字段——同一进程里的多个会话，靠它把各自的事件区分开。

## PII 保护 {#otel-privacy}

默认情况下，用户提示文本和工具内容**不包含**在遥测数据中。需显式启用：

- `OTEL_LOG_USER_PROMPTS=1`：在事件中包含用户提示文本
- `OTEL_LOG_TOOL_CONTENT=1`：在事件中包含工具输入/输出内容

与提示内容无关、且**默认就带**的归属属性是：账号 id 与邮箱（已认证时；未登录时用本机持久匿名 id，不含 PII）、会话 id、终端类型，以及部署方自己通过 `OTEL_RESOURCE_ATTRIBUTES` 声明的标签。仓库维度（`vcs.repository.*`）默认关闭；`session.id` 若要从指标侧去掉，设 `OTEL_METRICS_INCLUDE_SESSION_ID=0`。

## 可靠性保障 {#otel-reliability}

- **优雅降级**：遥测初始化或导出失败时，Agent 正常运行不受影响，仅记录警告日志
- **关闭刷新**：进程退出时自动刷新遥测数据，超时时间可配置（默认 2 秒）
- **进程级采集**：导出器属于进程而非单个会话——长驻宿主（daemon、桌面端远程主机）里一个会话结束或刷新，其余会话的采集不受影响
- **懒加载**：遥测模块懒加载，不增加启动延迟
