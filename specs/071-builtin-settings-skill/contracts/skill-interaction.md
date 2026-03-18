# Contract: Settings Skill Interaction

The `settings` skill is a builtin skill that helps users manage their Wave configuration.

## Skill Metadata
- **Name**: `settings`
- **Description**: Manage Wave settings and get guidance on settings.json
- **Allowed Tools**: `Bash`, `Read`, `Write`

## Interaction Flow

1.  **Discovery**: The agent discovers the `settings` skill during initialization.
2.  **Invocation**: The user invokes the skill via `/skill settings` or by asking about settings.
3.  **Guidance**: The skill provides a clear explanation of `settings.json` structure and available fields.
4.  **Exploration**: The skill helps the user explore their current settings in different scopes.
5.  **Modification**: The skill guides the user through updating settings in the appropriate scope.
6.  **Validation**: The skill ensures that any changes made to `settings.json` are valid.

## Supported Fields
- `hooks`: Configure automation hooks.
- `env`: Set environment variables.
- `permissions`: Manage tool permissions.
- `enabledPlugins`: Enable or disable plugins.
- `language`: Set preferred language.
- `autoMemoryEnabled`: Enable/disable auto-memory.

## Documentation Links
- `SKILL.md`: Main skill documentation.
- `HOOKS.md`: Detailed documentation for complex hook configurations.
