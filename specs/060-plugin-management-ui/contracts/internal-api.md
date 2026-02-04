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

## Service Hooks (Conceptual)

The UI will use a custom hook to interact with `agent-sdk` services.

```typescript
interface UsePluginManager {
  // Data
  marketplaces: KnownMarketplace[];
  installedPlugins: InstalledPlugin[];
  discoverablePlugins: Plugin[];
  
  // Actions
  addMarketplace(source: string): Promise<void>;
  removeMarketplace(name: string): Promise<void>;
  updateMarketplace(name: string): Promise<void>;
  
  installPlugin(plugin: Plugin, scope: 'user' | 'project' | 'local'): Promise<void>;
  uninstallPlugin(name: string, marketplace: string): Promise<void>;
  togglePlugin(name: string, marketplace: string, enabled: boolean): Promise<void>;
}
```

## Marketplace Source Parsing
The UI must handle various input formats for marketplaces:

| Input Format | Parsed Source |
|--------------|---------------|
| `owner/repo` | `{ source: "github", repo: "owner/repo" }` |
| `git@github.com:owner/repo.git` | `{ source: "git", url: "..." }` |
| `./path/to/dir` | `{ source: "directory", path: "..." }` |
```
