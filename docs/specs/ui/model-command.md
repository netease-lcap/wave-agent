# 功能规格说明：/model 命令

**特性分支**：`031-model-command`
**创建日期**：2026-04-16

## 用户场景与测试 *（必填）*

### 用户故事 1 - 交互式切换模型（优先级：P1）

作为 CLI 用户，我希望输入 `/model` 并从列表中选择不同的 AI 模型，以便我可以在不重启的情况下更改后续交互的模型。

**验收场景**：

1. **假设**用户输入 `/model` 并按下 Enter，**则** `ModelSelector` UI 组件出现，列出所有已配置的模型。
2. **假设**模型列表已显示，**当**用户使用 Up/Down 方向键导航并按下 Enter 时，**则**所选模型成为活动模型，选择器关闭。
3. **假设**模型列表已显示，**当**用户按下 Escape 时，**则**选择器关闭而不更改模型。
4. **假设**模型列表已显示，**则**当前活动模型以绿色标记 `(current)`，光标 `▶` 指示焦点项。

---

### 用户故事 2 - 模型选择在会话中持久化（优先级：P1）

作为 CLI 用户，我希望所选模型在会话的其余时间保持活动状态，以便所有后续 AI 交互使用我选择的模型。

**验收场景**：

1. **假设**用户已通过 `/model` 选择了新模型，**则** `ConfigurationService` 更新活动模型，后续 AI 调用使用新模型。
2. **假设**用户已选择新模型，**则** `onModelChange` 回调触发，以便 UI 和状态栏反映更新的模型。

---

### 用户故事 3 - 发现可用模型（优先级：P2）

作为 CLI 用户，我希望看到配置中有哪些可用模型，以便我知道可以切换到哪些选项。

**验收场景**：

1. **假设**模型在 `settings.json`（用户和项目级别）和环境变量中已配置，**则** `getConfiguredModels()` 聚合所有来源，`ModelSelector` 显示它们。
2. **假设**已配置的模型列表发生变化（如配置重新加载后），**则** `onConfiguredModelsChange` 回调触发，模型列表被刷新。

---

### 边界情况

- **只配置了一个模型怎么办？** 选择器仍然打开但显示单个项。
- **没有配置模型怎么办？** 选择器显示空列表或提示没有可用模型的消息。

## 需求 *（必填）*

### 功能需求

- **FR-001**：CLI 必须提供打开 `ModelSelector` UI 组件的 `/model` 斜杠命令。
- **FR-002**：`ModelSelector` 必须显示 `ConfigurationService.getConfiguredModels()` 返回的所有模型。
- **FR-003**：`ModelSelector` 必须以绿色 `(current)` 高亮当前活动模型，并在焦点项上显示光标 `▶`。
- **FR-004**：用户必须能够使用 Up/Down 方向键导航模型列表并用 Enter 确认。
- **FR-005**：按下 Escape 必须关闭 `ModelSelector` 而不更改模型。
- **FR-006**：选择模型后，`ConfigurationService.setModel()` 必须更新会话的活动模型。
- **FR-007**：`AgentCallbacks` 必须包含 `onModelChange?: (model: string) => void` 以通知 UI 模型更新。
- **FR-008**：`AgentCallbacks` 必须包含 `onConfiguredModelsChange?: (models: string[]) => void` 以在模型列表变化时通知 UI。
- **FR-009**：`Agent` 必须暴露 `setModel(model: string)`，更新配置并触发 `onModelChange` 回调。
- **FR-010**：`Agent` 必须暴露 `getConfiguredModels()` 以提供可选模型列表。
- **FR-011**：`StatusCommand` 必须在 "Model:" 字段下显示活动模型名称。
- **FR-012**：当用户通过 `/model` 选择模型时，系统必须将所选模型持久化到 `~/.wave/settings.json`。
- **FR-013**：模型解析优先级必须为：内存覆盖 > `settings.json` 持久化模型 > `WAVE_MODEL` 环境变量。远程管理的 `model` 标量字段在合并时覆盖本地；远程 `env.WAVE_MODEL` 作为管理员默认值，用户的 `settings.json` `model` 字段可以覆盖它。
