# 功能规格说明：添加 Bash 内置子 Agent

**特性分支**：`045-bash-subagent`
**创建日期**：2026-02-12

## 用户场景与测试 *（必填）*

### 用户故事 1 - 通过子 agent 执行 Bash 命令（优先级：P1）

作为用户，我希望将复杂的 bash 操作（如 git 工作流或多步骤终端任务）委托给专门的子 agent，以便主 agent 可以专注于高层推理，而子 agent 处理执行细节。

**为什么是这个优先级**：这是核心功能。它使主 agent 能够将终端密集型任务卸载到专门的 persona，提高效率和可靠性。

**独立测试**：可以通过要求主 agent 执行复杂的 git 操作（例如"rebase this branch and fix conflicts"）并验证它调用"Bash"子 agent 来处理命令来进行测试。

**验收场景**：

1. **假设**主 agent 需要运行多个 bash 命令，**当**它将任务识别为终端密集型时，**则**它应该能够调用"Bash"子 agent。
2. **假设** Bash 子 agent 被调用，**当**它收到任务时，**则**它应使用其专门的系统提示安全地执行命令并报告结果。

---

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须包含一个名为"Bash"的新内置子 agent。
- **FR-002**：Bash 子 agent 必须被描述为"Command execution specialist for running bash commands"。
- **FR-003**：Bash 子 agent 必须被推荐用于 git 操作、命令执行和其他终端任务。
- **FR-004**：Bash 子 agent 必须使用特定的系统提示，强调精确性、安全性、清晰的报告和正确的路径引用。
- **FR-005**：Bash 子 agent 必须继承主 agent 的模型配置。
- **FR-006**：Bash 子 agent 必须能够访问标准 bash 执行工具（相当于参考中的 `S4`）。
- **FR-007**：Bash 子 agent 必须注册为"built-in"来源。

### 关键实体 *（如果功能涉及数据则包含）*

- **Subagent Configuration**：代表子 agent 的元数据和行为（名称、类型、提示、工具）。
- **System Prompt**：定义 Bash 子 agent 角色和约束的专门指令。
