# Data Model: Add Builtin Marketplace

## Entities

### KnownMarketplace (Existing, Evolved)

Represents a registered source for plugins.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Unique identifier for the marketplace. |
| `source` | `MarketplaceSource` | Union type defining the location (GitHub, Git, or local directory). |
| `isBuiltin` | `boolean` (Optional) | Flag to indicate if this marketplace is provided by the system. |

### KnownMarketplacesRegistry (Existing)

The structure stored in `known_marketplaces.json`.

| Field | Type | Description |
|-------|------|-------------|
| `marketplaces` | `KnownMarketplace[]` | List of all registered marketplaces. |

## Validation Rules

- **Unique Name**: No two marketplaces can have the same name. If a user adds a marketplace with the name `wave-plugins-official`, it will override or be deduplicated against the builtin one.
- **Source Validation**: GitHub sources must follow the `owner/repo` format.

## State Transitions

1. **Initial State**: No `known_marketplaces.json` exists. `MarketplaceService` returns the builtin marketplace.
2. **User Adds Marketplace**: A new marketplace is added. `known_marketplaces.json` is created/updated. It should include both the builtin one (if not removed) and the new one.
3. **User Removes Builtin**: The `wave-plugins-official` entry is removed from `known_marketplaces.json`. `MarketplaceService` no longer returns it.
