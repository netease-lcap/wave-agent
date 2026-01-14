# API Contracts: Plugin Scope Management

## ConfigurationService (Internal API)

The `ConfigurationService` in `packages/agent-sdk/src/services/configurationService.ts` will be extended with methods to manage enabled plugins.

### `updateEnabledPlugin(workdir: string, scope: 'user' | 'project' | 'local', pluginId: string, enabled: boolean): Promise<void>`

Updates the enabled state of a plugin in the specified scope.

- **Parameters**:
  - `workdir`: The current working directory (used to resolve project/local paths).
  - `scope`: The target configuration scope.
  - `pluginId`: The unique ID of the plugin (`name@marketplace`).
  - `enabled`: The new state (`true` for enabled, `false` for disabled).

### `getMergedEnabledPlugins(workdir: string): Record<string, boolean>`

Returns the merged `enabledPlugins` mapping from all applicable scopes.

- **Parameters**:
  - `workdir`: The current working directory.
- **Returns**: A record where keys are plugin IDs and values are booleans.

## CLI Commands (User Interface)

### `wave plugin enable <plugin-id> [-s, --scope <scope>]`

Enables a plugin in the specified scope.

- **Arguments**:
  - `<plugin-id>`: The ID of the plugin to enable (e.g., `review-plugin@my-plugins`).
- **Options**:
  - `-s, --scope <scope>`: The installation scope: `user`, `project`, or `local` (default: `user`).

### `wave plugin disable <plugin-id> [-s, --scope <scope>]`

Disables a plugin in the specified scope.

- **Arguments**:
  - `<plugin-id>`: The ID of the plugin to disable.
- **Options**:
  - `-s, --scope <scope>`: The installation scope: `user`, `project`, or `local` (default: `user`).

### `wave plugin install <plugin-id> [-s, --scope <scope>]` (Updated)

Installs and automatically enables a plugin.

- **Arguments**:
  - `<plugin-id>`: The ID of the plugin to install.
- **Options**:
  - `-s, --scope <scope>`: The installation scope: `user`, `project`, or `local` (default: `user`).
