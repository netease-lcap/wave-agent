# Feature Specification: Update Command

**Feature Branch**: `031-update-command`  
**Created**: 2026-03-31  
**Input**: User description: "Support `wave update` or `wave-code update` to update the tool to the latest version."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check for Updates (Priority: P1)

As a user, I want to be able to check if a new version of WAVE Code is available, so that I can stay up to date with the latest features and bug fixes.

**Why this priority**: This is the core functionality of the feature. It allows users to know when an update is available.

**Independent Test**: Can be tested by running `wave update` and verifying that it correctly identifies the current version and the latest version from the npm registry.

**Acceptance Scenarios**:

1. **Given** the current version is `0.11.6` and the latest version on npm is `0.11.6`, **When** the user runs `wave update`, **Then** the system informs the user that WAVE Code is already up to date.
2. **Given** the current version is `0.11.5` and the latest version on npm is `0.11.6`, **When** the user runs `wave update`, **Then** the system informs the user that a new version is available.

---

### User Story 2 - Perform Update (Priority: P1)

As a user, I want the tool to automatically update itself to the latest version using the appropriate package manager, so that I don't have to manually run installation commands.

**Why this priority**: This provides a seamless update experience for the user.

**Independent Test**: Can be tested by running `wave update` when an update is available and verifying that it executes the correct update command (e.g., `npm install -g wave-code@latest`).

**Acceptance Scenarios**:

1. **Given** a new version is available and the tool was installed via `npm`, **When** the user runs `wave update`, **Then** the system executes `npm install -g wave-code@latest`.
2. **Given** a new version is available and the tool was installed via `pnpm`, **When** the user runs `wave update`, **Then** the system executes `pnpm add -g wave-code@latest`.

---

### Edge Cases

- **What happens if the network is unavailable?** The system should handle the error gracefully and inform the user that it couldn't check for updates.
- **What happens if the update command fails (e.g., permission issues)?** The system should inform the user of the failure and provide the manual command to run (possibly with `sudo`).
- **What happens if the tool is not installed globally?** The system should still attempt to detect the package manager and perform the update, or provide instructions if it cannot.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an `update` command.
- **FR-002**: System MUST fetch the latest version of `wave-code` from the npm registry (`https://registry.npmjs.org/wave-code/latest`).
- **FR-003**: System MUST compare the current version with the latest version using semver logic.
- **FR-004**: System MUST detect the package manager used for installation (`npm`, `pnpm`, or `yarn`).
- **FR-005**: System MUST execute the appropriate update command for the detected package manager.
- **FR-006**: System MUST provide real-time feedback during the update process by inheriting stdio.
- **FR-007**: System MUST handle errors during version checking and update execution gracefully.

### Key Entities *(include if feature involves data)*

- **Version**: Represents the semver version of the tool.
- **Package Manager**: The tool used to manage the installation of `wave-code` (npm, pnpm, or yarn).
