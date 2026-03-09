# Quickstart: Plugin Marketplace and Management UI

This guide shows how to use the plugin marketplace and management UI.

## 1. Access the Plugin Manager
Run the following command to open the interactive plugin manager:
```bash
wave plugin
```
You can navigate between "Discover", "Installed", and "Marketplaces" using `Tab` and `Shift+Tab`.

## 2. Discover and Install Plugins
In the "Discover" view, you can browse available plugins from all registered marketplaces.
1. Select a plugin and press `Enter`.
2. Choose an installation scope:
   - **Project**: Install for all collaborators on this repository.
   - **User**: Install for you globally.
   - **Local**: Install for you, in this repo only.
3. Press `Enter` to install.

## 3. Manage Installed Plugins
In the "Installed" view, you can see your installed plugins.
1. Select a plugin and press `Enter`.
2. Choose an action: **Enable**, **Disable**, or **Uninstall**.

## 4. Manage Marketplaces
In the "Marketplaces" view, you can add, update, or remove marketplace sources.

### Adding a Marketplace
1. Select "Add Marketplace".
2. Enter a source:
   - **GitHub**: `owner/repo` (e.g., `netease-lcap/wave-plugins-official`)
   - **Git**: Full URL (e.g., `https://github.com/owner/repo.git`)
   - **Local**: Path to directory (e.g., `./my-marketplace`)

### Updating Marketplaces
You can update a specific marketplace or all of them to refresh the plugin list.
```bash
wave plugin marketplace update [name]
```

## 5. Builtin Marketplace
The `wave-plugins-official` marketplace is available by default. You can discover and install official plugins immediately after installation.

## 6. CLI Commands
While the interactive UI is recommended, you can also use CLI commands:
- `wave plugin install <plugin-name>@<marketplace-name>`
- `wave plugin marketplace add <source>`
- `wave plugin marketplace list`
- `wave plugin marketplace update [name]`
- `wave plugin marketplace remove <name>`
