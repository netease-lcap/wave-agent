---
title: 任务、多 Agent 与子代理
description: 任务列表、多会话并发、后台子代理与并发上限
---

# 任务、多 Agent 与子代理

## 任务管理

### 1）任务列表

AI 会根据任务目标自动规划并管理任务列表，实时展示任务进度（待办、进行中、已完成、已删除）以及任务间的依赖关系。任务列表固定在输入框上方，随任务状态实时更新，支持折叠以节省空间。

主要特性：

- **固定在输入区上方**：任务列表始终展示在输入框上方，不随消息流滚动，便于随时查看整体进度。
- **可折叠设计**：点击任务列表 Header（显示任务计数）即可在展开和折叠状态间切换。
- **状态指示**：Header 的 Chevron 图标直观展示当前折叠状态，每个任务行前的图标展示其状态。

### 2）后台任务通知

当后台任务（如 Shell 命令或子代理）完成执行时，CodeWave IDE 会在聊天消息中显示任务通知块，告知用户任务的状态和结果摘要。

主要特性：

- **状态指示**：通过不同的图标和颜色直观展示任务状态——绿色对勾表示已完成，红色叉号表示失败，灰色斜杠表示已终止。
- **任务摘要**：简洁地展示任务的执行结果，如测试通过情况或代理错误信息。
- **输出文件链接**：如果有输出文件，会显示文件路径方便用户查看。

![后台任务通知](/screenshots/desktop-background-notification.webp)

### 3）后台任务系统

CodeWave IDE 支持前台和后台两种任务执行模式：

- **Foreground Task**：前台执行的任务（如正在进行的 Bash 命令），用户可将其退化为后台
- **Background Task**：后台执行的任务，包括：
  - shell 类型：后台 Bash 命令（run_in_background: true）
  - subagent 类型：后台子代理
- 状态流转：running → completed/failed/killed
- Notification Queue：后台任务完成后自动将通知注入聊天消息，显示任务状态和结果摘要
- 支持 TaskStop 工具通过 task_id 中止指定后台任务

### 4）后台任务管理对话框

输入 `/tasks` 斜杠命令可打开后台任务管理对话框，集中查看与管理当前会话中的所有后台任务（包括 shell、subagent、workflow 三种类型）。任务列表会随后台状态实时更新（由扩展通过 updateBackgroundTasks 推送）。

**列表视图：**

- 每行展示任务标识 `[id] type`，并通过彩色圆点指示状态——绿色 running、蓝色 completed、红色 failed、黄色 killed。
- 显示任务描述、执行的命令（`$ <command>`）、启动时间、运行时长以及退出码（若已结束）。
- 处于 running 状态的任务行提供「停止」按钮，点击后向扩展发送 stopBackgroundTask，按钮临时切换为「停止中...」。

**详情视图：**

- 点击列表中的任意任务进入详情，展示完整的运行信息：标识、类型、状态（含退出码）、描述、命令、启动时间与运行时长、日志文件路径（Log）。
- 底部展示「OUTPUT (last 20 lines)」区域，按需通过 getBackgroundTaskOutput 拉取任务的标准输出末尾 20 行；若存在标准错误输出，则额外展示「ERRORS」区域。
- 运行中的任务提供「停止」按钮。
- 交互：点击遮罩层外部或按 Esc 关闭对话框；在详情视图按 Esc 先返回列表。底部按钮：「返回列表」（仅详情视图可见）与「关闭」。空列表时显示「暂无后台任务」。

![后台任务管理对话框](/screenshots/desktop-background-tasks.webp)

## 多Agent与并发

### 1）Agents 对话框

输入 `/agents` 斜杠命令可唤起设置页并选中「子代理」选项卡，查看当前会话中所有可见的子代理（subagent）定义。定义按来源分组展示——内置 agents、用户 agents、项目 agents、插件 agents，数据由扩展通过 getSubagentConfigurations 从 CLI 实时获取。

**列表视图：**

- 每个分组以来源名开头（内置 / 用户 / 项目 / 插件），组内每行展示代理名称、模型（`· <model>`）与描述。
- 插件提供的代理以 `插件名:代理名` 的命名空间形式展示，避免与内置或用户代理重名。
- 点击任意行进入详情。

**详情视图：**

- 展示完整配置：描述、模型（未显式配置时显示「默认（未显式配置）」）、来源、可用工具、定义文件路径与系统提示词全文。
- 系统提示词以代码块展示，内容过长时在对话框内部滚动。

### 2）并发使用子代理

AI 可以在同一回合内并行启动多个 Agent 工具块（并发安全的工具会批量并行执行），消息流中会实时显示各个子代理的进度。主要有两种使用方式：

**方式一：工具块内直接并发**

在一条消息中要求 AI 同时完成多件事，AI 会并行启动多个子代理。提示词示例：

> 请同时做三件事：1) 梳理支付模块的代码结构；2) 审查分布式事务中的竞态条件；3) 盘点测试覆盖缺口。

**方式二：后台运行子代理**

要求 AI 使用 run_in_background 参数把子代理放入后台执行，不阻塞当前对话——主对话可以继续做其他事，子代理完成后会收到任务通知，也可通过 `/tasks` 命令集中管理。

提示词示例：

> 在后台调研支付网关的兼容性，同时并行审查提现流程的边界条件，我们先继续重构其他模块。

![并发使用子代理](/screenshots/desktop-subagent-concurrency.webp)

### 3）并排多对话

1. 拖拽左侧会话树到对话区域，或者 Cmd/Ctrl+点击会话，新增一个分屏并排展示会话。
2. Cmd/Ctrl+Shift+N（macOS 为 Cmd+Shift+N）一步并排打开空白新会话；Cmd+W 关闭当前分屏（仅剩一个时不提供关闭入口）。

- 各分屏的消息流、流式状态、任务列表与确认交互互不影响，多个分屏可同时流式生成；关闭正在生成的分屏后会话在后台继续运行（侧边栏运行中标识保留）
- 拖拽分屏头部可重排左右顺序，拖拽分屏间的分隔条可调整宽度（最小 360px）；手动调过的宽度比例在新增/关闭分屏时按比例保持
- 横向空间拥挤时，把分屏拖到聊天区上/下边缘可形成上下两行分屏（最多两行），利用垂直空间对照更多会话；拖拽行间分隔条调整行高（最小 280px），把下行分屏拖回上行即消除空行

![并排多对话](/screenshots/desktop-split-panes.webp)

## SubAgent

子代理（SubAgent）是把任务委派给具有独立上下文、专业角色和工具权限的专用 Agent 执行。有三种使用方式：

### 1）内置的子代理

| 子代理          | 文件名             | 描述                                                                  | 工具                                               | 模型        | 备注                                                                                                                   |
| --------------- | ------------------ | --------------------------------------------------------------------- | -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Explore         | explore.md         | 只读的代码定位代理：按模式找文件、检索符号/关键词、回答「X 定义在哪」 | 除 Agent/Artifact/ExitPlanMode/Edit/Write 之外全部 | inherit     | 不用于 code review、设计文档审计、跨文件一致性检查或开放式分析；跳过项目 AGENTS.md；按 quick/medium/very thorough 检索 |
| Plan            | plan.md            | 软件架构师：设计实现方案，产出分步计划、关键文件、架构权衡            | 与 Explore 相同（黑名单）                          | inherit     | 只读模式；跳过项目 AGENTS.md；输出必须以 "Critical Files for Implementation"（3-5 个文件）结尾                         |
| vision          | vision.md          | 图像识别专家，运行在 WAVE_VISION_MODEL 指定的视觉模型上               | Read                                               | visionModel | 仅当主模型声明 `"vision": false` 且设置了 env 时可用；通过 `[Image source: <path>]` 元数据委托读图                     |
| general-purpose | general-purpose.md | 通用代理：复杂问题研究、代码搜索、多步骤任务执行                      | 全部（默认）                                       | 默认        | 无 name 字段，由解析器回退取文件名（subagentParser.ts:137）；可写文件但默认不建文档                                    |

### 2）自动委派（无需手动操作）

当你描述任务时，我会自动判断是否匹配某个子代理的专业方向并委派。例如：

- 搜索代码 → 自动派 Explore 子代理
- 设计实现方案 → 自动派 Plan 子代理
- 研究复杂问题 → 自动派 general-purpose 子代理

![自动委派子代理](/screenshots/desktop-subagent.webp)

### 3）显式点名（精确控制）

在输入框敲 `@`，候选列表除文件外还列出当前会话可见的子代理（名称 + 描述），选中即插入 `@<名称>` 标签，发送后排给该子代理执行：

- 候选按名称或描述过滤，子代理条目排在文件之前
- 一条消息可点名多个子代理
- 也可以直接手打或粘贴 `@<名称>`；名字没加载时，主对话会收到可用子代理清单

在需求中直接说明同样有效，例如：

- "用 Explore 子代理找到所有 API 入口"
- "让 Plan 子代理先出一份迁移方案"
- "派多个子代理分别调研这三种方案的优劣"

![显式点名子代理](/screenshots/desktop-subagent.webp)

### 4）创建自定义子代理（团队沉淀）

在项目目录 `.wave/agents/`（或用户级 `~/.wave/agents/`）下放一个 Markdown 文件即可：（也可通过 设置-子代理-创建子代理，快速创建子代理）

```markdown
---
name: testing-expert
description: 测试专家，负责编写与审查测试用例
tools: [Read, Bash, Glob]
model: fastModel
---

你是一名测试专家。你的职责：

1. 分析代码的可测试性并指出薄弱点
2. 按项目规范编写单元测试与集成测试
3. 运行测试并修复失败用例
```

- **name**：唯一标识
- **description**：描述专长与适用场景（用于自动匹配）
- **tools**：限定可用工具（只给必要的）
- **disallowedTools**：工具黑名单（内置 Explore/Plan 就用它，除 Agent、Artifact、ExitPlanMode、Edit、Write 之外全部可用）；与 `tools` 同时写时以 `tools` 为池、再减掉黑名单，两个列表里都出现的工具一律不可用
- **model**：可选，指定专用模型（fastModel/visionModel 可解析对应环境变量，inherit 表示跟随主对话模型）
- **omitAgentsMd**：可选，设为 `true` 时该子代理不注入项目 `AGENTS.md`（及 `CLAUDE.md` 回退）、用户记忆与 `.wave/rules` 无条件规则；Claude Code 的写法 `omitClaudeMd` 同样识别
- **isolation**：可选，设为 `worktree` 时每次调用都在独立临时工作树中执行

![子代理设置页](/screenshots/desktop-settings-subagents.webp)

### 5）子代理可使用的模型

**特殊值（推荐）**

| 写法               | 解析为            | 当前值            |
| ------------------ | ----------------- | ----------------- |
| model: inherit     | 主对话当前模型    | （随主模型）      |
| model: fastModel   | WAVE_FAST_MODEL   | deepseek-v4-flash |
| model: visionModel | WAVE_VISION_MODEL | qwen3.7-plus      |
| 不写 model         | 默认模型          | deepseek-v4-flash |

**具体模型 ID（全部可选）**

- glm-5 / glm-5.1 / glm-5.2 / glm-5-turbo
- kimi-k3 / kimi-k2.5 / kimi-k2.6 / kimi-k2.7-code（代码专用）
- qwen3.5-flash / qwen3.7-max / qwen3.8-max（支持缓存）/ qwen3.7-plus（视觉）
- deepseek-v4-pro / deepseek-v4-flash

需要注意：视觉模型只有在配置了 WAVE_VISION_MODEL 时才可用；如果某个模型 ID 不在上述列表（远程配置未下发），子代理定义会加载失败。
