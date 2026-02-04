# Quickstart: Plugin Management UI

## Overview
The Plugin Management UI is an interactive CLI tool for managing Wave plugins and marketplaces.

## Usage
Run the following command to open the manager:
```bash
wave plugin
```

## Navigation
- **Arrow Keys**: Navigate through lists and menus.
- **Enter**: Select an item or confirm an action.
- **Tab**: Switch between main sections (Discover, Installed, Marketplaces).
- **Escape**: Go back to the previous view or exit.

## Key Actions

### Discovering Plugins
1. Navigate to the **Discover** tab.
2. Select a plugin to view details.
3. Choose an installation scope:
   - **User**: Global for your user account.
   - **Project**: Shared with all collaborators in the current repo.
   - **Local**: For you, but only in the current repo.

### Managing Installed Plugins
1. Navigate to the **Installed** tab.
2. Select a plugin to:
   - **Enable/Disable**: Toggle plugin functionality.
   - **Uninstall**: Remove the plugin from the selected scope.

### Managing Marketplaces
1. Navigate to the **Marketplaces** tab.
2. Select **Add Marketplace** to register a new source.
3. Enter a source (e.g., `owner/repo`, `git@github.com...`, or `./path`).
4. Select an existing marketplace to **Update** or **Remove** it.
