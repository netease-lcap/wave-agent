---
name: "自定义工具 buildTool()"
description: "buildTool() 工厂方法，供 SDK 用户定义自定义工具"
order: 50
---

# 功能规格说明：通过 buildTool() 自定义工具

**创建日期**：2026-05-15

## 用户场景与测试 _（必填）_

### 用户故事：使用 buildTool() 定义自定义工具（优先级：P1）

作为 SDK 用户，我希望使用简单的 `buildTool()` 工厂函数定义自定义工具，以便扩展 agent 的能力而无需编写 MCP 服务器或修改内部代码。

**为什么是这个优先级**：这是核心 API——没有它，SDK 用户无法在 MCP 服务器之外添加自定义工具。

**独立测试**：使用 `buildTool({ name, description, parameters, execute })` 创建工具，将其传递给 `Agent.create({ customTools: [...] })`，发送触发该工具的消息，并验证工具执行并返回结果。

**验收场景**：

1. **假设**通过 `buildTool()` 定义了具有 name、description、parameters 和 execute 函数的自定义工具，**当**工具被传递给 `Agent.create({ customTools: [tool] })` 时，**则**工具与内置工具一起出现并可被模型调用。
2. **假设**定义了带有 `required` 参数的工具，**当**模型调用该工具时，**则**工具的 JSON schema 正确标记必填字段。
3. **假设**有带有 `prompt` 字符串的工具，**当** agent 获取工具配置时，**则** prompt 用作 API 调用中的工具描述。
4. **假设** 工具通过可选字段 `outputSchema` 声明了返回形状，**当** 本会话把它收进 REPL 池（`enableRepl` 打开且该工具被延迟加载）时，**则** 公告签名、`searchTools` 命中与 `describeTool` 都必须渲染出真实的返回类型；未声明则为 `unknown`。`execute` 返回的 `data` 就是脚本 await 到的值，给人看的 `content` 不进脚本。

---

### 用户故事：高级工具功能（优先级：P2）

作为 SDK 用户，我希望高级控制我的自定义工具（参数格式化、动态提示），以便我的工具与 Wave 现有工具生态系统无缝集成。

**为什么是这个优先级**：这些功能允许自定义工具在紧凑显示和上下文感知描述方面与内置工具行为一致。

**独立测试**：使用 `formatCompactParams` 创建工具，验证紧凑表示出现在工具块中。使用动态 `prompt` 函数创建工具，验证描述是上下文感知的。

**验收场景**：

1. **假设**有带有 `formatCompactParams` 的自定义工具，**当**工具执行时，**则** UI 在工具块标题中显示紧凑参数表示。
2. **假设**有 `prompt` 为函数的自定义工具，**当**生成工具描述时，**则**函数使用可用的子 agent、skill 和 workdir 上下文调用。

---

### 用户故事：选择性工具启用（优先级：P2）

作为 SDK 用户，我希望通过 `tools` 白名单控制哪些自定义工具被启用，以便按会话选择性地禁用自定义工具。

**为什么是这个优先级**：自定义工具应遵守与内置工具相同的 `tools` 配置，允许细粒度控制。

**独立测试**：将两个自定义工具传递给 `Agent.create({ customTools: [toolA, toolB], tools: ["ToolA"] })`，验证只有 ToolA 被注册和可调用。

**验收场景**：

1. **假设**自定义工具与 `tools` 白名单一起传递，**当** agent 初始化时，**则**只有名称出现在白名单中的自定义工具被注册。
2. **假设**有自定义工具和 `disallowedTools` 规则，**当**自定义工具匹配拒绝规则时，**则**该工具不被注册。

---

### 边界情况

- **如果两个自定义工具同名会怎样？** 最后注册的获胜（与 `toolsRegistry.set` 的内置工具行为相同）。
- **如果自定义工具与内置工具同名会怎样？** 自定义工具覆盖内置工具（有意为之——允许 SDK 用户覆盖内置行为）。
- **如果 `execute` 抛出错误会怎样？** ToolManager 的现有错误处理捕获它并返回 `{ success: false, error: ... }`。
- **如果自定义工具没声明 `outputSchema` 会怎样？** REPL 里它的返回类型渲染成 `unknown`，模型需要自己试出形状；该字段可选，不传不影响扁平工具调用，也不做运行时校验。
- **如果 `buildTool()` 缺少必填字段（name、description、parameters、execute）调用会怎样？** TypeScript 的类型系统在编译时阻止这种情况；不需要运行时验证。
- **如果 `customTools` 是空数组会怎样？** 不注册自定义工具；行为与不传递 `customTools` 相同。
