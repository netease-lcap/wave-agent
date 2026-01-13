# Research: Local Plugin Support

## Decision: Plugin Structure and Loading Mechanism

### Plugin Structure
A plugin will be a directory containing:
- `.wave-plugin/plugin.json`: Manifest file with `name`, `description`, `version`, and optional `author`.
- `commands/`: Directory containing Markdown files for slash commands.

### Loading Mechanism
1. **SDK Configuration**: The `AgentOptions` and `WaveConfig` will be updated to include a `plugins` array:
   ```json
   "plugins": [
     { "type": "local", "path": "./my-plugin" }
   ]
   ```
2. **CLI Flag**: A `--plugin-dir` flag will be added to the CLI to load a plugin from a specific path.
3. **Discovery**: The `SlashCommandManager` will be updated to load commands from these plugins.
4. **Namespacing**: Commands from plugins will be namespaced as `/plugin-name:command-name`.

## Rationale
- **Consistency**: Using Markdown for commands is consistent with existing custom commands.
- **Isolation**: Namespacing prevents command collisions between different plugins.
- **Flexibility**: Supporting both SDK config and CLI flag allows for both persistent and ad-hoc plugin usage.

## Alternatives Considered
- **Single Plugin Directory**: Considered having a single `plugins/` directory where all plugins reside, but allowing arbitrary paths is more flexible for development.
- **No Namespacing**: Considered not namespacing, but it would lead to collisions and make it unclear which plugin a command belongs to.

## Technical Details
- **Manifest Path**: `.wave-plugin/plugin.json` (renamed from `.claude-plugin/plugin.json` as requested).
- **Command Path**: `commands/*.md` within the plugin directory.
- **Namespace**: Derived from the `name` field in `plugin.json`.
