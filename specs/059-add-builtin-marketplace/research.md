# Research: Add Builtin Marketplace

## Decision: Inject Builtin Marketplace in MarketplaceService

The builtin marketplace `wave-plugins-official` will be injected at the service level in `packages/agent-sdk/src/services/MarketplaceService.ts`.

### Rationale
- **Centralized Logic**: `MarketplaceService` is the source of truth for all marketplace operations. Injecting it here ensures that all CLI commands and internal services see the builtin marketplace.
- **Persistence & Removal**: By modifying `getKnownMarketplaces` to include the builtin one if it's not explicitly removed or already present in the configuration file, we satisfy the requirement that it's available by default but can be managed (removed) by the user.
- **Minimal Impact**: This approach avoids changing the configuration file format and leverages existing Git-based marketplace handling.

### Implementation Details
- **Builtin Definition**:
  ```typescript
  const BUILTIN_MARKETPLACE: KnownMarketplace = {
    name: 'wave-plugins-official',
    source: {
      source: 'github',
      repo: 'netease-lcap/wave-plugins-official'
    }
  };
  ```
- **Logic in `getKnownMarketplaces`**:
  1. Load `known_marketplaces.json`.
  2. If the file doesn't exist, return a registry containing only the `BUILTIN_MARKETPLACE`.
  3. If the file exists, return its contents. This allows the user to remove the builtin marketplace (it will be absent from the file) or keep it.
  4. **Deduplication**: If the user manually adds a marketplace with the same name, the one in the config file takes precedence (or we can deduplicate).

### Alternatives Considered
- **Hardcoding in CLI**: Rejected because other parts of the system (like the agent itself) might need to discover plugins without going through the CLI commands.
- **Auto-writing to config file on first run**: Rejected because it's more intrusive and harder to manage if the builtin definition changes in future versions of the SDK.

## Research Tasks Completed
- [x] How are marketplaces currently registered and managed?
- [x] Where is the configuration for marketplaces stored?
- [x] How can I inject a default/builtin marketplace into the system?
- [x] What is the current data structure for a Marketplace?
- [x] How are plugins discovered from these marketplaces?
