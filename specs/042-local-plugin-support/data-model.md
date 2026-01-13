# Data Model: Local Plugin Support

## Entities

### Plugin
Represents a loaded plugin in the system.

- **name**: `string` (Unique identifier, used for namespacing)
- **description**: `string` (Brief description of the plugin)
- **version**: `string` (Semantic version)
- **author**: `object` (Optional)
  - **name**: `string`
- **path**: `string` (Absolute path to the plugin directory)
- **commands**: `SlashCommand[]` (List of commands provided by the plugin)

### PluginManifest
The structure of the `.wave-plugin/plugin.json` file.

- **name**: `string` (Required)
- **description**: `string` (Required)
- **version**: `string` (Required)
- **author**: `object` (Optional)
  - **name**: `string`

### PluginConfig
Configuration for a plugin in `wave.settings.json` or `AgentOptions`.

- **type**: `"local"`
- **path**: `string` (Relative or absolute path)

## Relationships
- An **Agent** has many **Plugins**.
- A **Plugin** has many **SlashCommands**.
- A **Plugin** is defined by a **PluginManifest**.
