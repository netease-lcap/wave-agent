# Research: Interactive Plugin UI for Wave Agent CLI

This document consolidates research findings for implementing an interactive plugin UI in the Wave Agent CLI.

## 1. Slash Command Integration

Slash commands are managed by the `SlashCommandManager` in `packages/agent-sdk`.

- **Registration**: Commands are registered in `SlashCommandManager.initializeBuiltinCommands()` (for built-ins like `/clear`, `/init`, `/rewind`) and `loadCustomCommands()` (for user-defined commands).
- **Plugin Commands**: `PluginManager` calls `slashCommandManager.registerPluginCommands()` to register commands defined in plugins, using a `pluginName:commandId` namespace.
- **Handling**:
    - In `packages/code`, `InputManager` detects `/` at the start of input and activates `CommandSelector`.
    - When a command is selected, `InputManager.handleCommandSelect` is called.
    - For agent-side commands, it calls `agent.sendMessage("/command")`.
    - The `Agent` delegates to `SlashCommandManager.executeCommand(commandId, args)`.
- **Pattern for `/plugin`**:
    - Currently, `plugin` is a top-level Yargs command in `packages/code/src/index.ts` for non-interactive use.
    - To add an interactive `/plugin` command, it MUST be registered locally within the `code` package to avoid conflicts with other frontends (like web) that use the `agent-sdk`.
    - **Recommendation**: Register `plugin` in `AVAILABLE_COMMANDS` within `packages/code/src/components/CommandSelector.tsx`. This allows the CLI to intercept the command and trigger a local interactive UI component, similar to how `bashes` triggers `BashShellManager`.
    - The `InputManager` in `packages/code` will handle the transition to the `PluginManagerUI` component when this command is selected.

## 2. Interactive UI Components

The CLI uses **React Ink** for its interface.

- **Full-screen/Modal-like UI**:
    - Components like `BashShellManager` and `McpManager` act as overlays.
    - They are conditionally rendered in `InputBox.tsx` based on state (e.g., `showBashManager`).
    - When active, they take over keyboard input using the `useInput` hook.
- **Keyboard Input Handling**:
    - `useInput` is used to capture keys like `upArrow`, `downArrow`, `return`, and `escape`.
    - `escape` is typically used to close the manager and return to the main chat.
- **Rendering Overlays**:
    - Overlays are rendered within the `InputBox` area but can be designed to occupy more space.
    - `ChatInterface.tsx` manages the overall layout, switching between `MessageList`, `Confirmation`, `RewindCommand`, and `InputBox`.

## 3. Plugin Management API

The core logic resides in `packages/agent-sdk`.

### `MarketplaceService`
- `listMarketplaces()`: Returns registered marketplaces.
- `loadMarketplaceManifest(path)`: Loads plugins available in a marketplace.
- `getInstalledPlugins()`: Returns a list of plugins currently installed in `~/.wave/plugins`.
- `installPlugin(name@marketplace)`: Downloads and installs a plugin.
- `updateMarketplace(name?)`: Pulls latest changes from marketplace repositories.

### `PluginManager`
- `getPlugins()`: Returns currently loaded (and enabled) plugins.
- `loadPlugins(configs)`: Loads plugins from local paths or installed cache.

### `ConfigurationService`
- `getMergedEnabledPlugins(workdir)`: Returns a map of plugin IDs to their enabled status across user and project scopes.
- `updateEnabledPlugin(workdir, scope, pluginId, enabled)`: Enables or disables a plugin by updating `settings.json` or `settings.local.json`.

## 4. State Management

- **Component Tree**:
    - `ChatProvider` (in `useChat.tsx`) holds the global state (messages, loading status, etc.).
    - `InputManager` (and `useInputManager` hook) manages input-related state, including which manager (Bash, MCP, etc.) is currently visible.
- **Interactive UI State**:
    - For a new Plugin Manager UI, state like `viewMode` (`list` vs `detail`), `selectedIndex`, and `searchQuery` should be managed locally within the `PluginManager` component.
    - It should communicate back to `useChat` or `ConfigurationService` for persistent changes (like enabling/disabling).
- **Pattern**:
    - Use `useState` for UI-only state (navigation, selection).
    - Use `useEffect` to fetch data from services on mount.
    - Use callbacks to trigger actions (install, enable).

## 5. Proposed Implementation Plan

1.  **Create `PluginManagerUI.tsx`**: A new component in `packages/code/src/components/` following the pattern of `BashShellManager.tsx`.
2.  **Register `/plugin`**: Add `plugin` to `AVAILABLE_COMMANDS` in `CommandSelector.tsx`.
3.  **Update `InputManager`**: Add `showPluginManager` state and callbacks to `InputManager` and `useInputManager`.
4.  **Integrate in `InputBox`**: Render `PluginManagerUI` when `showPluginManager` is true.
5.  **Implement Views**:
    - **Installed View**: List installed plugins, toggle enabled/disabled.
    - **Marketplace View**: Browse available plugins, install new ones.
    - **Detail View**: Show plugin description, author, version, and available commands/skills.
