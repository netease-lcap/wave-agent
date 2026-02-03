# Data Model: Plugin Interactive UI

This document defines the data models for the Plugin Interactive UI, representing the entities used by both the `agent-sdk` services and the `packages/code` UI components.

## 1. Plugin Entity

The `Plugin` entity represents a functional extension in the Wave Agent ecosystem. It can be in various states: available in a marketplace, installed locally, and enabled/disabled for specific projects.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier, typically in `name@marketplace` format. |
| `name` | `string` | The display name of the plugin. |
| `version` | `string` | The current version of the plugin. |
| `description` | `string` | A brief description of what the plugin does. |
| `status` | `PluginStatus` | The current state of the plugin (see below). |
| `marketplace` | `string` | The name of the marketplace this plugin belongs to. |
| `author` | `string` (optional) | The author or organization that created the plugin. |
| `installedPath` | `string` (optional) | The local filesystem path where the plugin is installed. |
| `capabilities` | `PluginCapabilities` | List of commands, skills, or hooks provided by the plugin. |

### PluginStatus

```typescript
type PluginStatus = 
  | 'available'       // In marketplace, not installed
  | 'installed'       // Installed, but disabled
  | 'enabled'         // Installed and enabled
  | 'update_available' // Installed (enabled or disabled), but a newer version exists in marketplace
```

### PluginCapabilities

```typescript
interface PluginCapabilities {
  commands: string[]; // List of slash commands
  skills: string[];   // List of Wave skills
  hooks: string[];    // List of hook events it listens to
}
```

## 2. Marketplace Entity

The `Marketplace` entity represents a source of plugins.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier for the marketplace. |
| `name` | `string` | Display name of the marketplace. |
| `source` | `MarketplaceSource` | The source configuration (directory, github, or git). |
| `isBuiltin` | `boolean` | Whether this is the official "wave-plugins-official" marketplace. |
| `pluginCount` | `number` | Number of plugins available in this marketplace. |

### MarketplaceSource

```typescript
type MarketplaceSource =
  | { source: "directory"; path: string }
  | { source: "github"; repo: string; ref?: string }
  | { source: "git"; url: string; ref?: string };
```

## 3. UI State Model

The internal state used by the `PluginManagerUI` component.

```typescript
interface PluginUIState {
  view: 'installed' | 'marketplace' | 'marketplaces_manage' | 'detail';
  plugins: Plugin[];
  marketplaces: Marketplace[];
  selectedId: string | null;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;
}
```
