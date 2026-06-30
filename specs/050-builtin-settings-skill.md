# 功能规格说明：内置 Settings Skill

**特性分支**：`050-builtin-settings-skill`
**创建日期**：2026-03-18

## 用户场景与测试 *（必填）*

### 用户故事 1 - 通过 Skill 管理 Wave 设置（优先级：P1）

作为用户，我希望能够使用简单的 skill 命令查看和修改我的 Wave 设置（用户、项目或本地），这样就不必手动查找和编辑 JSON 文件。

**为什么是这个优先级**：这是请求的核心功能。通过简化配置管理提供即时价值。

**独立测试**：可以通过运行 `settings` skill 并验证它可以读取和更新不同作用域中的设置来进行完整测试。

**验收场景**：

1. **假设**我有一个 `settings.json` 文件，**当**我运行 `settings` skill 查看配置时，**则**它应显示来自所有适用作用域的当前设置。
2. **假设**我想更改一个设置（例如 `language`），**当**我使用 `settings` skill 更新它时，**则**相应的 `settings.json`（或 `settings.local.json`）应被正确更新。

---

### 用户故事 2 - settings.json 编写指导（优先级：P2）

作为用户，我希望 `settings` skill 提供如何编写 `settings.json` 的指导和文档，包括可用字段及其含义。

**为什么是这个优先级**：改善用户体验和配置选项的可发现性。

**独立测试**：可以通过使用帮助或指南命令调用 `settings` skill 并验证输出包含有用信息来进行测试。

**验收场景**：

1. **假设**我不确定如何配置特定字段，**当**我向 `settings` skill 请求指导时，**则**它应提供清晰的说明和示例。

---

### 用户故事 3 - 复杂 Hook 的文档（优先级：P3）

作为用户，我希望复杂 hook 配置的详细文档在单独的文件中可用，从主 skill 文档链接，这样我就可以了解如何使用高级功能而不会使主指南变得混乱。

**为什么是这个优先级**：高级用户需要这些信息，但最好单独保持清晰。

**独立测试**：验证复杂 hook 的单独 markdown 文件存在并从 `SKILL.md` 链接。

**验收场景**：

1. **假设**我想配置复杂 hook，**当**我阅读 settings skill 的 `SKILL.md` 时，**则**我应找到指向 hook 配置详细指南的链接。

---

### 边界情况

- 当 `settings.json` 文件损坏或包含无效 JSON 时会发生什么？
- 当同一设置在多个作用域中定义时，系统如何处理冲突？
- 如果用户尝试为设置设置无效值（例如无效的 `permissionMode`）会怎样？

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须提供内置的 `settings` skill。
- **FR-002**：`settings` skill 必须能够读取和显示来自用户、项目和本地作用域的合并配置。
- **FR-003**：`settings` skill 必须允许用户在特定作用域（用户、项目或本地）中更新设置。
- **FR-004**：`settings` skill 必须提供关于如何配置 Wave 的指南，涵盖 `settings.json` 中所有支持的字段（`hooks`、`env`、`permissions`、`enabledPlugins`、`language`、`autoMemoryEnabled`、`autoMemoryFrequency`、`models`）以及其他配置文件（`.mcp.json` 用于 MCP 服务器包括 `type` 传输字段、`.wave/rules/` 用于内存规则、`.wave/skills/` 用于自定义 skill、`.wave/agents/` 用于子 agent）。
- **FR-005**：系统必须包含 `settings` skill 的 `SKILL.md`。
- **FR-006**：系统必须为复杂配置创建单独的 markdown 文件（例如 `HOOKS.md`、`ENV.md`、`MCP.md`、`MEMORY_RULES.md`、`SKILLS.md`、`SUBAGENTS.md`、`MODELS.md`）并从 `SKILL.md` 链接。
- **FR-008**：`settings` skill 必须提供关于如何创建和管理自定义 skill 和子 agent 的指导。
- **FR-007**：`settings` skill 必须在保存更改之前验证配置。

### 关键实体 *（如果功能涉及数据则包含）*

- **WaveConfiguration**：代表所有设置的根对象。
- **Scope**：定义设置的存储位置（`user`、`project` 或 `local`）。
- **HookEvent**：触发 hook 的事件（例如 `on_tool_call`）。
- **PermissionRule**：定义允许或拒绝操作的字符串。

### 假设

- `settings` skill 将作为内置 skill 实现。
- 该 skill 将使用现有的 `ConfigurationService` 来读取和写入设置。
- "复杂 hook 配置"指的是 `settings.json` 中 `hooks` 字段的高级用法。

### 模板占位符

- **`${WAVE_SKILL_DIR}`**：模板占位符，解析为 skill 的目录路径。在所有 skill（内置、个人、项目、插件）中可用。
- **`${WAVE_PLUGIN_ROOT}`**：模板占位符，解析为插件的根目录。在插件来源的 skill、hook、MCP 服务器和 LSP 服务器中可用。Wave 在加载时替换此值，并将 `WAVE_PLUGIN_ROOT` 作为真实环境变量注入到生成的进程中。
