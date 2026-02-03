# Quickstart: Plugin Interactive UI

This guide explains how to use the new interactive Plugin UI in Wave Agent.

## 1. Opening the Plugin UI

There are two ways to trigger the interactive Plugin UI:

### Via Slash Command
In the chat interface, type:
```bash
/plugin
```
This will open the interactive manager as an overlay.

### Via CLI Command
From your terminal, run:
```bash
wave plugin ui
```

## 2. Navigation

The UI is built with React Ink and supports keyboard navigation:

- **Arrow Keys (Up/Down)**: Navigate through lists of plugins or marketplaces.
- **Enter**: Select an item or confirm an action.
- **Tab**: Switch between views (Installed, Marketplace, Settings).
- **Esc**: Close the Plugin UI and return to the chat.
- **'/'**: Focus the search bar to filter plugins.

## 3. Common Tasks

### Installing a New Plugin
1. Open the Plugin UI.
2. Navigate to the **Marketplace** tab (using `Tab` or selecting from the menu).
3. Browse or search for the plugin you want.
4. Press `Enter` to view details, then select **Install**.

### Enabling/Disabling a Plugin
1. In the **Installed** tab, select a plugin.
2. Press `Enter` to toggle its status.
3. You can choose to enable it for the **Current Project** only or **Globally** for all projects.

### Managing Marketplaces
1. Navigate to the **Settings** or **Marketplaces** view.
2. Select **Add Marketplace** to register a new source (GitHub repo or local directory).
3. Select an existing marketplace and choose **Remove** to unregister it.

## 4. Troubleshooting

- **Marketplace not loading**: Ensure you have an active internet connection if using GitHub/Git sources. You can try the **Update** action to refresh manifests.
- **Plugin not appearing**: If you manually added a plugin to the filesystem, use the **Refresh** action or restart Wave Agent.
