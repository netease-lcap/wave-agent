# Quickstart: Plugin Support and Marketplace

This guide provides a quick overview of how to create, load, and manage plugins in Wave, as well as how to use the plugin marketplace.

## 1. Create a Local Plugin
Create a new directory for your plugin and add a `.wave-plugin/plugin.json` file.

```bash
mkdir my-plugin
mkdir my-plugin/.wave-plugin
cat <<EOF > my-plugin/.wave-plugin/plugin.json
{
  "name": "my-plugin",
  "description": "A sample plugin for Wave.",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
EOF
```

## 2. Add a Command
Create a `commands/` directory and add a Markdown file for your command.

```bash
mkdir my-plugin/commands
cat <<EOF > my-plugin/commands/hello.md
# Hello Command
This command says hello to the user.

## Usage
/hello [name]

## Implementation
\`\`\`typescript
export default async function hello(args: string[]) {
  const name = args[0] || "World";
  console.log(\`Hello, \${name}!\`);
}
\`\`\`
EOF
```

## 3. Load the Plugin
Run Wave with the `--plugin-dir` flag to load your local plugin.

```bash
wave --plugin-dir ./my-plugin
```

## 4. Manage Plugins (CLI)
Use the `plugin` command to enable, disable, install, or update plugins.

```bash
# Install a plugin from a marketplace
wave plugin install my-plugin@wave-plugins-official

# Enable a plugin
wave plugin enable my-plugin@wave-plugins-official --scope project

# Disable a plugin
wave plugin disable my-plugin@wave-plugins-official --scope project

# Update a plugin
wave plugin update my-plugin@wave-plugins-official

# Uninstall a plugin
wave plugin uninstall my-plugin@wave-plugins-official
```

## 5. Plugin Structure
A typical plugin structure looks like this:

```
my-plugin/
├── .wave-plugin/
│   └── plugin.json      # Required: Plugin manifest
├── commands/            # Optional: Slash commands
│   └── hello.md
├── skills/              # Optional: Skills
│   └── SKILL.md
├── hooks/               # Optional: Hooks
│   └── hooks.json
├── agents/              # Optional: Agents
│   └── AGENT.md
├── .lsp.json            # Optional: LSP configuration
└── .mcp.json            # Optional: MCP configuration
```

**Note**: All component directories and config files MUST be at the plugin root level, NOT inside `.wave-plugin/`.

## 6. Access the Plugin Manager (UI)
Run the following command to open the interactive plugin manager:
```bash
wave plugin
```
You can navigate between "Discover", "Installed", and "Marketplaces" using `Tab` and `Shift+Tab`.

## 7. Discover and Install Plugins
In the "Discover" view, you can browse available plugins from all registered marketplaces.
1. Select a plugin and press `Enter`.
2. Choose an installation scope:
   - **Project**: Install for all collaborators on this repository.
   - **User**: Install for you globally.
   - **Local**: Install for you, in this repo only.
3. Press `Enter` to install.

## 8. Manage Installed Plugins
In the "Installed" view, you can see your installed plugins.
1. Select a plugin and press `Enter`.
2. Choose an action: **Enable**, **Disable**, or **Uninstall**.

## 9. Manage Marketplaces
In the "Marketplaces" view, you can add, update, or remove marketplace sources.

### Adding a Marketplace
1. Select "Add Marketplace".
2. Enter a source:
   - **GitHub**: `owner/repo` (e.g., `netease-lcap/wave-plugins-official`)
   - **GitHub with branch**: `owner/repo#branch`
   - **Git**: Full URL (e.g., `https://github.com/owner/repo.git`)
   - **Local**: Path to directory (e.g., `./my-marketplace`)

### Updating Marketplaces
You can update a specific marketplace or all of them to refresh the plugin list.
```bash
wave plugin marketplace update [name]
```

## 10. Builtin Marketplace
The `wave-plugins-official` marketplace is available by default. You can discover and install official plugins immediately after installation.

## 11. Remote Plugin Fetching
All remote fetching uses `git clone --depth 1` (shallow clone). There is no direct HTTP file download. Plugin entries in `marketplace.json` can reference:
- **Relative paths** (e.g., `./plugins/review-plugin`) — copied from marketplace checkout
- **Git URLs** (e.g., `https://github.com/user/plugin.git`) — cloned individually

## 12. CLI Commands Reference

| Command | Description |
|---------|-------------|
| `wave plugin` | Open interactive UI |
| `wave plugin list` | List installed plugins |
| `wave plugin install <name>@<marketplace>` | Install a plugin |
| `wave plugin uninstall <name>@<marketplace>` | Uninstall a plugin |
| `wave plugin update <name>@<marketplace>` | Update a plugin |
| `wave plugin enable <name>@<marketplace> [--scope]` | Enable a plugin |
| `wave plugin disable <name>@<marketplace> [--scope]` | Disable a plugin |
| `wave plugin marketplace add <source> [--scope]` | Add a marketplace |
| `wave plugin marketplace list` | List marketplaces |
| `wave plugin marketplace update [name]` | Update marketplace(s) |
| `wave plugin marketplace remove <name>` | Remove a marketplace |
