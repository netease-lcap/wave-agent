# Data Model: Tools Selection

## Entities

### Tool Configuration

Represents the set of capabilities enabled for a specific agent session.

- **Fields**:
  - `enabledTools`: `string[] | undefined`
    - `undefined`: Use the default set of tools (all built-in tools + any loaded plugins).
    - `[]` (empty array): Disable all tools (no built-in tools, no plugins).
    - `string[]`: Enable only the tools whose names match the strings in the array (case-insensitive).

- **Validation Rules**:
  - Tool names in `enabledTools` should be validated against the list of available built-in tools and loaded plugins.
  - If a tool name is provided that doesn't exist, the system should log a warning but continue with the valid tools.

- **State Transitions**:
  - The configuration is set at agent initialization and remains immutable for the duration of the session.

## Relationships

- **Agent**: Each `Agent` instance has one `ToolConfiguration` (passed via `AgentOptions`).
- **ToolManager**: The `ToolManager` uses the `ToolConfiguration` to filter which tools are registered and available for use.
- **PluginManager**: The `PluginManager` uses the `ToolConfiguration` to filter which plugins are loaded.
