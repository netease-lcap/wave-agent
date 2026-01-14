# Plugin Scope Management Research

## 1. How to best integrate `enabledPlugins` into the existing `WaveConfiguration` type in `packages/agent-sdk/src/types/hooks.ts`.

**Decision:** Add an optional `enabledPlugins` property of type `string[]` to the `WaveConfiguration` interface.

**Rationale:**
The `WaveConfiguration` interface is the central type definition for all Wave Agent settings. Adding `enabledPlugins` directly to this interface makes it a first-class configuration option, consistent with other settings like `hooks`, `env`, and `permissions`. Using `string[]` allows for a simple list of plugin names to be enabled.

**Alternatives considered:**
*   **Separate interface:** Creating a new interface specifically for plugin configuration. This was rejected because it would fragment the configuration and make it harder to manage a single, unified configuration object.
*   **Nested object:** Using a nested object like `plugins: { enabled: string[] }`. This was considered, but a direct array on `WaveConfiguration` is simpler and sufficient for the current requirement.

## 2. How to update `ConfigurationService.loadMergedConfiguration` to correctly merge `enabledPlugins` from `user`, `project`, and `local` scopes.

**Decision:** Modify `loadMergedWaveConfig` in `packages/agent-sdk/src/services/configurationService.ts` to merge `enabledPlugins` arrays. The merging strategy should combine all unique plugin names from `userConfig.enabledPlugins` and `projectConfig.enabledPlugins`, with project-level configurations taking precedence in case of conflicts (though for a simple list of enabled plugins, conflicts are less about overriding and more about combining).

**Rationale:**
The `loadMergedWaveConfig` function already handles merging for `hooks`, `env`, and `permissions`. A similar approach can be used for `enabledPlugins`. Combining the arrays ensures that plugins enabled at either the user or project level are considered enabled. Using a `Set` during merging will automatically handle duplicates.

**Alternatives considered:**
*   **Project overrides user completely:** Only use `projectConfig.enabledPlugins` if present, otherwise use `userConfig.enabledPlugins`. This was rejected because it would prevent users from having a baseline set of enabled plugins that can be augmented by project-specific needs.
*   **User overrides project:** This is the inverse of the above and was rejected for similar reasons.

## 3. How to modify `PluginManager` to efficiently filter installed plugins based on the merged `enabledPlugins` configuration.

**Decision:**
1.  Modify the `PluginManagerOptions` interface to accept an optional `enabledPlugins: string[]` array.
2.  Update the `PluginManager` constructor to store this `enabledPlugins` array.
3.  In `loadInstalledPlugins` and `loadPlugins`, before calling `loadSinglePlugin`, check if the plugin's name is present in the `this.enabledPlugins` array. Only load plugins that are explicitly enabled. If `this.enabledPlugins` is undefined or empty, all installed plugins should be loaded (default behavior).

**Rationale:**
Passing the `enabledPlugins` list to the `PluginManager` constructor ensures that the manager has access to the merged configuration. Filtering at the loading stage (`loadSinglePlugin`) is efficient as it prevents unnecessary parsing and registration of disabled plugins. The default behavior (loading all if no `enabledPlugins` specified) maintains backward compatibility.

**Alternatives considered:**
*   **Filter after loading:** Load all plugins and then filter the `this.plugins` map. This is less efficient as it involves loading and potentially registering components for plugins that will ultimately be disabled.
*   **Pass `enabledPlugins` to `loadPlugins` method:** This would work, but passing it in the constructor makes the `PluginManager`'s state more explicit and consistent.

## 4. Best practices for implementing `wave plugin enable/disable` commands in the `code` package, ensuring they handle the `--scope` flag correctly and update the appropriate `settings.json` or `settings.local.json`.

**Decision:**
1.  Implement new CLI commands `wave plugin enable <plugin-name> [--scope <user|project|local>]` and `wave plugin disable <plugin-name> [--scope <user|project|local>]` within the `packages/cli` package.
2.  These commands will utilize the `ConfigurationService` to read, modify, and write the `enabledPlugins` array in the appropriate `settings.json` file based on the `--scope` flag:
    *   `--scope user`: Modifies `~/.wave/settings.json`
    *   `--scope project`: Modifies `.wave/settings.json` in the current project directory
    *   `--scope local` (default): Modifies `.wave/settings.local.json` in the current project directory
3.  The commands should handle adding/removing the plugin name from the `enabledPlugins` array, ensuring no duplicates when enabling and gracefully handling attempts to disable a non-existent or already disabled plugin.
4.  Provide clear feedback to the user about the success or failure of the operation and which configuration file was modified.

**Rationale:**
*   **Centralized CLI:** Placing these commands in `packages/cli` is standard practice for user-facing commands.
*   **`ConfigurationService` for persistence:** Delegating file operations to `ConfigurationService` ensures consistency in how configuration files are read and written, leveraging its existing logic for path resolution and file handling.
*   **`--scope` flag:** This is crucial for allowing users to control plugin enablement at different levels of precedence, aligning with the merging logic in `ConfigurationService`.
*   **Idempotency:** Ensuring that enabling an already enabled plugin or disabling a disabled plugin doesn't cause errors improves user experience.

**Alternatives considered:**
*   **Direct file manipulation:** Having the CLI commands directly read and write JSON files. This was rejected to avoid duplicating logic already present in `ConfigurationService` and to maintain a single source of truth for configuration management.
*   **Separate service for plugin settings:** Creating a `PluginSettingsService`. This was deemed unnecessary as `ConfigurationService` is already designed for general configuration management and can easily accommodate `enabledPlugins`.

## 5. Verify if `MarketplaceService` should be the one responsible for writing to `settings.json` or if it should delegate to `ConfigurationService`.

**Decision:** `MarketplaceService` should **delegate** the responsibility of writing to `settings.json` or `settings.local.json` to `ConfigurationService`.

**Rationale:**
*   **Separation of Concerns:** `MarketplaceService` is primarily concerned with the discovery, installation, and uninstallation of plugins. It manages its own internal registries (`known_marketplaces.json`, `installed_plugins.json`). The `settings.json` files, on the other hand, define the *active configuration* of Wave, including which plugins are enabled.
*   **Consistency:** `ConfigurationService` is already designed to handle reading, merging, and writing to `settings.json` and `settings.local.json` across different scopes. Having it manage `enabledPlugins` ensures that all configuration changes go through a consistent and validated process.
*   **User Control:** The `wave plugin enable/disable` commands directly manipulate the `enabledPlugins` setting, which is a configuration aspect, not an installation aspect. Therefore, the service responsible for configuration management (`ConfigurationService`) should handle these changes.

**Alternatives considered:**
*   **`MarketplaceService` writes directly:** Allowing `MarketplaceService` to write to `settings.json`. This was rejected because it would blur the lines between plugin installation/uninstallation and plugin configuration, potentially leading to inconsistencies or unexpected behavior if both services tried to modify the same files. It would also require `MarketplaceService` to replicate logic already present in `ConfigurationService` for handling different scopes and merging.
