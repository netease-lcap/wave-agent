# Feature Specification: Server-Managed Config Download

**Feature Branch**: `055-server-managed-config`
**Created**: 2026-05-25

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Download Managed Settings on Startup (Priority: P1)

As an organization admin, I want to push managed settings (allowed tools, model restrictions, environment variables) to my team's Wave agents so that I can enforce organizational policies without requiring each user to manually configure their settings.

**Why this priority**: This is the core value proposition — centralized configuration management for teams and enterprises.

**Independent Test**: Authenticate via SSO with an account that has managed settings configured on Wave AI, start Wave, and verify the managed settings are applied.

**Acceptance Scenarios**:

1. **Given** the user is authenticated via SSO and the server has managed settings, **When** Wave initializes, **Then** it downloads managed settings from `WAVE_SERVER_URL/api/v1/managed-settings` and applies them.
2. **Given** the user is not authenticated via SSO, **When** Wave initializes, **Then** no managed settings are downloaded and local-only settings are used.
3. **Given** managed settings include a `model` scalar field, **When** settings are resolved, **Then** the managed model takes precedence over the local `settings.json` model (admin enforces). **Given** managed settings include `env.WAVE_MODEL` but no `model` field, **When** the user has a `model` field in `settings.json`, **Then** the user's model takes precedence (user overrides admin's default).

---

### User Story 2 - Checksum-Based Caching (Priority: P2)

As a user on a slow network, I want Wave to skip re-downloading managed settings when they haven't changed so that startup is fast and bandwidth is conserved.

**Why this priority**: Performance optimization — most startups will find unchanged settings, so avoiding the download is a meaningful improvement.

**Independent Test**: Start Wave twice with unchanged managed settings on the server; verify the second startup does not make a download request.

**Acceptance Scenarios**:

1. **Given** managed settings were previously downloaded with a checksum, **When** Wave initializes and the server returns the same checksum, **Then** the cached settings are used without re-parsing.
2. **Given** managed settings were previously downloaded, **When** the server returns a different checksum, **Then** the new settings are downloaded, parsed, and cached.

---

### User Story 3 - Settings Merge Priority (Priority: P1)

As an organization admin, I want my managed settings to override local user settings for specific keys so that security policies (e.g., disallowed tools) cannot be circumvented by local configuration.

**Why this priority**: Without correct merge priority, managed settings could be overridden by local settings, defeating the purpose of centralized management.

**Independent Test**: Configure a managed setting that disallows the Bash tool, verify that a local `allowedTools` setting cannot re-enable Bash.

**Acceptance Scenarios**:

1. **Given** managed settings include `disallowedTools: ["Bash"]`, **When** settings are merged, **Then** the Bash tool is disabled regardless of the local `allowedTools` setting.
2. **Given** managed settings do not include a `model` field, **When** settings are merged, **Then** the local `model` setting from `settings.json` is used.
3. **Given** both managed and local settings include an `env` field, **When** settings are merged, **Then** managed env vars override local ones with the same key, and non-overlapping local env vars are preserved.

---

### Edge Cases

- **What happens if the managed settings endpoint is unreachable?** Wave MUST proceed with cached settings if available, or local-only settings if not. A warning is logged but startup is not blocked.
- **What happens if managed settings contain invalid JSON?** Wave MUST log an error and fall back to local-only settings.
- **What happens if the user logs out of SSO?** Managed settings are no longer downloaded on subsequent startups, but previously cached managed settings remain in effect until overwritten by local changes.
- **What happens if managed settings conflict with environment variables?** User's `settings.json` `model` field overrides admin's `env.WAVE_MODEL` default. If admin wants hard enforcement, they use the `model` scalar field which overwrites the local value during merge. Shell env vars (set before Wave starts) are the lowest priority fallback.
- **What happens during a settings reload (file watcher)?** Managed settings are NOT re-downloaded on file change — they are only downloaded during initialization.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST download managed settings from `WAVE_SERVER_URL/api/v1/managed-settings` during initialization when SSO is authenticated.
- **FR-002**: System MUST include the SSO token as Bearer auth in the managed settings download request.
- **FR-003**: System MUST cache the checksum (ETag or response header) of the last downloaded settings to avoid redundant downloads on subsequent startups.
- **FR-004**: System MUST store cached managed settings and their checksum locally (in `~/.wave/` directory).
- **FR-005**: System MUST merge remote managed settings with local settings using priority: in-memory override > user `settings.json` `model` field > remote managed `model` scalar (admin enforces) / remote `env.WAVE_MODEL` (admin default, user can override) > shell env vars > local project settings.
- **FR-006**: System MUST NOT override local-only settings (hooks, env vars not present in managed settings) with empty values from managed settings — managed settings only override keys they explicitly include.
- **FR-007**: System MUST handle network errors gracefully — if the download fails, use cached managed settings if available, otherwise proceed with local-only settings.
- **FR-008**: System MUST log a warning when managed settings download fails but NOT block agent startup.
- **FR-009**: System MUST parse and validate managed settings JSON before applying; on parse error, fall back to local-only settings with a logged error.
- **FR-010**: System MUST NOT re-download managed settings on file watcher reloads — only on initialization.
- **FR-011**: System MUST include managed settings in the `resolveSettings()` merge pipeline, applied after local settings are loaded.

### Key Entities

- **RemoteManagedSettings**: Settings downloaded from Wave AI server, containing any subset of standard settings.json keys (model, allowedTools, disallowedTools, env, etc.).
- **ManagedSettingsCache**: Locally cached managed settings with associated checksum and fetch timestamp, stored in `~/.wave/managed-settings-cache.json`.
- **RemoteSettingsService**: Service responsible for downloading, caching, and validating managed settings during initialization.
