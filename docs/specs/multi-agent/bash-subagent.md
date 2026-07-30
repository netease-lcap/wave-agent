---
name: "Bash 子代理"
description: "内置 Bash 子代理，执行 shell 命令"
order: 50
---

# 功能规格说明：添加 Bash 内置子 Agent

**创建日期**：2026-02-12

## 用户场景与测试 *（必填）*

### 用户故事：通过子 agent 执行 Bash 命令（优先级：P1）

作为用户，我希望将复杂的 bash 操作（如 git 工作流或多步骤终端任务）委托给专门的子 agent，以便主 agent 可以专注于高层推理，而子 agent 处理执行细节。

**为什么是这个优先级**：这是核心功能。它使主 agent 能够将终端密集型任务卸载到专门的 persona，提高效率和可靠性。

**独立测试**：可以通过要求主 agent 执行复杂的 git 操作（例如"rebase this branch and fix conflicts"）并验证它调用"Bash"子 agent 来处理命令来进行测试。

**验收场景**：

1. **假设**主 agent 需要运行多个 bash 命令，**当**它将任务识别为终端密集型时，**则**它应该能够调用"Bash"子 agent。
2. **假设** Bash 子 agent 被调用，**当**它收到任务时，**则**它应使用其专门的系统提示安全地执行命令并报告结果。

---

