# API Contracts: Marketplace Management

The following "contracts" describe the internal service methods in `MarketplaceService` that will be affected or added.

## MarketplaceService

### `getKnownMarketplaces(): Promise<KnownMarketplacesRegistry>`

Returns the list of all registered marketplaces, including the builtin one if applicable.

**Logic**:
- Check if `known_marketplaces.json` exists.
- If NOT exists: Return `{ marketplaces: [BUILTIN_MARKETPLACE] }`.
- If exists: Return the contents of the file.

---

### `addMarketplace(input: string): Promise<void>`

Adds a new marketplace.

**Logic**:
- Load current marketplaces using `getKnownMarketplaces()`.
- Parse input to create a new `KnownMarketplace`.
- If a marketplace with the same name exists, throw an error or update it.
- Save the updated list to `known_marketplaces.json`.
- **Note**: If this is the first time a user adds a marketplace, the `known_marketplaces.json` will now contain both the builtin one and the new one (to ensure the builtin one persists as per User Story 2).

---

### `removeMarketplace(name: string): Promise<void>`

Removes a marketplace by name.

**Logic**:
- Load current marketplaces.
- Filter out the marketplace with the given name.
- Save the updated list to `known_marketplaces.json`.
- If the user removes `wave-plugins-official`, it will be recorded in the file as absent, thus fulfilling the "removable" requirement.
