# 功能规格说明：通用 Agent

**特性分支**：`041-general-purpose-agent`
**创建日期**：2026-02-03

## 用户场景与测试 *（必填）*

### 用户故事 1 - 访问通用子 agent（优先级：P1）

作为开发者，我希望能够将复杂的研究、多步骤任务和代码修改委托给专门的子 agent，以便主 agent 可以专注于高层协调，而子 agent 处理代码库探索和实现的重型工作。

**为什么是这个优先级**：这是核心需求。虽然 `Explore` 子 agent 处理只读任务，但 `general-purpose` 子 agent 对于需要深度研究和文件修改能力的任务至关重要。

**独立测试**：可以通过验证 `general-purpose` agent 已在系统中注册，并可以通过 `Task` 工具调用并具有完整工具访问权限来进行完整测试。

**验收场景**：

1. **假设**在 Wave Agent 系统中，**当**列出可用的子 agent 时，**则**包含"Explore"和"general-purpose"。
2. **假设**有一个需要文件编辑的任务，**当**主 agent 调用 `Task` 工具并使用 `subagent_type: "general-purpose"` 时，**则**子 agent 成功初始化，具有其特定的系统提示和完整工具访问权限（`*`）。

---

### 用户故事 2 - 互补的子 agent 角色（优先级：P2）

作为系统维护者，我希望 `general-purpose` 子 agent 通过提供写入能力和更广泛的操作范围来补充 `Explore` 子 agent，同时保持一致的安全指南（如绝对路径和不主动创建文档）。

**为什么是这个优先级**：确保快速、只读的 `Explore` agent 与更强大的、面向实现的 `general-purpose` agent 之间有明确的区分。

**独立测试**：可以通过比较 `Explore` 和 `general-purpose` 子 agent 的配置来测试，确保它们具有不同的工具集和系统提示。

**验收场景**：

1. **假设**有 `general-purpose` 子 agent，**当**它被创建时，**则**它可以访问所有工具（`*`），而 `Explore` 仅限于只读工具。
2. **假设**有子 agent 响应，**当**它完成任务时，**则**输出遵循其系统提示中定义的指南（例如，绝对路径、无表情符号），与其他内置 agent 一致。

### 边界情况

- **如果子 agent 初始化失败会怎样？** 系统应优雅地处理错误，并向主 agent 报告子 agent 任务无法完成。
- **工具冲突如何处理？** 由于子 agent 可以访问所有工具（`*`），系统必须确保子 agent 上下文中的工具执行不会干扰主 agent 的状态。

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须注册一个内置 agent，其 `agentType: "general-purpose"`。
- **FR-002**：系统必须定义通用 agent 的 `whenToUse` 元数据，突出其在多步骤研究和实现方面相对于只读 `Explore` agent 的优势。
- **FR-003**：系统必须为通用 agent 提供特定的 `getSystemPrompt`，定义其研究和实现优势。
- **FR-004**：系统应该省略 `general-purpose` agent 配置中的 `tools` 字段，以允许默认的完整工具访问。
- **FR-005**：系统必须设置 `scope: "builtin"` 并使用占位符 `filePath`（例如 `"<builtin:general-purpose>"`）来标识其内置状态。
- **FR-006**：系统必须确保通用 agent 可作为 `Task` 工具的有效目标。
- **FR-007**：系统必须将 `general-purpose` agent 与 `Explore` agent 一起集成到 `getBuiltinSubagents` 工具中。

### 关键实体 *（如果功能涉及数据则包含）*

- **General-Purpose Agent**：具有特定系统提示和工具访问权限的专门 agent 实例。
- **Research Task**：搜索、阅读和分析文件以回答用户查询的多步骤过程。
- **Final Writeup**：包含绝对路径和代码片段的综合响应，格式不含表情符号。
