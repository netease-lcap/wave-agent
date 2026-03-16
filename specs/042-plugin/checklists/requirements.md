# Requirements Checklist: Plugin Support

This checklist ensures that the plugin support system meets all requirements.

## 1. Plugin Structure
- [x] Plugin manifest MUST be at `.wave-plugin/plugin.json`.
- [x] Component directories (`commands/`, `skills/`, `hooks/`, `agents/`) MUST be at the plugin root level.
- [x] Config files (`.lsp.json`, `.mcp.json`) MUST be at the plugin root level.
- [x] Component directories MUST NOT be inside `.wave-plugin/`.

## 2. Plugin Loading
- [x] `PluginLoader` MUST read and validate `.wave-plugin/plugin.json`.
- [x] `PluginLoader` MUST load commands from `commands/*.md`.
- [x] `PluginLoader` MUST load skills from `SKILL.md` files.
- [x] `PluginLoader` MUST load LSP, MCP, and Hooks configurations.
- [x] `PluginManager` MUST store and manage loaded plugins.
- [x] `PluginManager` MUST orchestrate loading and registration of all component types.

## 3. Plugin Management
- [x] `--plugin-dir` flag MUST load local plugins.
- [x] `plugin enable` command MUST enable a plugin in the specified scope.
- [x] `plugin disable` command MUST disable a plugin in the specified scope.
- [x] `plugin install` command MUST support scoped installation and auto-enable.
- [x] `PluginManager` MUST filter loaded plugins by `enabledPlugins` across all scopes.

## 4. Scope Management
- [x] `PluginScopeManager` MUST manage plugin installation scopes (`user`, `project`, `local`).
- [x] `WaveConfiguration` MUST include `enabledPlugins: Record<string, boolean>`.
- [x] `getMergedEnabledPlugins` MUST merge `enabledPlugins` across all scopes.
- [x] Scope priority MUST be `local` > `project` > `user`.

## 5. Dynamic Tools
- [x] `Skill` and `Task` tools MUST use getters for their `config` property.
- [x] Tools MUST reflect plugins loaded after initial tool registration.

## 6. General
- [x] All "Claude" references MUST be replaced with "Agent".
- [x] Plugin IDs MUST follow the `name@marketplace` format.
- [x] `pnpm build` MUST succeed.
- [x] `pnpm run type-check` and `pnpm lint` MUST pass.
