# Wave Plugins & Plugin Marketplaces

This guide covers creating plugins, publishing plugin marketplaces, and installing plugins from marketplaces.

## Plugins

Plugins bundle skills, hooks, MCP servers, LSP servers, and slash commands into a reusable package.

### Creating a Plugin

A plugin is any directory containing a `.wave-plugin/plugin.json` manifest:

```json
{
  "name": "my-plugin",
  "description": "A plugin that adds code review capabilities",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

Plugin name must match `^[a-z0-9-]+$` (lowercase letters, numbers, hyphens only).

Place resources in standard directories within the plugin:

| Directory / File | Purpose |
|-----------------|---------|
| `skills/` | Skill directories, each containing a `SKILL.md` file |
| `commands/` | Custom slash command definitions |
| `hooks/hooks.json` | Hook configuration |
| `.lsp.json` | LSP server configuration |
| `.mcp.json` | MCP server configuration |

Only `plugin.json` should exist in `.wave-plugin/` — any other files there will cause a validation error.

### Installing a Plugin Locally

Add a plugin directly in `settings.json`:

```json
{
  "plugins": [
    {
      "type": "local",
      "path": "/path/to/my-plugin"
    }
  ]
}
```

### `${WAVE_PLUGIN_ROOT}` Placeholder

Plugin skills, hooks, MCP servers, and LSP servers can reference their parent plugin's directory using `${WAVE_PLUGIN_ROOT}`. Wave substitutes this placeholder with the plugin's absolute directory path at load time, and also injects `WAVE_PLUGIN_ROOT` as an environment variable into spawned processes.

Example hook command:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"${WAVE_PLUGIN_ROOT}/hooks/session-start\"",
            "async": false
          }
        ]
      }
    ]
  }
}
```

## Plugin Marketplaces

A plugin marketplace is a git repository containing a `.wave-plugin/marketplace.json` that lists available plugins.

### Marketplace Manifest

```json
{
  "name": "my-plugins",
  "owner": {
    "name": "Your Name"
  },
  "plugins": [
    {
      "name": "review-plugin",
      "description": "Adds a /review command for code reviews",
      "source": "./plugins/review-plugin"
    },
    {
      "name": "remote-plugin",
      "description": "Plugin hosted on a remote git repo",
      "source": "https://github.com/user/remote-plugin.git"
    }
  ]
}
```

- `source` can be a **relative path** (resolved from the marketplace repo root) or a **git URL** (`https://`, `git@`, `ssh://`) for remote repos.
- Each plugin at its source path must have its own `.wave-plugin/plugin.json` manifest.

### Registering a Marketplace

Add a marketplace in `settings.json`:

```json
{
  "marketplaces": {
    "my-plugins": {
      "source": {
        "source": "github",
        "repo": "user/my-plugins"
      }
    }
  }
}
```

**Source types:**

| Type | Format | Example |
|------|--------|---------|
| GitHub | `{ "source": "github", "repo": "owner/repo", "ref": "branch" }` | Clones from `github.com/owner/repo` |
| Git URL | `{ "source": "git", "url": "https://...", "ref": "branch" }` | Clones from any git remote |
| Directory | `{ "source": "directory", "path": "/local/path" }` | Uses a local directory |

### Installing from a Marketplace

Install a plugin using the format `plugin-name@marketplace-name`:

```
/install-plugin my-plugin@my-plugins
```

Wave clones the marketplace repo, reads the manifest, and copies the plugin to its cache directory.

### Creating a Plugin Marketplace

1. Create a git repository
2. Add `.wave-plugin/marketplace.json` at the root
3. Add plugin directories with their own `.wave-plugin/plugin.json`
4. Register the marketplace in your `settings.json` using a github, git, or directory source
5. Plugins are cloned to the cache directory on install

### Updating Plugins

Marketplaces with `autoUpdate: true` are checked for updates on startup:

```json
{
  "marketplaces": {
    "my-plugins": {
      "source": { "source": "github", "repo": "user/my-plugins" },
      "autoUpdate": true
    }
  }
}
```

### Marketplace Scopes

Marketplace declarations can be scoped:
- **User scope**: `~/.wave/settings.json` — available in all projects
- **Project scope**: `.wave/settings.json` — available in this project only
- **Local scope**: `.wave/settings.local.json` — not committed to git

Later scopes override earlier ones (local > project > user).
