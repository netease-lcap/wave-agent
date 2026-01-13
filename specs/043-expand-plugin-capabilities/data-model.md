# Data Model: Expand Plugin Capabilities

## Entities

### Plugin
The root container for all plugin-provided functionality.

- **name**: string (unique identifier, lowercase, numbers, hyphens)
- **version**: string (semver)
- **description**: string
- **path**: string (absolute path to plugin root)
- **manifest**: PluginManifest
- **components**:
    - **commands**: CustomSlashCommand[]
    - **skills**: SkillMetadata[]
    - **lspConfig**: LspConfig (optional)
    - **mcpConfig**: McpConfig (optional)
    - **hooksConfig**: PartialHookConfiguration (optional)

### PluginManifest
The static definition of a plugin.

- **name**: string
- **version**: string
- **description**: string
- **author**: { name: string } (optional)

## Relationships

- **Plugin** 1 --- * **CustomSlashCommand**: A plugin can provide multiple slash commands.
- **Plugin** 1 --- * **SkillMetadata**: A plugin can provide multiple Agent Skills.
- **Plugin** 1 --- 0..1 **LspConfig**: A plugin can provide at most one LSP configuration file.
- **Plugin** 1 --- 0..1 **McpConfig**: A plugin can provide at most one MCP configuration file.
- **Plugin** 1 --- 0..1 **PartialHookConfiguration**: A plugin can provide at most one hooks configuration file.

## Validation Rules

1. **Manifest Location**: MUST be at `.wave-plugin/plugin.json`.
2. **Component Location**: All component directories (`commands/`, `skills/`, `hooks/`, `agents/`) and config files (`.lsp.json`, `.mcp.json`) MUST be at the plugin root level.
3. **Misplacement Check**: Component directories MUST NOT be inside `.wave-plugin/`.
4. **Skill Structure**: Each skill MUST be in a subdirectory of `skills/` and contain a `SKILL.md` file.
5. **Command Structure**: Commands MUST be `.md` files in the `commands/` directory.
