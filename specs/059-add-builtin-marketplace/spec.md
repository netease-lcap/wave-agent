# Feature Specification: Add Builtin Marketplace

**Feature Branch**: `059-add-builtin-marketplace`  
**Created**: 2026-02-03  
**Status**: Completed  
**Input**: User description: "add builtin marketplace, use this one: $ wave plugin marketplace list 
Registered Marketplaces:
- wave-plugins-official: netease-lcap/wave-plugins-official (github)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Access Builtin Marketplace (Priority: P1)

As a user, I want the `wave-plugins-official` marketplace to be available by default so that I can discover and install official plugins without manual configuration.

**Why this priority**: This is the core requirement. It ensures users have immediate access to official plugins out of the box.

**Independent Test**: Can be fully tested by running `wave plugin marketplace list` on a fresh installation and verifying that `wave-plugins-official` is present.

**Acceptance Scenarios**:

1. **Given** a new installation of Wave, **When** I run `wave plugin marketplace list`, **Then** I should see `wave-plugins-official` in the list of registered marketplaces.
2. **Given** the builtin marketplace is present, **When** I attempt to search or list plugins, **Then** results from `wave-plugins-official` should be included.

---

### User Story 2 - Persistence of Builtin Marketplace (Priority: P2)

As a user, I want the builtin marketplace to remain available even if I add or remove other custom marketplaces.

**Why this priority**: Ensures stability and reliability of the plugin ecosystem.

**Independent Test**: Add a custom marketplace, then list marketplaces to ensure both the builtin and custom ones are present.

**Acceptance Scenarios**:

1. **Given** the builtin marketplace is active, **When** I add a new custom marketplace, **Then** both the builtin and the custom marketplace should be listed.
2. **Given** multiple marketplaces are registered, **When** I remove a custom marketplace, **Then** the builtin marketplace should still remain.

---

### User Story 3 - Management of Builtin Marketplace (Priority: P3)

As a user, I want to know if I can disable or override the builtin marketplace if I have specific environment requirements.

**Why this priority**: Provides flexibility for advanced users or restricted environments.

**Independent Test**: Attempt to remove the builtin marketplace and verify the system's behavior (either it's blocked or it works as expected).

**Acceptance Scenarios**:

1. **Given** the builtin marketplace is present, **When** I attempt to remove it, **Then** the system should allow the removal and the marketplace should no longer appear in the list.

---

### Edge Cases

- What happens if the network is unavailable when listing marketplaces?
- How does the system handle conflicts if a user tries to manually add a marketplace with the same name as the builtin one?
- What happens if the builtin marketplace repository is moved or renamed on GitHub?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST include `wave-plugins-official` (netease-lcap/wave-plugins-official on github) as a default registered marketplace.
- **FR-002**: System MUST display the builtin marketplace when the user lists registered marketplaces.
- **FR-003**: System MUST allow the builtin marketplace to be used for plugin discovery and installation without additional user setup.
- **FR-004**: System MUST allow the removal of the builtin marketplace via standard CLI commands, treating it as a pre-configured entry that can be managed by the user.
- **FR-005**: System MUST handle cases where the builtin marketplace is already manually registered by the user (e.g., by deduplicating or prioritizing the builtin definition).

### Key Entities *(include if feature involves data)*

- **Marketplace**: Represents a source for plugins.
  - **Name**: Unique identifier (e.g., `wave-plugins-official`).
  - **URL/Source**: The location of the marketplace (e.g., `netease-lcap/wave-plugins-official`).
  - **Type**: The platform hosting the marketplace (e.g., `github`).
  - **IsBuiltin**: A flag indicating if the marketplace is provided by default.

## Assumptions

- The builtin marketplace is intended to be available for all users of the CLI.
- The source `netease-lcap/wave-plugins-official` is public and accessible via standard GitHub integration.
- The CLI already has a mechanism for managing marketplaces that can be extended to include defaults.
