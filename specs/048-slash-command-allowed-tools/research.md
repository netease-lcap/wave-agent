# Research: Slash Command Allowed Tools

## Decision: PermissionManager API Extension
**Decision**: Extend `PermissionManager` with `addTemporaryRules(rules: string[])` and `clearTemporaryRules()` methods.
**Rationale**: `PermissionManager` already has `allowedRules` and `isAllowedByRule` logic. Adding a separate `temporaryRules` array allows us to merge them during permission checks without affecting the persistent `allowedRules` or requiring disk I/O.
**Alternatives considered**: 
- Modifying `allowedRules` directly: Risky as it might be overwritten by configuration reloads or accidentally persisted.
- Creating a new `TemporaryPermissionManager`: Overkill and would require duplicating complex bash parsing/matching logic.

## Decision: Slash Command Metadata Extraction
**Decision**: Update `CustomSlashCommandConfig` type to include `allowedTools?: string[]` and update `parseFrontmatter` in `markdownParser.ts` to support array parsing.
**Rationale**: Slash commands are defined in markdown files with YAML frontmatter. The `markdownParser.ts` already handles `model` and `description`. Extending it to handle `allowed-tools` is the most natural fit.
**Alternatives considered**:
- Parsing `allowed-tools` in `SlashCommandManager`: Possible, but `markdownParser` is where all other frontmatter is handled.

## Decision: Recursion Lifecycle Management
**Decision**: Wrap the `sendAIMessage` recursion in `AIManager.ts` using a `try...finally` block at the top-level call (`recursionDepth === 0`).
**Rationale**: The `finally` block in `sendAIMessage` is already used for cleanup (resetting `isLoading`, etc.). It's the most reliable place to ensure `clearTemporaryRules()` is called, even if the AI cycle fails or is aborted.
**Alternatives considered**:
- Manual cleanup in `SlashCommandManager`: Less reliable as `sendAIMessage` is asynchronous and can be aborted from multiple places.

## Decision: Merging Behavior
**Decision**: `PermissionManager.isAllowedByRule` will check both `allowedRules` and `temporaryRules`.
**Rationale**: This ensures `allowed-tools` from slash commands behave exactly like `permissions.allow` in `settings.json`, including wildcard support.
