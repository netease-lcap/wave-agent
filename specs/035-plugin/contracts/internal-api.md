# Internal API Contracts: Plugin Management UI

This document defines the internal interfaces between the CLI UI and the underlying services.

## UI Component Interface

```typescript
/**
 * Entry point for the Plugin Manager CLI.
 * Renders the Ink component and handles the lifecycle.
 */
export async function startPluginManagerCli(): Promise<void>;
```

## Service Hooks

The UI uses a custom hook to interact with `PluginCore` services.

```typescript
interface UsePluginManager {
  // Data
  marketplaces: KnownMarketplace[];
  installedPlugins: InstalledPlugin[];
  discoverablePlugins: MarketplacePluginStatus[];
  mergedEnabled: Record<string, boolean>;
  
  // Marketplace actions
  addMarketplace(source: string, scope?: Scope): Promise<void>;
  removeMarketplace(name: string, scope?: Scope): Promise<void>;
  updateMarketplace(name?: string): Promise<void>;
  
  // Plugin actions
  installPlugin(pluginId: string, scope?: Scope): Promise<InstalledPlugin>;
  uninstallPlugin(pluginId: string): Promise<void>;
  enablePlugin(pluginId: string, scope?: Scope): Promise<Scope>;
  disablePlugin(pluginId: string, scope?: Scope): Promise<Scope>;
  updatePlugin(pluginId: string): Promise<InstalledPlugin>;
}
```

## Marketplace Source Parsing
The UI handles various input formats for marketplaces:

| Input Format | Parsed Source |
|--------------|---------------|
| `owner/repo` | `{ source: "github", repo: "owner/repo" }` |
| `owner/repo#branch` | `{ source: "github", repo: "owner/repo", ref: "branch" }` |
| `https://example.com/repo.git` | `{ source: "git", url: "https://example.com/repo.git" }` |
| `git@github.com:owner/repo.git` | `{ source: "git", url: "git@github.com:owner/repo.git" }` |
| `ssh://git@example.com/repo.git` | `{ source: "git", url: "ssh://git@example.com/repo.git" }` |
| `./path/to/dir` | `{ source: "directory", path: "./path/to/dir" }` |

## Plugin Install Source Handling
When installing a plugin, the `source` field in `marketplace.json` determines how the plugin is fetched:

| Source Format | Fetch Method |
|---------------|-------------|
| `./plugins/review-plugin` | Copy from marketplace checkout directory |
| `https://github.com/user/plugin.git` | `git clone --depth 1` into temp dir, then move to cache |
| `git@github.com:user/plugin.git` | `git clone --depth 1` into temp dir, then move to cache |
| `ssh://git@example.com/plugin.git` | `git clone --depth 1` into temp dir, then move to cache |
