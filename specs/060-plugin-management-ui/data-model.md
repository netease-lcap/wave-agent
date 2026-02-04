# Data Model: Plugin Management UI

## View States
The UI transitions between several distinct views:

- **Main Navigation**: `DISCOVER` | `INSTALLED` | `MARKETPLACES`
- **Detail Views**: `PLUGIN_DETAIL` | `MARKETPLACE_DETAIL`
- **Input Views**: `ADD_MARKETPLACE`

## UI State
```typescript
interface PluginManagerState {
  currentView: ViewType;
  selectedId: string | null; // Plugin ID or Marketplace ID
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
}
```

## Entities (Existing in agent-sdk)

### Plugin (from marketplace)
- `name`: string
- `description`: string
- `version`: string
- `marketplace`: string (ID)

### InstalledPlugin
- `name`: string
- `marketplace`: string
- `version`: string
- `scope`: 'user' | 'project' | 'local'
- `isEnabled`: boolean

### Marketplace
- `name`: string
- `source`: MarketplaceSource (GitHub | Git | Directory)
- `isBuiltin`: boolean

## Validation Rules
- **Marketplace Source**: Must be a valid GitHub shorthand (`owner/repo`), a valid Git URL, or an existing local directory path.
- **Installation Scope**: Must be one of the three supported scopes.
- **Plugin Name**: Must be unique within a marketplace.
