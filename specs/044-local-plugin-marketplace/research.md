# Research: Local Plugin Marketplace

This document outlines the research and technical decisions for implementing the Local Plugin Marketplace feature.

## 1. Path Resolution for `~/.wave`

- **Decision**: Use `os.homedir()` and `path.join()` to resolve the base directory.
- **Rationale**: This is the standard, cross-platform way to handle user home directories in Node.js. It aligns with existing patterns in `packages/agent-sdk/src/utils/configPaths.ts`.
- **Alternatives considered**: 
    - Hardcoding `/home/user/.wave` (Rejected: Not cross-platform).
    - Using environment variables like `WAVE_HOME` (Rejected: Over-complicates initial setup, but can be added as an override later).

## 2. Atomic Plugin Installation

- **Decision**: Use native `fs` module for file operations. The installation flow will be:
    1. Create a unique temporary directory in `~/.wave/plugins/tmp/`.
    2. Copy the plugin source to the temporary directory using `fs.cpSync(src, dest, { recursive: true })`.
    3. Validate the `plugin.json` in the temporary directory.
    4. Move/Rename the temporary directory to the final destination in `~/.wave/plugins/cache/[marketplace]/[plugin]/[version]` using `fs.renameSync`.
- **Rationale**: Native `fs.cpSync` is available in modern Node.js versions and reduces external dependencies. The "copy-then-rename" pattern ensures that a failed installation doesn't leave a partially copied plugin in the active cache.
- **Alternatives considered**: 
    - `fs-extra` (Rejected: Prefer native `fs.cpSync` as requested).
    - Symlinking (Rejected: User explicitly requested copying for "snapshots").

## 3. CLI Command Integration

- **Decision**: Implement new commands in `packages/code/src/commands/plugin/`.
- **Rationale**: This maintains the functional organization of the `code` package.
- **Alternatives considered**:
    - Adding to a global `commands.ts` (Rejected: Violates "Package-First Architecture" and maintainability).

## 4. Marketplace State Management

- **Decision**: Maintain two JSON files in `~/.wave/plugins/`:
    - `known_marketplaces.json`: List of added marketplace paths and names.
    - `installed_plugins.json`: Registry of installed plugins, their versions, and their local cache paths.
- **Rationale**: Simple, human-readable, and easy to manage without a full database.
- **Alternatives considered**:
    - Storing everything in `settings.json` (Rejected: Keeps plugin state separate from user preferences).

## 5. Plugin Loading Logic

- **Decision**: `PluginManager` will be updated to automatically scan `~/.wave/plugins/installed_plugins.json` and load plugins from their cached paths.
- **Rationale**: This allows installed plugins to be available across all sessions without explicit `--plugin-dir` flags.
- **Alternatives considered**:
    - Requiring users to manually add installed paths to their config (Rejected: Poor UX).
