---
name: "视觉子代理"
description: "WAVE_VISION_MODEL 环境变量 + 内置 vision 子代理，仅在主模型禁用 vision 时注册，供其委托图像识别"
order: 110
---

# 功能规格说明：视觉子代理

**创建日期**：2026-08-12

> 背景：DeepSeek 等主模型速度快、价格低，但不支持图像识别；支持视觉的模型速度慢、价格贵。设置 `WAVE_VISION_MODEL` 环境变量后，系统内置一个 `vision` 子代理，主模型可继续使用非视觉快速模型，把图片识别委托给视觉模型。
> 社区调研结论：Claude Code 提供 `CLAUDE_CODE_SUBAGENT_MODEL` 全局子代理模型覆盖，但无内置视觉子代理、无自动触发，需用户自写；Codex 对非视觉模型直接丢弃图片（占位文本）；OpenCode 无非视觉 fallback。Wave 的「环境变量 + 内置 vision 子代理」方案为社区首创。
> 触发机制：**主模型自行决定**（不做自动注入）。主模型收到占位符 + `[Image source: <path>]` 路径元数据 + Agent 工具列表中的 vision 子代理描述后，自行判断是否用 Agent 工具委托。
> 注册门（两道，同时满足才注册）：① `WAVE_VISION_MODEL` 已设置（文件系统层，`loadSubagentConfigurations`）；② **当前主模型显式禁用了 vision**（`models[<主模型>].capabilities.vision === false`，会话层，`SubagentManager.getConfigurations` 读取时判定）。主模型的视觉能力没被禁用（默认值 `true`，或显式 `vision: true`）时该子代理不注册 —— 它的唯一作用是非视觉主模型的兜底，主模型自己能看图时它只会占掉每轮工具描述的位置。

## 用户场景与测试 _（必填）_

### 用户故事：WAVE_VISION_MODEL 环境变量启用内置 vision 子代理（优先级：P1）

作为用户，我希望设置 `WAVE_VISION_MODEL` 环境变量后，系统自动内置一个使用该模型的 `vision` 子代理，以便无需手写子代理文件即可把图像识别委托给视觉模型。

**为什么是这个优先级**：这是功能核心——环境变量是唯一开关，内置子代理免去用户配置成本。子代理通过现有加载机制（`builtin/subagents/` 目录扫描）注册，模型通过 frontmatter 特殊值 `model: visionModel` 解析为该环境变量，与现有 `model: fastModel` 机制对称。

**独立测试**：设置 `WAVE_VISION_MODEL` 且主模型声明 `capabilities.vision: false` 后加载子代理配置，断言出现名为 `vision` 且 model 等于该环境变量的配置；未设置环境变量时断言不出现 `vision` 配置。可通过 `loadSubagentConfigurations` 单测覆盖（主模型那道门见下一个用户故事）。

**验收场景**：

1. **假设** 环境变量 `WAVE_VISION_MODEL` 已设置（如 `qwen-vl-max`）且主模型声明 `capabilities.vision: false`，**当** 系统加载内置子代理配置时，**则** 出现名为 `vision` 的子代理，且其解析后的模型为该环境变量的值
2. **假设** 环境变量 `WAVE_VISION_MODEL` 未设置，**当** 系统加载内置子代理配置时，**则** 不出现 `vision` 子代理（避免主模型委托一个解析到非视觉模型的子代理）
3. **假设** 内置 `vision` 子代理已加载，**当** 主代理查看可用子代理列表时，**则** 该子代理出现在 Agent 工具的描述中，主代理可发现并调用

---

### 用户故事：非视觉主模型委托图像识别（优先级：P1）

作为用户，我希望主模型（如 DeepSeek）收到图片时能看到图片路径和 vision 子代理的存在，并自行决定委托它描述图片，以便我继续使用快速文本模型处理其余任务。

**为什么是这个优先级**：这是用户痛点的直接解法——主模型收到图片时，非视觉分支目前仅替换为占位符、不带路径元数据，主模型无从委托。需要让非视觉分支也附加 `[Image source: <path>]`，主模型才能把路径传给 vision 子代理。委托后图片以 base64 图像块形式到达视觉模型（vision 子代理用 Read 工具读取路径即可获得图像块，无需新增图片转发机制）。

**独立测试**：构造主模型 `supportsVision=false` + 消息含图片路径的场景，断言转换后的 API 消息同时包含占位符文本与 `[Image source: <path>]` 文本；构造 vision 子代理调用场景，断言子代理可通过 Read 工具读取路径并获得包含 base64 图像块的 ToolResult。可通过 `convertMessagesForAPI` 与 readTool 单测覆盖。

**验收场景**：

1. **假设** 主模型不支持视觉（如 DeepSeek），**当** 用户消息包含图片且转换 API 消息时，**则** 图片被替换为占位符文本，同时附加 `[Image source: <路径>]` 元数据文本，主模型可知晓图片来源路径
2. **假设** 主模型决定委托，**当** 它调用 Agent 工具（`subagent_type: "vision"`，prompt 包含图片路径）时，**则** vision 子代理以 `WAVE_VISION_MODEL` 指定的模型运行
3. **假设** vision 子代理运行，**当** 它用 Read 工具读取图片路径时，**则** 返回包含 base64 图像块的 ToolResult，视觉模型可看到真实图片内容并返回文字描述
4. **假设** vision 子代理返回描述文本，**当** 主模型继续处理时，**则** 主模型基于该描述回答用户，无需自身具备视觉能力

---

### 用户故事：主模型没禁用视觉时不注册内置 vision 子代理（优先级：P1）

作为使用视觉主模型的用户，我希望 `WAVE_VISION_MODEL` 已设置、但当前主模型自己能看图时，内置 `vision` 子代理**不出现**在 Agent 工具列表里，以免每轮工具描述多出一条我用不上的委托入口。

**为什么是这个优先级**：内置 `vision` 子代理的唯一职责是「非视觉主模型的兜底」。主模型没禁用视觉时图片会直接以图像块发给它，兜底路径用不上：多一条子代理描述意味着每轮请求都多一段固定 token，还会让主模型在收到图片时被诱导去多绕一次委托。判据沿用 SDK 既有的声明式能力位（`ModelCapability.vision`，opt-out 语义、默认 `true`），因此「没禁用」= 未声明或声明为 `true`。

**独立测试**：主模型未声明 `capabilities`（或声明 `vision: true`）+ `WAVE_VISION_MODEL` 已设，断言 `getConfigurations()` 里没有 `vision`；把主模型的 `capabilities.vision` 改成 `false` 后（不重启、不重建缓存）再读一次，断言 `vision` 出现。可通过 `SubagentManager` 单测覆盖。

**验收场景**：

1. **假设** `WAVE_VISION_MODEL` 已设置、主模型未声明 `capabilities` 或声明 `vision: true`，**当** 会话构建 Agent 工具描述时，**则** 可用子代理列表里不含 `vision`
2. **假设** `WAVE_VISION_MODEL` 已设置、主模型声明 `capabilities.vision: false`，**当** 主模型需要读图时，**则** `vision` 出现在可用子代理列表里并可被 Agent 工具调用，行为与现状一致
3. **假设** 会话运行中用户把主模型从「支持视觉」切换到声明 `capabilities.vision: false` 的模型（或反向切换），**当** 下一轮请求构建工具描述时，**则** `vision` 的出现/消失跟随当前主模型的能力位，无需重启会话或重建缓存
4. **假设** 主模型未禁用视觉，**当** 主模型（或工作流）按名字显式调用 `subagent_type: "vision"` 时，**则** 得到与调用不存在的子代理相同的「未找到」失败结果 —— 列表里没有的不能靠点名凑出来（同一道门同时作用于 `getConfigurations` 与 `findSubagent`，否则「没开启」会变成一个有歧义的状态）

---

### 用户故事：视觉模型不受影响（优先级：P2）

作为用户，我希望主模型本身支持视觉时，图片仍按原有方式直接发送，不受 `WAVE_VISION_MODEL` 影响。

**为什么是这个优先级**：保证现有视觉主模型用户零回归——环境变量只增加委托能力，不改变直接发送路径。

**独立测试**：构造主模型 `supportsVision=true` 场景，断言图片仍以 `image_url` 块发送，不附加委托相关逻辑。可通过 `convertMessagesForAPI` 单测覆盖。

**验收场景**：

1. **假设** 主模型支持视觉且 `WAVE_VISION_MODEL` 已设置，**当** 用户消息包含图片时，**则** 图片仍以 `image_url` 块直接发送给主模型
2. **假设** 主模型支持视觉，**当** 消息包含本地路径图片时，**则** 仍附加 `[Image source: <路径>]` 元数据（与 PR #1718 行为一致）

---

### 边界情况

- **`WAVE_VISION_MODEL` 设置为不存在的模型或未配置的模型时会怎样？** 子代理按现有模型解析逻辑处理，模型不可用时报错，与用户自写子代理配置无效模型行为一致。
- **用户消息包含多张图片时会怎样？** 每条图片路径均附加 `[Image source: <路径>]`，主模型可把多个路径一并传给 vision 子代理。
- **图片为 dataURL（webview 粘贴）时会怎样？** 遵循 PR #1718：CLI 先落盘为临时文件，再附加落盘路径的元数据；无法落盘时不附加路径（主模型无法委托该图）。
- **vision 子代理被用户自定义同名子代理覆盖时会怎样？** 按现有子代理合并优先级（project > user > builtin），用户自定义配置优先，`WAVE_VISION_MODEL` 不强制覆盖。
- **主模型支持视觉但用户仍想用 vision 子代理时会怎样？** 内置的那个不注册也不可用（见「主模型没禁用视觉时不注册内置 vision 子代理」）；用户要的是自定义子代理 —— 在 `.wave/agents/` 下自己写一份（`model:` 填 `visionModel` 或直接填视觉模型），行为与普通自定义子代理一致，这道门只删 `scope: builtin` 的那一条。
- **模型没声明 `capabilities` 却能看图，导出图片路由失效时会怎样？** 未声明一律按「支持视觉」处理 ⇒ 内置 `vision` 子代理不注册。要恢复委托，就在 `models[<主模型>].capabilities` 里显式写 `"vision": false`，这也是 SDK 判定图片是否落盘/替换占位符的同一个开关。
- **图片文件在委托前被删除或不可读时会怎样？** vision 子代理的 Read 工具返回错误，主模型收到错误后可提示用户或跳过该图。
