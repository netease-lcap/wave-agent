---
name: "Prompt 缓存控制"
description: "基于正则匹配的显式缓存标记，支持 Claude、Qwen 等多种模型"
order: 90
---

# 功能规格说明：提示缓存控制

**创建日期**：2025-12-02

## 用户场景与测试 _（必填）_

### 用户故事：系统消息缓存优化（优先级：P1）

当开发者通过 OpenAI 提供商使用 Claude 模型时，系统消息（包含指令、环境信息和记忆上下文）应该被自动缓存，以减少同一会话内后续请求的 token 成本并提高响应时间。

**为什么是这个优先级**：系统消息通常很大且在对话中的多个请求之间重用，使其成为缓存的理想候选者。这能带来即时的成本节省和性能改善。

**独立测试**：可以通过使用 Claude 模型进行两次连续代理调用并验证系统消息包含 cache_control 标记且用量追踪显示缓存创建/读取 token 来完整测试。

**验收场景**：

1. **假设**配置了支持缓存的模型（`capabilities.promptCaching: true`），**当**进行代理调用时，**则**系统消息内容被包装在 type 为"ephemeral"的 cache_control 结构中
2. **假设**使用相同系统消息的多次代理调用，**当**后续调用发生时，**则**用量追踪报告系统消息的 cache_read_input_tokens
3. **假设**配置了不支持缓存的模型（`capabilities.promptCaching` 未设为 `true`），**当**进行代理调用时，**则**不向任何消息添加 cache_control 标记

---

### 用户故事：最后消息缓存标记（优先级：P1）

当用户与启用缓存的模型进行多轮对话时，系统维护两个缓存标记：(1) 系统消息（始终标记为稳定前缀），和 (2) 最后一条有内容的消息（user 或 assistant，以最后出现的为准）。最后消息标记每轮大约前进 2 个内容块，因为新消息被添加。由于 API 从每个标记向后扫描 20 个块窗口，且正常对话每轮添加少于 20 个块，之前的缓存位置始终在扫描窗口内，导致缓存命中。

**为什么是这个优先级**：启用缓存的 API（如 Qwen/Alibaba）使用从每个 `cache_control` 标记向后扫描最近 20 个内容块的从后向前前缀匹配策略。通过标记最后一条有内容的消息，直到该点的整个前缀（系统消息、工具和对话历史）被向后扫描覆盖。标记每轮移动约 2 个块（一条用户消息 + 一条助手响应），远在 20 块扫描窗口内，因此之前的缓存始终可达。这种方法是无状态的——不需要模块级状态或桥接追踪。

**独立测试**：可以通过使用不同长度的对话进行代理调用并验证恰好存在两个标记来完整测试：一个在系统消息上，一个在最后一条有内容的消息上。最后消息标记应该每轮前进但缓存命中仍然发生。

**验收场景**：

1. **假设**与启用缓存的模型的短对话，**当**系统处理下一次交互时，**则**系统消息和最后一条有内容的消息都接收 cache_control 标记
2. **假设**有很多轮次的长对话，**当**系统处理下一次交互时，**则**相同的两个标记存在（系统 + 最后消息），最后消息标记已从上一轮前进约 2 个块。之前的缓存位置仍在 20 块扫描窗口内，因此缓存命中发生
3. **假设**对话已被压缩，**当**下一次交互被处理时，**则**相同的 2 标记策略适用，无需重置状态（策略完全无状态）
4. **假设**配置了非启用缓存的模型，**当**进行代理调用时，**则**不向任何消息添加 cache_control 标记
5. **假设**最后一条有内容的消息是助手消息（如工具调用轮次后），**当**系统处理下一次交互时，**则**助手消息接收 cache_control 标记——最后消息标记不区分 user 和 assistant 角色

---

### 用户故事：启用缓存模型的 Token 追踪（优先级：P1）

当使用启用缓存的模型（Claude 或其他如 Gemini/DeepSeek 等返回缓存 token 的模型）时，开发者需要准确的 token 追踪，以了解请求的实际上下文占用和 token 使用。

**为什么是这个优先级**：wave 走 OpenAI 兼容接口（OpenAI SDK + 网关），该格式下 `total_tokens` 已包含缓存命中 token（`prompt_tokens = 缓存命中 + 未命中`）。若再将 `cache_read_input_tokens` / `cache_creation_input_tokens` 叠加进 `latestTotalTokens`，会造成缓存命中双重计数——缓存命中通常占上下文绝大部分，导致 UI 显示接近或超过 `maxInputTokens`（"100% context"）而实际上下文远未到阈值，与压缩判断（仅用 `total_tokens`）口径不一致。缓存字段仍从 usage 中提取并保留（供成本分析等用途），但 `latestTotalTokens` 展示不含它们。

**独立测试**：可以通过使用任何启用缓存的模型进行缓存请求并验证显示的 token 计数为 `total_tokens`（不叠加 `cache_read_input_tokens` / `cache_creation_input_tokens`）来完整测试。

**验收场景**：

1. **假设**带缓存创建的 Claude 模型请求，**当**响应包含 cache_creation_input_tokens（在 usage 顶层）时，**则**latestTotalTokens 显示 total_tokens（不叠加 cache_creation_input_tokens）
2. **假设**带缓存命中的 Claude 模型请求，**当**响应包含 cache_read_input_tokens（在 usage 顶层）时，**则**latestTotalTokens 显示 total_tokens（不叠加 cache_read_input_tokens）
3. **假设**非 Claude 模型请求（如 Gemini、DeepSeek），**当**响应包含 prompt_tokens_details.cached_tokens 时，**则**cache_read_input_tokens 从 cached_tokens 填充但 latestTotalTokens 不含它（仅 total_tokens）
4. **假设**非 Claude 模型请求，**当**响应包含 prompt_tokens_details.cache_creation_input_tokens 时，**则**cache_creation_input_tokens 从该字段填充但 latestTotalTokens 不含它（仅 total_tokens）
5. **假设**模型响应同时包含 Claude 顶层缓存字段和 prompt_tokens_details，**当**两者都存在时，**则**Claude 顶层字段优先（填充到 usage 缓存字段，不影响 latestTotalTokens 展示）
6. **假设**非缓存请求或无缓存 token 的模型，**当**没有缓存 token 时，**则**latestTotalTokens 显示 total_tokens

---

### 用户故事：模式切换间的系统提示稳定性（优先级：P1）

作为在权限模式之间切换（如 default → plan → acceptEdits）的用户，我希望系统提示保持不变，以便缓存的系统提示前缀不会在每次模式切换时被失效，减少 token 成本并提高响应延迟。

**为什么是这个优先级**：计划模式之前将指令附加到系统提示，在每次模式切换时失效整个缓存。对于频繁模式切换的长会话，这导致大量不必要的 token 成本。保持系统提示稳定最大化缓存命中率。

**独立测试**：进入计划模式，验证系统提示与默认模式系统提示相同，并检查计划模式指令作为 `<system-reminder>` 用户消息出现。

**验收场景**：

1. **假设**配置了 Claude 模型且系统提示已被缓存，**当**用户进入计划模式时，**则**系统提示必须与上一轮的系统提示保持相同（不附加计划模式文本）
2. **假设**计划模式活跃，**当**系统发送下一个 API 请求时，**则**计划模式指令必须作为 `<system-reminder>` 包装的用户消息出现在消息数组中，而非系统提示中
3. **假设**用户退出计划模式，**当**下一个 API 请求发出时，**则**系统提示必须保持不变且用量追踪应该显示 cache_read_input_tokens 指示系统消息的缓存命中
4. **假设**配置了非 Claude 模型，**当**用户进入计划模式时，**则**计划模式指令仍然作为 `<system-reminder>` 用户消息出现（注入模式与模型无关，但缓存好处仅适用于 Claude 模型）
5. **假设**配置了 Claude 模型且系统提示已被缓存，**当**代理通过 Bash 工具中的 `cd subdir` 更改 CWD 时，**则**系统提示的 `Primary working directory` 字段必须保持不变（显示原始项目根目录），且用量追踪应该显示 cache_read_input_tokens 指示系统消息的缓存命中

---

### 用户故事：系统提示静态/动态分块缓存（优先级：P1）

作为使用 Claude 模型的开发者，我希望系统提示被拆分为静态块（cacheable: true）和动态块（cacheable: false），使得动态内容变更（MEMORY.md、权限模式、环境信息）不会失效静态块的缓存，从而最大化缓存命中率。

**为什么是这个优先级**：此前整个系统提示作为单一字符串传递给 `transformMessagesForExplicitCache`，该函数对系统消息整体添加 cache_control。这意味着任何动态内容变更（如日期变化、MEMORY.md 更新、权限模式切换）都会改变系统消息内容，导致整个系统提示的缓存被失效。通过将静态内容（base prompt + DOING_TASKS + EXECUTING_ACTIONS + TOOL_POLICY + OUTPUT_EFFICIENCY + TONE_AND_STYLE）和动态内容（权限模式 + 语言 + 环境信息 + auto memory + MEMORY.md）分离为独立的 `SystemPromptBlock`，静态块获得自己的 cache_control 标记，动态块不获得标记，动态内容变更不会影响静态块缓存。

**独立测试**：可以调用 `buildSystemPrompt` 并验证返回值为 `SystemPromptBlock[]`，第一个块 `cacheable: true` 且包含静态内容，后续块 `cacheable: false` 且包含环境信息。可以验证两次调用（不同 workdir）的静态块文本完全相同，动态块文本不同。可以验证 `callAgent` 在 Claude 模型下将 cacheable 块映射为带 `cache_control: {type: "ephemeral"}` 的内容部分，非 cacheable 块映射为不带 cache_control 的内容部分。可以验证 `callAgent` 在非 Claude 模型下将所有块拼接为单个字符串。

**验收场景**：

1. **假设**使用 `buildSystemPrompt` 构建系统提示，**当**检查返回值时，**则**返回 `SystemPromptBlock[]`，每个块具有 `text: string` 和 `cacheable: boolean` 属性
2. **假设**使用不同 workdir 两次调用 `buildSystemPrompt`，**当**比较静态块（`cacheable: true`）时，**则**两次调用的静态块文本完全相同，不受 workdir 变化影响
3. **假设**使用不同 workdir 两次调用 `buildSystemPrompt`，**当**比较动态块（`cacheable: false`）时，**则**两次调用的动态块文本不同（因为包含不同的 `Primary working directory`）
4. **假设**配置了 Claude 模型且传入 `SystemPromptBlock[]` 作为 systemPrompt，**当**`callAgent` 构建系统消息时，**则**系统消息的 content 为数组，cacheable 块对应的内容部分携带 `cache_control: {type: "ephemeral"}`，非 cacheable 块对应的内容部分不携带 cache_control
5. **假设**配置了 Claude 模型且系统消息已含 cache_control（来自块映射），**当**`transformMessagesForExplicitCache` 处理消息时，**则**幂等性检查检测到已有 cache_control，跳过对系统消息的重新标记，不会添加额外 cache_control
6. **假设**配置了非 Claude 模型且传入 `SystemPromptBlock[]` 作为 systemPrompt，**当**`callAgent` 构建系统消息时，**则**系统消息的 content 为字符串，所有块文本以 `\n\n` 拼接
7. **假设**传入纯字符串作为 systemPrompt，**当**`callAgent` 构建系统消息时，**则**系统消息的 content 为该字符串（向后兼容）

---

### 边界情况

- **边界情况 1**：模型能力检测通过声明式 `capabilities.promptCaching` 字段（默认 `false`）和 `capabilities.vision` 字段（默认 `true`）完成，不依赖模型名称匹配。从 usage 中提取缓存 token 适用于所有模型
- **边界情况 2**：混合内容消息必须仅对文本内容部分应用 cache_control，保持图片不变
- **边界情况 3**：流式和非流式请求必须应用相同的 cache_control 转换逻辑
- **边界情况 4**：Token 追踪必须优雅处理缺失的缓存 token 字段（将 undefined 视为 0）
- **边界情况 5**：通过 Bash 中的 `cd` 更改 CWD 绝对不能更改系统提示的 `Primary working directory` 字段（使用不可变的 `originalWorkdir`），保持缓存的系统提示前缀
- **边界情况 6**：最后一条有内容的消息必须接收 cache_control 标记，无论对话长度。如果最后一条消息没有内容（如只有 tool_calls 没有文本的助手消息），系统向后查找最近有内容的消息。标记完全无状态——没有模块级状态跨请求追踪标记位置
- **边界情况 7**：当动态块为空（无 workdir、无权限模式、无 auto memory 等动态内容）时，`buildSystemPrompt` 只返回静态块，不添加空的动态块
- **边界情况 8**：`transformMessagesForExplicitCache` 的幂等性检查（检测系统消息是否已有 cache_control）必须正确处理 `SystemPromptBlock[]` 映射产生的内容部分数组，避免重复标记
