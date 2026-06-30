# 功能规格说明：插件支持与市场

**特性分支**：`035-plugin`

## 背景
本规格说明合并并统一了本地插件支持、扩展插件能力（Skills、LSP、MCP、Hooks、Agents）、插件作用域管理以及插件市场生态系统（包括本地、GitHub 和内置市场支持，以及交互式 CLI 管理界面）的需求。它为 Wave 生态系统内插件的发现、安装和管理提供了单一事实来源。

## 远程插件获取

所有远程插件/市场获取都通过 `GitService` 使用 **`git clone --depth 1`**。没有直接的 HTTP 文件下载。获取流程：

1. **市场注册** → 将市场仓库 `git clone`（HTTP/HTTPS/SSH）到 `~/.wave/plugins/marketplaces/<repo>/`
2. **插件安装** → 如果 `marketplace.json` 中插件条目的 `source` 是 Git URL（`http://`、`https://`、`git@`、`ssh://`），则单独克隆插件仓库到临时目录，然后移动到缓存。如果 `source` 是相对路径，则从市场检出目录解析。
3. **插件加载** → `PluginLoader` 从缓存的本地副本读取 `.wave-plugin/plugin.json` 和组件子目录。
4. **插件激活** → `PluginManager.loadSinglePlugin()` 向各自的管理器注册命令、技能、钩子等。

## 用户场景与测试

### 用户故事 1 - 开发者创建本地插件（优先级：P1）
作为开发者，我希望在本地创建自定义插件，以便我可以用自己的命令、技能和其他组件扩展 agent 的能力。

**验收场景**：
1. **假设**新目录 `my-plugin`，**当**我创建带有有效元数据的 `.wave-plugin/plugin.json` 时，**则**该目录被识别为有效的插件结构。
2. **假设**插件目录，**当**我在 `commands/` 目录中添加 Markdown 文件时，**则**它被识别为潜在的斜杠命令。
3. **假设**插件目录，**当**我添加带有有效 frontmatter 的 `skills/my-skill/SKILL.md` 文件时，**则**系统识别 "my-skill" 技能。

### 用户故事 2 - 用户加载和管理插件（优先级：P1）
作为用户，我希望加载本地插件并在不同作用域（用户、项目、本地）中管理其启用状态。

**验收场景**：
1. **假设** `./my-plugin` 有有效插件，**当**我运行 `wave --plugin-dir ./my-plugin` 时，**则**插件被加载到会话中。
2. **假设**插件已安装，**当**我运行 `wave plugin enable <plugin-id> --scope project` 时，**则**插件为当前项目启用，其命令可用。
3. **假设**多个作用域对插件有冲突的设置，**当**系统加载插件时，**则**它必须遵守优先级：`local` > `project` > `user`。

### 用户故事 3 - 正确的插件结构验证（优先级：P3）
作为开发者，我希望系统将组件目录（如 `skills/` 或 `commands/`）放在 `.wave-plugin/` 目录内时警告我。

**验收场景**：
1. **假设**插件中 `skills/` 在 `.wave-plugin/` 内部，**当**插件被加载时，**则**系统应该忽略 `skills/` 目录或提供警告。

### 用户故事 4 - 发现和安装插件（优先级：P1）
作为用户，我希望从市场浏览可用插件并在不同作用域中安装它们，以便我可以为自己或团队扩展 Wave 的功能。

**验收场景**：
1. **假设**用户在 `wave plugin` UI 的"发现"部分，**当**他们选择插件时，**则**他们应该看到详情和三个安装选项：项目（默认）、用户和本地。
2. **假设**插件被选中，**当**选择"为所有协作者安装（项目作用域）"时，**则**插件被下载并在仓库配置中自动启用。
3. **假设**插件被选中，**当**选择"为你安装（用户作用域）"时，**则**插件被下载并全局自动启用给当前用户。
4. **假设**插件被选中，**当**选择"为你安装，仅在此仓库中（本地作用域）"时，**则**插件被下载并自动启用给用户，但仅在当前仓库中活动。
5. **假设**全新安装的 Wave，**当**我运行 `wave plugin marketplace list` 时，**则**我应该在已注册市场列表中看到 `wave-plugins-official`。

### 用户故事 5 - 管理已安装插件（优先级：P2）
作为用户，我希望看到我安装了哪些插件，并能够切换其状态或移除它们，以保持环境干净和功能正常。

**验收场景**：
1. **假设**用户在"已安装"部分，**当**他们选择插件时，**则**他们应该看到卸载、启用或禁用的选项。
2. **假设**一个插件，**当**选择"卸载"时，**则**插件从当前作用域的配置中移除。如果没有其他项目引用，物理文件被删除。

### 用户故事 6 - 管理市场（优先级：P3）
作为用户，我希望添加和管理市场来源，以便我可以从各种提供商（GitHub、SSH 或本地路径）访问插件。

**验收场景**：
1. **假设**有效的 GitHub 仓库 `owner/repo`，**当**我运行 `wave plugin marketplace add owner/repo` 时，**则**市场成功注册。
2. **假设**有效的 Git 仓库 URL，**当**我运行 `wave plugin marketplace add [url]` 时，**则**市场成功注册。
3. **假设**带有有效 `marketplace.json` 的目录，**当**我运行 `wave plugin marketplace add [path]` 时，**则**市场成功注册。
4. **假设**现有市场，**当**在 UI 中选中时，**则**用户可以选择"更新"（刷新插件列表）或"移除"市场。

## 需求

### 功能需求
- **FR-001**：系统必须识别 `.wave-plugin/plugin.json` 为插件清单文件。
- **FR-002**：插件清单必须包含 `name`、`description` 和 `version`。
- **FR-003**：系统必须支持插件根目录下的以下组件目录：
    - `commands/`：Markdown 格式的斜杠命令。
    - `skills/`：带有 `SKILL.md` 文件的 Agent 技能。
    - `agents/`：自定义 agent 定义。
    - `hooks/`：`hooks.json` 中的事件处理器。
- **FR-004**：系统必须支持插件根目录下的以下配置文件：
    - `.lsp.json`：LSP 服务器配置。
    - `.mcp.json`：MCP 服务器配置。
- **FR-005**：系统必须强制只有 `plugin.json` 位于 `.wave-plugin/` 目录内。
- **FR-006**：斜杠命令必须使用插件名称和冒号进行命名空间化（如 `/plugin-name:command-name`）。
- **FR-007**：插件提供的 Agent 技能必须使用插件名称和冒号进行命名空间化（如 `/plugin-name:skill-name`）。
- **FR-008**：系统必须支持三个安装作用域：`user`（全局）、`project`（通过仓库共享）和 `local`（用户在仓库特定）。
- **FR-009**：插件加载逻辑必须从所有适用作用域聚合 `enabledPlugins` 并按优先级应用：`local` > `project` > `user`。
- **FR-010**：`wave plugin install` 必须自动将插件添加到指定作用域的 `enabledPlugins` 中。
- **FR-011**：系统必须支持 `--plugin-dir` 标志以从特定目录加载插件。
- **FR-012**：系统必须提供由 `wave plugin` 触发的独立基于 Ink 的 CLI 界面。
- **FR-013**：系统必须支持三个主要导航区域：发现、已安装和市场。
- **FR-014**：系统必须允许通过 GitHub 简写（`owner/repo`）、Git URL（带可选 `ref` 指定分支/标签）和本地文件系统路径添加市场。
- **FR-015**：系统必须包含 `wave-plugins-official`（github 上的 netease-lcap/wave-plugins-official）作为默认注册市场。
- **FR-016**：系统必须支持 `marketplace.json` 中定义为相对路径或 Git URL 的插件来源。
- **FR-017**：系统必须在本地缓存市场清单以避免冗余网络请求。
- **FR-018**：系统必须支持通过 `wave plugin marketplace update [name]` 或 UI 更新市场。
- **FR-019**：系统必须支持已注册市场的自动更新（内置市场默认启用）。
- **FR-020**：系统必须在执行任何 GitHub 或 Git 相关操作之前检查 Git 可用性。
- **FR-021**：系统必须跟踪并显示每个已注册市场的最后更新时间。
- **FR-022**：系统必须在启动期间在后台执行市场自动更新以避免阻塞 CLI。
- **FR-023**：系统必须实现基于文件的锁定机制，以确保对插件注册表和缓存的安全并发访问。
- **FR-024**：系统必须对所有 Git 操作强制执行超时（默认 120 秒，可通过 `WAVE_PLUGIN_GIT_TIMEOUT_MS` 配置），以防止在慢速网络或大型仓库上挂起。
- **FR-025**：系统必须专门通过 `git clone --depth 1`（浅克隆）获取远程插件和市场。没有直接的 HTTP 文件下载机制。
- **FR-026**：`marketplace.json` 中带有 Git URL 来源（`http://`、`https://`、`git@`、`ssh://`）的插件条目在安装时必须单独克隆，而不是从市场检出中复制。
- **FR-027**：`PluginManager.loadPlugins()` 必须先加载显式配置的插件（来自 `AgentOptions.plugins`），然后加载从 `installed_plugins.json` 中市场安装的插件。
- **FR-028**：`PluginCore` 必须为所有插件和市场操作提供统一的高级 API（安装、卸载、启用、禁用、更新、列表、添加/移除市场、切换自动更新）。

### 关键实体
- **Plugin**：包含元数据和功能扩展的自包含目录。在顶层扩展 `PluginManifest` 并带有组件字段（无嵌套 `components` 包装器）。
- **Plugin Manifest**：包含插件身份和元数据的 JSON 文件（`.wave-plugin/plugin.json`）（`name`、`description`、`version`、可选 `author`）。
- **PluginConfig**：加载插件的配置。当前支持 `type: "local"` 和 `path` 字段。
- **Skill**：由 `SKILL.md` 文件定义的模型调用能力。
- **Scope**：确定设置存储位置及其优先级的配置级别（用户、项目或本地）。
- **Marketplace**：插件的来源。属性包括名称、来源（目录、GitHub 或 Git URL）和可用插件列表。
- **MarketplaceSource**：判别联合类型：`{ source: "directory"; path }` | `{ source: "github"; repo; ref? }` | `{ source: "git"; url; ref? }`。
- **MarketplacePluginEntry**：`marketplace.json` 中的插件列表，包含 `name`、`source`（相对路径或 Git URL）和 `description`。
- **InstalledPlugin**：记录已安装的插件，包含 `name`、`marketplace`、`version`、`cachePath`、可选 `scope` 和可选 `projectPath`。
- **Installation**：表示插件在用户系统上的状态。启用状态通过设置中的 `enabledPlugins` 跟踪，而不是在 `InstalledPlugin` 记录本身上。

## 假设
- **A-001**：已安装的插件如果未在任何 `enabledPlugins` 配置中明确提及，则默认**禁用**。
- **A-002**：`settings.json` 中的 `enabledPlugins` 设置优先于插件在缓存中的单纯存在。
- **A-003**：用户必须使用 `name@marketplace` 格式来唯一标识插件以进行作用域管理。
- **A-004**：底层插件安装逻辑由 SDK 服务通过 `PluginCore` 高级 API 处理。
- **A-005**："项目作用域"安装涉及修改通常提交到版本控制的文件（如 `.wave/settings.json`）。
- **A-006**：系统应安装 `git` 以使用 GitHub 或基于 Git 的市场。
- **A-007**：本地市场存储在与 `wave` 安装相同的文件系统上。
- **A-008**：所有远程获取使用 `git clone`——没有直接的 HTTP 下载插件文件机制。
- **A-009**：GitHub 简写（`owner/repo`）自动解析为 `https://github.com/owner/repo.git`。
