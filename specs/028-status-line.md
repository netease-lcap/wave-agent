# 功能规格说明：状态栏组件重构

**特性分支**：`028-status-line`
**创建日期**：2026-03-31
**更新日期**：2026-06-01

## 用户场景与测试 *（必填）*

### 用户故事 1 - 一致的状态显示（优先级：P1）

作为开发者，我希望状态栏逻辑封装在其自己的组件中，以便 `InputBox.tsx` 更易于维护，状态栏可以独立重用或修改。

**为什么是这个优先级**：这是重构的核心目标。它提高代码质量和可维护性。

**独立测试**：可以通过运行 CLI 并验证状态栏（模式和 Shell 状态）仍然正确显示在输入区域底部来测试。

**验收场景**：

1. **假设** CLI 正在运行，**当**用户处于正常模式时，**则**状态栏显示 "Mode: [current mode] (Shift+Tab to cycle)"。
2. **假设** CLI 正在运行，**当**用户输入 `!` 时，**则**状态栏显示 "Shell: Run shell command"。
3. **假设** CLI 正在运行，**当**用户使用 Shift+Tab 切换模式时，**则**状态栏中的 `permissionMode` 更新并相应改变颜色。
4. **假设** CLI 正在运行，**当**用户处于 BTW 模式时，**则**状态栏显示 "Mode: BTW (ESC to dismiss)"。

### 用户故事 2 - 上下文使用百分比（优先级：P1）

作为用户，我希望看到上下文窗口已消耗了多少，以便我可以预判自动压缩何时触发并有效管理长对话。

**为什么是这个优先级**：没有上下文可见性，用户无法知道对话正在接近压缩阈值，导致意外的上下文丢失。

**独立测试**：发送多条消息并验证百分比出现并随上下文使用增加而改变颜色。

**验收场景**：

1. **假设** CLI 正在运行且尚未收到 AI 响应，**当**显示状态栏时，**则**不显示百分比（已消耗 0 个 token）。
2. **假设**已收到 AI 响应，**当**显示状态栏时，**则**它在使用率低于 80% 时右对齐显示灰色的 "X% context"。
3. **假设**上下文使用超过 80%，**当**显示状态栏时，**则**百分比文本变为黄色。
4. **假设**上下文使用超过 95%，**当**显示状态栏时，**则**百分比文本变为红色。
5. **假设** AI 正在思考，**当**显示加载指示器时，**则** token 计数显示为 "1,234 tokens (42%)"，百分比带颜色编码。

---

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须在 `packages/code/src/components/StatusLine.tsx` 中拥有专用的 `StatusLine` 组件。
- **FR-002**：`StatusLine` 组件必须接受 `permissionMode`（字符串）、`isShellCommand`（布尔值）和 `isBtwActive`（布尔值）作为 props。
- **FR-003**：`StatusLine` 组件必须在 `isBtwActive` 为 true 时优先显示 BTW 模式。
- **FR-004**：`InputBox.tsx` 必须使用 `StatusLine` 组件替代内联渲染逻辑。
- **FR-005**：`StatusLine` 组件必须接受 `latestTotalTokens`（数字）和 `maxInputTokens`（数字）作为可选 props。
- **FR-006**：`StatusLine` 组件必须在 `latestTotalTokens > 0` 时显示右对齐的 "X% context" 文本。
- **FR-007**：`StatusLine` 组件必须为百分比着色：灰色（<80%）、黄色（80-95%）、红色（>95%）。
- **FR-008**：`LoadingIndicator` 组件必须接受 `maxInputTokens` 作为可选 prop，并在 token 计数旁显示百分比，格式为 "1,234 tokens (X%)"。
- **FR-009**：`ChatContextType` 必须暴露从 `Agent.getMaxInputTokens()` 派生的 `maxInputTokens`（数字）。
- **FR-010**：百分比计算必须使用 `Math.min(Math.round((latestTotalTokens / maxInputTokens) * 100), 100)`，上限为 100%。

### 关键实体 *（如果功能涉及数据则包含）*

- **StatusLineProps**：定义传递给 `StatusLine` 组件的属性的接口。
- **LoadingIndicatorProps**：定义传递给 `LoadingIndicator` 组件的属性的接口（扩展了 `maxInputTokens`）。
